/** Conversion d'un résultat Tesseract (mots + boîtes) en éléments de texte positionnés. */
import { buildLines, type PageText, type TextItem } from "@/domain/extraction/layout";

interface Box { x0: number; y0: number; x1: number; y1: number }
interface OcrWord { text: string; bbox: Box; confidence?: number }
interface OcrLine { words?: OcrWord[] }
interface OcrPara { lines?: OcrLine[] }
interface OcrBlock { paragraphs?: OcrPara[] }
export interface OcrData { blocks?: OcrBlock[] | null; text?: string }

/** `scale` : pixels par point PDF (ex. 2,5 si la page a été rendue à 180 dpi). */
export function ocrToPage(page: number, data: OcrData, scale: number, minConfidence = 30): PageText {
  const items: TextItem[] = [];
  for (const b of data.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) for (const w of l.words ?? []) {
    const t = (w.text ?? "").trim();
    if (!t || (w.confidence ?? 100) < minConfidence) continue;
    const h = (w.bbox.y1 - w.bbox.y0) / scale;
    items.push({ str: t, x: w.bbox.x0 / scale, y: (w.bbox.y0 + w.bbox.y1) / 2 / scale, w: (w.bbox.x1 - w.bbox.x0) / scale, h: Math.max(4, h) });
  }
  return { page, lines: buildLines(page, items), ocr: true };
}
