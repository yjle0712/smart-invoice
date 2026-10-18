/**
 * Génère des PDF de test pour l'extraction (données fictives) et la vérité terrain attendue.
 * Usage : npm run fixtures:extraction  → src/domain/extraction/__fixtures__/
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import { InvoiceDocument, type InvoicePdfData } from "../src/pdf/InvoiceDocument";
import { computeInvoice } from "../src/domain/vat";
import type { TemplateBase } from "../src/lib/types";

const OUT = "src/domain/extraction/__fixtures__";
mkdirSync(OUT, { recursive: true });

interface Truth {
  pageFrom: number; pageTo: number; number: string | null; date: string | null; ht: number | null; vat: number | null; ttc: number | null;
  kind: "sale" | "purchase"; partyIce: string | null; rates?: number[]; expectIssue?: string;
}

const COMPANY = { legal_name: "ATLAS DISTRIBUTION SARL", ice: "001234567000089", if_number: "12345678", rc: "RC 98765", tp: "TP 4567",
  address: "12, bd Zerktouni", city: "Casablanca", currency_label: "DH" as const, legal_mentions: "SARL au capital de 100 000 DH.",
  show_phone: false, show_email: false, show_bank: false };

const PRODUCTS = [
  { d: "Huile de table 5 L", p: 9500, r: 1000 }, { d: "Thé vert 200 g", p: 2400, r: 2000 },
  { d: "Café moulu 1 kg", p: 11400, r: 1400 }, { d: "Sucre 1 kg carton de 12", p: 15600, r: 700 }, { d: "Eau minérale 1,5 L x6", p: 3300, r: 2000 },
];

function ours(number: string, date: string, client: { name: string; ice: string }, n: number, base: TemplateBase, singleRate = false, demo = false): { data: InvoicePdfData; total: ReturnType<typeof computeInvoice> } {
  const lines = Array.from({ length: n }, (_, i) => {
    const p = PRODUCTS[singleRate ? 1 : i % PRODUCTS.length];
    return { designation: `${p.d}${n > 5 ? ` réf. ${i + 1}` : ""}`, unit: "U", quantity: (i % 6) + 1, unit_price_ttc: p.p, discount_bp: 0, vat_rate_bp: p.r };
  });
  const t = computeInvoice(lines.map((l) => ({ quantity: l.quantity, unitPriceTtc: l.unit_price_ttc, vatRateBp: l.vat_rate_bp })));
  return {
    total: t,
    data: {
      company: COMPANY, logo: null, background: null,
      invoice: { number, status: "validated", issue_date: date, due_date: null, order_ref: null, payment_terms: "30 jours", goods_nature: "Produits alimentaires", notes: null, is_demo: demo },
      client: { ...client, if_number: null, rc: null, address: "Rue 5", city: "Rabat" },
      lines: lines.map((l, i) => ({ ...l, total_ttc: t.lines[i].totalTtc })),
      totals: { total_ht: t.totalHt, total_vat: t.totalVat, total_ttc: t.totalTtc, vat_breakdown: t.byRate.map((g) => ({ vat_rate_bp: g.vatRateBp, base_ht: g.baseHt, vat: g.vat, ttc: g.ttc })) },
      template: { base },
    },
  };
}

// ---------- Mises en page « fournisseurs » variées ----------
const s = { page: { padding: 36, fontSize: 9.5, fontFamily: "Helvetica" }, row: { flexDirection: "row" as const, justifyContent: "space-between" as const }, b: { fontFamily: "Helvetica-Bold" } };
const money = (c: number, style: "fr" | "dot" | "en" = "fr") => {
  const v = (c / 100).toFixed(2);
  const [i, d] = v.split(".");
  const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, style === "fr" ? " " : style === "dot" ? "." : ",");
  return style === "en" ? `${g}.${d}` : `${g},${d}`;
};

function SupplierA({ num, dateTxt, ht, vat }: { num: string; dateTxt: string; ht: number; vat: number }) {
  return (
    <Page size="A4" style={s.page}>
      <Text style={[s.b, { fontSize: 14 }]}>MINOTERIE DU SUD SARL</Text>
      <Text>Zone industrielle, lot 14 — Agadir</Text>
      <View style={[s.row, { marginTop: 18 }]}>
        <View><Text style={[s.b, { fontSize: 16 }]}>FACTURE</Text><Text>Facture N° : {num}</Text><Text>Date : {dateTxt}</Text><Text>Bon de livraison n° 77</Text></View>
        <View><Text>Code client : 12345</Text><Text>Doit :</Text><Text style={s.b}>ATLAS DISTRIBUTION SARL</Text><Text>ICE : 001234567000089</Text></View>
      </View>
      <View style={[s.row, { marginTop: 18 }]}><Text>Désignation</Text><Text>Qté</Text><Text>P.U. HT</Text><Text>Montant HT</Text></View>
      <View style={s.row}><Text>Farine de blé T55 sac 50 kg</Text><Text>20</Text><Text>{money(ht / 20)}</Text><Text>{money(ht)}</Text></View>
      <View style={{ marginTop: 18, marginLeft: 300 }}>
        <View style={s.row}><Text>Total HT :</Text><Text>{money(ht)}</Text></View>
        <View style={s.row}><Text>T.V.A 20 % :</Text><Text>{money(vat)}</Text></View>
        <View style={s.row}><Text style={s.b}>Net à payer :</Text><Text style={s.b}>{money(ht + vat)}</Text></View>
      </View>
      <Text style={{ position: "absolute", bottom: 40, left: 36, right: 36, textAlign: "center", fontSize: 8 }}>
        MINOTERIE DU SUD SARL — ICE : 000999888000077 — IF : 4455667 — RC : 1234 Agadir
      </Text>
      <Text style={{ position: "absolute", bottom: 26, right: 36, fontSize: 8 }}>Page 1 sur 1</Text>
    </Page>
  );
}

function TwoPerPage({ a, b }: { a: { num: string; date: string; ht: number; vat: number }; b: { num: string; date: string; ht: number; vat: number } }) {
  const Block = ({ x }: { x: typeof a }) => (
    <View style={{ height: 360, borderBottomWidth: 1, borderStyle: "dashed", paddingBottom: 10, marginBottom: 10 }}>
      <Text style={[s.b, { fontSize: 12 }]}>STE BOUCHERIE AL AMANE</Text>
      <Text>ICE 000555444000033   IF 7788990</Text>
      <View style={[s.row, { marginTop: 10 }]}><Text style={s.b}>FACTURE {x.num}</Text><Text>Casablanca, le {x.date}</Text></View>
      <Text>Client : ATLAS DISTRIBUTION SARL — ICE 001234567000089</Text>
      <View style={[s.row, { marginTop: 10 }]}><Text>Désignation</Text><Text>Montant</Text></View>
      <View style={s.row}><Text>Viande hachée 10 kg</Text><Text>{money(x.ht, "dot")}</Text></View>
      <View style={[s.row, { marginTop: 10 }]}><Text>TOTAL HT</Text><Text>{money(x.ht, "dot")}</Text></View>
      <View style={s.row}><Text>TVA 10%</Text><Text>{money(x.vat, "dot")}</Text></View>
      <View style={s.row}><Text style={s.b}>TOTAL TTC</Text><Text style={s.b}>{money(x.ht + x.vat, "dot")}</Text></View>
    </View>
  );
  return <Page size="A4" style={s.page}><Block x={a} /><Block x={b} /></Page>;
}

function Stacked({ num }: { num: string }) {
  const items = Array.from({ length: 48 }, (_, i) => ({ d: `Pièce détachée ${i + 1}`, v: 25000 }));
  const ht = items.reduce((t, i) => t + i.v, 0);
  const vat = Math.round(ht * 0.2);
  return [
    <Page key="1" size="A4" style={s.page}>
      <Text style={[s.b, { fontSize: 13 }]}>GARAGE MODERNE SARLAU</Text>
      <Text>ICE: 000777666000011</Text>
      <Text style={[s.b, { marginTop: 14, fontSize: 15 }]}>Facture</Text>
      <Text>N°</Text>
      <Text>{num}</Text>
      <Text>Date de facture</Text>
      <Text>05/02/2026</Text>
      <Text>Client</Text>
      <Text>ATLAS DISTRIBUTION SARL</Text>
      <Text>ICE : 001234567000089</Text>
      <View style={[s.row, { marginTop: 10 }]}><Text>Libellé</Text><Text>Montant HT</Text></View>
      {items.slice(0, 30).map((i) => <View key={i.d} style={s.row}><Text>{i.d}</Text><Text>{money(i.v)}</Text></View>)}
      <Text style={{ position: "absolute", bottom: 26, right: 36 }}>Page 1/2</Text>
    </Page>,
    <Page key="2" size="A4" style={s.page}>
      {items.slice(30).map((i) => <View key={i.d} style={s.row}><Text>{i.d}</Text><Text>{money(i.v)}</Text></View>)}
      <Text style={{ marginTop: 14 }}>Total HT</Text><Text>{money(ht)}</Text>
      <Text>Montant TVA (20 %)</Text><Text>{money(vat)}</Text>
      <Text>Total TTC</Text><Text>{money(ht + vat)}</Text>
      <Text style={{ position: "absolute", bottom: 26, right: 36 }}>Page 2/2</Text>
    </Page>,
  ];
}

function Simple({ name, ice, num, date, lines }: { name: string; ice: string; num: string; date: string; lines: [string, string][] }) {
  return (
    <Page size="A4" style={s.page}>
      <Text style={[s.b, { fontSize: 13 }]}>{name}</Text>
      <Text>ICE : {ice}</Text>
      <Text style={[s.b, { marginTop: 12 }]}>FACTURE N° {num}</Text>
      <Text>Date : {date}</Text>
      <Text>Client : ATLAS DISTRIBUTION SARL   ICE : 001234567000089</Text>
      <View style={{ marginTop: 14, marginLeft: 280 }}>
        {lines.map(([l, v]) => <View key={l} style={s.row}><Text>{l}</Text><Text>{v}</Text></View>)}
      </View>
    </Page>
  );
}

async function main() {
  const truth: Truth[] = [];
  const parts: Buffer[] = [];
  let page = 1;
  const add = async (buf: Buffer, t: Omit<Truth, "pageFrom" | "pageTo">[], pagesPer?: number[]) => {
    const doc = await PDFDocument.load(buf);
    const n = doc.getPageCount();
    if (pagesPer) {
      let p = page;
      t.forEach((x, i) => { truth.push({ ...x, pageFrom: p, pageTo: p + pagesPer[i] - 1 }); p += pagesPer[i]; });
    } else t.forEach((x) => truth.push({ ...x, pageFrom: page, pageTo: page + n - 1 }));
    parts.push(buf);
    page += n;
  };

  // 1) Ventes émises par notre propre générateur (plusieurs modèles, numéros alphanumériques)
  const client = { name: "ÉPICERIE NOUR", ice: "000111222000033" };
  const sales: [string, string, number, TemplateBase, boolean?][] = [
    ["NOV0100/2025A", "2025-11-03", 3, "classic"], ["NOV0101/2025A", "2025-11-05", 5, "modern", true], ["FA0042/2026", "2026-01-12", 70, "compact"],
    ["FA0043/2026", "2026-01-15", 4, "corporate"], ["FA0044/2026", "2026-01-20", 2, "minimal", true],
  ];
  for (const [num, date, n, base, single] of sales) {
    const { data, total } = ours(num, date, client, n, base, single);
    await add(await renderToBuffer(<InvoiceDocument data={data} />), [{
      number: num, date, ht: total.totalHt, vat: total.totalVat, ttc: total.totalTtc, kind: "sale", partyIce: client.ice,
      rates: total.byRate.map((g) => g.vatRateBp),
    }]);
  }

  // 2) Achats : mises en page fournisseurs différentes
  await add(await renderToBuffer(<Document><SupplierA num="F-2026/0458" dateTxt="12 mars 2026" ht={1000000} vat={200000} /></Document>),
    [{ number: "F-2026/0458", date: "2026-03-12", ht: 1000000, vat: 200000, ttc: 1200000, kind: "purchase", partyIce: "000999888000077" }]);

  const a = { num: "2026-00012", date: "02/04/2026", ht: 123456, vat: 12346 };
  const b = { num: "2026-00013", date: "03/04/2026", ht: 50000, vat: 5000 };
  await add(await renderToBuffer(<Document><TwoPerPage a={a} b={b} /></Document>), [
    { number: a.num, date: "2026-04-02", ht: a.ht, vat: a.vat, ttc: a.ht + a.vat, kind: "purchase", partyIce: "000555444000033" },
    { number: b.num, date: "2026-04-03", ht: b.ht, vat: b.vat, ttc: b.ht + b.vat, kind: "purchase", partyIce: "000555444000033" },
  ]);

  const stackedHt = 48 * 25000;
  await add(await renderToBuffer(<Document>{Stacked({ num: "INV-77/B" })}</Document>),
    [{ number: "INV-77/B", date: "2026-02-05", ht: stackedHt, vat: Math.round(stackedHt * 0.2), ttc: stackedHt + Math.round(stackedHt * 0.2), kind: "purchase", partyIce: "000777666000011" }]);

  // Facture sans ligne de TVA (doit rester vide + suggestion)
  await add(await renderToBuffer(<Document><Simple name="PAPETERIE CENTRALE SARL" ice="000222333000044" num="P-981" date="10/03/2026" lines={[["Total HT", "1 000,00"], ["Total TTC", "1 200,00"]]} /></Document>),
    [{ number: "P-981", date: "2026-03-10", ht: 100000, vat: null, ttc: 120000, kind: "purchase", partyIce: "000222333000044", expectIssue: "TVA introuvable" }]);
  // Totaux incohérents
  await add(await renderToBuffer(<Document><Simple name="TRANSPORT RAPIDE SARL" ice="000333444000055" num="TR-2026-15" date="11/03/2026" lines={[["Total HT", "2 000,00"], ["TVA 14 %", "280,00"], ["Total TTC", "2 380,00"]]} /></Document>),
    [{ number: "TR-2026-15", date: "2026-03-11", ht: 200000, vat: 28000, ttc: 238000, kind: "purchase", partyIce: "000333444000055", expectIssue: "ne concordent pas" }]);
  // Doublon exact d'une facture déjà présente
  await add(await renderToBuffer(<Document><SupplierA num="F-2026/0458" dateTxt="12 mars 2026" ht={1000000} vat={200000} /></Document>),
    [{ number: "F-2026/0458", date: "2026-03-12", ht: 1000000, vat: 200000, ttc: 1200000, kind: "purchase", partyIce: "000999888000077", expectIssue: "Doublon" }]);

  const merged = await PDFDocument.create();
  for (const buf of parts) {
    const src = await PDFDocument.load(buf);
    (await merged.copyPages(src, src.getPageIndices())).forEach((p) => merged.addPage(p));
  }
  writeFileSync(`${OUT}/lot-factures.pdf`, await merged.save());
  writeFileSync(`${OUT}/lot-factures.truth.json`, JSON.stringify(truth, null, 2));
  console.log(`✓ ${merged.getPageCount()} pages, ${truth.length} factures attendues`);
}

await main();
