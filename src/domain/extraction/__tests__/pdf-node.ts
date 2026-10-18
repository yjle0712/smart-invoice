/** Lecture d'un PDF sous Node pour les tests (pdf.js « legacy »). */
import { readFileSync } from "node:fs";
import { readPages, type PdfDoc } from "@/lib/pdftext";
import type { PageText } from "../layout";

export async function readPdfFile(path: string, data?: Uint8Array): Promise<{ pages: PageText[]; numPages: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = data ?? new Uint8Array(readFileSync(path));
  const task = pdfjs.getDocument({ data: bytes, verbosity: 0 });
  const doc = await task.promise;
  const pages = await readPages(doc as unknown as PdfDoc, { batch: 20 });
  const numPages = doc.numPages;
  await task.destroy();
  return { pages, numPages };
}
