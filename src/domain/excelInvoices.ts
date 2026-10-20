import { parseMoney, type Cents } from "./money";
import { parseDateFlexible } from "./dates";

/**
 * Lecture des factures tenues sur Excel, pour les reprendre dans le journal avec leurs
 * numéros d'origine (passage d'Excel au site). Deux formes sont reconnues :
 *  - un fichier = une facture (modèle de facture : « N° de facture », « Date », « Total TTC »…) ;
 *  - une liste : une ligne par facture, avec une ligne d'en-têtes.
 * Rien n'est inventé : une information absente reste vide et est signalée.
 */

export type Grid = unknown[][];

export interface ExcelInvoice {
  number: string | null;
  date: string | null;
  clientName: string | null;
  clientIce: string | null;
  ht: Cents | null;
  vat: Cents | null;
  ttc: Cents | null;
  rateBp: number | null;
  paymentMode: string | null;
  source: string;
  issues: string[];
}

export const norm = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[°º:]/g, " ").replace(/[^a-z0-9%]+/g, " ").replace(/\s+/g, " ").trim();

const isEmpty = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

const LABELS = {
  number: ["n de facture", "n facture", "numero de facture", "numero facture", "facture n", "n de la facture"],
  date: ["date", "date de facture", "date facture", "date de la facture"],
  client: ["raison sociale", "nom", "client nom", "nom du client"],
  ice: ["ice", "ice client", "i c e"],
  payment: ["mode de paiement", "paiement", "mode de reglement", "reglement"],
  ht: ["total ht", "montant ht", "total hors taxes"],
  ttc: ["total ttc", "net a payer", "montant ttc", "total ttc dhs"],
};
const ALL_LABELS = new Set(Object.values(LABELS).flat());
const isLabel = (v: unknown) => {
  const n = norm(v);
  return ALL_LABELS.has(n) || /^tva( \d+( \d+)? %?)?$/.test(n) || /^total (ht|ttc|tva)/.test(n);
};

/** Valeur à droite d'une étiquette (jusqu'à 4 cellules), sinon juste en dessous. */
function valueNear(grid: Grid, r: number, c: number): unknown {
  const row = grid[r] ?? [];
  for (let k = c + 1; k <= c + 4 && k < row.length; k++) {
    const v = row[k];
    if (isEmpty(v)) continue;
    if (isLabel(v)) break; // une autre étiquette : on regarde plutôt en dessous
    return v;
  }
  for (let k = r + 1; k <= r + 2 && k < grid.length; k++) {
    const v = (grid[k] ?? [])[c];
    if (isEmpty(v)) continue;
    return isLabel(v) ? undefined : v;
  }
  return undefined;
}

function find(grid: Grid, match: (n: string) => boolean, last = false): { r: number; c: number; label: string }[] {
  const out: { r: number; c: number; label: string }[] = [];
  grid.forEach((row, r) => (row ?? []).forEach((v, c) => {
    if (typeof v !== "string") return;
    const n = norm(v);
    if (n && match(n)) out.push({ r, c, label: n });
  }));
  return last ? out.reverse() : out;
}

function firstValue(grid: Grid, labels: string[], opts: { last?: boolean; numeric?: boolean } = {}): unknown {
  for (const hit of find(grid, (n) => labels.includes(n), opts.last)) {
    const v = valueNear(grid, hit.r, hit.c);
    if (v === undefined) continue;
    if (opts.numeric && parseMoney(v as string | number) === null) continue;
    return v;
  }
  return undefined;
}

export function mapPaymentMode(v: unknown): string | null {
  const n = norm(v);
  if (!n) return null;
  if (n.includes("virement") || n.includes("versement")) return "virement";
  if (n.includes("cheque")) return "cheque";
  if (n.includes("espece") || n.includes("cash")) return "especes";
  if (n.includes("effet") || n.includes("lcn") || n.includes("traite")) return "effet";
  if (n.includes("carte") || n.includes("tpe")) return "carte";
  if (n.includes("prelevement")) return "prelevement";
  return "autre";
}

function finish(inv: ExcelInvoice): ExcelInvoice {
  // Compléter uniquement ce qui se déduit exactement des autres montants
  if (inv.ttc === null && inv.ht !== null && inv.vat !== null) inv.ttc = inv.ht + inv.vat;
  if (inv.vat === null && inv.ht !== null && inv.ttc !== null) inv.vat = inv.ttc - inv.ht;
  if (inv.ht === null && inv.vat !== null && inv.ttc !== null) inv.ht = inv.ttc - inv.vat;
  if (inv.rateBp === null && inv.ht && inv.vat !== null) {
    const r = Math.round((inv.vat / inv.ht) * 100) * 100;
    if ([0, 700, 1000, 1400, 2000].includes(r)) inv.rateBp = r;
  }
  if (inv.clientIce) {
    const digits = inv.clientIce.replace(/\D/g, "");
    if (digits.length === 15) inv.clientIce = digits;
    else { inv.issues.push(`ICE « ${inv.clientIce} » invalide (15 chiffres attendus).`); inv.clientIce = null; }
  }
  if (!inv.number) inv.issues.push("Numéro de facture introuvable.");
  if (!inv.date) inv.issues.push("Date introuvable.");
  if (!inv.clientName) inv.issues.push("Client introuvable.");
  if (inv.ttc === null) inv.issues.push("Total TTC introuvable.");
  if (inv.ht !== null && inv.vat !== null && inv.ttc !== null && inv.ht + inv.vat !== inv.ttc) inv.issues.push("HT + TVA ≠ TTC.");
  return inv;
}

const str = (v: unknown) => (isEmpty(v) ? null : v instanceof Date ? null : String(v).trim());
const money = (v: unknown) => (isEmpty(v) ? null : parseMoney(v as string | number));

/** Un fichier = une facture (modèle Excel). */
export function parseInvoiceSheet(grid: Grid, source: string): ExcelInvoice | null {
  const number = str(firstValue(grid, LABELS.number));
  const ttc = money(firstValue(grid, LABELS.ttc, { last: true, numeric: true }));
  if (!number && ttc === null) return null;
  let vat: Cents | null = null;
  let rateBp: number | null = null;
  const vatHits = find(grid, (n) => /^tva( \d+( \d+)?)?( %)?$/.test(n) || n === "total tva" || n === "montant tva", true);
  for (const h of vatHits) {
    const v = valueNear(grid, h.r, h.c);
    const m = money(v);
    if (m === null) continue;
    vat = m;
    const rm = /tva (\d+)(?: (\d+))?/.exec(h.label);
    if (rm) rateBp = Number(rm[1]) * 100 + (rm[2] ? Number(rm[2].padEnd(2, "0").slice(0, 2)) : 0);
    break;
  }
  const dateRaw = firstValue(grid, LABELS.date);
  return finish({
    number,
    date: parseDateFlexible(dateRaw),
    clientName: str(firstValue(grid, LABELS.client)),
    clientIce: str(firstValue(grid, LABELS.ice)),
    ht: money(firstValue(grid, LABELS.ht, { last: true, numeric: true })),
    vat, ttc, rateBp,
    paymentMode: mapPaymentMode(firstValue(grid, LABELS.payment)),
    source, issues: [],
  });
}

/** Une liste : une ligne par facture. Renvoie null si aucune ligne d'en-têtes n'est reconnue. */
export function parseInvoiceList(grid: Grid, source: string): ExcelInvoice[] | null {
  const pick = (headers: string[], tests: ((h: string) => boolean)[]) => {
    for (const t of tests) { const i = headers.findIndex(t); if (i >= 0) return i; }
    return -1;
  };
  for (let hr = 0; hr < Math.min(grid.length, 8); hr++) {
    const headers = (grid[hr] ?? []).map(norm);
    const iNum = pick(headers, [(h) => LABELS.number.includes(h), (h) => h === "numero" || h === "n" || h === "facture"]);
    const iTtc = pick(headers, [(h) => h.startsWith("total ttc") || h === "ttc" || h === "montant ttc" || h === "net a payer"]);
    if (iNum < 0 || iTtc < 0) continue;
    const iDate = pick(headers, [(h) => h.startsWith("date")]);
    const iClient = pick(headers, [(h) => h === "client" || h === "raison sociale" || h === "nom" || h.startsWith("client")]);
    const iIce = pick(headers, [(h) => h === "ice" || h.startsWith("ice")]);
    const iHt = pick(headers, [(h) => h === "ht" || h.startsWith("total ht") || h === "montant ht"]);
    const iVat = pick(headers, [(h) => h === "tva" || h === "montant tva" || h === "total tva"]);
    const iRate = pick(headers, [(h) => h.startsWith("taux")]);
    const iPay = pick(headers, [(h) => h.includes("paiement") || h.includes("reglement")]);
    const out: ExcelInvoice[] = [];
    for (let r = hr + 1; r < grid.length; r++) {
      const row = grid[r] ?? [];
      if (row.every(isEmpty)) continue;
      const cell = (i: number) => (i >= 0 ? row[i] : null);
      const rateRaw = cell(iRate);
      let rateBp: number | null = null;
      if (!isEmpty(rateRaw)) {
        const n = typeof rateRaw === "number" ? rateRaw : Number(String(rateRaw).replace("%", "").replace(",", ".").trim());
        if (Number.isFinite(n)) rateBp = Math.round((n <= 1 ? n * 100 : n) * 100);
      }
      out.push(finish({
        number: str(cell(iNum)), date: parseDateFlexible(cell(iDate)), clientName: str(cell(iClient)), clientIce: str(cell(iIce)),
        ht: money(cell(iHt)), vat: money(cell(iVat)), ttc: money(cell(iTtc)), rateBp,
        paymentMode: mapPaymentMode(cell(iPay)), source: `${source} (ligne ${r + 1})`, issues: [],
      }));
    }
    return out;
  }
  return null;
}
