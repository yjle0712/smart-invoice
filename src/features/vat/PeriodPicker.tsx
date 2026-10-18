import { Input, Select } from "@/components/ui";
import { MONTH_NAMES, periodBounds } from "./vatCommon";

export interface PeriodValue { mode: "mensuel" | "trimestriel" | "annee" | "custom"; year: number; index: number; from: string; to: string }

export function initialPeriod(mode: "mensuel" | "trimestriel"): PeriodValue {
  const d = new Date();
  const year = d.getFullYear();
  const index = mode === "mensuel" ? d.getMonth() + 1 : Math.floor(d.getMonth() / 3) + 1;
  const [from, to] = periodBounds(mode, year, index);
  return { mode, year, index, from, to };
}

export function withBounds(p: PeriodValue): PeriodValue {
  if (p.mode === "custom") return p;
  if (p.mode === "annee") return { ...p, from: `${p.year}-01-01`, to: `${p.year}-12-31` };
  const [from, to] = periodBounds(p.mode, p.year, p.index);
  return { ...p, from, to };
}

/** Choix de la période comptable : mois, trimestre, année ou dates libres. */
export function PeriodPicker({ value, onChange }: { value: PeriodValue; onChange: (p: PeriodValue) => void }) {
  const years = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() + 1 - i);
  const set = (patch: Partial<PeriodValue>) => onChange(withBounds({ ...value, ...patch }));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select className="w-36" value={value.mode} aria-label="Type de période"
        onChange={(e) => {
          const mode = e.target.value as PeriodValue["mode"];
          const idx = mode === "trimestriel" ? Math.min(4, Math.ceil(value.index / (value.mode === "mensuel" ? 3 : 1))) : mode === "mensuel" ? (value.mode === "trimestriel" ? (value.index - 1) * 3 + 1 : value.index) : value.index;
          set({ mode, index: Math.max(1, idx) });
        }}>
        <option value="mensuel">Mois</option><option value="trimestriel">Trimestre</option><option value="annee">Année</option><option value="custom">Dates libres</option>
      </Select>
      {value.mode === "mensuel" && (
        <Select className="w-36" value={value.index} onChange={(e) => set({ index: Number(e.target.value) })} aria-label="Mois">
          {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </Select>
      )}
      {value.mode === "trimestriel" && (
        <Select className="w-36" value={value.index} onChange={(e) => set({ index: Number(e.target.value) })} aria-label="Trimestre">
          {[1, 2, 3, 4].map((t) => <option key={t} value={t}>{t === 1 ? "1er" : `${t}e`} trimestre</option>)}
        </Select>
      )}
      {value.mode !== "custom" ? (
        <Select className="w-28" value={value.year} onChange={(e) => set({ year: Number(e.target.value) })} aria-label="Année">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
      ) : (
        <>
          <Input type="date" className="w-40" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label="Du" />
          <Input type="date" className="w-40" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label="Au" />
        </>
      )}
    </div>
  );
}
