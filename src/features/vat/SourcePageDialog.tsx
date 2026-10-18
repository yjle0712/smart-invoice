import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { supabase, must } from "@/lib/supabase";
import type { PdfImport } from "@/lib/types";
import { getImportPdf } from "@/lib/vatImport";
import { Button, Dialog } from "@/components/ui";

/** Affiche la page d'origine d'une facture extraite (rendu pdf.js du PDF importé). */
export function SourcePageDialog({
  importId, pageFrom, pageTo, title, onClose,
}: { importId: string | null; pageFrom: number | null; pageTo: number | null; title: string; onClose: () => void }) {
  const open = importId !== null && pageFrom !== null;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(pageFrom ?? 1);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const docRef = useRef<{ doc: { numPages: number; getPage(n: number): Promise<unknown> }; destroy: () => Promise<void> } | null>(null);

  useEffect(() => { setPage(pageFrom ?? 1); }, [pageFrom, importId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const imp = must(await supabase.from("pdf_imports").select("*").eq("id", importId!).single()) as PdfImport;
        const buf = await getImportPdf(imp);
        if (!buf) throw new Error("Le PDF source n'est pas disponible (non sauvegardé). Réimportez le fichier pour voir les pages.");
        const { pdfjs } = await import("@/lib/pdfjs");
        const task = pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) });
        const doc = await task.promise;
        if (cancelled) { await task.destroy(); return; }
        docRef.current = { doc, destroy: () => task.destroy() };
        setNumPages(doc.numPages);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      void docRef.current?.destroy();
      docRef.current = null;
      setNumPages(0);
    };
  }, [open, importId]);

  useEffect(() => {
    const d = docRef.current;
    const canvas = canvasRef.current;
    if (!d || !canvas || !numPages) return;
    let cancelled = false;
    (async () => {
      const p = (await d.doc.getPage(Math.min(Math.max(1, page), numPages))) as {
        getViewport(o: { scale: number }): { width: number; height: number };
        render(o: object): { promise: Promise<void> };
      };
      const vp = p.getViewport({ scale: 1.4 });
      canvas.width = vp.width;
      canvas.height = vp.height;
      const ctx = canvas.getContext("2d");
      if (!ctx || cancelled) return;
      await p.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    })().catch((e) => setError((e as Error).message));
    return () => { cancelled = true; };
  }, [page, numPages]);

  return (
    <Dialog open={open} onClose={onClose} title={title} wide>
      {busy && <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" /> Chargement du PDF…</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {numPages > 0 && (
        <>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span>Page <b className="num">{page}</b> / {numPages}{pageFrom && pageTo && (page < pageFrom || page > pageTo) ? " (hors de la facture)" : ""}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)} icon={<ChevronLeft className="size-4" />} aria-label="Page précédente" />
              <Button size="sm" variant="secondary" disabled={page >= numPages} onClick={() => setPage(page + 1)} icon={<ChevronRight className="size-4" />} aria-label="Page suivante" />
            </div>
          </div>
          <div className="max-h-[70vh] overflow-auto rounded border border-line bg-[#525659] p-2">
            <canvas ref={canvasRef} className="mx-auto block max-w-full bg-white shadow" />
          </div>
        </>
      )}
    </Dialog>
  );
}
