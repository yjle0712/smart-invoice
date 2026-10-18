/**
 * Génère des PDF d'exemple pour les 12 modèles (données fictives, filigrane DÉMONSTRATION).
 * Usage : npm run pdf:samples   → dossier ./samples
 */
import { mkdirSync } from "node:fs";
import { renderToFile } from "@react-pdf/renderer";
import { InvoiceDocument, type InvoicePdfData } from "../src/pdf/InvoiceDocument";
import { TEMPLATE_PRESETS } from "../src/pdf/templates";
import { computeInvoice } from "../src/domain/vat";

const products = [
  { designation: "Huile de table 5 L", price: 9500, rate: 1000 },
  { designation: "Thé vert 200 g", price: 2400, rate: 2000 },
  { designation: "Café moulu 1 kg", price: 11400, rate: 1400 },
  { designation: "Pain (exonéré)", price: 120, rate: 0 },
  { designation: "Sucre en morceaux 1 kg — carton de 12", price: 15600, rate: 700 },
];

function sample(lineCount: number, base: InvoicePdfData["template"]["base"]): InvoicePdfData {
  const lines = Array.from({ length: lineCount }, (_, i) => {
    const p = products[i % products.length];
    return { designation: `${p.designation}${lineCount > 5 ? ` (lot ${i + 1})` : ""}`, unit: "U", quantity: (i % 7) + 1, unit_price_ttc: p.price, discount_bp: 0, vat_rate_bp: p.rate };
  });
  const t = computeInvoice(lines.map((l) => ({ quantity: l.quantity, unitPriceTtc: l.unit_price_ttc, vatRateBp: l.vat_rate_bp })));
  return {
    company: {
      legal_name: "SOCIÉTÉ DÉMO SARL (fictive)", address: "1, rue de l'Exemple", city: "Casablanca",
      ice: "000000000000000", if_number: "00000000", rc: "RC DEMO", tp: "TP DEMO", currency_label: "DH",
      legal_mentions: "Document de démonstration — données fictives sans valeur comptable ni fiscale.",
      show_phone: false, show_email: false, show_bank: true, bank_name: "Banque Démo", rib: "000 000 0000000000000000 00",
    },
    logo: null,
    background: null,
    invoice: {
      number: "DEMO-0001/2026", status: "validated", issue_date: "2026-10-15", due_date: "2026-11-14", order_ref: "DEMO-CMD-001",
      payment_terms: "30 jours", goods_nature: "Produits alimentaires", notes: "Livraison effectuée le 14/10/2026.", is_demo: true,
    },
    client: { name: "CLIENT DÉMO A (fictif)", ice: "000000000000001", if_number: null, rc: null, address: "Adresse fictive A", city: "Rabat" },
    lines: t.lines.map((l, i) => ({ ...lines[i], total_ttc: l.totalTtc })),
    totals: {
      total_ht: t.totalHt, total_vat: t.totalVat, total_ttc: t.totalTtc,
      vat_breakdown: t.byRate.map((g) => ({ vat_rate_bp: g.vatRateBp, base_ht: g.baseHt, vat: g.vat, ttc: g.ttc })),
    },
    template: { base },
  };
}

mkdirSync("samples", { recursive: true });
for (const p of TEMPLATE_PRESETS) {
  await renderToFile(<InvoiceDocument data={sample(5, p.base)} />, `samples/${p.base}.pdf`);
  console.log("✓", p.base);
}
await renderToFile(<InvoiceDocument data={sample(70, "classic")} />, "samples/long-70-lignes.pdf");
console.log("✓ long-70-lignes");
