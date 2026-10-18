import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, CheckCheck, Eye, Plus, Search, ShieldCheck, X } from "lucide-react";
import { supabase, must, errorMessage } from "@/lib/supabase";
import { useActiveCompany } from "@/lib/session";
import { useAsync, useDebounced } from "@/lib/hooks";
import type { PaymentMode, PdfImport, VatEntry, VatEntryKind } from "@/lib/types";
import { formatMoney, formatRate, parseMoney } from "@/domain/money";
import { parseDateFlexible } from "@/domain/dates";
import { cn, isValidIce } from "@/lib/utils";
import { Badge, Button, Card, EmptyState, ErrorBox, Input, PageHeader, Pagination, Select, Spinner } from "@/components/ui";
import { CONFIDENCE_LABEL, CONFIDENCE_STYLE, KIND_LABEL, PAYMENT_MODES } from "./vatCommon";
import { SourcePageDialog } from "./SourcePageDialog";

const PAGE = 40;
type Filter = "to_review" | "issues" | "rejected" | "validated";

export function ReviewPage() {
  const { company, canManage } = useActiveCompany();
  const [params, setParams] = useSearchParams();
  const importId = params.get("import") ?? "";
  const [filter, setFilter] = useState<Filter>("to_review");
  const [kind, setKind] = useState<VatEntryKind | "">("");
  const [q, setQ] = useState("");
  const query = useDebounced(q);
  const [page, setPage] = useState(0);
  const [source, setSource] = useState<VatEntry | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const imports = useAsync(async () => must(await supabase.from("pdf_imports").select("id, file_name, created_at").eq("company_id", company.id).order("created_at", { ascending: false }).limit(100)) as Pick<PdfImport, "id" | "file_name" | "created_at">[], [company.id]);

  const list = useAsync(async () => {
    let req = supabase.from("vat_entries").select("*", { count: "exact" }).eq("company_id", company.id).eq("archived", false);
    if (filter === "issues") req = req.eq("status", "to_review").neq("issues", "[]");
    else req = req.eq("status", filter);
    if (importId) req = req.eq("import_id", importId);
    if (kind) req = req.eq("kind", kind);
    if (query.trim()) {
      const s = query.trim().replace(/[%,()]/g, " ");
      req = req.or(`invoice_number.ilike.%${s}%,party_name.ilike.%${s}%,party_ice.ilike.%${s}%`);
    }
    const res = await req.order("source_file", { ascending: true }).order("page_from", { ascending: true }).order("created_at").range(page * PAGE, page * PAGE + PAGE - 1);
    if (res.error) throw res.error;
    return { rows: res.data as VatEntry[], total: res.count ?? 0 };
  }, [company.id, filter, importId, kind, query, page]);

  useEffect(() => setPage(0), [filter, importId, kind, query]);

  const rows = list.data?.rows ?? [];
  const reliable = useMemo(() => rows.filter((r) => r.status === "to_review" && isReliable(r)), [rows]);

  const updateRow = (id: string, patch: Partial<VatEntry>) =>
    list.setData((d) => (d ? { ...d, rows: d.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) } : d));
  const removeRow = (id: string) => list.setData((d) => (d ? { rows: d.rows.filter((r) => r.id !== id), total: d.total - 1 } : d));

  const validateReliable = async () => {
    setBulkBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const r of reliable) {
      const res = await supabase.from("vat_entries").update({ status: "validated" }).eq("id", r.id);
      if (res.error) failed.push(`${r.invoice_number ?? "?"} : ${errorMessage(res.error)}`);
      else ok++;
    }
    setBulkBusy(false);
    toast.success(`${ok} écriture(s) validée(s).`);
    if (failed.length) toast.error(failed.slice(0, 3).join(" · "));
    void list.reload();
  };

  const addManual = async (k: VatEntryKind) => {
    try {
      must(await supabase.from("vat_entries").insert({ company_id: company.id, kind: k, source: "manual", status: "to_review", rubrique: k === "purchase" ? company.default_purchase_rubrique : null }));
      setFilter("to_review");
      setParams({});
      void list.reload();
      toast.success("Ligne ajoutée en tête de liste : complétez-la puis validez.");
    } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <>
      <PageHeader
        title="Contrôle et correction"
        description="Vérifiez les factures extraites. Les cellules colorées sont incertaines ou introuvables : rien n'est inventé, corrigez à partir de la page source. Seules les écritures validées entrent dans les journaux."
        actions={
          <>
            <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => addManual("purchase")}>Saisir un achat</Button>
            <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => addManual("sale")}>Saisir une vente</Button>
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="flex rounded-md border border-line p-0.5 text-sm">
            {([["to_review", "À contrôler"], ["issues", "Avec anomalies"], ["validated", "Validées"], ["rejected", "Rejetées / doublons"]] as [Filter, string][]).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} className={cn("rounded px-2.5 py-1", filter === k ? "bg-ink-800 text-white" : "text-text hover:bg-canvas")}>{l}</button>
            ))}
          </div>
          <Select className="w-44" value={kind} onChange={(e) => setKind(e.target.value as VatEntryKind | "")} aria-label="Sens">
            <option value="">Achats et ventes</option><option value="purchase">Achats</option><option value="sale">Ventes</option>
          </Select>
          <Select className="w-64" value={importId} onChange={(e) => setParams(e.target.value ? { import: e.target.value } : {})} aria-label="Fichier">
            <option value="">Tous les fichiers</option>
            {(imports.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.file_name} — {new Date(i.created_at).toLocaleDateString("fr-MA")}</option>)}
          </Select>
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
            <Input className="pl-8" placeholder="N° facture, tiers, ICE" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {canManage && filter === "to_review" && reliable.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-line bg-success/5 px-3 py-2 text-sm">
            <CheckCheck className="size-4 text-success" />
            {reliable.length} ligne(s) de cette page sans aucune anomalie (champs fiables, totaux cohérents, pas d'OCR).
            <Button size="sm" loading={bulkBusy} onClick={validateReliable}>Les valider</Button>
          </div>
        )}

        {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : list.loading && !list.data ? <Spinner /> : rows.length === 0 ? (
          <EmptyState title={filter === "to_review" ? "Rien à contrôler" : "Aucune écriture"}>
            {filter === "to_review" && <>Importez des PDF depuis <Link className="underline" to="/tva/import">Importation PDF</Link> ou saisissez une facture.</>}
          </EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1500px] border-collapse text-[13px]">
                <thead>
                  <tr className="text-left text-xs text-muted [&>th]:whitespace-nowrap [&>th]:px-2 [&>th]:py-2 [&>th]:font-semibold">
                    <th>Source</th><th>Sens</th><th>N° facture</th><th>Date</th><th>Tiers</th><th>ICE</th><th>IF</th><th>Nature</th>
                    <th className="text-right">HT</th><th>Taux</th><th className="text-right">TVA</th><th className="text-right">TTC</th><th>Paiement</th><th>Achat</th><th>Contrôles</th>
                    <th className="sticky right-0 bg-white shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]">Décision</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <EntryRow key={r.id} row={r} canManage={canManage} vatRates={company.vat_rates_bp}
                      onChanged={(p) => updateRow(r.id, p)} onRemoved={() => removeRow(r.id)} onSource={() => setSource(r)} />
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE} total={list.data!.total} onPage={setPage} />
          </>
        )}
      </Card>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1"><span className={cn("inline-block size-3 rounded-sm", CONFIDENCE_STYLE.medium)} /> Probable</span>
        <span className="inline-flex items-center gap-1"><span className={cn("inline-block size-3 rounded-sm", CONFIDENCE_STYLE.low)} /> Incertain</span>
        <span className="inline-flex items-center gap-1"><span className={cn("inline-block size-3 rounded-sm", CONFIDENCE_STYLE.missing)} /> Introuvable dans le document</span>
        <span>Chaque modification est enregistrée dans le journal d'activité.</span>
      </div>

      <SourcePageDialog
        importId={source?.import_id ?? null}
        pageFrom={source?.page_from ?? null}
        pageTo={source?.page_to ?? null}
        title={`Source : ${source?.source_file ?? ""} — facture ${source?.invoice_number ?? "?"}`}
        onClose={() => setSource(null)}
      />
    </>
  );
}

function isReliable(r: VatEntry): boolean {
  if (r.issues.length > 0 || r.confidence.ocr === "oui") return false;
  const keys = ["invoice_number", "invoice_date", "party_name", "party_ice", "total_ht", "total_vat", "total_ttc"];
  return keys.every((k) => r.confidence[k] === "high" || r.confidence[k] === "medium") && r.checks.every((c) => c.ok);
}

const money = (v: number | null) => (v === null ? "" : formatMoney(v));

function EntryRow({
  row, canManage, vatRates, onChanged, onRemoved, onSource,
}: { row: VatEntry; canManage: boolean; vatRates: number[]; onChanged: (p: Partial<VatEntry>) => void; onRemoved: () => void; onSource: () => void }) {
  const locked = row.status !== "to_review";
  const [saving, setSaving] = useState(false);

  const save = async (patch: Partial<VatEntry>, clearConfidence?: string[]) => {
    const confidence = { ...row.confidence };
    for (const k of clearConfidence ?? Object.keys(patch)) confidence[k] = "high"; // corrigé par l'utilisateur
    setSaving(true);
    try {
      const updated = must(await supabase.from("vat_entries").update({ ...patch, confidence }).eq("id", row.id).select().single()) as VatEntry;
      onChanged(updated);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: VatEntry["status"]) => {
    try {
      const updated = must(await supabase.from("vat_entries").update({ status }).eq("id", row.id).select().single()) as VatEntry;
      onChanged(updated);
      toast.success(status === "validated" ? "Écriture validée." : status === "rejected" ? "Écriture rejetée." : "Écriture repassée à contrôler.");
    } catch (e) { toast.error(errorMessage(e)); }
  };

  const c = (k: string) => CONFIDENCE_STYLE[row.confidence[k] ?? (row.source === "manual" ? "high" : "missing")] ?? "";
  const tip = (k: string) => CONFIDENCE_LABEL[row.confidence[k] ?? ""] ?? undefined;
  const cell = "px-1 py-1 align-top border-t border-line";
  const sugg = (k: "ht" | "vat" | "ttc") => row.confidence[`suggestion_${k}`];

  const coherent = row.total_ht !== null && row.total_vat !== null && row.total_ttc !== null
    ? Math.abs(row.total_ht + row.total_vat + row.other_amount - row.total_ttc) <= 2 : null;

  return (
    <tr className={cn(saving && "opacity-60", row.status === "rejected" && "bg-canvas/60")}>
      <td className={cell}>
        {row.import_id ? (
          <button type="button" onClick={onSource} className="inline-flex items-center gap-1 whitespace-nowrap text-ink-700 hover:underline" title={row.source_file ?? ""}>
            <Eye className="size-3.5" /> p.{row.page_from}{row.page_to !== row.page_from ? `-${row.page_to}` : ""}
          </button>
        ) : <span className="text-xs text-muted">Saisie</span>}
        {row.confidence.ocr === "oui" && <div><Badge tone="warn">OCR</Badge></div>}
      </td>
      <td className={cell}>
        <select disabled={locked} value={row.kind} onChange={(e) => save({ kind: e.target.value as VatEntryKind }, [])} className="rounded border border-line bg-white px-1 py-1" aria-label="Sens" title={row.confidence.kind}>
          <option value="purchase">{KIND_LABEL.purchase}</option><option value="sale">{KIND_LABEL.sale}</option>
        </select>
      </td>
      <td className={cell}><TextCell value={row.invoice_number} disabled={locked} className={cn("w-32", c("invoice_number"))} title={tip("invoice_number")} onSave={(v) => save({ invoice_number: v })} /></td>
      <td className={cell}>
        <TextCell value={row.invoice_date ? row.invoice_date.split("-").reverse().join("/") : null} disabled={locked} className={cn("w-24", c("invoice_date"))} title={tip("invoice_date")} placeholder="jj/mm/aaaa"
          validate={(v) => (!v || parseDateFlexible(v) ? null : "Date invalide")}
          onSave={(v) => save({ invoice_date: v ? parseDateFlexible(v) : null })} />
      </td>
      <td className={cell}><TextCell value={row.party_name} disabled={locked} className={cn("w-48", c("party_name"))} title={tip("party_name")} onSave={(v) => save({ party_name: v })} /></td>
      <td className={cell}>
        <TextCell value={row.party_ice} disabled={locked} className={cn("w-36", c("party_ice"))} title={tip("party_ice")}
          validate={(v) => (!v || isValidIce(v.replace(/\s/g, "")) ? null : "15 chiffres")} onSave={(v) => save({ party_ice: v ? v.replace(/\s/g, "") : null })} />
      </td>
      <td className={cell}><TextCell value={row.party_if} disabled={locked} className={cn("w-24", c("party_if"))} title={tip("party_if")} onSave={(v) => save({ party_if: v })} /></td>
      <td className={cell}><TextCell value={row.goods_nature} disabled={locked} className={cn("w-40", c("goods_nature"))} title={tip("goods_nature")} onSave={(v) => save({ goods_nature: v })} /></td>
      <td className={cell}>
        <MoneyCell value={row.total_ht} disabled={locked} className={c("total_ht")} title={tip("total_ht")} onSave={(v) => save({ total_ht: v })} />
        {sugg("ht") && row.total_ht === null && !locked && <SuggestButton cents={Number(sugg("ht"))} onApply={(v) => save({ total_ht: v })} />}
      </td>
      <td className={cell}>
        {row.rates.length > 1 ? <span className="whitespace-nowrap text-xs">{row.rates.map((r) => formatRate(r.rate_bp)).join(" + ")}</span> : (
          <select disabled={locked} value={row.vat_rate_bp ?? ""} onChange={(e) => save({ vat_rate_bp: e.target.value === "" ? null : Number(e.target.value) })}
            className={cn("rounded border border-line bg-white px-1 py-1", c("vat_rate_bp"))} aria-label="Taux">
            <option value="">—</option>
            {[...new Set([...vatRates, ...(row.vat_rate_bp !== null ? [row.vat_rate_bp] : [])])].sort((a, b) => b - a).map((r) => <option key={r} value={r}>{formatRate(r)}</option>)}
          </select>
        )}
      </td>
      <td className={cell}>
        <MoneyCell value={row.total_vat} disabled={locked} className={c("total_vat")} title={tip("total_vat")} onSave={(v) => save({ total_vat: v })} />
        {sugg("vat") && row.total_vat === null && !locked && <SuggestButton cents={Number(sugg("vat"))} onApply={(v) => save({ total_vat: v })} />}
      </td>
      <td className={cell}>
        <MoneyCell value={row.total_ttc} disabled={locked} className={c("total_ttc")} title={tip("total_ttc")} onSave={(v) => save({ total_ttc: v })} />
        {sugg("ttc") && row.total_ttc === null && !locked && <SuggestButton cents={Number(sugg("ttc"))} onApply={(v) => save({ total_ttc: v })} />}
        {row.other_amount > 0 && <div className="text-right text-[11px] text-muted">dont timbre {money(row.other_amount)}</div>}
      </td>
      <td className={cell}>
        <select value={row.payment_mode ?? ""} onChange={(e) => save({ payment_mode: (e.target.value || null) as PaymentMode | null }, [])} className="w-24 rounded border border-line bg-white px-1 py-1" aria-label="Mode de paiement">
          <option value="">Mode…</option>
          {Object.entries(PAYMENT_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="date" value={row.payment_date ?? ""} onChange={(e) => save({ payment_date: e.target.value || null }, [])} className="mt-1 w-28 rounded border border-line px-1 py-0.5" aria-label="Date de paiement" />
      </td>
      <td className={cell}>
        {row.kind === "purchase" ? (
          <div className="space-y-1">
            <select disabled={locked} value={row.deduction_type} onChange={(e) => save({ deduction_type: e.target.value as VatEntry["deduction_type"] }, [])} className="w-28 rounded border border-line bg-white px-1 py-1" aria-label="Nature">
              <option value="charges">Charges</option><option value="immobilisations">Immobilisations</option>
            </select>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" disabled={locked} checked={row.deductible} onChange={(e) => save({ deductible: e.target.checked }, [])} className="accent-ink-700" /> Déductible</label>
            <TextCell value={row.rubrique} disabled={locked} className="w-20" placeholder="Rubrique" onSave={(v) => save({ rubrique: v }, [])} />
          </div>
        ) : <span className="text-xs text-muted">—</span>}
      </td>
      <td className={cn(cell, "max-w-56")}>
        {coherent === false && <div className="flex items-start gap-1 text-xs text-danger"><AlertTriangle className="mt-0.5 size-3 shrink-0" /> HT + TVA ≠ TTC</div>}
        {row.issues.map((i) => <div key={i} className="text-xs text-saffron-700">• {i}</div>)}
        {row.issues.length === 0 && coherent && <span className="text-xs text-success">Cohérent</span>}
        {coherent === false && !locked && row.total_ht !== null && row.total_vat !== null && row.total_ttc !== null && (
          <TextCell value={row.other_amount ? (row.other_amount / 100).toFixed(2) : null} className="mt-1 w-24" placeholder="Timbre/autre"
            onSave={(v) => save({ other_amount: v ? parseMoney(v) ?? 0 : 0 }, [])} />
        )}
      </td>
      <td className={cn(cell, "sticky right-0 whitespace-nowrap bg-white shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]")}>
        {row.status === "to_review" && (
          <>
            {canManage && <Button size="sm" icon={<ShieldCheck className="size-3.5" />} onClick={() => setStatus("validated")}>Valider</Button>}
            <Button size="sm" variant="ghost" className="text-danger" icon={<X className="size-3.5" />} onClick={() => setStatus("rejected")} aria-label="Rejeter" title="Rejeter" />
          </>
        )}
        {row.status !== "to_review" && canManage && <Button size="sm" variant="ghost" onClick={() => setStatus("to_review")}>Repasser à contrôler</Button>}
        {row.status === "rejected" && canManage && (
          <Button size="sm" variant="ghost" className="text-danger" onClick={async () => {
            if (!confirm("Supprimer définitivement cette ligne rejetée ?")) return;
            try { must(await supabase.from("vat_entries").delete().eq("id", row.id)); onRemoved(); } catch (e) { toast.error(errorMessage(e)); }
          }}>Supprimer</Button>
        )}
      </td>
    </tr>
  );
}

function SuggestButton({ cents, onApply }: { cents: number; onApply: (v: number) => void }) {
  return (
    <button type="button" onClick={() => onApply(cents)} className="mt-0.5 block whitespace-nowrap text-[11px] text-ink-700 underline" title="Valeur calculée à partir des autres totaux : à confirmer">
      Calculé : {formatMoney(cents)} ?
    </button>
  );
}

function TextCell({
  value, onSave, disabled, className, title, placeholder, validate,
}: { value: string | null; onSave: (v: string | null) => void; disabled?: boolean; className?: string; title?: string; placeholder?: string; validate?: (v: string) => string | null }) {
  const [v, setV] = useState(value ?? "");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setV(value ?? ""), [value]);
  return (
    <div>
      <input
        value={v} disabled={disabled} placeholder={placeholder} title={err ?? title}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const t = v.trim();
          if ((value ?? "") === t) return;
          const e = validate?.(t) ?? null;
          setErr(e);
          if (!e) onSave(t || null);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className={cn("rounded border border-line bg-white px-1.5 py-1 disabled:bg-transparent disabled:border-transparent", err && "border-danger", className)}
      />
      {err && <div className="text-[11px] text-danger">{err}</div>}
    </div>
  );
}

function MoneyCell({ value, onSave, disabled, className, title }: { value: number | null; onSave: (v: number | null) => void; disabled?: boolean; className?: string; title?: string }) {
  return (
    <TextCell
      value={value === null ? null : formatMoney(value)} disabled={disabled} title={title} className={cn("num w-24 text-right", className)}
      validate={(v) => (!v || parseMoney(v) !== null ? null : "Montant invalide")}
      onSave={(v) => onSave(v ? parseMoney(v) : null)}
    />
  );
}
