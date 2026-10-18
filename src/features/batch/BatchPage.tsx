import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { saveAs } from "file-saver";
import { FileArchive, FileSpreadsheet, ShieldCheck, Upload } from "lucide-react";
import { supabase, must, errorMessage } from "@/lib/supabase";
import { useActiveCompany } from "@/lib/session";
import type { InvoiceTemplateRow, Party, Product } from "@/lib/types";
import { buildDraftsFromOrders, type BatchResult, type OrderRow } from "@/domain/batch";
import { formatMoney } from "@/domain/money";
import { formatDateFr } from "@/domain/dates";
import { buildWorkbook, readFirstSheet } from "@/lib/excel";
import { safeFileName } from "@/lib/utils";
import { downloadInvoicesZip } from "@/pdf/export";
import { presetFor } from "@/pdf/templates";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Table } from "@/components/ui";

/** En-têtes acceptés (après normalisation : minuscules, sans accents, « _ »). */
const COLS = {
  orderRef: ["commande", "reference_commande", "ref_commande", "n_commande", "num_commande", "order_ref"],
  date: ["date", "date_commande", "date_facture"],
  client: ["client", "ice_client", "client_ice", "ice", "raison_sociale"],
  productRef: ["reference_produit", "ref_produit", "produit", "reference", "code_produit"],
  quantity: ["quantite", "qte", "qty"],
  price: ["prix_unitaire_ttc", "prix_ttc", "prix_unit_ttc", "prix"],
  deliveryNote: ["bon_livraison", "bon_de_livraison", "n_bl", "bl", "num_bl", "n_bon_livraison"],
} as const;

const pick = (v: Record<string, unknown>, keys: readonly string[]) => {
  for (const k of keys) if (k in v) return v[k];
  return undefined;
};

type Created = { id: string; orderRef: string; number?: string; error?: string };

export function BatchPage() {
  const { company, canManage } = useActiveCompany();
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [goodsNature, setGoodsNature] = useState("");
  const [templates, setTemplates] = useState<InvoiceTemplateRow[]>([]);
  const [busy, setBusy] = useState<null | "read" | "create" | "validate" | "zip">(null);
  const [progress, setProgress] = useState("");
  const [created, setCreated] = useState<Created[]>([]);

  const downloadTemplate = () => {
    const blob = buildWorkbook([{
      name: "Commandes",
      rows: [],
      columns: ["commande", "date", "client", "reference_produit", "quantite", "prix_unitaire_ttc", "bon_livraison"].map((h) => ({ header: h, value: () => null, width: 20 })),
    }]);
    saveAs(blob, "modele_commandes.xlsx");
  };

  const onFile = async (file: File) => {
    setBusy("read");
    setResult(null);
    setCreated([]);
    setFileName(file.name);
    try {
      const raw = await readFirstSheet(file);
      if (raw.length === 0) throw new Error("Le fichier ne contient aucune ligne.");
      const first = raw[0].values;
      const missing = (["orderRef", "date", "client", "productRef", "quantity"] as const).filter((k) => pick(first, COLS[k]) === undefined && !raw.some((r) => pick(r.values, COLS[k]) !== undefined));
      if (missing.length) {
        throw new Error(`Colonnes introuvables : ${missing.map((m) => COLS[m][0]).join(", ")}. Utilisez le modèle Excel proposé.`);
      }
      const rows: OrderRow[] = raw.map((r) => ({
        rowNumber: r.rowNumber,
        orderRef: String(pick(r.values, COLS.orderRef) ?? "").trim(),
        date: pick(r.values, COLS.date),
        client: String(pick(r.values, COLS.client) ?? "").trim(),
        productRef: String(pick(r.values, COLS.productRef) ?? "").trim(),
        quantity: pick(r.values, COLS.quantity),
        unitPriceTtc: pick(r.values, COLS.price) as string | number | undefined,
        deliveryNote: String(pick(r.values, COLS.deliveryNote) ?? "").trim() || undefined,
      }));
      const refs = [...new Set(rows.map((r) => r.orderRef).filter(Boolean))];
      const [products, clients, tpls, invoiced] = await Promise.all([
        supabase.from("products").select("*").eq("company_id", company.id),
        supabase.from("parties").select("*").eq("company_id", company.id).eq("kind", "client"),
        supabase.from("invoice_templates").select("*").eq("company_id", company.id).order("name"),
        refs.length
          ? supabase.from("invoices").select("order_ref").eq("company_id", company.id).neq("status", "cancelled").in("order_ref", refs.slice(0, 1000))
          : Promise.resolve({ data: [], error: null }),
      ]);
      setTemplates(must(tpls) as InvoiceTemplateRow[]);
      const res = buildDraftsFromOrders(
        rows,
        (must(products) as Product[]).map((p) => ({ id: p.id, reference: p.reference, designation: p.designation, unitPriceTtc: p.unit_price_ttc, vatRateBp: p.vat_rate_bp, active: p.active })),
        (must(clients) as Party[]).map((c) => ({ id: c.id, name: c.name, ice: c.ice, archived: c.archived })),
        new Set((must(invoiced) as { order_ref: string }[]).map((i) => i.order_ref)),
        { requireClientIce: company.require_client_ice, roundingMode: company.rounding_mode },
      );
      setResult(res);
      if (res.drafts.length === 0) toast.error("Aucune commande exploitable : corrigez les erreurs listées.");
    } catch (err) {
      toast.error(errorMessage(err));
      setFileName(null);
    } finally {
      setBusy(null);
    }
  };

  const createDrafts = async () => {
    if (!result) return;
    // Numérotation propre à chaque client (si définie)
    const clientSeries = new Map(
      (must(await supabase.from("parties").select("id, default_series_id").eq("company_id", company.id).eq("kind", "client")) as { id: string; default_series_id: string | null }[])
        .filter((c) => c.default_series_id).map((c) => [c.id, c.default_series_id as string]),
    );
    setBusy("create");
    const out: Created[] = [];
    let i = 0;
    for (const d of result.drafts) {
      i++;
      setProgress(`${i} / ${result.drafts.length}`);
      try {
        const id = must(await supabase.rpc("save_invoice_draft", {
          p_invoice: null,
          p_company: company.id,
          p_header: { series_id: clientSeries.get(d.clientId) ?? "", issue_date: d.date, client_id: d.clientId, order_ref: d.orderRef, delivery_note_ref: d.deliveryNote ?? "", goods_nature: goodsNature, template_id: templateId, payment_terms: company.default_payment_terms ?? "" },
          p_lines: d.lines.map((l) => ({ product_id: l.productId, designation: l.designation, unit: "", quantity: l.quantity, unit_price_ttc: l.unitPriceTtc, vat_rate_bp: l.vatRateBp, discount_bp: 0 })),
        })) as string;
        out.push({ id, orderRef: d.orderRef });
      } catch (err) {
        out.push({ id: "", orderRef: d.orderRef, error: errorMessage(err) });
      }
    }
    setCreated(out);
    setBusy(null);
    setProgress("");
    const ok = out.filter((o) => o.id).length;
    if (ok) toast.success(`${ok} brouillon(s) créé(s).`);
    if (ok < out.length) toast.error(`${out.length - ok} commande(s) non enregistrée(s) : voir le détail.`);
  };

  const validateAll = async () => {
    setBusy("validate");
    // Ordre chronologique (déjà trié par date) : la numérotation reste continue et chronologique.
    const next = [...created];
    let i = 0;
    for (const c of next) {
      i++;
      setProgress(`${i} / ${next.length}`);
      if (!c.id || c.number) continue;
      try {
        c.number = must(await supabase.rpc("validate_invoice", { p_invoice: c.id })) as string;
      } catch (err) {
        c.error = errorMessage(err);
        toast.error(`${c.orderRef} : ${c.error} — validation interrompue pour garder une numérotation continue.`);
        break;
      }
    }
    setCreated([...next]);
    setBusy(null);
    setProgress("");
  };

  const zipAll = async () => {
    const ids = created.filter((c) => c.id).map((c) => c.id);
    setBusy("zip");
    try {
      const n = await downloadInvoicesZip(company, ids, (d, t) => setProgress(`${d} / ${t}`));
      toast.success(`${n} PDF dans le fichier ZIP.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
      setProgress("");
    }
  };

  const errors = result?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = result?.issues.filter((i) => i.level === "warning") ?? [];
  const totalTtc = result?.drafts.reduce((s, d) => s + d.totals.totalTtc, 0) ?? 0;
  const validated = created.filter((c) => c.number).length;

  return (
    <>
      <PageHeader
        title="Facturation par lots"
        description="Importez vos commandes réelles (Excel ou CSV) : chaque commande devient une facture. Les prix viennent toujours du catalogue et les commandes déjà facturées sont refusées."
        actions={<Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} onClick={downloadTemplate}>Modèle Excel</Button>}
      />

      <Card title="1. Fichier de commandes">
        <div className="space-y-3 p-4 text-sm">
          <p className="text-muted">
            Une ligne par article commandé. Colonnes : <b>commande</b>, <b>date</b>, <b>client</b> (ICE ou raison sociale exacte),{" "}
            <b>reference_produit</b>, <b>quantite</b>, et facultativement <b>bon_livraison</b> et <b>prix_unitaire_ttc</b> (contrôle uniquement : un prix différent du catalogue bloque la commande).
          </p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-ink-300 bg-ink-50/50 px-4 py-3 hover:bg-ink-50">
            <Upload className="size-4 text-ink-700" />
            <span>{busy === "read" ? "Lecture…" : fileName ? `Fichier : ${fileName} (changer)` : "Choisir un fichier .xlsx, .xls ou .csv"}</span>
            <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" disabled={busy !== null}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
          </label>
        </div>
      </Card>

      {result && (
        <Card className="mt-4" title={`2. Contrôle — ${result.drafts.length} facture(s) prête(s), ${result.rejectedOrders.length} commande(s) rejetée(s)`}>
          {errors.length + warnings.length > 0 && (
            <div className="max-h-56 overflow-y-auto border-b border-line p-4 text-sm">
              {errors.map((e, i) => <p key={`e${i}`} className="text-danger">Ligne {e.row ?? "?"}{e.orderRef ? ` (${e.orderRef})` : ""} : {e.message}</p>)}
              {warnings.map((w, i) => <p key={`w${i}`} className="text-saffron-700">Ligne {w.row ?? "?"}{w.orderRef ? ` (${w.orderRef})` : ""} : {w.message}</p>)}
            </div>
          )}
          {result.drafts.length > 0 && (
            <>
              <Table>
                <thead><tr><th>Commande</th><th>BL</th><th>Date</th><th>Client</th><th className="text-right">Lignes</th><th className="text-right">HT</th><th className="text-right">TVA</th><th className="text-right">TTC</th><th>État</th></tr></thead>
                <tbody>
                  {result.drafts.map((d) => {
                    const c = created.find((x) => x.orderRef === d.orderRef);
                    return (
                      <tr key={d.orderRef}>
                        <td className="font-medium">{d.orderRef}</td>
                        <td className="text-xs">{d.deliveryNote ?? ""}</td>
                        <td className="num">{formatDateFr(d.date)}</td>
                        <td>{d.clientName}</td>
                        <td className="num text-right">{d.lines.length}</td>
                        <td className="num text-right">{formatMoney(d.totals.totalHt)}</td>
                        <td className="num text-right">{formatMoney(d.totals.totalVat)}</td>
                        <td className="num text-right font-medium">{formatMoney(d.totals.totalTtc)}</td>
                        <td>
                          {!c ? <Badge>À créer</Badge>
                            : c.error ? <span className="text-xs text-danger">{c.error}</span>
                            : c.number ? <Link to={`/factures/${c.id}`} className="font-medium text-ink-800 underline">{c.number}</Link>
                            : <Link to={`/factures/${c.id}`}><Badge tone="ok">Brouillon</Badge></Link>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-semibold"><td colSpan={7} className="text-right">Total TTC</td><td className="num text-right">{formatMoney(totalTtc)}</td><td /></tr>
                </tfoot>
              </Table>

              <div className="flex flex-wrap items-end gap-3 border-t border-line p-4">
                {created.length === 0 ? (
                  <>
                    <Field label="Modèle" className="w-56">
                      <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                        <option value="">Modèle par défaut</option>
                        {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({presetFor(t.base).label})</option>)}
                      </Select>
                    </Field>
                    <Field label="Nature de la marchandise" className="w-64">
                      <Input value={goodsNature} onChange={(e) => setGoodsNature(e.target.value)} placeholder="Facultatif" />
                    </Field>
                    <Button loading={busy === "create"} onClick={createDrafts}>Créer {result.drafts.length} brouillon(s)</Button>
                  </>
                ) : (
                  <>
                    {canManage && validated < created.filter((c) => c.id).length && (
                      <Button variant="accent" icon={<ShieldCheck className="size-4" />} loading={busy === "validate"} disabled={busy !== null} onClick={validateAll}>
                        Valider et numéroter dans l'ordre chronologique
                      </Button>
                    )}
                    <Button variant="secondary" icon={<FileArchive className="size-4" />} loading={busy === "zip"} disabled={busy !== null} onClick={zipAll}>
                      Télécharger le ZIP des PDF
                    </Button>
                    <Button variant="ghost" onClick={() => {
                      const blob = buildWorkbook([{ name: "Lot", rows: created, columns: [
                        { header: "Commande", value: (c: Created) => c.orderRef }, { header: "N° facture", value: (c: Created) => c.number ?? "(brouillon)" },
                        { header: "Erreur", value: (c: Created) => c.error ?? "" },
                      ] }]);
                      saveAs(blob, safeFileName("Lot", company.legal_name, fileName?.replace(/\.[^.]+$/, "")) + ".xlsx");
                    }}>Rapport du lot (Excel)</Button>
                  </>
                )}
                {progress && <span className="num text-sm text-muted">{progress}</span>}
              </div>
            </>
          )}
        </Card>
      )}
    </>
  );
}
