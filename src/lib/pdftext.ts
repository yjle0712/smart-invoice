/**
 * Lecture du texte d'un PDF avec pdf.js, page par page, par lots (pour ne pas bloquer
 * l'interface sur les fichiers de plusieurs centaines de pages).
 * Fonctionne dans le navigateur et sous Node (tests) : on lui passe le module pdf.js.
 */
import { buildLines, type PageText, type TextItem } from "@/domain/extraction/layout";

/* Types minimaux de pdf.js utilisés ici (évite de dépendre des types internes). */
interface PdfTextItem { str?: string; transform?: number[]; width?: number; height?: number }
interface PdfPage {
  getViewport(o: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  cleanup?: () => void;
}
export interface PdfDoc { numPages: number; getPage(n: number): Promise<PdfPage> }

export async function readPageText(doc: PdfDoc, pageNumber: number): Promise<PageText> {
  const page = await doc.getPage(pageNumber);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items: TextItem[] = [];
  for (const it of tc.items) {
    if (!it.str || !it.transform) continue;
    const [a, b, , d, e, f] = it.transform;
    const fontH = Math.hypot(b, d) || Math.abs(d) || it.height || 8;
    // Texte fortement incliné (filigranes) : ignoré.
    if (Math.abs(b) > Math.abs(a) * 0.2) continue;
    items.push({ str: it.str, x: e, y: vp.height - f, w: it.width ?? it.str.length * fontH * 0.5, h: fontH });
  }
  page.cleanup?.();
  return { page: pageNumber, lines: buildLines(pageNumber, items), height: vp.height };
}

export interface ReadProgress { done: number; total: number }

/**
 * Lit les pages [from..to] par lots de `batch`, en rendant la main au navigateur entre deux lots.
 * `onPage` reçoit chaque page lue (pour l'enregistrer au fur et à mesure / reprise).
 */
export async function readPages(
  doc: PdfDoc,
  opts: { from?: number; to?: number; batch?: number; signal?: AbortSignal; onPage?: (p: PageText) => void | Promise<void>; onProgress?: (p: ReadProgress) => void },
): Promise<PageText[]> {
  const from = opts.from ?? 1;
  const to = Math.min(opts.to ?? doc.numPages, doc.numPages);
  const batch = opts.batch ?? 10;
  const out: PageText[] = [];
  for (let start = from; start <= to; start += batch) {
    if (opts.signal?.aborted) throw new DOMException("Import interrompu", "AbortError");
    const end = Math.min(to, start + batch - 1);
    const pages = await Promise.all(Array.from({ length: end - start + 1 }, (_, i) => readPageText(doc, start + i)));
    for (const p of pages) {
      out.push(p);
      await opts.onPage?.(p);
    }
    opts.onProgress?.({ done: end - from + 1, total: to - from + 1 });
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}
