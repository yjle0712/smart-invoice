import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { isSupabaseConfigured } from "@/lib/supabase";
import { CompanyProvider, SessionProvider, useCompany, useSession } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { EmptyState, Spinner } from "@/components/ui";
import { LoginPage, SetupScreen, UpdatePasswordPage } from "@/features/auth/AuthPages";
import { CompaniesPage, OnboardingPage } from "@/features/companies/CompaniesPage";

// Pages chargées à la demande : le moteur PDF et Excel ne sont téléchargés que lorsqu'ils servent.
const DashboardPage = lazy(() => import("@/features/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const InvoicesListPage = lazy(() => import("@/features/invoices/InvoicesListPage").then((m) => ({ default: m.InvoicesListPage })));
const InvoiceEditorPage = lazy(() => import("@/features/invoices/InvoiceEditorPage").then((m) => ({ default: m.InvoiceEditorPage })));
const InvoiceDetailPage = lazy(() => import("@/features/invoices/InvoiceDetailPage").then((m) => ({ default: m.InvoiceDetailPage })));
const QuotesListPage = lazy(() => import("@/features/quotes/QuotesPages").then((m) => ({ default: m.QuotesListPage })));
const QuoteEditorPage = lazy(() => import("@/features/quotes/QuotesPages").then((m) => ({ default: m.QuoteEditorPage })));
const QuoteDetailPage = lazy(() => import("@/features/quotes/QuotesPages").then((m) => ({ default: m.QuoteDetailPage })));
const BatchPage = lazy(() => import("@/features/batch/BatchPage").then((m) => ({ default: m.BatchPage })));
const PartiesPage = lazy(() => import("@/features/parties/PartiesPage").then((m) => ({ default: m.PartiesPage })));
const ProductsPage = lazy(() => import("@/features/products/ProductsPage").then((m) => ({ default: m.ProductsPage })));
const TemplatesPage = lazy(() => import("@/features/templates/TemplatesPage").then((m) => ({ default: m.TemplatesPage })));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const UsersPage = lazy(() => import("@/features/users/UsersPage").then((m) => ({ default: m.UsersPage })));
const ImportPage = lazy(() => import("@/features/vat/ImportPage").then((m) => ({ default: m.ImportPage })));
const ImportExcelPage = lazy(() => import("@/features/vat/ImportExcelPage").then((m) => ({ default: m.ImportExcelPage })));
const ReviewPage = lazy(() => import("@/features/vat/ReviewPage").then((m) => ({ default: m.ReviewPage })));
const JournalPage = lazy(() => import("@/features/vat/JournalPage").then((m) => ({ default: m.JournalPage })));
const DeclarationPage = lazy(() => import("@/features/vat/DeclarationPage").then((m) => ({ default: m.DeclarationPage })));
const NotesListPage = lazy(() => import("@/features/notes/NotesPages").then((m) => ({ default: m.NotesListPage })));
const NoteDetailPage = lazy(() => import("@/features/notes/NotesPages").then((m) => ({ default: m.NoteDetailPage })));
const AuditPage = lazy(() => import("@/features/audit/AuditPage").then((m) => ({ default: m.AuditPage })));

function Gate({ children }: { children: ReactNode }) {
  const { session, loading, recovery } = useSession();
  if (!isSupabaseConfigured) return <SetupScreen />;
  if (loading) return <Spinner />;
  if (recovery) return <UpdatePasswordPage />;
  if (!session) return <LoginPage />;
  return <CompanyProvider>{children}</CompanyProvider>;
}

function RequireCompany({ children }: { children: ReactNode }) {
  const { company, loading } = useCompany();
  if (loading && !company) return <Spinner />;
  if (!company) return <OnboardingPage />;
  return <>{children}</>;
}

function ManageOnly({ children }: { children: ReactNode }) {
  const { canManage } = useCompany();
  if (!canManage) {
    return <EmptyState title="Accès réservé">Cette page est réservée aux administrateurs et aux comptables.</EmptyState>;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Gate>
          <RequireCompany>
            <Suspense fallback={<Spinner />}>
              <Routes>
                <Route element={<AppShell />}>
                  <Route index element={<DashboardPage />} />
                  <Route path="factures" element={<InvoicesListPage />} />
                  <Route path="factures/nouvelle" element={<InvoiceEditorPage />} />
                  <Route path="factures/:id" element={<InvoiceDetailPage />} />
                  <Route path="factures/:id/modifier" element={<InvoiceEditorPage />} />
                  <Route path="devis" element={<QuotesListPage />} />
                  <Route path="devis/nouveau" element={<QuoteEditorPage key="new" />} />
                  <Route path="devis/:id" element={<QuoteDetailPage />} />
                  <Route path="devis/:id/modifier" element={<QuoteEditorPage key="edit" />} />
                  <Route path="bons" element={<NotesListPage />} />
                  <Route path="bons/:id" element={<NoteDetailPage />} />
                  <Route path="lots" element={<BatchPage />} />
                  <Route path="tva/import" element={<ImportPage />} />
                  <Route path="tva/import-excel" element={<ImportExcelPage />} />
                  <Route path="tva/controle" element={<ReviewPage />} />
                  <Route path="tva/ventes" element={<JournalPage key="sale" kind="sale" />} />
                  <Route path="tva/achats" element={<JournalPage key="purchase" kind="purchase" />} />
                  <Route path="tva/declaration" element={<DeclarationPage />} />
                  <Route path="clients" element={<PartiesPage kind="client" />} />
                  <Route path="fournisseurs" element={<PartiesPage kind="supplier" />} />
                  <Route path="catalogue" element={<ProductsPage />} />
                  <Route path="modeles" element={<TemplatesPage />} />
                  <Route path="entreprises" element={<CompaniesPage />} />
                  <Route path="parametres" element={<SettingsPage />} />
                  <Route path="utilisateurs" element={<UsersPage />} />
                  <Route path="journal" element={<ManageOnly><AuditPage /></ManageOnly>} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </Suspense>
          </RequireCompany>
        </Gate>
      </BrowserRouter>
      <Toaster position="top-right" richColors closeButton />
    </SessionProvider>
  );
}
