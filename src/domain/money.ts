/**
 * Montants monétaires.
 *
 * Tous les montants sont manipulés en CENTIMES (entiers) pour éviter les erreurs
 * d'arrondi des nombres à virgule flottante. Les taux de TVA sont exprimés en
 * POINTS DE BASE (2000 = 20 %, 1400 = 14 %, 0 = exonéré).
 */

export type Cents = number;
export type RateBp = number;

/** Arrondi au plus proche, demi vers le haut (les montants sont positifs ou nuls). */
export function roundHalfUp(x: number): number {
  // Neutralise les artefacts binaires (ex. 2998.4999999997) avant l'arrondi.
  const cleaned = Number(x.toFixed(6));
  return cleaned >= 0 ? Math.floor(cleaned + 0.5) : -Math.floor(-cleaned + 0.5);
}

/** Convertit une saisie "4 500,25" / "4500.25" / 4500.25 en centimes. Renvoie null si invalide. */
export function parseMoney(input: string | number | null | undefined): Cents | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? roundHalfUp(input * 100) : null;
  const normalized = normalizeNumberString(input);
  if (normalized === null) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? roundHalfUp(value * 100) : null;
}

/** Quantités : jusqu'à 3 décimales. */
export function parseQuantity(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const value = typeof input === "number" ? input : Number(normalizeNumberString(input) ?? NaN);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}

/**
 * Normalise les formats numériques français / marocains :
 * "1 234,56", "1.234,56", "1,234.56", "1234.56", "1 234,56 DH".
 */
export function normalizeNumberString(raw: string): string | null {
  let s = raw.replace(/[\s  ]/g, "").replace(/(dhs?|mad|dirhams?)$/i, "");
  if (!s) return null;
  const negative = s.startsWith("-");
  if (negative) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let decimalSep: "," | "." | null = null;
  if (lastComma >= 0 && lastDot >= 0) decimalSep = lastComma > lastDot ? "," : ".";
  else if (lastComma >= 0) decimalSep = /,\d{1,2}$/.test(s) || (s.match(/,/g) ?? []).length === 1 && !/,\d{3}$/.test(s) ? "," : null;
  else if (lastDot >= 0) decimalSep = /\.\d{1,2}$/.test(s) || (s.match(/\./g) ?? []).length === 1 && !/\.\d{3}$/.test(s) ? "." : null;
  let intPart = s;
  let decPart = "";
  if (decimalSep) {
    const idx = s.lastIndexOf(decimalSep);
    intPart = s.slice(0, idx);
    decPart = s.slice(idx + 1);
  }
  intPart = intPart.replace(/[.,]/g, "");
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(decPart)) return null;
  if (!intPart && !decPart) return null;
  return `${negative ? "-" : ""}${intPart || "0"}${decPart ? "." + decPart : ""}`;
}

/** Format d'affichage marocain : "4 500,00". Espace normale (compatible polices PDF). */
export function formatMoney(cents: Cents, opts: { currency?: string } = {}): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const intPart = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const decPart = (abs % 100).toString().padStart(2, "0");
  const text = `${negative ? "-" : ""}${intPart},${decPart}`;
  return opts.currency ? `${text} ${opts.currency}` : text;
}

export function formatRate(rateBp: RateBp): string {
  const pct = rateBp / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(".", ",")} %`;
}

export function formatQuantity(q: number): string {
  return Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, "").replace(".", ",");
}
