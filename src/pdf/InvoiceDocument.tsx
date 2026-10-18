import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/stylesheet";
import type { BlockPos, Company, InvoiceStatus, PartySnapshot, TemplateBase, TemplateSettings, VatBreakdownRow } from "../lib/types";
import { formatMoney, formatQuantity, formatRate } from "../domain/money";
import { formatDateFr } from "../domain/dates";
import { amountToFrenchWords, arreteSentence } from "../domain/words";
import { resolveLook, resolvePositions, resolveSettings, shade, tint } from "./templates";
import { PAYMENT_METHOD_PDF } from "./paymentMethods";

const MM = 2.8346;
// Pas de césure au milieu des mots (montants en lettres, désignations) : retour à la ligne entre les mots.
Font.registerHyphenationCallback((word) => [word]);
const PAGE_H = 841.89;

export interface PdfLine {
  designation: string;
  unit: string | null;
  quantity: number;
  unit_price_ttc: number;
  discount_bp: number;
  total_ttc: number;
  vat_rate_bp: number;
}

export interface InvoicePdfData {
  company: Partial<Company> & { legal_name: string };
  logo: string | null;
  background: string | null;
  invoice: {
    number: string | null;
    status: InvoiceStatus;
    issue_date: string;
    due_date: string | null;
    order_ref: string | null;
    delivery_note_ref?: string | null;
    payment_terms: string | null;
    payment_method?: string | null;
    goods_nature: string | null;
    notes: string | null;
    is_demo: boolean;
    cancel_reason?: string | null;
  };
  client: PartySnapshot;
  lines: PdfLine[];
  totals: { total_ht: number; total_vat: number; total_ttc: number; vat_breakdown: VatBreakdownRow[] };
  template: { base: TemplateBase; settings?: Partial<TemplateSettings> | null };
  /** Bon de livraison / bon de commande imprimé avec le même modèle que les factures. */
  doc?: { kind: "BL" | "BC"; showPrices: boolean; invoiceNumber: string | null };
}

export const DOC_TITLE = { BL: "BON DE LIVRAISON", BC: "BON DE COMMANDE" } as const;
const DOC_LABEL = { BL: "Bon de livraison", BC: "Bon de commande" } as const;

export function InvoiceDocument({ data }: { data: InvoicePdfData }) {
  return (
    <Document
      title={data.doc ? `${DOC_LABEL[data.doc.kind]} ${data.invoice.number ?? ""}` : data.invoice.number ? `Facture ${data.invoice.number}` : "Facture (brouillon)"}
      author={data.company.legal_name}
      creator="Smart Invoice"
      producer="Smart Invoice"
      language="fr"
    >
      <InvoicePage data={data} />
    </Document>
  );
}

export function InvoicePage({ data }: { data: InvoicePdfData }) {
  const s = resolveSettings(data.template.base, data.template.settings);
  const look = resolveLook(data.template.base, s);
  const c = data.company;
  const cur = c.currency_label ?? "DH";
  const color = s.color;
  const light = tint(color, 0.9);
  const mid = tint(color, 0.75);
  const bold = s.font === "Helvetica" ? "Helvetica-Bold" : s.font === "Times-Roman" ? "Times-Bold" : "Courier-Bold";
  const fs = s.fontSize;
  const dark = shade(color, 0.38);
  const soft = tint(color, 0.94);
  const accent = /^#[0-9a-f]{6}$/i.test(s.accentColor) ? s.accentColor : tint(color, 0.45);
  const beige = tint(accent, 0.8);
  const gridCol = look.accentGrid ? shade(accent, 0.18) : "#c9ced4";
  const tintCol = look.header === "bigtitle" ? "#f7f8f9" : look.accentGrid ? tint(accent, 0.9) : soft;
  const tableHeaderBg = look.darkHeader ? dark : look.accentGrid && !look.neutralHeader ? color : look.neutralHeader ? "#eef0f2" : look.table === "filled" ? color : light;
  const tableHeaderFg = look.darkHeader || (look.accentGrid && !look.neutralHeader) ? "#ffffff" : look.table === "filled" && !look.neutralHeader ? "#ffffff" : look.neutralHeader ? "#222222" : color;
  const doc = data.doc ?? null;
  const prices = !doc || doc.showPrices;
  const docTitle = doc ? DOC_TITLE[doc.kind] : s.title || "FACTURE";
  const runningLabel = doc ? DOC_LABEL[doc.kind] : "Facture";
  const watermark = data.invoice.is_demo
    ? "DÉMONSTRATION — SANS VALEUR"
    : doc ? null
    : data.invoice.status === "draft" ? "BROUILLON — NON VALIDÉE"
    : data.invoice.status === "cancelled" ? "ANNULÉE" : null;

  const footerLines =
    (s.showLegalMentions && c.legal_mentions ? Math.ceil(c.legal_mentions.length / 140) : 0) +
    (s.footerText ? Math.ceil(s.footerText.length / 140) : 0) + (s.showFooterIds ? 2 : 0);
  // Le numéro de page est imprimé dans la marge basse : il ne réduit pas la zone de contenu.
  const footerReserve = (s.marginBottomMm + s.footerSpaceMm) * MM + footerLines * (s.fontSize - 1.5) * 1.4 + 6 + (look.footerStyle === "band" ? 14 : look.footerStyle === "line" ? 4 : 0);
  const st = StyleSheet.create({
    page: {
      fontFamily: s.font,
      fontSize: fs,
      color: "#1f2328",
      paddingTop: (s.marginTopMm + s.headerSpaceMm) * MM,
      paddingBottom: footerReserve,
      paddingLeft: s.marginSideMm * MM + (look.pageStripe ? 6 : 0),
      paddingRight: s.marginSideMm * MM,
      lineHeight: 1.35,
    },
    bold: { fontFamily: bold },
    muted: { color: "#5b6168" },
    small: { fontSize: fs - 1.5 },
    title: { fontFamily: bold, fontSize: doc ? fs + 6 : fs + 9, color, letterSpacing: 1, lineHeight: 1.05, marginBottom: 3 },
    th: { fontFamily: bold, fontSize: fs - 0.5, color: tableHeaderFg, paddingVertical: 5, paddingHorizontal: 5 },
    td: { paddingVertical: s.rowDensity === "compact" ? 1.2 : s.rowDensity === "airy" ? 4.5 : 2.5, paddingHorizontal: 5 },
    right: { textAlign: "right" },
    center: { textAlign: "center" },
  });

  // Colonnes du tableau (selon le réglage « Colonnes » du modèle)
  const htOf = (ttc: number, rate: number) => Math.round((ttc * 10000) / (10000 + rate));
  interface Col { key: string; label: string; w: number; right?: boolean; cell: (l: PdfLine, i: number) => string }
  const cols: Col[] = [];
  if (s.lineNumbers) cols.push({ key: "n", label: "N°", w: 6, cell: (_l, i) => String(i + 1) });
  cols.push({ key: "des", label: "DÉSIGNATION", w: 0, cell: () => "" });
  cols.push({ key: "qty", label: "QUANTITÉ", w: 12, right: true,
    cell: (l) => `${formatQuantity(l.quantity)}${s.showUnit && l.unit && l.unit !== "U" ? ` ${l.unit}` : ""}` });
  if (prices) {
    if (s.columns === "ttc") {
      cols.push({ key: "pu", label: "PRIX UNIT. TTC", w: 18, right: true, cell: (l) => formatMoney(l.unit_price_ttc) });
      cols.push({ key: "tot", label: "PRIX TOTAL TTC", w: 18, right: true, cell: (l) => formatMoney(l.total_ttc) });
    } else if (s.columns === "ht") {
      cols.push({ key: "pu", label: "PRIX UNIT. HT", w: 18, right: true, cell: (l) => formatMoney(htOf(l.unit_price_ttc, l.vat_rate_bp)) });
      cols.push({ key: "tot", label: "TOTAL HT", w: 18, right: true, cell: (l) => formatMoney(htOf(l.total_ttc, l.vat_rate_bp)) });
    } else {
      cols.push({ key: "pu", label: "P.U. HT", w: 14, right: true, cell: (l) => formatMoney(htOf(l.unit_price_ttc, l.vat_rate_bp)) });
      cols.push({ key: "tva", label: "TVA", w: 8, right: true, cell: (l) => formatRate(l.vat_rate_bp) });
      cols.push({ key: "ht", label: "TOTAL HT", w: 15, right: true, cell: (l) => formatMoney(htOf(l.total_ttc, l.vat_rate_bp)) });
      cols.push({ key: "tot", label: "TOTAL TTC", w: 15, right: true, cell: (l) => formatMoney(l.total_ttc) });
    }
  }
  const desW = 100 - cols.reduce((a, c) => a + c.w, 0);
  const width = (c: Col) => `${c.key === "des" ? desW : c.w}%`;
  const cellBorder: Style = look.table === "grid" ? { borderRightWidth: 0.5, borderRightColor: gridCol } : {};

  // ---------- Blocs ----------
  const logo = data.logo && s.logoPosition !== "none"
    ? <Image src={data.logo} style={{ height: s.logoHeightMm * MM, maxWidth: 60 * MM, objectFit: "contain" }} />
    : null;

  const companyIds = [
    c.ice && `ICE : ${c.ice}`, c.if_number && `IF : ${c.if_number}`, c.rc && `RC : ${c.rc}`,
    c.tp && `TP : ${c.tp}`, c.cnss && `CNSS : ${c.cnss}`,
  ].filter(Boolean) as string[];
  const contact = [c.show_phone && c.phone && `Tél. : ${c.phone}`, c.show_email && c.email && c.email].filter(Boolean) as string[];

  const companyBlock = s.showCompanyBlock ? (
    <View style={{ maxWidth: 95 * MM }}>
      <Text style={[st.bold, { fontSize: fs + 2.5, color: look.header === "band" ? "#ffffff" : "#111111" }]}>{c.legal_name}</Text>
      {!!(c.address || c.city) && <Text style={look.header === "band" ? { color: "#ffffff" } : st.muted}>{[c.address, c.city].filter(Boolean).join(", ")}</Text>}
      {contact.length > 0 && <Text style={look.header === "band" ? { color: "#ffffff" } : st.muted}>{contact.join("   ")}</Text>}
      {s.showCompanyIds && companyIds.length > 0 && (
        <Text style={[st.small, look.header === "band" ? { color: "#ffffff" } : st.muted]}>{companyIds.join("  |  ")}</Text>
      )}
    </View>
  ) : <View />;

  const titleBlock = (onColor = false) => (
    <View style={{ alignItems: "flex-end" }}>
      <Text style={[st.title, onColor ? { color: "#ffffff" } : {}]}>{docTitle}</Text>
      <Text style={[st.bold, { fontSize: fs + 1.5, color: onColor ? "#ffffff" : "#111111" }]}>
        N° {data.invoice.number ?? "— (brouillon)"}
      </Text>
      <Text style={onColor ? { color: "#ffffff" } : {}}>Date : {formatDateFr(data.invoice.issue_date)}</Text>
    </View>
  );

  let header: React.ReactNode = null;
  if (look.header === "band") {
    header = (
      <View style={{ backgroundColor: color, marginHorizontal: -s.marginSideMm * MM, marginTop: -s.marginTopMm * MM, paddingHorizontal: s.marginSideMm * MM, paddingVertical: 8 * MM, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 * MM }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {logo && <View style={{ backgroundColor: "#ffffff", padding: 4, borderRadius: 3 }}>{logo}</View>}
          {companyBlock}
        </View>
        {titleBlock(true)}
      </View>
    );
  } else if (look.header === "centered") {
    header = (
      <View style={{ alignItems: "center", marginBottom: 5 * MM }}>
        {logo}
        <View style={{ alignItems: "center", marginTop: 3 }}>
          {s.showCompanyBlock && (
            <>
              <Text style={[st.bold, { fontSize: fs + 3 }]}>{c.legal_name}</Text>
              {!!(c.address || c.city) && <Text style={st.muted}>{[c.address, c.city].filter(Boolean).join(", ")}</Text>}
              {contact.length > 0 && <Text style={st.muted}>{contact.join("   ")}</Text>}
            </>
          )}
        </View>
        <View style={{ width: "100%", borderTopWidth: 1.5, borderTopColor: color, borderBottomWidth: 0.5, borderBottomColor: color, height: 3, marginVertical: 6 }} />
        <Text style={[st.title, { textAlign: "center" }]}>{docTitle}</Text>
        <Text style={st.bold}>N° {data.invoice.number ?? "— (brouillon)"}  ·  {formatDateFr(data.invoice.issue_date)}</Text>
      </View>
    );
  } else if (look.header === "split") {
    header = (
      <View style={{ flexDirection: "row", marginBottom: 6 * MM, borderBottomWidth: 2, borderBottomColor: color, paddingBottom: 4 * MM }}>
        <View style={{ flex: 1, flexDirection: s.logoPosition === "right" ? "row-reverse" : "row", gap: 10, alignItems: "flex-start" }}>
          {logo}
          {companyBlock}
        </View>
        <View style={{ backgroundColor: color, paddingHorizontal: 6 * MM, paddingVertical: 4 * MM, marginLeft: 8 }}>
          {titleBlock(true)}
        </View>
      </View>
    );
  } else if (look.header !== "none") {
    const boxed: Style = look.header === "boxed" ? { borderWidth: 1, borderColor: mid, padding: 4 * MM } : {};
    header = (
      <View style={[{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 * MM, paddingBottom: look.header === "line" ? 3 * MM : 0, borderBottomWidth: look.header === "line" ? 2 : 0, borderBottomColor: color }, boxed]}>
        <View style={{ flexDirection: s.logoPosition === "right" ? "row-reverse" : "row", gap: 10, alignItems: "flex-start", flex: 1 }}>
          {s.logoPosition !== "center" && logo}
          {companyBlock}
        </View>
        {titleBlock()}
      </View>
    );
  } else {
    // Papier à en-tête : seul le titre et le numéro sont imprimés.
    header = (
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: 5 * MM }}>{titleBlock()}</View>
    );
  }

  const meta: [string, string][] = [];
  if (doc?.invoiceNumber) meta.push(["Facture", doc.invoiceNumber]);
  if (!doc && s.showDueDate && data.invoice.due_date) meta.push(["Échéance", formatDateFr(data.invoice.due_date)]);
  if (data.invoice.order_ref) meta.push(["Commande", data.invoice.order_ref]);
  if (!doc && s.showDeliveryNote && data.invoice.delivery_note_ref) meta.push(["Bon de livr.", data.invoice.delivery_note_ref]);
  if (!doc && s.showPaymentMethod && data.invoice.payment_method) meta.push(["Mode de paiement", PAYMENT_METHOD_PDF[data.invoice.payment_method] ?? data.invoice.payment_method]);
  if (!doc && s.showPaymentTerms && data.invoice.payment_terms) meta.push(["Conditions", data.invoice.payment_terms]);
  if (!doc && s.showGoodsNature && data.invoice.goods_nature) meta.push(["Nature", data.invoice.goods_nature]);

  const boxStyle: Style = look.header === "boxed" || look.totals === "box"
    ? { borderWidth: 0.75, borderColor: mid, padding: 3.5 * MM }
    : { borderLeftWidth: 2.5, borderLeftColor: color, paddingLeft: 3.5 * MM, paddingVertical: 1 };

  const clientBox = (style?: Style) => (
    <View style={[{ flex: 1.2 }, boxStyle, style ?? {}]}>
      <Text style={[st.small, st.muted, { marginBottom: 1 }]}>Client</Text>
      <Text style={[st.bold, { fontSize: fs + 1.5 }]}>{data.client.name}</Text>
      {s.showClientAddress && !!(data.client.address || data.client.city) && (
        <Text>{[data.client.address, data.client.city].filter(Boolean).join(", ")}</Text>
      )}
      <Text>ICE : {data.client.ice ?? "—"}</Text>
      {!!data.client.if_number && <Text>IF : {data.client.if_number}</Text>}
      {!!data.client.rc && <Text>RC : {data.client.rc}</Text>}
    </View>
  );
  const metaBox = (style?: Style) => (meta.length > 0 ? (
    <View style={[{ flex: 1 }, boxStyle, style ?? {}]}>
      {meta.map(([k, v]) => (
        <View key={k} style={{ flexDirection: "row" }}>
          <Text style={[st.muted, { width: 22 * MM }]}>{k}</Text>
          <Text style={{ flex: 1 }}>{v}</Text>
        </View>
      ))}
    </View>
  ) : <View style={{ flex: 1 }} />);

  let parties = (
    <View style={{ flexDirection: "row", gap: 6 * MM, marginBottom: 6 * MM }} wrap={false}>
      {clientBox()}
      {metaBox()}
    </View>
  );

  // ---------- Modèles FERCIM / NOVASTRO ----------
  const numberText = data.invoice.number ?? "— (brouillon)";
  const dateText = formatDateFr(data.invoice.issue_date);
  const clientRows: [string, string][] = [
    ["Raison sociale", data.client.name],
    ["ICE", data.client.ice ?? "—"],
    ...(s.showClientAddress && (data.client.address || data.client.city) ? [["Adresse", [data.client.address, data.client.city].filter(Boolean).join(", ")] as [string, string]] : []),
    ...(data.client.if_number ? [["IF", data.client.if_number] as [string, string]] : []),
    ...(data.client.rc ? [["RC", data.client.rc] as [string, string]] : []),
  ];
  const label = (t: string, style?: Style) => <Text style={[st.bold, { fontSize: fs - 1, color, letterSpacing: 0.3 }, style ?? {}]}>{t.toUpperCase()}</Text>;
  const logoAndCompany = (
    <View style={{ flex: 1, gap: 3 * MM }}>
      {logo}
      {s.showCompanyBlock && (
        <View>
          <Text style={[st.bold, { fontSize: fs + 1, color: dark }]}>{c.legal_name}</Text>
          {!!(c.address || c.city) && <Text style={[st.small, st.muted]}>{[c.address, c.city].filter(Boolean).join(", ")}</Text>}
          {contact.length > 0 && <Text style={[st.small, st.muted]}>{contact.join("   ")}</Text>}
          {s.showCompanyIds && c.ice && <Text style={[st.small, st.muted]}>ICE : {c.ice}</Text>}
        </View>
      )}
    </View>
  );

  if (look.header === "titlebox") {
    const rowsInBox: [string, string][] = [["N° de facture", numberText], ["Date", dateText], ...meta];
    header = (
      <View style={{ marginBottom: 5 * MM }}>
        <View style={{ flexDirection: "row", gap: 6 * MM, alignItems: "flex-start" }}>
          {logoAndCompany}
          <View style={{ width: 72 * MM, backgroundColor: color, paddingHorizontal: 4 * MM, paddingVertical: 3.5 * MM }}>
            <Text style={[st.bold, { color: "#ffffff", fontSize: doc ? fs + 7 : fs + 11, marginBottom: 3 * MM }]}>{docTitle}</Text>
            {rowsInBox.map(([k, v]) => (
              <View key={k} style={{ flexDirection: "row", alignItems: "center", marginTop: 1.5 }}>
                <Text style={[st.bold, { width: 26 * MM, fontSize: fs - 1.5, color: tint(color, 0.75) }]}>{k}</Text>
                <Text style={[st.bold, { flex: 1, backgroundColor: "#ffffff", color: dark, paddingHorizontal: 4, paddingVertical: 2 }]}>{v}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={{ height: 2.2, backgroundColor: "#a9b0bd", marginTop: 4 * MM }} />
      </View>
    );
  } else if (look.header === "centeredlogo") {
    header = (
      <View style={{ alignItems: "center", marginBottom: 4 * MM }}>
        {logo}
        {s.showCompanyBlock && !logo && <Text style={[st.bold, { fontSize: fs + 4, color }]}>{c.legal_name}</Text>}
        {!!(c.address || c.city) && <Text style={[st.small, { color: "#7d6a5c", marginTop: 2 }]}>{[c.address, c.city].filter(Boolean).join(" ")}</Text>}
        {contact.length > 0 && <Text style={[st.small, { color: "#7d6a5c" }]}>{contact.join("   ")}</Text>}
        <View style={{ alignSelf: "stretch", height: 1.2, backgroundColor: color, marginTop: 3 * MM, marginBottom: 4 * MM }} />
        <Text style={{ fontSize: doc ? fs + 7 : fs + 10, color, letterSpacing: doc ? 4 : 7, lineHeight: 1.2 }}>{docTitle}</Text>
        <Text style={[st.bold, { color: shade(accent, 0.2), marginTop: 3 }]}>N° {numberText}</Text>
      </View>
    );
  } else if (look.header === "bigtitle") {
    header = (
      <View style={{ flexDirection: "row", gap: 6 * MM, alignItems: "flex-start", marginBottom: 4 * MM }}>
        {logoAndCompany}
        <View style={{ alignItems: "flex-end", width: 85 * MM }}>
          <Text style={[st.bold, { fontSize: doc ? fs + 9 : fs + 15, color: "#a7adb5", letterSpacing: 0.5, lineHeight: 1.15 }]}>{docTitle}</Text>
          <Text style={[st.bold, { fontSize: fs + 0.5, color: "#4a4f57" }]}>N° {numberText}</Text>
        </View>
      </View>
    );
  }

  if (look.partiesStyle === "panel") {
    parties = (
      <View wrap={false} style={{ backgroundColor: soft, borderLeftWidth: 2.5, borderLeftColor: color, paddingHorizontal: 3.5 * MM, paddingVertical: 2.5 * MM, marginBottom: 5 * MM }}>
        {label("Facturé à", { marginBottom: 2 })}
        {clientRows.map(([k, v]) => (
          <View key={k} style={{ flexDirection: "row", marginTop: 1.5 }}>
            <Text style={[st.bold, st.muted, { width: 32 * MM, fontSize: fs - 0.5 }]}>{k}</Text>
            <Text style={[k === "Raison sociale" ? st.bold : {}, { flex: 1, backgroundColor: "#ffffff", paddingHorizontal: 4, paddingVertical: 1.5 }]}>{v}</Text>
          </View>
        ))}
      </View>
    );
  } else if (look.partiesStyle === "grid") {
    const gridTable = (title: string, rows: [string, string][]) => (
      <View style={{ flex: 1, borderWidth: 0.75, borderColor: gridCol }}>
        <Text style={[st.bold, { backgroundColor: color, color: accent, paddingHorizontal: 2 * MM, paddingVertical: 2.5, fontSize: fs - 0.5 }]}>{title.toUpperCase()}</Text>
        {rows.map(([k, v]) => (
          <View key={k} style={{ flexDirection: "row", borderTopWidth: 0.5, borderTopColor: gridCol }}>
            <Text style={[st.bold, { width: 30 * MM, backgroundColor: beige, color: "#7d6a5c", fontSize: fs - 1, paddingHorizontal: 1.5 * MM, paddingVertical: 2.5, borderRightWidth: 0.5, borderRightColor: gridCol }]}>{k}</Text>
            <Text style={{ flex: 1, paddingHorizontal: 1.5 * MM, paddingVertical: 2.5, color: "#2e2018" }}>{v}</Text>
          </View>
        ))}
      </View>
    );
    parties = (
      <View wrap={false} style={{ flexDirection: "row", marginBottom: 5 * MM }}>
        {gridTable("Client", clientRows)}
        {gridTable(doc ? DOC_LABEL[doc.kind] : "Facture", [["N° de facture", numberText], ["Date", dateText], ...meta])}
      </View>
    );
  } else if (look.partiesStyle === "cards") {
    const cardRow = ([k, v]: [string, string], strong = false) => (
      <View key={k} style={{ flexDirection: "row", backgroundColor: "#f3f4f6", marginTop: 2, paddingHorizontal: 2.5 * MM, paddingVertical: 2 }}>
        <Text style={[st.bold, { width: 27 * MM, fontSize: fs - 1.5, color: "#6b7078" }]}>{k}</Text>
        <Text style={[strong ? st.bold : {}, { flex: 1, color: "#25282d" }]}>{v}</Text>
      </View>
    );
    parties = (
      <View wrap={false} style={{ flexDirection: "row", gap: 8 * MM, borderTopWidth: 1.2, borderTopColor: color, paddingTop: 2.5 * MM, marginBottom: 5 * MM }}>
        <View style={{ flex: 1.15 }}>
          {label("Facturé à", { color: "#4a4f57", marginBottom: 1 })}
          {clientRows.map((r, i) => cardRow(r[0] === "Raison sociale" ? ["Nom", r[1]] : r[0] === "Adresse" ? ["Adr.", r[1]] : r, i === 0))}
        </View>
        <View style={{ flex: 1 }}>
          {label(doc ? "Informations" : "Informations facture", { color: "#4a4f57", marginBottom: 1 })}
          {[["N° de facture", numberText] as [string, string], ["Date", dateText] as [string, string], ...meta].map((r, i) => cardRow(r, i === 0))}
        </View>
      </View>
    );
  }

  // ---------- Disposition libre (glisser-déposer) ----------
  const free = s.layoutMode === "free";
  const pos = resolvePositions(s);
  const contentTop = (s.marginTopMm + s.headerSpaceMm) * MM;
  const abs = (b: BlockPos): Style => ({ position: "absolute", left: b.x * MM, top: b.y * MM, width: b.w * MM });
  const freeBlocks = free ? (
    <>
      {s.showCompanyBlock && <View style={abs(pos.company)}>{logo && s.logoPosition !== "none" && <View style={{ marginBottom: 2 }}>{logo}</View>}{companyBlock}</View>}
      {!s.showCompanyBlock && logo && s.logoPosition !== "none" && <View style={abs(pos.company)}>{logo}</View>}
      <View style={abs(pos.title)}>{titleBlock()}</View>
      <View style={abs(pos.client)}>{clientBox({ flex: 0 })}</View>
      {meta.length > 0 && <View style={abs(pos.meta)}>{metaBox({ flex: 0 })}</View>}
    </>
  ) : null;
  // Le tableau commence à la position choisie sur la 1re page, puis reprend sous l'en-tête des pages suivantes.
  const freeSpacer = free ? <View style={{ height: Math.max(0, pos.table.y * MM - contentTop) }} /> : null;
  const freeColumn: Style = free
    ? { marginLeft: Math.max(0, pos.table.x * MM - (s.marginSideMm * MM + (look.pageStripe ? 6 : 0))), width: Math.min(pos.table.w, 210 - pos.table.x - 5) * MM }
    : {};

  // ---------- Tableau des articles ----------
  const tableHeader = (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: look.darkHeader ? tableHeaderBg : look.table === "minimal" || look.table === "lines" ? undefined : tableHeaderBg,
        borderBottomWidth: !look.darkHeader && (look.table === "minimal" || look.table === "lines") ? 1.2 : 0,
        borderBottomColor: color,
        ...(look.tableRules ? { borderTopWidth: 1.2, borderTopColor: color, borderBottomWidth: 1.2, borderBottomColor: color } : {}),
        borderTopWidth: look.table === "grid" ? 0.5 : 0,
        borderLeftWidth: look.table === "grid" ? 0.5 : 0,
        borderColor: gridCol,
      }}
      fixed
    >
      {cols.map((c) => (
        <Text key={c.key} style={[st.th, c.right ? st.right : {}, { width: width(c) }, cellBorder]}>{c.label}</Text>
      ))}
    </View>
  );

  const rows = data.lines.map((l, i) => {
    const zebra = look.table === "striped" && i % 2 === 1 ? { backgroundColor: light } : {};
    const rowBorder: Style = look.table === "grid"
      ? { borderBottomWidth: 0.5, borderLeftWidth: 0.5, borderColor: gridCol }
      : look.table === "minimal" ? {} : { borderBottomWidth: 0.5, borderBottomColor: "#dde1e5" };
    const multiRate = prices && data.totals.vat_breakdown.length > 1;
    return (
      <View key={i} style={[{ flexDirection: "row" }, rowBorder, zebra]} wrap={false}>
        {cols.map((c) => c.key === "des" ? (
          <View key="des" style={[st.td, { width: width(c) }, cellBorder]}>
            <Text>{l.designation}</Text>
            {((multiRate && s.columns !== "full") || (prices && l.discount_bp > 0)) && (
              <Text style={[st.small, st.muted]}>
                {multiRate && s.columns !== "full" ? `TVA ${formatRate(l.vat_rate_bp)}` : ""}
                {prices && l.discount_bp > 0 ? `${multiRate && s.columns !== "full" ? " · " : ""}Remise ${formatRate(l.discount_bp)}` : ""}
              </Text>
            )}
          </View>
        ) : (
          <Text key={c.key} style={[st.td, c.right ? st.right : {}, { width: width(c) }, cellBorder,
            look.tintTotalCol && c.key === "tot" ? { backgroundColor: tintCol, fontFamily: bold, color: look.header === "bigtitle" ? "#2e3238" : color } : {}]}>{c.cell(l, i)}</Text>
        ))}
      </View>
    );
  });

  // ---------- Totaux ----------
  const vatRows = data.totals.vat_breakdown.filter((g) => g.vat_rate_bp > 0);
  const totalLine = (label: string, value: string, strong = false) => (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5, paddingHorizontal: 6 }}>
      <Text style={strong ? st.bold : {}}>{label}</Text>
      <Text style={strong ? st.bold : {}}>{value}</Text>
    </View>
  );
    const totalsBox: Style = look.totals === "box" ? { borderWidth: 0.75, borderColor: mid } : {};
  const breakdown = s.showVatBreakdown && data.totals.vat_breakdown.length > 1 ? (
    <View style={{ flex: 1, maxWidth: 92 * MM }}>
      <View style={{ flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: color }}>
        {["Taux", "Base HT", "TVA", "TTC"].map((h, i) => (
          <Text key={h} style={[st.small, st.bold, { flex: i === 0 ? 0.8 : 1, paddingVertical: 2, textAlign: i === 0 ? "left" : "right" }]}>{h}</Text>
        ))}
      </View>
      {data.totals.vat_breakdown.map((g) => (
        <View key={g.vat_rate_bp} style={{ flexDirection: "row" }}>
          <Text style={[st.small, { flex: 0.8, paddingVertical: 1.5 }]}>{g.vat_rate_bp === 0 ? "Exonéré" : formatRate(g.vat_rate_bp)}</Text>
          <Text style={[st.small, st.right, { flex: 1 }]}>{formatMoney(g.base_ht)}</Text>
          <Text style={[st.small, st.right, { flex: 1 }]}>{formatMoney(g.vat)}</Text>
          <Text style={[st.small, st.right, { flex: 1 }]}>{formatMoney(g.ttc)}</Text>
        </View>
      ))}
    </View>
  ) : <View style={{ flex: 1 }} />;

  const words = arreteWords();
  function arreteWords() {
    return doc ? `${doc.kind === "BL" ? "ARRÊTÉ LE PRÉSENT BON DE LIVRAISON" : "ARRÊTÉ LE PRÉSENT BON DE COMMANDE"} À LA SOMME DE : ${amountToFrenchWords(data.totals.total_ttc)}` : arreteSentence(data.totals.total_ttc);
  }
  const wordsAmount = amountToFrenchWords(data.totals.total_ttc);
  const wordsLabel = doc ? (doc.kind === "BL" ? "Arrêté le présent bon de livraison à la somme de :" : "Arrêté le présent bon de commande à la somme de :") : "Arrêtée la présente facture à la somme de :";
  const vatLabel = vatRows.length === 1 ? `TVA ${formatRate(vatRows[0].vat_rate_bp)}` : "TVA";
  const stackTotals = (
    <View wrap={false} style={{ marginTop: 4 * MM, borderTopWidth: 1, borderTopColor: dark, paddingTop: 3 * MM, flexDirection: "row", gap: 6 * MM }}>
      <View style={{ flex: 1 }}>
        <Text style={[st.bold, st.muted, { fontSize: fs - 0.5 }]}>{wordsLabel}</Text>
        <Text style={[st.bold, { color: dark, marginTop: 2, fontSize: fs + 0.5 }]}>{wordsAmount}</Text>
      </View>
      <View style={{ width: 70 * MM }}>
        {[["Total HT", data.totals.total_ht] as [string, number], ...(vatRows.length ? vatRows.map((g) => [`TVA ${formatRate(g.vat_rate_bp)}`, g.vat] as [string, number]) : [["TVA", 0] as [string, number]])].map(([k, v]) => (
          <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", backgroundColor: color, paddingHorizontal: 3 * MM, paddingVertical: 2.5 }}>
            <Text style={{ color: tint(color, 0.8) }}>{k}</Text>
            <Text style={[st.bold, { color: "#ffffff", fontSize: fs + 1 }]}>{formatMoney(v)} {cur}</Text>
          </View>
        ))}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: dark, paddingHorizontal: 3 * MM, paddingVertical: 4 }}>
          <Text style={[st.bold, { color: "#ffffff", fontSize: fs + 2.5 }]}>TOTAL TTC</Text>
          <Text style={[st.bold, { color: "#ffffff", fontSize: fs + 3.5 }]}>{formatMoney(data.totals.total_ttc)} {cur}</Text>
        </View>
      </View>
    </View>
  );
  const tile = (k: string, v: number, strong = false) => (
    <View key={k} style={{ flex: 1, alignItems: "center", paddingVertical: 2.5 * MM, backgroundColor: strong ? color : "#f3f4f6" }}>
      <Text style={[st.bold, { fontSize: fs - 1.5, color: strong ? "#a7adb5" : "#6b7078" }]}>{k.toUpperCase()}</Text>
      <Text style={[st.bold, { fontSize: fs + 4, color: strong ? "#ffffff" : "#4a4f57", marginTop: 2 }]}>{formatMoney(v)} {cur}</Text>
    </View>
  );
  const tilesTotals = (
    <View wrap={false} style={{ marginTop: 4 * MM, borderTopWidth: 1.2, borderTopColor: color, paddingTop: 3 * MM }}>
      <View style={{ flexDirection: "row", gap: 2 }}>
        {tile("Total HT", data.totals.total_ht)}
        {vatRows.length > 1 ? vatRows.map((g) => tile(`TVA ${formatRate(g.vat_rate_bp)}`, g.vat)) : tile(vatLabel, data.totals.total_vat)}
        {tile("Total TTC", data.totals.total_ttc, true)}
      </View>
      <Text style={[st.muted, { marginTop: 3 * MM, fontFamily: s.font === "Helvetica" ? "Helvetica-Oblique" : s.font }]}>{wordsLabel}</Text>
      <Text style={[st.bold, { color, marginTop: 1.5, fontSize: fs + 1, paddingBottom: 2.5 * MM, borderBottomWidth: 0.6, borderBottomColor: "#c9ced4" }]}>{wordsAmount}</Text>
    </View>
  );
  const gbRow = (k: string, v: number, strong = false) => (
    <View key={k} style={{ flexDirection: "row", borderTopWidth: 0.5, borderTopColor: gridCol }}>
      <Text style={[st.bold, { flex: 1, textAlign: "right", backgroundColor: strong ? accent : beige, color: strong ? color : "#7d6a5c", paddingHorizontal: 2 * MM, paddingVertical: strong ? 4 : 2.5, fontSize: strong ? fs + 1 : fs - 0.5, borderRightWidth: 0.5, borderRightColor: gridCol }]}>{k}</Text>
      <Text style={[st.bold, { width: 30 * MM, textAlign: "right", backgroundColor: strong ? accent : "#ffffff", color: strong ? color : "#2e2018", paddingHorizontal: 2 * MM, paddingVertical: strong ? 4 : 2.5, fontSize: strong ? fs + 2 : fs }]}>{formatMoney(v)} {cur}</Text>
    </View>
  );
  const gridboxTotals = (
    <View wrap={false} style={{ marginTop: 4 * MM, flexDirection: "row", borderWidth: 0.75, borderColor: gridCol }}>
      <View style={{ flex: 1, borderRightWidth: 0.5, borderRightColor: gridCol }}>
        <Text style={[st.bold, { backgroundColor: beige, color: "#7d6a5c", fontSize: fs - 0.5, paddingHorizontal: 2 * MM, paddingVertical: 2.5 }]}>{wordsLabel}</Text>
        <Text style={[st.bold, { color, paddingHorizontal: 2 * MM, paddingVertical: 2 * MM }]}>{wordsAmount}</Text>
      </View>
      <View style={{ width: 85 * MM, marginTop: -0.5 }}>
        {gbRow("TOTAL HT", data.totals.total_ht)}
        {(vatRows.length ? vatRows : [{ vat_rate_bp: 0, vat: 0 }]).map((g) => gbRow(vatRows.length ? `TVA ${formatRate(g.vat_rate_bp)}` : "TVA", g.vat))}
        {gbRow("TOTAL TTC", data.totals.total_ttc, true)}
      </View>
    </View>
  );
  const standardTotals = (
    <View wrap={false} style={{ marginTop: 5 * MM }}>
      {/* Ventilation par taux (gauche) et totaux (droite) côte à côte : la facture reste compacte. */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 6 * MM }}>
        {breakdown}
        <View style={[{ width: 78 * MM }, totalsBox]}>
          {totalLine("MONTANT HT", `${formatMoney(data.totals.total_ht)} ${cur}`)}
          {vatRows.length === 0 && totalLine("TVA", `${formatMoney(0)} ${cur}`)}
          {vatRows.map((g) => (
            <View key={g.vat_rate_bp}>{totalLine(`TVA ${formatRate(g.vat_rate_bp)}`, `${formatMoney(g.vat)} ${cur}`)}</View>
          ))}
          <View style={{ backgroundColor: look.totals === "plain" ? undefined : color, borderTopWidth: look.totals === "plain" ? 1.2 : 0, borderTopColor: color, marginTop: 2 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, paddingHorizontal: 6 }}>
              <Text style={[st.bold, { color: look.totals === "plain" ? color : "#ffffff", fontSize: fs + 1.5 }]}>TOTAL TTC</Text>
              <Text style={[st.bold, { color: look.totals === "plain" ? color : "#ffffff", fontSize: fs + 1.5 }]}>{formatMoney(data.totals.total_ttc)} {cur}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={{ marginTop: 5 * MM, paddingVertical: 2.5 * MM, paddingHorizontal: 3 * MM, backgroundColor: light }}>
        <Text style={[st.bold, { color: "#111111" }]}>{words}</Text>
      </View>
    </View>
  );

  const totals = look.totals === "stack" ? stackTotals : look.totals === "tiles" ? tilesTotals : look.totals === "gridbox" ? gridboxTotals : standardTotals;
  const itemsCount = data.lines.length;
  const docSummary = (
    <View wrap={false} style={{ marginTop: 4 * MM, flexDirection: "row", justifyContent: "flex-end" }}>
      <Text style={st.bold}>Nombre d'articles : {itemsCount}</Text>
    </View>
  );
  const totalsOrSummary = prices ? totals : docSummary;
  const signatures = doc?.kind === "BL" ? (
    <View wrap={false} style={{ marginTop: 6 * MM, flexDirection: "row", gap: 8 * MM }}>
      {["Signature du livreur", "Reçu par le client (cachet et signature)"].map((t) => (
        <View key={t} style={{ flex: 1, height: 26 * MM, borderWidth: 0.75, borderColor: mid, padding: 2 * MM }}>
          <Text style={[st.small, st.muted]}>{t}</Text>
          <Text style={[st.small, st.muted, { marginTop: 2 * MM }]}>Date : ____ / ____ / ________</Text>
        </View>
      ))}
    </View>
  ) : null;

  const boxHead = (t: string) => look.partiesStyle === "panel"
    ? <Text style={[st.bold, { fontSize: fs - 1.5, color, backgroundColor: soft, paddingHorizontal: 2 * MM, paddingVertical: 2 }]}>{t.toUpperCase()}</Text>
    : <Text style={[st.bold, { fontSize: fs - 1.5, color: "#4a4f57", paddingVertical: 2 }]}>{t.toUpperCase()}</Text>;
  const boxedExtras = (
    <View wrap={false} style={{ marginTop: 5 * MM, flexDirection: "row", gap: 3 * MM }}>
      <View style={{ flex: 1.7 }}>
        {boxHead(look.header === "bigtitle" ? "Conditions / Observations" : "Observations")}
        <View style={{ borderWidth: 0.75, borderColor: look.partiesStyle === "panel" ? mid : "#8f95a3", minHeight: 24 * MM, padding: 2 * MM }}>
          {s.showNotes && !!data.invoice.notes && <Text>{data.invoice.notes}</Text>}
          {!doc && !!c.show_bank && !!(c.bank_name || c.rib) && (
            <Text style={{ marginTop: 2 }}>{[c.bank_name, c.rib && `RIB : ${c.rib}`].filter(Boolean).join(" — ")}</Text>
          )}
          {data.invoice.status === "cancelled" && !!data.invoice.cancel_reason && (
            <Text style={{ color: "#b4372f", marginTop: 2 }}>Facture annulée — motif : {data.invoice.cancel_reason}</Text>
          )}
        </View>
      </View>
      {s.showSignatureBox && !signatures && (
        <View style={{ flex: 1 }}>
          {boxHead(look.header === "bigtitle" ? "Signature et cachet" : "Cachet et signature")}
          <View style={{ borderWidth: 0.75, borderColor: look.partiesStyle === "panel" ? mid : "#8f95a3", height: 24 * MM }} />
        </View>
      )}
    </View>
  );
  const visaHead = (t: string) => <Text style={[st.bold, { backgroundColor: beige, color, fontSize: fs - 1, textAlign: "center", paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: gridCol }]}>{t}</Text>;
  const visaExtras = (
    <View wrap={false} style={{ marginTop: 5 * MM }}>
      {s.showNotes && !!data.invoice.notes && <Text style={{ marginBottom: 2 * MM }}><Text style={[st.bold, { color }]}>Observations : </Text>{data.invoice.notes}</Text>}
      {!doc && !!c.show_bank && !!(c.bank_name || c.rib) && <Text style={{ marginBottom: 2 * MM }}>{[c.bank_name, c.rib && `RIB : ${c.rib}`].filter(Boolean).join(" — ")}</Text>}
      {data.invoice.status === "cancelled" && !!data.invoice.cancel_reason && <Text style={{ color: "#b4372f", marginBottom: 2 * MM }}>Facture annulée — motif : {data.invoice.cancel_reason}</Text>}
      {!signatures && (
        <View style={{ flexDirection: "row", borderWidth: 0.75, borderColor: gridCol }}>
          <View style={{ flex: 1, borderRightWidth: 0.5, borderRightColor: gridCol }}>{visaHead("VISA DU CLIENT")}<View style={{ height: 24 * MM }} /></View>
          {s.showSignatureBox && <View style={{ flex: 1.2 }}>{visaHead("CACHET ET SIGNATURE")}<View style={{ height: 24 * MM }} /></View>}
        </View>
      )}
    </View>
  );
  const extras = look.visaBox ? visaExtras : look.notesBoxes ? boxedExtras : (
    <View wrap={false} style={{ marginTop: 5 * MM, flexDirection: "row", gap: 8 * MM }}>
      <View style={{ flex: 1 }}>
        {s.showNotes && !!data.invoice.notes && (
          <View style={{ marginBottom: 3 * MM }}>
            <Text style={[st.small, st.muted]}>Observations</Text>
            <Text>{data.invoice.notes}</Text>
          </View>
        )}
        {!doc && !!c.show_bank && !!(c.bank_name || c.rib) && (
          <View>
            <Text style={[st.small, st.muted]}>Règlement par virement</Text>
            <Text>{[c.bank_name, c.rib && `RIB : ${c.rib}`].filter(Boolean).join(" — ")}</Text>
          </View>
        )}
        {data.invoice.status === "cancelled" && !!data.invoice.cancel_reason && (
          <Text style={{ color: "#b4372f", marginTop: 3 * MM }}>Facture annulée — motif : {data.invoice.cancel_reason}</Text>
        )}
      </View>
      {s.showSignatureBox && !signatures && (
        <View style={{ width: 62 * MM, height: 26 * MM, borderWidth: 0.75, borderColor: mid, padding: 2 * MM }}>
          <Text style={[st.small, st.muted]}>Cachet et signature</Text>
        </View>
      )}
    </View>
  );

  const footerIds = [c.legal_name, [c.address, c.city].filter(Boolean).join(", "), ...companyIds].filter(Boolean).join("  —  ");

  return (
    <Page size="A4" style={st.page} wrap>
      {data.background && (
        <Image fixed src={data.background} style={{ position: "absolute", top: 0, left: 0, width: 210 * MM, height: 297 * MM, opacity: s.backgroundOpacity }} />
      )}
      {look.pageStripe && (
        <View fixed style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 6 * MM, backgroundColor: color }} />
      )}
      {watermark && (
        <View fixed style={{ position: "absolute", top: 120 * MM, left: 0, right: 0, alignItems: "center" }}>
          <Text style={{ fontFamily: bold, fontSize: 34, color: data.invoice.status === "cancelled" ? "#b4372f" : "#9aa1a8", opacity: 0.18, transform: "rotate(-28deg)" }}>
            {watermark}
          </Text>
        </View>
      )}
      {s.headerText ? (
        <Text fixed style={{ position: "absolute", top: 5 * MM, left: s.marginSideMm * MM, right: s.marginSideMm * MM, fontSize: fs - 1.5, color: "#5b6168", textAlign: "center" }}>
          {s.headerText}
        </Text>
      ) : null}
      {/* En-tête courant des pages suivantes */}
      <Text
        fixed
        style={{ position: "absolute", top: (s.marginTopMm + s.headerSpaceMm - 7) * MM, left: s.marginSideMm * MM, right: s.marginSideMm * MM, fontSize: fs - 1, color: "#5b6168" }}
        render={({ pageNumber }) => (pageNumber > 1 ? `${c.legal_name} — ${runningLabel} ${data.invoice.number ?? "(brouillon)"} du ${formatDateFr(data.invoice.issue_date)} — ${data.client.name} (suite)` : "")}
      />

      {free ? (
        <>
          {freeBlocks}
          {freeSpacer}
          <View style={freeColumn}>
            <View>
              {tableHeader}
              {rows}
            </View>
            {totalsOrSummary}
            {extras}
            {signatures}
          </View>
        </>
      ) : (
        <>
          {header}
          {parties}
          <View>
            {tableHeader}
            {rows}
          </View>
          {totalsOrSummary}
          {extras}
          {signatures}
        </>
      )}

      {/* Pied de page */}
      {look.footerStyle === "band" ? (
        <View fixed style={{ position: "absolute", bottom: (s.marginBottomMm + s.footerSpaceMm) * MM, left: s.marginSideMm * MM, right: s.marginSideMm * MM, backgroundColor: dark, paddingVertical: 2.5 * MM, paddingHorizontal: 3 * MM, alignItems: "center" }}>
          <Text style={[st.bold, { color: "#ffffff", fontSize: fs - 0.5 }]}>{c.legal_name}{s.showLegalMentions && c.legal_mentions ? `  —  ${c.legal_mentions}` : ""}</Text>
          {!!(c.address || c.city) && <Text style={{ color: tint(color, 0.75), fontSize: fs - 1.5 }}>{[c.address, c.city].filter(Boolean).join(", ")}</Text>}
          {s.showFooterIds && companyIds.length > 0 && <Text style={{ color: tint(color, 0.75), fontSize: fs - 1.5 }}>{companyIds.join("   |   ")}</Text>}
          {s.footerText ? <Text style={{ color: tint(color, 0.75), fontSize: fs - 1.5 }}>{s.footerText}</Text> : null}
        </View>
      ) : look.footerStyle === "line" ? (
        <View fixed style={{ position: "absolute", bottom: (s.marginBottomMm + s.footerSpaceMm) * MM, left: s.marginSideMm * MM, right: s.marginSideMm * MM, borderTopWidth: look.accentGrid ? 1.2 : 0.8, borderTopColor: look.accentGrid ? color : "#4a4f57", paddingTop: 3, alignItems: "center" }}>
          <Text style={[st.bold, { color: look.accentGrid ? color : "#4a4f57", fontSize: fs - 1.5 }]}>{look.header === "centeredlogo" ? c.legal_name : [c.legal_name, [c.address, c.city].filter(Boolean).join(", ")].filter(Boolean).join("   ·   ")}</Text>
          {s.showFooterIds && companyIds.length > 0 && <Text style={{ color: "#6b7078", fontSize: fs - 1.5 }}>{companyIds.join("   ·   ")}</Text>}
          {s.showLegalMentions && c.legal_mentions ? <Text style={{ color: "#6b7078", fontSize: fs - 2 }}>{c.legal_mentions}</Text> : null}
          {s.footerText ? <Text style={{ color: "#6b7078", fontSize: fs - 2 }}>{s.footerText}</Text> : null}
        </View>
      ) : (
      <View fixed style={{ position: "absolute", bottom: (s.marginBottomMm + s.footerSpaceMm) * MM, left: s.marginSideMm * MM, right: s.marginSideMm * MM, borderTopWidth: s.showFooterIds || s.footerText ? 0.5 : 0, borderTopColor: "#c9ced4", paddingTop: 3 }}>
        {s.showLegalMentions && c.legal_mentions ? <Text style={{ fontSize: fs - 2, color: "#5b6168", textAlign: "center" }}>{c.legal_mentions}</Text> : null}
        {s.footerText ? <Text style={{ fontSize: fs - 2, color: "#5b6168", textAlign: "center" }}>{s.footerText}</Text> : null}
        {s.showFooterIds && <Text style={{ fontSize: fs - 2.5, color: "#5b6168", textAlign: "center" }}>{footerIds}</Text>}
      </View>
      )}
      {/* Numéro de page : Text « render » autonome positionné par « top » (react-pdf ignore ces Text
          lorsqu'ils sont imbriqués dans une View fixe ou positionnés par « bottom »). */}
      {s.showPageNumbers && (
        <Text
          fixed
          style={{ position: "absolute", top: PAGE_H - Math.max(4 * MM, (s.marginBottomMm + s.footerSpaceMm) * MM - 11) - (fs - 2.5) * 1.4, left: s.marginSideMm * MM, right: s.marginSideMm * MM, textAlign: "right", fontSize: fs - 2.5, color: "#5b6168" }}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`}
        />
      )}
    </Page>
  );
}
