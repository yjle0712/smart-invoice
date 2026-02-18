// ========================= PART 1/4 =========================
// App.tsx (1/4) — Imports + types + helpers + storage (unified)
// -------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import JSZip from "jszip";
import { saveAs } from "file-saver";
// note: docx import only used if you enable Word export later
import { Document as DocxDocument, Packer, Paragraph, TextRun } from "docx";

// ===================== Types =====================
type Product = { label: string; price: number; quantity: number };
type Categories = Record<string, Product[]>;

type Company = {
  name: string;
  address: string;
  ICE: string;
  RC: string;
  IF: string;
  TP: string;
  logo: string; // dataURL
};

type Customer = {
  name: string;
  ICE: string;
  address: string;
  lastInvoiceNumber?: string; // e.g. "NOV0100/2025A"
};

type ModelName =
  | "ENTETE"
  | "Classique"
  | "Minimal"
  | "Modern"
  | "Elegant"
  | "Clean"
  | "Stripe"
  | "Compact"
  | "Gray"
  | "Accent"
  | "Boxed";

type TemplateProps = {
  invoice: any;
  color: string;
  watermarkEnabled: boolean;
  watermarkText: string;
  tvaRate: number;
  layout: LayoutSpec;
  bgImage?: string | null;
  showCompanyBlock?: boolean;
  cardOpacity?: number;
  liftInfo?: number;
};

type LayoutSpec = {
  topFixedPct: number;
  infoBlockPct: number;
  tableBlockPct: number;
  bottomFixedPct: number;
  contentInsetMM: number;
};

// =============== Defaults ===============
const DEFAULT_LAYOUT: LayoutSpec = {
  topFixedPct: 30,
  infoBlockPct: 20,
  tableBlockPct: 35,
  bottomFixedPct: 15,
  contentInsetMM: 12,
};

const PAGE_W_MM = 210;
const PAGE_H_MM = 297;

// ألوان افتراضية للقوالب
const DEFAULT_COLORS: Record<string, string> = {
  ENTETE: "#0ea5e9",
  Classique: "#2a7ae2",
  Minimal: "#555555",
  Modern: "#c8a200",
  Elegant: "#7b4ab5",
  Clean: "#2f855a",
  Stripe: "#ef4444",
  Compact: "#0ea5e9",
  Gray: "#6b7280",
  Accent: "#8b5cf6",
  Boxed: "#f59e0b",
};

// ===================== LocalStorage Keys =====================
const LS_KEYS = {
  COMPANIES: "inv_companies_v2",
  CUSTOMERS: "inv_customers_v2",
  CATEGORIES: "inv_categories_v2",
  MODEL_COLORS: "inv_model_colors_v2",
  LAST_SETTINGS: "inv_last_settings_v2",
  TEMPLATE_BG: "inv_template_bg_v2",
  LAYOUTS: "inv_layouts_v2",
};

// ===================== Storage helpers =====================
const readLS = <T,>(k: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return fallback;
    const val = JSON.parse(raw);
    return (val ?? fallback) as T;
  } catch {
    return fallback;
  }
};
const writeLS = (k: string, v: any) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

// ===================== Number → French words =====================
const numberToFrenchWords = (num: number): string => {
  const toInt = (n: number) => Math.floor(Math.abs(n));
  const under20 = [
    "zéro","un","deux","trois","quatre","cinq","six","sept","huit","neuf",
    "dix","onze","douze","treize","quatorze","quinze","seize","dix-sept","dix-huit","dix-neuf",
  ];
  const tens = ["","","vingt","trente","quarante","cinquante","soixante","soixante","quatre-vingt","quatre-vingt"];
  const wordsUnder100 = (n: number): string => {
    if (n < 20) return under20[n];
    const t = Math.floor(n / 10), r = n % 10;
    if (t === 7 || t === 9) return tens[t] + (r ? "-" + under20[10 + r] : "-dix");
    if (t === 8 && r === 0) return "quatre-vingts";
    return tens[t] + (r ? "-" + under20[r] : "");
  };
  const wordsUnder1000 = (n: number): string => {
    if (n < 100) return wordsUnder100(n);
    const h = Math.floor(n / 100), r = n % 100;
    const hWord = h === 1 ? "cent" : under20[h] + " cent";
    return hWord + (r ? " " + wordsUnder100(r) : h > 1 ? "s" : "");
  };
  if (num === 0) return "ZÉRO DIRHAMS";
  const intPart = toInt(num);
  const parts: string[] = [];
  const millions = Math.floor(intPart / 1_000_000);
  const thousands = Math.floor((intPart % 1_000_000) / 1000);
  const rest = intPart % 1000;
  if (millions) parts.push((millions === 1 ? "un" : wordsUnder1000(millions)) + " million" + (millions > 1 ? "s" : ""));
  if (thousands) parts.push(thousands === 1 ? "mille" : wordsUnder1000(thousands) + " mille");
  if (rest) parts.push(wordsUnder1000(rest));
  const cents = Math.round((Math.abs(num) - intPart) * 100);
  return (parts.join(" ") + " dirhams" + (cents ? " et " + cents + " centimes" : "")).toUpperCase();
};

// ===================== Date helpers =====================
const dayMs = 86400000;
const pad2 = (n: number) => String(n).padStart(2, "0");
const formatDMY = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;

/** توزيع ذكي على كامل المدة مع تباعد (لمنع التسلسل اليومي) */
const generateAdaptiveDates = (from: string, to: string, totalTarget: number): string[] => {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!from || !to || isNaN(start) || isNaN(end) || end <= start) return [];
  const totalDays = Math.max(1, Math.floor((end - start) / dayMs));
  const avgInvoice = 4400;
  const baseCount = Math.max(2, Math.round(totalTarget / avgInvoice));
  const count = Math.min(baseCount, totalDays);

  const points: number[] = [];
  for (let i = 0; i < count; i++) {
    const ratio = count === 1 ? 0 : i / (count - 1);
    const base = start + ratio * (end - start);
    const jitter = (Math.random() - 0.5) * 3 * dayMs; // ±3 أيام
    const t = Math.min(Math.max(start, base + jitter), end);
    points.push(Math.round(t / dayMs) * dayMs);
  }
  const uniq = Array.from(new Set(points)).sort((a, b) => a - b);
  return uniq.map((t) => formatDMY(new Date(t)));
};

// ===================== Invoice number helpers =====================
const parseInvoiceNo = (s: string | undefined | null) => {
  if (!s) return null;
  const m = s.match(/^([A-Z\-]{0,8}?)(\d{1,8})\/?(\d{4})?([A-Z])?$/i);
  if (!m) return null;
  const [, letters, digits, year, suffix] = m;
  return { letters, serial: parseInt(digits || "0", 10), year: year || null, suffix: suffix || null };
};
const buildInvoiceNo = (letters: string, serial: number, yearOpt?: string | null, suffix?: string | null) => {
  const pref = (letters || "").toUpperCase();
  const num = String(Math.max(0, serial)).padStart(4, "0");
  const y = yearOpt && yearOpt.trim() ? `/${yearOpt.trim()}` : "";
  const suf = suffix && suffix.trim() ? `${suffix.trim().toUpperCase()}` : "";
  return `${pref}${num}${y}${suf}`;
};

// ===================== Small UI helper =====================
const Field: React.FC<React.PropsWithChildren<{ label?: string; style?: React.CSSProperties }>> = ({ label, style, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
    {label && <label style={{ fontSize: 12, color: "#333" }}>{label}</label>}
    {children}
  </div>
);

// ===================== Totals calc =====================
const calcTotals = (items: any[], tvaRate: number) => {
  const totalTTC = items.reduce((s: number, it: any) => s + it.price * it.quantity, 0);
  const montantHT = totalTTC / (1 + tvaRate / 100);
  const tva = totalTTC - montantHT;
  return { totalTTC, montantHT, tva };
};

const Watermark: React.FC<{ text: string }> = ({ text }) =>
  !text ? null : (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%) rotate(-30deg)",
        fontSize: "48pt",
        fontWeight: 800,
        color: "rgba(128,128,128,0.10)",
        userSelect: "none",
        pointerEvents: "none",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </div>
  );

const buildDefaultLayouts = () => {
  const base: Record<string, LayoutSpec> = {};
  (Object.keys(DEFAULT_COLORS) as ModelName[]).forEach((m) => {
    base[m] = DEFAULT_LAYOUT;
  });
  return base;
};

// ========================= end PART 1/4 =========================
// ========================= PART 2/4 =========================
// App.tsx (2/4) — Blocks + Tables + Templates + layout logic
// ---------------------------------------------------------------------------

const BrandBlock: React.FC<{ company: Company; color: string }> = ({ company, color }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
    {company?.logo ? (
      <img src={company.logo} alt="logo" style={{ width: 120, height: 60, objectFit: "contain" }} />
    ) : (
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{company?.name || ""}</div>
    )}
    <div style={{ fontSize: 12, color: "#555" }}>
      <div>{company?.address}</div>
      <div>
        ICE: {company?.ICE} &nbsp;|&nbsp; RC: {company?.RC} &nbsp;|&nbsp; IF: {company?.IF} &nbsp;|&nbsp; TP: {company?.TP}
      </div>
    </div>
  </div>
);

const LinesTable: React.FC<{ invoice: any; color?: string; card?: boolean }> = ({ invoice, color, card }) => (
  <table
    style={{
      width: "100%",
      borderCollapse: "collapse",
      fontSize: 12,
      marginTop: 8,
      background: card ? "rgba(255,255,255,0.06)" : "transparent",
      borderRadius: card ? 8 : 0,
      overflow: "hidden",
    }}
  >
    <thead style={{ background: card ? "rgba(0,0,0,0.06)" : "#f7fbff", color: color || "#333" }}>
      <tr>
        <th style={{ border: "1px solid #ddd", padding: 6, textAlign: "left" }}>DÉSIGNATION</th>
        <th style={{ border: "1px solid #ddd", padding: 6, textAlign: "center", width: "12%" }}>QTE</th>
        <th style={{ border: "1px solid #ddd", padding: 6, textAlign: "right", width: "18%" }}>PRIX U TTC</th>
        <th style={{ border: "1px solid #ddd", padding: 6, textAlign: "right", width: "18%" }}>TOTAL TTC</th>
      </tr>
    </thead>
    <tbody>
      {(invoice.items || []).map((it: any, i: number) => (
        <tr key={i}>
          <td style={{ border: "1px solid #eee", padding: 6 }}>{it.label}</td>
          <td style={{ border: "1px solid #eee", textAlign: "center" }}>{it.quantity}</td>
          <td style={{ border: "1px solid #eee", textAlign: "right" }}>{Number(it.price).toFixed(2)}</td>
          <td style={{ border: "1px solid #eee", textAlign: "right" }}>{(Number(it.price) * Number(it.quantity)).toFixed(2)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const LettersBlock: React.FC<{ total: number; color: string }> = ({ total, color }) => (
  <div style={{ marginTop: 8, color, fontWeight: 700, fontSize: 12 }}>
    ARRÊTÉ LA PRÉSENTE FACTURE À LA SOMME DE : {numberToFrenchWords(Math.round(total))}
  </div>
);

const FooterBlock: React.FC<{ company: Company; color: string; bigger?: boolean }> = ({ company, color, bigger }) => (
  <div
    style={{
      position: "absolute",
      bottom: "8mm",
      left: "10mm",
      right: "10mm",
      textAlign: "center",
      fontSize: bigger ? 12.5 : 11,
      color,
      fontWeight: 700,
    }}
  >
    {company?.name} — {company?.address} — ICE {company?.ICE} — RC {company?.RC} — IF {company?.IF} — TP {company?.TP}
  </div>
);

function toSlots(layout: LayoutSpec) {
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const top = clamp(layout.topFixedPct, 0, 40);
  const bottom = clamp(layout.bottomFixedPct, 0, 40);
  let info = clamp(layout.infoBlockPct, 5, 40);
  let table = clamp(layout.tableBlockPct, 10, 60);
  const sum = top + bottom + info + table;
  if (sum > 100) {
    const extra = sum - 100;
    const cutFromTable = Math.min(extra, table - 10);
    table -= cutFromTable;
    const remaining = extra - cutFromTable;
    if (remaining > 0) info = Math.max(5, info - remaining);
  }
  const toMM = (pct: number) => (pct / 100) * PAGE_H_MM;
  return { topMM: toMM(top), infoMM: toMM(info), tableMM: toMM(table), bottomMM: toMM(bottom) };
}

const TemplateENTETE: React.FC<TemplateProps> = ({
  invoice,
  color,
  watermarkEnabled,
  watermarkText,
  tvaRate,
  layout,
  bgImage,
  cardOpacity = 0.22,
  liftInfo = 6,
}) => {
  const { totalTTC, montantHT, tva } = calcTotals(invoice.items, tvaRate);
  const { topMM, infoMM, tableMM, bottomMM } = toSlots(layout);
  const inset = layout.contentInsetMM;

  const contentTop = topMM + liftInfo;
  const contentBottom = PAGE_H_MM - bottomMM;
  const infoTop = contentTop + inset;
  const infoHeight = Math.max(8, infoMM - inset * 0.5);

  const infoCardStyle: React.CSSProperties = {
    background: `rgba(255,255,255,${cardOpacity})`,
    backdropFilter: "blur(8px)",
    border: "1px solid rgba(255,255,255,0.35)",
    boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
    borderRadius: 14,
    padding: "8mm",
  };

  const tableTop = infoTop + infoHeight + 4;
  const tableHeight = Math.max(30, tableMM - inset);
  const bottomTextTop = Math.min(contentBottom - inset - 14, tableTop + tableHeight + 6);

  return (
    <div
      id={invoice.__domId || `facture-${invoice.invoiceNumber}`}
      style={{
        width: "210mm",
        height: "297mm",
        margin: "0 auto 20px",
        background: "#000",
        position: "relative",
        overflow: "hidden",
        fontFamily: "Tahoma, Arial, sans-serif",
      }}
    >
      {bgImage && (
        <img
          src={bgImage}
          alt="template bg"
          style={{
            position: "absolute",
            inset: 0,
            width: "210mm",
            height: "297mm",
            objectFit: "cover",
            pointerEvents: "none",
            userSelect: "none",
            opacity: 1,
          }}
        />
      )}

      {watermarkEnabled && <Watermark text={watermarkText} />}

      <div
        style={{
          position: "absolute",
          left: layout.contentInsetMM + "mm",
          right: layout.contentInsetMM + "mm",
          top: infoTop + "mm",
        }}
      >
        <div style={infoCardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 13, color: "#111" }}>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>{invoice.customer?.name || "CLIENT"}</div>

              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ minWidth: 80, fontWeight: 700 }}>CLIENT :</div>
                <div style={{ flex: 1 }}>{invoice.customer?.name || "—"}</div>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ minWidth: 80, fontWeight: 700 }}>ICE :</div>
                <div style={{ flex: 1 }}>{invoice.customer?.ICE || "—"}</div>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ minWidth: 80, fontWeight: 700 }}>ADRESSE :</div>
                <div style={{ flex: 1 }}>{invoice.customer?.address || "—"}</div>
              </div>
            </div>

            <div style={{ textAlign: "right", color }}>
              <div style={{ fontSize: 20, fontWeight: 800 }}>FACTURE</div>
              <div>
                N°: <strong>{invoice.invoiceNumber}</strong>
              </div>
              <div>Date: {invoice.date}</div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: layout.contentInsetMM + "mm",
          right: layout.contentInsetMM + "mm",
          top: tableTop + "mm",
          maxHeight: Math.max(30, contentBottom - tableTop - 28) + "mm",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            background: `rgba(255,255,255,${Math.max(0.12, cardOpacity - 0.06)})`,
            backdropFilter: "blur(6px)",
            border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: 12,
            padding: "6mm",
          }}
        >
          <LinesTable invoice={invoice} color={color} card />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <table style={{ width: "60%", fontSize: 12 }}>
              <tbody>
                <tr>
                  <td>MONTANT HT</td>
                  <td style={{ textAlign: "right" }}>{montantHT.toFixed(2)} DHS</td>
                </tr>
                <tr>
                  <td>TVA {tvaRate}%</td>
                  <td style={{ textAlign: "right" }}>{tva.toFixed(2)} DHS</td>
                </tr>
                <tr style={{ fontWeight: 700, color }}>
                  <td>TOTAL TTC</td>
                  <td style={{ textAlign: "right" }}>{totalTTC.toFixed(2)} DHS</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: layout.contentInsetMM + "mm",
          right: layout.contentInsetMM + "mm",
          top: bottomTextTop + "mm",
        }}
      >
        <div
          style={{
            background: `rgba(255,255,255,${Math.max(0.08, cardOpacity - 0.14)})`,
            borderRadius: 10,
            padding: "4mm 6mm",
            border: "1px solid rgba(255,255,255,0.3)",
          }}
        >
          <LettersBlock total={totalTTC} color={color} />
        </div>
      </div>
    </div>
  );
};

const TemplateClassique: React.FC<TemplateProps> = ({ invoice, color, watermarkEnabled, watermarkText, tvaRate, layout, bgImage }) => {
  const { totalTTC, montantHT, tva } = calcTotals(invoice.items, tvaRate);
  const { topMM, infoMM, tableMM, bottomMM } = toSlots(layout);
  const inset = layout.contentInsetMM;
  const infoTop = topMM + inset;
  const tableTop = infoTop + infoMM - 2;
  const bottomTextTop = Math.min(PAGE_H_MM - bottomMM - 12, tableTop + tableMM - 2);

  return (
    <div
      id={invoice.__domId || `facture-${invoice.invoiceNumber}`}
      style={{
        width: "210mm",
        height: "297mm",
        background: "#fff",
        margin: "0 auto 20px",
        padding: 0,
        border: "1px solid #cfcfcf",
        boxSizing: "border-box",
        position: "relative",
        display: "block",
        fontFamily: "Tahoma, Arial, sans-serif",
      }}
    >
      {bgImage && (
        <img
          src={bgImage}
          alt="bg"
          style={{ position: "absolute", inset: 0, width: "210mm", height: "297mm", objectFit: "cover", opacity: 0.12, pointerEvents: "none" }}
        />
      )}
      {watermarkEnabled && <Watermark text={watermarkText} />}

      <div
        style={{
          position: "absolute",
          left: inset + "mm",
          right: inset + "mm",
          top: infoTop + "mm",
          display: "flex",
          justifyContent: "space-between",
          paddingBottom: 6,
          borderBottom: `4px solid ${color}`,
        }}
      >
        <BrandBlock company={invoice.company} color={color} />
        <div style={{ textAlign: "right", color }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>FACTURE</div>
          <div>
            N°: <strong>{invoice.invoiceNumber}</strong>
          </div>
          <div>Date: {invoice.date}</div>
        </div>
      </div>

      <div style={{ position: "absolute", left: inset + "mm", right: inset + "mm", top: infoTop + 18 + "mm", fontSize: 13, padding: "4mm 0", borderBottom: "1px solid #ddd" }}>
        <strong style={{ color }}>{invoice.customer?.name || "CLIENT"}</strong>
        <br />
        ICE : {invoice.customer?.ICE || "—"}
        <br />
        {invoice.customer?.address || ""}
      </div>

      <div style={{ position: "absolute", left: inset + "mm", right: inset + "mm", top: tableTop + "mm" }}>
        <LinesTable invoice={invoice} color={color} />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <table style={{ width: "60%", fontSize: 12 }}>
            <tbody>
              <tr>
                <td>MONTANT HT</td>
                <td style={{ textAlign: "right" }}>{montantHT.toFixed(2)} DHS</td>
              </tr>
              <tr>
                <td>TVA {tvaRate}%</td>
                <td style={{ textAlign: "right" }}>{tva.toFixed(2)} DHS</td>
              </tr>
              <tr style={{ fontWeight: 700, color }}>
                <td>TOTAL TTC</td>
                <td style={{ textAlign: "right" }}>{totalTTC.toFixed(2)} DHS</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ position: "absolute", left: inset + "mm", right: inset + "mm", top: bottomTextTop + "mm" }}>
        <LettersBlock total={totalTTC} color={color} />
      </div>

      <FooterBlock company={invoice.company} color={color} bigger />
    </div>
  );
};

const TemplateMinimal: React.FC<TemplateProps> = (p) => baseSimpleTemplate(p, "minimal");
const TemplateModern: React.FC<TemplateProps> = (p) => baseSimpleTemplate(p, "modern");
const TemplateElegant: React.FC<TemplateProps> = (p) => baseSimpleTemplate(p, "elegant");
const TemplateClean: React.FC<TemplateProps> = (p) => baseSimpleTemplate(p, "clean");
const TemplateStripe: React.FC<TemplateProps> = (p) => baseSimpleTemplate(p, "stripe");
const TemplateCompact: React.FC<TemplateProps> = (p) => baseSimpleTemplate(p, "compact");
const TemplateGray: React.FC<TemplateProps> = (p) => baseSimpleTemplate(p, "gray");
const TemplateAccent: React.FC<TemplateProps> = (p) => baseSimpleTemplate(p, "accent");
const TemplateBoxed: React.FC<TemplateProps> = (p) => baseSimpleTemplate(p, "boxed");

function baseSimpleTemplate({ invoice, color, watermarkEnabled, watermarkText, tvaRate, layout, bgImage }: TemplateProps, variant: string) {
  const { totalTTC, montantHT, tva } = calcTotals(invoice.items, tvaRate);
  const { topMM, infoMM, tableMM, bottomMM } = toSlots(layout);
  const inset = layout.contentInsetMM;
  const headerTop = topMM + inset;
  const clientTop = headerTop + 18;
  const tableTop = headerTop + infoMM - 2;
  const bottomTextTop = Math.min(PAGE_H_MM - bottomMM - 12, tableTop + tableMM - 2);

  const headBorder = variant === "minimal" ? `2px solid ${color}` : variant === "stripe" ? `0` : `3px solid ${color}`;

  return (
    <div
      id={invoice.__domId || `facture-${invoice.invoiceNumber}`}
      style={{
        width: "210mm",
        height: "297mm",
        background: "#fff",
        margin: "0 auto 20px",
        border: "1px solid #e6e6e6",
        position: "relative",
        fontFamily: "Tahoma, Arial, sans-serif",
      }}
    >
      {bgImage && (
        <img src={bgImage} alt="bg" style={{ position: "absolute", inset: 0, width: "210mm", height: "297mm", objectFit: "cover", opacity: 0.08, pointerEvents: "none" }} />
      )}
      {watermarkEnabled && <Watermark text={watermarkText} />}

      <div
        style={{
          position: "absolute",
          left: inset + "mm",
          right: inset + "mm",
          top: headerTop + "mm",
          paddingBottom: 6,
          borderBottom: headBorder,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <BrandBlock company={invoice.company} color={color} />
        <div style={{ textAlign: "right", color }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>FACTURE</div>
          <div>
            N°: <strong>{invoice.invoiceNumber}</strong>
          </div>
          <div>Date: {invoice.date}</div>
        </div>
      </div>

      <div style={{ position: "absolute", left: inset + "mm", right: inset + "mm", top: clientTop + "mm", fontSize: 13 }}>
        <b>Client:</b> {invoice.customer?.name} &nbsp;&nbsp;|&nbsp;&nbsp; ICE: {invoice.customer?.ICE}
        <br />
        {invoice.customer?.address}
      </div>

      <div style={{ position: "absolute", left: inset + "mm", right: inset + "mm", top: tableTop + "mm" }}>
        <LinesTable invoice={invoice} color={color} />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <table style={{ width: "60%", fontSize: 12 }}>
            <tbody>
              <tr>
                <td>MONTANT HT</td>
                <td style={{ textAlign: "right" }}>{montantHT.toFixed(2)} DHS</td>
              </tr>
              <tr>
                <td>TVA {tvaRate}%</td>
                <td style={{ textAlign: "right" }}>{tva.toFixed(2)} DHS</td>
              </tr>
              <tr style={{ fontWeight: 700, color }}>
                <td>TOTAL TTC</td>
                <td style={{ textAlign: "right" }}>{totalTTC.toFixed(2)} DHS</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ position: "absolute", left: inset + "mm", right: inset + "mm", top: bottomTextTop + "mm" }}>
        <LettersBlock total={totalTTC} color={color} />
      </div>

      <FooterBlock company={invoice.company} color={color} bigger />
    </div>
  );
}

// ========================= end PART 2/4 =========================
// ========================= PART 3/4 =========================
// App.tsx (3/4) — Wrapper + selectors + background upload + persistence + PDF helper
// ----------------------------------------------------------------------------------

const InvoiceTemplateWrapper: React.FC<TemplateProps & { model: ModelName }> = (props) => {
  const { model } = props;
  switch (model) {
    case "ENTETE": return <TemplateENTETE {...props} showCompanyBlock={false} />;
    case "Minimal": return <TemplateMinimal {...props} />;
    case "Modern": return <TemplateModern {...props} />;
    case "Elegant": return <TemplateElegant {...props} />;
    case "Clean": return <TemplateClean {...props} />;
    case "Stripe": return <TemplateStripe {...props} />;
    case "Compact": return <TemplateCompact {...props} />;
    case "Gray": return <TemplateGray {...props} />;
    case "Accent": return <TemplateAccent {...props} />;
    case "Boxed": return <TemplateBoxed {...props} />;
    default: return <TemplateClassique {...props} />;
  }
};

const CompanySelector: React.FC<{
  companies: Company[];
  selected: Company;
  onSelect: (c: Company) => void;
  onSaveNew: (c: Company) => void;
}> = ({ companies, selected, onSelect, onSaveNew }) => {
  const [local, setLocal] = useState<Company>(selected);
  useEffect(() => setLocal(selected), [selected]);

  const choose = (name: string) => {
    const found = companies.find((c) => c.name === name);
    if (found) onSelect(found);
  };

  const save = () => {
    if (!local.name.trim()) {
      alert("Nom société requis.");
      return;
    }
    onSaveNew(local);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
      <div style={{ gridColumn: "1 / span 3", display: "flex", gap: 8, alignItems: "center" }}>
        <select value={selected?.name || ""} onChange={(e) => choose(e.target.value)} style={{ padding: 8, minWidth: 240 }}>
          <option value="">— Choisir une société —</option>
          {companies.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <button onClick={() => onSelect({ name: "", address: "", ICE: "", RC: "", IF: "", TP: "", logo: "" })}>➕ Nouvelle</button>
      </div>

      <Field label="Nom"><input value={local.name} onChange={(e) => setLocal({ ...local, name: e.target.value })} /></Field>
      <Field label="Adresse"><input value={local.address} onChange={(e) => setLocal({ ...local, address: e.target.value })} /></Field>
      <Field label="ICE"><input value={local.ICE} onChange={(e) => setLocal({ ...local, ICE: e.target.value })} /></Field>

      <Field label="RC"><input value={local.RC} onChange={(e) => setLocal({ ...local, RC: e.target.value })} /></Field>
      <Field label="IF"><input value={local.IF} onChange={(e) => setLocal({ ...local, IF: e.target.value })} /></Field>
      <Field label="TP"><input value={local.TP} onChange={(e) => setLocal({ ...local, TP: e.target.value })} /></Field>

      <Field label="Logo (image)">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = (ev) => setLocal({ ...local, logo: ev.target?.result as string });
            r.readAsDataURL(f);
          }}
        />
      </Field>

      <div style={{ gridColumn: "1 / span 3", display: "flex", gap: 8 }}>
        <button onClick={save}>💾 Enregistrer / Mettre à jour</button>
      </div>
    </div>
  );
};

const CustomerSelector: React.FC<{
  customers: Customer[];
  selected: Customer;
  onSelect: (c: Customer) => void;
  onSaveNew: (c: Customer) => void;
  onAutofillInvoiceStart: (letters: string, serial: number, year: string | null, suffix?: string | null) => void;
}> = ({ customers, selected, onSelect, onSaveNew, onAutofillInvoiceStart }) => {
  const [local, setLocal] = useState<Customer>(selected);
  useEffect(() => setLocal(selected), [selected]);

  const choose = (name: string) => {
    const found = customers.find((c) => c.name === name);
    if (found) {
      onSelect(found);
      if (found.lastInvoiceNumber) {
        const parsed = parseInvoiceNo(found.lastInvoiceNumber);
        if (parsed) {
          const nextSerial = parsed.serial + (2 + Math.floor(Math.random() * 4));
          onAutofillInvoiceStart(parsed.letters || "", nextSerial, parsed.year || null, parsed.suffix || null);
        }
      }
    }
  };

  const save = () => {
    if (!local.name.trim() || !local.ICE.trim()) {
      alert("Nom client et ICE requis.");
      return;
    }
    onSaveNew(local);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
      <div style={{ gridColumn: "1 / span 3", display: "flex", gap: 8, alignItems: "center" }}>
        <select value={selected?.name || ""} onChange={(e) => choose(e.target.value)} style={{ padding: 8, minWidth: 240 }}>
          <option value="">— Choisir un client —</option>
          {customers.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <button onClick={() => onSelect({ name: "", ICE: "", address: "" })}>➕ Nouveau</button>
      </div>

      <Field label="Nom du client"><input value={local.name} onChange={(e) => setLocal({ ...local, name: e.target.value })} /></Field>
      <Field label="ICE du client"><input value={local.ICE} onChange={(e) => setLocal({ ...local, ICE: e.target.value })} /></Field>
      <Field label="Adresse du client"><input value={local.address} onChange={(e) => setLocal({ ...local, address: e.target.value })} /></Field>

      <div style={{ gridColumn: "1 / span 3", display: "flex", gap: 8 }}>
        <button onClick={save}>💾 Enregistrer / Mettre à jour</button>
      </div>
    </div>
  );
};

async function pdfFileToImageDataURL(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf");
  const workerSrc = await import("pdfjs-dist/legacy/build/pdf.worker");
  (pdfjs as any).GlobalWorkerOptions.workerSrc = (workerSrc as any).default;

  const buf = await file.arrayBuffer();
  const task = (pdfjs as any).getDocument({ data: buf });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2.0 });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/png", 0.95);
}

async function fileToDataURL(file: File): Promise<string> {
  if (file.type === "application/pdf") {
    return await pdfFileToImageDataURL(file);
  }
  return await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ========================= end PART 3/4 =========================
// ========================= PART 4/4 =========================
// App.tsx (4/4) — Main App: UI + generate + download + constraints
// ---------------------------------------------------------------------------------------

const MAX_PER_INVOICE = 4900;
const MAX_PER_DAY = 5000;
const MAX_PER_MONTH = 50000;

export default function App() {
  const [companies, setCompanies] = useState<Company[]>(() => readLS<Company[]>(LS_KEYS.COMPANIES, []));
  const [customers, setCustomers] = useState<Customer[]>(() => readLS<Customer[]>(LS_KEYS.CUSTOMERS, []));
  const [categories, setCategories] = useState<Categories>(() => readLS<Categories>(LS_KEYS.CATEGORIES, { Produits: [] }));

  const [modelColors, setModelColors] = useState<Record<string, string>>(
    () => ({ ...DEFAULT_COLORS, ...readLS(LS_KEYS.MODEL_COLORS, {}) })
  );

  const [layouts, setLayouts] = useState<Record<string, LayoutSpec>>(() => {
    const saved = readLS<Record<string, LayoutSpec>>(LS_KEYS.LAYOUTS, {});
    const base = buildDefaultLayouts();
    (Object.keys(base) as ModelName[]).forEach((m) => {
      base[m] = saved[m] || DEFAULT_LAYOUT;
    });
    return base;
  });

  const [templateBg, setTemplateBg] = useState<Record<string, string | null>>(() => readLS<Record<string, string | null>>(LS_KEYS.TEMPLATE_BG, {}));

  const last = readLS(LS_KEYS.LAST_SETTINGS, {
    dateFrom: "",
    dateTo: "",
    invoiceLetters: "",
    invoiceStartNumber: "",
    invoiceYearOpt: "",
    invoiceSuffix: "",
    totalAmount: 30000,
    tvaRate: 20,
    model: "ENTETE",
    watermarkEnabled: true,
    cardOpacity: 0.22,
    liftInfo: 6,
    itemMode: "multi4",
  });

  const [company, setCompany] = useState<Company>(() => companies[0] || { name: "", address: "", ICE: "", RC: "", IF: "", TP: "", logo: "" });
  const [customer, setCustomer] = useState<Customer>(() => customers[0] || { name: "", ICE: "", address: "" });

  const [dateFrom, setDateFrom] = useState(last.dateFrom || "");
  const [dateTo, setDateTo] = useState(last.dateTo || "");
  const [invoiceLetters, setInvoiceLetters] = useState(last.invoiceLetters || "");
  const [invoiceStartNumber, setInvoiceStartNumber] = useState(last.invoiceStartNumber || "");
  const [invoiceYearOpt, setInvoiceYearOpt] = useState<string>(last.invoiceYearOpt || "");
  const [invoiceSuffix, setInvoiceSuffix] = useState<string>(last.invoiceSuffix || "");
  const [totalAmount, setTotalAmount] = useState<number>(last.totalAmount || 30000);
  const [tvaRate, setTvaRate] = useState<number>(last.tvaRate || 20);
  const [selectedCategory, setSelectedCategory] = useState<string>(() => Object.keys(categories)[0] || "Produits");
  const [model, setModel] = useState<ModelName>((last.model as ModelName) || "ENTETE");
  const [watermarkEnabled, setWatermarkEnabled] = useState<boolean>(last.watermarkEnabled ?? true);

  const [cardOpacity, setCardOpacity] = useState<number>(typeof last.cardOpacity === "number" ? last.cardOpacity : 0.22);
  const [liftInfo, setLiftInfo] = useState<number>(typeof last.liftInfo === "number" ? last.liftInfo : 6);

  type ItemMode = "single" | "multi2" | "multi3" | "multi4";
  const [itemMode, setItemMode] = useState<ItemMode>((last.itemMode as ItemMode) || "multi4");

  const [invoices, setInvoices] = useState<any[]>([]);
  const currentItems: Product[] = categories[selectedCategory] || [];

  // ======= Persist =======
  useEffect(() => writeLS(LS_KEYS.COMPANIES, companies), [companies]);
  useEffect(() => writeLS(LS_KEYS.CUSTOMERS, customers), [customers]);
  useEffect(() => writeLS(LS_KEYS.CATEGORIES, categories), [categories]);
  useEffect(() => writeLS(LS_KEYS.MODEL_COLORS, modelColors), [modelColors]);
  useEffect(() => writeLS(LS_KEYS.TEMPLATE_BG, templateBg), [templateBg]);
  useEffect(() => writeLS(LS_KEYS.LAYOUTS, layouts), [layouts]);

  useEffect(() => {
    writeLS(LS_KEYS.LAST_SETTINGS, {
      dateFrom,
      dateTo,
      invoiceLetters,
      invoiceStartNumber,
      invoiceYearOpt,
      invoiceSuffix,
      totalAmount,
      tvaRate,
      model,
      watermarkEnabled,
      cardOpacity,
      liftInfo,
      itemMode,
    });
  }, [dateFrom, dateTo, invoiceLetters, invoiceStartNumber, invoiceYearOpt, invoiceSuffix, totalAmount, tvaRate, model, watermarkEnabled, cardOpacity, liftInfo, itemMode]);

  // ======= Handlers =======
  const handleSelectCompany = (c: Company) => setCompany(c);
  const handleSaveCompany = (c: Company) => {
    setCompanies((prev) => {
      const exists = prev.findIndex((p) => p.name === c.name);
      const next = [...prev];
      if (exists >= 0) next[exists] = c;
      else next.push(c);
      return next;
    });
    setCompany(c);
  };

  const handleSelectCustomer = (c: Customer) => setCustomer(c);
  const handleSaveCustomer = (c: Customer) => {
    setCustomers((prev) => {
      const exists = prev.findIndex((p) => p.name === c.name);
      const next = [...prev];
      if (exists >= 0) next[exists] = { ...next[exists], ...c };
      else next.push(c);
      return next;
    });
    setCustomer(c);
  };

  const handleAutofillInvoiceStart = (letters: string, serial: number, year: string | null, suffix?: string | null) => {
    setInvoiceLetters(letters || "");
    setInvoiceStartNumber(String(serial || 1));
    if (year) setInvoiceYearOpt(year);
    if (suffix) setInvoiceSuffix(suffix);
  };

  // ======= Categories =======
  const addCategory = () => {
    const name = (prompt("Nom de la catégorie:") || "").trim();
    if (!name) return;
    if (categories[name]) return alert("Cette catégorie existe déjà.");
    const next: Categories = { ...categories, [name]: [] };
    setCategories(next);
    setSelectedCategory(name);
  };

  const addProductToCurrent = () => {
    if (!selectedCategory) return alert("Ajoutez ou sélectionnez une catégorie d'abord.");
    const next: Categories = { ...categories };
    next[selectedCategory] = [...(next[selectedCategory] || []), { label: "", price: 0, quantity: 1 }];
    setCategories(next);
  };

  const updateProduct = (idx: number, patch: Partial<Product>) => {
    const next: Categories = { ...categories };
    const arr = [...(next[selectedCategory] || [])];
    arr[idx] = { ...arr[idx], ...patch };
    next[selectedCategory] = arr;
    setCategories(next);
  };

  const removeProduct = (idx: number) => {
    const next: Categories = { ...categories };
    const arr = [...(next[selectedCategory] || [])];
    next[selectedCategory] = arr.filter((_, i) => i !== idx);
    setCategories(next);
  };

  // ======= Colors =======
  const handleColorChange = (mdl: string, hex: string) => setModelColors((prev) => ({ ...prev, [mdl]: hex }));
  const resetDefaultColors = () => setModelColors({ ...DEFAULT_COLORS });

  // ======= Background upload per template =======
  const onUploadBackground = async (file: File) => {
    try {
      const dataURL = await fileToDataURL(file);
      setTemplateBg((prev) => ({ ...prev, [model]: dataURL }));
    } catch {
      alert("Échec de تحويل/قراءة الملف.");
    }
  };
  const clearBackground = () => setTemplateBg((prev) => ({ ...prev, [model]: null }));

  // ======= Layout controls per template =======
  const layout = layouts[model] || DEFAULT_LAYOUT;
  const setLayout = (patch: Partial<LayoutSpec>) => setLayouts((prev) => ({ ...prev, [model]: { ...layout, ...patch } }));

  // ======= Reset settings (appearance + last settings) =======
  const resetSettings = () => {
    try {
      localStorage.removeItem(LS_KEYS.LAST_SETTINGS);
      localStorage.removeItem(LS_KEYS.MODEL_COLORS);
      localStorage.removeItem(LS_KEYS.TEMPLATE_BG);
      localStorage.removeItem(LS_KEYS.LAYOUTS);
    } catch {}

    setModelColors({ ...DEFAULT_COLORS });
    setTemplateBg({});
    setLayouts(buildDefaultLayouts());
    setInvoices([]);

    // reset runtime settings
    setDateFrom("");
    setDateTo("");
    setInvoiceLetters("");
    setInvoiceStartNumber("");
    setInvoiceYearOpt("");
    setInvoiceSuffix("");
    setTotalAmount(30000);
    setTvaRate(20);
    setModel("ENTETE");
    setWatermarkEnabled(true);
    setCardOpacity(0.22);
    setLiftInfo(6);
    setItemMode("multi4");

    alert("✅ Settings reset.");
  };

  // ======= Generate invoices =======
  const generateInvoices = () => {
    if (!dateFrom || !dateTo || !customer.name || !customer.ICE) {
      alert("Veuillez remplir les champs requis (dates, client nom + ICE).");
      return;
    }

    const rawCatalog = (categories[selectedCategory] || [])
      .filter((p) => p.label.trim() && p.price > 0)
      .map((p) => ({ label: p.label.trim(), price: Math.abs(p.price) }));

    if (!rawCatalog.length) {
      alert("Ajoutez au moins un produit (prix > 0) dans la catégorie sélectionnée.");
      return;
    }

    // ✅ Your rules:
    const MIN_TTC = 3000;
    const MAX_TTC = MAX_PER_INVOICE; // 4900
    const LOW_MAX = 3999;
    const HIGH_MIN = 4000;
    const HIGH_MAX = MAX_TTC;
    const LOW_RATIO = 0.20; // 20% فقط أقل من 4000
    const MAX_QTY = 999;

    // usable products
    const catalog = rawCatalog.filter((p) => Math.ceil(MIN_TTC / p.price) <= Math.min(MAX_QTY, Math.floor(MAX_TTC / p.price)));
    if (!catalog.length) {
      alert("Aucun produit ne يمكنه تحقيق 3000..4900 DHS حتى مع الكميات.");
      return;
    }

    const fromTs = new Date(dateFrom).getTime();
    const toTs = new Date(dateTo).getTime();
    if (!(toTs > fromTs)) {
      alert("La date 'À' doit être après 'De'.");
      return;
    }

    const datePool = generateAdaptiveDates(dateFrom, dateTo, totalAmount);
    if (!datePool.length) {
      alert("Aucune date valide trouvée dans l'intervalle.");
      return;
    }

    const theoreticalMax = datePool.length * MAX_TTC;

    // ✅ allow only +500..+1500 over total
    const allowedOver = 500 + Math.random() * 1000; // 500..1500
    const wishedTarget = Math.round((totalAmount + allowedOver) * 100) / 100;
    const targetTotal = Math.min(wishedTarget, theoreticalMax);

    const invoicesOut: any[] = [];
    let serial = Number(invoiceStartNumber) || 1;
    let sum = 0;

    const dayTotals: Record<string, number> = {};
    const monthTotals: Record<string, number> = {};

    const canPlaceInvoiceOnDate = (dateStr: string, amount: number) => {
      const dParts = dateStr.split("/").map(Number);
      const dayKey = `${pad2(dParts[0])}/${pad2(dParts[1])}/${dParts[2]}`;
      const monthKey = `${pad2(dParts[1])}-${dParts[2]}`;
      const daySum = (dayTotals[dayKey] || 0) + amount;
      const monthSum = (monthTotals[monthKey] || 0) + amount;
      return daySum <= MAX_PER_DAY && monthSum <= MAX_PER_MONTH;
    };

    const pickMaxByMode = (mode: ItemMode) => (mode === "single" ? 1 : mode === "multi2" ? 2 : mode === "multi3" ? 3 : 4);

    for (let i = 0; i < datePool.length && sum < targetTotal; i++) {
      const dateStr = datePool[i];

      const remainingBudget = targetTotal - sum;
      if (remainingBudget < MIN_TTC) break;

      // ✅ random item count (1..maxByMode) => as you want
      const maxPick = Math.min(pickMaxByMode(itemMode), catalog.length);
      const pickCount = 1 + Math.floor(Math.random() * maxPick);
      const picks = [...catalog].sort(() => Math.random() - 0.5).slice(0, pickCount);

      if (!picks.length) continue;

      // ✅ choose low or high invoice, but respect remainingBudget
      let wantLow = remainingBudget < HIGH_MIN ? true : Math.random() < LOW_RATIO;

      let lower = wantLow ? MIN_TTC : HIGH_MIN;
      let upper = wantLow ? Math.min(LOW_MAX, remainingBudget, MAX_TTC) : Math.min(HIGH_MAX, remainingBudget, MAX_TTC);

      // if high impossible due to remainingBudget, force low
      if (upper < lower) {
        wantLow = true;
        lower = MIN_TTC;
        upper = Math.min(LOW_MAX, remainingBudget, MAX_TTC);
        if (upper < lower) break;
      }

      let targetTTC = lower + Math.random() * (upper - lower);

      let attemptOk = false;
      let items: { label: string; price: number; quantity: number }[] = [];

      for (let attempt = 0; attempt < 10 && !attemptOk; attempt++) {
        items = [];
        let remaining = targetTTC;

        for (let k = 0; k < picks.length; k++) {
          const p = picks[k];
          const share =
            k === picks.length - 1
              ? remaining
              : Math.max(300, remaining * (0.20 + Math.random() * 0.45)); // توزيع عشوائي
          let q = Math.max(1, Math.round(share / p.price));
          q = Math.min(q, MAX_QTY);
          items.push({ label: p.label, price: p.price, quantity: q });
          remaining -= p.price * q;
        }

        const sumItems = (arr: typeof items) => arr.reduce((s, it) => s + it.price * it.quantity, 0);
        let ttc = sumItems(items);

        // adjust last item to fit range
        const lastIt = items[items.length - 1];

        if (ttc < lower) {
          const need = lower - ttc;
          const addQ = Math.ceil(need / lastIt.price);
          lastIt.quantity = Math.min(MAX_QTY, lastIt.quantity + addQ);
        } else if (ttc > upper) {
          const over = ttc - upper;
          const decQ = Math.ceil(over / lastIt.price);
          lastIt.quantity = Math.max(1, lastIt.quantity - decQ);
        }

        ttc = sumItems(items);

        if (ttc >= lower && ttc <= upper && canPlaceInvoiceOnDate(dateStr, ttc)) {
          attemptOk = true;
        } else {
          // push target slightly toward feasible zone
          targetTTC = Math.max(lower, Math.min(upper, targetTTC - 120 + Math.random() * 240));
        }
      }

      if (!attemptOk) continue;

      const yearPart = (invoiceYearOpt || "").trim() || null;
      const invNo = buildInvoiceNo(invoiceLetters, serial, yearPart, invoiceSuffix || null);

      const ttcFinal = items.reduce((s, it) => s + it.price * it.quantity, 0);

      const dParts = dateStr.split("/").map(Number);
      const dayKey = `${pad2(dParts[0])}/${pad2(dParts[1])}/${dParts[2]}`;
      const monthKey = `${pad2(dParts[1])}-${dParts[2]}`;
      dayTotals[dayKey] = (dayTotals[dayKey] || 0) + ttcFinal;
      monthTotals[monthKey] = (monthTotals[monthKey] || 0) + ttcFinal;

      const invModel = model; // the selected model at generation time

      invoicesOut.push({
        company,
        customer,
        invoiceNumber: invNo,
        date: dateStr,
        items,
        model: invModel,
        color: (modelColors as any)[invModel] || "#2a7ae2",
        watermarkEnabled,
        watermarkText: company.name || "",
        tvaRateUsed: tvaRate,
      });

      serial += Math.floor(Math.random() * 4) + 2;
      sum = Math.round((sum + ttcFinal) * 100) / 100;
    }

    if (!invoicesOut.length) {
      alert("Impossible de générer des factures dans les contraintes définies (limites jour/mois أو المنتجات).");
      return;
    }

    invoicesOut.sort((a, b) => {
      const [da, ma, ya] = a.date.split("/").map(Number);
      const [db, mb, yb] = b.date.split("/").map(Number);
      return new Date(ya, ma - 1, da).getTime() - new Date(yb, mb - 1, db).getTime();
    });

    let serialFix = Number(invoiceStartNumber) || 1;
    for (let i = 0; i < invoicesOut.length; i++) {
      invoicesOut[i].invoiceNumber = buildInvoiceNo(invoiceLetters, serialFix, invoiceYearOpt || null, invoiceSuffix || null);
      serialFix += Math.floor(Math.random() * 4) + 2;
    }

    setInvoices(invoicesOut);

    const lastInvNo = invoicesOut[invoicesOut.length - 1]?.invoiceNumber;
    if (lastInvNo) {
      setCustomers((prev) => {
        const idx = prev.findIndex((c) => c.name === customer.name);
        const next = [...prev];
        if (idx >= 0) next[idx] = { ...next[idx], lastInvoiceNumber: lastInvNo };
        else next.push({ ...customer, lastInvoiceNumber: lastInvNo });
        return next;
      });
    }

    alert(`✅ Total généré : ${sum.toFixed(2)} DHS (هدفك ${totalAmount} + زيادة 500..1500 فقط)`);
  };

  // ======= Downloads =======
  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

  const downloadAllAsZIP = async () => {
    if (!invoices.length) return alert("Aucune facture à télécharger.");
    const zip = new JSZip();
    const folder = zip.folder("factures")!;
    let index = 1;

    for (let i = 0; i < invoices.length; i++) {
      const inv = invoices[i];
      const domId = inv.__domId || `facture-${inv.invoiceNumber || "NA"}-${i}`;
      const el = document.getElementById(domId);
      if (!el) continue;
      await sleep(120);
      try {
        const canvas = await html2canvas(el, { scale: 2, useCORS: true });
        const imgData = canvas.toDataURL("image/jpeg", 0.9);
        const pdf = new jsPDF("p", "mm", "a4");
        pdf.addImage(imgData, "JPEG", 0, 0, 210, 297);
        folder.file(`${inv.invoiceNumber || `facture_${index}`}.pdf`, pdf.output("blob"));
        index++;
      } catch (err) {
        console.error("Erreur PDF:", err);
      }
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    saveAs(zipBlob, `factures_${company.name || "societe"}.zip`);
  };

  const downloadAllAsSinglePDF = async () => {
    if (!invoices.length) return alert("Aucune facture à télécharger.");
    const pdf = new jsPDF("p", "mm", "a4");

    for (let i = 0; i < invoices.length; i++) {
      const inv = invoices[i];
      const domId = inv.__domId || `facture-${inv.invoiceNumber || "NA"}-${i}`;
      const el = document.getElementById(domId);
      if (!el) continue;

      const canvas = await html2canvas(el, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL("image/jpeg", 0.9);
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, 0, 210, 297);
    }

    pdf.save(`factures_${company.name || "societe"}.pdf`);
  };

  // ======= UI =======
  return (
    <div style={{ padding: 20, background: "#eef1f5", fontFamily: "Tahoma, Arial, sans-serif" }}>
      <h1>🧾 Générateur de factures — smart-invoice (ENTETE par défaut)</h1>

      <div style={{ background: "#fff", padding: 15, borderRadius: 8, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, color: "#333" }}>
          ✅ Distribution prix: <b>20%</b> (3000..3999) و <b>80%</b> (4000..4900) — احترام 5000/اليوم و 50000/الشهر
        </div>
        <button onClick={resetSettings} style={{ background: "#111", color: "#fff", padding: "8px 12px", borderRadius: 6 }}>
          RESET SETTINGS
        </button>
      </div>

      {/* Apparence + قالب + خلفية */}
      <div style={{ background: "#fff", padding: 15, borderRadius: 8, marginBottom: 12 }}>
        <h3>Modèle de facture & Apparence</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 12, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label>Modèle :</label>
            <select value={model} onChange={(e) => setModel(e.target.value as ModelName)} style={{ padding: 6, minWidth: 200 }}>
              <option>ENTETE</option>
              <option>Classique</option>
              <option>Minimal</option>
              <option>Modern</option>
              <option>Elegant</option>
              <option>Clean</option>
              <option>Stripe</option>
              <option>Compact</option>
              <option>Gray</option>
              <option>Accent</option>
              <option>Boxed</option>
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label>Couleur :</label>
            <input
              type="color"
              value={modelColors[model] || "#2a7ae2"}
              onChange={(e) => handleColorChange(model, e.target.value)}
              style={{ width: 46, height: 28, padding: 0, border: "none", background: "transparent", cursor: "pointer" }}
            />
            <div style={{ width: 36, height: 24, background: modelColors[model] || "#2a7ae2", borderRadius: 4, border: "1px solid #999" }} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {model === "ENTETE" && (
              <>
                <label>Transparence (card):</label>
                <input type="range" min={0.06} max={0.4} step={0.01} value={cardOpacity} onChange={(e) => setCardOpacity(parseFloat(e.target.value))} />
                <label>Lever info (mm):</label>
                <input type="number" value={liftInfo} onChange={(e) => setLiftInfo(Math.max(0, parseFloat(e.target.value) || 0))} style={{ width: 70 }} />
              </>
            )}
          </div>

          <div>
            <button onClick={resetDefaultColors}>🔁 Réinitialiser couleurs</button>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
          <Field label="Arrière-plan (PDF ou Image)">
            <input
              type="file"
              accept="application/pdf,image/*"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                await onUploadBackground(f);
              }}
            />
          </Field>
          <button onClick={clearBackground}>🗑️ Supprimer le fond</button>
          {templateBg[model] && <span style={{ color: "#0a0" }}>Fond chargé ✔</span>}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label>Watermark (nom société) :</label>
            <input type="checkbox" checked={watermarkEnabled} onChange={(e) => setWatermarkEnabled(e.target.checked)} />
          </div>
        </div>
      </div>

      {/* Layout */}
      <div style={{ background: "#fff", padding: 15, borderRadius: 8, marginBottom: 12 }}>
        <h3>Contrôle القياسات (Top / Info / Table / Bottom) — {model}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10 }}>
          <Field label="Top fixe (%)">
            <input type="number" min={0} max={40} value={layout.topFixedPct} onChange={(e) => setLayout({ topFixedPct: Math.max(0, Math.min(40, parseFloat(e.target.value) || 0)) })} />
          </Field>
          <Field label="Info (%)">
            <input type="number" min={5} max={40} value={layout.infoBlockPct} onChange={(e) => setLayout({ infoBlockPct: Math.max(5, Math.min(40, parseFloat(e.target.value) || 0)) })} />
          </Field>
          <Field label="Table (%)">
            <input type="number" min={10} max={60} value={layout.tableBlockPct} onChange={(e) => setLayout({ tableBlockPct: Math.max(10, Math.min(60, parseFloat(e.target.value) || 0)) })} />
          </Field>
          <Field label="Bottom fixe (%)">
            <input type="number" min={0} max={40} value={layout.bottomFixedPct} onChange={(e) => setLayout({ bottomFixedPct: Math.max(0, Math.min(40, parseFloat(e.target.value) || 0)) })} />
          </Field>
          <Field label="Marge interne (mm)">
            <input type="number" min={6} max={20} value={layout.contentInsetMM} onChange={(e) => setLayout({ contentInsetMM: Math.max(6, Math.min(20, parseFloat(e.target.value) || 0)) })} />
          </Field>
        </div>
      </div>

      {/* Société */}
      <div style={{ background: "#fff", padding: 15, borderRadius: 8, marginBottom: 16 }}>
        <h3>Société</h3>
        <CompanySelector companies={companies} selected={company} onSelect={handleSelectCompany} onSaveNew={handleSaveCompany} />
      </div>

      {/* Client */}
      <div style={{ background: "#fff", padding: 15, borderRadius: 8, marginBottom: 16 }}>
        <h3>Client</h3>
        <CustomerSelector
          customers={customers}
          selected={customer}
          onSelect={handleSelectCustomer}
          onSaveNew={handleSaveCustomer}
          onAutofillInvoiceStart={handleAutofillInvoiceStart}
        />
      </div>

      {/* Catégories */}
      <div style={{ background: "#fff", padding: 15, borderRadius: 8, marginBottom: 12 }}>
        <h3>Catégorie de produits</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc", minWidth: 240 }}>
            {Object.keys(categories).map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select>
          <button onClick={addCategory}>➕ Ajouter une catégorie</button>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label>Mode articles (حد أقصى):</label>
            <select value={itemMode} onChange={(e) => setItemMode(e.target.value as any)} style={{ padding: 6 }}>
              <option value="single">حتى 1</option>
              <option value="multi2">حتى 2</option>
              <option value="multi3">حتى 3</option>
              <option value="multi4">حتى 4</option>
            </select>
          </div>
        </div>

        <h4 style={{ marginTop: 12 }}>Produits: {selectedCategory}</h4>
        {currentItems.map((it, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, marginBottom: 6 }}>
            <input placeholder="DÉSIGNATION" value={it.label} onChange={(e) => updateProduct(i, { label: e.target.value })} />
            <input type="number" placeholder="PRIX UNIT TTC" value={it.price} onChange={(e) => updateProduct(i, { price: Math.max(0, parseFloat(e.target.value) || 0) })} />
            <input type="number" placeholder="QTE (défaut)" value={it.quantity} onChange={(e) => updateProduct(i, { quantity: Math.max(1, parseFloat(e.target.value) || 1) })} />
            <button onClick={() => removeProduct(i)}>🗑️</button>
          </div>
        ))}
        <button onClick={addProductToCurrent}>➕ Ajouter un produit</button>
      </div>

      {/* Paramètres */}
      <div style={{ background: "#fff", padding: 15, borderRadius: 8, marginBottom: 16 }}>
        <h3>Paramètres</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(8,1fr)", gap: 8 }}>
          <Field label="De"><input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></Field>
          <Field label="À"><input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></Field>
          <Field label="Préfixe lettres (ex: NOV)"><input value={invoiceLetters} onChange={(e) => setInvoiceLetters(e.target.value.toUpperCase())} /></Field>
          <Field label="N° départ (auto)"><input value={invoiceStartNumber} onChange={(e) => setInvoiceStartNumber(e.target.value)} /></Field>
          <Field label="Année (option)"><input placeholder="ex: 2025 — laisser فارغ" value={invoiceYearOpt} onChange={(e) => setInvoiceYearOpt(e.target.value)} /></Field>
          <Field label="Suffix (lettre)"><input placeholder="ex: A — laisser فارغ" value={invoiceSuffix} onChange={(e) => setInvoiceSuffix(e.target.value.toUpperCase())} /></Field>
          <Field label="TVA (%)"><input type="number" value={tvaRate} onChange={(e) => setTvaRate(Math.max(0, parseFloat(e.target.value) || 0))} /></Field>
          <Field label="Montant total TTC"><input type="number" value={totalAmount} onChange={(e) => setTotalAmount(Math.max(0, parseFloat(e.target.value) || 0))} /></Field>
        </div>

        <div style={{ marginTop: 12 }}>
          <button onClick={generateInvoices} style={{ marginRight: 8 }}>Générer les factures</button>
          <button onClick={downloadAllAsZIP} disabled={!invoices.length}>📦 Télécharger (ZIP)</button>
          <button onClick={downloadAllAsSinglePDF} disabled={!invoices.length} style={{ marginLeft: 8 }}>🧾 Télécharger (PDF unique)</button>
        </div>
      </div>

      {/* Render invoices */}
      {invoices.map((inv, i) => {
        const invModel = (inv.model as ModelName) || model;
        const domId = `facture-${inv.invoiceNumber || "NA"}-${i}`;
        return (
          <InvoiceTemplateWrapper
            key={`${inv.invoiceNumber}-${i}`}
            model={invModel}
            invoice={{ ...inv, __domId: domId }}
            color={modelColors[invModel] || "#2a7ae2"}
            watermarkEnabled={!!inv.watermarkEnabled}
            watermarkText={inv.watermarkText || ""}
            tvaRate={inv.tvaRateUsed ?? tvaRate}
            layout={layouts[invModel] || DEFAULT_LAYOUT}
            bgImage={templateBg[invModel] || undefined}
            cardOpacity={cardOpacity}
            liftInfo={liftInfo}
            showCompanyBlock={invModel !== "ENTETE"}
          />
        );
      })}
    </div>
  );
}

// ========================= end PART 4/4 =========================
