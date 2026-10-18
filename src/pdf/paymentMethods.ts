/** Modes de paiement d'une facture (valeur enregistrée → libellé imprimé). */
export const PAYMENT_METHOD_PDF: Record<string, string> = {
  virement: "Virement bancaire",
  cheque: "Chèque",
  especes: "Espèces",
  effet: "Effet de commerce (LCN)",
  carte: "Carte bancaire",
  prelevement: "Prélèvement",
  versement: "Versement bancaire",
  autre: "Autre",
};
