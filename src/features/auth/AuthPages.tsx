import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase, errorMessage } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Button, Field, Input } from "@/components/ui";

type Mode = "login" | "signup" | "forgot";

function AuthFrame({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(420px,520px)]">
      <div className="zellige relative hidden flex-col justify-between p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-10" />
          <span className="text-lg font-semibold">Smart Invoice</span>
        </div>
        <div className="max-w-md">
          <p className="text-3xl font-semibold leading-tight">
            Factures conformes, numérotation sans trou, TVA ventilée par taux.
          </p>
          <p className="mt-4 text-ink-100">
            Pour les entreprises, commerçants et fiduciaires au Maroc : plusieurs sociétés, plusieurs utilisateurs,
            chacun avec ses droits.
          </p>
        </div>
        <p className="text-xs text-ink-200">ICE · IF · RC · TP — montants en dirhams, arrêtés en toutes lettres.</p>
      </div>
      <div className="flex items-center justify-center bg-white p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <img src="/favicon.svg" alt="" className="size-8" />
            <span className="font-semibold text-ink-900">Smart Invoice</span>
          </div>
          <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
          <p className="mb-6 mt-1 text-sm text-muted">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setInfo(null);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        if (password.length < 8) throw new Error("Le mot de passe doit contenir au moins 8 caractères.");
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: fullName }, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) setInfo("Compte créé. Ouvrez le lien de confirmation envoyé à " + email + ", puis connectez-vous.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) throw error;
        setInfo("Si un compte existe pour " + email + ", un lien de réinitialisation vient d'être envoyé.");
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Mode, [string, string]> = {
    login: ["Connexion", "Accédez à vos entreprises et à vos factures."],
    signup: ["Créer un compte", "Vous pourrez ensuite créer votre entreprise ou rejoindre celle d'un collègue."],
    forgot: ["Mot de passe oublié", "Recevez un lien pour choisir un nouveau mot de passe."],
  };

  return (
    <AuthFrame title={titles[mode][0]} subtitle={titles[mode][1]}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {mode === "signup" && (
          <Field label="Nom complet">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
          </Field>
        )}
        <Field label="Adresse e-mail" required>
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </Field>
        {mode !== "forgot" && (
          <Field label="Mot de passe" required hint={mode === "signup" ? "8 caractères minimum." : undefined}>
            <Input
              type="password" required minLength={mode === "signup" ? 8 : undefined}
              value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </Field>
        )}
        {info && <p className="rounded-md bg-ink-50 p-3 text-sm text-ink-700">{info}</p>}
        <Button type="submit" loading={busy} className="mt-1">
          {mode === "login" ? "Se connecter" : mode === "signup" ? "Créer le compte" : "Envoyer le lien"}
        </Button>
      </form>
      <div className="mt-6 flex flex-col gap-2 text-sm">
        {mode !== "login" && (
          <button type="button" className="text-left text-ink-700 hover:underline" onClick={() => setMode("login")}>
            J'ai déjà un compte : me connecter
          </button>
        )}
        {mode !== "signup" && (
          <button type="button" className="text-left text-ink-700 hover:underline" onClick={() => setMode("signup")}>
            Créer un compte
          </button>
        )}
        {mode !== "forgot" && (
          <button type="button" className="text-left text-ink-700 hover:underline" onClick={() => setMode("forgot")}>
            Mot de passe oublié
          </button>
        )}
      </div>
    </AuthFrame>
  );
}

export function UpdatePasswordPage() {
  const { clearRecovery } = useSession();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return toast.error("Le mot de passe doit contenir au moins 8 caractères.");
    if (password !== confirm) return toast.error("Les deux mots de passe ne correspondent pas.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    toast.success("Mot de passe modifié.");
    clearRecovery();
  };

  return (
    <AuthFrame title="Nouveau mot de passe" subtitle="Choisissez votre nouveau mot de passe.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Nouveau mot de passe" required hint="8 caractères minimum.">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Confirmer" required>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
        <Button type="submit" loading={busy}>Enregistrer le mot de passe</Button>
      </form>
    </AuthFrame>
  );
}

export function SetupScreen() {
  return (
    <AuthFrame title="Configuration requise" subtitle="L'application n'est pas encore reliée à votre base Supabase.">
      <ol className="list-decimal space-y-2 pl-5 text-sm text-text">
        <li>Copiez le fichier <code className="rounded bg-canvas px-1">.env.example</code> en <code className="rounded bg-canvas px-1">.env.local</code>.</li>
        <li>Renseignez <code className="rounded bg-canvas px-1">VITE_SUPABASE_URL</code> et <code className="rounded bg-canvas px-1">VITE_SUPABASE_ANON_KEY</code> (Supabase → Project Settings → API).</li>
        <li>Redémarrez <code className="rounded bg-canvas px-1">npm run dev</code>.</li>
      </ol>
      <p className="mt-4 text-sm text-muted">Sur Vercel, ajoutez ces deux variables dans Settings → Environment Variables, puis redéployez.</p>
    </AuthFrame>
  );
}
