/**
 * OCR des pages scannées (navigateur). Fichiers servis par l'application (public/ocr),
 * sans dépendance à un CDN. Le moteur n'est chargé qu'à la première page scannée.
 */
import type { PageText } from "@/domain/extraction/layout";
import { ocrToPage, type OcrData } from "./ocrlayout";

type Worker = { recognize: (img: HTMLCanvasElement, o?: object, out?: object) => Promise<{ data: OcrData }>; terminate: () => Promise<unknown> };
let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM } = await import("tesseract.js");
      const base = `${window.location.origin}/ocr`;
      return (await createWorker("fra", OEM.LSTM_ONLY, {
        workerPath: `${base}/worker.min.js`,
        corePath: base,
        langPath: base,
        gzip: true,
        cacheMethod: "write",
      })) as unknown as Worker;
    })().catch((e) => {
      workerPromise = null;
      throw new Error(`OCR indisponible : ${(e as Error).message}`);
    });
  }
  return workerPromise;
}

export async function terminateOcr() {
  if (workerPromise) {
    const w = await workerPromise.catch(() => null);
    workerPromise = null;
    await w?.terminate();
  }
}

interface RenderablePage {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> };
  cleanup?: () => void;
}

/** Rend la page en image (≈ 200 dpi) puis la passe à l'OCR. */
export async function ocrPdfPage(doc: { getPage(n: number): Promise<unknown> }, pageNumber: number): Promise<PageText> {
  const page = (await doc.getPage(pageNumber)) as RenderablePage;
  const scale = 200 / 72;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponible.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  page.cleanup?.();
  const worker = await getWorker();
  const res = await worker.recognize(canvas, {}, { blocks: true });
  canvas.width = canvas.height = 0; // libère la mémoire
  return ocrToPage(pageNumber, res.data, scale);
}
