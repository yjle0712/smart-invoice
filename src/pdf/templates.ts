import type { BlockPos, FreeBlock, TemplateBase, TemplateSettings } from "../lib/types";

/** Variantes visuelles : chaque modèle combine un style d'en-tête, de tableau et de totaux. */
export interface TemplateLook {
  header: "line" | "band" | "plain" | "boxed" | "split" | "centered" | "none" | "titlebox" | "bigtitle" | "centeredlogo";
  table: "grid" | "lines" | "striped" | "filled" | "minimal";
  totals: "box" | "plain" | "band" | "stack" | "tiles" | "gridbox";
  /** En-tête du tableau dans une teinte foncée de la couleur principale. */
  darkHeader?: boolean;
  /** Filets épais au-dessus et au-dessous de l'en-tête du tableau. */
  tableRules?: boolean;
  /** Colonne « total » légèrement teintée. */
  tintTotalCol?: boolean;
  /** Bloc client : « panel » (encadré teinté), « cards » (client + informations facture en lignes grisées). */
  partiesStyle?: "panel" | "cards" | "grid";
  /** Cadres du tableau dans la couleur secondaire. */
  accentGrid?: boolean;
  /** Cadres « Visa du client » et « Cachet et signature ». */
  visaBox?: boolean;
  /** Cadres « Observations » et « Cachet et signature » côte à côte. */
  notesBoxes?: boolean;
  /** Pied de page : bandeau de couleur ou filet. */
  footerStyle?: "band" | "line";
  pageStripe?: boolean;
  /** Couleur de fond des en-têtes de tableau (dérivée de la couleur principale si absente). */
  neutralHeader?: boolean;
}

export interface TemplatePreset {
  base: TemplateBase;
  label: string;
  description: string;
  look: TemplateLook;
  defaults: Partial<TemplateSettings>;
}

export const DEFAULT_SETTINGS: TemplateSettings = {
  color: "#1e504c",
  font: "Helvetica",
  fontSize: 9.5,
  marginTopMm: 14,
  marginSideMm: 15,
  marginBottomMm: 12,
  headerSpaceMm: 0,
  footerSpaceMm: 0,
  logoPosition: "left",
  logoHeightMm: 18,
  title: "FACTURE",
  headerText: "",
  footerText: "",
  showCompanyBlock: true,
  showCompanyIds: true,
  showClientAddress: true,
  showDueDate: true,
  showPaymentTerms: true,
  showPaymentMethod: true,
  accentColor: "",
  showGoodsNature: true,
  showDeliveryNote: true,
  showNotes: true,
  showVatBreakdown: true,
  showLegalMentions: true,
  showPageNumbers: true,
  showSignatureBox: false,
  showFooterIds: true,
  backgroundOpacity: 1,
  layoutMode: "standard",
  positions: {},
  headerStyle: "",
  tableStyle: "",
  totalsStyle: "",
  tableHeader: "",
  columns: "ttc",
  lineNumbers: false,
  showUnit: true,
  rowDensity: "normal",
};

/** Apparence effective : le modèle de base, modifié par les choix de l'utilisateur. */
export function resolveLook(base: TemplateBase, s: TemplateSettings): TemplateLook {
  const l = presetFor(base).look;
  return {
    ...l,
    header: s.headerStyle || l.header,
    table: s.tableStyle || l.table,
    totals: s.totalsStyle || l.totals,
    neutralHeader: s.tableHeader ? s.tableHeader === "neutral" : l.neutralHeader,
  };
}

/** Positions par défaut des blocs en disposition libre (mm, A4 = 210 × 297). */
export const DEFAULT_POSITIONS: Record<FreeBlock, BlockPos> = {
  company: { x: 15, y: 14, w: 95 },
  title: { x: 125, y: 44, w: 70 },
  client: { x: 15, y: 48, w: 95 },
  meta: { x: 125, y: 66, w: 70 },
  table: { x: 15, y: 100, w: 180 },
};

export const BLOCK_LABEL: Record<FreeBlock, string> = {
  company: "Bloc entreprise", title: "Titre, N° et date", client: "Client", meta: "Échéance, commande, nature", table: "Tableau et totaux",
};

export function resolvePositions(s: TemplateSettings): Record<FreeBlock, BlockPos> {
  const out = { ...DEFAULT_POSITIONS };
  for (const k of Object.keys(out) as FreeBlock[]) if (s.positions?.[k]) out[k] = { ...out[k], ...s.positions[k]! };
  return out;
}

export const TEMPLATE_PRESETS: TemplatePreset[] = [
  { base: "classic", label: "Classic", description: "Filet de couleur sous l'en-tête, tableau quadrillé.",
    look: { header: "line", table: "grid", totals: "box" }, defaults: { color: "#1e4f8a" } },
  { base: "minimal", label: "Minimal", description: "Sobre, sans aplats, filets fins.",
    look: { header: "plain", table: "minimal", totals: "plain", neutralHeader: true }, defaults: { color: "#3f3f46" } },
  { base: "modern", label: "Modern", description: "Bandeau de couleur pleine largeur.",
    look: { header: "band", table: "filled", totals: "band" }, defaults: { color: "#0f766e" } },
  { base: "elegant", label: "Elegant", description: "Typographie à empattements, logo centré.",
    look: { header: "centered", table: "lines", totals: "plain" }, defaults: { color: "#5b3a6e", font: "Times-Roman", fontSize: 10, logoPosition: "center" } },
  { base: "clean", label: "Clean", description: "Aéré, lignes horizontales uniquement.",
    look: { header: "plain", table: "lines", totals: "box" }, defaults: { color: "#2f7d4f", marginSideMm: 18 } },
  { base: "stripe", label: "Stripe", description: "Bande verticale de couleur, lignes alternées.",
    look: { header: "plain", table: "striped", totals: "box", pageStripe: true }, defaults: { color: "#b4372f", marginSideMm: 18 } },
  { base: "compact", label: "Compact", description: "Dense : idéal pour les factures longues.",
    look: { header: "line", table: "grid", totals: "box" }, defaults: { color: "#0e7490", fontSize: 8.5, marginTopMm: 10, marginBottomMm: 10, logoHeightMm: 13 } },
  { base: "gray", label: "Gray", description: "Tons gris neutres, bandeau discret.",
    look: { header: "band", table: "filled", totals: "box", neutralHeader: true }, defaults: { color: "#4b5563" } },
  { base: "accent", label: "Accent", description: "Titre affirmé, total mis en valeur.",
    look: { header: "split", table: "lines", totals: "band" }, defaults: { color: "#7c3aed" } },
  { base: "boxed", label: "Boxed", description: "Chaque bloc encadré.",
    look: { header: "boxed", table: "grid", totals: "box" }, defaults: { color: "#b45309" } },
  { base: "corporate", label: "Professional Corporate", description: "Institutionnel, cadre de signature.",
    look: { header: "split", table: "filled", totals: "box" }, defaults: { color: "#123c3a", showSignatureBox: true } },
  { base: "fercim", label: "FERCIM MAT", description: "Bleu marine : cadre titre avec N°, date et paiement, pied de page en bandeau.",
    look: { header: "titlebox", table: "striped", totals: "stack", darkHeader: true, tintTotalCol: true, partiesStyle: "panel", notesBoxes: true, footerStyle: "band" },
    defaults: { color: "#103a8a", fontSize: 9, logoHeightMm: 16, showSignatureBox: true, showFooterIds: true, showVatBreakdown: false } },
  { base: "novastro", label: "NOVASTRO BUSINESS", description: "Gris élégant : grand titre, informations facture en lignes, totaux en tuiles.",
    look: { header: "bigtitle", table: "lines", totals: "tiles", tableRules: true, tintTotalCol: true, partiesStyle: "cards", notesBoxes: true, footerStyle: "line" },
    defaults: { color: "#2e3238", fontSize: 9, logoHeightMm: 16, lineNumbers: true, showSignatureBox: true, showFooterIds: true, showVatBreakdown: false } },
  { base: "nord", label: "NORD BUSINESS JLE", description: "Brun et or : logo centré, titre espacé, tableau encadré, visa du client.",
    look: { header: "centeredlogo", table: "grid", totals: "gridbox", darkHeader: false, tintTotalCol: true, partiesStyle: "grid", notesBoxes: true, visaBox: true, accentGrid: true, footerStyle: "line" },
    defaults: { color: "#5c3a21", accentColor: "#d9a066", fontSize: 9, logoHeightMm: 22, logoPosition: "center", showSignatureBox: true, showFooterIds: true, showVatBreakdown: false } },
  { base: "entete", label: "Papier à en-tête", description: "Votre papier à en-tête (image ou PDF) en fond de page.",
    look: { header: "none", table: "grid", totals: "box" },
    defaults: { color: "#1e504c", headerSpaceMm: 38, footerSpaceMm: 15, showCompanyBlock: false, showFooterIds: false, logoPosition: "none" } },
];

export function presetFor(base: TemplateBase): TemplatePreset {
  return TEMPLATE_PRESETS.find((p) => p.base === base) ?? TEMPLATE_PRESETS[0];
}

export function resolveSettings(base: TemplateBase, overrides?: Partial<TemplateSettings> | null): TemplateSettings {
  return { ...DEFAULT_SETTINGS, ...presetFor(base).defaults, ...(overrides ?? {}) };
}

/** Éclaircit une couleur hex (mélange avec du blanc). */
export function tint(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#f1f5f9";
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/** Assombrit une couleur hex (mélange avec du noir). */
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#1f2328";
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c * (1 - amount));
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
