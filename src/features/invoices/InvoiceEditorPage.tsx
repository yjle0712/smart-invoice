import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Eye, Lock, Plus, Save, ShieldCheck, Trash2, Unlock } from "lucide-react";
import { supabase, must, errorMessage } from "@/lib/supabase";
import { useActiveCompany } from "@/lib/session";
import { useAsync } from "@/lib/hooks";
import type { Invoice, InvoiceLine, InvoiceTemplateRow, NumberSeries, Party, Product } from "@/lib/types";
import { formatMoney, formatRate, parseMoney, parseQuantity } from "@/domain/money";
import { computeInvoice, type LineInput } from "@/domain/vat";
import { addDaysIso, todayIso } from "@/domain/dates";
import { amountToFrenchWords } from "@/domain/words";
import { formatInvoiceNumber } from "@/domain/numbering";
import { PartyDialog } from "@/features/parties/PartiesPage";
import { presetFor } from "@/pdf/templates";
import { loadPdfAssets, partyToSnapshot } from "@/pdf/export";
import type { InvoicePdfData } from "@/pdf/InvoiceDocument";
import { PAYMENT_METHOD_PDF } from "@/pdf/paymentMethods";
import { PdfPreview } from "@/pdf/PdfPreview";
import { Badge, Button, Card, Dialog, ErrorBox, Field, Input, PageHeader, Select, Spinner, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

interface EditLine {
  key: string;
  product_id: string | null;
  designation: string;
  unit: string;
  quantity: string;
  price: string; // dirhams, saisie libre (« 95,00 »)
  vat_rate_bp: number;
  discount: string; // pourcentage
  catalogPrice: number | null;
  override: boolean;
  reason: string;
}

const toInputMoney = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const newKey = () => Math.random().toString(36).slice(2);

function lineFromProduct(p: Product): EditLine {
  return {
    key: newKey(), product_id: p.id, designation: p.designation, unit: p.unit, quantity: "1",
    price: toInputMoney(p.unit_price_ttc), vat_rate_bp: p.vat_rate_bp, discount: "", catalogPrice: p.unit_price_ttc,
    override: false, reason: "",
  };
}

export function InvoiceEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { company, canManage } = useActiveCompany();

  const refs = useAsync(async () => {
    const [clients, products, templates, series] = await Promise.all([
      supabase.from("parties").select("*").eq("company_id", company.id).eq("kind", "client").order("name"),
      supabase.from("products").select("*").eq("company_id", company.id).eq("active", true).order("designation"),
      supabase.from("invoice_templates").select("*").eq("company_id", company.id).order("name"),
      supabase.from("number_series").select("*").eq("company_id", company.id).order("name"),
    ]);
    return {
      clients: must(clients) as Party[],
      products: must(products) as Product[],
      templates: must(templates) as InvoiceTemplateRow[],
      series: must(series) as NumberSeries[],
    };
  }, [company.id]);

  const existing = useAsync(async () => {
    if (!id) return null;
    const inv = must(await supabase.from("invoices").select("*").eq("id", id).single()) as Invoice;
    const lines = must(await supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("position")) as InvoiceLine[];
    return { inv, lines };
  }, [id]);

  // ----- État du formulaire -----
  const [clientId, setClientId] = useState("");
  const [issueDate, setIssueDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState("");
  const [dueTouched, setDueTouched] = useState(false);
  const [orderRef, setOrderRef] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [paymentTerms, setPaymentTerms] = useState(company.default_payment_terms ?? "");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [goodsNature, setGoodsNature] = useState("");
  const [notes, setNotes] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const [lines, setLines] = useState<EditLine[]>([]);
  const [picker, setPicker] = useState("");
  const [busy, setBusy] = useState<"save" | "validate" | null>(null);
  const [newClient, setNewClient] = useState(false);
  const [preview, setPreview] = useState<InvoicePdfData | null>(null);
  const [loaded, setLoaded] = useState(!id);

  useEffect(() => {
    const e = existing.data;
    if (!e) return;
    if (e.inv.status !== "draft") {
      toast.info("Cette facture est validée : elle ne peut plus être modifiée.");
      navigate(`/factures/${e.inv.id}`, { replace: true });
      return;
    }
    setClientId(e.inv.client_id ?? "");
    setIssueDate(e.inv.issue_date);
    setDueDate(e.inv.due_date ?? "");
    setDueTouched(Boolean(e.inv.due_date));
    setOrderRef(e.inv.order_ref ?? "");
    setDeliveryNote(e.inv.delivery_note_ref ?? "");
    setPaymentTerms(e.inv.payment_terms ?? "");
    setPaymentMethod(e.inv.payment_method ?? "");
    setGoodsNature(e.inv.goods_nature ?? "");
    setNotes(e.inv.notes ?? "");
    setTemplateId(e.inv.template_id ?? "");
    setSeriesId(e.inv.series_id ?? "");
    setLines(e.lines.map((l) => ({
      key: l.id, product_id: l.product_id, designation: l.designation, unit: l.unit ?? "U", quantity: String(Number(l.quantity)),
      price: toInputMoney(l.unit_price_ttc), vat_rate_bp: l.vat_rate_bp, discount: l.discount_bp ? String(l.discount_bp / 100) : "",
      catalogPrice: l.catalog_price_ttc, override: l.catalog_price_ttc !== null && l.unit_price_ttc !== l.catalog_price_ttc,
      reason: l.price_override_reason ?? "",
    })));
    setLoaded(true);
  }, [existing.data, navigate]);

  // Échéance par défaut = date + délai de l'entreprise (tant que l'utilisateur ne l'a pas modifiée)
  useEffect(() => {
    if (!dueTouched && issueDate) setDueDate(addDaysIso(issueDate, company.default_due_days));
  }, [issueDate, dueTouched, company.default_due_days]);

  const clients = refs.data?.clients ?? [];
  const products = refs.data?.products ?? [];
  const client = clients.find((c) => c.id === clientId) ?? null;

  const onClientChange = (cid: string) => {
    setClientId(cid);
    const c = clients.find((x) => x.id === cid);
    if (c?.payment_terms) setPaymentTerms(c.payment_terms);
    // Numérotation propre au client
    setSeriesId(c?.default_series_id ?? "");
  };

  // ----- Calculs -----
  const parsed = useMemo(() => {
    const errors: string[] = [];
    const inputs: (LineInput | null)[] = lines.map((l, i) => {
      const q = parseQuantity(l.quantity);
      const p = parseMoney(l.price);
      const d = l.discount.trim() ? parseQuantity(l.discount) : 0;
      if (!l.designation.trim()) errors.push(`Ligne ${i + 1} : désignation manquante.`);
      if (q === null || q <= 0) { errors.push(`Ligne ${i + 1} : quantité invalide.`); return null; }
      if (p === null || p < 0) { errors.push(`Ligne ${i + 1} : prix invalide.`); return null; }
      if (d === null || d < 0 || d > 100) { errors.push(`Ligne ${i + 1} : remise invalide.`); return null; }
      if (l.product_id && l.catalogPrice !== null && p !== l.catalogPrice && !l.reason.trim()) {
        errors.push(`Ligne ${i + 1} : motif obligatoire pour un prix différent du catalogue.`);
      }
      return { quantity: q, unitPriceTtc: p, vatRateBp: l.vat_rate_bp, discountBp: Math.round((d ?? 0) * 100) };
    });
    const valid = inputs.filter((x): x is LineInput => x !== null);
    const totals = computeInvoice(valid, company.rounding_mode);
    return { errors, inputs, totals };
  }, [lines, company.rounding_mode]);

  const updateLine = (key: string, patch: Partial<EditLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const addProduct = (pid: string) => {
    const p = products.find((x) => x.id === pid);
    if (!p) return;
    setLines((ls) => [...ls, lineFromProduct(p)]);
    setPicker("");
  };

  const addFreeLine = () =>
    setLines((ls) => [...ls, {
      key: newKey(), product_id: null, designation: "", unit: "U", quantity: "1", price: "",
      vat_rate_bp: company.default_vat_rate_bp, discount: "", catalogPrice: null, override: true, reason: "",
    }]);

  const move = (idx: number, dir: -1 | 1) =>
    setLines((ls) => {
      const n = [...ls];
      const j = idx + dir;
      if (j < 0 || j >= n.length) return ls;
      [n[idx], n[j]] = [n[j], n[idx]];
      return n;
    });

  // ----- Enregistrement -----
  const blocking = [
    ...(lines.length === 0 ? ["Ajoutez au moins une ligne."] : []),
    ...parsed.errors,
    ...(dueDate && issueDate && dueDate < issueDate ? ["L'échéance doit être postérieure à la date de facture."] : []),
  ];
  const validationWarnings = [
    ...(!client ? ["Choisissez un client."] : []),
    ...(client && company.require_client_ice && !client.ice ? [`L'ICE du client « ${client.name} » est obligatoire pour valider.`] : []),
    ...(client?.archived ? ["Ce client est archivé."] : []),
  ];

  const payload = () => ({
    header: {
      series_id: seriesId, issue_date: issueDate, due_date: dueDate, client_id: clientId, order_ref: orderRef, delivery_note_ref: deliveryNote,
      payment_terms: paymentTerms, payment_method: paymentMethod, goods_nature: goodsNature, notes, template_id: templateId,
    },
    lines: lines.map((l, i) => {
      const inp = parsed.inputs[i]!;
      return {
        product_id: l.product_id ?? "", designation: l.designation.trim(), unit: l.unit, quantity: inp.quantity,
        unit_price_ttc: inp.unitPriceTtc, vat_rate_bp: l.vat_rate_bp, discount_bp: inp.discountBp ?? 0,
        price_override_reason: l.product_id && inp.unitPriceTtc !== l.catalogPrice ? l.reason.trim() : "",
      };
    }),
  });

  const save = async (andValidate: boolean) => {
    if (blocking.length) return toast.error(blocking[0]);
    if (andValidate && validationWarnings.length) return toast.error(validationWarnings[0]);
    setBusy(andValidate ? "validate" : "save");
    try {
      const p = payload();
      const savedId = must(await supabase.rpc("save_invoice_draft", {
        p_invoice: id ?? null, p_company: company.id, p_header: p.header, p_lines: p.lines,
      })) as string;
      if (andValidate) {
        try {
          const number = must(await supabase.rpc("validate_invoice", { p_invoice: savedId })) as string;
          toast.success(`Facture ${number} validée.`);
        } catch (err) {
          toast.error(`Brouillon enregistré, mais validation refusée : ${errorMessage(err)}`);
          navigate(`/factures/${savedId}/modifier`, { replace: true });
          return;
        }
      } else {
        toast.success("Brouillon enregistré.");
      }
      navigate(`/factures/${savedId}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const openPreview = async () => {
    if (blocking.length) return toast.error(blocking[0]);
    const tpl = refs.data?.templates.find((t) => t.id === (templateId || company.default_template_id)) ?? null;
    const { logo, background } = await loadPdfAssets(company.logo_path, tpl);
    const t = parsed.totals;
    setPreview({
      company, logo, background,
      invoice: {
        number: null, status: "draft", issue_date: issueDate, due_date: dueDate || null, order_ref: orderRef || null, delivery_note_ref: deliveryNote || null,
        payment_terms: paymentTerms || null, payment_method: paymentMethod || null, goods_nature: goodsNature || null, notes: notes || null, is_demo: company.is_demo,
      },
      client: partyToSnapshot(client),
      lines: lines.map((l, i) => ({
        designation: l.designation, unit: l.unit, quantity: t.lines[i].quantity, unit_price_ttc: t.lines[i].unitPriceTtc,
        discount_bp: t.lines[i].discountBp ?? 0, total_ttc: t.lines[i].totalTtc, vat_rate_bp: l.vat_rate_bp,
      })),
      totals: {
        total_ht: t.totalHt, total_vat: t.totalVat, total_ttc: t.totalTtc,
        vat_breakdown: t.byRate.map((g) => ({ vat_rate_bp: g.vatRateBp, base_ht: g.baseHt, vat: g.vat, ttc: g.ttc })),
      },
      template: { base: tpl?.base ?? "classic", settings: tpl?.settings ?? null },
    });
  };

  if (refs.error) return <ErrorBox message={refs.error} onRetry={refs.reload} />;
  if (existing.error) return <ErrorBox message={existing.error} onRetry={existing.reload} />;
  if (refs.loading || !loaded) return <Spinner />;

  const series = refs.data!.series;
  const activeSeries = series.find((s) => s.id === seriesId) ?? series.find((s) => s.is_default);
  const nextNumberHint = activeSeries
    ? formatInvoiceNumber(activeSeries.format, activeSeries.reset_yearly && activeSeries.current_year !== null && activeSeries.current_year !== Number(issueDate.slice(0, 4)) ? 1 : activeSeries.next_seq, issueDate)
    : null;
  const t = parsed.totals;
  const multiRate = t.byRate.length > 1;

  return (
    <>
      <PageHeader
        title={id ? "Modifier le brouillon" : "Nouvelle facture"}
        description={
          <>Le numéro est attribué à la validation{nextNumberHint && <> (prochain numéro probable : <span className="num font-medium">{nextNumberHint}</span>)</>}. Une facture validée ne peut plus être modifiée.</>
        }
        actions={
          <>
            <Link to={id ? `/factures/${id}` : "/factures"}><Button variant="ghost" icon={<ArrowLeft className="size-4" />}>Retour</Button></Link>
            <Button variant="secondary" icon={<Eye className="size-4" />} onClick={openPreview}>Aperçu PDF</Button>
            <Button variant="secondary" icon={<Save className="size-4" />} loading={busy === "save"} disabled={busy !== null} onClick={() => save(false)}>Enregistrer le brouillon</Button>
            {canManage && (
              <Button variant="accent" icon={<ShieldCheck className="size-4" />} loading={busy === "validate"} disabled={busy !== null} onClick={() => save(true)}>
                Enregistrer et valider
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card title="Client et informations">
            <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Client" required className="sm:col-span-2" error={client && company.require_client_ice && !client.ice ? "ICE manquant : obligatoire pour valider." : null}>
                <div className="flex gap-2">
                  <Select value={clientId} onChange={(e) => onClientChange(e.target.value)}>
                    <option value="">— Choisir un client —</option>
                    {clients.filter((c) => !c.archived || c.id === clientId).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}{c.ice ? ` — ICE ${c.ice}` : ""}{c.archived ? " (archivé)" : ""}</option>
                    ))}
                  </Select>
                  <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setNewClient(true)} title="Nouveau client" aria-label="Nouveau client" />
                </div>
              </Field>
              <Field label="Modèle de facture">
                <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">Modèle par défaut de l'entreprise</option>
                  {refs.data!.templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name} ({presetFor(tp.base).label})</option>)}
                </Select>
              </Field>
              <Field label="Date de facture" required>
                <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </Field>
              <Field label="Date d'échéance" hint={`Par défaut : + ${company.default_due_days} jours`}>
                <Input type="date" value={dueDate} min={issueDate} onChange={(e) => { setDueDate(e.target.value); setDueTouched(true); }} />
              </Field>
              <Field label="Série de numérotation">
                <Select value={seriesId} onChange={(e) => setSeriesId(e.target.value)}>
                  <option value="">Série par défaut</option>
                  {series.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.format})</option>)}
                </Select>
              </Field>
              <Field label="Mode de règlement" hint="Virement, chèque, espèces… imprimé sur la facture.">
                <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="">— Non précisé —</option>
                  {Object.entries(PAYMENT_METHOD_PDF).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Conditions de paiement">
                <Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="Ex. 30 jours, à réception" />
              </Field>
              <Field label="Nature de la marchandise">
                <Input value={goodsNature} onChange={(e) => setGoodsNature(e.target.value)} placeholder="Ex. Produits alimentaires" />
              </Field>
              <Field label="Référence de commande" hint="Une commande ne peut être facturée qu'une fois.">
                <Input value={orderRef} onChange={(e) => setOrderRef(e.target.value)} />
              </Field>
              <Field label="N° Bon de livraison" hint="Saisi à la main (ex. BL-0125). Le BL créé depuis cette facture prendra ce numéro ; vide = numéro automatique.">
                <Input value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} placeholder="BL-…" />
              </Field>
              <Field label="Observations" className="sm:col-span-2">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-14" />
              </Field>
            </div>
          </Card>

          <Card
            title="Articles"
            actions={<span className="text-xs text-muted">Prix du catalogue verrouillés{canManage ? " — cliquez sur le cadenas pour une dérogation motivée" : ""}</span>}
          >
            <div className="flex flex-wrap gap-2 border-b border-line p-3">
              <Select className="min-w-64 flex-1" value={picker} onChange={(e) => addProduct(e.target.value)} aria-label="Ajouter un produit du catalogue">
                <option value="">+ Ajouter un produit du catalogue…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.reference} — {p.designation} — {formatMoney(p.unit_price_ttc)} DH TTC ({formatRate(p.vat_rate_bp)})</option>
                ))}
              </Select>
              <Button variant="secondary" icon={<Plus className="size-4" />} onClick={addFreeLine}>Ligne libre</Button>
            </div>

            {lines.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted">
                Aucune ligne. Ajoutez un produit du catalogue{products.length === 0 && <> (catalogue vide : <Link to="/catalogue" className="underline">créez vos produits</Link>)</>}.
              </p>
            ) : (
              <div className="divide-y divide-line">
                {lines.map((l, i) => {
                  const res = parsed.inputs[i] ? t.lines[parsed.inputs.slice(0, i).filter(Boolean).length] : null;
                  const priceLocked = l.product_id !== null && !l.override;
                  const priceDiffers = l.product_id !== null && l.catalogPrice !== null && parseMoney(l.price) !== l.catalogPrice;
                  return (
                    <div key={l.key} className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-12 sm:items-start">
                      <div className="col-span-2 sm:col-span-5">
                        <Input aria-label="Désignation" value={l.designation} readOnly={l.product_id !== null}
                          className={cn(l.product_id && "bg-canvas")}
                          onChange={(e) => updateLine(l.key, { designation: e.target.value })} placeholder="Désignation" />
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          {l.product_id ? <Badge>Catalogue</Badge> : <Badge tone="warn">Hors catalogue</Badge>}
                          {l.product_id ? <span>TVA {formatRate(l.vat_rate_bp)}</span> : (
                            <select aria-label="Taux de TVA" value={l.vat_rate_bp} onChange={(e) => updateLine(l.key, { vat_rate_bp: Number(e.target.value) })}
                              className="rounded border border-line bg-white px-1 py-0.5">
                              {company.vat_rates_bp.map((r) => <option key={r} value={r}>TVA {formatRate(r)}</option>)}
                            </select>
                          )}
                        </div>
                      </div>
                      <Field label="Quantité" className="sm:col-span-2">
                        <Input inputMode="decimal" className="num text-right" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} />
                      </Field>
                      <Field label="Prix unit. TTC" className="sm:col-span-2">
                        <div className="relative">
                          <Input inputMode="decimal" className={cn("num pr-8 text-right", priceLocked && "bg-canvas")} readOnly={priceLocked}
                            value={l.price} onChange={(e) => updateLine(l.key, { price: e.target.value })} />
                          {l.product_id && canManage && (
                            <button type="button" className="absolute right-1.5 top-2 text-muted hover:text-ink-700"
                              title={l.override ? "Revenir au prix du catalogue" : "Déroger au prix du catalogue (motif obligatoire)"}
                              aria-label={l.override ? "Revenir au prix du catalogue" : "Modifier le prix"}
                              onClick={() => updateLine(l.key, l.override
                                ? { override: false, price: toInputMoney(l.catalogPrice ?? 0), reason: "" }
                                : { override: true })}>
                              {l.override ? <Unlock className="size-4" /> : <Lock className="size-4" />}
                            </button>
                          )}
                        </div>
                      </Field>
                      {company.allow_discounts && canManage ? (
                        <Field label="Remise" className="sm:col-span-1">
                          <Input inputMode="decimal" className="num text-right" placeholder="%" value={l.discount} onChange={(e) => updateLine(l.key, { discount: e.target.value })} />
                        </Field>
                      ) : <div className="hidden sm:col-span-1 sm:block" />}
                      <div className="sm:col-span-2">
                        <div className="text-[13px] font-medium">Total TTC</div>
                        <div className="num flex h-9 items-center justify-end font-semibold">{res ? formatMoney(res.totalTtc) : "—"}</div>
                        <div className="flex justify-end gap-0.5">
                          <button type="button" className="rounded px-1 text-xs text-muted hover:bg-canvas" onClick={() => move(i, -1)} aria-label="Monter">↑</button>
                          <button type="button" className="rounded px-1 text-xs text-muted hover:bg-canvas" onClick={() => move(i, 1)} aria-label="Descendre">↓</button>
                          <button type="button" className="rounded p-1 text-danger hover:bg-danger/5" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Supprimer la ligne">
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                      {priceDiffers && (
                        <Field label={`Motif de la dérogation (prix catalogue ${formatMoney(l.catalogPrice ?? 0)} DH)`} className="col-span-2 sm:col-span-12" required>
                          <Input value={l.reason} onChange={(e) => updateLine(l.key, { reason: e.target.value })} placeholder="Enregistré sur la ligne et dans l'historique" />
                        </Field>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Card title="Totaux">
            <dl className="space-y-1.5 p-4 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Montant HT</dt><dd className="num">{formatMoney(t.totalHt)}</dd></div>
              {t.byRate.map((g) => (
                <div key={g.vatRateBp} className="flex justify-between">
                  <dt className="text-muted">{g.vatRateBp === 0 ? "Exonéré (base)" : `TVA ${formatRate(g.vatRateBp)}`}</dt>
                  <dd className="num">{g.vatRateBp === 0 ? formatMoney(g.baseHt) : formatMoney(g.vat)}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-line pt-2 text-base font-semibold text-ink-900">
                <dt>Total TTC</dt><dd className="num">{formatMoney(t.totalTtc)} {company.currency_label}</dd>
              </div>
              {multiRate && <p className="pt-1 text-xs text-muted">Ventilation par taux : HT = TTC ÷ (1 + taux), TVA = TTC − HT, arrondi {company.rounding_mode === "per_rate" ? "par taux" : "par ligne"}.</p>}
              <p className="pt-2 text-xs font-medium uppercase leading-snug text-ink-800">{amountToFrenchWords(t.totalTtc)}</p>
            </dl>
          </Card>
          {(blocking.length > 0 || validationWarnings.length > 0) && (
            <Card title="À corriger">
              <ul className="space-y-1 p-4 text-sm">
                {blocking.map((b) => <li key={b} className="text-danger">• {b}</li>)}
                {validationWarnings.map((w) => <li key={w} className="text-saffron-700">• {w}</li>)}
              </ul>
            </Card>
          )}
          {!canManage && (
            <p className="rounded-md border border-line bg-white p-3 text-xs text-muted">
              Votre rôle permet de préparer des brouillons. La validation (attribution du numéro) est faite par un administrateur ou un comptable.
            </p>
          )}
        </div>
      </div>

      <PartyDialog
        kind="client"
        party={null}
        open={newClient}
        onClose={() => setNewClient(false)}
        onSaved={async (p) => { setNewClient(false); await refs.reload(); onClientChange(p.id); setClientId(p.id); }}
      />

      <Dialog open={preview !== null} onClose={() => setPreview(null)} title="Aperçu (brouillon non enregistré)" wide>
        <PdfPreview data={preview} height={720} />
      </Dialog>
    </>
  );
}
