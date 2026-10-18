import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useActiveCompany } from "@/lib/session";
import { useAsync } from "@/lib/hooks";
import type { AuditEntry } from "@/lib/types";
import { Card, EmptyState, ErrorBox, Input, PageHeader, Pagination, Select, Spinner, Table } from "@/components/ui";

const TABLES: Record<string, string> = {
  invoices: "Factures", invoice_lines: "Lignes de facture", payments: "Paiements", products: "Catalogue", parties: "Clients / fournisseurs",
  companies: "Entreprise", company_members: "Utilisateurs", number_series: "Séries", invoice_templates: "Modèles",
};
const ACTIONS = { insert: "Création", update: "Modification", delete: "Suppression" } as const;
const PAGE = 50;
const HIDDEN = new Set(["updated_at", "created_at", "vat_breakdown", "total_ht", "total_vat", "total_ttc", "company_snapshot", "client_snapshot", "settings"]);

function label(h: AuditEntry): string {
  const d = (h.new_data ?? h.old_data ?? {}) as Record<string, unknown>;
  return String(d.number ?? d.legal_name ?? d.name ?? d.reference ?? d.designation ?? d.order_ref ?? (d.amount ? `${Number(d.amount) / 100} DH` : ""));
}

function diff(h: AuditEntry): string {
  if (h.action !== "update") return "";
  const o = (h.old_data ?? {}) as Record<string, unknown>;
  const n = (h.new_data ?? {}) as Record<string, unknown>;
  return Object.keys(n)
    .filter((k) => !HIDDEN.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k]))
    .map((k) => `${k} : ${fmt(o[k])} → ${fmt(n[k])}`)
    .join(" · ");
}
const fmt = (v: unknown) => (v === null || v === undefined ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v)).slice(0, 60);

export function AuditPage() {
  const { company } = useActiveCompany();
  const [table, setTable] = useState("");
  const [from, setFrom] = useState("");
  const [page, setPage] = useState(0);
  const list = useAsync(async () => {
    let req = supabase.from("audit_log").select("*", { count: "exact" }).eq("company_id", company.id);
    if (table) req = req.eq("table_name", table);
    if (from) req = req.gte("at", from);
    const res = await req.order("at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (res.error) throw res.error;
    const rows = (res.data ?? []) as AuditEntry[];
    const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
    const users = ids.length ? ((await supabase.from("profiles").select("id, email").in("id", ids)).data ?? []) as { id: string; email: string }[] : [];
    return { rows, total: res.count ?? 0, users: new Map(users.map((u) => [u.id, u.email])) };
  }, [company.id, table, from, page]);

  return (
    <>
      <PageHeader title="Journal d'activité" description="Toutes les opérations importantes, avec l'auteur, la date et les valeurs avant / après. Lecture seule." />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-3">
          <Select className="w-56" value={table} onChange={(e) => { setTable(e.target.value); setPage(0); }} aria-label="Type">
            <option value="">Tous les éléments</option>
            {Object.entries(TABLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <label className="flex items-center gap-1.5 text-sm text-muted">Depuis le <Input type="date" className="w-40" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} /></label>
        </div>
        {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : list.loading && !list.data ? <Spinner /> : list.data!.rows.length === 0 ? (
          <EmptyState title="Aucune opération" />
        ) : (
          <>
            <Table>
              <thead><tr><th>Date</th><th>Utilisateur</th><th>Élément</th><th>Action</th><th>Détail</th></tr></thead>
              <tbody>
                {list.data!.rows.map((h) => (
                  <tr key={h.id}>
                    <td className="num whitespace-nowrap">{new Date(h.at).toLocaleString("fr-MA")}</td>
                    <td className="text-xs">{h.user_id ? list.data!.users.get(h.user_id) ?? "—" : "Système"}</td>
                    <td>
                      <div className="text-xs text-muted">{TABLES[h.table_name] ?? h.table_name}</div>
                      {h.table_name === "invoices" && h.record_id && h.action !== "delete"
                        ? <Link className="text-ink-800 hover:underline" to={`/factures/${h.record_id}`}>{label(h) || "Brouillon"}</Link>
                        : label(h)}
                    </td>
                    <td>{ACTIONS[h.action]}</td>
                    <td className="max-w-md break-words text-xs text-muted">{diff(h)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE} total={list.data!.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
