import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Star } from "lucide-react";
import { supabase, must, errorMessage } from "@/lib/supabase";
import { useActiveCompany } from "@/lib/session";
import { useAsync } from "@/lib/hooks";
import type { CurrencyLabel, NumberSeries, RoundingMode } from "@/lib/types";
import { formatRate, parseQuantity } from "@/domain/money";
import { deriveSeriesFromNumber, formatInvoiceNumber, validateNumberFormat } from "@/domain/numbering";
import { todayIso } from "@/domain/dates";
import { Badge, Button, Card, Checkbox, Dialog, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table } from "@/components/ui";

export function SettingsPage() {
  const { company, isAdmin, canManage, reload } = useActiveCompany();
  const [rates, setRates] = useState<number[]>(company.vat_rates_bp);
  const [newRate, setNewRate] = useState("");
  const [defaultRate, setDefaultRate] = useState(company.default_vat_rate_bp);
  const [rounding, setRounding] = useState<RoundingMode>(company.rounding_mode);
  const [requireIce, setRequireIce] = useState(company.require_client_ice);
  const [allowDiscounts, setAllowDiscounts] = useState(company.allow_discounts);
  const [currency, setCurrency] = useState<CurrencyLabel>(company.currency_label);
  const [terms, setTerms] = useState(company.default_payment_terms ?? "");
  const [dueDays, setDueDays] = useState(String(company.default_due_days));
  const [vatRegime, setVatRegime] = useState(company.vat_regime);
  const [vatPeriod, setVatPeriod] = useState(company.vat_period);
  const [rubrique, setRubrique] = useState(company.default_purchase_rubrique ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRates(company.vat_rates_bp); setDefaultRate(company.default_vat_rate_bp); setRounding(company.rounding_mode);
    setRequireIce(company.require_client_ice); setAllowDiscounts(company.allow_discounts); setCurrency(company.currency_label);
    setTerms(company.default_payment_terms ?? ""); setDueDays(String(company.default_due_days));
    setVatRegime(company.vat_regime); setVatPeriod(company.vat_period); setRubrique(company.default_purchase_rubrique ?? "");
  }, [company]);

  const addRate = () => {
    const v = parseQuantity(newRate);
    if (v === null || v < 0 || v > 100) return toast.error("Taux invalide (0 à 100).");
    const bp = Math.round(v * 100);
    if (rates.includes(bp)) return toast.error("Ce taux existe déjà.");
    setRates([...rates, bp].sort((a, b) => b - a));
    setNewRate("");
  };

  const save = async () => {
    const days = Number(dueDays);
    if (!Number.isInteger(days) || days < 0 || days > 365) return toast.error("Délai d'échéance : 0 à 365 jours.");
    if (!rates.includes(defaultRate)) return toast.error("Le taux par défaut doit faire partie de la liste.");
    setBusy(true);
    try {
      must(await supabase.from("companies").update({
        vat_rates_bp: rates, default_vat_rate_bp: defaultRate, rounding_mode: rounding, require_client_ice: requireIce,
        allow_discounts: allowDiscounts, currency_label: currency, default_payment_terms: terms.trim() || null, default_due_days: days,
        vat_regime: vatRegime, vat_period: vatPeriod, default_purchase_rubrique: rubrique.trim() || null,
      }).eq("id", company.id));
      await reload();
      toast.success("Paramètres enregistrés.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Paramètres"
        description={<>Règles de facturation de <b>{company.legal_name}</b>. Ces réglages ne concernent que cette entreprise.</>}
      />
      {!isAdmin && <p className="mb-4 rounded-md border border-line bg-white p-3 text-sm text-muted">Lecture seule : seuls les administrateurs modifient ces paramètres.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="TVA">
          <div className="space-y-4 p-4">
            <div>
              <div className="mb-1.5 text-[13px] font-medium">Taux autorisés</div>
              <div className="flex flex-wrap gap-1.5">
                {rates.map((r) => (
                  <span key={r} className="inline-flex items-center gap-1 rounded border border-line bg-canvas px-2 py-1 text-sm">
                    {r === 0 ? "0 % (exonéré)" : formatRate(r)}
                    {isAdmin && r !== defaultRate && (
                      <button type="button" className="text-muted hover:text-danger" aria-label={`Retirer ${formatRate(r)}`} onClick={() => setRates(rates.filter((x) => x !== r))}>×</button>
                    )}
                  </span>
                ))}
              </div>
              {isAdmin && (
                <div className="mt-2 flex gap-2">
                  <Input className="w-32" placeholder="Ex. 14" inputMode="decimal" value={newRate} onChange={(e) => setNewRate(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRate()} />
                  <Button variant="secondary" onClick={addRate}>Ajouter</Button>
                </div>
              )}
              <p className="mt-2 text-xs text-muted">Vérifiez les taux applicables à votre activité auprès de votre comptable ou de la DGI. Un produit ne peut utiliser qu'un taux de cette liste.</p>
            </div>
            <Field label="Taux par défaut (nouveaux produits)">
              <Select value={defaultRate} disabled={!isAdmin} onChange={(e) => setDefaultRate(Number(e.target.value))}>
                {rates.map((r) => <option key={r} value={r}>{formatRate(r)}</option>)}
              </Select>
            </Field>
            <Field label="Règle d'arrondi" hint="Dans les deux cas : HT + TVA = TTC au centime, et le TTC est la somme exacte des lignes.">
              <Select value={rounding} disabled={!isAdmin} onChange={(e) => setRounding(e.target.value as RoundingMode)}>
                <option value="per_rate">Par taux : HT et TVA calculés sur le total TTC de chaque taux (recommandé)</option>
                <option value="per_line">Par ligne : HT et TVA arrondis ligne par ligne puis additionnés</option>
              </Select>
            </Field>
          </div>
        </Card>

        <Card title="Facturation">
          <div className="space-y-3 p-4">
            <Checkbox label="ICE du client obligatoire pour valider une facture" checked={requireIce} disabled={!isAdmin} onChange={setRequireIce} />
            <Checkbox label="Autoriser les remises" hint="Accordées uniquement par un administrateur ou un comptable, tracées sur la ligne." checked={allowDiscounts} disabled={!isAdmin} onChange={setAllowDiscounts} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Devise affichée">
                <Select value={currency} disabled={!isAdmin} onChange={(e) => setCurrency(e.target.value as CurrencyLabel)}>
                  <option value="DH">DH</option><option value="DHS">DHS</option><option value="MAD">MAD</option>
                </Select>
              </Field>
              <Field label="Échéance par défaut (jours)">
                <Input type="number" min={0} max={365} value={dueDays} disabled={!isAdmin} onChange={(e) => setDueDays(e.target.value)} />
              </Field>
            </div>
            <Field label="Conditions de paiement par défaut">
              <Input value={terms} disabled={!isAdmin} onChange={(e) => setTerms(e.target.value)} placeholder="Ex. 30 jours fin de mois" />
            </Field>
            <p className="text-xs text-muted">
              Mentions légales, coordonnées bancaires et affichage du téléphone / e-mail : <Link to="/entreprises" className="underline">fiche entreprise</Link>.
              Catégories de produits : <Link to="/catalogue" className="underline">catalogue</Link>. Mise en page : <Link to="/modeles" className="underline">modèles</Link>.
            </p>
          </div>
        </Card>
      </div>

      <Card title="Journal TVA et déclaration" className="mt-4">
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <Field label="Régime de TVA" hint="Encaissement : TVA due à la date de paiement. Débits : à la date de facture.">
            <Select value={vatRegime} disabled={!isAdmin} onChange={(e) => setVatRegime(e.target.value as typeof vatRegime)}>
              <option value="encaissement">Encaissement</option><option value="debit">Débits</option>
            </Select>
          </Field>
          <Field label="Périodicité de déclaration">
            <Select value={vatPeriod} disabled={!isAdmin} onChange={(e) => setVatPeriod(e.target.value as typeof vatPeriod)}>
              <option value="mensuel">Mensuelle</option><option value="trimestriel">Trimestrielle</option>
            </Select>
          </Field>
          <Field label="Rubrique par défaut des achats" hint="Reprise sur chaque facture d'achat importée (modifiable ligne par ligne).">
            <Input value={rubrique} disabled={!isAdmin} onChange={(e) => setRubrique(e.target.value)} placeholder="Ex. 146" />
          </Field>
        </div>
        <p className="border-t border-line px-4 py-3 text-xs text-muted">
          Ces choix servent à préparer les données ; vérifiez-les avec votre comptable ou la DGI. Aucune déclaration n'est transmise par l'application.
        </p>
      </Card>

      {isAdmin && <div className="mt-4"><Button loading={busy} onClick={save}>Enregistrer les paramètres</Button></div>}

      <SeriesCard canCreate={canManage} isAdmin={isAdmin} />
    </>
  );
}

function SeriesCard({ canCreate, isAdmin }: { canCreate: boolean; isAdmin: boolean }) {
  const { company } = useActiveCompany();
  const list = useAsync(async () => {
    const series = must(await supabase.from("number_series").select("*").eq("company_id", company.id).order("name")) as NumberSeries[];
    const used = must(await supabase.from("invoices").select("series_id").eq("company_id", company.id).neq("status", "draft").limit(10000)) as { series_id: string }[];
    return { series, used: new Set(used.map((u) => u.series_id)) };
  }, [company.id]);
  const [edit, setEdit] = useState<NumberSeries | "new" | null>(null);

  if (list.error) return <ErrorBox message={list.error} onRetry={list.reload} />;
  return (
    <Card className="mt-6" title="Séries de numérotation" actions={canCreate && <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => setEdit("new")}>Nouvelle série</Button>}>
      {list.loading && !list.data ? <Spinner /> : (
        <Table>
          <thead><tr><th>Nom</th><th>Format</th><th>Prochain numéro</th><th>Remise à 1 chaque année</th><th /></tr></thead>
          <tbody>
            {list.data!.series.map((s) => {
              const used = list.data!.used.has(s.id);
              const year = new Date().getFullYear();
              const next = s.reset_yearly && s.current_year !== null && s.current_year !== year ? 1 : s.next_seq;
              return (
                <tr key={s.id}>
                  <td className="font-medium">{s.name} {s.is_default && <Badge tone="ok">Par défaut</Badge>}</td>
                  <td className="num">{s.format}</td>
                  <td className="num">{formatInvoiceNumber(s.format, next, todayIso())}</td>
                  <td>{s.reset_yearly ? "Oui" : "Non"}</td>
                  <td className="text-right">
                    {isAdmin && !s.is_default && (
                      <Button size="sm" variant="ghost" icon={<Star className="size-3.5" />} onClick={async () => {
                        try { must(await supabase.rpc("set_default_series", { p_series: s.id })); void list.reload(); } catch (e) { toast.error(errorMessage(e)); }
                      }}>Par défaut</Button>
                    )}
                    {isAdmin && !used && <Button size="sm" variant="ghost" onClick={() => setEdit(s)}>Modifier</Button>}
                    {used && <span className="text-xs text-muted">Utilisée — verrouillée</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <p className="border-t border-line px-4 py-3 text-xs text-muted">
        Le numéro définitif est attribué à la validation, dans l'ordre chronologique, sans trou ni doublon. Avant la première facture, vous pouvez fixer le
        numéro de départ (reprise d'une numérotation existante). Ensuite, la série est verrouillée : pour changer de format, créez une nouvelle série.
      </p>
      <SeriesDialog value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void list.reload(); }} />
    </Card>
  );
}

function SeriesDialog({ value, onClose, onSaved }: { value: NumberSeries | "new" | null; onClose: () => void; onSaved: () => void }) {
  const { company } = useActiveCompany();
  const editing = value && value !== "new" ? value : null;
  const [name, setName] = useState("");
  const [format, setFormat] = useState("FA{SEQ:4}/{YYYY}");
  const [start, setStart] = useState("1");
  const [reset, setReset] = useState(true);
  const [lastNumber, setLastNumber] = useState("");
  const [currentYear, setCurrentYear] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const derived = lastNumber.trim() ? deriveSeriesFromNumber(lastNumber, new Date().getFullYear()) : null;
  const applyDerived = () => {
    if (!derived) return;
    setFormat(derived.format);
    setStart(String(derived.nextSeq));
    setReset(derived.resetYearly);
    setCurrentYear(derived.year);
  };
  useEffect(() => {
    if (!value) return;
    setName(editing?.name ?? ""); setFormat(editing?.format ?? "FA{SEQ:4}/{YYYY}");
    setStart(String(editing?.next_seq ?? 1)); setReset(editing?.reset_yearly ?? true);
    setLastNumber(""); setCurrentYear(editing?.current_year ?? null);
  }, [value, editing]);
  const fmtErr = validateNumberFormat(format);
  const startNum = Number(start);
  const startErr = !Number.isInteger(startNum) || startNum < 1 ? "Entier ≥ 1" : null;

  return (
    <Dialog
      open={value !== null}
      onClose={onClose}
      title={editing ? `Modifier la série « ${editing.name} »` : "Nouvelle série"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Retour</Button>
          <Button loading={busy} disabled={!name.trim() || Boolean(fmtErr) || Boolean(startErr)} onClick={async () => {
            setBusy(true);
            try {
              const row = { name: name.trim(), format, next_seq: startNum, reset_yearly: reset, current_year: reset ? currentYear : null };
              if (editing) must(await supabase.from("number_series").update(row).eq("id", editing.id));
              else must(await supabase.from("number_series").insert({ ...row, company_id: company.id }));
              toast.success("Série enregistrée.");
              onSaved();
            } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
          }}>Enregistrer</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Nom" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Factures, Avoirs, Export" /></Field>
        <div className="rounded-md border border-line bg-canvas p-3">
          <Field label="Reprendre ma numérotation : dernier numéro utilisé" hint={lastNumber.trim() ? (derived
            ? <>Format reconnu <b className="num">{derived.format}</b> · prochain numéro <b className="num">{formatInvoiceNumber(derived.format, derived.nextSeq, `${derived.year ?? new Date().getFullYear()}-01-01`)}</b>{derived.year ? <> · remise à 1 en janvier {derived.year + 1}</> : null}</>
            : <span className="text-danger">Numéro non reconnu : saisissez le format manuellement.</span>) : "Ex. NOV0100/2025A, FA2026-0042, F-2026/0458"}>
            <div className="flex gap-2">
              <Input value={lastNumber} onChange={(e) => setLastNumber(e.target.value)} className="num" placeholder="NOV0100/2025A" />
              <Button variant="secondary" disabled={!derived} onClick={applyDerived}>Appliquer</Button>
            </div>
          </Field>
        </div>
        <Field label="Format" required error={fmtErr} hint={!fmtErr ? <>Aperçu : <b className="num">{formatInvoiceNumber(format, Number.isFinite(startNum) && startNum > 0 ? startNum : 1, todayIso())}</b> — jetons {"{SEQ:4}"}, {"{YYYY}"}, {"{YY}"}, {"{MM}"}</> : null}>
          <Input value={format} onChange={(e) => setFormat(e.target.value.toUpperCase().replace("{SEQ:", "{SEQ:"))} className="num" />
        </Field>
        <Field label="Numéro de départ" error={startErr} hint="Pour reprendre une numérotation existante, indiquez le numéro qui suit votre dernière facture.">
          <Input type="number" min={1} value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Checkbox label="Recommencer à 1 au 1er janvier" checked={reset} onChange={setReset} />
      </div>
    </Dialog>
  );
}
