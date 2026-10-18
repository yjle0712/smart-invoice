import { describe, expect, it } from "vitest";
import { formatInvoiceNumber, validateNumberFormat } from "../numbering";
import { buildDraftsFromOrders, type CatalogItem, type ClientItem, type OrderRow } from "../batch";
import { formatDateFr, parseDateFlexible } from "../dates";

describe("numérotation", () => {
  it("formate les jetons", () => {
    expect(formatInvoiceNumber("FA{SEQ:4}/{YYYY}", 7, "2026-03-15")).toBe("FA0007/2026");
    expect(formatInvoiceNumber("{YY}{MM}-{SEQ:5}", 123, "2026-03-15")).toBe("2603-00123");
    expect(formatInvoiceNumber("F{SEQ}", 12345, "2026-01-01")).toBe("F12345");
  });
  it("valide le format", () => {
    expect(validateNumberFormat("FA{SEQ:4}/{YYYY}")).toBeNull();
    expect(validateNumberFormat("FA/{YYYY}")).not.toBeNull();
    expect(validateNumberFormat("{SEQ}{SEQ}")).not.toBeNull();
    expect(validateNumberFormat("FA{SEQ}{XX}")).not.toBeNull();
    expect(validateNumberFormat("FA {SEQ}")).not.toBeNull();
  });
});

describe("dates", () => {
  it("parse plusieurs formats sans inventer", () => {
    expect(parseDateFlexible("15/03/2026")).toBe("2026-03-15");
    expect(parseDateFlexible("2026-03-15")).toBe("2026-03-15");
    expect(parseDateFlexible("15.03.26")).toBe("2026-03-15");
    expect(parseDateFlexible(46096)).toBe("2026-03-15");
    expect(parseDateFlexible("31/02/2026")).toBeNull();
    expect(parseDateFlexible("")).toBeNull();
    expect(parseDateFlexible("demain")).toBeNull();
    expect(formatDateFr("2026-03-15")).toBe("15/03/2026");
  });
});

describe("lots de factures depuis des commandes réelles", () => {
  const catalog: CatalogItem[] = [
    { id: "p1", reference: "HUILE-5L", designation: "Huile 5 L", unitPriceTtc: 9500, vatRateBp: 1000, active: true },
    { id: "p2", reference: "SUCRE-1KG", designation: "Sucre 1 kg", unitPriceTtc: 1200, vatRateBp: 0, active: true },
    { id: "p3", reference: "OLD", designation: "Ancien", unitPriceTtc: 100, vatRateBp: 2000, active: false },
  ];
  const clients: ClientItem[] = [
    { id: "c1", name: "Épicerie Atlas", ice: "001234567000089", archived: false },
    { id: "c2", name: "Sans ICE", ice: null, archived: false },
  ];
  const row = (n: number, o: Partial<OrderRow>): OrderRow => ({
    rowNumber: n, orderRef: "CMD-1", date: "15/03/2026", client: "001234567000089", productRef: "HUILE-5L", quantity: 2, ...o,
  });

  it("regroupe les lignes d'une commande et prend le prix du catalogue", () => {
    const r = buildDraftsFromOrders(
      [row(2, {}), row(3, { productRef: "sucre-1kg", quantity: "10" }), row(4, { orderRef: "CMD-2", date: "2026-03-10", client: "Épicerie Atlas" })],
      catalog, clients, new Set(),
    );
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(r.drafts.map((d) => d.orderRef)).toEqual(["CMD-2", "CMD-1"]); // triées par date
    const cmd1 = r.drafts.find((d) => d.orderRef === "CMD-1")!;
    expect(cmd1.lines).toHaveLength(2);
    expect(cmd1.totals.totalTtc).toBe(2 * 9500 + 10 * 1200);
  });

  it("rejette un prix différent du catalogue sans modifier le catalogue", () => {
    const r = buildDraftsFromOrders([row(2, { unitPriceTtc: "99,00" })], catalog, clients, new Set());
    expect(r.drafts).toHaveLength(0);
    expect(r.rejectedOrders).toEqual(["CMD-1"]);
    expect(catalog[0].unitPriceTtc).toBe(9500);
  });

  it("accepte un prix identique au catalogue", () => {
    const r = buildDraftsFromOrders([row(2, { unitPriceTtc: "95,00" })], catalog, clients, new Set());
    expect(r.drafts).toHaveLength(1);
  });

  it("détecte les doublons, données manquantes et incohérences", () => {
    const r = buildDraftsFromOrders(
      [
        row(2, { orderRef: "DEJA" }),
        row(3, { orderRef: "" }),
        row(4, { orderRef: "X", date: "" }),
        row(5, { orderRef: "Y", productRef: "INCONNU" }),
        row(6, { orderRef: "Z", productRef: "OLD" }),
        row(7, { orderRef: "W", quantity: 0 }),
        row(8, { orderRef: "V", date: "01/03/2026" }),
        row(9, { orderRef: "V", date: "02/03/2026" }),
      ],
      catalog, clients, new Set(["deja"]),
    );
    expect(r.drafts).toHaveLength(0);
    expect(r.issues.filter((i) => i.level === "error")).toHaveLength(7);
  });

  it("exige l'ICE si la règle de l'entreprise l'impose", () => {
    const r = buildDraftsFromOrders([row(2, { client: "Sans ICE" })], catalog, clients, new Set(), { requireClientIce: true });
    expect(r.drafts).toHaveLength(0);
    const r2 = buildDraftsFromOrders([row(2, { client: "Sans ICE" })], catalog, clients, new Set());
    expect(r2.drafts).toHaveLength(1);
  });

  it("additionne un produit répété avec un avertissement", () => {
    const r = buildDraftsFromOrders([row(2, {}), row(3, { quantity: 3 })], catalog, clients, new Set());
    expect(r.drafts[0].lines[0].quantity).toBe(5);
    expect(r.issues.some((i) => i.level === "warning")).toBe(true);
  });
});

import { deriveSeriesFromNumber } from "../numbering";
describe("reprise d'une numérotation existante", () => {
  it.each([
    ["NOV0100/2025A", "NOV{SEQ:4}/{YYYY}A", 101, 2025],
    ["FA2026-0042", "FA{YYYY}-{SEQ:4}", 43, 2026],
    ["F-2026/0458", "F-{YYYY}/{SEQ:4}", 459, 2026],
    ["2026-00012", "{YYYY}-{SEQ:5}", 13, 2026],
    ["INV-77/B", "INV-{SEQ:2}/B", 78, null],
    ["123", "{SEQ:3}", 124, null],
  ] as const)("%s", (n, format, next, year) => {
    const d = deriveSeriesFromNumber(n)!;
    expect(d.format).toBe(format);
    expect(d.nextSeq).toBe(next);
    expect(d.year).toBe(year);
    // le numéro suivant garde la même forme
    expect(formatInvoiceNumber(d.format, d.nextSeq, `${year ?? 2026}-05-01`).length).toBe(n.length);
  });
  it("année sur 2 chiffres avec indice", () => {
    expect(deriveSeriesFromNumber("FC26/0012", 2026)?.format).toBe("FC{YY}/{SEQ:4}");
  });
  it("refuse ce qui n'est pas un numéro", () => {
    expect(deriveSeriesFromNumber("FACTURE")).toBeNull();
    expect(deriveSeriesFromNumber("A{B}1")).toBeNull();
  });
});

describe("bon de livraison dans les lots", () => {
  it("reprend les n° de BL distincts de la commande", () => {
    const catalog = [{ id: "p1", reference: "A", designation: "Article A", unitPriceTtc: 1000, vatRateBp: 2000, active: true }];
    const clients = [{ id: "c1", name: "Client", ice: "000111222000033", archived: false }];
    const r = buildDraftsFromOrders([
      { rowNumber: 2, orderRef: "C1", date: "01/03/2026", client: "000111222000033", productRef: "A", quantity: 1, deliveryNote: "BL-10" },
      { rowNumber: 3, orderRef: "C1", date: "01/03/2026", client: "000111222000033", productRef: "A", quantity: 2, deliveryNote: "BL-11" },
      { rowNumber: 4, orderRef: "C2", date: "02/03/2026", client: "000111222000033", productRef: "A", quantity: 1 },
    ], catalog, clients, new Set());
    expect(r.drafts.map((d) => d.deliveryNote)).toEqual(["BL-10, BL-11", null]);
  });
});
