import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { extractInvoices, findInvoiceNumber, isAnchor, moneyTokens, parseDateText, stripPageMarkers } from "../extract";
import { linesFromPlainText } from "../layout";
import { readPdfFile } from "./pdf-node";

const FIX = "src/domain/extraction/__fixtures__/lot-factures";
const OPTS = { defaultKind: "purchase" as const, company: { name: "ATLAS DISTRIBUTION SARL", ice: "001234567000089" }, today: "2026-10-16" };
interface Truth { pageFrom: number; pageTo: number; number: string | null; date: string | null; ht: number | null; vat: number | null; ttc: number | null; kind: string; partyIce: string | null; rates?: number[]; expectIssue?: string }

describe("utilitaires d'extraction", () => {
  it("montants : formats français, marocains et anglais", () => {
    expect(moneyTokens("Total HT : 1 234,56 DH")).toEqual([123456]);
    expect(moneyTokens("TOTAL TTC  |  1.358,02")).toEqual([135802]);
    expect(moneyTokens("Net à payer 12,000.50")).toEqual([1200050]);
    expect(moneyTokens("TVA 20 % : 750,00")).toEqual([75000]); // le taux n'est pas un montant
    expect(moneyTokens("ICE : 001234567000089 — 15/03/2026")).toEqual([]); // ni l'ICE ni la date
    expect(moneyTokens("Qté 3")).toEqual([]);
  });
  it("dates complètes, plusieurs formats", () => {
    expect(parseDateText("Date : 15/03/2026")).toBe("2026-03-15");
    expect(parseDateText("Casablanca, le 2 avril 2026")).toBe("2026-04-02");
    expect(parseDateText("du 1er février 2026")).toBe("2026-02-01");
    expect(parseDateText("2026-03-05")).toBe("2026-03-05");
    expect(parseDateText("31/02/2026")).toBeNull();
  });
  it("numéro de facture ≠ numéro de page, alphanumérique", () => {
    expect(findInvoiceNumber("Facture N° : NOV0100/2025A   Page 1/3")?.value).toBe("NOV0100/2025A");
    expect(findInvoiceNumber("FACTURE N° FA 2026-0012")?.value).toBe("FA2026-0012");
    expect(findInvoiceNumber("Facture   |  Page 2 / 5")).toBeNull();
    expect(findInvoiceNumber("N°", "INV-77/B")?.value).toBe("INV-77/B");
    expect(findInvoiceNumber("Facture N° : 2/3")).toBeNull();
    expect(stripPageMarkers("Page 4 sur 12")).not.toContain("4");
  });
  it("en-têtes : « facturé » et « présente facture » ne sont pas des en-têtes", () => {
    expect(isAnchor("FACTURE")).toBe(true);
    expect(isAnchor("Facture N° 12")).toBe(true);
    expect(isAnchor("ARRÊTÉE LA PRÉSENTE FACTURE À LA SOMME DE")).toBe(false);
    expect(isAnchor("Montant facturé")).toBe(false);
    expect(isAnchor("Date de facture : 12/03/2026")).toBe(false);
  });
  it("texte brut : plusieurs factures sur une page, aucune valeur inventée", () => {
    const page = linesFromPlainText(1, [
      "SOCIETE ALPHA SARL", "ICE : 000111000111000", "FACTURE N° A-1", "Date : 01/02/2026", "Total HT   100,00", "TVA 20%   20,00", "Total TTC   120,00",
      "SOCIETE ALPHA SARL", "ICE : 000111000111000", "FACTURE N° A-2", "Date : 02/02/2026", "Total HT   50,00", "Total TTC   60,00",
    ].join("\n"));
    const r = extractInvoices([{ page: 1, lines: page }], OPTS);
    expect(r.map((x) => x.number.value)).toEqual(["A-1", "A-2"]);
    expect(r[0].confident).toBe(true);
    expect(r[1].vat.value).toBeNull(); // absente du document → vide
    expect(r[1].suggestions.vat).toBe(1000); // seulement proposée
    expect(r[1].issues.join(" ")).toContain("TVA introuvable");
  });
});

describe("PDF multi-factures réel (15 pages, 12 factures, 7 mises en page)", async () => {
  const truth = JSON.parse(readFileSync(`${FIX}.truth.json`, "utf8")) as Truth[];
  const { pages } = await readPdfFile(`${FIX}.pdf`);
  const res = extractInvoices(pages, OPTS);

  it("trouve toutes les factures, pas seulement la première", () => {
    expect(res.length).toBe(truth.length);
  });
  truth.forEach((t, i) => {
    it(`facture ${i + 1} : ${t.number} (p. ${t.pageFrom}-${t.pageTo})`, () => {
      const r = res[i];
      expect([r.pageFrom, r.pageTo]).toEqual([t.pageFrom, t.pageTo]);
      expect(r.number.value).toBe(t.number);
      expect(r.date.value).toBe(t.date);
      expect(r.ht.value).toBe(t.ht);
      expect(r.vat.value).toBe(t.vat);
      expect(r.ttc.value).toBe(t.ttc);
      expect(r.kind).toBe(t.kind);
      expect((r.kind === "purchase" ? r.issuerIce : r.clientIce).value).toBe(t.partyIce);
      if (t.rates && t.rates.length > 1) expect(r.rates.map((x) => x.rateBp).sort()).toEqual([...t.rates].sort());
      if (t.expectIssue) {
        expect(r.issues.join(" ")).toContain(t.expectIssue);
        expect(r.confident).toBe(false);
      } else {
        expect(r.issues).toEqual([]);
        expect(r.confident).toBe(true);
      }
    });
  });
});

describe("gros fichier : plus de 500 pages", async () => {
  it("525 pages lues et découpées sans perte", async () => {
    const src = await PDFDocument.load(readFileSync(`${FIX}.pdf`));
    const big = await PDFDocument.create();
    for (let k = 0; k < 35; k++) (await big.copyPages(src, src.getPageIndices())).forEach((p) => big.addPage(p));
    const t0 = Date.now();
    const { pages, numPages } = await readPdfFile("", await big.save());
    const res = extractInvoices(pages, OPTS);
    const ms = Date.now() - t0;
    expect(numPages).toBe(525);
    expect(res.length).toBe(12 * 35);
    // Le lot est répété 35 fois : seules 11 factures distinctes, les copies sont signalées comme doublons
    expect(res.filter((r) => !r.issues.some((x) => x.startsWith("Doublon"))).length).toBe(11);
    expect(ms).toBeLessThan(90_000);
    console.log(`525 pages → ${res.length} factures en ${(ms / 1000).toFixed(1)} s`);
  }, 120_000);
});
