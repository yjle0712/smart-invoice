import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { InvoicePdfData } from "./InvoiceDocument";
import { renderPdfBlob } from "./export";

/**
 * Aperçu exact : le PDF est généré par le même moteur que le téléchargement,
 * puis affiché dans le lecteur PDF du navigateur. Écran = fichier téléchargé.
 */
export function PdfPreview({ data, className, height = 820 }: { data: InvoicePdfData | null; className?: string; height?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    let created: string | null = null;
    setBusy(true);
    setError(null);
    // Petit délai : évite de régénérer à chaque frappe pendant la saisie.
    const t = setTimeout(() => {
      renderPdfBlob(data)
        .then((blob) => {
          if (cancelled) return;
          created = URL.createObjectURL(blob);
          setUrl((old) => {
            if (old) URL.revokeObjectURL(old);
            return created;
          });
        })
        .catch((e: Error) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setBusy(false));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [data]);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  return (
    <div className={className}>
      <div className="relative overflow-hidden rounded-md border border-line bg-[#525659]" style={{ height }}>
        {url && <iframe title="Aperçu de la facture" src={`${url}#toolbar=1&navpanes=0&view=FitH`} className="size-full" />}
        {(busy || (!url && !error)) && (
          <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-2 bg-white/90 py-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Génération de l'aperçu…
          </div>
        )}
        {error && <div className="absolute inset-x-0 top-0 bg-danger/10 p-3 text-sm text-danger">Aperçu impossible : {error}</div>}
      </div>
    </div>
  );
}
