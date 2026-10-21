import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { saveAs } from "file-saver";
import { ArrowLeft, Ban, Copy, Download, FilePenLine, ImageDown, PencilLine, ShieldCheck, Trash2, Wallet } from "lucide-react";
import { supabase, must, errorMessage } from "@/lib/supabase";
import { useActiveCompany } from "@/lib/session";
import { useAsync } from "@/lib/hooks";
import type { AuditEntry, DeliveryNote, Invoice, InvoiceLine, InvoiceTemplateRow, Party, Payment } from "@/lib/types";
import { formatMoney, formatRate, parseMoney } from "@/domain/money";
import { formatDateFr, todayIso } from "@/domain/dates";
import { amountToFrenchWords } from "@/domain/words";
import { PAYMENT_METHOD_LABEL } from "@/lib/utils";
import { buildPdfData, invoiceFileName, renderPdfBlob } from "@/pdf/export";
import { PdfPreview } from "@/pdf/PdfPreview";
import { PAYMENT_METHOD_PDF } from "@/pdf/paymentMethods";
import { CreateNoteButtons, NOTE_LABEL } from "@/features/notes/NotesPages";
import {
  Badge, Button, Card, ConfirmDialog, Dialog, ErrorBox, Field, Input, PageHeader, Select, Spinner, StatusBadge, Table,
} from "@/components/ui";

export function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { company, canManage } = useActiveCompany();
  const [dialog, setDialog] = useState<null | "validate" | "cancel" | "correct" | "delete" | "payment">(null);

  const q = useAsync(async () => {
    const inv = must(await supabase.from("invoices").select("*").eq("id", id!).eq("company_id", company.id).single()) as Invoice;
    const [lines, payments, client, templates] = await Promise.all([
      supabase.from("invoice_lines").select("*").eq("invoice_id", inv.id).order("position"),
      supabase.from("payments").select("*").eq("invoice_id", inv.id).order("paid_at"),
      inv.client_id ? supabase.from("parties").select("*").eq("id", inv.client_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      supabase.from("invoice_templates").select("*").eq("company_id", company.id),
    ]);
    const tpls = must(templates) as InvoiceTemplateRow[];
    const template = tpls.find((t) => t.id === (inv.template_id ?? company.default_template_id)) ?? null;
    const l = must(lines) as InvoiceLine[];
    const c = must(client) as Party | null;
    const pdf = await buildPdfData(inv, l, company, c, template);
    let history: AuditEntry[] = [];
    if (canManage) {
      history = must(await supabase.from("audit_log").select("*").eq("record_id", inv.id).order("at", { ascending: false }).limit(50)) as AuditEntry[];
    }
    const corrections = must(await supabase.from("invoices").select("id, number, status").eq("corrects_invoice_id", inv.id)) as Pick<Invoice, "id" | "number" | "status">[];
    const notes = must(await supabase.from("delivery_notes").select("id, kind, number, issue_date").eq("invoice_id", inv.id).order("created_at")) as Pick<DeliveryNote, "id" | "kind" | "number" | "issue_date">[];
    return { inv, lines: l, payments: must(payments) as Payment[], client: c, pdf, history, corrections, notes };
  }, [id, company.id, canManage]);

  const data = q.data;
  const pdfData = useMemo(() => data?.pdf ?? null, [data]);

  if (q.loading && !data) return <Spinner />;
  if (q.error || !data) return <ErrorBox message={q.error ?? "Facture introuvable."} onRetry={q.reload} />;
  const { inv, lines, payments, client } = data;
  const isDraft = inv.status === "draft";
  const clientName = inv.client_snapshot?.name ?? client?.name ?? "";
  const remaining = inv.total_ttc - inv.amount_paid;

  const download = async () => {
    try {
      const blob = await renderPdfBlob(data.pdf);
      saveAs(blob, invoiceFileName(inv, clientName));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  /** Export image : une page → un JPEG ; plusieurs pages → un ZIP de JPEG. */
  const downloadJpg = async () => {
    try {
      const pdfBlob = await renderPdfBlob(data.pdf);
      const { pdfToJpegs } = await import("@/lib/pdfjs");
      const images = await pdfToJpegs(await pdfBlob.arrayBuffer());
      const base = invoiceFileName(inv, clientName, "jpg").replace(/\.jpg$/, "");
      if (images.length === 1) saveAs(images[0], `${base}.jpg`);
      else {
        const { default: JSZip } = await import("jszip");
        const zip = new JSZip();
        images.forEach((img, i) => zip.file(`${base}_page-${i + 1}.jpg`, img));
        saveAs(await zip.generateAsync({ type: "blob" }), `${base}_JPG.zip`);
      }
      toast.success(images.length === 1 ? "Image JPG téléchargée." : `${images.length} pages en JPG (ZIP).`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const rpc = async (fn: string, args: Record<string, unknown>, ok: string) => {
    try {
      const r = must(await supabase.rpc(fn, args));
      toast.success(typeof r === "string" && fn === "validate_invoice" ? `Facture ${r} validée.` : ok);
      setDialog(null);
      return r;
    } catch (err) {
      toast.error(errorMessage(err));
      return null;
    }
  };

  return (
    <>
      <PageHeader
        title={inv.number ? `Facture ${inv.number}` : "Facture — brouillon"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={inv.status} />
            {inv.is_demo && <Badge tone="warn">Démonstration</Badge>}
            <span>{clientName || "Client à choisir"} · {formatDateFr(inv.issue_date)}</span>
          </span>
        }
        actions={
          <>
            <Link to="/factures"><Button variant="ghost" icon={<ArrowLeft className="size-4" />}>Factures</Button></Link>
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={download}>Télécharger le PDF</Button>
            <Button variant="secondary" icon={<ImageDown className="size-4" />} onClick={downloadJpg}>JPG</Button>
            {inv.status !== "cancelled" && <CreateNoteButtons invoiceId={inv.id} disabled={!inv.client_id || lines.length === 0} />}
            <Button variant="secondary" icon={<Copy className="size-4" />} onClick={async () => {
              const nid = await rpc("duplicate_invoice", { p_invoice: inv.id }, "Copie créée en brouillon (prix actuels du catalogue).");
              if (nid) navigate(`/factures/${nid}/modifier`);
            }}>Dupliquer</Button>
            {isDraft && <Link to={`/factures/${inv.id}/modifier`}><Button variant="secondary" icon={<PencilLine className="size-4" />}>Modifier</Button></Link>}
            {isDraft && <Button variant="ghost" className="text-danger" icon={<Trash2 className="size-4" />} onClick={() => setDialog("delete")}>Supprimer</Button>}
            {isDraft && canManage && <Button variant="accent" icon={<ShieldCheck className="size-4" />} onClick={() => setDialog("validate")}>Valider</Button>}
            {!isDraft && inv.status !== "cancelled" && canManage && (
              <>
                {remaining > 0 && <Button variant="secondary" icon={<Wallet className="size-4" />} onClick={() => setDialog("payment")}>Enregistrer un paiement</Button>}
                {inv.amount_paid === 0 && <Button variant="secondary" icon={<FilePenLine className="size-4" />} onClick={() => setDialog("correct")}>Corriger</Button>}
                {inv.amount_paid === 0 && <Button variant="ghost" className="text-danger" icon={<Ban className="size-4" />} onClick={() => setDialog("cancel")}>Annuler</Button>}
              </>
            )}
          </>
        }
      />

      {inv.status === "cancelled" && (
        <div className="mb-4 rounded-md border border-danger/20 bg-danger/5 p-3 text-sm text-danger">
          Facture annulée le {formatDateFr(inv.cancelled_at?.slice(0, 10))} — motif : {inv.cancel_reason}. Son numéro reste réservé.
          {data.corrections.map((c) => (
            <span key={c.id}> Remplacée par <Link className="font-medium underline" to={`/factures/${c.id}`}>{c.number ?? "un brouillon"}</Link>.</span>
          ))}
        </div>
      )}
      {inv.corrects_invoice_id && (
        <div className="mb-4 rounded-md border border-line bg-white p-3 text-sm">
          Cette facture corrige une facture annulée : <Link className="font-medium underline" to={`/factures/${inv.corrects_invoice_id}`}>voir l'original</Link>.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <PdfPreview data={pdfData} height={900} />

        <div className="space-y-4">
          <Card title="Montants">
            <dl className="space-y-1.5 p-4 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Montant HT</dt><dd className="num">{formatMoney(inv.total_ht)}</dd></div>
              {inv.vat_breakdown.map((g) => (
                <div key={g.vat_rate_bp} className="flex justify-between">
                  <dt className="text-muted">{g.vat_rate_bp === 0 ? "Exonéré (base)" : `TVA ${formatRate(g.vat_rate_bp)} sur ${formatMoney(g.base_ht)}`}</dt>
                  <dd className="num">{formatMoney(g.vat_rate_bp === 0 ? g.base_ht : g.vat)}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>Total TTC</dt><dd className="num">{formatMoney(inv.total_ttc)} {company.currency_label}</dd></div>
              {!isDraft && (
                <>
                  <div className="flex justify-between"><dt className="text-muted">Payé</dt><dd className="num">{formatMoney(inv.amount_paid)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Reste à payer</dt><dd className="num font-medium">{formatMoney(remaining)}</dd></div>
                </>
              )}
              <p className="pt-2 text-xs uppercase text-ink-800">{amountToFrenchWords(inv.total_ttc)}</p>
            </dl>
          </Card>

          <Card title="Bons de livraison / commande">
            {data.notes.length === 0 ? (
              <p className="p-4 text-sm text-muted">Aucun bon. Cliquez sur « Créer le BL » ou « Créer le BC » en haut de la page.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {data.notes.map((n) => (
                  <li key={n.id} className="flex items-center justify-between px-4 py-2">
                    <Link to={`/bons/${n.id}`} className="font-medium text-ink-800 hover:underline">{n.number}</Link>
                    <span className="text-muted">{NOTE_LABEL[n.kind]} · {formatDateFr(n.issue_date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Informations">
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 p-4 text-sm">
              <dt className="text-muted">Client</dt><dd>{clientName || "—"}</dd>
              <dt className="text-muted">ICE client</dt><dd className="num">{inv.client_snapshot?.ice ?? client?.ice ?? "—"}</dd>
              <dt className="text-muted">Échéance</dt><dd>{formatDateFr(inv.due_date) || "—"}</dd>
              <dt className="text-muted">Règlement</dt><dd>{inv.payment_method ? PAYMENT_METHOD_PDF[inv.payment_method] ?? inv.payment_method : "—"}</dd>
              <dt className="text-muted">Commande</dt><dd>{inv.order_ref ?? "—"}</dd>
              <dt className="text-muted">Bon de livraison</dt><dd>{inv.delivery_note_ref ?? "—"}</dd>
              <dt className="text-muted">Nature</dt><dd>{inv.goods_nature ?? "—"}</dd>
              <dt className="text-muted">Lignes</dt><dd>{lines.length}</dd>
              {lines.some((l) => l.price_override_reason) && (<><dt className="text-muted">Dérogations</dt><dd>{lines.filter((l) => l.price_override_reason).map((l) => `${l.designation} : ${l.price_override_reason}`).join(" · ")}</dd></>)}
              {inv.validated_at && (<><dt className="text-muted">Validée le</dt><dd>{new Date(inv.validated_at).toLocaleString("fr-MA")}</dd></>)}
            </dl>
          </Card>

          {!isDraft && (
            <Card title="Paiements">
              {payments.length === 0 ? <p className="p-4 text-sm text-muted">Aucun paiement enregistré.</p> : (
                <Table>
                  <thead><tr><th>Date</th><th>Mode</th><th className="text-right">Montant</th><th /></tr></thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="num">{formatDateFr(p.paid_at)}</td>
                        <td>{PAYMENT_METHOD_LABEL[p.method]}{p.reference ? ` · ${p.reference}` : ""}</td>
                        <td className="num text-right">{formatMoney(p.amount)}</td>
                        <td className="text-right">
                          {canManage && (
                            <button type="button" className="text-xs text-danger hover:underline" onClick={async () => {
                              if (!confirm("Supprimer ce paiement ? L'opération est journalisée.")) return;
                              try { must(await supabase.from("payments").delete().eq("id", p.id)); toast.success("Paiement supprimé."); void q.reload(); }
                              catch (err) { toast.error(errorMessage(err)); }
                            }}>Supprimer</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}

          {canManage && data.history.length > 0 && (
            <Card title="Historique">
              <ul className="max-h-72 space-y-2 overflow-y-auto p-4 text-xs">
                {data.history.map((h) => (
                  <li key={h.id}>
                    <span className="num text-muted">{new Date(h.at).toLocaleString("fr-MA")}</span> — {describeChange(h)}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={dialog === "validate"}
        title="Valider la facture"
        message={<>La facture recevra le prochain numéro de la série et ne pourra plus être modifiée ni supprimée. Total : <b>{formatMoney(inv.total_ttc)} {company.currency_label}</b>.</>}
        confirmLabel="Valider et numéroter"
        onClose={() => setDialog(null)}
        onConfirm={async () => { if (await rpc("validate_invoice", { p_invoice: inv.id }, "Facture validée.")) void q.reload(); }}
      />
      <ConfirmDialog
        open={dialog === "cancel"}
        title="Annuler la facture"
        message="La facture reste dans le registre avec la mention ANNULÉE ; son numéro n'est jamais réutilisé."
        confirmLabel="Annuler la facture"
        danger
        reasonLabel="Motif de l'annulation"
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => { if ((await rpc("cancel_invoice", { p_invoice: inv.id, p_reason: reason }, "Facture annulée.")) !== null) void q.reload(); }}
      />
      <ConfirmDialog
        open={dialog === "correct"}
        title="Corriger la facture"
        message="La facture actuelle sera annulée (numéro conservé) et un nouveau brouillon, lié à celle-ci, sera créé avec les mêmes lignes aux prix actuels du catalogue."
        confirmLabel="Annuler et créer la correction"
        reasonLabel="Motif de la correction"
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          const nid = await rpc("correct_invoice", { p_invoice: inv.id, p_reason: reason }, "Brouillon de correction créé.");
          if (nid) navigate(`/factures/${nid}/modifier`);
        }}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        title="Supprimer le brouillon"
        message="Ce brouillon n'a pas de numéro : il sera définitivement supprimé."
        confirmLabel="Supprimer"
        danger
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          try { must(await supabase.from("invoices").delete().eq("id", inv.id)); toast.success("Brouillon supprimé."); navigate("/factures"); }
          catch (err) { toast.error(errorMessage(err)); }
        }}
      />
      <PaymentDialog open={dialog === "payment"} invoice={inv} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); void q.reload(); }} />
    </>
  );
}

const FIELD_LABELS: Record<string, string> = {
  status: "statut", number: "numéro", issue_date: "date", due_date: "échéance", client_id: "client", notes: "observations",
  goods_nature: "nature", payment_terms: "conditions", order_ref: "commande", delivery_note_ref: "bon de livraison", amount_paid: "montant payé", cancel_reason: "motif d'annulation",
};

function describeChange(h: AuditEntry): string {
  if (h.action === "insert") return "Création";
  if (h.action === "delete") return "Suppression";
  const changed = Object.keys(h.new_data ?? {}).filter(
    (k) => FIELD_LABELS[k] && JSON.stringify(h.new_data?.[k]) !== JSON.stringify(h.old_data?.[k]),
  );
  if (changed.includes("status")) {
    const s = h.new_data?.status;
    if (s === "validated" && h.old_data?.status === "draft") return `Validation — numéro ${h.new_data?.number}`;
    if (s === "cancelled") return `Annulation — ${h.new_data?.cancel_reason}`;
    if (s === "paid") return "Facture soldée";
    if (s === "partially_paid") return "Paiement partiel";
  }
  return changed.length ? `Modification : ${changed.map((k) => FIELD_LABELS[k]).join(", ")}` : "Mise à jour";
}

function PaymentDialog({ open, invoice, onClose, onSaved }: { open: boolean; invoice: Invoice; onClose: () => void; onSaved: () => void }) {
  const remaining = invoice.total_ttc - invoice.amount_paid;
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [method, setMethod] = useState<Payment["method"]>("virement");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const cents = parseMoney(amount);
  const err = !amount ? null : cents === null || cents <= 0 ? "Montant invalide." : cents > remaining ? `Maximum : ${formatMoney(remaining)}.` : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Enregistrer un paiement"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Retour</Button>
          <Button loading={busy} disabled={!cents || Boolean(err)} onClick={async () => {
            setBusy(true);
            try {
              must(await supabase.from("payments").insert({ invoice_id: invoice.id, company_id: invoice.company_id, amount: cents, paid_at: date, method, reference: reference.trim() || null }));
              toast.success("Paiement enregistré.");
              setAmount(""); setReference("");
              onSaved();
            } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
          }}>Enregistrer</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Montant (DH)" required error={err} hint={`Reste à payer : ${formatMoney(remaining)}`}>
          <div className="flex gap-2">
            <Input inputMode="decimal" className="num text-right" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Button variant="secondary" size="sm" className="h-9" onClick={() => setAmount((remaining / 100).toFixed(2).replace(".", ","))}>Solde</Button>
          </div>
        </Field>
        <Field label="Date" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Mode">
          <Select value={method} onChange={(e) => setMethod(e.target.value as Payment["method"])}>
            {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Référence"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="N° chèque, virement…" /></Field>
      </div>
    </Dialog>
  );
}
