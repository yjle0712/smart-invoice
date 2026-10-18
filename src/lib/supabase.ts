import { createClient, type PostgrestError } from "@supabase/supabase-js";

/**
 * Tolère les erreurs de copie courantes : espaces, guillemets, et URL copiée avec un
 * chemin (« https://x.supabase.co/rest/v1/ ») au lieu de l'adresse du projet seule.
 */
const clean = (v: unknown) => String(v ?? "").trim().replace(/^["']|["']$/g, "").trim();
const rawUrl = clean(import.meta.env.VITE_SUPABASE_URL);
const url = rawUrl ? rawUrl.replace(/\/(rest|auth|storage)\/v1.*$/i, "").replace(/\/+$/, "") : undefined;
const anonKey = clean(import.meta.env.VITE_SUPABASE_ANON_KEY) || undefined;

const PLACEHOLDERS = /votre-projet|votre-cle|xxxx/i;
/** Faux si les variables d'environnement ne sont pas renseignées (voir .env.example). */
export const isSupabaseConfigured = Boolean(
  url && anonKey && /^https?:\/\//.test(url) && !PLACEHOLDERS.test(url) && !PLACEHOLDERS.test(anonKey),
);

export const supabase = createClient(url ?? "http://localhost", anonKey ?? "missing", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Message d'erreur lisible en français, à partir d'une erreur Supabase / PostgreSQL. */
export function errorMessage(err: unknown): string {
  if (!err) return "Erreur inconnue.";
  const e = err as Partial<PostgrestError> & { message?: string; status?: number };
  const msg = e.message ?? String(err);
  switch (e.code) {
    case "23505": {
      if (msg.includes("invoices_unique_order_ref")) return "Cette commande a déjà été facturée (doublon).";
      if (msg.includes("invoices_unique_number")) return "Ce numéro de facture existe déjà.";
      if (msg.includes("parties_unique_ice")) return "Un tiers avec cet ICE existe déjà.";
      if (msg.includes("products_company_id_reference_key")) return "Cette référence produit existe déjà.";
      if (msg.includes("product_categories")) return "Cette catégorie existe déjà.";
      if (msg.includes("number_series")) return "Une série porte déjà ce nom.";
      if (msg.includes("invoice_templates")) return "Un modèle porte déjà ce nom.";
      return "Cette valeur existe déjà (doublon).";
    }
    case "23514": {
      if (msg.includes("ice_check")) return "L'ICE doit comporter exactement 15 chiffres.";
      if (msg.includes("default_rate_in_list")) return "Le taux par défaut doit faire partie des taux configurés.";
      if (msg.includes("due_after_issue")) return "La date d'échéance doit être postérieure à la date de facture.";
      if (msg.includes("one_seq_token")) return "Le format doit contenir le jeton {SEQ}.";
      return "Valeur invalide : vérifiez les champs saisis.";
    }
    case "23503":
      return "Élément utilisé ailleurs : impossible de le supprimer. Archivez-le plutôt.";
    case "42501":
      return "Action non autorisée pour votre rôle.";
    case "PGRST116":
      return "Élément introuvable ou accès refusé.";
  }
  if (/row-level security/i.test(msg)) return "Action non autorisée pour votre rôle.";
  if (/Failed to fetch|NetworkError/i.test(msg)) return "Connexion au serveur impossible. Vérifiez votre connexion Internet.";
  if (/Invalid login credentials/i.test(msg)) return "E-mail ou mot de passe incorrect.";
  if (/Email not confirmed/i.test(msg)) return "Confirmez d'abord votre adresse e-mail (lien reçu par e-mail).";
  if (/User already registered/i.test(msg)) return "Un compte existe déjà avec cet e-mail.";
  if (/Password should be/i.test(msg)) return "Le mot de passe doit contenir au moins 8 caractères.";
  return msg;
}

/** Lève une erreur lisible si la réponse Supabase contient une erreur. */
export function must<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw new Error(errorMessage(res.error));
  return res.data;
}

/** Télécharge un fichier du stockage privé et le renvoie en data URL (pour les PDF). */
export async function storageToDataUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("company-assets").download(path);
  if (error || !data) return null;
  return await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => resolve(null);
    r.readAsDataURL(data);
  });
}
