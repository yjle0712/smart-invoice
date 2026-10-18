import { parseMoney, parseQuantity, type Cents, type RateBp } from "./money";
import { computeInvoice, type InvoiceTotals, type RoundingMode } from "./vat";
import { parseDateFlexible } from "./dates";

/**
 * Facturation par lots à partir de COMMANDES RÉELLES.
 *
 * L'utilisateur importe un fichier (Excel/CSV) où chaque ligne est une ligne de
 * commande : référence de commande, date, client, référence produit, quantité.
 * Les lignes d'une même commande deviennent une facture brouillon.
 *
 * Règles :
 *  - le prix vient TOUJOURS du catalogue ; si le fichier contient un prix différent,
 *    la ligne est rejetée (le catalogue n'est jamais modifié) ;
 *  - une commande déjà facturée est signalée comme doublon ;
 *  - aucune donnée n'est inventée : toute information manquante est une erreur.
 */

export interface OrderRow {
  rowNumber: number;
  orderRef: string;
  date: unknown;
  client: string; // ICE ou raison sociale
  productRef: string;
  quantity: unknown;
  unitPriceTtc?: unknown; // facultatif, uniquement pour contrôle
  deliveryNote?: string; // facultatif : n° de bon de livraison
}

export interface CatalogItem {
  id: string;
  reference: string;
  designation: string;
  unitPriceTtc: Cents;
  vatRateBp: RateBp;
  active: boolean;
}

export interface ClientItem {
  id: string;
  name: string;
  ice: string | null;
  archived: boolean;
}

export interface DraftLine {
  productId: string;
  designation: string;
  quantity: number;
  unitPriceTtc: Cents;
  vatRateBp: RateBp;
}

export interface BatchDraft {
  orderRef: string;
  date: string; // ISO yyyy-mm-dd
  clientId: string;
  clientName: string;
  lines: DraftLine[];
  /** N° de bon(s) de livraison de la commande (distincts, séparés par des virgules). */
  deliveryNote: string | null;
  totals: InvoiceTotals;
  rows: number[];
}

export interface BatchIssue {
  row: number | null;
  orderRef: string | null;
  level: "error" | "warning";
  message: string;
}

export interface BatchResult {
  drafts: BatchDraft[];
  issues: BatchIssue[];
  /** Commandes rejetées à cause d'au moins une erreur. */
  rejectedOrders: string[];
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

export function buildDraftsFromOrders(
  rows: OrderRow[],
  catalog: CatalogItem[],
  clients: ClientItem[],
  alreadyInvoicedOrderRefs: Set<string>,
  opts: { requireClientIce?: boolean; roundingMode?: RoundingMode } = {},
): BatchResult {
  const issues: BatchIssue[] = [];
  const byRef = new Map(catalog.map((p) => [norm(p.reference), p]));
  const clientByIce = new Map(clients.filter((c) => c.ice).map((c) => [norm(c.ice as string), c]));
  const clientByName = new Map<string, ClientItem[]>();
  for (const c of clients) {
    const k = norm(c.name);
    clientByName.set(k, [...(clientByName.get(k) ?? []), c]);
  }

  interface Group { date: string | null; client: ClientItem | null; lines: DraftLine[]; rows: number[]; bad: boolean; bl: Set<string> }
  const groups = new Map<string, Group>();
  const invoicedNorm = new Set([...alreadyInvoicedOrderRefs].map(norm));

  for (const r of rows) {
    const ref = (r.orderRef ?? "").toString().trim();
    const err = (message: string, level: "error" | "warning" = "error") =>
      issues.push({ row: r.rowNumber, orderRef: ref || null, level, message });

    if (!ref) { err("Référence de commande manquante."); continue; }
    const key = norm(ref);
    const g: Group = groups.get(key) ?? { date: null, client: null, lines: [], rows: [], bad: false, bl: new Set<string>() };
    groups.set(key, g);
    g.rows.push(r.rowNumber);
    const bl = (r.deliveryNote ?? "").toString().trim();
    if (bl) g.bl.add(bl);
    const fail = (m: string) => { err(m); g.bad = true; };

    if (invoicedNorm.has(key)) { fail(`La commande ${ref} a déjà été facturée (doublon).`); continue; }

    // Date
    const date = parseDateFlexible(r.date);
    if (!date) fail("Date manquante ou invalide.");
    else if (g.date && g.date !== date) fail(`Dates différentes pour la même commande (${g.date} / ${date}).`);
    else g.date = date;

    // Client
    const clientKey = (r.client ?? "").toString().trim();
    let client: ClientItem | null = null;
    if (!clientKey) fail("Client manquant.");
    else {
      client = clientByIce.get(norm(clientKey)) ?? null;
      if (!client) {
        const matches = clientByName.get(norm(clientKey)) ?? [];
        if (matches.length === 1) client = matches[0];
        else if (matches.length > 1) fail(`Plusieurs clients nommés « ${clientKey} » : utilisez l'ICE.`);
        else fail(`Client « ${clientKey} » introuvable. Créez-le d'abord dans Clients.`);
      }
      if (client?.archived) { fail(`Le client « ${client.name} » est archivé.`); client = null; }
      if (client && opts.requireClientIce && !client.ice) fail(`L'ICE du client « ${client.name} » est obligatoire.`);
      if (client && g.client && g.client.id !== client.id) fail("Clients différents pour la même commande.");
      else if (client) g.client = client;
    }

    // Produit
    const product = byRef.get(norm((r.productRef ?? "").toString()));
    if (!product) { fail(`Produit « ${r.productRef ?? ""} » introuvable dans le catalogue.`); continue; }
    if (!product.active) { fail(`Le produit « ${product.reference} » est archivé.`); continue; }

    // Quantité
    const qty = parseQuantity(r.quantity as string | number);
    if (qty === null || qty <= 0) { fail("Quantité manquante ou invalide."); continue; }

    // Prix : contrôle uniquement, jamais de modification du catalogue.
    if (r.unitPriceTtc !== undefined && r.unitPriceTtc !== null && r.unitPriceTtc !== "") {
      const filePrice = parseMoney(r.unitPriceTtc as string | number);
      if (filePrice === null) { fail("Prix unitaire illisible."); continue; }
      if (filePrice !== product.unitPriceTtc) {
        fail(
          `Prix du fichier (${(filePrice / 100).toFixed(2)}) différent du prix catalogue ` +
          `(${(product.unitPriceTtc / 100).toFixed(2)}) pour « ${product.reference} ». ` +
          `Le catalogue n'est pas modifié : corrigez le fichier ou le catalogue.`,
        );
        continue;
      }
    }

    const existing = g.lines.find((l) => l.productId === product.id);
    if (existing) {
      existing.quantity = Math.round((existing.quantity + qty) * 1000) / 1000;
      err(`Produit « ${product.reference} » présent plusieurs fois : quantités additionnées.`, "warning");
    } else {
      g.lines.push({
        productId: product.id,
        designation: product.designation,
        quantity: qty,
        unitPriceTtc: product.unitPriceTtc,
        vatRateBp: product.vatRateBp,
      });
    }
  }

  const drafts: BatchDraft[] = [];
  const rejectedOrders: string[] = [];
  for (const [, g] of groups) {
    const firstRow = rows.find((r) => g.rows.includes(r.rowNumber));
    const orderRef = (firstRow?.orderRef ?? "").toString().trim();
    if (g.bad || !g.date || !g.client || g.lines.length === 0) {
      if (orderRef) rejectedOrders.push(orderRef);
      continue;
    }
    drafts.push({
      orderRef,
      date: g.date,
      clientId: g.client.id,
      clientName: g.client.name,
      lines: g.lines,
      deliveryNote: g.bl.size ? [...g.bl].join(", ").slice(0, 200) : null,
      totals: computeInvoice(g.lines, opts.roundingMode),
      rows: g.rows,
    });
  }
  drafts.sort((a, b) => a.date.localeCompare(b.date) || a.orderRef.localeCompare(b.orderRef));
  return { drafts, issues, rejectedOrders };
}
