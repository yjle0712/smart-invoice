import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase, must, errorMessage, storageToDataUrl } from "@/lib/supabase";
import type { Company } from "@/lib/types";
import { isValidIce, orNull } from "@/lib/utils";
import { Button, Checkbox, Field, Input, Textarea } from "@/components/ui";

type FormState = {
  legal_name: string; ice: string; if_number: string; rc: string; tp: string; cnss: string;
  address: string; city: string; phone: string; email: string; bank_name: string; rib: string;
  show_phone: boolean; show_email: boolean; show_bank: boolean; legal_mentions: string;
};

const empty: FormState = {
  legal_name: "", ice: "", if_number: "", rc: "", tp: "", cnss: "", address: "", city: "",
  phone: "", email: "", bank_name: "", rib: "", show_phone: false, show_email: false, show_bank: false, legal_mentions: "",
};

export function CompanyForm({
  company, canEdit, onSaved,
}: { company: Company | null; canEdit: boolean; onSaved: (id: string) => void | Promise<void> }) {
  const [f, setF] = useState<FormState>(empty);
  const [busy, setBusy] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  useEffect(() => {
    if (!company) { setF(empty); setLogoPreview(null); return; }
    setF({
      legal_name: company.legal_name, ice: company.ice ?? "", if_number: company.if_number ?? "", rc: company.rc ?? "",
      tp: company.tp ?? "", cnss: company.cnss ?? "", address: company.address ?? "", city: company.city ?? "",
      phone: company.phone ?? "", email: company.email ?? "", bank_name: company.bank_name ?? "", rib: company.rib ?? "",
      show_phone: company.show_phone, show_email: company.show_email, show_bank: company.show_bank,
      legal_mentions: company.legal_mentions ?? "",
    });
    void storageToDataUrl(company.logo_path).then(setLogoPreview);
  }, [company]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const iceError = f.ice && !isValidIce(f.ice.trim()) ? "15 chiffres attendus." : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.legal_name.trim()) return toast.error("La raison sociale est obligatoire.");
    if (iceError) return toast.error("ICE de l'entreprise : " + iceError);
    setBusy(true);
    try {
      const id = company?.id ?? crypto.randomUUID();
      const row = {
        legal_name: f.legal_name.trim(), ice: orNull(f.ice), if_number: orNull(f.if_number), rc: orNull(f.rc),
        tp: orNull(f.tp), cnss: orNull(f.cnss), address: orNull(f.address), city: orNull(f.city), phone: orNull(f.phone),
        email: orNull(f.email), bank_name: orNull(f.bank_name), rib: orNull(f.rib), show_phone: f.show_phone,
        show_email: f.show_email, show_bank: f.show_bank, legal_mentions: orNull(f.legal_mentions),
      };
      if (company) must(await supabase.from("companies").update(row).eq("id", id));
      else must(await supabase.from("companies").insert({ id, ...row }));

      if (logoFile) {
        const ext = logoFile.type === "image/png" ? "png" : "jpg";
        const path = `${id}/logo-${Date.now()}.${ext}`;
        const up = await supabase.storage.from("company-assets").upload(path, logoFile, { contentType: logoFile.type });
        if (up.error) throw up.error;
        must(await supabase.from("companies").update({ logo_path: path }).eq("id", id));
        if (company?.logo_path) await supabase.storage.from("company-assets").remove([company.logo_path]);
        setLogoFile(null);
      }
      toast.success(company ? "Entreprise enregistrée." : "Entreprise créée.");
      await onSaved(id);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const removeLogo = async () => {
    if (!company?.logo_path) { setLogoFile(null); setLogoPreview(null); return; }
    try {
      must(await supabase.from("companies").update({ logo_path: null }).eq("id", company.id));
      await supabase.storage.from("company-assets").remove([company.logo_path]);
      setLogoPreview(null);
      toast.success("Logo supprimé.");
      await onSaved(company.id);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <form onSubmit={submit}>
      <fieldset disabled={!canEdit || busy} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Raison sociale" required className="sm:col-span-2 lg:col-span-3">
          <Input value={f.legal_name} onChange={(e) => set("legal_name", e.target.value)} />
        </Field>
        <Field label="ICE" error={iceError} hint="15 chiffres">
          <Input inputMode="numeric" value={f.ice} onChange={(e) => set("ice", e.target.value.replace(/\s/g, ""))} />
        </Field>
        <Field label="Identifiant fiscal (IF)"><Input value={f.if_number} onChange={(e) => set("if_number", e.target.value)} /></Field>
        <Field label="Registre de commerce (RC)"><Input value={f.rc} onChange={(e) => set("rc", e.target.value)} /></Field>
        <Field label="Taxe professionnelle (TP)"><Input value={f.tp} onChange={(e) => set("tp", e.target.value)} /></Field>
        <Field label="CNSS"><Input value={f.cnss} onChange={(e) => set("cnss", e.target.value)} /></Field>
        <Field label="Ville"><Input value={f.city} onChange={(e) => set("city", e.target.value)} /></Field>
        <Field label="Adresse" className="sm:col-span-2 lg:col-span-3">
          <Input value={f.address} onChange={(e) => set("address", e.target.value)} />
        </Field>

        <Field label="Téléphone"><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="E-mail"><Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <div />
        <Field label="Banque"><Input value={f.bank_name} onChange={(e) => set("bank_name", e.target.value)} /></Field>
        <Field label="RIB" className="lg:col-span-2"><Input value={f.rib} onChange={(e) => set("rib", e.target.value)} /></Field>

        <div className="sm:col-span-2 lg:col-span-3">
          <div className="text-[13px] font-medium">Affichage sur les factures</div>
          <p className="text-xs text-muted">Masqués par défaut : cochez uniquement ce qui doit apparaître.</p>
          <div className="mt-1 flex flex-wrap gap-x-6">
            <Checkbox label="Téléphone" checked={f.show_phone} onChange={(v) => set("show_phone", v)} />
            <Checkbox label="E-mail" checked={f.show_email} onChange={(v) => set("show_email", v)} />
            <Checkbox label="Banque et RIB" checked={f.show_bank} onChange={(v) => set("show_bank", v)} />
          </div>
        </div>

        <Field label="Mentions légales (pied de facture)" className="sm:col-span-2 lg:col-span-3">
          <Textarea value={f.legal_mentions} onChange={(e) => set("legal_mentions", e.target.value)} rows={2} />
        </Field>

        <div className="sm:col-span-2 lg:col-span-3">
          <div className="text-[13px] font-medium">Logo</div>
          <div className="mt-1 flex flex-wrap items-center gap-4">
            <div className="flex h-16 w-40 items-center justify-center rounded border border-dashed border-line bg-canvas">
              {logoPreview ? <img src={logoPreview} alt="Logo" className="max-h-14 max-w-36 object-contain" /> : <span className="text-xs text-muted">Aucun logo</span>}
            </div>
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="text-sm"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (!["image/png", "image/jpeg"].includes(file.type)) return toast.error("Format accepté : PNG ou JPEG.");
                if (file.size > 1_000_000) return toast.error("Logo trop lourd (1 Mo maximum).");
                setLogoFile(file);
                setLogoPreview(URL.createObjectURL(file));
              }}
            />
            {logoPreview && <Button size="sm" variant="ghost" onClick={removeLogo}>Retirer le logo</Button>}
          </div>
        </div>
      </fieldset>
      {canEdit ? (
        <div className="mt-5 flex justify-end">
          <Button type="submit" loading={busy}>{company ? "Enregistrer" : "Créer l'entreprise"}</Button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">Seul un administrateur peut modifier ces informations.</p>
      )}
    </form>
  );
}
