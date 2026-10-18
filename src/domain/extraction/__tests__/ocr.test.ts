import { describe, expect, it } from "vitest";
import { createWorker, OEM } from "tesseract.js";
import { ocrToPage } from "@/lib/ocrlayout";
import { extractInvoices } from "../extract";

describe("OCR d'une page scannée (image, sans texte)", () => {
  it("lit les deux factures de la page", async () => {
    const w = await createWorker("fra", OEM.LSTM_ONLY, { langPath: "node_modules/@tesseract.js-data/fra/4.0.0_best_int", gzip: true, cacheMethod: "none" });
    try {
      const r = await w.recognize("src/domain/extraction/__fixtures__/scan-2-factures.png", {}, { blocks: true });
      const page = ocrToPage(1, r.data as never, 150 / 72);
      const inv = extractInvoices([page], { defaultKind: "purchase", company: { name: "ATLAS DISTRIBUTION SARL", ice: "001234567000089" }, today: "2026-10-16" });
      expect(inv.map((i) => [i.number.value, i.date.value, i.ht.value, i.vat.value, i.ttc.value, i.issuerIce.value])).toEqual([
        ["2026-00012", "2026-04-02", 123456, 12346, 135802, "000555444000033"],
        ["2026-00013", "2026-04-03", 50000, 5000, 55000, "000555444000033"],
      ]);
      // Une valeur issue de l'OCR n'est jamais considérée comme certaine
      expect(inv.every((i) => !i.confident && i.ocr)).toBe(true);
    } finally {
      await w.terminate();
    }
  }, 60_000);
});
