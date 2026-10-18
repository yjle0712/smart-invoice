import {
  forwardRef, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from "react";
import { Loader2, X } from "lucide-react";
import { cn, STATUS_LABEL } from "@/lib/utils";
import type { InvoiceStatus } from "@/lib/types";

// ---------------------------------------------------------------------
// Boutons
// ---------------------------------------------------------------------
type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink-800 text-white hover:bg-ink-700 disabled:bg-ink-300",
  accent: "bg-saffron-500 text-ink-900 hover:bg-saffron-400 disabled:opacity-50",
  secondary: "bg-white text-text border border-line hover:bg-ink-50 disabled:opacity-50",
  ghost: "text-ink-700 hover:bg-ink-50 disabled:opacity-40",
  danger: "bg-danger text-white hover:brightness-110 disabled:opacity-50",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------
// Champs
// ---------------------------------------------------------------------
const fieldBase =
  "w-full rounded-md border border-line bg-white px-3 text-sm text-text placeholder:text-muted/70 " +
  "focus:border-ink-500 focus:outline-none focus:ring-2 focus:ring-ink-100 disabled:bg-canvas disabled:text-muted";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest }, ref,
) {
  return <input ref={ref} className={cn(fieldBase, "h-9", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest }, ref,
) {
  return <textarea ref={ref} className={cn(fieldBase, "min-h-20 py-2", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest }, ref,
) {
  return (
    <select ref={ref} className={cn(fieldBase, "h-9 pr-8", className)} {...rest}>
      {children}
    </select>
  );
});

export function Field({
  label, hint, error, required, children, className,
}: { label: string; hint?: ReactNode; error?: string | null; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-[13px] font-medium text-text">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </span>
      {children}
      {error ? <span className="text-xs text-danger">{error}</span> : hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Checkbox({
  label, checked, onChange, disabled, hint,
}: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: ReactNode }) {
  return (
    <label className={cn("flex items-start gap-2.5 py-1", disabled && "opacity-60")}>
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-ink-700"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-sm">
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------
// Mise en page
// ---------------------------------------------------------------------
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">{title}</h1>
        {description && <p className="mt-0.5 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cn("rounded-lg border border-line bg-white", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Spinner({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="m-4 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger" role="alert">
      {message}
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-2 font-medium underline">
          Réessayer
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <p className="font-medium text-ink-900">{title}</p>
      {children && <p className="mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const STATUS_STYLE: Record<InvoiceStatus, string> = {
  draft: "bg-canvas text-muted border-line",
  validated: "bg-ink-50 text-ink-700 border-ink-100",
  partially_paid: "bg-saffron-50 text-saffron-700 border-saffron-100",
  paid: "bg-success/10 text-success border-success/20",
  cancelled: "bg-danger/5 text-danger border-danger/20 line-through",
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={cn("inline-flex rounded border px-1.5 py-0.5 text-xs font-medium", STATUS_STYLE[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" | "danger" | "ok" }) {
  const tones = {
    neutral: "bg-canvas text-muted border-line",
    warn: "bg-saffron-50 text-saffron-700 border-saffron-100",
    danger: "bg-danger/5 text-danger border-danger/20",
    ok: "bg-success/10 text-success border-success/20",
  };
  return <span className={cn("inline-flex rounded border px-1.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

/** Tableau responsive : défilement horizontal sur petit écran. */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm [&_td]:border-t [&_td]:border-line [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted [&_th]:whitespace-nowrap [&_tbody_tr:hover]:bg-ink-50/40", className)}>
        {children}
      </table>
    </div>
  );
}

export function Pagination({
  page, pageSize, total, onPage,
}: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between border-t border-line px-3 py-2 text-sm text-muted">
      <span className="num">
        {page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} sur {total}
      </span>
      <div className="flex gap-1">
        <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => onPage(page - 1)}>
          Précédent
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
          Suivant
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Fenêtres modales (élément <dialog> natif : focus et Échap gérés par le navigateur)
// ---------------------------------------------------------------------
export function Dialog({
  open, onClose, title, children, footer, wide,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-lg border border-line bg-white p-0 text-text shadow-xl backdrop:bg-ink-900/40",
        wide ? "max-w-3xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-semibold text-ink-900">{title}</h2>
            <button type="button" onClick={onClose} className="rounded p-1 text-muted hover:bg-canvas" aria-label="Fermer">
              <X className="size-4" />
            </button>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/** Confirmation avec saisie facultative (motif). */
export function ConfirmDialog({
  open, title, message, confirmLabel, danger, reasonLabel, onConfirm, onClose,
}: {
  open: boolean; title: string; message: ReactNode; confirmLabel: string; danger?: boolean;
  reasonLabel?: string; onConfirm: (reason: string) => Promise<void> | void; onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setReason(""); }, [open]);
  const needsReason = Boolean(reasonLabel);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Retour</Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={busy}
            disabled={needsReason && reason.trim().length < 5}
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(reason.trim()); } finally { setBusy(false); }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-text">{message}</div>
      {needsReason && (
        <Field label={reasonLabel!} hint="5 caractères minimum. Enregistré dans l'historique." className="mt-4">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      )}
    </Dialog>
  );
}
