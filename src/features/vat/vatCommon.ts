import type { JournalRow, PaymentMode, VatDeclaration, VatEntry } from "@/lib/types";
import { buildWorkbook, dh, DATE_FMT, MONEY_FMT, xlDate } from "@/lib/excel";
import { formatRate } from "@/domain/money";

export const KIND_LABEL = { sale: "Vente", purchase: "Achat" } as const;
export const ENTRY_STATUS_LABEL = { to_review: "À contrôler", validated: "Validée", rejected: "Rejetée" } as const;

export const PAYMENT_MODES: Record<PaymentMode, string> = {
  especes: "Espèces", cheque: "Chèque", prelevement: "Prélèvement", virement: "Virement", effet: "Effet",
  compensation: "Compensation", carte: "Carte", autre: "Autre",
};
/** Codes « mode de paiement » du relevé des déductions SIMPL-TVA (à vérifier avec le modèle DGI en vigueur). */
export const SIMPL_PAYMENT_CODE: Record<string, number> = {
  especes: 1, cheque: 2, prelevement: 3, virement: 4, effet: 5, compensation: 6, carte: 7, autre: 7,
};

export const CONFIDENCE_STYLE: Record<string, string> = {
  high: "",
  medium: "bg-saffron-50",
  low: "bg-saffron-100 ring-1 ring-saffron-400",
  missing: "bg-danger/10 ring-1 ring-danger/40",
};
export const CONFIDENCE_LABEL: Record<string, string> = {
  high: "Fiable", medium: "Probable", low: "Incertain", missing: "Introuvable dans le document",
};

/** Bornes d'une période (mois ou trimestre) contenant la date donnée. */
export function periodBounds(kind: "mensuel" | "trimestriel", year: number, index: number): [string, string] {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (kind === "mensuel") {
    const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
    return [`${year}-${pad(index)}-01`, `${year}-${pad(index)}-${pad(last)}`];
  }
  const m1 = (index - 1) * 3 + 1;
  const m3 = m1 + 2;
  const last = new Date(Date.UTC(year, m3, 0)).getUTCDate();
  return [`${year}-${pad(m1)}-01`, `${year}-${pad(m3)}-${pad(last)}`];
}

export const MONTH_NAMES = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export function rateText(r: { vat_rate_bp: number | null; rates?: { rate_bp: number }[] }): string {
  if (r.rates && r.rates.length > 1) return r.rates.map((x) => formatRate(x.rate_bp)).join(" + ");
  return r.vat_rate_bp === null ? "—" : formatRate(r.vat_rate_bp);
}

const journalColumns = (kind: "sale" | "purchase") => [
  { header: "N° facture", value: (r: JournalRow) => r.invoice_number, width: 18 },
  { header: "Date", value: (r: JournalRow) => xlDate(r.invoice_date), format: DATE_FMT, width: 12 },
  { header: kind === "sale" ? "Client" : "Fournisseur", value: (r: JournalRow) => r.party_name, width: 32 },
  { header: "ICE", value: (r: JournalRow) => r.party_ice, width: 18 },
  { header: "IF", value: (r: JournalRow) => r.party_if, width: 12 },
  { header: "Nature marchandise", value: (r: JournalRow) => r.goods_nature, width: 26 },
  { header: "HT", value: (r: JournalRow) => dh(r.total_ht), format: MONEY_FMT, width: 14 },
  { header: "Taux TVA", value: (r: JournalRow) => rateText(r), width: 12 },
  { header: "TVA", value: (r: JournalRow) => dh(r.total_vat), format: MONEY_FMT, width: 14 },
  { header: "TTC", value: (r: JournalRow) => dh(r.total_ttc), format: MONEY_FMT, width: 14 },
  { header: "Mode", value: (r: JournalRow) => (r.payment_mode ? PAYMENT_MODES[r.payment_mode as PaymentMode] ?? r.payment_mode : null), width: 12 },
  { header: "Date paiement", value: (r: JournalRow) => xlDate(r.payment_date), format: DATE_FMT, width: 13 },
  ...(kind === "purchase" ? [
    { header: "Nature déduction", value: (r: JournalRow) => (r.deduction_type === "immobilisations" ? "Immobilisations" : "Charges"), width: 16 },
    { header: "Déductible", value: (r: JournalRow) => (r.deductible ? "Oui" : "Non"), width: 10 },
    { header: "Rubrique", value: (r: JournalRow) => r.rubrique, width: 10 },
  ] : []),
  { header: "Origine", value: (r: JournalRow) => (r.source === "invoice" ? "Smart Invoice" : r.source_file ? `${r.source_file} p.${r.page_from}${r.page_to !== r.page_from ? `-${r.page_to}` : ""}` : "Saisie"), width: 28 },
];

function totalsRow(rows: JournalRow[], kind: "sale" | "purchase") {
  const sum = (f: (r: JournalRow) => number | null) => rows.reduce((s, r) => s + (f(r) ?? 0), 0) / 100;
  const cols = journalColumns(kind);
  const out: (string | number | null)[] = cols.map(() => null);
  out[0] = `TOTAL (${rows.length})`;
  out[cols.findIndex((c) => c.header === "HT")] = sum((r) => r.total_ht);
  out[cols.findIndex((c) => c.header === "TVA")] = sum((r) => r.total_vat);
  out[cols.findIndex((c) => c.header === "TTC")] = sum((r) => r.total_ttc);
  return out;
}

/**
 * Classeur XLSX : Journal des ventes, Journal des achats, Synthèse TVA,
 * relevé des déductions (format proche de SIMPL-TVA) et, si demandé,
 * une feuille séparée « À contrôler » (jamais mélangée aux écritures validées).
 */
export function buildVatWorkbook(opts: {
  companyName: string; from: string; to: string; sales: JournalRow[]; purchases: JournalRow[]; declaration: VatDeclaration | null; toReview?: VatEntry[];
}): Blob {
  const { sales, purchases, declaration } = opts;
  const synth: { label: string; ht: number | null; vat: number | null }[] = [];
  if (declaration) {
    synth.push({ label: `Période du ${opts.from} au ${opts.to} — régime ${declaration.regime === "encaissement" ? "de l'encaissement" : "des débits"}`, ht: null, vat: null });
    for (const s of declaration.sales) synth.push({ label: `Ventes ${s.rate_bp === 0 ? "exonérées / 0 %" : formatRate(s.rate_bp)}`, ht: s.ht, vat: s.vat });
    synth.push({ label: "TOTAL TVA COLLECTÉE", ht: declaration.sales_ht, vat: declaration.vat_collected });
    for (const p of declaration.purchases) synth.push({ label: `Achats ${p.deduction_type === "immobilisations" ? "immobilisations" : "charges"} ${p.rate_bp < 0 ? "(taux non précisé)" : formatRate(p.rate_bp)}`, ht: p.ht, vat: p.vat });
    synth.push({ label: "TOTAL TVA DÉDUCTIBLE", ht: declaration.purchases_ht, vat: declaration.vat_deductible });
    synth.push({ label: "TVA non déductible (pour information)", ht: null, vat: declaration.vat_non_deductible });
    synth.push({ label: declaration.net_vat >= 0 ? "TVA NETTE À PAYER (indicative)" : "CRÉDIT DE TVA (indicatif)", ht: null, vat: Math.abs(declaration.net_vat) });
    if (declaration.to_review > 0) synth.push({ label: `ATTENTION : ${declaration.to_review} écriture(s) encore à contrôler, non comprises`, ht: null, vat: null });
    if (declaration.unpaid_entries > 0) synth.push({ label: `ATTENTION : ${declaration.unpaid_entries} écriture(s) validée(s) sans date de paiement (régime de l'encaissement), non comprises`, ht: null, vat: null });
    synth.push({ label: "Préparation indicative, à vérifier avant toute déclaration officielle.", ht: null, vat: null });
  }

  const deductions = purchases.filter((r) => r.deductible);
  const sheets = [
    { name: "Journal des ventes", rows: sales, columns: journalColumns("sale"), footer: totalsRow(sales, "sale") },
    { name: "Journal des achats", rows: purchases, columns: journalColumns("purchase"), footer: totalsRow(purchases, "purchase") },
    {
      name: "Synthèse TVA", rows: synth,
      columns: [
        { header: "Rubrique", value: (r: (typeof synth)[number]) => r.label, width: 70 },
        { header: "Base HT", value: (r: (typeof synth)[number]) => dh(r.ht), format: MONEY_FMT, width: 16 },
        { header: "TVA", value: (r: (typeof synth)[number]) => dh(r.vat), format: MONEY_FMT, width: 16 },
      ],
    },
    {
      name: "Relevé déductions",
      rows: deductions,
      columns: [
        { header: "ord", value: (r: JournalRow) => deductions.indexOf(r) + 1, width: 6 },
        { header: "num_fact", value: (r: JournalRow) => r.invoice_number, width: 16 },
        { header: "des", value: (r: JournalRow) => r.goods_nature, width: 26 },
        { header: "mht", value: (r: JournalRow) => dh(r.total_ht), format: MONEY_FMT, width: 13 },
        { header: "tva", value: (r: JournalRow) => dh(r.total_vat), format: MONEY_FMT, width: 13 },
        { header: "ttc", value: (r: JournalRow) => dh(r.total_ttc), format: MONEY_FMT, width: 13 },
        { header: "if", value: (r: JournalRow) => r.party_if, width: 12 },
        { header: "nom", value: (r: JournalRow) => r.party_name, width: 30 },
        { header: "ice", value: (r: JournalRow) => r.party_ice, width: 18 },
        { header: "tx", value: (r: JournalRow) => (r.vat_rate_bp !== null ? r.vat_rate_bp / 100 : rateText(r)), width: 8 },
        { header: "mp", value: (r: JournalRow) => (r.payment_mode ? SIMPL_PAYMENT_CODE[r.payment_mode] ?? null : null), width: 5 },
        { header: "dpai", value: (r: JournalRow) => xlDate(r.payment_date), format: DATE_FMT, width: 12 },
        { header: "dfac", value: (r: JournalRow) => xlDate(r.invoice_date), format: DATE_FMT, width: 12 },
        { header: "rubrique", value: (r: JournalRow) => r.rubrique, width: 10 },
      ],
    },
  ];
  if (opts.toReview && opts.toReview.length) {
    sheets.push({
      name: "À contrôler (non validé)",
      rows: opts.toReview as unknown as JournalRow[],
      columns: [
        { header: "STATUT", value: () => "À CONTRÔLER — NON VALIDÉ", width: 26 },
        ...journalColumns("purchase").slice(0, 10),
        { header: "Sens", value: (r: JournalRow) => KIND_LABEL[r.kind], width: 8 },
        { header: "Anomalies", value: (r: JournalRow) => ((r as unknown as VatEntry).issues ?? []).join(" ; "), width: 60 },
      ],
    } as never);
  }
  return buildWorkbook(sheets as never);
}
