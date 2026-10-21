import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { supabase, must, errorMessage } from "@/lib/supabase";
import { useAsync } from "@/lib/hooks";
import type { InvoiceTemplateRow, TemplateBase } from "@/lib/types";
import { TEMPLATE_PRESETS, presetFor } from "@/pdf/templates";
import { Badge, Select } from "@/components/ui";

/**
 * Modèle de facture d'UNE entreprise (celle affichée dans la page Entreprises, pas forcément l'active).
 * Choisir un modèle de la bibliothèque le crée pour cette entreprise et le met par défaut.
 */
export function CompanyTemplatePicker({ companyId, defaultTemplateId, canEdit, onChanged }: {
  companyId: string; defaultTemplateId: string | null; canEdit: boolean; onChanged: () => Promise<void> | void;
}) {
  const list = useAsync(async () => must(await supabase.from("invoice_templates").select("*").eq("company_id", companyId).order("name")) as InvoiceTemplateRow[], [companyId]);
  const [busy, setBusy] = useState(false);
  const current = list.data?.find((t) => t.id === defaultTemplateId) ?? null;

  const choose = async (value: string) => {
    if (!value) return;
    setBusy(true);
    try {
      let id = value;
      if (value.startsWith("preset:")) {
        const base = value.slice(7) as TemplateBase;
        const existing = list.data?.find((t) => t.base === base);
        if (existing) id = existing.id;
        else {
          const row = must(await supabase.from("invoice_templates").insert({ company_id: companyId, name: presetFor(base).label, base, settings: {} }).select("id").single()) as { id: string };
          id = row.id;
        }
      }
      must(await supabase.from("companies").update({ default_template_id: id }).eq("id", companyId));
      toast.success("Modèle de facture de l'entreprise enregistré.");
      await list.reload();
      await onChanged();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <div className="mb-4 rounded-md border border-line bg-canvas p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Modèle de facture de cette entreprise :</span>
        {current ? <Badge tone="ok">{current.name}</Badge> : <Badge>Classic (par défaut)</Badge>}
      </div>
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select className="w-80" value="" disabled={busy} onChange={(e) => choose(e.target.value)} aria-label="Choisir le modèle de facture">
            <option value="">Changer de modèle…</option>
            {(list.data ?? []).length > 0 && (
              <optgroup label="Modèles de cette entreprise">
                {list.data!.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </optgroup>
            )}
            <optgroup label="Bibliothèque">
              {TEMPLATE_PRESETS.filter((p) => p.base !== "entete").map((p) => <option key={p.base} value={`preset:${p.base}`}>{p.label}</option>)}
            </optgroup>
          </Select>
          <span className="text-xs text-muted">Couleurs, logo et mise en page se règlent dans <Link to="/modeles" className="underline">Modèles de factures</Link> (entreprise active).</span>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">Toutes les factures, devis et bons de cette entreprise utilisent ce modèle, sauf si un autre est choisi sur la facture elle-même.</p>
    </div>
  );
}
