import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Download } from "lucide-react";
import { supabase, must, errorMessage } from "@/lib/supabase";
import { useActiveCompany } from "@/lib/session";
import { useAsync } from "@/lib/hooks";
import type { VatDeclaration } from "@/lib/types";
import { formatMoney, formatRate } from "@/domain/money";
import { formatDateFr } from "@/domain/dates";
import { Button, Card, Checkbox, ErrorBox, PageHeader, Spinner, Table } from "@/components/ui";
import { PeriodPicker, initialPeriod, type PeriodValue } from "./PeriodPicker";
import { exportVatXlsx } from "./JournalPage";

const rateLabel = (r: number) => (r < 0 ? "Taux non précisé" : r === 0 ? "0 % / exonéré" : formatRate(r));

export function DeclarationPage() {
  const { company } = useActiveCompany();
  const [period, setPeriod] = useState<PeriodValue>(() => initialPeriod(company.vat_period));
  const [includeReview, setIncludeReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = useAsync(async () => must(await supabase.rpc("vat_declaration", { p_company: company.id, p_from: period.from, p_to: period.to })) as VatDeclaration,
    [company.id, period.from, period.to]);
  const cur = company.currency_label;
  const x = d.data;

  return (
    <>
      <PageHeader
        title="Déclaration TVA"
        description={<>Préparation des données de la période. <b>Document indicatif</b> : ce n'est pas une déclaration officielle ; faites vérifier les montants et les règles applicables avant tout dépôt (SIMPL-TVA).</>}
        actions={
          <Button icon={<Download className="size-4" />} loading={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await exportVatXlsx(company.id, company.legal_name, period.from, period.to, includeReview);
              toast.success(`Classeur généré (${r.sales} ventes, ${r.purchases} achats).`);
            } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
          }}>Exporter (Excel)</Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker value={period} onChange={setPeriod} />
        <Checkbox label="Inclure une feuille « À contrôler » dans l'export" checked={includeReview} onChange={setIncludeReview} />
      </div>

      {d.error ? <ErrorBox message={d.error} onRetry={d.reload} /> : !x ? <Spinner /> : (
        <>
          <p className="mb-3 text-sm text-muted">
            Du {formatDateFr(x.from)} au {formatDateFr(x.to)} — régime {x.regime === "encaissement" ? "de l'encaissement (TVA rattachée aux paiements)" : "des débits (TVA rattachée à la date de facture)"}.{" "}
            <Link to="/parametres" className="underline">Modifier</Link>
          </p>

          {(x.to_review > 0 || x.unpaid_entries > 0) && (
            <div className="mb-4 space-y-1 rounded-md border border-saffron-100 bg-saffron-50 p-3 text-sm text-saffron-700">
              {x.to_review > 0 && <div className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> {x.to_review} écriture(s) de la période sont encore à contrôler et ne sont PAS comptées. <Link className="font-medium underline" to="/tva/controle">Les contrôler</Link></div>}
              {x.unpaid_entries > 0 && <div className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> {x.unpaid_entries} écriture(s) validée(s) n'ont pas de date de paiement : en régime de l'encaissement, elles ne sont pas comptées.</div>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Ventes HT" value={x.sales_ht} cur={cur} />
            <Stat label="TVA collectée" value={x.vat_collected} cur={cur} />
            <Stat label="Achats HT (déductibles)" value={x.purchases_ht} cur={cur} />
            <Stat label="TVA déductible" value={x.vat_deductible} cur={cur} />
          </div>
          <div className={`mt-3 rounded-lg border p-4 ${x.net_vat >= 0 ? "border-ink-200 bg-white" : "border-success/30 bg-success/5"}`}>
            <div className="text-sm text-muted">{x.net_vat >= 0 ? "TVA nette à payer (estimation)" : "Crédit de TVA (estimation)"} = TVA collectée − TVA déductible</div>
            <div className="num text-2xl font-semibold text-ink-900">{formatMoney(Math.abs(x.net_vat))} {cur}</div>
            {x.vat_non_deductible > 0 && <div className="mt-1 text-xs text-muted">TVA non déductible écartée : {formatMoney(x.vat_non_deductible)} {cur}</div>}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title="TVA collectée par taux">
              <Table>
                <thead><tr><th>Taux</th><th className="text-right">Base HT</th><th className="text-right">TVA</th></tr></thead>
                <tbody>
                  {x.sales.length === 0 ? <tr><td colSpan={3} className="text-muted">Aucune vente sur la période.</td></tr> : x.sales.map((s) => (
                    <tr key={s.rate_bp}><td>{rateLabel(s.rate_bp)}</td><td className="num text-right">{formatMoney(s.ht)}</td><td className="num text-right">{formatMoney(s.vat)}</td></tr>
                  ))}
                </tbody>
                <tfoot><tr className="font-semibold [&>td]:px-3 [&>td]:py-2"><td>Total</td><td className="num text-right">{formatMoney(x.sales_ht)}</td><td className="num text-right">{formatMoney(x.vat_collected)}</td></tr></tfoot>
              </Table>
            </Card>
            <Card title="TVA déductible par nature et par taux">
              <Table>
                <thead><tr><th>Nature</th><th>Taux</th><th className="text-right">Base HT</th><th className="text-right">TVA</th></tr></thead>
                <tbody>
                  {x.purchases.length === 0 ? <tr><td colSpan={4} className="text-muted">Aucun achat déductible validé.</td></tr> : x.purchases.map((p) => (
                    <tr key={`${p.deduction_type}${p.rate_bp}`}>
                      <td>{p.deduction_type === "immobilisations" ? "Immobilisations" : "Charges (biens et services)"}</td>
                      <td className={p.rate_bp < 0 ? "text-saffron-700" : ""}>{rateLabel(p.rate_bp)}</td>
                      <td className="num text-right">{formatMoney(p.ht)}</td><td className="num text-right">{formatMoney(p.vat)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="font-semibold [&>td]:px-3 [&>td]:py-2"><td colSpan={2}>Total</td><td className="num text-right">{formatMoney(x.purchases_ht)}</td><td className="num text-right">{formatMoney(x.vat_deductible)}</td></tr></tfoot>
              </Table>
            </Card>
          </div>
          <p className="mt-4 text-xs text-muted">
            Les règles de déduction (prorata, limitations, exclusions, délais) dépendent de votre situation : marquez « non déductible » les achats concernés
            dans le contrôle, et faites valider la déclaration par votre comptable.
          </p>
        </>
      )}
    </>
  );
}

function Stat({ label, value, cur }: { label: string; value: number; cur: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="num text-lg font-semibold text-ink-900">{formatMoney(value)} {cur}</div>
    </div>
  );
}
