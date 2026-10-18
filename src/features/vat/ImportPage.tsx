import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { FileUp, Loader2, StopCircle } from "lucide-react";
import { supabase, must, errorMessage } from "@/lib/supabase";
import { useActiveCompany } from "@/lib/session";
import { useAsync } from "@/lib/hooks";
import type { PdfImport, VatEntryKind } from "@/lib/types";
import { AlreadyImportedError, importPdf, type ImportProgress, type ImportResult } from "@/lib/vatImport";
import { terminateOcr } from "@/lib/ocr";
import { Badge, Button, Card, ConfirmDialog, EmptyState, PageHeader, Select, Spinner, Table } from "@/components/ui";

const PHASE: Record<ImportProgress["phase"], string> = {
  hash: "Analyse du fichier", upload: "Sauvegarde du PDF", read: "Lecture des pages", extract: "Extraction des factures", save: "Enregistrement", done: "Terminé",
};

export function ImportPage() {
  const { company } = useActiveCompany();
  const navigate = useNavigate();
  const [kind, setKind] = useState<VatEntryKind>("purchase");
  const [queue, setQueue] = useState<File[]>([]);
  const [current, setCurrent] = useState<{ name: string; progress: ImportProgress } | null>(null);
  const [results, setResults] = useState<{ name: string; result?: ImportResult; error?: string }[]>([]);
  const [reimport, setReimport] = useState<{ file: File; message: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const history = useAsync(async () => must(await supabase.from("pdf_imports").select("*").eq("company_id", company.id).order("created_at", { ascending: false }).limit(30)) as PdfImport[], [company.id]);

  const run = async (files: File[], allowReimport = false) => {
    for (const file of files) {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setCurrent({ name: file.name, progress: { phase: "hash", pagesDone: 0, pageCount: 0, ocrPages: 0, invoicesDetected: 0, errors: [] } });
      try {
        const result = await importPdf(file, {
          company, defaultKind: kind, signal: ctrl.signal, allowReimport,
          onProgress: (p) => setCurrent({ name: file.name, progress: { ...p } }),
        });
        setResults((r) => [{ name: file.name, result }, ...r]);
        toast.success(`${file.name} : ${result.invoices} facture(s) extraite(s), ${result.toReview} à contrôler.`);
      } catch (e) {
        if (e instanceof AlreadyImportedError) setReimport({ file, message: e.message });
        else if ((e as Error).name === "AbortError") {
          setResults((r) => [{ name: file.name, error: "Import interrompu. Relancez le même fichier pour reprendre où il s'était arrêté." }, ...r]);
          break;
        } else {
          setResults((r) => [{ name: file.name, error: errorMessage(e) }, ...r]);
          toast.error(`${file.name} : ${errorMessage(e)}`);
        }
      }
    }
    setCurrent(null);
    abortRef.current = null;
    void terminateOcr();
    void history.reload();
  };

  const p = current?.progress;
  const pct = p && p.pageCount ? Math.round((p.pagesDone / p.pageCount) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Importation PDF"
        description="Déposez des PDF de factures (plusieurs centaines de pages possibles, plusieurs factures par fichier, pages scannées comprises). Les factures extraites sont à contrôler avant d'entrer dans le journal."
      />

      <Card title="Nouveau fichier">
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              Type par défaut
              <Select className="w-64" value={kind} onChange={(e) => setKind(e.target.value as VatEntryKind)} disabled={current !== null}>
                <option value="purchase">Factures d'achat (fournisseurs)</option>
                <option value="sale">Factures de vente (clients)</option>
              </Select>
            </label>
            <p className="max-w-xl text-xs text-muted">
              Le sens est corrigé automatiquement quand l'ICE de {company.legal_name}{company.ice ? ` (${company.ice})` : ""} apparaît comme émetteur (vente) ou comme client (achat).
              {!company.ice && <> Renseignez l'ICE de l'entreprise pour profiter de cette détection.</>}
            </p>
          </div>

          <label
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-ink-200 bg-ink-50/40 px-6 py-10 text-center hover:bg-ink-50 ${current ? "pointer-events-none opacity-60" : ""}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = [...e.dataTransfer.files].filter((x) => /\.pdf$/i.test(x.name)); if (f.length) { setQueue(f); void run(f); } }}
          >
            <FileUp className="mb-2 size-7 text-ink-600" />
            <span className="font-medium text-ink-900">Glissez vos PDF ici ou cliquez pour choisir</span>
            <span className="mt-1 text-xs text-muted">Plusieurs fichiers acceptés · texte et scans (OCR) · traitement dans votre navigateur, par lots de pages</span>
            <input type="file" accept="application/pdf,.pdf" multiple className="sr-only"
              onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) { setQueue(f); void run(f); } }} />
          </label>

          {current && p && (
            <div className="rounded-md border border-line p-4" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 font-medium"><Loader2 className="size-4 animate-spin" /> {current.name} — {PHASE[p.phase]}</span>
                <Button size="sm" variant="ghost" className="text-danger" icon={<StopCircle className="size-4" />} onClick={() => abortRef.current?.abort()}>Interrompre</Button>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-canvas">
                <div className="h-full rounded-full bg-ink-600 transition-[width]" style={{ width: `${p.phase === "read" ? pct : p.phase === "hash" || p.phase === "upload" ? 2 : 100}%` }} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-muted">Pages traitées</dt><dd className="num font-semibold">{p.pagesDone} / {p.pageCount || "…"}</dd></div>
                <div><dt className="text-xs text-muted">Pages lues par OCR</dt><dd className="num font-semibold">{p.ocrPages}</dd></div>
                <div><dt className="text-xs text-muted">Factures détectées</dt><dd className="num font-semibold">{p.invoicesDetected}</dd></div>
                <div><dt className="text-xs text-muted">Erreurs</dt><dd className="num font-semibold">{p.errors.length}</dd></div>
              </dl>
              {p.message && <p className="mt-2 text-xs text-muted">{p.message}</p>}
              {queue.length > 1 && <p className="mt-1 text-xs text-muted">{queue.length} fichiers dans la file.</p>}
            </div>
          )}

          {results.length > 0 && (
            <ul className="space-y-2">
              {results.map((r, i) => (
                <li key={i} className={`rounded-md border p-3 text-sm ${r.error ? "border-danger/30 bg-danger/5" : "border-success/20 bg-success/5"}`}>
                  <div className="font-medium">{r.name}</div>
                  {r.error ? <div className="text-danger">{r.error}</div> : r.result && (
                    <>
                      <div>
                        {r.result.pageCount} pages · <b>{r.result.invoices}</b> factures · <b>{r.result.toReview}</b> à contrôler
                        {r.result.duplicates > 0 && <> · {r.result.duplicates} doublon(s) écarté(s)</>}
                        {r.result.ocrPages > 0 && <> · {r.result.ocrPages} page(s) OCR</>}
                      </div>
                      {r.result.errors.map((e) => <div key={e} className="text-xs text-saffron-700">{e}</div>)}
                      <Button size="sm" className="mt-2" onClick={() => navigate(`/tva/controle?import=${r.result!.importId}`)}>Contrôler les factures</Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card className="mt-6" title="Derniers imports">
        {history.loading && !history.data ? <Spinner /> : (history.data ?? []).length === 0 ? <EmptyState title="Aucun import pour l'instant" /> : (
          <Table>
            <thead><tr><th>Fichier</th><th>Date</th><th className="text-right">Pages</th><th className="text-right">Factures</th><th className="text-right">À contrôler</th><th>État</th><th /></tr></thead>
            <tbody>
              {history.data!.map((h) => (
                <tr key={h.id}>
                  <td className="max-w-xs truncate font-medium" title={h.file_name}>{h.file_name}</td>
                  <td className="num">{new Date(h.created_at).toLocaleString("fr-MA")}</td>
                  <td className="num text-right">{h.pages_done}/{h.page_count}{h.ocr_pages ? ` (${h.ocr_pages} OCR)` : ""}</td>
                  <td className="num text-right">{h.invoices_found}</td>
                  <td className="num text-right">{h.needs_review}</td>
                  <td>
                    {h.status === "done" ? <Badge tone="ok">Terminé</Badge> : h.status === "processing" ? <Badge tone="warn">Interrompu — relancez le fichier</Badge> : <Badge tone="danger" >Erreur</Badge>}
                    {h.error_message && <div className="max-w-xs truncate text-xs text-muted" title={h.error_message}>{h.error_message}</div>}
                  </td>
                  <td className="text-right"><Link to={`/tva/controle?import=${h.id}`} className="text-sm text-ink-700 hover:underline">Voir</Link></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={reimport !== null}
        title="Fichier déjà importé"
        message={<>{reimport?.message} Le réimporter remplacera les factures de ce fichier qui ne sont pas encore validées (les factures validées sont conservées).</>}
        confirmLabel="Réimporter"
        onClose={() => setReimport(null)}
        onConfirm={async () => { const f = reimport!.file; setReimport(null); await run([f], true); }}
      />
    </>
  );
}
