import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Building2, Check, Copy, ImageUp, Plus, Star, Trash2 } from "lucide-react";
import { supabase, must, errorMessage } from "@/lib/supabase";
import { useActiveCompany } from "@/lib/session";
import { useAsync, useDebounced } from "@/lib/hooks";
import type { Company, InvoiceTemplateRow, PdfFont, TemplateBase, TemplateSettings } from "@/lib/types";
import { computeInvoice } from "@/domain/vat";
import { DEFAULT_SETTINGS, TEMPLATE_PRESETS, presetFor, resolvePositions, resolveSettings } from "@/pdf/templates";
import { FreeLayoutEditor } from "./FreeLayoutEditor";
import { StyleOptions } from "./StyleOptions";
import { CompanyForm } from "@/features/companies/CompanyForm";
import { forgetImage, loadPdfAssets } from "@/pdf/export";
import type { InvoicePdfData } from "@/pdf/InvoiceDocument";
import { PdfPreview } from "@/pdf/PdfPreview";
import { Badge, Button, Card, Checkbox, ConfirmDialog, Dialog, EmptyState, ErrorBox, Field, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Facture d'exemple (données fictives) pour prévisualiser un modèle avec l'identité de l'entreprise. */
function sampleData(company: Company, base: TemplateBase, settings: Partial<TemplateSettings>, logo: string | null, background: string | null): InvoicePdfData {
  const rates = company.vat_rates_bp.length ? company.vat_rates_bp : [2000];
  const items = [
    { designation: "Article d'exemple A", unit: "U", quantity: 4, unit_price_ttc: 12000, vat_rate_bp: rates[0] },
    { designation: "Article d'exemple B", unit: "KG", quantity: 2.5, unit_price_ttc: 4800, vat_rate_bp: rates[Math.min(1, rates.length - 1)] },
    { designation: "Prestation d'exemple C", unit: "U", quantity: 1, unit_price_ttc: 75000, vat_rate_bp: rates[0] },
  ];
  const t = computeInvoice(items.map((i) => ({ quantity: i.quantity, unitPriceTtc: i.unit_price_ttc, vatRateBp: i.vat_rate_bp })), company.rounding_mode);
  return {
    company, logo, background,
    invoice: {
      number: "EXEMPLE-0001", status: "validated", issue_date: new Date().toISOString().slice(0, 10), due_date: null,
      order_ref: "CMD-EXEMPLE", delivery_note_ref: "BL-EXEMPLE", payment_terms: company.default_payment_terms ?? "30 jours", payment_method: "virement", goods_nature: "Marchandises (exemple)",
      notes: "Aperçu du modèle : données fictives.", is_demo: true,
    },
    client: { name: "CLIENT EXEMPLE SARL", ice: "000000000000000", if_number: null, rc: null, address: "Adresse du client", city: "Ville" },
    lines: items.map((i, k) => ({ ...i, discount_bp: 0, total_ttc: t.lines[k].totalTtc })),
    totals: {
      total_ht: t.totalHt, total_vat: t.totalVat, total_ttc: t.totalTtc,
      vat_breakdown: t.byRate.map((g) => ({ vat_rate_bp: g.vatRateBp, base_ht: g.baseHt, vat: g.vat, ttc: g.ttc })),
    },
    template: { base, settings },
  };
}

export function TemplatesPage() {
  const { company, canManage, isAdmin, reload: reloadCompanies } = useActiveCompany();
  const list = useAsync(async () => must(await supabase.from("invoice_templates").select("*").eq("company_id", company.id).order("name")) as InvoiceTemplateRow[], [company.id]);
  const [editing, setEditing] = useState<InvoiceTemplateRow | null>(null);
  const [gallery, setGallery] = useState(false);
  const [toDelete, setToDelete] = useState<InvoiceTemplateRow | null>(null);
  const [toCopy, setToCopy] = useState<InvoiceTemplateRow | null>(null);
  const { companies } = useActiveCompany();
  const otherCompanies = companies.filter((c) => c.id !== company.id && (c.role === "admin" || c.role === "comptable"));

  const setDefault = async (t: InvoiceTemplateRow) => {
    try {
      must(await supabase.from("companies").update({ default_template_id: t.id }).eq("id", company.id));
      await reloadCompanies();
      toast.success(`« ${t.name} » est le modèle par défaut.`);
    } catch (err) { toast.error(errorMessage(err)); }
  };

  const create = async (base: TemplateBase, settings: Partial<TemplateSettings> = {}, label?: string) => {
    const preset = presetFor(base);
    const existing = new Set((list.data ?? []).map((t) => t.name));
    const root = label ?? preset.label;
    let name = root;
    for (let i = 2; existing.has(name); i++) name = `${root} ${i}`;
    try {
      const row = must(await supabase.from("invoice_templates").insert({ company_id: company.id, name, base, settings }).select().single()) as InvoiceTemplateRow;
      if (!company.default_template_id && isAdmin) await supabase.from("companies").update({ default_template_id: row.id }).eq("id", company.id).then(() => reloadCompanies());
      setGallery(false);
      await list.reload();
      setEditing(row);
    } catch (err) { toast.error(errorMessage(err)); }
  };

  if (list.error) return <ErrorBox message={list.error} onRetry={list.reload} />;

  return (
    <>
      <PageHeader
        title="Modèles de factures"
        description="15 modèles A4 personnalisables, dont FERCIM MAT, NOVASTRO BUSINESS et NORD BUSINESS JLE (couleurs, police, marges, logo, champs affichés, en-tête et pied de page). L'aperçu est le PDF réel."
        actions={canManage && (
          <>
            <Button variant="secondary" icon={<ImageUp className="size-4" />} onClick={() => create("entete", { layoutMode: "free" }, "Mon modèle importé")}>Importer mon modèle (PDF, JPG, PNG)</Button>
            <Button icon={<Plus className="size-4" />} onClick={() => setGallery(true)}>Nouveau modèle</Button>
          </>
        )}
      />

      {editing ? (
        <TemplateEditor key={editing.id} template={editing} canEdit={canManage} onClose={() => { setEditing(null); void list.reload(); }} />
      ) : list.loading && !list.data ? <Spinner /> : (list.data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            title="Aucun modèle enregistré"
            action={canManage && <Button onClick={() => setGallery(true)}>Choisir un modèle</Button>}
          >
            Sans modèle, vos factures utilisent le modèle Classic. Choisissez-en un pour l'adapter à votre identité.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.data!.map((t) => {
            const s = resolveSettings(t.base, t.settings);
            const isDefault = company.default_template_id === t.id;
            return (
              <Card key={t.id} className={cn(isDefault && "ring-2 ring-saffron-400")}>
                <div className="flex items-start gap-3 p-4">
                  <div className="h-16 w-12 shrink-0 rounded-sm border border-line bg-white p-1">
                    <div className="h-2 rounded-sm" style={{ backgroundColor: s.color }} />
                    <div className="mt-1 space-y-0.5">{[0, 1, 2, 3].map((i) => <div key={i} className="h-1 rounded-sm bg-line" />)}</div>
                    <div className="ml-auto mt-1 h-1.5 w-5 rounded-sm" style={{ backgroundColor: s.color }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="truncate font-medium">{t.name}</span>{isDefault && <Badge tone="warn">Par défaut</Badge>}</div>
                    <div className="text-xs text-muted">{presetFor(t.base).label} · {s.font} {s.fontSize} pt</div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>{canManage ? "Personnaliser" : "Aperçu"}</Button>
                      {isAdmin && !isDefault && <Button size="sm" variant="ghost" icon={<Star className="size-3.5" />} onClick={() => setDefault(t)}>Par défaut</Button>}
                      {otherCompanies.length > 0 && <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => setToCopy(t)}>Copier vers…</Button>}
                      {canManage && !isDefault && <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="size-3.5" />} onClick={() => setToDelete(t)} aria-label="Supprimer" />}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={gallery} onClose={() => setGallery(false)} title="Bibliothèque de modèles" wide>
        <GalleryPicker onPick={create} />
      </Dialog>

      <CopyTemplateDialog template={toCopy} companies={otherCompanies} onClose={() => setToCopy(null)} />

      <ConfirmDialog
        open={toDelete !== null}
        title="Supprimer le modèle"
        message={<>Supprimer « {toDelete?.name} » ? Les factures qui l'utilisaient prendront le modèle par défaut.</>}
        confirmLabel="Supprimer"
        danger
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          try { must(await supabase.from("invoice_templates").delete().eq("id", toDelete!.id)); setToDelete(null); void list.reload(); toast.success("Modèle supprimé."); }
          catch (err) { toast.error(errorMessage(err)); }
        }}
      />
    </>
  );
}

/** Copie un modèle (réglages + papier à en-tête) vers une autre entreprise dont on est administrateur ou comptable. */
function CopyTemplateDialog({ template, companies, onClose }: { template: InvoiceTemplateRow | null; companies: Company[]; onClose: () => void }) {
  const [target, setTarget] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (template) setTarget(new Set()); }, [template]);
  const copy = async () => {
    if (!template) return;
    setBusy(true);
    let ok = 0;
    for (const cid of target) {
      try {
        let bg: string | null = null;
        if (template.background_path) {
          const file = must(await supabase.storage.from("company-assets").download(template.background_path)) as Blob;
          const ext = template.background_path.split(".").pop() ?? "png";
          bg = `${cid}/templates/copie-${Date.now()}.${ext}`;
          must(await supabase.storage.from("company-assets").upload(bg, file, { contentType: file.type || "image/png", upsert: false }));
        }
        must(await supabase.from("invoice_templates").insert({ company_id: cid, name: template.name, base: template.base, settings: template.settings, background_path: bg }));
        ok++;
      } catch (err) {
        toast.error(`${companies.find((c) => c.id === cid)?.legal_name} : ${errorMessage(err)}`);
      }
    }
    setBusy(false);
    if (ok) { toast.success(`Modèle copié dans ${ok} entreprise(s). Chaque entreprise y imprime ses propres informations.`); onClose(); }
  };
  return (
    <Dialog open={template !== null} onClose={onClose} title={`Copier « ${template?.name ?? ""} » vers…`}
      footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button loading={busy} disabled={target.size === 0} onClick={copy}>Copier</Button></>}>
      <p className="mb-3 text-sm text-muted">Le style et le papier à en-tête sont copiés. Le nom, l'adresse, l'ICE et le logo imprimés seront ceux de chaque entreprise.</p>
      {companies.map((c) => (
        <Checkbox key={c.id} label={c.legal_name} checked={target.has(c.id)}
          onChange={(v) => setTarget((t) => { const n = new Set(t); if (v) n.add(c.id); else n.delete(c.id); return n; })} />
      ))}
    </Dialog>
  );
}

function GalleryPicker({ onPick }: { onPick: (b: TemplateBase) => void }) {
  const { company } = useActiveCompany();
  const [base, setBase] = useState<TemplateBase>("classic");
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => { void loadPdfAssets(company.logo_path, null).then((a) => setLogo(a.logo)); }, [company.logo_path]);
  const data = useMemo(() => sampleData(company, base, {}, logo, null), [company, base, logo]);
  return (
    <div className="grid gap-4 md:grid-cols-[220px_1fr]">
      <ul className="space-y-1">
        {TEMPLATE_PRESETS.map((p) => (
          <li key={p.base}>
            <button type="button" onClick={() => setBase(p.base)}
              className={cn("w-full rounded-md border px-3 py-2 text-left text-sm", base === p.base ? "border-ink-500 bg-ink-50" : "border-transparent hover:bg-canvas")}>
              <span className="flex items-center gap-2 font-medium">
                <span className="size-3 rounded-full" style={{ backgroundColor: (p.defaults.color as string) ?? DEFAULT_SETTINGS.color }} />
                {p.label}
              </span>
              <span className="block text-xs text-muted">{p.description}</span>
            </button>
          </li>
        ))}
      </ul>
      <div>
        <PdfPreview data={data} height={560} />
        <div className="mt-3 flex justify-end"><Button icon={<Check className="size-4" />} onClick={() => onPick(base)}>Utiliser « {presetFor(base).label} »</Button></div>
      </div>
    </div>
  );
}

const FONTS: { value: PdfFont; label: string }[] = [
  { value: "Helvetica", label: "Helvetica (sans empattement)" },
  { value: "Times-Roman", label: "Times (à empattements)" },
  { value: "Courier", label: "Courier (machine à écrire)" },
];

const TOGGLES: [keyof TemplateSettings, string][] = [
  ["showCompanyBlock", "Bloc entreprise en en-tête"],
  ["showCompanyIds", "Identifiants (ICE, IF, RC, TP) en en-tête"],
  ["showClientAddress", "Adresse du client"],
  ["showDueDate", "Date d'échéance"],
  ["showPaymentMethod", "Mode de règlement"],
  ["showPaymentTerms", "Conditions de paiement"],
  ["showGoodsNature", "Nature de la marchandise"],
  ["showDeliveryNote", "N° de bon de livraison"],
  ["showNotes", "Observations"],
  ["showVatBreakdown", "Tableau de ventilation de la TVA"],
  ["showLegalMentions", "Mentions légales"],
  ["showFooterIds", "Identifiants en pied de page"],
  ["showPageNumbers", "Numéros de page"],
  ["showSignatureBox", "Cadre cachet et signature"],
];

function TemplateEditor({ template, canEdit, onClose }: { template: InvoiceTemplateRow; canEdit: boolean; onClose: () => void }) {
  const { company, isAdmin, reload: reloadCompanies } = useActiveCompany();
  const [companyOpen, setCompanyOpen] = useState(false);
  const [name, setName] = useState(template.name);
  const [over, setOver] = useState<Partial<TemplateSettings>>(template.settings ?? {});
  const [bgPath, setBgPath] = useState(template.background_path);
  const [assets, setAssets] = useState<{ logo: string | null; background: string | null }>({ logo: null, background: null });
  const [busy, setBusy] = useState(false);
  const s = resolveSettings(template.base, over);
  const set = <K extends keyof TemplateSettings>(k: K, v: TemplateSettings[K]) => setOver((o) => ({ ...o, [k]: v }));
  const debounced = useDebounced(over, 400);

  useEffect(() => {
    void loadPdfAssets(company.logo_path, { ...template, background_path: bgPath }).then(setAssets);
  }, [company.logo_path, template, bgPath]);

  const data = useMemo(
    () => sampleData(company, template.base, debounced, assets.logo, assets.background),
    [company, template.base, debounced, assets],
  );

  const save = async () => {
    setBusy(true);
    try {
      must(await supabase.from("invoice_templates").update({ name: name.trim() || template.name, settings: over, background_path: bgPath }).eq("id", template.id));
      toast.success("Modèle enregistré.");
      onClose();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  const uploadBackground = async (file: File) => {
    setBusy(true);
    try {
      let blob: Blob = file;
      if (file.type === "application/pdf") {
        const { pdfFirstPageToPng } = await import("@/lib/pdfjs");
        blob = await pdfFirstPageToPng(file);
      } else if (!/^image\/(png|jpe?g)$/.test(file.type)) {
        throw new Error("Formats acceptés : PDF, PNG ou JPEG.");
      }
      if (blob.size > 8 * 1024 * 1024) throw new Error("Image trop lourde (8 Mo maximum).");
      const path = `${company.id}/templates/${template.id}-${Date.now()}.${blob.type === "image/jpeg" ? "jpg" : "png"}`;
      must(await supabase.storage.from("company-assets").upload(path, blob, { contentType: blob.type || "image/png", upsert: false }));
      forgetImage(bgPath);
      setBgPath(path);
      toast.success("Fond chargé. Enregistrez le modèle pour le conserver.");
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  const num = (k: keyof TemplateSettings, label: string, min: number, max: number, step = 1, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input type="number" min={min} max={max} step={step} value={String(s[k])} disabled={!canEdit}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) set(k, Math.min(max, Math.max(min, v)) as never); }} />
    </Field>
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card title={`${presetFor(template.base).label} — réglages`} actions={<Button size="sm" variant="ghost" onClick={onClose}>Fermer</Button>}>
          <div className="space-y-3 p-4">
            <Field label="Nom du modèle"><Input value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Couleur principale">
                <div className="flex gap-2">
                  <input type="color" value={s.color} disabled={!canEdit} onChange={(e) => set("color", e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-line" aria-label="Couleur" />
                  <Input value={s.color} disabled={!canEdit} onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && set("color", e.target.value)} />
                </div>
              </Field>
              {num("fontSize", "Taille du texte (pt)", 7, 12, 0.5)}
            </div>
            <Field label="Couleur secondaire" hint="Utilisée par certains modèles (ex. l'or de NORD BUSINESS).">
              <div className="flex gap-2">
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(s.accentColor) ? s.accentColor : "#d9a066"} disabled={!canEdit} onChange={(e) => set("accentColor", e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-line" aria-label="Couleur secondaire" />
                <Input value={s.accentColor} placeholder="Automatique" disabled={!canEdit} onChange={(e) => (e.target.value === "" || /^#[0-9a-f]{6}$/i.test(e.target.value)) && set("accentColor", e.target.value)} />
              </div>
            </Field>
            <Field label="Police">
              <Select value={s.font} disabled={!canEdit} onChange={(e) => set("font", e.target.value as PdfFont)}>
                {FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </Select>
            </Field>
            <Field label="Titre du document"><Input value={s.title} disabled={!canEdit} onChange={(e) => set("title", e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Position du logo">
                <Select value={s.logoPosition} disabled={!canEdit} onChange={(e) => set("logoPosition", e.target.value as TemplateSettings["logoPosition"])}>
                  <option value="left">À gauche</option><option value="right">À droite</option><option value="center">Centré</option><option value="none">Masqué</option>
                </Select>
              </Field>
              {num("logoHeightMm", "Hauteur du logo (mm)", 8, 40)}
            </div>
            {!company.logo_path && <p className="text-xs text-muted">Aucun logo : ajoutez-le dans Entreprises.</p>}
          </div>
        </Card>

        <Card title="Entreprise imprimée sur la facture">
          <div className="space-y-2 p-4 text-sm">
            <div className="font-medium">{company.legal_name}</div>
            <div className="text-muted">
              {[company.address, company.city].filter(Boolean).join(", ") || "Adresse non renseignée"}<br />
              {[company.ice && `ICE ${company.ice}`, company.if_number && `IF ${company.if_number}`, company.rc && `RC ${company.rc}`, company.tp && `TP ${company.tp}`].filter(Boolean).join(" · ") || "Identifiants non renseignés"}
            </div>
            <Button size="sm" variant="secondary" icon={<Building2 className="size-3.5" />} onClick={() => setCompanyOpen(true)}>
              {isAdmin ? "Modifier les informations de l'entreprise" : "Voir les informations"}
            </Button>
            <p className="text-xs text-muted">Vous avez plusieurs entreprises ? Choisissez-la dans le menu en haut à gauche : chaque entreprise a ses informations, son logo, ses modèles et sa numérotation. Pour réutiliser ce modèle ailleurs, utilisez « Copier vers… » dans la liste des modèles.</p>
          </div>
        </Card>

        <Dialog open={companyOpen} onClose={() => setCompanyOpen(false)} title={`Informations — ${company.legal_name}`} wide>
          <CompanyForm company={company} canEdit={isAdmin} onSaved={async () => {
            await reloadCompanies();
            setCompanyOpen(false);
            toast.success("Informations enregistrées : l'aperçu est mis à jour.");
          }} />
        </Dialog>

        <Card title="Style de la facture" actions={canEdit && <Button size="sm" variant="ghost" onClick={() => setOver((o) => ({ ...o, headerStyle: "", tableStyle: "", totalsStyle: "", tableHeader: "", columns: "ttc", lineNumbers: false, showUnit: true, rowDensity: "normal" }))}>Style d'origine</Button>}>
          <StyleOptions base={template.base} s={s} set={set} setMany={(p) => setOver((o) => ({ ...o, ...p }))} disabled={!canEdit} />
        </Card>

        <Card
          title="Disposition des blocs (glisser-déposer)"
          actions={canEdit && s.layoutMode === "free" && <Button size="sm" variant="ghost" onClick={() => set("positions", {})}>Positions par défaut</Button>}
        >
          <div className="space-y-3 p-4">
            <Checkbox
              label="Placer librement les blocs sur la page"
              hint="Idéal avec un papier à en-tête importé : placez le titre, le client et le tableau dans les zones libres de votre modèle."
              checked={s.layoutMode === "free"} disabled={!canEdit}
              onChange={(v) => set("layoutMode", v ? "free" : "standard")}
            />
            {s.layoutMode === "free" && (
              <FreeLayoutEditor
                background={assets.background}
                positions={resolvePositions(s)}
                disabled={!canEdit}
                hidden={s.showCompanyBlock || (assets.logo && s.logoPosition !== "none") ? [] : ["company"]}
                onChange={(p) => set("positions", p)}
              />
            )}
          </div>
        </Card>

        <Card title="Marges et espacement (mm)">
          <div className="grid grid-cols-2 gap-3 p-4">
            {num("marginTopMm", "Marge haute", 5, 40)}
            {num("marginBottomMm", "Marge basse", 5, 40)}
            {num("marginSideMm", "Marges latérales", 8, 30)}
            <div />
            {num("headerSpaceMm", "Zone d'en-tête réservée", 0, 80, 1, "Pour un papier à en-tête")}
            {num("footerSpaceMm", "Zone de pied réservée", 0, 50)}
          </div>
        </Card>

        <Card title="En-tête et pied de page">
          <div className="space-y-3 p-4">
            <Field label="Texte d'en-tête (toutes les pages)"><Input value={s.headerText} disabled={!canEdit} onChange={(e) => set("headerText", e.target.value)} /></Field>
            <Field label="Texte de pied de page"><Input value={s.footerText} disabled={!canEdit} onChange={(e) => set("footerText", e.target.value)} placeholder="Ex. Merci pour votre confiance" /></Field>
            {template.base === "entete" && (
              <div className="rounded-md border border-line bg-canvas p-3">
                <div className="mb-2 text-sm font-medium">Papier à en-tête (fond de page)</div>
                <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm text-ink-700 hover:underline", !canEdit && "pointer-events-none opacity-50")}>
                  <ImageUp className="size-4" /> {bgPath ? "Remplacer le fond" : "Importer (PDF, PNG ou JPEG)"}
                  <input type="file" accept="application/pdf,image/png,image/jpeg" className="sr-only"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadBackground(f); e.target.value = ""; }} />
                </label>
                {bgPath && <button type="button" className="ml-3 text-sm text-danger hover:underline" onClick={() => setBgPath(null)}>Retirer</button>}
                <div className="mt-3">{num("backgroundOpacity", "Opacité du fond", 0.1, 1, 0.05)}</div>
              </div>
            )}
          </div>
        </Card>

        <Card title="Champs affichés">
          <div className="p-4">
            {TOGGLES.map(([k, label]) => (
              <Checkbox key={k} label={label} checked={Boolean(s[k])} disabled={!canEdit} onChange={(v) => set(k, v as never)} />
            ))}
            <p className="mt-2 text-xs text-muted">Téléphone, e-mail et coordonnées bancaires : réglables dans la fiche de l'entreprise.</p>
          </div>
        </Card>

        {canEdit && (
          <div className="flex gap-2">
            <Button loading={busy} onClick={save}>Enregistrer le modèle</Button>
            <Button variant="ghost" onClick={() => setOver({})}>Revenir aux réglages d'origine</Button>
          </div>
        )}
      </div>

      <div className="xl:sticky xl:top-4 xl:self-start">
        <PdfPreview data={data} height={900} />
      </div>
    </div>
  );
}
