/**
 * Formats de numérotation des factures.
 *
 * Le numéro DÉFINITIF est toujours attribué par la base de données (fonction SQL
 * `validate_invoice`), dans une transaction qui verrouille la série : il ne peut
 * donc y avoir ni doublon ni trou. Ce module sert à valider le format saisi par
 * l'utilisateur et à afficher un aperçu identique au résultat SQL
 * (voir `format_invoice_number` dans les migrations).
 *
 * Jetons disponibles :
 *   {SEQ}    numéro séquentiel, avec zéros : {SEQ:4} → 0007
 *   {YYYY}   année de la facture (2026)
 *   {YY}     année sur 2 chiffres (26)
 *   {MM}     mois sur 2 chiffres (03)
 * Tout autre texte est recopié tel quel. Ex. « FA{SEQ:4}/{YYYY} » → « FA0007/2026 ».
 */

const TOKEN_RE = /\{(SEQ(?::(\d{1,2}))?|YYYY|YY|MM)\}/g;

export function validateNumberFormat(format: string): string | null {
  if (!format.trim()) return "Le format est obligatoire.";
  if (format.length > 40) return "Le format ne doit pas dépasser 40 caractères.";
  const seqCount = (format.match(/\{SEQ(?::\d{1,2})?\}/g) ?? []).length;
  if (seqCount !== 1) return "Le format doit contenir exactement un jeton {SEQ} (ex. {SEQ:4}).";
  const stripped = format.replace(TOKEN_RE, "");
  if (/[{}]/.test(stripped)) return "Jeton inconnu : utilisez {SEQ:n}, {YYYY}, {YY} ou {MM}.";
  if (!/^[A-Za-z0-9\-_/.#]*$/.test(stripped)) return "Caractères autorisés : lettres, chiffres, - _ / . #";
  return null;
}

export function formatInvoiceNumber(format: string, seq: number, date: Date | string): string {
  const d = typeof date === "string" ? new Date(`${date.slice(0, 10)}T00:00:00`) : date;
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return format.replace(TOKEN_RE, (_m, token: string, pad?: string) => {
    if (token.startsWith("SEQ")) return String(seq).padStart(pad ? Number(pad) : 1, "0");
    if (token === "YYYY") return yyyy;
    if (token === "YY") return yyyy.slice(2);
    return mm;
  });
}

export interface DerivedSeries {
  format: string;
  /** Numéro séquentiel du numéro fourni. */
  seq: number;
  /** Prochain numéro à attribuer. */
  nextSeq: number;
  /** Année reconnue dans le numéro (pour la remise à zéro annuelle). */
  year: number | null;
  resetYearly: boolean;
}

/**
 * Déduit la série à partir du DERNIER numéro utilisé, ex. « NOV0100/2025A » →
 * format « NOV{SEQ:4}/{YYYY}A », prochain numéro 101. Le résultat est vérifié :
 * reformater le numéro avec le format trouvé doit redonner exactement l'original.
 */
export function deriveSeriesFromNumber(last: string, yearHint?: number): DerivedSeries | null {
  const s = last.trim().toUpperCase();
  if (!s || s.length > 32 || !/\d/.test(s)) return null;
  if (!/^[A-Z0-9\-_/.# ]*$/.test(s)) return null;
  const groups = [...s.matchAll(/\d+/g)].map((m) => ({ text: m[0], index: m.index ?? 0 }));
  let yearIdx = -1;
  let yearKind: "YYYY" | "YY" | null = null;
  if (groups.length >= 2) {
    // L'année : un groupe de 4 chiffres entre 2000 et 2099 (le dernier s'il y en a plusieurs)
    for (let i = groups.length - 1; i >= 0; i--) {
      const v = Number(groups[i].text);
      if (groups[i].text.length === 4 && v >= 2000 && v <= 2099) { yearIdx = i; yearKind = "YYYY"; break; }
    }
    if (yearIdx < 0 && yearHint) {
      const yy = String(yearHint % 100).padStart(2, "0");
      const i = groups.findIndex((g) => g.text === yy);
      if (i >= 0) { yearIdx = i; yearKind = "YY"; }
    }
  }
  // La séquence : le dernier groupe de chiffres qui n'est pas l'année
  let seqIdx = -1;
  for (let i = groups.length - 1; i >= 0; i--) if (i !== yearIdx) { seqIdx = i; break; }
  if (seqIdx < 0) return null;
  const seqG = groups[seqIdx];
  const parts: { start: number; end: number; token: string }[] = [
    { start: seqG.index, end: seqG.index + seqG.text.length, token: `{SEQ:${seqG.text.length}}` },
  ];
  if (yearIdx >= 0) {
    const y = groups[yearIdx];
    parts.push({ start: y.index, end: y.index + y.text.length, token: yearKind === "YYYY" ? "{YYYY}" : "{YY}" });
  }
  parts.sort((a, b) => a.start - b.start);
  let format = "";
  let pos = 0;
  for (const p of parts) { format += s.slice(pos, p.start).replace(/\s+/g, "") + p.token; pos = p.end; }
  format += s.slice(pos).replace(/\s+/g, "");
  if (validateNumberFormat(format)) return null;
  const seq = Number(seqG.text);
  const year = yearIdx >= 0 ? (yearKind === "YYYY" ? Number(groups[yearIdx].text) : 2000 + Number(groups[yearIdx].text)) : null;
  const check = formatInvoiceNumber(format, seq, `${year ?? 2000}-01-01`);
  if (check !== s.replace(/\s+/g, "")) return null;
  return { format, seq, nextSeq: seq + 1, year, resetYearly: year !== null };
}
