import { useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Building2, Calculator, ClipboardList, FileSignature, FileSpreadsheet, ClipboardCheck, FilePlus2, FileStack, FileText, FileUp, History, LayoutDashboard, LogOut, Menu, Package,
  Palette, Receipt, Settings, ShoppingCart, Truck, Users, UserCog, X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { InstallAppButton } from "./InstallApp";
import { useCompany, useSession } from "@/lib/session";
import { cn, ROLE_LABEL } from "@/lib/utils";

interface NavItem { to: string; label: string; icon: ReactNode; manage?: boolean; admin?: boolean }
const NAV: { group: string | null; items: NavItem[] }[] = [
  { group: null, items: [{ to: "/", label: "Tableau de bord", icon: <LayoutDashboard /> }] },
  {
    group: "Facturation",
    items: [
      { to: "/factures", label: "Factures", icon: <FileText /> },
      { to: "/factures/nouvelle", label: "Nouvelle facture", icon: <FilePlus2 /> },
      { to: "/devis", label: "Devis", icon: <FileSignature /> },
      { to: "/bons", label: "Bons BL / BC", icon: <ClipboardList /> },
      { to: "/lots", label: "Facturation par lots", icon: <FileStack /> },
    ],
  },
  {
    group: "Journal TVA",
    items: [
      { to: "/tva/import", label: "Importation PDF", icon: <FileUp /> },
      { to: "/tva/import-excel", label: "Importation Excel", icon: <FileSpreadsheet /> },
      { to: "/tva/controle", label: "Contrôle des factures", icon: <ClipboardCheck /> },
      { to: "/tva/ventes", label: "Journal des ventes", icon: <Receipt /> },
      { to: "/tva/achats", label: "Journal des achats", icon: <ShoppingCart /> },
      { to: "/tva/declaration", label: "Déclaration TVA", icon: <Calculator /> },
    ],
  },
  {
    group: "Référentiels",
    items: [
      { to: "/clients", label: "Clients", icon: <Users /> },
      { to: "/fournisseurs", label: "Fournisseurs", icon: <Truck /> },
      { to: "/catalogue", label: "Catalogue produits", icon: <Package /> },
    ],
  },
  {
    group: "Administration",
    items: [
      { to: "/modeles", label: "Modèles de factures", icon: <Palette /> },
      { to: "/entreprises", label: "Entreprises", icon: <Building2 /> },
      { to: "/parametres", label: "Paramètres", icon: <Settings /> },
      { to: "/utilisateurs", label: "Utilisateurs", icon: <UserCog /> },
      { to: "/journal", label: "Journal d'activité", icon: <History />, manage: true },
    ],
  },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { companies, company, select, canManage } = useCompany();
  const { session } = useSession();
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col bg-ink-800 text-ink-50">
      <div className="zellige px-4 pb-4 pt-5">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-8" />
          <div className="leading-tight">
            <div className="font-semibold text-white">Smart Invoice</div>
            <div className="text-xs text-ink-200">Facturation & TVA · Maroc</div>
          </div>
        </div>
        {companies.length > 0 && (
          <label className="mt-4 block">
            <span className="sr-only">Entreprise active</span>
            <select
              value={company?.id ?? ""}
              onChange={(e) => { select(e.target.value); navigate("/"); onNavigate?.(); }}
              className="h-9 w-full rounded-md border border-ink-600 bg-ink-900/60 px-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-saffron-500"
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.is_demo ? "[DÉMO] " : ""}{c.legal_name}
                </option>
              ))}
            </select>
          </label>
        )}
        {company && <div className="mt-1.5 text-xs text-ink-200">Rôle : {ROLE_LABEL[company.role]}</div>}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Navigation principale">
        {NAV.map((g) => (
          <div key={g.group ?? "root"} className="mb-3">
            {g.group && <div className="px-2 pb-1 text-xs font-medium text-ink-300">{g.group}</div>}
            {g.items
              .filter((i) => !i.manage || canManage)
              .map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  end={i.to === "/" || i.to === "/factures"}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm [&_svg]:size-4 [&_svg]:shrink-0",
                      isActive ? "bg-ink-600 text-white" : "text-ink-100 hover:bg-ink-700 hover:text-white",
                    )
                  }
                >
                  {i.icon}
                  {i.label}
                </NavLink>
              ))}
          </div>
        ))}
      </nav>

      <div className="border-t border-ink-700 px-3 py-3 text-xs">
        <div className="truncate text-ink-200" title={session?.user.email}>{session?.user.email}</div>
        <InstallAppButton />
        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="mt-1.5 flex items-center gap-1.5 text-ink-100 hover:text-white"
        >
          <LogOut className="size-3.5" /> Se déconnecter
        </button>
      </div>
    </div>
  );
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  const { company } = useCompany();
  const location = useLocation();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="hidden lg:sticky lg:top-0 lg:block lg:h-dvh">
        <Sidebar />
      </aside>

      {/* Mobile / tablette */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-700 bg-ink-800 px-3 py-2 text-white lg:hidden">
        <button type="button" onClick={() => setOpen(true)} className="rounded p-1.5 hover:bg-ink-700" aria-label="Ouvrir le menu">
          <Menu className="size-5" />
        </button>
        <span className="truncate px-2 text-sm font-medium">{company?.legal_name ?? "Smart Invoice"}</span>
        <span className="w-8" />
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink-900/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw]">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-2 top-2 z-10 rounded p-1.5 text-white hover:bg-ink-700"
              aria-label="Fermer le menu"
            >
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <main className="min-w-0">
        {company?.is_demo && (
          <div className="border-b border-saffron-100 bg-saffron-50 px-4 py-2 text-sm text-saffron-700 sm:px-6">
            Entreprise de démonstration : données fictives, sans valeur comptable ni fiscale. Elles ne sont jamais
            mélangées à vos entreprises réelles.
          </div>
        )}
        <div key={location.pathname} className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
