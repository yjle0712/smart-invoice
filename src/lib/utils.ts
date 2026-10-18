import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { InvoiceStatus, MemberRole } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Brouillon",
  validated: "Validée",
  partially_paid: "Partiellement payée",
  paid: "Payée",
  cancelled: "Annulée",
};

export const ROLE_LABEL: Record<MemberRole, string> = {
  admin: "Administrateur",
  comptable: "Comptable",
  utilisateur: "Utilisateur",
};

export const PAYMENT_METHOD_LABEL = {
  virement: "Virement",
  cheque: "Chèque",
  especes: "Espèces",
  effet: "Effet de commerce",
  carte: "Carte bancaire",
  autre: "Autre",
} as const;

/** Nom de fichier sûr : « FA0007-2026_CLIENT-UN.pdf » */
export function safeFileName(...parts: (string | null | undefined)[]): string {
  return parts
    .filter(Boolean)
    .join("_")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

export function isValidIce(ice: string): boolean {
  return /^\d{15}$/.test(ice);
}

/** Champ texte facultatif : chaîne vide → null. */
export const orNull = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t ? t : null;
};
