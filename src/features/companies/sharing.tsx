import { useState } from "react";
import { toast } from "sonner";
import { Share2 } from "lucide-react";
import { supabase, must, errorMessage } from "@/lib/supabase";
import { useCompany } from "@/lib/session";
import type { CompanyWithRole } from "@/lib/types";
import { Button, Checkbox, Dialog, Field, Select } from "@/components/ui";

export interface CopyResult { parties: number; products: number; skipped: number; errors: string[] }

export async function copyMasterData(source: string, target: string, opts: {
  parties?: boolean; products?: boolean; partyIds?: string[]; productIds?: string[];
} = {}): Promise<CopyResult> {
  return must(await supabase.rpc("copy_master_data", {
    p_source: source, p_target: target,
    p_parties: opts.parties ?? true, p_products: opts.products ?? true,
    p_party_ids: opts.partyIds ?? null, p_product_ids: opts.productIds ?? null,
  })) as CopyResult;
}

const canManageRole = (c: CompanyWithRole) => c.role === "admin" || c.role === "comptable";

/** Mes autres entreprises (hors démonstration), avec le droit d'y ajouter des produits ou non. */
export function useOtherCompanies() {
  const { companies, company } = useCompany();
  return companies.filter((c) => c.id !== company?.id && !c.is_demo && !company?.is_demo);
}

/** Copie un ou plusieurs éléments de l'entreprise active vers toutes mes autres entreprises. */
export async function shareToOthers(source: string, others: CompanyWithRole[], what: { partyIds?: string[]; productIds?: string[] }) {
  let added = 0;
  for (const c of others) {
    if (what.productIds && !canManageRole(c)) continue;
    try {
      const r = await copyMasterData(source, c.id, {
        parties: Boolean(what.partyIds), products: Boolean(what.productIds), partyIds: what.partyIds, productIds: what.productIds,
      });
      added += r.parties + r.products;
      if (r.skipped) toast.warning(`${c.legal_name} : ${r.errors.join(" · ")}`);
    } catch (err) {
      toast.error(`${c.legal_name} : ${errorMessage(err)}`);
    }
  }
  return added;
}

// Préférence d'affichage : se souvenir du choix « ajouter aussi dans mes autres entreprises ».
const PREF = "smart-invoice.share-new-items";
export function getSharePref(): boolean {
  try { return localStorage.getItem(PREF) !== "0"; } catch { return true; }
}
export function setSharePref(v: boolean) {
  try { localStorage.setItem(PREF, v ? "1" : "0"); } catch { /* sans conséquence */ }
}

/** Case à cocher affichée dans les fiches client / produit à la création. */
export function ShareCheckbox({ checked, onChange, count }: { checked: boolean; onChange: (v: boolean) => void; count: number }) {
  if (count === 0) return null;
  return (
    <Checkbox
      label={`Ajouter aussi dans mes ${count} autre(s) entreprise(s)`}
      hint="Même fiche, sans doublon (même ICE / même référence déjà présente : ignorée)."
      checked={checked}
      onChange={(v) => { onChange(v); setSharePref(v); }}
    />
  );
}

/** Bouton + fenêtre « Reprendre depuis une autre entreprise » (page Clients, Fournisseurs ou Catalogue). */
export function ImportFromCompanyButton({ what, onDone }: { what: "parties" | "products"; onDone: () => void }) {
  const { company } = useCompany();
  const others = useOtherCompanies();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  if (!company || others.length === 0) return null;
  const label = what === "parties" ? "clients et fournisseurs" : "produits";
  const run = async () => {
    setBusy(true);
    try {
      const r = await copyMasterData(source, company.id, { parties: what === "parties", products: what === "products" });
      const n = what === "parties" ? r.parties : r.products;
      toast.success(n ? `${n} fiche(s) ajoutée(s).` : "Rien à ajouter : tout est déjà présent.");
      if (r.skipped) toast.warning(`${r.skipped} non copiée(s) : ${r.errors.join(" · ")}`, { duration: 12000 });
      setOpen(false);
      onDone();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <>
      <Button variant="secondary" icon={<Share2 className="size-4" />} onClick={() => { setSource(others[0].id); setOpen(true); }}>
        Reprendre d'une autre entreprise
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Reprendre les ${label}`}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Annuler</Button><Button loading={busy} disabled={!source} onClick={run}>Copier dans {company.legal_name}</Button></>}>
        <Field label="Depuis l'entreprise">
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            {others.map((c) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}
          </Select>
        </Field>
        <p className="mt-3 text-sm text-muted">
          Les fiches absentes de {company.legal_name} sont ajoutées. Celles qui existent déjà (même ICE, même nom ou même référence) ne sont pas modifiées.
          {what === "products" && " Les prix sont repris tels quels du catalogue source."}
        </p>
      </Dialog>
    </>
  );
}

/** Synchronise clients, fournisseurs et produits entre toutes mes entreprises (page Entreprises). */
export function SyncAllButton() {
  const { companies } = useCompany();
  const list = companies.filter((c) => !c.is_demo);
  const [busy, setBusy] = useState(false);
  if (list.length < 2) return null;
  const run = async () => {
    setBusy(true);
    let parties = 0, products = 0, skipped = 0;
    try {
      for (const s of list) for (const t of list) {
        if (s.id === t.id) continue;
        try {
          const r = await copyMasterData(s.id, t.id, { products: canManageRole(t) });
          parties += r.parties; products += r.products; skipped += r.skipped;
        } catch (err) { toast.error(`${s.legal_name} → ${t.legal_name} : ${errorMessage(err)}`); }
      }
      toast.success(`Synchronisation terminée : ${parties} client(s)/fournisseur(s) et ${products} produit(s) ajoutés.`);
      if (skipped) toast.warning(`${skipped} fiche(s) non copiée(s) (ex. taux de TVA non configuré dans l'entreprise cible).`);
    } finally { setBusy(false); }
  };
  return (
    <Button variant="secondary" icon={<Share2 className="size-4" />} loading={busy} onClick={run}>
      Mettre les mêmes clients et produits dans toutes mes entreprises
    </Button>
  );
}
