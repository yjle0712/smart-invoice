import { describe, expect, it } from "vitest";
import { parseInvoiceList, parseInvoiceSheet } from "../excelInvoices";

describe("reprise des factures Excel", () => {
  it("lit un modèle de facture (étiquette à gauche, valeur à droite ou en dessous)", () => {
    const g: unknown[][] = [];
    g[4] = [null, null, null, "N° de facture", "FA0057/2026"];
    g[5] = [null, "STE EXEMPLE", null, "Date", new Date(2026, 8, 14)];
    g[6] = [null, null, null, "Mode de paiement", "Virement bancaire"];
    g[12] = [null, "Raison sociale", "MATA MATERIAUX"];
    g[13] = [null, "ICE", "002 861 686 000 022"];
    g[17] = [null, "Désignation", "Qté", "P.U. TTC", "Total TTC"];
    g[18] = [null, "Ciment", 10, 72.5, 725];
    g[33] = [null, "TOTAL HT", null, "TVA 20 %", null, "TOTAL TTC"];
    g[34] = [null, 604.17, null, 120.83, null, 725];
    const inv = parseInvoiceSheet(g, "f.xlsx")!;
    expect(inv).toMatchObject({ number: "FA0057/2026", date: "2026-09-14", clientName: "MATA MATERIAUX", clientIce: "002861686000022",
      ht: 60417, vat: 12083, ttc: 72500, rateBp: 2000, paymentMode: "virement", issues: [] });
  });
  it("signale ce qui manque sans l'inventer", () => {
    const inv = parseInvoiceSheet([["N° de facture", "X1"], ["Total TTC", "1 200,00"]], "f.xlsx")!;
    expect(inv.date).toBeNull();
    expect(inv.ht).toBeNull();
    expect(inv.issues).toEqual(expect.arrayContaining(["Date introuvable.", "Client introuvable."]));
  });
  it("lit une liste (une ligne par facture)", () => {
    const rows = parseInvoiceList([
      ["Liste des ventes"],
      ["N° facture", "Date", "Client", "ICE", "HT", "TVA", "TTC", "Taux", "Paiement"],
      ["NOV0098/2025A", "10/09/2025", "MATA", "002861686000022", 1000, 200, 1200, "20%", "Chèque"],
      ["NOV0099/2025A", 46096, "ATLAS", "123", "500,00", null, "600,00", 0.2, "LCN"],
    ], "l.xlsx")!;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ number: "NOV0098/2025A", date: "2025-09-10", ttc: 120000, rateBp: 2000, paymentMode: "cheque" });
    expect(rows[1]).toMatchObject({ vat: 10000, rateBp: 2000, paymentMode: "effet", clientIce: null });
    expect(rows[1].issues[0]).toMatch(/ICE/);
  });
  it("ne prend pas un tableau quelconque pour une liste", () => {
    expect(parseInvoiceList([["a", "b"], [1, 2]], "x")).toBeNull();
  });
});
