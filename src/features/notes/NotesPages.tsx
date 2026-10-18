import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { saveAs } from "file-saver";
import { ArrowLeft, Download, FileText, ImageDown, Search, Trash2 } from "lucide-react";
import { supabase, must, errorMessage } from "@/lib/supabase";
import { useActiveCompany } from "@/lib/session";
import { useAsync, useDebounced } from "@/lib/hooks";
import type { DeliveryNote, DeliveryNoteLine, InvoiceTemplateRow, NoteKind } from "@/lib/types";
import { formatMoney, formatQuantity } from "@/domain/money";
import { formatDateFr } from "@/domain/dates";
import { buildNotePdfData, noteFileName, renderPdfBlob } from "@/pdf/export";
import { PdfPreview } from "@/pdf/PdfPreview";
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorBox, Field, Input, PageHeader, Pagination, Spinner, Table, Textarea,
} from "@/components/ui";
import { cn } from "@/lib/utils";

export const NOTE_LABEL: Record<NoteKind, string> = { BL: "Bon de livraison", BC: "Bon de commande" };
const PAGE = 25;

// ---------------------------------------------------------------------
// Liste : /bons?type=BL|BC
// ---------------------------------------------------------------------
export function NotesListPage() {
  const { company } = useActiveCompany();
  const [params, setParams] = useSearchParams();
  const kind = (params.get("type") === "BC" ? "BC" : params.get("type") === "BL" ? "BL" : "") as NoteKind | "";
  const [q, setQ] = useState("");
  const query = useDebounced(q);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [kind, query]);

  const list = useAsync(async () => {
    let req = supabase.from("delivery_notes").select("*", { count: "exact" }).eq("company_id", company.id);
    if (kind) req = req.eq("kind", kind);
    if (query.trim()) {
      const s = query.trim().replace(/[%,()]/g, " ");
      req = req.or(`number.ilike.%${s}%,invoice_number.ilike.%${s}%,order_ref.ilike.%${s}%,client_snapshot->>name.ilike.%${s}%`);
    }
    const res = await req.order("issue_date", { ascending: false }).order("created_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (res.error) throw res.error;
    const rows = (res.data ?? []) as DeliveryNote[];
    const counts = new Map<string, number>();
    if (rows.length) {
      const l = must(await supabase.from("delivery_note_lines").select("note_id").in("note_id", rows.map((r) => r.id))) as { note_id: string }[];
      for (const x of l) counts.set(x.note_id, (counts.get(x.note_id) ?? 0) + 1);
    }
    return { rows, counts, total: res.count ?? 0 };
  }, [company.id, kind, query, page]);

  const tabs: { k: NoteKind | ""; label: string }[] = [
    { k: "", label: "Tous" }, { k: "BL", label: "Bons de livraison" }, { k: "BC", label: "Bons de commande" },
  ];
  const rows = list.data?.rows ?? [];

  return (
    <>
      <PageHeader
        title="Bons de livraison et de commande"
        description="Créez les bons depuis une facture (boutons « Créer le BL » / « Créer le BC ») ou pour plusieurs factures à la fois : cochez-les dans la liste des factures puis « Créer les BL » ou « Créer les BC »."
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <div className="flex rounded-md border border-line p-0.5" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.k || "all"}
                type="button"
                role="tab"
                aria-selected={kind === t.k}
                onClick={() => setParams(t.k ? { type: t.k } : {})}
                className={cn("rounded px-3 py-1.5 text-sm", kind === t.k ? "bg-ink-800 text-white" : "text-muted hover:bg-canvas")}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
            <Input className="pl-8" placeholder="N° de bon, n° de facture, client, commande" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {list.loading && !list.data ? <Spinner /> : list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> :
          rows.length === 0 ? (
            <EmptyState title={q ? "Aucun bon ne correspond à la recherche" : "Aucun bon pour l'instant"}>
              Ouvrez une facture (menu Factures) puis cliquez sur « Créer le BL » ou « Créer le BC » : le bon apparaîtra ici.
            </EmptyState>
          ) : (
            <>
              <Table>
                <thead>
                  <tr><th>N° du bon</th><th>Type</th><th>Date</th><th>Client</th><th>Facture</th><th className="text-right">Articles</th><th className="text-right">Total TTC</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td><Link to={`/bons/${r.id}`} className="font-medium text-ink-800 hover:underline">{r.number}</Link></td>
                      <td><Badge tone={r.kind === "BL" ? "ok" : "neutral"}>{NOTE_LABEL[r.kind]}</Badge></td>
                      <td className="num">{formatDateFr(r.issue_date)}</td>
                      <td>{r.client_snapshot?.name ?? "—"}</td>
                      <td>{r.invoice_id ? <Link to={`/factures/${r.invoice_id}`} className="hover:underline">{r.invoice_number ?? "Brouillon"}</Link> : "—"}</td>
                      <td className="num text-right">{list.data?.counts.get(r.id) ?? 0}</td>
                      <td className="num text-right">{r.show_prices ? formatMoney(r.total_ttc) : <span className="text-muted">sans prix</span>}</td>
                    </tr>
                  ))}
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
// Détail : /bons/:id
// ---------------------------------------------------------------------
export function NoteDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { company, canManage } = useActiveCompany();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState("");
  const [showPrices, setShowPrices] = useState(false);
  const [saving, setSaving] = useState(false);

  const q = useAsync(async () => {
    const note = must(await supabase.from("delivery_notes").select("*").eq("id", id!).eq("company_id", company.id).single()) as DeliveryNote;
    const [lines, templates, inv] = await Promise.all([
      supabase.from("delivery_note_lines").select("*").eq("note_id", note.id).order("position"),
      supabase.from("invoice_templates").select("*").eq("company_id", company.id),
      note.invoice_id ? supabase.from("invoices").select("template_id").eq("id", note.invoice_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    const tpls = must(templates) as InvoiceTemplateRow[];
    const tplId = (must(inv) as { template_id: string | null } | null)?.template_id ?? company.default_template_id;
    const template = tpls.find((t) => t.id === tplId) ?? null;
    return { note, lines: must(lines) as DeliveryNoteLine[], template };
  }, [id, company.id]);

  useEffect(() => {
    if (q.data) { setNotes(q.data.note.notes ?? ""); setDate(q.data.note.issue_date); setShowPrices(q.data.note.show_prices); }
  }, [q.data]);

  // L'aperçu suit les réglages en direct (avant même l'enregistrement).
  const notesPreview = useDebounced(notes, 700);
  const pdf = useAsync(async () => {
    if (!q.data) return null;
    const draft = { ...q.data.note, notes: notesPreview.trim() || null, issue_date: date || q.data.note.issue_date, show_prices: showPrices };
    return buildNotePdfData(draft, q.data.lines, company, q.data.template);
  }, [q.data, notesPreview, date, showPrices, company]);
  const pdfData = useMemo(() => pdf.data ?? null, [pdf.data]);

  if (q.loading && !q.data) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox message={q.error ?? "Bon introuvable."} onRetry={q.reload} />;
  const { note, lines } = q.data;
  const dirty = notes !== (note.notes ?? "") || date !== note.issue_date || showPrices !== note.show_prices;

  const save = async () => {
    setSaving(true);
    try {
      must(await supabase.from("delivery_notes").update({ notes: notes.trim() || null, issue_date: date, show_prices: showPrices }).eq("id", note.id));
      toast.success("Bon enregistré.");
      void q.reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setSaving(false); }
  };

  const download = async () => {
    try {
      if (!pdfData) return;
      saveAs(await renderPdfBlob(pdfData), noteFileName(note));
    } catch (err) { toast.error(errorMessage(err)); }
  };
  const downloadJpg = async () => {
    try {
      if (!pdfData) return;
      const blob = await renderPdfBlob(pdfData);
      const { pdfToJpegs } = await import("@/lib/pdfjs");
      const images = await pdfToJpegs(await blob.arrayBuffer());
      const base = noteFileName(note, "jpg").replace(/\.jpg$/, "");
      if (images.length === 1) saveAs(images[0], `${base}.jpg`);
      else {
        const { default: JSZip } = await import("jszip");
        const zip = new JSZip();
        images.forEach((img, i) => zip.file(`${base}_page-${i + 1}.jpg`, img));
        saveAs(await zip.generateAsync({ type: "blob" }), `${base}_JPG.zip`);
      }
    } catch (err) { toast.error(errorMessage(err)); }
  };

  return (
    <>
      <PageHeader
        title={`${NOTE_LABEL[note.kind]} ${note.number}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={note.kind === "BL" ? "ok" : "neutral"}>{note.kind}</Badge>
            {note.is_demo && <Badge tone="warn">Démonstration</Badge>}
            <span>{note.client_snapshot?.name ?? "—"} · {formatDateFr(note.issue_date)}</span>
          </span>
        }
        actions={
          <>
            <Link to={`/bons?type=${note.kind}`}><Button variant="ghost" icon={<ArrowLeft className="size-4" />}>Bons</Button></Link>
            {note.invoice_id && (
              <Link to={`/factures/${note.invoice_id}`}><Button variant="secondary" icon={<FileText className="size-4" />}>Voir la facture</Button></Link>
            )}
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={download} disabled={!pdfData}>Télécharger le PDF</Button>
            <Button variant="secondary" icon={<ImageDown className="size-4" />} onClick={downloadJpg} disabled={!pdfData}>JPG</Button>
            {canManage && <Button variant="ghost" className="text-danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>Supprimer</Button>}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <PdfPreview data={pdfData} height={900} />
        <div className="space-y-4">
          <Card title="Réglages du bon">
            <div className="space-y-3 p-4">
              <Field label="Date du bon"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Checkbox
                label="Afficher les prix et les totaux"
                hint={note.kind === "BL" ? "Un bon de livraison est souvent remis sans prix." : undefined}
                checked={showPrices}
                onChange={setShowPrices}
              />
              <Field label="Observations" hint="Ex. : adresse de livraison, chauffeur, véhicule…">
                <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <div className="flex justify-end">
                <Button loading={saving} disabled={!dirty || !date} onClick={save}>Enregistrer</Button>
              </div>
            </div>
          </Card>
          <Card title="Informations">
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 p-4 text-sm">
              <dt className="text-muted">Client</dt><dd>{note.client_snapshot?.name ?? "—"}</dd>
              <dt className="text-muted">ICE client</dt><dd className="num">{note.client_snapshot?.ice ?? "—"}</dd>
              <dt className="text-muted">Facture</dt><dd>{note.invoice_id ? <Link className="underline" to={`/factures/${note.invoice_id}`}>{note.invoice_number ?? "Brouillon"}</Link> : "—"}</dd>
              <dt className="text-muted">Commande</dt><dd>{note.order_ref ?? "—"}</dd>
              <dt className="text-muted">Total TTC</dt><dd className="num">{formatMoney(note.total_ttc)} {company.currency_label}</dd>
            </dl>
          </Card>
          <Card title={`Articles (${lines.length})`}>
            <ul className="divide-y divide-line text-sm">
              {lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-3 px-4 py-2">
                  <span>{l.designation}</span>
                  <span className="num shrink-0">{formatQuantity(Number(l.quantity))}{l.unit && l.unit !== "U" ? ` ${l.unit}` : ""}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Supprimer le bon"
        message={<>Le bon <b>{note.number}</b> sera supprimé (la facture n'est pas modifiée). Son numéro ne sera pas réattribué.</>}
        confirmLabel="Supprimer"
        danger
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            must(await supabase.from("delivery_notes").delete().eq("id", note.id).select("id").single());
            toast.success("Bon supprimé.");
            navigate(`/bons?type=${note.kind}`);
          } catch (err) { toast.error(errorMessage(err)); }
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------
// Boutons « Créer le BL / BC » sur la fiche facture
// ---------------------------------------------------------------------
export function CreateNoteButtons({ invoiceId, disabled }: { invoiceId: string; disabled?: boolean }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<NoteKind | null>(null);
  const create = async (kind: NoteKind) => {
    setBusy(kind);
    try {
      const nid = must(await supabase.rpc("create_note_from_invoice", { p_invoice: invoiceId, p_kind: kind })) as string;
      toast.success(`${NOTE_LABEL[kind]} prêt.`);
      navigate(`/bons/${nid}`);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(null); }
  };
  return (
    <>
      <Button variant="secondary" loading={busy === "BL"} disabled={disabled || busy !== null} onClick={() => create("BL")}>Créer le BL</Button>
      <Button variant="secondary" loading={busy === "BC"} disabled={disabled || busy !== null} onClick={() => create("BC")}>Créer le BC</Button>
    </>
  );
}
