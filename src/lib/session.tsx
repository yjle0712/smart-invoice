import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, must } from "./supabase";
import type { CompanyWithRole, MemberRole } from "./types";

interface SessionState {
  session: Session | null;
  loading: boolean;
  /** Vrai quand l'utilisateur arrive depuis le lien « mot de passe oublié ». */
  recovery: boolean;
  clearRecovery: () => void;
}

const SessionCtx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo(
    () => ({ session, loading, recovery, clearRecovery: () => setRecovery(false) }),
    [session, loading, recovery],
  );
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error("SessionProvider manquant");
  return ctx;
}

// ---------------------------------------------------------------------
// Entreprise active
// ---------------------------------------------------------------------
interface CompanyState {
  companies: CompanyWithRole[];
  company: CompanyWithRole | null;
  loading: boolean;
  select: (id: string) => void;
  reload: () => Promise<void>;
  role: MemberRole | null;
  /** Admin ou comptable */
  canManage: boolean;
  isAdmin: boolean;
}

const CompanyCtx = createContext<CompanyState | null>(null);
// Préférence d'affichage uniquement (pas un mécanisme de sécurité : l'accès est contrôlé par RLS).
const PREF_KEY = "smart-invoice.selected-company";

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [companies, setCompanies] = useState<CompanyWithRole[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(PREF_KEY);
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!session) {
      setCompanies([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = must(
        await supabase
          .from("company_members")
          .select("role, companies(*)")
          .eq("user_id", session.user.id),
      ) as unknown as { role: MemberRole; companies: CompanyWithRole | null }[];
      const list = rows
        .filter((r) => r.companies)
        .map((r) => ({ ...(r.companies as CompanyWithRole), role: r.role }))
        .sort((a, b) => Number(a.is_demo) - Number(b.is_demo) || a.legal_name.localeCompare(b.legal_name, "fr"));
      setCompanies(list);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const company = companies.find((c) => c.id === selectedId) ?? companies[0] ?? null;

  const select = (id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem(PREF_KEY, id);
    } catch {
      /* stockage indisponible : sans conséquence */
    }
  };

  const role = company?.role ?? null;
  const value: CompanyState = {
    companies,
    company,
    loading,
    select,
    reload,
    role,
    canManage: role === "admin" || role === "comptable",
    isAdmin: role === "admin",
  };
  return <CompanyCtx.Provider value={value}>{children}</CompanyCtx.Provider>;
}

export function useCompany() {
  const ctx = useContext(CompanyCtx);
  if (!ctx) throw new Error("CompanyProvider manquant");
  return ctx;
}

/** Entreprise active garantie (à utiliser dans les pages sous <RequireCompany>). */
export function useActiveCompany() {
  const ctx = useCompany();
  if (!ctx.company) throw new Error("Aucune entreprise sélectionnée");
  return { ...ctx, company: ctx.company };
}
