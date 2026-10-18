import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { saveAs } from "file-saver";
import { Archive, Download, Eye, Search } from "lucide-react";
import { supabase, must, errorMessage } from "@/lib/supabase";
import { useActiveCompany } from "@/lib/session";
import { useAsync, useDebounced } from "@/lib/hooks";
import type { JournalRow, VatDeclaration, VatEntry, VatEntryKind } from "@/lib/types";
import { formatMoney, formatRate } from "@/domain/money";
import { formatDateFr } from "@/domain/dates";
import { safeFileName } from "@/lib/utils";
import { Badge, Button, Card, Checkbox, ConfirmDialog, Dialog, EmptyState, ErrorBox, Input, PageHeader, Select, Spinner, Table } from "@/components/ui";
import { PeriodPicker, initialPeriod, type PeriodValue } from "./PeriodPicker";
import { PAYMENT_MODES, buildVatWorkbook, rateText } from "./vatCommon";
import { SourcePageDialog } from "./SourcePageDialog";

/** Charge les lignes validées du journal (ventes ou achats) pour une période. */
export async function loadJournal(companyId: string, kind: VatEntryKind, from: string, to: string): Promise<JournalRow[]> {
  const out: JournalRow[] = [];
  for (let p = 0; ; p += 1000) {
    const rows = must(await supabase.from("vat_journal").select("*").eq("company_id", companyId).eq("kind", kind).eq("status", "validated").eq("archived", false)
      .gte("invoice_date", from).lte("invoice_date", to).order("invoice_date").order("invoice_number").range(p, p + 999)) as JournalRow[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function exportVatXlsx(companyId: string, companyName: string, from: string, to: string, includeToReview: boolean) {
  const [sales, purchases, decl] = await Promise.all([
    loadJournal(companyId, "sale", from, to),
    loadJournal(companyId, "purchase", from, to),
    supabase.rpc("vat_declaration", { p_company: companyId, p_from: from, p_to: to }),
  ]);
  const toReview = includeToReview
    ? (must(await supabase.from("vat_entries").select("*").eq("company_id", companyId).eq("status", "to_review").eq("archived", false)
        .or(`invoice_date.is.null,and(invoice_date.gte.${from},invoice_date.lte.${to})`).limit(5000)) as VatEntry[])
    : [];
  const blob = buildVatWorkbook({ companyName, from, to, sales, purchases, declaration: must(decl) as VatDeclaration, toReview });
  if (!blob || blob.size < 1000) throw new Error("Le fichier Excel n'a pas pu être généré.");
  saveAs(blob, `${safeFileName("Journal-TVA", companyName, from, to)}.xlsx`);
  return { sales: sales.length, purchases: purchases.length, toReview: toReview.length };
}

export function JournalPage({ kind }: { kind: VatEntryKind }) {
  const { company, canManage } = useActiveCompany();
  const [period, setPeriod] = useState<PeriodValue>(() => initialPeriod(company.vat_period));
  const [q, setQ] = useState("");
  const query = useDebounced(q);
  const [rate, setRate] = useState("");
  const [source, setSource] = useState<JournalRow | null>(null);
  const [archive, setArchive] = useState<JournalRow | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [includeReview, setIncludeReview] = useState(false);
  const [busy, setBusy] = useState(false);

  const list = useAsync(() => loadJournal(company.id, kind, period.from, period.to), [company.id, kind, period.from, period.to]);
  const pending = useAsync(async () => {
    const r = await supabase.from("vat_entries").select("id", { count: "exact", head: true }).eq("company_id", company.id).eq("kind", kind).eq("status", "to_review").eq("archived", false);
    return r.count ?? 0;
  }, [company.id, kind]);

  const rows = useMemo(() => {
    const s = query.trim().toLowerCase();
    return (list.data ?? []).filter((r) =>
      (!s || [r.invoice_number, r.party_name, r.party_ice].some((x) => (x ?? "").toLowerCase().includes(s))) &&
      (!rate || (rate === "multi" ? r.rates.length > 1 : r.rates.length > 1 ? r.rates.some((x) => String(x.rate_bp) === rate) : String(r.vat_rate_bp) === rate)));
  }, [list.data, query, rate]);

  const dupKeys = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of list.data ?? []) {
      const k = `${(r.party_ice ?? r.party_name ?? "").toLowerCase()}|${(r.invoice_number ?? "").replace(/\W+/g, "").toUpperCase()}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [list.data]);

  const totals = rows.reduce((t, r) => ({ ht: t.ht + (r.total_ht ?? 0), vat: t.vat + (r.total_vat ?? 0), ttc: t.ttc + (r.total_ttc ?? 0) }), { ht: 0, vat: 0, ttc: 0 });
  const title = kind === "sale" ? "Journal des ventes" : "Journal des achats";

  return (
    <>
      <PageHeader
        title={title}
        description={kind === "sale"
          ? "Factures de vente validées : celles émises dans Smart Invoice (automatiquement) et celles importées ou saisies."
          : "Factures d'achat validées, issues des imports PDF ou saisies manuellement."}
        actions={<Button icon={<Download className="size-4" />} onClick={() => setExportOpen(true)}>Exporter (Excel)</Button>}
      />

      {(pending.data ?? 0) > 0 && (
        <div className="mb-4 rounded-md border border-saffron-100 bg-saffron-50 px-4 py-2 text-sm text-saffron-700">
          {pending.data} facture(s) {kind === "sale" ? "de vente" : "d'achat"} attendent un contrôle et ne figurent pas encore ici.{" "}
          <Link to="/tva/controle" className="font-medium underline">Les contrôler</Link>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <PeriodPicker value={period} onChange={setPeriod} />
          <Select className="w-36" value={rate} onChange={(e) => setRate(e.target.value)} aria-label="Taux">
            <option value="">Tous les taux</option>
            {company.vat_rates_bp.map((r) => <option key={r} value={r}>{formatRate(r)}</option>)}
            <option value="multi">Plusieurs taux</option>
          </Select>
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
            <Input className="pl-8" placeholder={`N° facture, ${kind === "sale" ? "client" : "fournisseur"}, ICE`} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : list.loading && !list.data ? <Spinner /> : rows.length === 0 ? (
          <EmptyState title="Aucune facture validée sur cette période" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>N° FACTURE</th><th>DATE</th><th>{kind === "sale" ? "CLIENT" : "FOURNISSEUR"}</th><th>ICE</th><th>NATURE MARCHANDISE</th>
                <th className="text-right">HT</th><th>TAUX</th><th className="text-right">TVA</th><th className="text-right">TTC</th><th>PAIEMENT</th><th>ORIGINE</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const dup = (dupKeys.get(`${(r.party_ice ?? r.party_name ?? "").toLowerCase()}|${(r.invoice_number ?? "").replace(/\W+/g, "").toUpperCase()}`) ?? 0) > 1;
                const incoherent = r.total_ht !== null && r.total_vat !== null && r.total_ttc !== null && Math.abs(r.total_ht + r.total_vat + r.other_amount - r.total_ttc) > 2;
                return (
                  <tr key={`${r.source}-${r.id}`}>
                    <td className="font-medium">
                      {r.source === "invoice" ? <Link to={`/factures/${r.id}`} className="text-ink-800 hover:underline">{r.invoice_number}</Link> : r.invoice_number}
                      {dup && <div><Badge tone="danger">Doublon possible</Badge></div>}
                      {incoherent && <div><Badge tone="danger">Totaux incohérents</Badge></div>}
                      {kind === "purchase" && !r.deductible && <div><Badge>Non déductible</Badge></div>}
                    </td>
                    <td className="num">{formatDateFr(r.invoice_date)}</td>
                    <td>{r.party_name}</td>
                    <td className="num">{r.party_ice ?? <span className="text-saffron-700">manquant</span>}</td>
                    <td className="max-w-48 truncate" title={r.goods_nature ?? ""}>{r.goods_nature}</td>
                    <td className="num text-right">{formatMoney(r.total_ht ?? 0)}</td>
                    <td className="whitespace-nowrap">{rateText(r)}</td>
                    <td className="num text-right">{formatMoney(r.total_vat ?? 0)}</td>
                    <td className="num text-right font-medium">{formatMoney(r.total_ttc ?? 0)}</td>
                    <td className="whitespace-nowrap text-xs">{r.payment_mode ? PAYMENT_MODES[r.payment_mode as keyof typeof PAYMENT_MODES] ?? r.payment_mode : ""}{r.payment_date ? ` · ${formatDateFr(r.payment_date)}` : ""}</td>
                    <td className="text-xs">
                      {r.source === "invoice" ? "Smart Invoice" : r.page_from ? (
                        <button type="button" className="inline-flex items-center gap-1 text-ink-700 hover:underline" onClick={() => setSource(r)} title={r.source_file ?? ""}>
                          <Eye className="size-3.5" /> p.{r.page_from}
                        </button>
                      ) : "Saisie"}
                    </td>
                    <td className="text-right">
                      {r.source === "entry" && canManage && (
                        <Button size="sm" variant="ghost" icon={<Archive className="size-3.5" />} onClick={() => setArchive(r)} title="Archiver" aria-label="Archiver" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold [&>td]:border-t-2 [&>td]:border-ink-200 [&>td]:px-3 [&>td]:py-2">
                <td colSpan={5}>Total ({rows.length} facture{rows.length > 1 ? "s" : ""})</td>
                <td className="num text-right">{formatMoney(totals.ht)}</td><td />
                <td className="num text-right">{formatMoney(totals.vat)}</td>
                <td className="num text-right">{formatMoney(totals.ttc)}</td><td colSpan={3} />
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>

      <SourcePageDialog
        importId={source?.import_id ?? null}
        pageFrom={source?.page_from ?? null} pageTo={source?.page_to ?? null}
        title={`Source : ${source?.source_file ?? ""}`} onClose={() => setSource(null)}
      />

      <ConfirmDialog
        open={archive !== null}
        title="Archiver l'écriture"
        message={<>La facture {archive?.invoice_number} sera retirée du journal et de la déclaration. Elle reste consultable dans le journal d'activité.</>}
        confirmLabel="Archiver"
        danger
        reasonLabel="Motif de l'archivage"
        onClose={() => setArchive(null)}
        onConfirm={async (reason) => {
          try {
            must(await supabase.from("vat_entries").update({ archived: true, archive_reason: reason }).eq("id", archive!.id));
            setArchive(null);
            void list.reload();
            toast.success("Écriture archivée.");
          } catch (e) { toast.error(errorMessage(e)); }
        }}
      />

      <Dialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Exporter le Journal TVA (Excel)"
        footer={
          <>
            <Button variant="secondary" onClick={() => setExportOpen(false)}>Retour</Button>
            <Button loading={busy} icon={<Download className="size-4" />} onClick={async () => {
              setBusy(true);
              try {
                const r = await exportVatXlsx(company.id, company.legal_name, period.from, period.to, includeReview);
                toast.success(`Fichier généré : ${r.sales} vente(s), ${r.purchases} achat(s)${r.toReview ? `, ${r.toReview} à contrôler (feuille séparée)` : ""}.`);
                setExportOpen(false);
              } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
            }}>Télécharger</Button>
          </>
        }
      >
        <p className="text-sm">Période : <b>{formatDateFr(period.from)}</b> au <b>{formatDateFr(period.to)}</b>. Le classeur contient :</p>
        <ul className="mt-2 list-disc pl-5 text-sm">
          <li>Journal des ventes et Journal des achats (écritures validées, montants numériques, totaux) ;</li>
          <li>Synthèse TVA par taux (collectée, déductible, nette) ;</li>
          <li>Relevé des déductions dans une présentation proche de SIMPL-TVA (à vérifier avant dépôt).</li>
        </ul>
        <div className="mt-3">
          <Checkbox label="Ajouter les écritures non validées dans une feuille séparée « À contrôler »" hint="Elles ne sont jamais mélangées aux journaux ni à la synthèse." checked={includeReview} onChange={setIncludeReview} />
        </div>
      </Dialog>
    </>
  );
}
