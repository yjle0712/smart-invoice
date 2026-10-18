import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { saveAs } from "file-saver";
import { ClipboardList, Download, FileArchive, FilePlus2, Search } from "lucide-react";
import { supabase, must, errorMessage } from "@/lib/supabase";
import { useActiveCompany } from "@/lib/session";
import { useAsync, useDebounced } from "@/lib/hooks";
import type { Invoice, InvoiceStatus, Party } from "@/lib/types";
import { formatMoney } from "@/domain/money";
import { formatDateFr } from "@/domain/dates";
import { STATUS_LABEL, safeFileName } from "@/lib/utils";
import { buildWorkbook, dh, DATE_FMT, MONEY_FMT, xlDate } from "@/lib/excel";
import { PAYMENT_METHOD_PDF } from "@/pdf/paymentMethods";
import { downloadInvoicesSinglePdf, downloadInvoicesZip } from "@/pdf/export";
import { Button, Card, EmptyState, ErrorBox, Input, PageHeader, Pagination, Select, Spinner, StatusBadge, Table } from "@/components/ui";

const PAGE = 25;
type Row = Invoice & { parties: Pick<Party, "name" | "ice"> | null };

export function InvoicesListPage() {
  const { company } = useActiveCompany();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const query = useDebounced(q);
  const [status, setStatus] = useState<InvoiceStatus | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<string | null>(null);

  const buildQuery = (count: boolean) => {
    let req = supabase
      .from("invoices")
      .select("*, parties!invoices_client_id_fkey(name, ice)", count ? { count: "exact" } : undefined)
      .eq("company_id", company.id);
    if (status) req = req.eq("status", status);
    if (from) req = req.gte("issue_date", from);
    if (to) req = req.lte("issue_date", to);
    if (query.trim()) {
      const s = query.trim().replace(/[%,()]/g, " ");
      req = req.or(`number.ilike.%${s}%,order_ref.ilike.%${s}%,delivery_note_ref.ilike.%${s}%,client_snapshot->>name.ilike.%${s}%`);
    }
    return req.order("issue_date", { ascending: false }).order("created_at", { ascending: false });
  };

  const list = useAsync(async () => {
    const res = await buildQuery(true).range(page * PAGE, page * PAGE + PAGE - 1);
    if (res.error) throw res.error;
    return { rows: (res.data ?? []) as Row[], total: res.count ?? 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company.id, status, from, to, query, page]);

  const totals = useAsync(async () => {
    let req = supabase.from("invoices").select("total_ht, total_vat, total_ttc").eq("company_id", company.id).not("status", "in", "(draft,cancelled)");
    if (from) req = req.gte("issue_date", from);
    if (to) req = req.lte("issue_date", to);
    if (status) req = req.eq("status", status);
    const rows = must(await req) as { total_ht: number; total_vat: number; total_ttc: number }[];
    return rows.reduce((s, r) => ({ ht: s.ht + r.total_ht, vat: s.vat + r.total_vat, ttc: s.ttc + r.total_ttc, n: s.n + 1 }), { ht: 0, vat: 0, ttc: 0, n: 0 });
  }, [company.id, status, from, to]);

  const rows = list.data?.rows ?? [];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const runBatch = async (kind: "zip" | "pdf") => {
    const ids = [...selected];
    setProgress(`0 / ${ids.length}`);
    try {
      const fn = kind === "zip" ? downloadInvoicesZip : downloadInvoicesSinglePdf;
      const n = await fn(company, ids, (d, t) => setProgress(`${d} / ${t}`));
      toast.success(`${n} facture(s) téléchargée(s).`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setProgress(null);
    }
  };

  /** Crée le BL ou le BC de chaque facture sélectionnée, puis ouvre la section Bons. */
  const createNotes = async (kind: "BL" | "BC") => {
    const ids = [...selected];
    let created = 0;
    const errors: string[] = [];
    setProgress(`0 / ${ids.length}`);
    for (const [i, id] of ids.entries()) {
      const r = rows.find((x) => x.id === id);
      const label = r ? (r.number ?? "brouillon") : "facture";
      try {
        must(await supabase.rpc("create_note_from_invoice", { p_invoice: id, p_kind: kind }));
        created++;
      } catch (err) {
        errors.push(`${label} : ${errorMessage(err)}`);
      }
      setProgress(`${i + 1} / ${ids.length}`);
    }
    setProgress(null);
    const word = kind === "BL" ? "bon(s) de livraison" : "bon(s) de commande";
    if (created) toast.success(`${created} ${word} prêt(s).`);
    if (errors.length) toast.error(`Non créés : ${errors.join(" · ")}`, { duration: 12000 });
    if (created) { setSelected(new Set()); navigate(`/bons?type=${kind}`); }
  };

  const exportXlsx = async () => {
    try {
      const all = must(await buildQuery(false).limit(10000)) as Row[];
      const blob = buildWorkbook([{
        name: "Factures",
        rows: all,
        columns: [
          { header: "N° facture", value: (r: Row) => r.number ?? "(brouillon)", width: 16 },
          { header: "Date", value: (r: Row) => xlDate(r.issue_date), format: DATE_FMT, width: 12 },
          { header: "Échéance", value: (r: Row) => xlDate(r.due_date), format: DATE_FMT, width: 12 },
          { header: "Client", value: (r: Row) => r.client_snapshot?.name ?? r.parties?.name ?? "", width: 30 },
          { header: "ICE", value: (r: Row) => r.client_snapshot?.ice ?? r.parties?.ice ?? "", width: 18 },
          { header: "Nature marchandise", value: (r: Row) => r.goods_nature, width: 22 },
          { header: "Commande", value: (r: Row) => r.order_ref },
          { header: "Bon de livraison", value: (r: Row) => r.delivery_note_ref, width: 16 },
          { header: "Mode de paiement", value: (r: Row) => (r.payment_method ? PAYMENT_METHOD_PDF[r.payment_method] ?? r.payment_method : ""), width: 18 },
          { header: "HT", value: (r: Row) => dh(r.total_ht), format: MONEY_FMT, width: 14 },
          { header: "TVA", value: (r: Row) => dh(r.total_vat), format: MONEY_FMT, width: 14 },
          { header: "TTC", value: (r: Row) => dh(r.total_ttc), format: MONEY_FMT, width: 14 },
          { header: "Payé", value: (r: Row) => dh(r.amount_paid), format: MONEY_FMT, width: 14 },
          { header: "Statut", value: (r: Row) => STATUS_LABEL[r.status], width: 18 },
        ],
      }]);
      saveAs(blob, safeFileName("Factures", company.legal_name, from, to) + ".xlsx");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const filtersActive = Boolean(q || status || from || to);
  const summary = useMemo(() => totals.data, [totals.data]);

  return (
    <>
      <PageHeader
        title="Factures"
        description="Recherchez, filtrez et téléchargez vos factures. Les brouillons n'ont pas encore de numéro."
        actions={
          <>
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={exportXlsx}>Exporter en Excel</Button>
            <Button icon={<FilePlus2 className="size-4" />} onClick={() => navigate("/factures/nouvelle")}>Nouvelle facture</Button>
          </>
        }
      />

      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Factures (hors brouillons et annulées)", String(summary.n)],
            ["Total HT", formatMoney(summary.ht)],
            ["TVA", formatMoney(summary.vat)],
            ["Total TTC", formatMoney(summary.ttc)],
          ].map(([l, v]) => (
            <div key={l} className="rounded-lg border border-line bg-white px-4 py-3">
              <div className="text-xs text-muted">{l}</div>
              <div className="num text-lg font-semibold text-ink-900">{v}</div>
            </div>
          ))}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
            <Input className="pl-8" placeholder="N° facture, client, commande, BL" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          </div>
          <Select className="w-48" value={status} onChange={(e) => { setStatus(e.target.value as InvoiceStatus | ""); setPage(0); }} aria-label="Statut">
            <option value="">Tous les statuts</option>
            {(Object.keys(STATUS_LABEL) as InvoiceStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </Select>
          <label className="flex items-center gap-1.5 text-sm text-muted">Du <Input type="date" className="w-40" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} /></label>
          <label className="flex items-center gap-1.5 text-sm text-muted">au <Input type="date" className="w-40" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} /></label>
          {filtersActive && <Button variant="ghost" onClick={() => { setQ(""); setStatus(""); setFrom(""); setTo(""); setPage(0); }}>Effacer les filtres</Button>}
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-ink-50 px-3 py-2 text-sm">
            <span className="font-medium">{selected.size} sélectionnée(s)</span>
            <Button size="sm" variant="secondary" icon={<FileArchive className="size-3.5" />} loading={progress !== null} onClick={() => runBatch("zip")}>ZIP (un PDF par facture)</Button>
            <Button size="sm" variant="secondary" loading={progress !== null} onClick={() => runBatch("pdf")}>Un seul PDF</Button>
            <Button size="sm" variant="secondary" icon={<ClipboardList className="size-3.5" />} disabled={progress !== null} onClick={() => createNotes("BL")}>Créer les BL</Button>
            <Button size="sm" variant="secondary" icon={<ClipboardList className="size-3.5" />} disabled={progress !== null} onClick={() => createNotes("BC")}>Créer les BC</Button>
            {progress && <span className="num text-muted">Génération {progress}</span>}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Désélectionner</Button>
          </div>
        )}

        {list.loading && !list.data ? <Spinner /> : list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> :
          rows.length === 0 ? (
            <EmptyState
              title={filtersActive ? "Aucune facture ne correspond aux filtres" : "Aucune facture pour l'instant"}
              action={!filtersActive && <Button onClick={() => navigate("/factures/nouvelle")}>Créer une facture</Button>}
            />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <th className="w-8">
                      <input type="checkbox" className="accent-ink-700" aria-label="Tout sélectionner" checked={allOnPage}
                        onChange={() => setSelected((s) => { const n = new Set(s); rows.forEach((r) => (allOnPage ? n.delete(r.id) : n.add(r.id))); return n; })} />
                    </th>
                    <th>N° facture</th><th>Date</th><th>Client</th><th>ICE</th><th className="text-right">HT</th><th className="text-right">TVA</th><th className="text-right">TTC</th><th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td><input type="checkbox" className="accent-ink-700" aria-label={`Sélectionner ${r.number ?? "brouillon"}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                      <td>
                        <Link to={`/factures/${r.id}`} className="font-medium text-ink-800 hover:underline">{r.number ?? "Brouillon"}</Link>
                        {r.order_ref && <div className="text-xs text-muted">Cde {r.order_ref}</div>}
                        {r.delivery_note_ref && <div className="text-xs text-muted">BL {r.delivery_note_ref}</div>}
                      </td>
                      <td className="num">{formatDateFr(r.issue_date)}</td>
                      <td>{r.client_snapshot?.name ?? r.parties?.name ?? <span className="text-saffron-700">Client à choisir</span>}</td>
                      <td className="num">{r.client_snapshot?.ice ?? r.parties?.ice ?? ""}</td>
                      <td className="num text-right">{formatMoney(r.total_ht)}</td>
                      <td className="num text-right">{formatMoney(r.total_vat)}</td>
                      <td className="num text-right font-medium">{formatMoney(r.total_ttc)}</td>
                      <td><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pagination page={page} pageSize={PAGE} total={list.data!.total} onPage={setPage} />
            </>
          )}
      </Card>
    </>
  );
}
