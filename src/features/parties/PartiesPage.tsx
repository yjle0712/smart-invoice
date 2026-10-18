import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { saveAs } from "file-saver";
import { Download, Plus, Search } from "lucide-react";
import { supabase, must, errorMessage } from "@/lib/supabase";
import { useActiveCompany } from "@/lib/session";
import { deriveSeriesFromNumber, formatInvoiceNumber } from "@/domain/numbering";
import { todayIso } from "@/domain/dates";
import type { NumberSeries } from "@/lib/types";
import { ImportFromCompanyButton, ShareCheckbox, getSharePref, shareToOthers, useOtherCompanies } from "@/features/companies/sharing";
import { useAsync, useDebounced } from "@/lib/hooks";
import type { Invoice, Party, PartyKind } from "@/lib/types";
import { formatMoney } from "@/domain/money";
import { formatDateFr } from "@/domain/dates";
import { isValidIce, orNull, safeFileName } from "@/lib/utils";
import { buildWorkbook } from "@/lib/excel";
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, Dialog, EmptyState, ErrorBox, Field, Input,
  PageHeader, Select, Spinner, StatusBadge, Table, Textarea,
} from "@/components/ui";

const LABELS: Record<PartyKind, { title: string; one: string; desc: string }> = {
  client: { title: "Clients", one: "client", desc: "Fiches clients, ICE et historique de facturation." },
  supplier: { title: "Fournisseurs", one: "fournisseur", desc: "Fiches fournisseurs, utilisées par le journal des achats." },
};

export function PartiesPage({ kind }: { kind: PartyKind }) {
  const { company } = useActiveCompany();
  const L = LABELS[kind];
  const [q, setQ] = useState("");
  const query = useDebounced(q);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Party | "new" | null>(null);
  const [viewing, setViewing] = useState<Party | null>(null);
  const [archiving, setArchiving] = useState<Party | null>(null);

  const list = useAsync(async () => {
    let req = supabase.from("parties").select("*").eq("company_id", company.id).eq("kind", kind).order("name");
    if (!showArchived) req = req.eq("archived", false);
    if (query.trim()) {
      const s = query.trim().replace(/[%,()]/g, " ");
      req = req.or(`name.ilike.%${s}%,ice.ilike.%${s}%,city.ilike.%${s}%`);
    }
    return must(await req.limit(500)) as Party[];
  }, [company.id, kind, showArchived, query]);
  const seriesList = useAsync(async () => (kind === "client" ? must(await supabase.from("number_series").select("id, name, format").eq("company_id", company.id)) as Pick<NumberSeries, "id" | "name" | "format">[] : []), [company.id, kind, editing]);
  const seriesFormat = (id: string | null) => (id ? seriesList.data?.find((x) => x.id === id)?.format ?? "" : "");

  const exportXlsx = () => {
    const rows = list.data ?? [];
    const blob = buildWorkbook([{
      name: L.title,
      rows,
      columns: [
        { header: "Raison sociale", value: (p: Party) => p.name, width: 34 },
        { header: "ICE", value: (p: Party) => p.ice, width: 18 },
        { header: "IF", value: (p: Party) => p.if_number },
        { header: "RC", value: (p: Party) => p.rc },
        { header: "Adresse", value: (p: Party) => p.address, width: 34 },
        { header: "Ville", value: (p: Party) => p.city, width: 14 },
        { header: "Téléphone", value: (p: Party) => p.phone, width: 14 },
        { header: "E-mail", value: (p: Party) => p.email, width: 24 },
        { header: "Conditions de paiement", value: (p: Party) => p.payment_terms, width: 20 },
        { header: "Archivé", value: (p: Party) => (p.archived ? "Oui" : "Non") },
      ],
    }]);
    saveAs(blob, safeFileName(L.title, company.legal_name) + ".xlsx");
  };

  return (
    <>
      <PageHeader
        title={L.title}
        description={L.desc}
        actions={
          <>
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={exportXlsx} disabled={!list.data?.length}>
              Exporter en Excel
            </Button>
            <ImportFromCompanyButton what="parties" onDone={() => void list.reload()} />
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Nouveau {L.one}</Button>
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
            <Input className="pl-8" placeholder="Rechercher : nom, ICE, ville" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Checkbox label="Afficher les archivés" checked={showArchived} onChange={setShowArchived} />
        </div>
        {list.loading && !list.data ? <Spinner /> : list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> :
          list.data?.length === 0 ? (
            <EmptyState
              title={query ? "Aucun résultat" : `Aucun ${L.one} pour l'instant`}
              action={!query && <Button onClick={() => setEditing("new")}>Ajouter un {L.one}</Button>}
            />
          ) : (
            <Table>
              <thead><tr><th>Raison sociale</th><th>ICE</th><th>Ville</th><th>Paiement</th>{kind === "client" && <th>Numérotation</th>}<th /></tr></thead>
              <tbody>
                {list.data!.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <button type="button" className="font-medium text-ink-800 hover:underline" onClick={() => setViewing(p)}>{p.name}</button>
                      {p.archived && <span className="ml-2"><Badge>Archivé</Badge></span>}
                    </td>
                    <td className="num">{p.ice ?? <span className="text-saffron-700">Manquant</span>}</td>
                    <td>{p.city}</td>
                    <td>{p.payment_terms}</td>
                    {kind === "client" && <td className="num text-xs">{seriesFormat(p.default_series_id) || <span className="text-muted">Par défaut</span>}</td>}
                    <td className="text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Modifier</Button>
                      <Button size="sm" variant="ghost" onClick={() => setArchiving(p)}>{p.archived ? "Restaurer" : "Archiver"}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
      </Card>

      <PartyDialog
        kind={kind}
        party={editing === "new" ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); void list.reload(); }}
      />
      <PartyDetail party={viewing} onClose={() => setViewing(null)} />
      <ConfirmDialog
        open={Boolean(archiving)}
        title={archiving?.archived ? "Restaurer la fiche" : "Archiver la fiche"}
        message={archiving?.archived
          ? `« ${archiving?.name} » sera de nouveau proposé lors de la saisie.`
          : `« ${archiving?.name} » ne sera plus proposé lors de la saisie. Son historique est conservé.`}
        confirmLabel={archiving?.archived ? "Restaurer" : "Archiver"}
        onClose={() => setArchiving(null)}
        onConfirm={async () => {
          try {
            must(await supabase.from("parties").update({ archived: !archiving!.archived }).eq("id", archiving!.id));
            toast.success(archiving!.archived ? "Fiche restaurée." : "Fiche archivée.");
            setArchiving(null);
            void list.reload();
          } catch (err) { toast.error(errorMessage(err)); }
        }}
      />
    </>
  );
}

type PF = { name: string; ice: string; if_number: string; rc: string; address: string; city: string; phone: string; email: string; payment_terms: string; notes: string };
const emptyPF: PF = { name: "", ice: "", if_number: "", rc: "", address: "", city: "", phone: "", email: "", payment_terms: "", notes: "" };

export function PartyDialog({
  kind, party, open, onClose, onSaved,
}: { kind: PartyKind; party: Party | null; open: boolean; onClose: () => void; onSaved: (p: Party) => void }) {
  const { company, canManage } = useActiveCompany();
  const [f, setF] = useState<PF>(emptyPF);
  const seriesQ = useAsync(async () => (kind === "client" ? must(await supabase.from("number_series").select("*").eq("company_id", company.id).order("name")) as NumberSeries[] : []), [company.id, kind, open]);
  const [seriesId, setSeriesId] = useState("");
  const [newNumber, setNewNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const others = useOtherCompanies();
  const [share, setShare] = useState(getSharePref());
  useEffect(() => {
    if (!open) return;
    setF(party ? {
      name: party.name, ice: party.ice ?? "", if_number: party.if_number ?? "", rc: party.rc ?? "", address: party.address ?? "",
      city: party.city ?? "", phone: party.phone ?? "", email: party.email ?? "", payment_terms: party.payment_terms ?? "", notes: party.notes ?? "",
    } : { ...emptyPF, payment_terms: company.default_payment_terms ?? "" });
    setSeriesId(party?.default_series_id ?? "");
    setNewNumber("");
  }, [open, party, company.default_payment_terms]);
  const set = (k: keyof PF, v: string) => setF((s) => ({ ...s, [k]: v }));
  const currentSeries = (seriesQ.data ?? []).find((s) => s.id === seriesId) ?? null;
  const newPlan = planFromInput(newNumber);
  const uniqueSeriesName = (root: string) => {
    const names = new Set((seriesQ.data ?? []).map((s) => s.name));
    let n = root.slice(0, 60);
    for (let i = 2; names.has(n); i++) n = `${root.slice(0, 55)} ${i}`;
    return n;
  };
  const iceError = f.ice && !isValidIce(f.ice) ? "15 chiffres attendus." : null;
  const iceMissing = kind === "client" && company.require_client_ice && !f.ice;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return toast.error("La raison sociale est obligatoire.");
    if (iceError) return toast.error("ICE : " + iceError);
    setBusy(true);
    try {
      // Nouvelle numérotation pour ce client : créée à partir du dernier numéro (ou du préfixe) saisi.
      let sid: string | null = seriesId || null;
      if (kind === "client" && newPlan) {
        const created = must(await supabase.from("number_series").insert({
          company_id: company.id, name: uniqueSeriesName(`Client ${f.name.trim()}`), format: newPlan.format, next_seq: newPlan.next,
          reset_yearly: newPlan.reset, current_year: newPlan.reset ? newPlan.year : null,
        }).select("id").single()) as { id: string };
        sid = created.id;
      }
      const row = {
        ...(kind === "client" ? { default_series_id: sid } : {}),
        name: f.name.trim(), ice: orNull(f.ice), if_number: orNull(f.if_number), rc: orNull(f.rc), address: orNull(f.address),
        city: orNull(f.city), phone: orNull(f.phone), email: orNull(f.email), payment_terms: orNull(f.payment_terms), notes: orNull(f.notes),
      };
      const saved = party
        ? must(await supabase.from("parties").update(row).eq("id", party.id).select().single())
        : must(await supabase.from("parties").insert({ ...row, company_id: company.id, kind }).select().single());
      toast.success(party ? "Fiche enregistrée." : "Fiche créée.");
      if (!party && share && others.length) {
        const n = await shareToOthers(company.id, others, { partyIds: [(saved as Party).id] });
        if (n) toast.success(`Ajoutée aussi dans ${n} autre(s) entreprise(s).`);
      }
      onSaved(saved as Party);
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
      wide
      title={party ? `Modifier ${party.name}` : kind === "client" ? "Nouveau client" : "Nouveau fournisseur"}
      footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button type="submit" form="party-form" loading={busy}>Enregistrer</Button></>}
    >
      <form id="party-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom ou raison sociale" required className="sm:col-span-2">
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus />
        </Field>
        <Field
          label="ICE"
          error={iceError}
          hint={iceMissing ? "Obligatoire pour valider une facture (règle de l'entreprise)." : "15 chiffres"}
        >
          <Input inputMode="numeric" value={f.ice} onChange={(e) => set("ice", e.target.value.replace(/\s/g, ""))} />
        </Field>
        <Field label="Identifiant fiscal"><Input value={f.if_number} onChange={(e) => set("if_number", e.target.value)} /></Field>
        <Field label="Registre de commerce"><Input value={f.rc} onChange={(e) => set("rc", e.target.value)} /></Field>
        <Field label="Ville"><Input value={f.city} onChange={(e) => set("city", e.target.value)} /></Field>
        <Field label="Adresse" className="sm:col-span-2"><Input value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
        <Field label="Téléphone"><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="E-mail"><Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="Conditions de paiement" className="sm:col-span-2"><Input value={f.payment_terms} onChange={(e) => set("payment_terms", e.target.value)} placeholder="Ex. 30 jours fin de mois" /></Field>
        <Field label="Notes internes" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        {kind === "client" && (
          <div className="rounded-md border border-line bg-canvas p-3 sm:col-span-2">
            <div className="mb-2 text-sm font-medium">Numérotation des factures de ce client</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Série utilisée" hint={currentSeries ? <>Prochain numéro : <b className="num">{formatInvoiceNumber(currentSeries.format, currentSeries.next_seq, todayIso())}</b></> : "Série par défaut de l'entreprise"}>
                <Select value={seriesId} disabled={Boolean(newPlan)} onChange={(e) => setSeriesId(e.target.value)}>
                  <option value="">Série par défaut de l'entreprise</option>
                  {(seriesQ.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.format})</option>)}
                </Select>
              </Field>
              {canManage && (
                <Field label="Ou nouvelle numérotation : dernier numéro du client, ou ses lettres"
                  error={newNumber.trim() && !newPlan ? "Format non reconnu (ex. MATA0012/2026 ou MATA)." : null}
                  hint={newPlan ? <>Prochain numéro : <b className="num">{formatInvoiceNumber(newPlan.format, newPlan.next, `${newPlan.year ?? new Date().getFullYear()}-01-01`)}</b></> : "Ex. MATA0012/2026, NOV0100/2025A, ou simplement MATA"}>
                  <Input className="num" value={newNumber} onChange={(e) => setNewNumber(e.target.value.toUpperCase())} placeholder="MATA0012/2026" />
                </Field>
              )}
            </div>
            <p className="mt-2 text-xs text-muted">Les numéros restent attribués à la validation, dans l'ordre et sans trou, pour chaque série.</p>
          </div>
        )}
        {!party && <div className="sm:col-span-2"><ShareCheckbox checked={share} onChange={setShare} count={others.length} /></div>}
      </form>
    </Dialog>
  );
}

function PartyDetail({ party, onClose }: { party: Party | null; onClose: () => void }) {
  const history = useAsync(async () => {
    if (!party || party.kind !== "client") return [] as Invoice[];
    return must(await supabase.from("invoices").select("*").eq("client_id", party.id).order("issue_date", { ascending: false }).limit(200)) as Invoice[];
  }, [party?.id]);
  const valid = (history.data ?? []).filter((i) => i.status !== "draft" && i.status !== "cancelled");
  const total = valid.reduce((s, i) => s + i.total_ttc, 0);
  const due = valid.reduce((s, i) => s + (i.total_ttc - i.amount_paid), 0);

  return (
    <Dialog open={Boolean(party)} onClose={onClose} title={party?.name ?? ""} wide>
      {party && (
        <div className="space-y-4">
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div><dt className="inline text-muted">ICE : </dt><dd className="inline num">{party.ice ?? "—"}</dd></div>
            <div><dt className="inline text-muted">IF : </dt><dd className="inline">{party.if_number ?? "—"}</dd></div>
            <div><dt className="inline text-muted">RC : </dt><dd className="inline">{party.rc ?? "—"}</dd></div>
            <div><dt className="inline text-muted">Ville : </dt><dd className="inline">{party.city ?? "—"}</dd></div>
            <div className="sm:col-span-2"><dt className="inline text-muted">Adresse : </dt><dd className="inline">{party.address ?? "—"}</dd></div>
            <div><dt className="inline text-muted">Téléphone : </dt><dd className="inline">{party.phone ?? "—"}</dd></div>
            <div><dt className="inline text-muted">E-mail : </dt><dd className="inline">{party.email ?? "—"}</dd></div>
          </dl>
          {party.kind === "client" ? (
            <>
              <div className="flex flex-wrap gap-6 rounded-md bg-canvas p-3 text-sm">
                <div><div className="text-muted">Factures validées</div><div className="num text-lg font-semibold">{valid.length}</div></div>
                <div><div className="text-muted">Total facturé TTC</div><div className="num text-lg font-semibold">{formatMoney(total)}</div></div>
                <div><div className="text-muted">Reste à encaisser</div><div className="num text-lg font-semibold">{formatMoney(due)}</div></div>
              </div>
              {history.loading ? <Spinner /> : (history.data ?? []).length === 0 ? (
                <p className="text-sm text-muted">Aucune facture pour ce client.</p>
              ) : (
                <Table>
                  <thead><tr><th>N°</th><th>Date</th><th>Statut</th><th className="text-right">TTC</th></tr></thead>
                  <tbody>
                    {history.data!.map((i) => (
                      <tr key={i.id}>
                        <td><Link className="text-ink-800 hover:underline" to={`/factures/${i.id}`}>{i.number ?? "Brouillon"}</Link></td>
                        <td className="num">{formatDateFr(i.issue_date)}</td>
                        <td><StatusBadge status={i.status} /></td>
                        <td className="num text-right">{formatMoney(i.total_ttc)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">Les factures d'achat de ce fournisseur apparaîtront ici avec le module Journal TVA.</p>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** « MATA0012/2026 » → suite à partir de 13 ; « MATA » → MATA0001/AAAA. */
function planFromInput(v: string): { format: string; next: number; reset: boolean; year: number | null } | null {
  const t = v.trim().toUpperCase();
  if (!t) return null;
  if (/^[A-Z][A-Z\-_. ]{0,15}$/.test(t)) {
    const prefix = t.replace(/\s+/g, "");
    return { format: `${prefix}{SEQ:4}/{YYYY}`, next: 1, reset: true, year: null };
  }
  const d = deriveSeriesFromNumber(t, new Date().getFullYear());
  return d ? { format: d.format, next: d.nextSeq, reset: d.resetYearly, year: d.year } : null;
}
