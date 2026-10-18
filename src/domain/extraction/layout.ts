/**
 * Reconstruction des lignes d'une page à partir d'éléments de texte positionnés
 * (pdf.js ou OCR). Chaque ligne est découpée en « cellules » quand un grand espace
 * horizontal sépare deux éléments : on garde ainsi les colonnes (libellé | valeur).
 */

export interface TextItem {
  str: string;
  /** Coordonnées en points, origine en haut à gauche (y croît vers le bas). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Cell {
  x: number;
  x2: number;
  text: string;
}

export interface Line {
  page: number;
  /** Index de la ligne dans la page. */
  index: number;
  y: number;
  cells: Cell[];
  /** Texte complet, cellules séparées par «  |  ». */
  text: string;
}

export interface PageText {
  page: number;
  lines: Line[];
  /** Vrai si le texte provient de l'OCR. */
  ocr?: boolean;
  /** Hauteur de la page en points (pour situer haut / bas de page). */
  height?: number;
}

const norm = (s: string) => s.replace(/[  \t]/g, " ").replace(/\s+/g, " ");

export function buildLines(page: number, items: TextItem[]): Line[] {
  const clean = items
    .map((i) => ({ ...i, str: norm(i.str) }))
    .filter((i) => i.str.trim().length > 0 && Number.isFinite(i.x) && Number.isFinite(i.y));
  clean.sort((a, b) => a.y - b.y || a.x - b.x);

  // 1) Regroupement par rangée (tolérance proportionnelle à la taille du texte)
  const rows: { y: number; h: number; items: TextItem[] }[] = [];
  for (const it of clean) {
    const h = it.h > 0 ? it.h : 8;
    const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, 0.45 * Math.min(h, r.h)));
    if (row) {
      row.items.push(it);
      row.y = (row.y * (row.items.length - 1) + it.y) / row.items.length;
    } else rows.push({ y: it.y, h, items: [it] });
  }
  rows.sort((a, b) => a.y - b.y);

  // 2) Découpage en cellules sur les grands écarts horizontaux
  return rows.map((r, index) => {
    const its = [...r.items].sort((a, b) => a.x - b.x);
    const cells: Cell[] = [];
    for (const it of its) {
      const last = cells[cells.length - 1];
      const gap = last ? it.x - last.x2 : Infinity;
      const fs = it.h > 0 ? it.h : 8;
      if (last && gap < fs * 1.1) {
        const sep = gap > fs * 0.15 && !last.text.endsWith(" ") && !it.str.startsWith(" ") ? " " : "";
        last.text += sep + it.str;
        last.x2 = Math.max(last.x2, it.x + it.w);
      } else {
        cells.push({ x: it.x, x2: it.x + it.w, text: it.str });
      }
    }
    for (const c of cells) c.text = c.text.trim();
    const kept = cells.filter((c) => c.text);
    return { page, index, y: r.y, cells: kept, text: kept.map((c) => c.text).join("  |  ") };
  });
}

/** Pages de texte brut (tests, OCR sans positions) : une ligne = une cellule, colonnes séparées par 2+ espaces ou « | ». */
export function linesFromPlainText(page: number, text: string): Line[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/[  \t]/g, " "))
    .filter((l) => l.trim())
    .map((l, index) => {
      const parts = l.split(/\s{3,}|\s*\|\s*/).map((p) => p.trim()).filter(Boolean);
      const cells = parts.map((t, i) => ({ x: i * 100, x2: i * 100 + 90, text: norm(t) }));
      return { page, index, y: index * 12, cells, text: cells.map((c) => c.text).join("  |  ") };
    });
}

/** Nombre de caractères utiles d'une page : sert à décider si l'OCR est nécessaire. */
export function meaningfulChars(lines: Line[]): number {
  return lines.reduce((s, l) => s + l.text.replace(/[\s|]/g, "").length, 0);
}
