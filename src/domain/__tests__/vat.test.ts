import { describe, expect, it } from "vitest";
import { computeInvoice, htFromTtc, lineTtc } from "../vat";
import { formatMoney, normalizeNumberString, parseMoney, parseQuantity } from "../money";

describe("calculs TTC → HT / TVA", () => {
  it("ligne simple à 20 %", () => {
    const t = computeInvoice([{ quantity: 3, unitPriceTtc: 150000, vatRateBp: 2000 }]);
    expect(t.totalTtc).toBe(450000);
    expect(t.totalHt).toBe(375000);
    expect(t.totalVat).toBe(75000);
  });

  it("HT + TVA = TTC, toujours, pour chaque taux et chaque mode", () => {
    const lines = [
      { quantity: 7, unitPriceTtc: 1999, vatRateBp: 2000 },
      { quantity: 3, unitPriceTtc: 1333, vatRateBp: 2000 },
      { quantity: 11, unitPriceTtc: 777, vatRateBp: 1400 },
      { quantity: 1.5, unitPriceTtc: 999, vatRateBp: 1000 },
      { quantity: 2, unitPriceTtc: 4321, vatRateBp: 700 },
      { quantity: 4, unitPriceTtc: 1250, vatRateBp: 0 },
    ];
    for (const mode of ["per_rate", "per_line"] as const) {
      const t = computeInvoice(lines, mode);
      for (const g of t.byRate) expect(g.baseHt + g.vat).toBe(g.ttc);
      expect(t.totalHt + t.totalVat).toBe(t.totalTtc);
      expect(t.totalTtc).toBe(t.lines.reduce((s, l) => s + l.totalTtc, 0));
    }
  });

  it("plusieurs taux : ventilation correcte et 20 % n'est pas appliqué partout", () => {
    const t = computeInvoice([
      { quantity: 1, unitPriceTtc: 12000, vatRateBp: 2000 },
      { quantity: 1, unitPriceTtc: 11400, vatRateBp: 1400 },
      { quantity: 1, unitPriceTtc: 5000, vatRateBp: 0 },
    ]);
    expect(t.byRate.map((g) => [g.vatRateBp, g.baseHt, g.vat])).toEqual([
      [2000, 10000, 2000],
      [1400, 10000, 1400],
      [0, 5000, 0],
    ]);
  });

  it("quantité décimale et arrondi au centime (demi vers le haut)", () => {
    expect(lineTtc({ quantity: 1.5, unitPriceTtc: 1999, vatRateBp: 2000 })).toBe(2999);
    expect(lineTtc({ quantity: 0.333, unitPriceTtc: 1000, vatRateBp: 2000 })).toBe(333);
  });

  it("remise", () => {
    expect(lineTtc({ quantity: 2, unitPriceTtc: 10000, vatRateBp: 2000, discountBp: 1000 })).toBe(18000);
    expect(() => lineTtc({ quantity: 1, unitPriceTtc: 100, vatRateBp: 2000, discountBp: 12000 })).toThrow();
  });

  it("htFromTtc", () => {
    expect(htFromTtc(12000, 2000)).toBe(10000);
    expect(htFromTtc(100, 2000)).toBe(83);
    expect(htFromTtc(5000, 0)).toBe(5000);
  });

  it("refuse les quantités négatives", () => {
    expect(() => computeInvoice([{ quantity: -1, unitPriceTtc: 100, vatRateBp: 2000 }])).toThrow();
  });
});

describe("formats numériques", () => {
  it("parse les formats français / marocains", () => {
    expect(parseMoney("4 500,25")).toBe(450025);
    expect(parseMoney("4.500,25")).toBe(450025);
    expect(parseMoney("4,500.25")).toBe(450025);
    expect(parseMoney("4500.25")).toBe(450025);
    expect(parseMoney("4 500,25 DH")).toBe(450025);
    expect(parseMoney("1 234 567,8")).toBe(123456780);
    expect(parseMoney("12,5")).toBe(1250);
    expect(parseMoney(19.99)).toBe(1999);
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });
  it("normalizeNumberString", () => {
    expect(normalizeNumberString("1.234.567")).toBe("1234567");
    expect(normalizeNumberString("1,234")).toBe("1234");
  });
  it("formatMoney", () => {
    expect(formatMoney(450000)).toBe("4 500,00");
    expect(formatMoney(123456789, { currency: "DH" })).toBe("1 234 567,89 DH");
    expect(formatMoney(5)).toBe("0,05");
  });
  it("parseQuantity", () => {
    expect(parseQuantity("2,5")).toBe(2.5);
    expect(parseQuantity("x")).toBeNull();
  });
});
