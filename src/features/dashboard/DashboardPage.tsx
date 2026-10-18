import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, FilePlus2, FileStack, FileUp } from "lucide-react";
import { supabase, must } from "@/lib/supabase";
import { useActiveCompany } from "@/lib/session";
import { useAsync } from "@/lib/hooks";
import type { Invoice } from "@/lib/types";
import { formatMoney } from "@/domain/money";
import { formatDateFr, todayIso } from "@/domain/dates";
import { Button, Card, EmptyState, ErrorBox, Input, PageHeader, Select, Spinner, StatusBadge, Table } from "@/components/ui";

interface Stats {
  invoices_count: number; drafts_count: number; sales_ttc: number; sales_ht: number; vat_collected: number;
  paid: number; outstanding: number; overdue_count: number;
  by_month: { month: string; ttc: number; ht: number; vat: number }[];
}

type Period = "month" | "quarter" | "year" | "custom";
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function periodRange(p: Period): [string, string] {
  const d = new Date();
  const y = d.getFullYear();
  const pad = (n: number) => String(n).padStart(2, "0");
  if (p === "month") return [`${y}-${pad(d.getMonth() + 1)}-01`, todayIso()];
  if (p === "quarter") {
    const q = Math.floor(d.getMonth() / 3) * 3;
    return [`${y}-${pad(q + 1)}-01`, todayIso()];
  }
  return [`${y}-01-01`, `${y}-12-31`];
}

export function DashboardPage() {
  const { company } = useActiveCompany();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>("year");
  const [custom, setCustom] = useState<[string, string]>(periodRange("year"));
  const [from, to] = period === "custom" ? custom : periodRange(period);

  const vat = useAsync(async () => must(await supabase.rpc("vat_dashboard", { p_company: company.id, p_from: from, p_to: to })) as {
    purchases_ht: number; purchases_ttc: number; vat_deductible: number; imported_sales_vat: number; to_review: number; with_issues: number;
    imports: { id: string; file_name: string; page_count: number; pages_done: number; invoices_found: number; needs_review: number; status: string; created_at: string }[];
  }, [company.id, from, to]);
  const stats = useAsync(async () => must(await supabase.rpc("dashboard_stats", { p_company: company.id, p_from: from, p_to: to })) as Stats, [company.id, from, to]);
  const recent = useAsync(async () => must(await supabase.from("invoices").select("*, parties!invoices_client_id_fkey(name)").eq("company_id", company.id).order("created_at", { ascending: false }).limit(8)) as (Invoice & { parties: { name: string } | null })[], [company.id]);
  const counts = useAsync(async () => {
    const [clients, products] = await Promise.all([
      supabase.from("parties").select("id", { count: "exact", head: true }).eq("company_id", company.id).eq("kind", "client"),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("company_id", company.id),
    ]);
    return { clients: clients.count ?? 0, products: products.count ?? 0 };
  }, [company.id]);

  const s = stats.data;
  const cur = company.currency_label;
  const gettingStarted = counts.data && (counts.data.clients === 0 || counts.data.products === 0);

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        description={<>{company.legal_name} — chiffres calculés depuis la base, factures validées uniquement (hors brouillons et annulées).</>}
        actions={
          <>
            <Button variant="secondary" icon={<FileUp className="size-4" />} onClick={() => navigate("/tva/import")}>Importer des PDF</Button>
            <Button variant="secondary" icon={<FileStack className="size-4" />} onClick={() => navigate("/lots")}>Lot de commandes</Button>
            <Button icon={<FilePlus2 className="size-4" />} onClick={() => navigate("/factures/nouvelle")}>Nouvelle facture</Button>
          </>
        }
      />

      {gettingStarted && (
        <Card className="mb-4" title="Pour commencer">
          <ol className="list-decimal space-y-1 p-4 pl-9 text-sm">
            <li className={counts.data!.products > 0 ? "text-muted line-through" : ""}>Créez ou importez votre <Link to="/catalogue" className="underline">catalogue de produits</Link> (prix TTC et taux de TVA).</li>
            <li className={counts.data!.clients > 0 ? "text-muted line-through" : ""}>Ajoutez vos <Link to="/clients" className="underline">clients</Link> avec leur ICE.</li>
            <li>Choisissez un <Link to="/modeles" className="underline">modèle de facture</Link> et vérifiez les <Link to="/parametres" className="underline">paramètres</Link> (taux, numérotation).</li>
            <li>Créez votre première <Link to="/factures/nouvelle" className="underline">facture</Link>.</li>
          </ol>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select className="w-48" value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Période">
          <option value="month">Mois en cours</option>
          <option value="quarter">Trimestre en cours</option>
          <option value="year">Année en cours</option>
          <option value="custom">Période personnalisée</option>
        </Select>
        {period === "custom" && (
          <>
            <Input type="date" className="w-40" value={custom[0]} onChange={(e) => setCustom([e.target.value, custom[1]])} aria-label="Du" />
            <Input type="date" className="w-40" value={custom[1]} onChange={(e) => setCustom([custom[0], e.target.value])} aria-label="Au" />
          </>
        )}
        <span className="text-sm text-muted">du {formatDateFr(from)} au {formatDateFr(to)}</span>
      </div>

      {stats.error ? <ErrorBox message={stats.error} onRetry={stats.reload} /> : !s ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Chiffre d'affaires TTC" value={`${formatMoney(s.sales_ttc)} ${cur}`} hero />
            <Stat label="Chiffre d'affaires HT" value={`${formatMoney(s.sales_ht)} ${cur}`} />
            <Stat label="TVA collectée" value={`${formatMoney(s.vat_collected)} ${cur}`} />
            <Stat label="Factures validées" value={String(s.invoices_count)} />
            <Stat label="Encaissé" value={`${formatMoney(s.paid)} ${cur}`} />
            <Stat label="Reste à encaisser" value={`${formatMoney(s.outstanding)} ${cur}`} />
            <Stat label="Factures échues non soldées" value={String(s.overdue_count)} warn={s.overdue_count > 0} />
            <Stat label="Brouillons à valider" value={String(s.drafts_count)} link={s.drafts_count > 0 ? "/factures" : undefined} />
          </div>
          {vat.data && (
            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Achats HT (validés)" value={`${formatMoney(vat.data.purchases_ht)} ${cur}`} />
              <Stat label="TVA déductible" value={`${formatMoney(vat.data.vat_deductible)} ${cur}`} />
              {(() => {
                const net = s.vat_collected + vat.data.imported_sales_vat - vat.data.vat_deductible;
                return <Stat label={net >= 0 ? "TVA nette estimée à payer (collectée − déductible)" : "Crédit de TVA estimé (déductible > collectée)"} value={`${formatMoney(Math.abs(net))} ${cur}`} hero />;
              })()}
              <Stat label="Factures extraites à contrôler" value={String(vat.data.to_review)} warn={vat.data.with_issues > 0} link={vat.data.to_review > 0 ? "/tva/controle" : undefined} />
            </div>
          )}
          <p className="mt-2 text-xs text-muted">
            TVA par date de facture, à titre indicatif. Pour la déclaration selon votre régime (encaissement ou débits), voir <Link to="/tva/declaration" className="underline">Déclaration TVA</Link>.
          </p>
          <MonthlyChart data={s.by_month} currency={cur} />
        </>
      )}

      {vat.data && vat.data.imports.length > 0 && (
        <Card className="mt-6" title="Dernières importations PDF" actions={<Link to="/tva/import" className="text-sm text-ink-700 hover:underline">Importer</Link>}>
          <Table>
            <thead><tr><th>Fichier</th><th>Date</th><th className="text-right">Pages</th><th className="text-right">Factures</th><th className="text-right">À contrôler</th></tr></thead>
            <tbody>
              {vat.data.imports.map((i) => (
                <tr key={i.id}>
                  <td className="max-w-xs truncate"><Link to={`/tva/controle?import=${i.id}`} className="text-ink-800 hover:underline">{i.file_name}</Link>{i.status !== "done" && <span className="ml-2 text-xs text-saffron-700">(interrompu)</span>}</td>
                  <td className="num">{new Date(i.created_at).toLocaleDateString("fr-MA")}</td>
                  <td className="num text-right">{i.pages_done}/{i.page_count}</td>
                  <td className="num text-right">{i.invoices_found}</td>
                  <td className="num text-right">{i.needs_review}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Card className="mt-6" title="Dernières factures" actions={<Link to="/factures" className="text-sm text-ink-700 hover:underline">Toutes les factures</Link>}>
        {recent.loading && !recent.data ? <Spinner /> : (recent.data ?? []).length === 0 ? (
          <EmptyState title="Aucune facture" />
        ) : (
          <Table>
            <thead><tr><th>N°</th><th>Date</th><th>Client</th><th className="text-right">TTC</th><th>Statut</th></tr></thead>
            <tbody>
              {recent.data!.map((i) => (
                <tr key={i.id}>
                  <td><Link to={`/factures/${i.id}`} className="font-medium text-ink-800 hover:underline">{i.number ?? "Brouillon"}</Link></td>
                  <td className="num">{formatDateFr(i.issue_date)}</td>
                  <td>{i.client_snapshot?.name ?? i.parties?.name ?? "—"}</td>
                  <td className="num text-right">{formatMoney(i.total_ttc)}</td>
                  <td><StatusBadge status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value, hero, warn, link }: { label: string; value: string; hero?: boolean; warn?: boolean; link?: string }) {
  const body = (
    <div className={`h-full rounded-lg border bg-white px-4 py-3 ${hero ? "border-ink-200" : "border-line"} ${link ? "hover:border-ink-300" : ""}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {warn && <AlertTriangle className="size-3.5 text-saffron-600" aria-label="Attention" />}
        {label}
      </div>
      <div className={`num mt-0.5 font-semibold text-ink-900 ${hero ? "text-2xl" : "text-lg"}`}>{value}</div>
    </div>
  );
  return link ? <Link to={link}>{body}</Link> : body;
}

/** Barres mensuelles du CA TTC : une seule série, une seule teinte, info-bulle au survol, table accessible. */
function MonthlyChart({ data, currency }: { data: Stats["by_month"]; currency: string }) {
  const max = useMemo(() => Math.max(1, ...data.map((d) => d.ttc)), [data]);
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return null;
  const label = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
  return (
    <Card className="mt-4" title="Chiffre d'affaires TTC par mois">
      <figure className="p-4">
        <div className="relative flex h-48 items-end gap-2 border-b border-line" role="img" aria-label="Histogramme du chiffre d'affaires TTC par mois">
          {[0.5, 1].map((g) => <div key={g} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line/70" style={{ bottom: `${g * 100}%` }} />)}
          {data.map((d, i) => (
            <div key={d.month} className="relative flex h-full max-w-14 flex-1 items-end justify-center"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <div className={`w-full max-w-9 rounded-t-[4px] ${hover === i ? "bg-ink-500" : "bg-ink-600"}`} style={{ height: `${(d.ttc / max) * 100}%`, minHeight: 2 }} />
              {hover === i && (
                <div className="absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border border-line bg-white px-2 py-1 text-xs shadow">
                  <div className="font-medium">{label(d.month)}</div>
                  <div className="num">TTC {formatMoney(d.ttc)} {currency}</div>
                  <div className="num text-muted">HT {formatMoney(d.ht)} · TVA {formatMoney(d.vat)}</div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-2">
          {data.map((d) => <div key={d.month} className="max-w-14 flex-1 text-center text-[11px] text-muted">{label(d.month)}</div>)}
        </div>
        <figcaption className="mt-2 text-xs text-muted">Maximum : <span className="num">{formatMoney(max)} {currency}</span>. Survolez une barre pour le détail.</figcaption>
        <table className="sr-only">
          <caption>Chiffre d'affaires par mois</caption>
          <thead><tr><th>Mois</th><th>TTC</th><th>HT</th><th>TVA</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.month}><td>{label(d.month)}</td><td>{formatMoney(d.ttc)}</td><td>{formatMoney(d.ht)}</td><td>{formatMoney(d.vat)}</td></tr>)}</tbody>
        </table>
      </figure>
    </Card>
  );
}
