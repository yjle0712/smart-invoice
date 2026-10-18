/**
 * Extraction des factures contenues dans un PDF (texte page par page).
 *
 * Principes :
 *  - un document peut contenir des centaines de factures ; une facture peut tenir sur
 *    plusieurs pages, et une page peut contenir plusieurs factures ;
 *  - le numéro de facture est cherché près d'un libellé (« Facture N° », « N° »…),
 *    jamais « le premier nombre de la page » ; les numéros de page (« Page 2/3 ») sont écartés ;
 *  - aucune valeur n'est inventée : un champ introuvable reste vide (confiance « missing »),
 *    un montant calculable est seulement PROPOSÉ (suggestions), jamais rempli d'office ;
 *  - chaque champ porte un niveau de confiance et les contrôles (HT + TVA = TTC, taux…)
 *    sont listés pour la validation humaine.
 */
import type { Line, PageText } from "./layout";
import { normalizeNumberString } from "../money";
import { isValidYmd } from "../dates";

export type Confidence = "high" | "medium" | "low" | "missing";
export interface Field<T> {
  value: T | null;
  confidence: Confidence;
  /** Extrait du document qui justifie la valeur. */
  source?: string;
  page?: number;
}
export interface RateRow {
  rateBp: number;
  ht: number | null;
  vat: number | null;
  ttc: number | null;
}
export interface Check {
  label: string;
  ok: boolean;
  detail?: string;
}
export type EntryKind = "sale" | "purchase";

export interface ExtractedInvoice {
  /** Pages couvertes (1-based). */
  pageFrom: number;
  pageTo: number;
  number: Field<string>;
  date: Field<string>;
  issuerName: Field<string>;
  issuerIce: Field<string>;
  issuerIf: Field<string>;
  clientName: Field<string>;
  clientIce: Field<string>;
  clientIf: Field<string>;
  goodsNature: Field<string>;
  ht: Field<number>;
  vat: Field<number>;
  ttc: Field<number>;
  /** Taux unique (si un seul taux) */
  vatRateBp: Field<number>;
  rates: RateRow[];
  kind: EntryKind;
  kindReason: string;
  checks: Check[];
  issues: string[];
  /** Montants calculables proposés à l'utilisateur (jamais appliqués automatiquement). */
  suggestions: { ht?: number; vat?: number; ttc?: number; vatRateBp?: number };
  ocr: boolean;
  /** Vrai si tous les champs essentiels sont fiables et les contrôles passent. */
  confident: boolean;
  /** Clé de détection des doublons. */
  dedupKey: string | null;
}

export interface KnownParty {
  id: string;
  name: string;
  ice: string | null;
  if_number?: string | null;
  kind: "client" | "supplier";
}

export interface ExtractOptions {
  /** Type par défaut choisi à l'import (achats ou ventes). */
  defaultKind: EntryKind;
  company: { name: string; ice: string | null };
  knownParties?: KnownParty[];
  /** Taux autorisés (points de base) pour reconnaître un taux implicite. */
  vatRatesBp?: number[];
  today?: string;
}

// ---------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const low = (s: string) => strip(s).toLowerCase();
const LEGAL = /\b(s\.?\s?a\.?\s?r\.?\s?l\.?(\s?a\.?\s?u\.?)?|sarlau|s\.?\s?a\.?|s\.?\s?n\.?\s?c\.?|ets|ste|societe|groupe|distribution|trading|company|industries?|import|export|holding)\b/i;
const MONTHS: Record<string, number> = {
  janvier: 1, janv: 1, fevrier: 2, fevr: 2, fev: 2, mars: 3, avril: 4, avr: 4, mai: 5, juin: 6, juillet: 7, juil: 7,
  aout: 8, septembre: 9, sept: 9, octobre: 10, oct: 10, novembre: 11, nov: 11, decembre: 12, dec: 12,
};

/** Retire les marqueurs de pagination (« Page 2/3 », « 2 / 3 », « p. 4 ») d'un texte. */
export function stripPageMarkers(s: string): string {
  return s
    .replace(/\bpage\s*:?\s*\d{1,4}\s*(?:\/|sur|de|of)\s*\d{1,4}\b/gi, " ")
    .replace(/\bpage\s*:?\s*\d{1,4}\b/gi, " ")
    .replace(/\bp\.\s*\d{1,4}\b/gi, " ")
    .replace(/(^|\s)\d{1,3}\s*\/\s*\d{1,3}(\s*$)/g, " ");
}

export function pageMarker(text: string): { k: number; n: number } | null {
  const m = /\bpage\s*:?\s*(\d{1,4})\s*(?:\/|sur|de|of)\s*(\d{1,4})\b/i.exec(text);
  return m ? { k: Number(m[1]), n: Number(m[2]) } : null;
}

const DATE_NUM = /\b(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{4}|\d{2})\b/;
const DATE_ISO = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/;
const DATE_TXT = /\b(\d{1,2})(?:er)?\s+([a-zéèêûô.]{3,10})\s+(\d{4})\b/i;

export function parseDateText(s: string): string | null {
  const pad = (n: number) => String(n).padStart(2, "0");
  let m = DATE_ISO.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (isValidYmd(y, mo, d)) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  m = DATE_NUM.exec(s);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (m[3].length === 2) y += 2000;
    if (isValidYmd(y, mo, d)) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  m = DATE_TXT.exec(strip(s));
  if (m) {
    const mo = MONTHS[low(m[2]).replace(/\.$/, "")];
    const d = Number(m[1]);
    const y = Number(m[3]);
    if (mo && isValidYmd(y, mo, d)) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  return null;
}

/** Montants présents dans un texte, en centimes, dans l'ordre. Les pourcentages, dates et ICE sont ignorés. */
export function moneyTokens(text: string): number[] {
  const cleaned = text
    .replace(/\d+(?:[.,]\d+)?\s*%/g, " ")
    .replace(DATE_NUM, " ")
    .replace(DATE_ISO, " ")
    .replace(/\b\d{12,}\b/g, " ");
  const re = /(?<![\d,.])-?\d{1,3}(?:,\d{3})+\.\d{1,2}(?![\d])|(?<![\d,.])-?\d{1,3}(?:[ .\u00a0\u202f]\d{3})+(?:,\d{1,2})?(?![\d])|(?<![\d,.])-?\d+(?:[.,]\d{1,2})?(?![\d,.])/g;
  const out: number[] = [];
  for (const m of cleaned.matchAll(re)) {
    const raw = m[0];
    // Les entiers courts sans décimales (quantités, codes) ne sont pas des montants de totaux,
    // sauf s'ils ont un séparateur de milliers.
    const hasDecimals = /[.,]\d{1,2}$/.test(raw);
    const hasThousands = /\d[ .,\u00a0\u202f]\d{3}/.test(raw);
    if (!hasDecimals && !hasThousands && raw.replace("-", "").length < 3) continue;
    const n = normalizeNumberString(raw);
    if (n === null) continue;
    const v = Math.round(Number(n) * 100);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

export function rateIn(text: string): number | null {
  const m = /(\d{1,2}(?:[.,]\d{1,2})?)\s*%/.exec(text);
  if (!m) return null;
  const v = Math.round(Number(m[1].replace(",", ".")) * 100);
  return v >= 0 && v <= 10000 ? v : null;
}

const iceDigits = (s: string) => s.replace(/\D/g, "");

// ---------------------------------------------------------------------
// Repérage des en-têtes de facture et des numéros
// ---------------------------------------------------------------------
const NOT_ANCHOR = /pr[ée]sente facture|arr[êe]t[ée]e|adresse de facturation|date de (la )?facture|mode de facturation|conditions? de facturation|facturation\s*:|total facture|montant (de la )?facture/i;

/** Ligne qui ressemble à un en-tête de facture (« FACTURE », « Facture N° … »). « facturé(e) » n'en est pas un. */
export function isAnchor(text: string): boolean {
  const lc = text.toLowerCase();
  if (!/(^|[^a-zà-ÿ])(facture|invoice)(?![a-zà-ÿ])/.test(lc)) return false;
  if (NOT_ANCHOR.test(lc)) return /\bfacture\s*(n[°ºo]|num|#)/i.test(lc);
  return true;
}

const NUM_TOKEN = "([A-Z]{1,8}\\s?)?([A-Z0-9][A-Z0-9\\-/._]{0,30})";
const SEP = "[\\s|:\\-]*";
/** Numéros qui ne sont pas des numéros de facture (bon de livraison, commande, client…). */
const OTHER_REF = /(livraison|commande|client|devis|bon|b\.?l\.?|compte|dossier|police|contrat|cheque|ice|r\.?c|i\.?f|patente|cnss|t\.?p|tel|fax)\s*(n[°ºo]|num|#)?\.?\s*[:|\-]?\s*$/i;

function cleanNumber(raw: string): string | null {
  let s = raw.trim().replace(/[.,;:]+$/, "").replace(/^[#:\-]+/, "");
  s = s.replace(/\s+/g, "");
  if (!/\d/.test(s)) return null;
  if (s.length < 2 || s.length > 32) return null;
  if (/^\d{1,4}\/\d{1,4}$/.test(s)) return null; // pagination 2/3
  if (DATE_NUM.test(s) && /^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(s)) return null; // date
  if (/^\d{15}$/.test(s)) return null; // ICE
  if (/^0[5-7]\d{8}$/.test(s)) return null; // téléphone
  return s.toUpperCase();
}

/** Cherche un numéro de facture dans une ligne (et éventuellement la suivante). */
export function findInvoiceNumber(line: string, next?: string): { value: string; confidence: Confidence } | null {
  const t = stripPageMarkers(strip(line));
  const patterns: [RegExp, Confidence][] = [
    [new RegExp(`(?:facture|invoice|fact\\.)\\s*(?:n[°ºo]\\.?|num(?:ero)?\\.?|no\\.?|#)${SEP}${NUM_TOKEN}`, "i"), "high"],
    [new RegExp(`n[°ºo]\\.?\\s*(?:de\\s*)?(?:la\\s*)?(?:facture|piece)${SEP}${NUM_TOKEN}`, "i"), "high"],
    [new RegExp(`(?:facture|invoice)\\s*[:\\-]\\s*${NUM_TOKEN}`, "i"), "high"],
    [new RegExp(`(?:^|\\s|\\|)n[°º]\\.?${SEP}${NUM_TOKEN}`, "i"), "medium"],
    [new RegExp(`num[eé]ro${SEP}${NUM_TOKEN}`, "i"), "medium"],
    [new RegExp(`(?:^|\\|)\\s*(?:facture|invoice)\\s+${NUM_TOKEN}`, "i"), "medium"],
  ];
  for (const [re, conf] of patterns) {
    const m = re.exec(t);
    if (!m) continue;
    if (conf === "medium" && OTHER_REF.test(t.slice(0, m.index + (m[0].match(/^\s|\|/) ? 1 : 0)))) continue;
    const joined = cleanNumber(`${m[1] ?? ""}${m[2]}`);
    const alone = cleanNumber(m[2]);
    const v = joined && /\d/.test(m[2]) && m[1] ? joined : alone;
    if (v && !/^(DU|LE|DATE)$/i.test(v)) return { value: v, confidence: conf };
  }
  // « N° » seul en fin de ligne, valeur sur la ligne suivante
  if (next && /(?:facture|invoice)?\s*n[°ºo]\.?\s*[:\-]?\s*$/i.test(t)) {
    const v = cleanNumber(stripPageMarkers(next).split(/\s{2,}|\|/)[0] ?? "");
    if (v) return { value: v, confidence: "medium" };
  }
  return null;
}

// ---------------------------------------------------------------------
// Segmentation du document en factures
// ---------------------------------------------------------------------
interface Segment {
  lines: Line[];
  number: string | null;
  hasTotal: boolean;
  /** Position (dans `lines`) de la dernière ligne de total TTC. */
  lastTotalIdx: number;
  pages: Set<number>;
}

const TTC_LABEL = /(total|montant|net)\s*(general\s*)?(a\s*payer\s*)?t\.?\s?t\.?\s?c\.?\b|net\s*a\s*payer|total\s*a\s*payer|montant\s*a\s*payer|total\s*general/;
const HT_LABEL = /(total|montant|net|base)\s*(net\s*)?h\.?\s?t\.?\b|hors\s*tax(e|es)\b|total\s*h\.?t/;
const TVA_LABEL = /\bt\.?\s?v\.?\s?a\.?\b/;
const SKIP_TOTAL = /report|a reporter|sous[-\s]?total|deja regle|acompte|remise|escompte|identifiant|intracom|n[°º]\s*tva|ttc\s*\/\s*ht|prix\s*(unit|total)/;

/** Ligne de total TTC avec un montant (sur la ligne, ou sur la ligne suivante si le libellé est seul). */
function lineHasTtcTotal(l: Line, next?: Line): boolean {
  const t = low(l.text);
  if (!TTC_LABEL.test(t) || SKIP_TOTAL.test(t)) return false;
  if (moneyTokens(l.text).length > 0) return true;
  return Boolean(next && next.page === l.page && l.cells.length === 1 && moneyTokens(next.text).length > 0);
}

export function segmentInvoices(pages: PageText[]): Segment[] {
  const segments: Segment[] = [];
  let cur: Segment | null = null;
  const start = (number: string | null, page: number) => {
    const prev: Segment | null = cur;
    const seg: Segment = { lines: [], number, hasTotal: false, lastTotalIdx: -1, pages: new Set() };
    // Les lignes de la même page situées après le total de la facture précédente
    // (logo, raison sociale, ICE de l'émetteur…) appartiennent à la nouvelle facture.
    if (prev) {
      const cut = prev.lines.findIndex((l, i) => l.page === page && i > prev.lastTotalIdx);
      if (cut >= 0) {
        seg.lines = prev.lines.splice(cut);
        const stillOnPage = prev.lines.some((l) => l.page === page);
        if (!stillOnPage) prev.pages.delete(page);
        if (prev.lastTotalIdx >= prev.lines.length) prev.lastTotalIdx = -1;
        prev.hasTotal = prev.lastTotalIdx >= 0;
      }
    }
    seg.pages.add(page);
    cur = seg;
    segments.push(seg);
    return seg;
  };

  for (const p of pages) {
    const marker = p.lines.map((l) => pageMarker(l.text)).find(Boolean) ?? null;
    // Une page « 1/N » ouvre une nouvelle facture si la précédente est terminée.
    if (marker && marker.k === 1 && cur && (cur as Segment).hasTotal) start(null, p.page);

    for (let i = 0; i < p.lines.length; i++) {
      const l = p.lines[i];
      const anchor = isAnchor(l.text);
      if (anchor || /^\s*n[°º]\s*[:\-]?\s*\S/i.test(strip(l.cells[0]?.text ?? ""))) {
        const found = findInvoiceNumber(l.text, p.lines[i + 1]?.text) ??
          (anchor ? findInvoiceNumber(p.lines[i + 1]?.text ?? "", p.lines[i + 2]?.text) : null);
        const n = found?.value ?? null;
        const c = cur as Segment | null;
        if (!c) start(n, p.page);
        else if (n && c.number && n !== c.number) start(n, p.page);
        else if (n && !c.number) {
          if (c.hasTotal) start(n, p.page);
          else c.number = n;
        } else if (!n && anchor && c.hasTotal) start(null, p.page);
      }
      if (!cur) start(null, p.page);
      const s = cur as unknown as Segment;
      s.lines.push(l);
      s.pages.add(p.page);
      if (lineHasTtcTotal(l, p.lines[i + 1])) { s.hasTotal = true; s.lastTotalIdx = s.lines.length - 1; }
    }
    if (p.lines.length === 0) {
      // Page vide (scan illisible) : rattachée à la facture en cours, signalée plus loin.
      if (!cur) start(null, p.page);
      (cur as unknown as Segment).pages.add(p.page);
    }
  }
  // Une page sans aucun texte (scan illisible) ne crée pas de facture : elle est signalée par l'import.
  return segments.filter((s) => s.lines.length > 0);
}

// ---------------------------------------------------------------------
// Extraction des champs d'une facture
// ---------------------------------------------------------------------
const CLIENT_LABEL = /^(client|doit|factur[ée]e?\s*a|destinataire|acheteur|customer|bill\s*to|adresse\s*client|nom\s*du\s*client|raison\s*sociale\s*client)\b/i;
const LABELISH = /^(ice|i\.?f|rc|r\.?c|tp|cnss|patente|tel|t[ée]l[ée]phone|fax|email|e-mail|adresse|date|n[°º]|facture|code|ville|page)\b/i;

function cellAfter(line: Line, cellIdx: number, labelRe: RegExp): string | null {
  const c = line.cells[cellIdx];
  if (!c) return null;
  const after = c.text.replace(labelRe, "").replace(/^\s*[:\-]\s*/, "").trim();
  if (after) return after;
  return line.cells[cellIdx + 1]?.text.trim() || null;
}

function findIds(lines: Line[], clientRange: Set<string>) {
  const issuerIce: Field<string>[] = [];
  const clientIce: Field<string>[] = [];
  const issuerIf: Field<string>[] = [];
  const clientIf: Field<string>[] = [];
  for (const l of lines) {
    const key = `${l.page}:${l.index}`;
    const inClient = clientRange.has(key);
    const t = strip(l.text);
    for (const m of t.matchAll(/\bI\.?\s?C\.?\s?E\.?\s*(?:n[°º]\s*)?[:\-]?\s*((?:\d[\s.]?){15})/gi)) {
      const d = iceDigits(m[1]);
      if (d.length === 15) (inClient ? clientIce : issuerIce).push({ value: d, confidence: "high", source: m[0].trim(), page: l.page });
    }
    for (const m of t.matchAll(/(?:\bI\.?\s?F\.?|identifiant\s*fiscal)\s*(?:n[°º]\s*)?[:\-]?\s*(\d{6,10})\b/gi)) {
      (inClient ? clientIf : issuerIf).push({ value: m[1], confidence: "high", source: m[0].trim(), page: l.page });
    }
  }
  return { issuerIce, clientIce, issuerIf, clientIf };
}

const first = <T,>(arr: Field<T>[]): Field<T> => arr[0] ?? { value: null, confidence: "missing" };

function extractSegment(seg: Segment, opts: ExtractOptions, ocrPages: Set<number>): ExtractedInvoice {
  const lines = seg.lines;
  const pagesArr = [...seg.pages].sort((a, b) => a - b);
  const issues: string[] = [];
  const firstPage = pagesArr[0];
  const firstPageLines = lines.filter((l) => l.page === firstPage);

  // ----- Numéro -----
  let number: Field<string> = { value: null, confidence: "missing" };
  for (let i = 0; i < lines.length && !number.value; i++) {
    const l = lines[i];
    if (!isAnchor(l.text) && !/n[°º]/i.test(l.text)) continue;
    const f = findInvoiceNumber(l.text, lines[i + 1]?.text) ?? (isAnchor(l.text) ? findInvoiceNumber(lines[i + 1]?.text ?? "", lines[i + 2]?.text) : null);
    if (f) number = { value: f.value, confidence: f.confidence, source: l.text.slice(0, 120), page: l.page };
  }
  if (seg.number && number.value !== seg.number) number = { value: seg.number, confidence: "high", page: firstPage };

  // ----- Date -----
  let date: Field<string> = { value: null, confidence: "missing" };
  for (let li = 0; li < lines.length; li++) {
    const l = lines[li];
    const t = low(l.text);
    if (!/\bdate\b|\ble\s+\d|\bdu\s+\d/.test(t)) continue;
    // Libellé seul (« Date de facture ») et date sur la ligne suivante
    if (l.cells.length === 1 && /^date(\s*(de\s*(la\s*)?)?facture)?\s*:?\s*$/.test(t) && lines[li + 1]?.page === l.page) {
      const d = parseDateText(lines[li + 1].text);
      if (d) { date = { value: d, confidence: /facture/.test(t) ? "high" : "medium", source: `${l.text} ${lines[li + 1].text}`.slice(0, 120), page: l.page }; break; }
    }
    if (/echeance|livraison|commande|paiement|reglement|validite|expiration|naissance|impression/.test(t) && !/date\s*(de\s*(la\s*)?)?facture/.test(t)) continue;
    const d = parseDateText(l.text);
    if (d) { date = { value: d, confidence: /date\s*(de\s*(la\s*)?)?facture|facture.*\bdu\b/.test(t) ? "high" : "medium", source: l.text.slice(0, 120), page: l.page }; break; }
  }
  if (!date.value) {
    for (const l of firstPageLines.slice(0, 25)) {
      if (/echeance|livraison|commande|paiement/.test(low(l.text))) continue;
      const d = parseDateText(l.text);
      if (d) { date = { value: d, confidence: "low", source: l.text.slice(0, 120), page: l.page }; break; }
    }
  }

  // ----- Bloc client -----
  const clientRange = new Set<string>();
  let clientName: Field<string> = { value: null, confidence: "missing" };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const ci = l.cells.findIndex((c) => CLIENT_LABEL.test(strip(c.text).trim()));
    if (ci < 0) continue;
    const labelCell = l.cells[ci];
    for (let k = i; k < Math.min(lines.length, i + 7); k++) clientRange.add(`${lines[k].page}:${lines[k].index}`);
    const labelText = strip(labelCell.text).trim();
    const rest = labelText.replace(CLIENT_LABEL, "").replace(/^\s*[:\-]\s*/, "").trim();
    const inline = rest ? labelCell.text.trim().slice(labelCell.text.trim().length - rest.length)
      : /[:\-]\s*$|^doit/i.test(labelText) ? l.cells[ci + 1]?.text.trim() ?? null : null;
    const candidates: string[] = [];
    if (inline && !LABELISH.test(strip(inline))) candidates.push(inline);
    for (let k = i + 1; k < Math.min(lines.length, i + 5); k++) {
      const cell = lines[k].cells.reduce((best, c) => (Math.abs(c.x - labelCell.x) < Math.abs(best.x - labelCell.x) ? c : best), lines[k].cells[0]);
      if (cell && Math.abs(cell.x - labelCell.x) < 60) candidates.push(cell.text);
    }
    const nm = candidates.find((c) => /[a-z]{2,}/i.test(c) && !LABELISH.test(strip(c).trim()) && !parseDateText(c));
    if (nm) {
      // « ATLAS SARL — ICE 0011… » : on garde le nom seul
      const name = nm.replace(/^\s*[:\-]\s*/, "").split(/\s+[—–-]\s+|\s{2,}|\s+I\.?C\.?E\b/i)[0].trim();
      clientName = { value: name, confidence: "medium", source: l.text.slice(0, 120), page: l.page };
    }
    break;
  }

  // ----- Identifiants -----
  const ids = findIds(lines, clientRange);
  const issuerIceAll = ids.issuerIce.filter((f) => f.value !== first(ids.clientIce).value);
  let issuerIce = first(issuerIceAll);
  let clientIce = first(ids.clientIce);
  const issuerIf = first(ids.issuerIf);
  const clientIf = first(ids.clientIf);
  if (new Set(issuerIceAll.map((f) => f.value)).size > 1) {
    issuerIce = { ...issuerIce, confidence: "low" };
    issues.push("Plusieurs ICE trouvés pour l'émetteur : vérifiez.");
  }

  // ----- Émetteur (fournisseur pour un achat) -----
  let issuerName: Field<string> = { value: null, confidence: "missing" };
  const anchorIdx = firstPageLines.findIndex((l) => isAnchor(l.text));
  const head = firstPageLines.slice(0, Math.max(6, anchorIdx >= 0 ? anchorIdx + 2 : 6));
  const headCells = head.flatMap((l) => l.cells.map((c) => ({ c, l })));
  const isName = (s: string) => /[a-z]{3,}/i.test(s) && !isAnchor(s) && !LABELISH.test(strip(s).trim()) && !parseDateText(s) && !CLIENT_LABEL.test(strip(s)) && s.length <= 80;
  const legalHead = headCells.find(({ c, l }) => LEGAL.test(strip(c.text)) && isName(c.text) && !clientRange.has(`${l.page}:${l.index}`));
  const anyHead = headCells.find(({ c, l }) => isName(c.text) && !clientRange.has(`${l.page}:${l.index}`) && !/\d{3,}/.test(c.text));
  // Pied de page : « SOCIÉTÉ X SARL — adresse — ICE … »
  const footer = lines.filter((l) => l.page === firstPage).slice(-4).map((l) => l.text).find((t) => LEGAL.test(strip(t)) && /ice|r\.?c|i\.?f/i.test(t));
  if (legalHead) issuerName = { value: legalHead.c.text, confidence: "medium", source: legalHead.c.text, page: legalHead.l.page };
  else if (footer) issuerName = { value: footer.split(/\s+[—–-]\s+|\s*\|\s*|,/)[0].trim(), confidence: "medium", source: footer.slice(0, 120), page: firstPage };
  else if (anyHead) issuerName = { value: anyHead.c.text, confidence: "low", source: anyHead.c.text, page: anyHead.l.page };

  // Correspondance avec les tiers connus (par ICE d'abord : fiable)
  const known = opts.knownParties ?? [];
  const byIce = (ice: string | null) => (ice ? known.find((k) => k.ice === ice) : undefined);
  const ki = byIce(issuerIce.value);
  if (ki) issuerName = { value: ki.name, confidence: "high", source: `ICE ${ki.ice} (tiers connu)`, page: issuerIce.page };
  const kc = byIce(clientIce.value);
  if (kc) clientName = { value: kc.name, confidence: "high", source: `ICE ${kc.ice} (tiers connu)`, page: clientIce.page };
  if (issuerName.value && issuerIce.value && issuerName.confidence === "medium") issuerName.confidence = "high";

  // ----- Nature de la marchandise -----
  let goodsNature: Field<string> = { value: null, confidence: "missing" };
  for (const l of lines) {
    const ci = l.cells.findIndex((c) => /^(nature(\s*(de\s*la\s*|des\s*)?(marchandises?|prestations?|operations?))?|objet|designation\s*generale)\b/i.test(strip(c.text)));
    if (ci < 0) continue;
    const v = cellAfter(l, ci, /^(nature(\s*(de\s*la\s*|des\s*)?(marchandises?|prestations?|op[ée]rations?))?|objet|d[ée]signation\s*g[ée]n[ée]rale)\s*/i);
    if (v && /[a-z]{3,}/i.test(v)) { goodsNature = { value: v, confidence: "high", source: l.text.slice(0, 120), page: l.page }; break; }
  }
  if (!goodsNature.value) {
    const hi = lines.findIndex((l) => /\b(designation|description|libelle|article|produit)s?\b/i.test(strip(l.text)) && l.cells.length >= 2);
    if (hi >= 0) {
      const items: string[] = [];
      for (let k = hi + 1; k < lines.length && items.length < 3; k++) {
        const t = lines[k].cells[0]?.text ?? "";
        if (TTC_LABEL.test(low(t)) || HT_LABEL.test(low(t)) || isAnchor(t)) break;
        if (/[a-z]{3,}/i.test(t) && lines[k].cells.length >= 2 && !/^tva\b/i.test(t)) items.push(t);
      }
      if (items.length) goodsNature = { value: items.join(", ").slice(0, 120), confidence: "low", source: "Désignations du tableau", page: lines[hi].page };
    }
  }

  // ----- Montants -----
  const totalAt = (re: RegExp): Field<number> => {
    let found: Field<number> = { value: null, confidence: "missing" };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const t = low(l.text);
      if (!re.test(t) || SKIP_TOTAL.test(t)) continue;
      if (re === HT_LABEL && TTC_LABEL.test(t) && !/\bht\b.*\bttc\b/.test(t)) continue;
      let toks = moneyTokens(l.text);
      if (toks.length === 0 && l.cells.length === 1 && lines[i + 1] && lines[i + 1].page === l.page) toks = moneyTokens(lines[i + 1].text).slice(-1);
      if (toks.length === 0) continue;
      found = { value: toks[toks.length - 1], confidence: "high", source: l.text.slice(0, 120), page: l.page }; // la dernière occurrence (totaux en fin)
    }
    return found;
  };
  const ttc = totalAt(TTC_LABEL);
  const ht = totalAt(HT_LABEL);

  // TVA : lignes de taux, tableau de ventilation, ou total TVA
  const rates: RateRow[] = [];
  let vatTotal: Field<number> = { value: null, confidence: "missing" };
  const tvaLines: { rate: number | null; amount: number; line: Line }[] = [];
  let inBreakdown = false;
  for (const l of lines) {
    const t = low(l.text);
    if (/\btaux\b/.test(t) && /\bbase\b|\bht\b/.test(t) && TVA_LABEL.test(t)) { inBreakdown = true; continue; }
    if (inBreakdown) {
      const r = rateIn(l.text) ?? (/exon[ée]r/i.test(l.text) ? 0 : null);
      const toks = moneyTokens(l.text);
      if (r !== null && toks.length >= 3) { rates.push({ rateBp: r, ht: toks[toks.length - 3], vat: toks[toks.length - 2], ttc: toks[toks.length - 1] }); continue; }
      if (r !== null && toks.length === 2 && !TVA_LABEL.test(t)) { rates.push({ rateBp: r, ht: toks[0], vat: toks[1], ttc: toks[0] + toks[1] }); continue; }
      if (r === null || TTC_LABEL.test(t)) inBreakdown = false;
    }
    if (!TVA_LABEL.test(t) || SKIP_TOTAL.test(t) || TTC_LABEL.test(t) || HT_LABEL.test(t)) continue;
    let toks = moneyTokens(l.text);
    const li = lines.indexOf(l);
    if (toks.length === 0 && l.cells.length === 1 && lines[li + 1]?.page === l.page && !TVA_LABEL.test(low(lines[li + 1].text))) toks = moneyTokens(lines[li + 1].text).slice(-1);
    if (toks.length === 0) continue;
    if (/total\s*t\.?v\.?a|montant\s*(total\s*)?t\.?v\.?a/.test(t) && rateIn(l.text) === null) {
      vatTotal = { value: toks[toks.length - 1], confidence: "high", source: l.text.slice(0, 120), page: l.page };
    } else {
      tvaLines.push({ rate: rateIn(l.text), amount: toks[toks.length - 1], line: l });
    }
  }
  // Une même ligne de TVA peut être répétée (totaux de chaque page) : on garde la dernière par taux.
  const lastByRate = new Map<string, { rate: number | null; amount: number; line: Line }>();
  for (const tl of tvaLines) lastByRate.set(String(tl.rate), tl);
  const tvaRows = [...lastByRate.values()];
  if (!vatTotal.value && tvaRows.length) {
    const sum = tvaRows.reduce((s, r) => s + r.amount, 0);
    vatTotal = { value: sum, confidence: tvaRows.length === 1 ? "high" : "medium", source: tvaRows.map((r) => r.line.text.slice(0, 60)).join(" / "), page: tvaRows[0].line.page };
  }
  if (rates.length === 0 && tvaRows.length > 1) {
    for (const r of tvaRows) if (r.rate !== null) rates.push({ rateBp: r.rate, ht: null, vat: r.amount, ttc: null });
  }
  if (!vatTotal.value && rates.length) {
    vatTotal = { value: rates.reduce((s, r) => s + (r.vat ?? 0), 0), confidence: "medium", source: "Tableau de ventilation" };
  }

  // Taux
  let vatRateBp: Field<number> = { value: null, confidence: "missing" };
  const explicitRates = [...new Set([...tvaRows.map((r) => r.rate).filter((r): r is number => r !== null), ...rates.map((r) => r.rateBp)])];
  if (explicitRates.filter((r) => r > 0).length === 1 && rates.filter((r) => r.rateBp > 0).length <= 1) {
    vatRateBp = { value: explicitRates.find((r) => r > 0)!, confidence: "high" };
  } else if (explicitRates.length === 0 && ht.value && vatTotal.value) {
    const implied = Math.round((vatTotal.value / ht.value) * 10000);
    const known = (opts.vatRatesBp ?? [2000, 1400, 1000, 700]).find((r) => r > 0 && Math.abs(r - implied) <= 15);
    if (known) vatRateBp = { value: known, confidence: "medium", source: "Taux déduit de TVA ÷ HT" };
  } else if (explicitRates.filter((r) => r > 0).length > 1) {
    vatRateBp = { value: null, confidence: "medium", source: "Plusieurs taux" };
  }
  if (rates.length === 0 && vatRateBp.value !== null && ht.value !== null && vatTotal.value !== null) {
    rates.push({ rateBp: vatRateBp.value, ht: ht.value, vat: vatTotal.value, ttc: ttc.value });
  }

  // ----- Contrôles -----
  const checks: Check[] = [];
  const suggestions: ExtractedInvoice["suggestions"] = {};
  const tol = (a: number) => Math.max(2, Math.round(Math.abs(a) * 0.0005));
  if (ht.value !== null && vatTotal.value !== null && ttc.value !== null) {
    const ok = Math.abs(ht.value + vatTotal.value - ttc.value) <= tol(ttc.value);
    checks.push({ label: "HT + TVA = TTC", ok, detail: ok ? undefined : `écart de ${((ht.value + vatTotal.value - ttc.value) / 100).toFixed(2)}` });
    if (!ok) { ht.confidence = "low"; vatTotal.confidence = "low"; ttc.confidence = "low"; issues.push("Les totaux HT, TVA et TTC ne concordent pas."); }
  } else {
    if (ht.value === null && vatTotal.value !== null && ttc.value !== null) suggestions.ht = ttc.value - vatTotal.value;
    if (vatTotal.value === null && ht.value !== null && ttc.value !== null) suggestions.vat = ttc.value - ht.value;
    if (ttc.value === null && ht.value !== null && vatTotal.value !== null) suggestions.ttc = ht.value + vatTotal.value;
  }
  for (const r of rates) {
    if (r.ht !== null && r.vat !== null && r.rateBp > 0) {
      const expected = Math.round((r.ht * r.rateBp) / 10000);
      const ok = Math.abs(expected - r.vat) <= Math.max(2, tol(r.vat) * 4);
      checks.push({ label: `TVA ${r.rateBp / 100} % = base × taux`, ok, detail: ok ? undefined : `attendu ${(expected / 100).toFixed(2)}` });
      if (!ok) issues.push(`TVA à ${r.rateBp / 100} % incohérente avec la base.`);
    }
  }
  if (rates.length > 1) {
    const sumTtc = rates.reduce((s, r) => s + (r.ttc ?? (r.ht ?? 0) + (r.vat ?? 0)), 0);
    if (ttc.value !== null && rates.every((r) => r.ht !== null)) {
      const ok = Math.abs(sumTtc - ttc.value) <= tol(ttc.value) * 2;
      checks.push({ label: "Somme des taux = TTC", ok });
      if (!ok) issues.push("La ventilation par taux ne correspond pas au TTC.");
    }
  }
  if (date.value) {
    const today = opts.today ?? new Date().toISOString().slice(0, 10);
    if (date.value > today) { issues.push("Date de facture dans le futur."); date.confidence = "low"; }
    if (date.value < "2000-01-01") { issues.push("Date de facture ancienne : vérifiez."); date.confidence = "low"; }
  }

  // ----- Sens : vente ou achat -----
  let kind: EntryKind = opts.defaultKind;
  let kindReason = "Type choisi à l'import";
  const cIce = opts.company.ice;
  if (cIce && issuerIce.value === cIce) { kind = "sale"; kindReason = "L'émetteur est votre entreprise (ICE)"; }
  else if (cIce && clientIce.value === cIce) { kind = "purchase"; kindReason = "Le client est votre entreprise (ICE)"; }
  else if (issuerName.value && low(issuerName.value).includes(low(opts.company.name).slice(0, 12))) { kind = "sale"; kindReason = "L'émetteur porte le nom de votre entreprise"; }

  // ----- Manques -----
  if (!number.value) issues.push("Numéro de facture introuvable.");
  if (!date.value) issues.push("Date de facture introuvable.");
  if (ttc.value === null) issues.push("Total TTC introuvable.");
  if (ht.value === null) issues.push("Total HT introuvable.");
  if (vatTotal.value === null) issues.push("Montant de TVA introuvable.");
  const partyIce = kind === "purchase" ? issuerIce : clientIce;
  if (!partyIce.value) issues.push(kind === "purchase" ? "ICE du fournisseur introuvable." : "ICE du client introuvable.");
  if (lines.length === 0) issues.push("Page sans texte lisible.");
  const ocr = pagesArr.some((p) => ocrPages.has(p));
  if (ocr) issues.push("Texte obtenu par OCR : vérifiez chaque valeur.");

  const essentials = [number, date, ttc, ht, vatTotal, partyIce, kind === "purchase" ? issuerName : clientName];
  const confident = !ocr && essentials.every((f) => f.confidence === "high" || f.confidence === "medium") && checks.every((c) => c.ok) && issues.length === 0;

  const partyKey = (kind === "purchase" ? issuerIce.value ?? issuerName.value : clientIce.value ?? clientName.value) ?? "";
  const dedupKey = number.value ? `${kind}|${low(partyKey).replace(/\W+/g, "")}|${number.value.replace(/\W+/g, "")}` : null;

  return {
    pageFrom: pagesArr[0], pageTo: pagesArr[pagesArr.length - 1], number, date, issuerName, issuerIce, issuerIf, clientName,
    clientIce, clientIf, goodsNature, ht, vat: vatTotal, ttc, vatRateBp, rates, kind, kindReason, checks, issues, suggestions, ocr,
    confident, dedupKey,
  };
}

/** Point d'entrée : pages → factures extraites (+ doublons internes signalés). */
export function extractInvoices(pages: PageText[], opts: ExtractOptions): ExtractedInvoice[] {
  const ocrPages = new Set(pages.filter((p) => p.ocr).map((p) => p.page));
  const segs = segmentInvoices(pages);
  const out = segs.map((s) => extractSegment(s, opts, ocrPages));
  const seen = new Map<string, number>();
  out.forEach((inv) => {
    if (!inv.dedupKey) return;
    const prev = seen.get(inv.dedupKey);
    if (prev !== undefined) {
      inv.issues.push(`Doublon dans le fichier : même facture qu'aux pages ${out[prev].pageFrom}–${out[prev].pageTo}.`);
      inv.confident = false;
    } else seen.set(inv.dedupKey, out.indexOf(inv));
  });
  return out;
}
