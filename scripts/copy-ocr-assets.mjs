// Copie les fichiers de l'OCR (Tesseract) dans public/ocr : l'application ne dépend d'aucun CDN.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
const out = "public/ocr";
mkdirSync(out, { recursive: true });
const files = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract-core-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["node_modules/@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz", "fra.traineddata.gz"],
];
let ok = 0;
for (const [from, to] of files) {
  if (!existsSync(from)) { console.warn(`[ocr] fichier manquant : ${from}`); continue; }
  copyFileSync(from, `${out}/${to}`);
  ok++;
}
console.log(`[ocr] ${ok}/${files.length} fichiers copiés dans ${out}`);
