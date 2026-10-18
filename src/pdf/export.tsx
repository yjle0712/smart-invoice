import { pdf } from "@react-pdf/renderer";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { supabase, must, storageToDataUrl } from "../lib/supabase";
import type { Company, DeliveryNote, DeliveryNoteLine, Invoice, InvoiceLine, InvoiceTemplateRow, Party, PartySnapshot } from "../lib/types";
import { safeFileName } from "../lib/utils";
import { InvoiceDocument, type InvoicePdfData } from "./InvoiceDocument";

/** Cache des images (logo, fonds) pour les lots. */
const imageCache = new Map<string, Promise<string | null>>();
export function cachedImage(path: string | null | undefined) {
  if (!path) return Promise.resolve(null);
  if (!imageCache.has(path)) imageCache.set(path, storageToDataUrl(path));
  return imageCache.get(path)!;
}

/** Logo de l'entreprise et fond du modèle « papier à en-tête ». */
export async function loadPdfAssets(logoPath: string | null | undefined, template: InvoiceTemplateRow | null) {
  const [logo, background] = await Promise.all([
    cachedImage(logoPath),
    template?.base === "entete" ? cachedImage(template.background_path) : Promise.resolve(null),
  ]);
  return { logo, background };
}

/** Après remplacement d'un fichier (logo, fond), on force son rechargement. */
export function forgetImage(path: string | null | undefined) {
  if (path) imageCache.delete(path);
}

export function partyToSnapshot(p: Party | null): PartySnapshot {
  return {
    name: p?.name ?? "—", ice: p?.ice ?? null, if_number: p?.if_number ?? null, rc: p?.rc ?? null,
    address: p?.address ?? null, city: p?.city ?? null,
  };
}

/**
 * Assemble les données d'une facture pour le PDF.
 * Facture validée : on utilise les instantanés (entreprise et client au moment de la validation).
 * Brouillon : données actuelles.
 */
export async function buildPdfData(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company,
  client: Party | null,
  template: InvoiceTemplateRow | null,
): Promise<InvoicePdfData> {
  const snapCompany = invoice.status !== "draft" && invoice.company_snapshot ? (invoice.company_snapshot as Company) : company;
  const companyData = { ...company, ...snapCompany, is_demo: company.is_demo };
  const [logo, background] = await Promise.all([
    cachedImage(companyData.logo_path),
    template?.base === "entete" ? cachedImage(template.background_path) : Promise.resolve(null),
  ]);
  return {
    company: companyData,
    logo,
    background,
    invoice: {
      number: invoice.number, status: invoice.status, issue_date: invoice.issue_date, due_date: invoice.due_date,
      order_ref: invoice.order_ref, delivery_note_ref: invoice.delivery_note_ref, payment_terms: invoice.payment_terms, payment_method: invoice.payment_method, goods_nature: invoice.goods_nature,
      notes: invoice.notes, is_demo: invoice.is_demo || company.is_demo, cancel_reason: invoice.cancel_reason,
    },
    client: invoice.status !== "draft" && invoice.client_snapshot ? invoice.client_snapshot : partyToSnapshot(client),
    lines: [...lines].sort((a, b) => a.position - b.position).map((l) => ({
      designation: l.designation, unit: l.unit, quantity: Number(l.quantity), unit_price_ttc: l.unit_price_ttc,
      discount_bp: l.discount_bp, total_ttc: l.total_ttc, vat_rate_bp: l.vat_rate_bp,
    })),
    totals: { total_ht: invoice.total_ht, total_vat: invoice.total_vat, total_ttc: invoice.total_ttc, vat_breakdown: invoice.vat_breakdown },
    template: { base: template?.base ?? "classic", settings: template?.settings ?? null },
  };
}

/** Données PDF d'un bon de livraison / commande (même modèle que les factures). */
export async function buildNotePdfData(
  note: DeliveryNote,
  lines: DeliveryNoteLine[],
  company: Company,
  template: InvoiceTemplateRow | null,
): Promise<InvoicePdfData> {
  const [logo, background] = await Promise.all([
    cachedImage(company.logo_path),
    template?.base === "entete" ? cachedImage(template.background_path) : Promise.resolve(null),
  ]);
  return {
    company,
    logo,
    background,
    invoice: {
      number: note.number, status: "validated", issue_date: note.issue_date, due_date: null,
      order_ref: note.order_ref, delivery_note_ref: null, payment_terms: null, goods_nature: null,
      notes: note.notes, is_demo: note.is_demo || company.is_demo,
    },
    client: note.client_snapshot ?? partyToSnapshot(null),
    lines: [...lines].sort((a, b) => a.position - b.position).map((l) => ({
      designation: l.designation, unit: l.unit, quantity: Number(l.quantity), unit_price_ttc: l.unit_price_ttc,
      discount_bp: l.discount_bp, total_ttc: l.total_ttc, vat_rate_bp: l.vat_rate_bp,
    })),
    totals: { total_ht: note.total_ht, total_vat: note.total_vat, total_ttc: note.total_ttc, vat_breakdown: note.vat_breakdown },
    template: { base: template?.base ?? "classic", settings: template?.settings ?? null },
    doc: { kind: note.kind, showPrices: note.show_prices, invoiceNumber: note.invoice_number },
  };
}

export function noteFileName(note: DeliveryNote, ext = "pdf") {
  return `${safeFileName(note.number, note.client_snapshot?.name ?? "")}.${ext}`;
}

export async function renderPdfBlob(data: InvoicePdfData): Promise<Blob> {
  const blob = await pdf(<InvoiceDocument data={data} />).toBlob();
  if (!blob || blob.size < 500) throw new Error("Le PDF n'a pas pu être généré.");
  return blob;
}

export function invoiceFileName(inv: Invoice, clientName: string, ext = "pdf") {
  return `${safeFileName(inv.number ?? `BROUILLON-${inv.id.slice(0, 8)}`, clientName)}.${ext}`;
}

/** Charge tout ce qu'il faut pour imprimer une liste de factures. */
export async function loadInvoicesForPdf(company: Company, invoiceIds: string[]) {
  const invoices = must(await supabase.from("invoices").select("*").in("id", invoiceIds)) as Invoice[];
  const lines = must(await supabase.from("invoice_lines").select("*").in("invoice_id", invoiceIds)) as InvoiceLine[];
  const clientIds = [...new Set(invoices.map((i) => i.client_id).filter(Boolean))] as string[];
  const clients = clientIds.length ? (must(await supabase.from("parties").select("*").in("id", clientIds)) as Party[]) : [];
  const templates = must(await supabase.from("invoice_templates").select("*").eq("company_id", company.id)) as InvoiceTemplateRow[];
  const tplById = new Map(templates.map((t) => [t.id, t]));
  const defaultTpl = company.default_template_id ? tplById.get(company.default_template_id) ?? null : null;
  const order = new Map(invoiceIds.map((id, i) => [id, i]));
  return invoices
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((inv) => ({
      invoice: inv,
      lines: lines.filter((l) => l.invoice_id === inv.id),
      client: clients.find((c) => c.id === inv.client_id) ?? null,
      template: (inv.template_id ? tplById.get(inv.template_id) : null) ?? defaultTpl,
    }));
}

/**
 * Télécharge plusieurs factures : un ZIP (un PDF par facture) ou un PDF par facture concaténé.
 * Renvoie le nombre de fichiers réellement générés ; lève une erreur si aucun.
 */
export async function downloadInvoicesZip(
  company: Company,
  invoiceIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const items = await loadInvoicesForPdf(company, invoiceIds);
  const zip = new JSZip();
  const errors: string[] = [];
  let done = 0;
  for (const it of items) {
    try {
      const data = await buildPdfData(it.invoice, it.lines, company, it.client, it.template);
      const blob = await renderPdfBlob(data);
      zip.file(invoiceFileName(it.invoice, it.client?.name ?? ""), blob);
    } catch (e) {
      errors.push(`${it.invoice.number ?? it.invoice.id} : ${(e as Error).message}`);
    }
    done++;
    onProgress?.(done, items.length);
    await new Promise((r) => setTimeout(r, 0)); // laisse respirer l'interface
  }
  const count = items.length - errors.length;
  if (count === 0) throw new Error("Aucun PDF n'a pu être généré. " + errors.join(" ; "));
  if (errors.length) zip.file("ERREURS.txt", errors.join("\n"));
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  saveAs(blob, `${safeFileName("Factures", company.legal_name)}.zip`);
  return count;
}

/** Un seul PDF contenant toutes les factures (une facture = une ou plusieurs pages). */
export async function downloadInvoicesSinglePdf(
  company: Company,
  invoiceIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const { PDFDocument } = await import("pdf-lib");
  const items = await loadInvoicesForPdf(company, invoiceIds);
  const merged = await PDFDocument.create();
  let done = 0;
  for (const it of items) {
    const data = await buildPdfData(it.invoice, it.lines, company, it.client, it.template);
    const blob = await renderPdfBlob(data);
    const src = await PDFDocument.load(await blob.arrayBuffer());
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
    done++;
    onProgress?.(done, items.length);
  }
  const bytes = await merged.save();
  saveAs(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${safeFileName("Factures", company.legal_name)}.pdf`);
  return done;
}
