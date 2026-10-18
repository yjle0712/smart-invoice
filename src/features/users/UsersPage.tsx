import { useState } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { supabase, must, errorMessage } from "@/lib/supabase";
import { useActiveCompany, useSession } from "@/lib/session";
import { useAsync } from "@/lib/hooks";
import type { Member, MemberRole } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/utils";
import { Button, Card, ConfirmDialog, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table } from "@/components/ui";

const ROLE_HELP: Record<MemberRole, string> = {
  admin: "Tout gérer : paramètres, utilisateurs, séries, validation et annulation.",
  comptable: "Catalogue, modèles, validation, paiements, annulation, journal d'activité.",
  utilisateur: "Clients et brouillons de factures. Ne valide pas et ne modifie pas les prix.",
};

export function UsersPage() {
  const { company, isAdmin, reload: reloadCompanies } = useActiveCompany();
  const { session } = useSession();
  const list = useAsync(async () => must(await supabase.from("company_members").select("company_id, user_id, role, created_at, profiles(email, full_name)").eq("company_id", company.id)) as unknown as Member[], [company.id]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("utilisateur");
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<Member | null>(null);

  const add = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return toast.error("Adresse e-mail invalide.");
    setBusy(true);
    try {
      must(await supabase.rpc("add_member_by_email", { p_company: company.id, p_email: email.trim(), p_role: role }));
      toast.success("Utilisateur ajouté à l'entreprise.");
      setEmail("");
      void list.reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  const changeRole = async (m: Member, r: MemberRole) => {
    try {
      must(await supabase.from("company_members").update({ role: r }).eq("company_id", m.company_id).eq("user_id", m.user_id));
      toast.success("Rôle modifié.");
      void list.reload();
      if (m.user_id === session?.user.id) await reloadCompanies();
    } catch (err) { toast.error(errorMessage(err)); }
  };

  return (
    <>
      <PageHeader title="Utilisateurs et permissions" description={<>Accès à <b>{company.legal_name}</b>. Chaque entreprise a ses propres membres ; un comptable peut être membre de plusieurs entreprises.</>} />

      {isAdmin && (
        <Card title="Ajouter un utilisateur" className="mb-4">
          <div className="flex flex-wrap items-end gap-3 p-4">
            <Field label="E-mail du compte" className="min-w-64 flex-1" hint="La personne crée d'abord son compte (page de connexion → « Créer un compte »).">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nom@exemple.ma" />
            </Field>
            <Field label="Rôle" className="w-48">
              <Select value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
                {(Object.keys(ROLE_LABEL) as MemberRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </Select>
            </Field>
            <Button icon={<UserPlus className="size-4" />} loading={busy} onClick={add}>Ajouter</Button>
          </div>
        </Card>
      )}

      <Card title="Membres">
        {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : list.loading && !list.data ? <Spinner /> : (
          <Table>
            <thead><tr><th>Utilisateur</th><th>Rôle</th><th>Ajouté le</th><th /></tr></thead>
            <tbody>
              {list.data!.map((m) => (
                <tr key={m.user_id}>
                  <td>
                    <div className="font-medium">{m.profiles?.full_name || m.profiles?.email || m.user_id}</div>
                    {m.profiles?.full_name && <div className="text-xs text-muted">{m.profiles.email}</div>}
                    {m.user_id === session?.user.id && <div className="text-xs text-muted">(vous)</div>}
                  </td>
                  <td>
                    {isAdmin ? (
                      <Select className="w-44" value={m.role} onChange={(e) => changeRole(m, e.target.value as MemberRole)} aria-label="Rôle">
                        {(Object.keys(ROLE_LABEL) as MemberRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </Select>
                    ) : ROLE_LABEL[m.role]}
                  </td>
                  <td className="num">{new Date(m.created_at).toLocaleDateString("fr-MA")}</td>
                  <td className="text-right">
                    {isAdmin && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemove(m)}>Retirer</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Rôles" className="mt-4">
        <dl className="grid gap-2 p-4 text-sm sm:grid-cols-3">
          {(Object.keys(ROLE_HELP) as MemberRole[]).map((r) => (
            <div key={r} className="rounded-md border border-line p-3"><dt className="font-medium">{ROLE_LABEL[r]}</dt><dd className="text-muted">{ROLE_HELP[r]}</dd></div>
          ))}
        </dl>
        <p className="border-t border-line px-4 py-3 text-xs text-muted">
          Ces droits sont appliqués par la base de données (règles RLS), pas seulement par l'interface.
        </p>
      </Card>

      <ConfirmDialog
        open={remove !== null}
        title="Retirer l'utilisateur"
        message={<>Retirer {remove?.profiles?.email} de {company.legal_name} ? Son compte n'est pas supprimé, il perd seulement l'accès à cette entreprise.</>}
        confirmLabel="Retirer"
        danger
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          try {
            must(await supabase.from("company_members").delete().eq("company_id", remove!.company_id).eq("user_id", remove!.user_id));
            toast.success("Accès retiré.");
            setRemove(null);
            if (remove!.user_id === session?.user.id) await reloadCompanies(); else void list.reload();
          } catch (err) { toast.error(errorMessage(err)); }
        }}
      />
    </>
  );
}
