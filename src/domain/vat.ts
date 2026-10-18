import { roundHalfUp, type Cents, type RateBp } from "./money";

/**
 * Calculs HT / TVA / TTC pour des lignes dont le prix est exprimé TTC.
 *
 *   Total TTC ligne = quantité × prix unitaire TTC × (1 − remise)
 *   HT  = TTC / (1 + taux)
 *   TVA = TTC − HT
 *
 * Deux règles d'arrondi sont proposées (paramétrables par entreprise) :
 *  - "per_rate" (défaut) : on additionne les TTC par taux, puis on calcule HT et TVA
 *    une seule fois par taux. C'est la règle la plus stable : le TTC affiché est
 *    toujours exactement la somme des lignes.
 *  - "per_line" : HT et TVA sont arrondis ligne par ligne puis additionnés.
 * Dans les deux cas : HT + TVA = TTC, au centime près, pour chaque taux.
 */

export type RoundingMode = "per_rate" | "per_line";

export interface LineInput {
  quantity: number;
  unitPriceTtc: Cents;
  vatRateBp: RateBp;
  /** Remise en points de base (500 = 5 %). 0 par défaut. */
  discountBp?: number;
}

export interface LineResult extends LineInput {
  totalTtc: Cents;
  totalHt: Cents;
  totalVat: Cents;
}

export interface VatBreakdown {
  vatRateBp: RateBp;
  baseHt: Cents;
  vat: Cents;
  ttc: Cents;
}

export interface InvoiceTotals {
  lines: LineResult[];
  byRate: VatBreakdown[];
  totalHt: Cents;
  totalVat: Cents;
  totalTtc: Cents;
}

export function htFromTtc(ttc: Cents, rateBp: RateBp): Cents {
  if (rateBp <= 0) return ttc;
  return roundHalfUp((ttc * 10000) / (10000 + rateBp));
}

export function lineTtc(line: LineInput): Cents {
  if (!(line.quantity >= 0)) throw new Error("Quantité invalide");
  if (!(line.unitPriceTtc >= 0)) throw new Error("Prix unitaire invalide");
  const discount = line.discountBp ?? 0;
  if (discount < 0 || discount > 10000) throw new Error("Remise invalide");
  return roundHalfUp((line.quantity * line.unitPriceTtc * (10000 - discount)) / 10000);
}

export function computeInvoice(lines: LineInput[], mode: RoundingMode = "per_rate"): InvoiceTotals {
  const results: LineResult[] = lines.map((l) => {
    const totalTtc = lineTtc(l);
    const totalHt = htFromTtc(totalTtc, l.vatRateBp);
    return { ...l, totalTtc, totalHt, totalVat: totalTtc - totalHt };
  });

  const groups = new Map<RateBp, VatBreakdown>();
  for (const r of results) {
    const g = groups.get(r.vatRateBp) ?? { vatRateBp: r.vatRateBp, baseHt: 0, vat: 0, ttc: 0 };
    g.ttc += r.totalTtc;
    if (mode === "per_line") {
      g.baseHt += r.totalHt;
      g.vat += r.totalVat;
    }
    groups.set(r.vatRateBp, g);
  }
  if (mode === "per_rate") {
    for (const g of groups.values()) {
      g.baseHt = htFromTtc(g.ttc, g.vatRateBp);
      g.vat = g.ttc - g.baseHt;
    }
  }

  const byRate = [...groups.values()].sort((a, b) => b.vatRateBp - a.vatRateBp);
  const totalHt = byRate.reduce((s, g) => s + g.baseHt, 0);
  const totalVat = byRate.reduce((s, g) => s + g.vat, 0);
  const totalTtc = byRate.reduce((s, g) => s + g.ttc, 0);
  return { lines: results, byRate, totalHt, totalVat, totalTtc };
}

/** Taux de TVA marocains usuels (à vérifier et ajuster dans les paramètres de chaque entreprise). */
export const DEFAULT_VAT_RATES_BP: RateBp[] = [2000, 1400, 1000, 700, 0];
