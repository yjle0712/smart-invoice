// Version « legacy » : inclut les compléments nécessaires aux navigateurs moins récents
// (la version standard exige des fonctions JavaScript très récentes).
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Rend la première page d'un PDF (papier à en-tête) en image PNG haute définition. */
export async function pdfFirstPageToPng(file: File, scale = 2.5): Promise<Blob> {
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponible.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Conversion impossible."))), "image/png"),
    );
  } finally {
    await task.destroy();
  }
}

export { pdfjs };

/** Convertit chaque page d'un PDF en image JPEG (≈ 200 dpi). */
export async function pdfToJpegs(data: ArrayBuffer, dpi = 200, quality = 0.92): Promise<Blob[]> {
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
  const doc = await task.promise;
  const out: Blob[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas indisponible.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b && b.size > 1000 ? resolve(b) : reject(new Error("Image vide."))), "image/jpeg", quality),
      );
      out.push(blob);
      canvas.width = canvas.height = 0;
    }
  } finally {
    await task.destroy();
  }
  return out;
}
