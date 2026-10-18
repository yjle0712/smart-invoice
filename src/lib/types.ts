/** Types des tables Supabase (voir supabase/migrations). Montants en centimes, taux en points de base. */

export type MemberRole = "admin" | "comptable" | "utilisateur";
export type InvoiceStatus = "draft" | "validated" | "partially_paid" | "paid" | "cancelled";
export type PartyKind = "client" | "supplier";
export type RoundingMode = "per_rate" | "per_line";
export type CurrencyLabel = "DH" | "DHS" | "MAD";

export interface Company {
  id: string;
  legal_name: string;
  ice: string | null;
  if_number: string | null;
  rc: string | null;
  tp: string | null;
  cnss: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  logo_path: string | null;
  bank_name: string | null;
  rib: string | null;
  show_phone: boolean;
  show_email: boolean;
  show_bank: boolean;
  vat_rates_bp: number[];
  default_vat_rate_bp: number;
  rounding_mode: RoundingMode;
  require_client_ice: boolean;
  allow_discounts: boolean;
  currency_label: CurrencyLabel;
  default_payment_terms: string | null;
  default_due_days: number;
  legal_mentions: string | null;
  default_template_id: string | null;
  is_demo: boolean;
  vat_period: "mensuel" | "trimestriel";
  vat_regime: "encaissement" | "debit";
  default_purchase_rubrique: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyWithRole extends Company {
  role: MemberRole;
}

export interface Member {
  company_id: string;
  user_id: string;
  role: MemberRole;
  created_at: string;
  profiles: { email: string; full_name: string | null } | null;
}

export interface Party {
  id: string;
  company_id: string;
  kind: PartyKind;
  name: string;
  ice: string | null;
  if_number: string | null;
  rc: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  payment_terms: string | null;
  notes: string | null;
  /** Série de numérotation propre au client (sinon série par défaut de l'entreprise). */
  default_series_id: string | null;
  archived: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  company_id: string;
  name: string;
}

export interface Product {
  id: string;
  company_id: string;
  reference: string;
  designation: string;
  category_id: string | null;
  unit: string;
  unit_price_ttc: number;
  vat_rate_bp: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PriceHistory {
  id: number;
  product_id: string;
  old_price_ttc: number | null;
  new_price_ttc: number;
  old_vat_rate_bp: number | null;
  new_vat_rate_bp: number;
  changed_by: string | null;
  changed_at: string;
}

export interface NumberSeries {
  id: string;
  company_id: string;
  name: string;
  format: string;
  next_seq: number;
  reset_yearly: boolean;
  current_year: number | null;
  is_default: boolean;
}

export interface InvoiceTemplateRow {
  id: string;
  company_id: string;
  name: string;
  base: TemplateBase;
  settings: Partial<TemplateSettings>;
  background_path: string | null;
  updated_at: string;
}

export interface VatBreakdownRow {
  vat_rate_bp: number;
  base_ht: number;
  vat: number;
  ttc: number;
}

export interface PartySnapshot {
  name: string;
  ice: string | null;
  if_number: string | null;
  rc: string | null;
  address: string | null;
  city: string | null;
}

export interface Invoice {
  id: string;
  company_id: string;
  series_id: string | null;
  number: string | null;
  seq: number | null;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string | null;
  client_id: string | null;
  client_snapshot: PartySnapshot | null;
  company_snapshot: Partial<Company> | null;
  order_ref: string | null;
  delivery_note_ref: string | null;
  payment_terms: string | null;
  payment_method: string | null;
  goods_nature: string | null;
  notes: string | null;
  template_id: string | null;
  total_ht: number;
  total_vat: number;
  total_ttc: number;
  vat_breakdown: VatBreakdownRow[];
  amount_paid: number;
  corrects_invoice_id: string | null;
  is_demo: boolean;
  validated_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  company_id: string;
  position: number;
  product_id: string | null;
  designation: string;
  unit: string | null;
  quantity: number;
  unit_price_ttc: number;
  catalog_price_ttc: number | null;
  price_override_reason: string | null;
  vat_rate_bp: number;
  discount_bp: number;
  total_ttc: number;
  total_ht: number;
  total_vat: number;
}

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  paid_at: string;
  method: "virement" | "cheque" | "especes" | "effet" | "carte" | "autre";
  reference: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  company_id: string | null;
  user_id: string | null;
  table_name: string;
  record_id: string | null;
  action: "insert" | "update" | "delete";
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  at: string;
}

// ---------------------------------------------------------------------
// Modèles de factures
// ---------------------------------------------------------------------
export type TemplateBase =
  | "classic" | "minimal" | "modern" | "elegant" | "clean" | "stripe"
  | "compact" | "gray" | "accent" | "boxed" | "corporate" | "fercim" | "novastro" | "nord" | "entete";

export type PdfFont = "Helvetica" | "Times-Roman" | "Courier";

export interface TemplateSettings {
  color: string;
  font: PdfFont;
  fontSize: number;
  marginTopMm: number;
  marginSideMm: number;
  marginBottomMm: number;
  /** Espace réservé en haut de page (papier à en-tête ou fond « entete »). */
  headerSpaceMm: number;
  footerSpaceMm: number;
  logoPosition: "left" | "right" | "center" | "none";
  logoHeightMm: number;
  title: string;
  headerText: string;
  footerText: string;
  showCompanyBlock: boolean;
  showCompanyIds: boolean;
  showClientAddress: boolean;
  showDueDate: boolean;
  showPaymentTerms: boolean;
  showPaymentMethod: boolean;
  /** Couleur secondaire ("" = dérivée de la couleur principale). */
  accentColor: string;
  showGoodsNature: boolean;
  showDeliveryNote: boolean;
  showNotes: boolean;
  showVatBreakdown: boolean;
  showLegalMentions: boolean;
  showPageNumbers: boolean;
  showSignatureBox: boolean;
  showFooterIds: boolean;
  backgroundOpacity: number;
  /** « free » : blocs d'en-tête positionnés librement (glisser-déposer), en mm depuis le coin haut gauche. */
  layoutMode: "standard" | "free";
  positions: Partial<Record<FreeBlock, BlockPos>>;
  /** Style choisi par l'utilisateur ("" = celui du modèle). */
  headerStyle: "" | "line" | "band" | "plain" | "boxed" | "split" | "centered" | "none" | "titlebox" | "bigtitle" | "centeredlogo";
  tableStyle: "" | "grid" | "lines" | "striped" | "filled" | "minimal";
  totalsStyle: "" | "box" | "plain" | "band" | "stack" | "tiles" | "gridbox";
  tableHeader: "" | "color" | "neutral";
  /** Colonnes de prix : TTC, HT, ou détaillé (HT + TVA + TTC). */
  columns: "ttc" | "ht" | "full";
  lineNumbers: boolean;
  showUnit: boolean;
  rowDensity: "compact" | "normal" | "airy";
}

export type FreeBlock = "title" | "company" | "client" | "meta" | "table";
export interface BlockPos { x: number; y: number; w: number }

// ---------------------------------------------------------------------
// Journal TVA
// ---------------------------------------------------------------------
export type VatEntryKind = "sale" | "purchase";
export type VatEntryStatus = "to_review" | "validated" | "rejected";
export type PaymentMode = "especes" | "cheque" | "prelevement" | "virement" | "effet" | "compensation" | "carte" | "autre";

export interface VatRate { rate_bp: number; ht: number | null; vat: number | null; ttc: number | null }

export interface VatEntry {
  id: string;
  company_id: string;
  kind: VatEntryKind;
  status: VatEntryStatus;
  source: "import" | "manual";
  import_id: string | null;
  source_file: string | null;
  page_from: number | null;
  page_to: number | null;
  invoice_number: string | null;
  invoice_date: string | null;
  party_id: string | null;
  party_name: string | null;
  party_ice: string | null;
  party_if: string | null;
  goods_nature: string | null;
  total_ht: number | null;
  total_vat: number | null;
  total_ttc: number | null;
  other_amount: number;
  vat_rate_bp: number | null;
  rates: VatRate[];
  payment_mode: PaymentMode | null;
  payment_date: string | null;
  deduction_type: "charges" | "immobilisations";
  rubrique: string | null;
  deductible: boolean;
  confidence: Record<string, string>;
  issues: string[];
  checks: { label: string; ok: boolean; detail?: string }[];
  dedup_key: string | null;
  notes: string | null;
  archived: boolean;
  archive_reason: string | null;
  validated_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Ligne de la vue vat_journal (ventes Smart Invoice + écritures). */
export interface JournalRow {
  source: "invoice" | "entry";
  id: string;
  company_id: string;
  kind: VatEntryKind;
  status: string;
  invoice_number: string | null;
  invoice_date: string | null;
  party_name: string | null;
  party_ice: string | null;
  party_if: string | null;
  goods_nature: string | null;
  total_ht: number | null;
  total_vat: number | null;
  total_ttc: number | null;
  other_amount: number;
  vat_rate_bp: number | null;
  rates: VatRate[];
  payment_mode: string | null;
  payment_date: string | null;
  amount_paid: number | null;
  deduction_type: string;
  rubrique: string | null;
  deductible: boolean;
  source_file: string | null;
  page_from: number | null;
  page_to: number | null;
  archived: boolean;
  import_id: string | null;
}

export interface PdfImport {
  id: string;
  company_id: string;
  file_name: string;
  file_hash: string;
  file_size: number;
  storage_path: string | null;
  default_kind: VatEntryKind;
  page_count: number;
  pages_done: number;
  ocr_pages: number;
  invoices_found: number;
  needs_review: number;
  error_count: number;
  status: "processing" | "done" | "error" | "cancelled";
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface VatDeclaration {
  regime: "encaissement" | "debit";
  from: string;
  to: string;
  sales: { rate_bp: number; ht: number; vat: number }[];
  purchases: { deduction_type: "charges" | "immobilisations"; rate_bp: number; ht: number; vat: number }[];
  sales_ht: number;
  vat_collected: number;
  purchases_ht: number;
  vat_deductible: number;
  vat_non_deductible: number;
  net_vat: number;
  to_review: number;
  unpaid_entries: number;
}

/** Bon de livraison (BL) ou bon de commande (BC), créé à partir d'une facture. */
export type NoteKind = "BL" | "BC";
export interface DeliveryNote {
  id: string;
  company_id: string;
  kind: NoteKind;
  number: string;
  seq: number;
  issue_date: string;
  invoice_id: string | null;
  invoice_number: string | null;
  client_id: string | null;
  client_snapshot: PartySnapshot | null;
  order_ref: string | null;
  notes: string | null;
  show_prices: boolean;
  total_ht: number;
  total_vat: number;
  total_ttc: number;
  vat_breakdown: VatBreakdownRow[];
  is_demo: boolean;
  created_at: string;
}
export interface DeliveryNoteLine {
  id: string;
  note_id: string;
  position: number;
  designation: string;
  unit: string | null;
  quantity: number;
  unit_price_ttc: number;
  vat_rate_bp: number;
  discount_bp: number;
  total_ttc: number;
}
