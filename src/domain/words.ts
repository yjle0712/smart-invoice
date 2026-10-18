import type { Cents } from "./money";

/**
 * Montant en toutes lettres, en français (orthographe traditionnelle) :
 *  - « et » dans 21, 31, 41, 51, 61, 71 (vingt et un, soixante et onze) ;
 *  - « quatre-vingts » prend un s seulement s'il termine le nombre ;
 *  - « cent » prend un s s'il est multiplié et termine le nombre ;
 *    il reste invariable devant « mille » (deux cent mille) mais
 *    s'accorde devant « millions » / « milliards », qui sont des noms ;
 *  - « mille » est invariable et jamais précédé de « un » ;
 *  - « un million de dirhams » quand le nombre se termine par million(s)/milliard(s).
 */

const UNITS = [
  "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf",
  "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf",
];
const TENS = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];

/** n ∈ [0, 99]. `final` : le nombre se termine ici (accord de « quatre-vingts »). */
function below100(n: number, final: boolean): string {
  if (n < 20) return UNITS[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  if (t === 7 || t === 9) {
    const base = t === 7 ? "soixante" : "quatre-vingt";
    const rest = 10 + u;
    if (t === 7 && u === 1) return "soixante et onze";
    return `${base}-${UNITS[rest]}`;
  }
  if (t === 8) return u === 0 ? (final ? "quatre-vingts" : "quatre-vingt") : `quatre-vingt-${UNITS[u]}`;
  if (u === 0) return TENS[t];
  if (u === 1) return `${TENS[t]} et un`;
  return `${TENS[t]}-${UNITS[u]}`;
}

/** n ∈ [0, 999]. `final` : rien ne suit (ou seulement un nom : million, milliard). */
function below1000(n: number, final: boolean): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h === 1) parts.push("cent");
  else if (h > 1) parts.push(`${UNITS[h]} ${r === 0 && final ? "cents" : "cent"}`);
  if (r > 0 || h === 0) parts.push(below100(r, final));
  return parts.join(" ");
}

/** Entier positif → lettres (minuscules). Gère jusqu'à 999 999 999 999 999. */
export function integerToFrench(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error("Entier positif attendu");
  if (n > 999_999_999_999_999) throw new Error("Montant trop grand");
  if (n === 0) return "zéro";

  const scales: { value: number; singular: string; plural: string; noun: boolean }[] = [
    { value: 1_000_000_000_000, singular: "billion", plural: "billions", noun: true },
    { value: 1_000_000_000, singular: "milliard", plural: "milliards", noun: true },
    { value: 1_000_000, singular: "million", plural: "millions", noun: true },
    { value: 1_000, singular: "mille", plural: "mille", noun: false },
  ];

  const parts: string[] = [];
  let rest = n;
  for (const s of scales) {
    const q = Math.floor(rest / s.value);
    rest %= s.value;
    if (q === 0) continue;
    if (!s.noun) {
      // « mille » : adjectif numéral → le multiplicateur reste invariable (deux cent mille).
      parts.push(q === 1 ? "mille" : `${below1000(q, false)} mille`);
    } else {
      // million/milliard : noms → « deux cents millions », « quatre-vingts millions ».
      parts.push(`${below1000(q, true)} ${q === 1 ? s.singular : s.plural}`);
    }
  }
  if (rest > 0) parts.push(below1000(rest, true));
  return parts.join(" ");
}

export interface WordsOptions {
  currencySingular?: string;
  currencyPlural?: string;
  subunitSingular?: string;
  subunitPlural?: string;
}

/** Ex. 450000 → « QUATRE MILLE CINQ CENTS DIRHAMS » ; 123456 → « ... DIRHAMS ET CINQUANTE-SIX CENTIMES ». */
export function amountToFrenchWords(cents: Cents, opts: WordsOptions = {}): string {
  const {
    currencySingular = "dirham",
    currencyPlural = "dirhams",
    subunitSingular = "centime",
    subunitPlural = "centimes",
  } = opts;
  if (!Number.isInteger(cents) || cents < 0) throw new Error("Montant en centimes invalide");
  const units = Math.floor(cents / 100);
  const sub = cents % 100;

  let text = "";
  if (units > 0 || sub === 0) {
    const words = integerToFrench(units);
    const endsWithNoun = /(millions?|milliards?|billions?)$/.test(words);
    const currency = units >= 2 ? currencyPlural : currencySingular;
    text = `${words} ${endsWithNoun ? "de " : ""}${currency}`;
  }
  if (sub > 0) {
    const subText = `${integerToFrench(sub)} ${sub >= 2 ? subunitPlural : subunitSingular}`;
    text = text ? `${text} et ${subText}` : subText;
  }
  return text.toUpperCase();
}

export const ARRETE_PREFIX = "ARRÊTÉE LA PRÉSENTE FACTURE À LA SOMME DE :";

export function arreteSentence(cents: Cents): string {
  return `${ARRETE_PREFIX} ${amountToFrenchWords(cents)}`;
}
