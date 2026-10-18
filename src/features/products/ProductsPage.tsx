import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { saveAs } from "file-saver";
import { Download, History, Plus, Search, Upload } from "lucide-react";
import { supabase, must, errorMessage } from "@/lib/supabase";
import { useActiveCompany } from "@/lib/session";
import { ImportFromCompanyButton, ShareCheckbox, getSharePref, shareToOthers, useOtherCompanies } from "@/features/companies/sharing";
import { useAsync, useDebounced } from "@/lib/hooks";
import type { Category, PriceHistory, Product } from "@/lib/types";
import { formatMoney, formatRate, parseMoney } from "@/domain/money";
import { buildWorkbook, dh, MONEY_FMT, readFirstSheet } from "@/lib/excel";
import { safeFileName } from "@/lib/utils";
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, Dialog, EmptyState, ErrorBox, Field, Input,
  PageHeader, Select, Spinner, Table,
} from "@/components/ui";

export function ProductsPage() {
  const { company, canManage } = useActiveCompany();
  const [q, setQ] = useState("");
  const query = useDebounced(q);
  const [categoryId, setCategoryId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [archiving, setArchiving] = useState<Product | null>(null);
  const [historyOf, setHistoryOf] = useState<Product | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);

  const cats = useAsync(async () => must(await supabase.from("product_categories").select("*").eq("company_id", company.id).order("name")) as Category[], [company.id]);
  const list = useAsync(async () => {
    let req = supabase.from("products").select("*").eq("company_id", company.id).order("reference");
    if (!showArchived) req = req.eq("active", true);
    if (categoryId) req = req.eq("category_id", categoryId);
    if (query.trim()) {
      const s = query.trim().replace(/[%,()]/g, " ");
      req = req.or(`reference.ilike.%${s}%,designation.ilike.%${s}%`);
    }
    return must(await req.limit(1000)) as Product[];
  }, [company.id, showArchived, categoryId, query]);

  const catName = useMemo(() => new Map((cats.data ?? []).map((c) => [c.id, c.name])), [cats.data]);

  const exportXlsx = () => {
    const blob = buildWorkbook([{
      name: "Catalogue",
      rows: list.data ?? [],
      columns: [
        { header: "reference", value: (p: Product) => p.reference, width: 16 },
        { header: "designation", value: (p: Product) => p.designation, width: 36 },
        { header: "categorie", value: (p: Product) => (p.category_id ? catName.get(p.category_id) : null), width: 16 },
        { header: "unite", value: (p: Product) => p.unit },
        { header: "prix_unitaire_ttc", value: (p: Product) => dh(p.unit_price_ttc), format: MONEY_FMT, width: 16 },
        { header: "taux_tva", value: (p: Product) => p.vat_rate_bp / 100 },
        { header: "statut", value: (p: Product) => (p.active ? "actif" : "archivé") },
      ],
    }]);
    saveAs(blob, safeFileName("Catalogue", company.legal_name) + ".xlsx");
  };

  return (
    <>
      <PageHeader
        title="Catalogue produits"
        description="Les prix du catalogue ne sont jamais modifiés par la facturation. Toute modification de prix est tracée."
        actions={
          <>
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={exportXlsx} disabled={!list.data?.length}>Exporter</Button>
            {canManage && <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => setImportOpen(true)}>Importer</Button>}
            {canManage && <ImportFromCompanyButton what="products" onDone={() => { void cats.reload(); void list.reload(); }} />}
            {canManage && <Button variant="secondary" onClick={() => setCatOpen(true)}>Catégories</Button>}
            {canManage && <Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Nouveau produit</Button>}
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
            <Input className="pl-8" placeholder="Rechercher : référence, désignation" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-48" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Catégorie">
            <option value="">Toutes les catégories</option>
            {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Checkbox label="Afficher les archivés" checked={showArchived} onChange={setShowArchived} />
        </div>
        {list.loading && !list.data ? <Spinner /> : list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> :
          list.data?.length === 0 ? (
            <EmptyState title={query || categoryId ? "Aucun résultat" : "Catalogue vide"}>
              {canManage ? "Ajoutez vos produits un par un ou importez un fichier Excel." : "Un administrateur ou un comptable doit renseigner le catalogue."}
            </EmptyState>
          ) : (
            <Table>
              <thead><tr><th>Référence</th><th>Désignation</th><th>Catégorie</th><th>Unité</th><th className="text-right">Prix unit. TTC</th><th className="text-right">TVA</th><th /></tr></thead>
              <tbody>
                {list.data!.map((p) => (
                  <tr key={p.id} className={p.active ? "" : "text-muted"}>
                    <td className="font-medium">{p.reference}</td>
                    <td>{p.designation}{!p.active && <span className="ml-2"><Badge>Archivé</Badge></span>}</td>
                    <td>{p.category_id ? catName.get(p.category_id) : ""}</td>
                    <td>{p.unit}</td>
                    <td className="num text-right">{formatMoney(p.unit_price_ttc)}</td>
                    <td className="num text-right">{formatRate(p.vat_rate_bp)}</td>
                    <td className="whitespace-nowrap text-right">
                      <Button size="sm" variant="ghost" icon={<History className="size-3.5" />} onClick={() => setHistoryOf(p)} aria-label="Historique des prix" />
                      {canManage && <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Modifier</Button>}
                      {canManage && <Button size="sm" variant="ghost" onClick={() => setArchiving(p)}>{p.active ? "Archiver" : "Restaurer"}</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
      </Card>

      <ProductDialog
        product={editing === "new" ? null : editing}
        open={editing !== null}
        categories={cats.data ?? []}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); void list.reload(); }}
      />
      <ConfirmDialog
        open={Boolean(archiving)}
        title={archiving?.active ? "Archiver le produit" : "Restaurer le produit"}
        message={archiving?.active
          ? `« ${archiving?.designation} » ne sera plus proposé sur les nouvelles factures. Les factures existantes ne changent pas.`
          : `« ${archiving?.designation} » sera de nouveau proposé.`}
        confirmLabel={archiving?.active ? "Archiver" : "Restaurer"}
        onClose={() => setArchiving(null)}
        onConfirm={async () => {
          try {
            must(await supabase.from("products").update({ active: !archiving!.active }).eq("id", archiving!.id));
            setArchiving(null);
            void list.reload();
          } catch (err) { toast.error(errorMessage(err)); }
        }}
      />
      <PriceHistoryDialog product={historyOf} onClose={() => setHistoryOf(null)} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} categories={cats.data ?? []} onDone={() => { void cats.reload(); void list.reload(); }} />
      <CategoriesDialog open={catOpen} onClose={() => setCatOpen(false)} categories={cats.data ?? []} onChange={() => cats.reload()} />
    </>
  );
}

function ProductDialog({
  product, open, categories, onClose, onSaved,
}: { product: Product | null; open: boolean; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const { company } = useActiveCompany();
  const [f, setF] = useState({ reference: "", designation: "", category_id: "", unit: "U", price: "", rate: String(company.default_vat_rate_bp) });
  const [busy, setBusy] = useState(false);
  const others = useOtherCompanies();
  const [share, setShare] = useState(getSharePref());
  useEffect(() => {
    if (!open) return;
    setF(product ? {
      reference: product.reference, designation: product.designation, category_id: product.category_id ?? "", unit: product.unit,
      price: (product.unit_price_ttc / 100).toFixed(2).replace(".", ","), rate: String(product.vat_rate_bp),
    } : { reference: "", designation: "", category_id: "", unit: "U", price: "", rate: String(company.default_vat_rate_bp) });
  }, [open, product, company.default_vat_rate_bp]);

  const price = parseMoney(f.price);
  const priceChanged = product && price !== null && price !== product.unit_price_ttc;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.reference.trim() || !f.designation.trim()) return toast.error("Référence et désignation obligatoires.");
    if (price === null || price < 0) return toast.error("Prix unitaire TTC invalide.");
    setBusy(true);
    try {
      const row = {
        reference: f.reference.trim(), designation: f.designation.trim(), category_id: f.category_id || null,
        unit: f.unit.trim() || "U", unit_price_ttc: price, vat_rate_bp: Number(f.rate),
      };
      if (product) must(await supabase.from("products").update(row).eq("id", product.id));
      else {
        const created = must(await supabase.from("products").insert({ ...row, company_id: company.id }).select("id").single()) as { id: string };
        if (share && others.length) {
          const n = await shareToOthers(company.id, others, { productIds: [created.id] });
          if (n) toast.success(`Ajouté aussi dans ${n} autre(s) entreprise(s).`);
        }
      }
      toast.success(product ? "Produit enregistré." : "Produit ajouté.");
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={product ? `Modifier ${product.reference}` : "Nouveau produit"}
      footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button type="submit" form="product-form" loading={busy}>Enregistrer</Button></>}
    >
      <form id="product-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Référence" required><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label="Unité"><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="U, KG, L, M²…" /></Field>
        <Field label="Désignation" required className="sm:col-span-2"><Input value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} /></Field>
        <Field label="Catégorie">
          <Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
            <option value="">Sans catégorie</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Taux de TVA" required>
          <Select value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })}>
            {company.vat_rates_bp.map((r) => <option key={r} value={r}>{r === 0 ? "0 % (exonéré)" : formatRate(r)}</option>)}
          </Select>
        </Field>
        <Field label="Prix unitaire TTC (DH)" required className="sm:col-span-2"
          hint={priceChanged ? `Modification de prix : ${formatMoney(product!.unit_price_ttc)} → ${formatMoney(price!)}. Elle sera enregistrée dans l'historique et ne change pas les factures existantes.` : undefined}>
          <Input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="0,00" />
        </Field>
        {!product && <div className="sm:col-span-2"><ShareCheckbox checked={share} onChange={setShare} count={others.length} /></div>}
      </form>
    </Dialog>
  );
}

function PriceHistoryDialog({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const h = useAsync(async () => {
    if (!product) return [] as PriceHistory[];
    return must(await supabase.from("product_price_history").select("*").eq("product_id", product.id).order("changed_at", { ascending: false })) as PriceHistory[];
  }, [product?.id]);
  return (
    <Dialog open={Boolean(product)} onClose={onClose} title={`Historique des prix — ${product?.reference ?? ""}`}>
      {h.loading ? <Spinner /> : (
        <Table>
          <thead><tr><th>Date</th><th className="text-right">Ancien prix</th><th className="text-right">Nouveau prix</th><th className="text-right">TVA</th></tr></thead>
          <tbody>
            {(h.data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="num">{new Date(r.changed_at).toLocaleString("fr-MA")}</td>
                <td className="num text-right">{r.old_price_ttc === null ? "Création" : formatMoney(r.old_price_ttc)}</td>
                <td className="num text-right">{formatMoney(r.new_price_ttc)}</td>
                <td className="num text-right">{formatRate(r.new_vat_rate_bp)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Dialog>
  );
}

interface ImportRow { row: number; reference: string; designation: string; category: string; unit: string; price: number | null; rate: number | null; status: "new" | "same" | "changed" | "error"; message?: string; existing?: Product }

function ImportDialog({ open, onClose, categories, onDone }: { open: boolean; onClose: () => void; categories: Category[]; onDone: () => void }) {
  const { company } = useActiveCompany();
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [updatePrices, setUpdatePrices] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setRows(null); setUpdatePrices(false); } }, [open]);

  const downloadTemplate = () => {
    const blob = buildWorkbook([{
      name: "Catalogue",
      rows: [{}],
      columns: ["reference", "designation", "categorie", "unite", "prix_unitaire_ttc", "taux_tva"].map((h) => ({ header: h, value: () => null, width: 18 })),
    }]);
    saveAs(blob, "modele_import_catalogue.xlsx");
  };

  const parse = async (file: File) => {
    try {
      const data = await readFirstSheet(file);
      const existing = must(await supabase.from("products").select("*").eq("company_id", company.id)) as Product[];
      const byRef = new Map(existing.map((p) => [p.reference.toUpperCase(), p]));
      const seen = new Set<string>();
      setRows(data.map(({ rowNumber, values: v }) => {
        const reference = String(v.reference ?? "").trim();
        const designation = String(v.designation ?? "").trim();
        const price = parseMoney(v.prix_unitaire_ttc as string | number);
        const rateRaw = v.taux_tva === null || v.taux_tva === undefined || v.taux_tva === "" ? null : Number(String(v.taux_tva).replace(",", ".").replace("%", ""));
        const rate = rateRaw === null || Number.isNaN(rateRaw) ? null : Math.round((rateRaw <= 1 && rateRaw > 0 ? rateRaw * 100 : rateRaw) * 100);
        const base = { row: rowNumber, reference, designation, category: String(v.categorie ?? "").trim(), unit: String(v.unite ?? "U").trim() || "U", price, rate };
        if (!reference || !designation) return { ...base, status: "error", message: "Référence et désignation obligatoires." } as ImportRow;
        if (seen.has(reference.toUpperCase())) return { ...base, status: "error", message: "Référence en double dans le fichier." } as ImportRow;
        seen.add(reference.toUpperCase());
        if (price === null) return { ...base, status: "error", message: "Prix TTC manquant ou illisible." } as ImportRow;
        if (rate === null || !company.vat_rates_bp.includes(rate)) return { ...base, status: "error", message: "Taux de TVA absent ou non configuré." } as ImportRow;
        const ex = byRef.get(reference.toUpperCase());
        if (!ex) return { ...base, status: "new" } as ImportRow;
        const changed = ex.unit_price_ttc !== price || ex.vat_rate_bp !== rate;
        return { ...base, status: changed ? "changed" : "same", existing: ex } as ImportRow;
      }));
    } catch (err) {
      toast.error("Fichier illisible : " + errorMessage(err));
    }
  };

  const apply = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      const catMap = new Map(categories.map((c) => [c.name.toUpperCase(), c.id]));
      for (const name of new Set(rows.filter((r) => r.status !== "error" && r.category).map((r) => r.category))) {
        if (!catMap.has(name.toUpperCase())) {
          const c = must(await supabase.from("product_categories").insert({ company_id: company.id, name }).select().single()) as Category;
          catMap.set(name.toUpperCase(), c.id);
        }
      }
      const toInsert = rows.filter((r) => r.status === "new").map((r) => ({
        company_id: company.id, reference: r.reference, designation: r.designation, unit: r.unit,
        category_id: r.category ? catMap.get(r.category.toUpperCase()) ?? null : null, unit_price_ttc: r.price!, vat_rate_bp: r.rate!,
      }));
      if (toInsert.length) must(await supabase.from("products").insert(toInsert));
      let updated = 0;
      if (updatePrices) {
        for (const r of rows.filter((x) => x.status === "changed")) {
          must(await supabase.from("products").update({ unit_price_ttc: r.price!, vat_rate_bp: r.rate! }).eq("id", r.existing!.id));
          updated++;
        }
      }
      toast.success(`${toInsert.length} produit(s) ajouté(s)${updatePrices ? `, ${updated} prix mis à jour` : ""}.`);
      onDone();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const counts = rows ? { new: rows.filter((r) => r.status === "new").length, changed: rows.filter((r) => r.status === "changed").length, same: rows.filter((r) => r.status === "same").length, error: rows.filter((r) => r.status === "error").length } : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="Importer le catalogue (Excel)"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Annuler</Button>
        <Button loading={busy} disabled={!counts || (counts.new === 0 && !(updatePrices && counts.changed > 0))} onClick={apply}>Importer</Button>
      </>}
    >
      <div className="space-y-4 text-sm">
        <p>
          Colonnes attendues : <b>reference</b>, <b>designation</b>, categorie, unite, <b>prix_unitaire_ttc</b>, <b>taux_tva</b> (ex. 20).{" "}
          <button type="button" className="text-ink-700 underline" onClick={downloadTemplate}>Télécharger le modèle</button>
        </p>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && parse(e.target.files[0])} />
        {counts && (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge tone="ok">{counts.new} nouveau(x)</Badge>
              <Badge>{counts.same} inchangé(s)</Badge>
              <Badge tone="warn">{counts.changed} prix différent(s)</Badge>
              <Badge tone="danger">{counts.error} erreur(s)</Badge>
            </div>
            {counts.changed > 0 && (
              <Checkbox
                label="Mettre à jour les prix des produits existants"
                hint="Désactivé par défaut. Chaque modification est enregistrée dans l'historique des prix ; les factures existantes ne changent pas."
                checked={updatePrices}
                onChange={setUpdatePrices}
              />
            )}
            <div className="max-h-72 overflow-auto rounded border border-line">
              <Table>
                <thead><tr><th>Ligne</th><th>Référence</th><th>Désignation</th><th className="text-right">Prix TTC</th><th>Résultat</th></tr></thead>
                <tbody>
                  {rows!.map((r) => (
                    <tr key={r.row}>
                      <td className="num">{r.row}</td>
                      <td>{r.reference}</td>
                      <td>{r.designation}</td>
                      <td className="num text-right">{r.price !== null ? formatMoney(r.price) : ""}</td>
                      <td>
                        {r.status === "new" && <Badge tone="ok">Ajout</Badge>}
                        {r.status === "same" && <Badge>Inchangé</Badge>}
                        {r.status === "changed" && <Badge tone="warn">Prix catalogue : {formatMoney(r.existing!.unit_price_ttc)}</Badge>}
                        {r.status === "error" && <span className="text-danger">{r.message}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

function CategoriesDialog({ open, onClose, categories, onChange }: { open: boolean; onClose: () => void; categories: Category[]; onChange: () => void }) {
  const { company } = useActiveCompany();
  const [name, setName] = useState("");
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      must(await supabase.from("product_categories").insert({ company_id: company.id, name: name.trim() }));
      setName("");
      onChange();
    } catch (err) { toast.error(errorMessage(err)); }
  };
  const remove = async (c: Category) => {
    try {
      must(await supabase.from("product_categories").delete().eq("id", c.id));
      onChange();
    } catch (err) { toast.error(errorMessage(err)); }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Catégories de produits">
      <form onSubmit={add} className="mb-4 flex gap-2">
        <Input placeholder="Nouvelle catégorie" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit">Ajouter</Button>
      </form>
      {categories.length === 0 ? <p className="text-sm text-muted">Aucune catégorie.</p> : (
        <ul className="divide-y divide-line rounded border border-line">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
              {c.name}
              <Button size="sm" variant="ghost" onClick={() => remove(c)}>Supprimer</Button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">Supprimer une catégorie ne supprime pas ses produits : ils deviennent « sans catégorie ».</p>
    </Dialog>
  );
}
