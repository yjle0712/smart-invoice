import * as XLSX from "xlsx";

export interface Column<T> {
  header: string;
  value: (row: T) => string | number | Date | null | undefined;
  width?: number;
  /** Format Excel, ex. '#,##0.00' pour les montants. */
  format?: string;
}

export interface SheetSpec<T> {
  name: string;
  rows: T[];
  columns: Column<T>[];
  /** Ligne de total facultative (valeurs déjà calculées). */
  footer?: (string | number | null)[];
}

export const MONEY_FMT = "#,##0.00";
export const DATE_FMT = "dd/mm/yyyy";

/** Construit un vrai classeur XLSX (valeurs numériques exploitables) et renvoie un Blob. */
export function buildWorkbook(sheets: SheetSpec<any>[]): Blob {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const aoa: (string | number | Date | null)[][] = [s.columns.map((c) => c.header)];
    for (const r of s.rows) aoa.push(s.columns.map((c) => c.value(r) ?? null));
    if (s.footer) aoa.push(s.footer);
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
    ws["!cols"] = s.columns.map((c) => ({ wch: c.width ?? Math.max(10, c.header.length + 2) }));
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, s.rows.length), c: s.columns.length - 1 } }) };
    s.columns.forEach((c, ci) => {
      const fmt = c.format;
      if (!fmt) return;
      for (let ri = 1; ri < aoa.length; ri++) {
        const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })];
        if (cell && (cell.t === "n" || cell.t === "d")) cell.z = fmt;
      }
    });
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true });
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** Lit la première feuille d'un fichier Excel/CSV : objets indexés par en-tête normalisé. */
export async function readFirstSheet(file: File): Promise<{ rowNumber: number; values: Record<string, unknown> }[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true, raw: false, dense: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
  if (rows.length === 0) return [];
  const headers = (rows[0] as unknown[]).map((h) => normalizeHeader(String(h ?? "")));
  return rows.slice(1).map((r, i) => {
    const values: Record<string, unknown> = {};
    headers.forEach((h, ci) => { if (h) values[h] = (r as unknown[])[ci]; });
    return { rowNumber: i + 2, values };
  }).filter((r) => Object.values(r.values).some((v) => v !== null && String(v).trim() !== ""));
}

export function normalizeHeader(h: string): string {
  return h.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Montant en centimes → nombre en dirhams pour Excel. */
export const dh = (cents: number | null | undefined) => (cents === null || cents === undefined ? null : cents / 100);

/** "2026-03-15" → Date locale (cellule date Excel). */
export const xlDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Toutes les cellules d'une feuille (lignes vides conservées pour garder les positions). */
export async function readSheetGrids(file: File): Promise<{ name: string; grid: unknown[][] }[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  // Les modèles de facture ont souvent une feuille « Facture » suivie de feuilles d'aide : on la met en premier.
  const names = [...wb.SheetNames].sort((a, b) => Number(/factur/i.test(b)) - Number(/factur/i.test(a)));
  return names.map((name) => ({
    name,
    grid: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true }),
  }));
}
