import { useEffect, useState } from "react";
import { Download, Share } from "lucide-react";
import { Dialog, Button } from "@/components/ui";

interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

/** Bouton « Installer l'application » (ordinateur et Android) ; explication pour iPhone / iPad. */
export function InstallAppButton() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHelp, setIosHelp] = useState(false);
  const standalone = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
  const ios = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as BeforeInstallPromptEvent); };
    const onInstalled = () => setEvt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (standalone || (!evt && !ios)) return null;
  return (
    <>
      <button
        type="button"
        className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-saffron-500/90 px-2 py-1.5 text-xs font-medium text-ink-900 hover:bg-saffron-400"
        onClick={async () => {
          if (evt) { await evt.prompt(); await evt.userChoice.catch(() => null); setEvt(null); }
          else setIosHelp(true);
        }}
      >
        <Download className="size-3.5" /> Installer l'application
      </button>
      <Dialog open={iosHelp} onClose={() => setIosHelp(false)} title="Installer sur iPhone / iPad"
        footer={<Button onClick={() => setIosHelp(false)}>Compris</Button>}>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Ouvrez le site dans <b>Safari</b>.</li>
          <li>Touchez le bouton <b>Partager</b> <Share className="inline size-4" /> en bas de l'écran.</li>
          <li>Choisissez <b>« Sur l'écran d'accueil »</b>, puis <b>Ajouter</b>.</li>
        </ol>
        <p className="mt-3 text-sm text-muted">L'icône Smart Invoice apparaît sur l'écran d'accueil et s'ouvre comme une application.</p>
      </Dialog>
    </>
  );
}
