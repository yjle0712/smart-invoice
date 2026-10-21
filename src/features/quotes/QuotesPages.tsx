import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { saveAs } from "file-saver";
import { ArrowLeft, Check, Download, FilePlus2, FileText, ImageDown, PencilLine, Plus, Save, Search, Send, Trash2, X } from "lucide-react";
import { supabase, must, errorMessage } from "@/lib/supabase";
import { useActiveCompany } from "@/lib/session";
import { useAsync, useDebounced } from "@/lib/hooks";
import type { InvoiceTemplateRow, Party, Product, Quote, QuoteLine, QuoteStatus } from "@/lib/types";
import { formatMoney, formatRate, parseMoney, parseQuantity } from "@/domain/money";
import { computeInvoice } from "@/domain/vat";
import { addDaysIso, formatDateFr, todayIso } from "@/domain/dates";
import { amountToFrenchWords } from "@/domain/words";
import { buildQuotePdfData, renderPdfBlob } from "@/pdf/export";
import { PdfPreview } from "@/pdf/PdfPreview";
import { PAYMENT_METHOD_PDF } from "@/pdf/paymentMethods";
import { safeFileName } from "@/lib/utils";
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Field, Input, PageHeader, Pagination, Select, Spinner, Table, Textarea,
} from "@/components/ui";
import { cn } from "@/lib/utils";

export const QUOTE_STATUS: Record<QuoteStatus, { label: string; tone: "neutral" | "warn" | "danger" | "ok" }> = {
  draft: { label: "Brouillon", tone: "neutral" },
  sent: { label: "Envoyé", tone: "warn" },
  accepted: { label: "Accepté", tone: "ok" },
  refused: { label: "Refusé", tone: "danger" },
  invoiced: { label: "Transformé en facture", tone: "ok" },
};
const PAGE = 25;
const quoteFileName = (q: Quote, ext = "pdf") => `${safeFileName(q.number, q.client_snapshot?.name ?? "")}.${ext}`;

// ---------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------
export function QuotesListPage() {
  const { company } = useActiveCompany();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const query = useDebounced(q);
  const [status, setStatus] = useState<QuoteStatus | "">("");
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [query, status]);

  const list = useAsync(async () => {
    let req = supabase.from("quotes").select("*", { count: "exact" }).eq("company_id", company.id);
    if (status) req = req.eq("status", status);
    if (query.trim()) {
      const s = query.trim().replace(/[%,()]/g, " ");
      req = req.or(`number.ilike.%${s}%,client_snapshot->>name.ilike.%${s}%`);
    }
    const res = await req.order("issue_date", { ascending: false }).order("created_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (res.error) throw res.error;
    return { rows: (res.data ?? []) as Quote[], total: res.count ?? 0 };
  }, [company.id, query, status, page]);
  const rows = list.data?.rows ?? [];
  const today = todayIso();

  return (
    <>
      <PageHeader
        title="Devis"
        description="Préparez vos devis avec les prix du catalogue, envoyez-les en PDF, puis transformez un devis accepté en facture en un clic."
        actions={<Button icon={<FilePlus2 className="size-4" />} onClick={() => navigate("/devis/nouveau")}>Nouveau devis</Button>}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
            <Input className="pl-8" placeholder="N° de devis, client" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-56" value={status} onChange={(e) => setStatus(e.target.value as QuoteStatus | "")} aria-label="Statut">
            <option value="">Tous les statuts</option>
            {(Object.keys(QUOTE_STATUS) as QuoteStatus[]).map((s) => <option key={s} value={s}>{QUOTE_STATUS[s].label}</option>)}
          </Select>
        </div>
        {list.loading && !list.data ? <Spinner /> : list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> :
          rows.length === 0 ? (
            <EmptyState title={q || status ? "Aucun devis ne correspond" : "Aucun devis pour l'instant"}
              action={!q && !status && <Button onClick={() => navigate("/devis/nouveau")}>Créer un devis</Button>} />
          ) : (
            <>
              <Table>
                <thead><tr><th>N° devis</th><th>Date</th><th>Validité</th><th>Client</th><th className="text-right">HT</th><th className="text-right">TTC</th><th>Statut</th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const expired = r.valid_until && r.valid_until < today && (r.status === "draft" || r.status === "sent");
                    return (
                      <tr key={r.id}>
                        <td><Link to={`/devis/${r.id}`} className="font-medium text-ink-800 hover:underline">{r.number}</Link></td>
                        <td className="num">{formatDateFr(r.issue_date)}</td>
                        <td className={cn("num", expired && "text-danger")}>{formatDateFr(r.valid_until) || "—"}{expired && " (expiré)"}</td>
                        <td>{r.client_snapshot?.name ?? <span className="text-saffron-700">Client à choisir</span>}</td>
                        <td className="num text-right">{formatMoney(r.total_ht)}</td>
                        <td className="num text-right font-medium">{formatMoney(r.total_ttc)}</td>
                        <td><Badge tone={QUOTE_STATUS[r.status].tone}>{QUOTE_STATUS[r.status].label}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              <Pagination page={page} pageSize={PAGE} total={list.data?.total ?? 0} onPage={setPage} />
            </>
          )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------
// Éditeur
// ---------------------------------------------------------------------
interface EditLine { key: string; product_id: string | null; designation: string; unit: string; quantity: string; price: string; vat_rate_bp: number; catalog: number | null }
const toInput = (c: number) => (c / 100).toFixed(2).replace(".", ",");
const k = () => Math.random().toString(36).slice(2);

export function QuoteEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { company, canManage } = useActiveCompany();
  const refs = useAsync(async () => {
    const [clients, products, templates] = await Promise.all([
      supabase.from("parties").select("*").eq("company_id", company.id).eq("kind", "client").eq("archived", false).order("name"),
      supabase.from("products").select("*").eq("company_id", company.id).eq("active", true).order("designation"),
      supabase.from("invoice_templates").select("*").eq("company_id", company.id).order("name"),
    ]);
    let existing: { q: Quote; lines: QuoteLine[] } | null = null;
    if (id) {
      const q = must(await supabase.from("quotes").select("*").eq("id", id).eq("company_id", company.id).single()) as Quote;
      existing = { q, lines: must(await supabase.from("quote_lines").select("*").eq("quote_id", id).order("position")) as QuoteLine[] };
    }
    return { clients: must(clients) as Party[], products: must(products) as Product[], templates: must(templates) as InvoiceTemplateRow[], existing };
  }, [company.id, id]);

  const [clientId, setClientId] = useState("");
  const [issueDate, setIssueDate] = useState(todayIso());
  const [validUntil, setValidUntil] = useState(addDaysIso(todayIso(), 30));
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentTerms, setPaymentTerms] = useState(company.default_payment_terms ?? "");
  const [notes, setNotes] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [lines, setLines] = useState<EditLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!id);

  useEffect(() => {
    const e = refs.data?.existing;
    if (!e || loaded) return;
    if (e.q.status === "invoiced") { toast.error("Ce devis a été transformé en facture : il ne peut plus être modifié."); navigate(`/devis/${e.q.id}`, { replace: true }); return; }
    setClientId(e.q.client_id ?? ""); setIssueDate(e.q.issue_date); setValidUntil(e.q.valid_until ?? "");
    setPaymentMethod(e.q.payment_method ?? ""); setPaymentTerms(e.q.payment_terms ?? ""); setNotes(e.q.notes ?? ""); setTemplateId(e.q.template_id ?? "");
    const prices = new Map((refs.data?.products ?? []).map((p) => [p.id, p.unit_price_ttc]));
    setLines(e.lines.map((l) => ({ key: k(), product_id: l.product_id, designation: l.designation, unit: l.unit ?? "", quantity: String(Number(l.quantity)).replace(".", ","),
      price: toInput(l.unit_price_ttc), vat_rate_bp: l.vat_rate_bp, catalog: l.product_id ? prices.get(l.product_id) ?? null : null })));
    setLoaded(true);
  }, [refs.data, loaded, navigate]);

  const parsed = useMemo(() => {
    const inputs = lines.map((l) => {
      const q = parseQuantity(l.quantity); const p = parseMoney(l.price);
      return q && q > 0 && p !== null && p >= 0 ? { quantity: q, unitPriceTtc: p, vatRateBp: l.vat_rate_bp } : null;
    });
    const ok = inputs.every(Boolean);
    return { inputs, ok, totals: computeInvoice(inputs.filter(Boolean) as { quantity: number; unitPriceTtc: number; vatRateBp: number }[], company.rounding_mode) };
  }, [lines, company.rounding_mode]);

  if (refs.loading || !loaded) return refs.error ? <ErrorBox message={refs.error} onRetry={refs.reload} /> : <Spinner />;
  const { clients, products, templates } = refs.data!;

  const add = (pid: string) => {
    const p = products.find((x) => x.id === pid);
    if (p) setLines((ls) => [...ls, { key: k(), product_id: p.id, designation: p.designation, unit: p.unit, quantity: "1", price: toInput(p.unit_price_ttc), vat_rate_bp: p.vat_rate_bp, catalog: p.unit_price_ttc }]);
  };
  const upd = (key: string, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = async () => {
    if (!lines.length) return toast.error("Ajoutez au moins une ligne.");
    if (!parsed.ok) return toast.error("Vérifiez les quantités et les prix.");
    if (lines.some((l) => !l.designation.trim())) return toast.error("Chaque ligne doit avoir une désignation.");
    setBusy(true);
    try {
      const qid = must(await supabase.rpc("save_quote", {
        p_quote: id ?? null, p_company: company.id,
        p_header: { client_id: clientId, issue_date: issueDate, valid_until: validUntil, payment_method: paymentMethod, payment_terms: paymentTerms, notes, template_id: templateId },
        p_lines: lines.map((l, i) => ({ product_id: l.product_id ?? "", designation: l.designation.trim(), unit: l.unit, quantity: parsed.inputs[i]!.quantity, unit_price_ttc: parsed.inputs[i]!.unitPriceTtc, vat_rate_bp: l.vat_rate_bp })),
      })) as string;
      toast.success(id ? "Devis enregistré." : "Devis créé.");
      navigate(`/devis/${qid}`);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  const t = parsed.totals;
  return (
    <>
      <PageHeader
        title={id ? `Modifier le devis ${refs.data?.existing?.q.number ?? ""}` : "Nouveau devis"}
        description="Le numéro du devis (DV…) est attribué à l'enregistrement. Les prix viennent du catalogue."
        actions={<>
          <Link to={id ? `/devis/${id}` : "/devis"}><Button variant="ghost" icon={<ArrowLeft className="size-4" />}>Retour</Button></Link>
          <Button icon={<Save className="size-4" />} loading={busy} onClick={save}>Enregistrer le devis</Button>
        </>}
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card title="Client et conditions">
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <Field label="Client">
                <Select value={clientId} onChange={(e) => { setClientId(e.target.value); const c = clients.find((x) => x.id === e.target.value); if (c?.payment_terms) setPaymentTerms(c.payment_terms); }}>
                  <option value="">Choisir un client…</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.ice ? ` — ICE ${c.ice}` : ""}</option>)}
                </Select>
              </Field>
              <Field label="Modèle"><Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}><option value="">Modèle par défaut</option>{templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
              <Field label="Date du devis"><Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></Field>
              <Field label="Valable jusqu'au"><Input type="date" value={validUntil} min={issueDate} onChange={(e) => setValidUntil(e.target.value)} /></Field>
              <Field label="Mode de règlement">
                <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="">— Non précisé —</option>
                  {Object.entries(PAYMENT_METHOD_PDF).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Conditions de paiement"><Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="Ex. 50 % à la commande" /></Field>
              <Field label="Observations" className="sm:col-span-2"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-14" placeholder="Délai de livraison, conditions particulières…" /></Field>
            </div>
          </Card>
          <Card title="Articles">
            <div className="flex flex-wrap gap-2 border-b border-line p-3">
              <Select className="min-w-64 flex-1" value="" onChange={(e) => add(e.target.value)} aria-label="Ajouter un produit du catalogue">
                <option value="">+ Ajouter un produit du catalogue…</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.reference} — {p.designation} — {formatMoney(p.unit_price_ttc)} DH TTC ({formatRate(p.vat_rate_bp)})</option>)}
              </Select>
              <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setLines((ls) => [...ls, { key: k(), product_id: null, designation: "", unit: "", quantity: "1", price: "", vat_rate_bp: company.default_vat_rate_bp, catalog: null }])}>Ligne libre</Button>
            </div>
            {lines.length === 0 ? <p className="p-6 text-center text-sm text-muted">Aucune ligne.</p> : (
              <Table>
                <thead><tr><th>Désignation</th><th className="w-24">Qté</th><th className="w-32">P.U. TTC</th><th className="w-28">TVA</th><th className="w-32 text-right">Total TTC</th><th /></tr></thead>
                <tbody>
                  {lines.map((l, i) => {
                    const locked = Boolean(l.product_id) && !canManage;
                    const changed = l.catalog !== null && parseMoney(l.price) !== l.catalog;
                    return (
                      <tr key={l.key}>
                        <td><Input value={l.designation} onChange={(e) => upd(l.key, { designation: e.target.value })} aria-label="Désignation" />{changed && <div className="mt-1 text-xs text-saffron-700">Prix différent du catalogue ({formatMoney(l.catalog!)})</div>}</td>
                        <td><Input inputMode="decimal" className="num text-right" value={l.quantity} onChange={(e) => upd(l.key, { quantity: e.target.value })} aria-label="Quantité" /></td>
                        <td><Input inputMode="decimal" className="num text-right" value={l.price} disabled={locked} title={locked ? "Prix du catalogue" : undefined} onChange={(e) => upd(l.key, { price: e.target.value })} aria-label="Prix unitaire TTC" /></td>
                        <td>
                          <Select value={String(l.vat_rate_bp)} disabled={Boolean(l.product_id)} onChange={(e) => upd(l.key, { vat_rate_bp: Number(e.target.value) })} aria-label="TVA">
                            {company.vat_rates_bp.map((r) => <option key={r} value={r}>{formatRate(r)}</option>)}
                          </Select>
                        </td>
                        <td className="num text-right">{parsed.inputs[i] ? formatMoney(t.lines[parsed.inputs.slice(0, i).filter(Boolean).length]?.totalTtc ?? 0) : "—"}</td>
                        <td><Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="size-3.5" />} aria-label="Supprimer la ligne" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
        <Card title="Montants" className="h-fit xl:sticky xl:top-4">
          <dl className="space-y-1.5 p-4 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Total HT</dt><dd className="num">{formatMoney(t.totalHt)}</dd></div>
            {t.byRate.filter((g) => g.vatRateBp > 0).map((g) => <div key={g.vatRateBp} className="flex justify-between"><dt className="text-muted">TVA {formatRate(g.vatRateBp)}</dt><dd className="num">{formatMoney(g.vat)}</dd></div>)}
            <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>Total TTC</dt><dd className="num">{formatMoney(t.totalTtc)} {company.currency_label}</dd></div>
            <p className="pt-2 text-xs uppercase text-ink-800">{amountToFrenchWords(t.totalTtc)}</p>
          </dl>
        </Card>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// Détail
// ---------------------------------------------------------------------
export function QuoteDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { company } = useActiveCompany();
  const [confirm, setConfirm] = useState<null | "delete" | "convert">(null);
  const q = useAsync(async () => {
    const quote = must(await supabase.from("quotes").select("*").eq("id", id!).eq("company_id", company.id).single()) as Quote;
    const [lines, tpls] = await Promise.all([
      supabase.from("quote_lines").select("*").eq("quote_id", quote.id).order("position"),
      supabase.from("invoice_templates").select("*").eq("company_id", company.id),
    ]);
    const l = must(lines) as QuoteLine[];
    const template = (must(tpls) as InvoiceTemplateRow[]).find((t) => t.id === (quote.template_id ?? company.default_template_id)) ?? null;
    return { quote, lines: l, pdf: await buildQuotePdfData(quote, l, company, template) };
  }, [id, company.id]);
  const pdf = useMemo(() => q.data?.pdf ?? null, [q.data]);

  if (q.loading && !q.data) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox message={q.error ?? "Devis introuvable."} onRetry={q.reload} />;
  const { quote, lines } = q.data;
  const st = QUOTE_STATUS[quote.status];
  const done = quote.status === "invoiced";

  const setStatus = async (s: QuoteStatus) => {
    try { must(await supabase.from("quotes").update({ status: s }).eq("id", quote.id)); toast.success(`Devis ${QUOTE_STATUS[s].label.toLowerCase()}.`); void q.reload(); }
    catch (err) { toast.error(errorMessage(err)); }
  };
  const download = async (jpg = false) => {
    try {
      const blob = await renderPdfBlob(q.data!.pdf);
      if (!jpg) return saveAs(blob, quoteFileName(quote));
      const { pdfToJpegs } = await import("@/lib/pdfjs");
      const imgs = await pdfToJpegs(await blob.arrayBuffer());
      imgs.forEach((im, i) => saveAs(im, quoteFileName(quote, "jpg").replace(/\.jpg$/, imgs.length > 1 ? `_page-${i + 1}.jpg` : ".jpg")));
    } catch (err) { toast.error(errorMessage(err)); }
  };

  return (
    <>
      <PageHeader
        title={`Devis ${quote.number}`}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone={st.tone}>{st.label}</Badge><span>{quote.client_snapshot?.name ?? "Client à choisir"} · {formatDateFr(quote.issue_date)}{quote.valid_until && ` · valable jusqu'au ${formatDateFr(quote.valid_until)}`}</span></span>}
        actions={<>
          <Link to="/devis"><Button variant="ghost" icon={<ArrowLeft className="size-4" />}>Devis</Button></Link>
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => download()}>Télécharger le PDF</Button>
          <Button variant="secondary" icon={<ImageDown className="size-4" />} onClick={() => download(true)}>JPG</Button>
          {!done && <Link to={`/devis/${quote.id}/modifier`}><Button variant="secondary" icon={<PencilLine className="size-4" />}>Modifier</Button></Link>}
          {done && quote.invoice_id && <Link to={`/factures/${quote.invoice_id}`}><Button variant="secondary" icon={<FileText className="size-4" />}>Voir la facture</Button></Link>}
          {!done && <Button variant="accent" icon={<FileText className="size-4" />} onClick={() => setConfirm("convert")}>Transformer en facture</Button>}
        </>}
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <PdfPreview data={pdf} height={900} />
        <div className="space-y-4">
          {!done && (
            <Card title="Suivi du devis">
              <div className="flex flex-wrap gap-2 p-4">
                {quote.status !== "sent" && <Button size="sm" variant="secondary" icon={<Send className="size-3.5" />} onClick={() => setStatus("sent")}>Marquer envoyé</Button>}
                {quote.status !== "accepted" && <Button size="sm" variant="secondary" icon={<Check className="size-3.5" />} onClick={() => setStatus("accepted")}>Accepté par le client</Button>}
                {quote.status !== "refused" && <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => setStatus("refused")}>Refusé</Button>}
                <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirm("delete")}>Supprimer</Button>
              </div>
            </Card>
          )}
          <Card title="Montants">
            <dl className="space-y-1.5 p-4 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Total HT</dt><dd className="num">{formatMoney(quote.total_ht)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">TVA</dt><dd className="num">{formatMoney(quote.total_vat)}</dd></div>
              <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>Total TTC</dt><dd className="num">{formatMoney(quote.total_ttc)} {company.currency_label}</dd></div>
              <div className="flex justify-between pt-1"><dt className="text-muted">Articles</dt><dd>{lines.length}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Paiement</dt><dd>{quote.payment_method ? PAYMENT_METHOD_PDF[quote.payment_method] : "—"}</dd></div>
            </dl>
          </Card>
        </div>
      </div>
      <ConfirmDialog open={confirm === "convert"} title="Transformer en facture"
        message={<>Une facture <b>brouillon</b> est créée avec le client et les lignes du devis {quote.number} ({formatMoney(quote.total_ttc)} {company.currency_label}). Vous pourrez la vérifier puis la valider ; son numéro est attribué à la validation.</>}
        confirmLabel="Créer la facture" onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try { const inv = must(await supabase.rpc("convert_quote_to_invoice", { p_quote: quote.id })) as string; toast.success("Facture brouillon créée à partir du devis."); navigate(`/factures/${inv}`); }
          catch (err) { toast.error(errorMessage(err)); }
        }} />
      <ConfirmDialog open={confirm === "delete"} title="Supprimer le devis" message={`Le devis ${quote.number} sera supprimé. Son numéro ne sera pas réattribué.`} confirmLabel="Supprimer" danger
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          try { must(await supabase.from("quotes").delete().eq("id", quote.id).select("id").single()); toast.success("Devis supprimé."); navigate("/devis"); }
          catch (err) { toast.error(errorMessage(err)); }
        }} />
    </>
  );
}
