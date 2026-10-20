import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { FileSpreadsheet, ListChecks } from "lucide-react";
import { supabase, must, errorMessage } from "@/lib/supabase";
import { useActiveCompany } from "@/lib/session";
import { useAsync } from "@/lib/hooks";
import type { NumberSeries, VatEntryKind } from "@/lib/types";
import { readSheetGrids } from "@/lib/excel";
import { parseInvoiceList, parseInvoiceSheet, type ExcelInvoice } from "@/domain/excelInvoices";
import { deriveSeriesFromNumber, formatInvoiceNumber } from "@/domain/numbering";
import { formatMoney } from "@/domain/money";
import { formatDateFr } from "@/domain/dates";
import { PAYMENT_METHOD_PDF } from "@/pdf/paymentMethods";
import { Badge, Button, Card, Checkbox, PageHeader, Select, Table } from "@/components/ui";

type Row = ExcelInvoice & { key: string; selected: boolean };

/** Passage d'Excel au site : reprise des factures déjà émises, avec leurs numéros d'origine. */
export function ImportExcelPage() {
  const { company, canManage, isAdmin } = useActiveCompany();
  const [kind, setKind] = useState<VatEntryKind>("sale");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ added: number; duplicates: number } | null>(null);
  const series = useAsync(async () => must(await supabase.from("number_series").select("*").eq("company_id", company.id)) as NumberSeries[], [company.id, saved]);

  const readFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setSaved(null);
    const out: Row[] = [];
    for (const f of Array.from(files)) {
      try {
        const sheets = await readSheetGrids(f);
        let found: ExcelInvoice[] = [];
        for (const s of sheets) {
          const list = parseInvoiceList(s.grid, f.name);
          if (list?.length) { found = list; break; }
          const one = parseInvoiceSheet(s.grid, f.name);
          if (one) { found = [one]; break; }
        }
        if (!found.length) toast.error(`${f.name} : aucune facture reconnue (il faut au moins « N° de facture » et « Total TTC »).`);
        found.forEach((inv, i) => out.push({ ...inv, key: `${f.name}-${i}-${Math.random()}`, selected: Boolean(inv.number && inv.ttc !== null) }));
      } catch (err) {
        toast.error(`${f.name} : ${errorMessage(err)}`);
      }
    }
    setRows((r) => [...r, ...out]);
    setBusy(false);
  };

  const selected = rows.filter((r) => r.selected);
  const save = async () => {
    setBusy(true);
    let added = 0, duplicates = 0;
    try {
      for (const r of selected) {
        const res = await supabase.from("vat_entries").insert({
          company_id: company.id, kind, status: "to_review", source: "import", source_file: r.source,
          invoice_number: r.number, invoice_date: r.date, party_name: r.clientName, party_ice: r.clientIce,
          total_ht: r.ht, total_vat: r.vat, total_ttc: r.ttc, vat_rate_bp: r.rateBp, payment_mode: r.paymentMode,
          issues: ["Reprise depuis Excel", ...r.issues],
        });
        if (res.error?.code === "23505") duplicates++;
        else if (res.error) throw new Error(`${r.number ?? r.source} : ${res.error.message}`);
        else added++;
      }
      toast.success(`${added} facture(s) ajoutée(s) au journal, à contrôler puis valider.`);
      if (duplicates) toast.warning(`${duplicates} facture(s) déjà présente(s) dans le journal : ignorée(s).`);
      setSaved({ added, duplicates });
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  // Dernier numéro par format → proposer de continuer la numérotation dans le site.
  const continuations = useMemo(() => {
    if (kind !== "sale") return [];
    const best = new Map<string, { format: string; seq: number; year: number | null; resetYearly: boolean; last: string; count: number }>();
    for (const r of rows) {
      if (!r.number) continue;
      const d = deriveSeriesFromNumber(r.number, r.date ? Number(r.date.slice(0, 4)) : undefined);
      if (!d) continue;
      const cur = best.get(d.format);
      const better = !cur || (d.year ?? 0) > (cur.year ?? 0) || ((d.year ?? 0) === (cur.year ?? 0) && d.seq > cur.seq);
      const count = (cur?.count ?? 0) + 1;
      if (better) best.set(d.format, { format: d.format, seq: d.seq, year: d.year, resetYearly: d.resetYearly, last: r.number.trim().toUpperCase(), count });
      else if (cur) cur.count = count;
    }
    return [...best.values()].sort((a, b) => b.count - a.count);
  }, [rows, kind]);

  const createSeries = async (c: (typeof continuations)[number]) => {
    try {
      const names = new Set((series.data ?? []).map((s) => s.name));
      let name = `Reprise ${c.format.replace(/\{[^}]+\}/g, "").replace(/[^A-Z0-9]+/gi, " ").trim() || "Excel"}`;
      for (let i = 2; names.has(name); i++) name = `${name.replace(/ \d+$/, "")} ${i}`;
      must(await supabase.from("number_series").insert({
        company_id: company.id, name, format: c.format, next_seq: c.seq + 1, reset_yearly: c.resetYearly, current_year: c.resetYearly ? c.year : null,
      }));
      toast.success(`Série « ${name} » créée : la prochaine facture validée sera ${formatInvoiceNumber(c.format, c.seq + 1, `${c.year ?? new Date().getFullYear()}-06-01`)}.`);
      void series.reload();
    } catch (err) { toast.error(errorMessage(err)); }
  };

  // Série existante en retard (ex. « Factures » à FA0001 alors qu'Excel est arrivé à FA0057) : on la fait avancer.
  const advanceSeries = async (sr: NumberSeries, c: (typeof continuations)[number]) => {
    try {
      must(await supabase.from("number_series").update({ next_seq: c.seq + 1, current_year: c.resetYearly ? c.year : sr.current_year }).eq("id", sr.id));
      toast.success(`La série « ${sr.name} » continue à partir de ${formatInvoiceNumber(c.format, c.seq + 1, `${c.year ?? new Date().getFullYear()}-06-01`)}.`);
      void series.reload();
    } catch (err) { toast.error(errorMessage(err)); }
  };

  return (
    <>
      <PageHeader
        title="Importation Excel"
        description="Passage d'Excel au site : reprenez vos factures déjà émises, avec leurs numéros d'origine, puis continuez la numérotation là où vous l'aviez laissée."
      />
      <Card>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Type</span>
            <Select value={kind} onChange={(e) => setKind(e.target.value as VatEntryKind)} className="w-52">
              <option value="sale">Ventes (mes factures)</option>
              <option value="purchase">Achats (factures fournisseurs)</option>
            </Select>
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-ink-800 px-4 py-2 text-sm font-medium text-white hover:bg-ink-700">
            <FileSpreadsheet className="size-4" /> Choisir des fichiers Excel
            <input type="file" multiple accept=".xlsx,.xls,.xlsm,.csv" className="sr-only" disabled={busy}
              onChange={(e) => { void readFiles(e.target.files); e.target.value = ""; }} />
          </label>
          {rows.length > 0 && <Button variant="ghost" onClick={() => { setRows([]); setSaved(null); }}>Vider la liste</Button>}
        </div>
        <p className="border-t border-line px-4 py-3 text-xs text-muted">
          Accepté : un fichier par facture (vos modèles FERCIM, NOVASTRO, NORD… avec « N° de facture », « Date », « Raison sociale », « ICE », « Total HT », « TVA », « Total TTC »),
          ou une liste avec une ligne par facture et des colonnes N° facture, Date, Client, ICE, HT, TVA, TTC. Plusieurs fichiers à la fois.
        </p>
      </Card>

      {rows.length > 0 && (
        <Card className="mt-4" title={`${rows.length} facture(s) lue(s) — ${selected.length} sélectionnée(s)`}
          actions={<Button loading={busy} disabled={!selected.length || Boolean(saved)} onClick={save}>Ajouter au journal des {kind === "sale" ? "ventes" : "achats"}</Button>}>
          <Table>
            <thead><tr><th /><th>N° facture</th><th>Date</th><th>Client</th><th>ICE</th><th className="text-right">HT</th><th className="text-right">TVA</th><th className="text-right">TTC</th><th>Paiement</th><th>Fichier / remarques</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td><Checkbox label="" checked={r.selected} disabled={Boolean(saved)} onChange={(v) => setRows((all) => all.map((x) => (x.key === r.key ? { ...x, selected: v } : x)))} /></td>
                  <td className="num font-medium">{r.number ?? "—"}</td>
                  <td className="num">{formatDateFr(r.date) || "—"}</td>
                  <td>{r.clientName ?? "—"}</td>
                  <td className="num">{r.clientIce ?? "—"}</td>
                  <td className="num text-right">{r.ht !== null ? formatMoney(r.ht) : "—"}</td>
                  <td className="num text-right">{r.vat !== null ? formatMoney(r.vat) : "—"}</td>
                  <td className="num text-right font-medium">{r.ttc !== null ? formatMoney(r.ttc) : "—"}</td>
                  <td>{r.paymentMode ? PAYMENT_METHOD_PDF[r.paymentMode] ?? r.paymentMode : "—"}</td>
                  <td className="text-xs">
                    <div className="text-muted">{r.source}</div>
                    {r.issues.map((i) => <div key={i} className="text-saffron-700">{i}</div>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {saved && (
            <div className="flex flex-wrap items-center gap-3 border-t border-line p-4 text-sm">
              <Badge tone="ok">{saved.added} ajoutée(s)</Badge>
              {saved.duplicates > 0 && <Badge tone="warn">{saved.duplicates} déjà présente(s)</Badge>}
              <Link to="/tva/controle"><Button size="sm" variant="secondary" icon={<ListChecks className="size-3.5" />}>Contrôler et valider</Button></Link>
            </div>
          )}
        </Card>
      )}

      {continuations.length > 0 && (
        <Card className="mt-4" title="Continuer votre numérotation dans le site">
          <div className="space-y-2 p-4 text-sm">
            <p className="text-muted">Pour chaque série de numéros trouvée dans vos fichiers, le site peut reprendre juste après le dernier numéro. Les factures créées dans le site suivront alors sans trou.</p>
            {continuations.map((c) => {
              const exists = (series.data ?? []).find((s) => s.format === c.format);
              const next = formatInvoiceNumber(c.format, c.seq + 1, `${c.year ?? new Date().getFullYear()}-06-01`);
              return (
                <div key={c.format} className="flex flex-wrap items-center gap-3 rounded-md border border-line p-3">
                  <span className="num font-medium">{c.format}</span>
                  <span>dernier numéro : <b className="num">{c.last}</b> ({c.count} facture(s))</span>
                  <span>→ prochain : <b className="num">{next}</b></span>
                  {exists ? (
                    exists.next_seq > c.seq && (!c.resetYearly || exists.current_year === null || (exists.current_year ?? 0) >= (c.year ?? 0))
                      ? <Badge tone="ok">Série « {exists.name} » déjà à jour (prochain n° {exists.next_seq})</Badge>
                      : <>
                          <Badge tone="warn">Série « {exists.name} » en retard (prochain n° {exists.next_seq})</Badge>
                          {isAdmin && <Button size="sm" onClick={() => advanceSeries(exists, c)}>Continuer à partir de {next}</Button>}
                        </>
                  ) : canManage && <Button size="sm" onClick={() => createSeries(c)}>Créer la série et continuer</Button>}
                </div>
              );
            })}
            <p className="text-xs text-muted">Pour qu'un client utilise sa série automatiquement : Clients → Modifier → « Numérotation des factures de ce client ».</p>
          </div>
        </Card>
      )}
    </>
  );
}
