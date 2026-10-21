import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, FlaskConical } from "lucide-react";
import { supabase, must, errorMessage } from "@/lib/supabase";
import { useCompany } from "@/lib/session";
import { ROLE_LABEL, cn } from "@/lib/utils";
import { Badge, Button, Card, ConfirmDialog, PageHeader } from "@/components/ui";
import { CompanyForm } from "./CompanyForm";
import { SyncAllButton, copyMasterData } from "./sharing";
import { CompanyTemplatePicker } from "./CompanyTemplatePicker";

export function CompaniesPage() {
  const { companies, company: active, select, reload } = useCompany();
  const [editing, setEditing] = useState<string | "new" | null>(active?.id ?? null);
  const [deleteDemo, setDeleteDemo] = useState<string | null>(null);
  const [busyDemo, setBusyDemo] = useState(false);
  const realCompanies = companies.filter((c) => !c.is_demo);
  const [copyFrom, setCopyFrom] = useState<string>("");
  const current = editing && editing !== "new" ? companies.find((c) => c.id === editing) ?? null : null;

  const createDemo = async () => {
    setBusyDemo(true);
    try {
      const id = must(await supabase.rpc("create_demo_company")) as string;
      await reload();
      select(id);
      setEditing(id);
      toast.success("Entreprise de démonstration créée.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyDemo(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Entreprises"
        description="Chaque entreprise a ses propres factures, clients, catalogue, modèles et paramètres."
        actions={
          <>
            <Button variant="secondary" icon={<FlaskConical className="size-4" />} loading={busyDemo} onClick={createDemo}>
              Créer une entreprise de démonstration
            </Button>
            <SyncAllButton />
            <Button icon={<Plus className="size-4" />} onClick={() => { setCopyFrom(realCompanies[0]?.id ?? ""); setEditing("new"); }}>Nouvelle entreprise</Button>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit">
          <ul className="divide-y divide-line">
            {companies.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setEditing(c.id)}
                  className={cn("flex w-full flex-col items-start gap-1 px-4 py-3 text-left hover:bg-ink-50/50", editing === c.id && "bg-ink-50")}
                >
                  <span className="font-medium text-ink-900">{c.legal_name}</span>
                  <span className="flex flex-wrap gap-1.5">
                    <Badge>{ROLE_LABEL[c.role]}</Badge>
                    {c.is_demo && <Badge tone="warn">Démonstration</Badge>}
                    {c.id === active?.id && <Badge tone="ok">Active</Badge>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card
          title={editing === "new" ? "Nouvelle entreprise" : current?.legal_name ?? "Sélectionnez une entreprise"}
          actions={
            current && (
              <div className="flex gap-2">
                {current.id !== active?.id && <Button size="sm" variant="secondary" onClick={() => select(current.id)}>Rendre active</Button>}
                {current.is_demo && current.role === "admin" && (
                  <Button size="sm" variant="danger" onClick={() => setDeleteDemo(current.id)}>Supprimer la démo</Button>
                )}
              </div>
            )
          }
        >
          <div className="p-4">
            {editing === "new" && realCompanies.length > 0 && (
              <div className="mb-4 rounded-md border border-line bg-canvas p-3">
                <label className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">Reprendre les clients, fournisseurs et produits de :</span>
                  <select className="h-9 rounded-md border border-line bg-white px-2" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                    <option value="">Aucune (entreprise vide)</option>
                    {realCompanies.map((c) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}
                  </select>
                </label>
              </div>
            )}
            {current && (
              <CompanyTemplatePicker companyId={current.id} defaultTemplateId={current.default_template_id} canEdit={current.role === "admin"} onChanged={reload} />
            )}
            {editing === "new" || current ? (
              <CompanyForm
                company={current}
                canEdit={editing === "new" || current?.role === "admin"}
                onSaved={async (id) => {
                  if (editing === "new" && copyFrom) {
                    try {
                      const r = await copyMasterData(copyFrom, id);
                      toast.success(`${r.parties} client(s)/fournisseur(s) et ${r.products} produit(s) repris.`);
                      if (r.skipped) toast.warning(`${r.skipped} fiche(s) non reprise(s) : ${r.errors.join(" · ")}`, { duration: 12000 });
                    } catch (err) { toast.error(errorMessage(err)); }
                  }
                  await reload();
                  if (editing === "new") { select(id); setEditing(id); }
                }}
              />
            ) : (
              <p className="text-sm text-muted">Choisissez une entreprise dans la liste.</p>
            )}
          </div>
        </Card>
      </div>
      <ConfirmDialog
        open={Boolean(deleteDemo)}
        title="Supprimer l'entreprise de démonstration"
        message="Toutes les données fictives de cette entreprise (factures, clients, produits) seront supprimées définitivement."
        confirmLabel="Supprimer la démo"
        danger
        onClose={() => setDeleteDemo(null)}
        onConfirm={async () => {
          try {
            must(await supabase.rpc("delete_demo_company", { p_company: deleteDemo }));
            setDeleteDemo(null);
            setEditing(null);
            await reload();
            toast.success("Entreprise de démonstration supprimée.");
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </>
  );
}

/** Premier lancement : aucune entreprise. */
export function OnboardingPage() {
  const { reload, select } = useCompany();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-ink-900">Bienvenue sur Smart Invoice</h1>
      <p className="mt-1 text-muted">
        Créez votre entreprise pour commencer. Si un collègue gère déjà l'entreprise, demandez-lui de vous ajouter
        depuis la page Utilisateurs avec l'e-mail de ce compte.
      </p>
      <Card className="mt-6" title="Votre entreprise">
        <div className="p-4">
          <CompanyForm
            company={null}
            canEdit
            onSaved={async (id) => { await reload(); select(id); navigate("/"); }}
          />
        </div>
      </Card>
      <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-muted">
        Envie d'explorer d'abord ?
        <Button
          variant="secondary"
          loading={busy}
          icon={<FlaskConical className="size-4" />}
          onClick={async () => {
            setBusy(true);
            try {
              const id = must(await supabase.rpc("create_demo_company")) as string;
              await reload();
              select(id);
              navigate("/");
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Essayer avec une entreprise de démonstration
        </Button>
      </div>
    </div>
  );
}
