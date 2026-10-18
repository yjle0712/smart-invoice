import type { ReactNode } from "react";
import type { TemplateBase, TemplateSettings } from "@/lib/types";
import { TEMPLATE_PRESETS, resolveLook } from "@/pdf/templates";
import { Checkbox } from "@/components/ui";
import { cn } from "@/lib/utils";

type Set = <K extends keyof TemplateSettings>(k: K, v: TemplateSettings[K]) => void;

/** Petite vignette dessinée : aperçu d'un style de tableau, de totaux ou d'en-tête. */
function Thumb({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 60 40" className="h-10 w-full" aria-hidden>{children}</svg>;
}

function Tile({ active, label, onClick, disabled, children }: { active: boolean; label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-pressed={active}
      className={cn("flex flex-col items-center gap-1 rounded-md border bg-white p-1.5 text-[11px] leading-tight transition",
        active ? "border-ink-600 ring-2 ring-ink-600/30" : "border-line hover:border-ink-300", disabled && "opacity-50")}>
      {children}
      <span className={cn("text-center", active ? "font-medium text-ink-800" : "text-muted")}>{label}</span>
    </button>
  );
}

function Group({ title, children, cols = 3 }: { title: string; children: ReactNode; cols?: number }) {
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-medium">{title}</div>
      <div className={cn("grid gap-1.5", cols === 3 ? "grid-cols-3" : cols === 4 ? "grid-cols-4" : "grid-cols-2")}>{children}</div>
    </div>
  );
}

const rows = [12, 19, 26, 33];

function TableThumb({ kind, color }: { kind: TemplateSettings["tableStyle"]; color: string }) {
  const head = kind === "filled" ? color : kind === "minimal" || kind === "lines" ? "none" : `${color}33`;
  return (
    <Thumb>
      <rect x="4" y="4" width="52" height="7" fill={head} stroke={kind === "grid" ? "#9aa1a8" : "none"} strokeWidth="0.6" />
      {(kind === "minimal" || kind === "lines") && <line x1="4" y1="11" x2="56" y2="11" stroke={color} strokeWidth="1.2" />}
      {rows.map((y, i) => (
        <g key={y}>
          {kind === "striped" && i % 2 === 1 && <rect x="4" y={y - 1} width="52" height="7" fill={`${color}22`} />}
          <rect x="7" y={y + 1.5} width="22" height="2" rx="1" fill="#b8bec5" />
          <rect x="44" y={y + 1.5} width="9" height="2" rx="1" fill="#b8bec5" />
          {(kind === "lines" || kind === "filled" || kind === "striped" || kind === "") && <line x1="4" y1={y + 6} x2="56" y2={y + 6} stroke="#d5d9de" strokeWidth="0.6" />}
        </g>
      ))}
      {kind === "grid" && (
        <g stroke="#9aa1a8" strokeWidth="0.6" fill="none">
          <rect x="4" y="4" width="52" height="34" />
          <line x1="38" y1="4" x2="38" y2="38" />
          {rows.map((y) => <line key={y} x1="4" y1={y + 6} x2="56" y2={y + 6} />)}
        </g>
      )}
    </Thumb>
  );
}

function TotalsThumb({ kind, color }: { kind: TemplateSettings["totalsStyle"]; color: string }) {
  return (
    <Thumb>
      {kind === "box" && <rect x="22" y="5" width="34" height="30" fill="none" stroke="#9aa1a8" strokeWidth="0.7" />}
      {[9, 16].map((y) => <g key={y}><rect x="25" y={y} width="12" height="2" rx="1" fill="#b8bec5" /><rect x="44" y={y} width="9" height="2" rx="1" fill="#b8bec5" /></g>)}
      {kind === "plain"
        ? <><line x1="22" y1="24" x2="56" y2="24" stroke={color} strokeWidth="1.2" /><rect x="25" y="27" width="14" height="3" rx="1" fill={color} /><rect x="42" y="27" width="11" height="3" rx="1" fill={color} /></>
        : <><rect x="22" y="24" width="34" height="9" fill={color} /><rect x="25" y="27" width="14" height="3" rx="1" fill="#fff" /><rect x="42" y="27" width="11" height="3" rx="1" fill="#fff" /></>}
    </Thumb>
  );
}

function HeaderThumb({ kind, color }: { kind: TemplateSettings["headerStyle"]; color: string }) {
  const title = (x: number, y: number, fill = color) => <rect x={x} y={y} width="16" height="4" rx="1" fill={fill} />;
  const company = (x: number, y: number, fill = "#9aa1a8") => <><rect x={x} y={y} width="18" height="3" rx="1" fill={fill} /><rect x={x} y={y + 5} width="13" height="2" rx="1" fill={fill} opacity={0.6} /></>;
  switch (kind) {
    case "band": return <Thumb><rect x="0" y="2" width="60" height="16" fill={color} />{company(5, 6, "#fff")}{title(38, 8, "#fff")}</Thumb>;
    case "split": return <Thumb>{company(5, 6)}<rect x="36" y="3" width="21" height="14" fill={color} />{title(38, 8, "#fff")}<line x1="4" y1="20" x2="56" y2="20" stroke={color} strokeWidth="1.2" /></Thumb>;
    case "centered": return <Thumb><rect x="21" y="3" width="18" height="3" rx="1" fill="#9aa1a8" /><line x1="6" y1="10" x2="54" y2="10" stroke={color} strokeWidth="1.2" />{title(22, 13)}</Thumb>;
    case "boxed": return <Thumb><rect x="3" y="3" width="54" height="17" fill="none" stroke={`${color}99`} strokeWidth="0.8" />{company(6, 7)}{title(37, 8)}</Thumb>;
    case "plain": return <Thumb>{company(5, 6)}{title(39, 7)}</Thumb>;
    case "none": return <Thumb><rect x="3" y="2" width="54" height="10" fill="#e5e7eb" />{title(39, 15)}</Thumb>;
    default: return <Thumb>{company(5, 6)}{title(39, 7)}<line x1="4" y1="18" x2="56" y2="18" stroke={color} strokeWidth="1.4" /></Thumb>;
  }
}

function ColumnsThumb({ kind }: { kind: TemplateSettings["columns"] }) {
  const labels = kind === "ttc" ? ["Désignation", "Qté", "PU TTC", "Total TTC"] : kind === "ht" ? ["Désignation", "Qté", "PU HT", "Total HT"] : ["Désig.", "Qté", "PU HT", "TVA", "HT", "TTC"];
  return (
    <div className="flex h-10 w-full items-center gap-px overflow-hidden rounded-sm bg-ink-50 px-0.5 text-[7px] leading-none text-ink-800">
      {labels.map((l, i) => <span key={l} className={cn("truncate rounded-sm bg-white px-0.5 py-1 text-center", i === 0 ? "flex-[2]" : "flex-1")}>{l}</span>)}
    </div>
  );
}

export function StyleOptions({ base, s, set, setMany, disabled }: {
  base: TemplateBase; s: TemplateSettings; set: Set; setMany: (p: Partial<TemplateSettings>) => void; disabled?: boolean;
}) {
  const look = resolveLook(base, s);
  const isLetterhead = base === "entete";
  // Les modèles complets (FERCIM, NOVASTRO, NORD) ont leur propre mise en page : on les choisit dans « Nouveau modèle ».
  const quick = TEMPLATE_PRESETS.filter((p) => !["entete", "fercim", "novastro", "nord"].includes(p.base));
  return (
    <div className="space-y-4 p-4">
      <Group title="Style rapide (un clic applique tout le style)" cols={4}>
        {quick.map((p) => (
          <Tile key={p.base} label={p.label} disabled={disabled}
            active={look.table === p.look.table && look.totals === p.look.totals && (isLetterhead || look.header === p.look.header) && s.color === (p.defaults.color ?? s.color)}
            onClick={() => setMany({
              tableStyle: p.look.table, totalsStyle: p.look.totals, tableHeader: p.look.neutralHeader ? "neutral" : "color",
              ...(isLetterhead ? {} : { headerStyle: p.look.header }),
              color: (p.defaults.color as string) ?? s.color, font: p.defaults.font ?? "Helvetica",
            })}>
            <TableThumb kind={p.look.table} color={(p.defaults.color as string) ?? s.color} />
          </Tile>
        ))}
      </Group>

      <Group title="Tableau des articles">
        {([["grid", "Quadrillé"], ["lines", "Lignes"], ["striped", "Lignes alternées"], ["filled", "En-tête plein"], ["minimal", "Minimal"]] as const).map(([k, l]) => (
          <Tile key={k} label={l} active={look.table === k} disabled={disabled} onClick={() => set("tableStyle", k)}><TableThumb kind={k} color={s.color} /></Tile>
        ))}
      </Group>

      <Group title="Couleur de l'en-tête du tableau" cols={2}>
        <Tile label="Couleur du modèle" active={!look.neutralHeader} disabled={disabled} onClick={() => set("tableHeader", "color")}>
          <div className="h-10 w-full rounded-sm" style={{ backgroundColor: s.color }} />
        </Tile>
        <Tile label="Gris neutre" active={Boolean(look.neutralHeader)} disabled={disabled} onClick={() => set("tableHeader", "neutral")}>
          <div className="h-10 w-full rounded-sm bg-[#eef0f2]" />
        </Tile>
      </Group>

      <Group title="Colonnes de prix">
        {([["ttc", "Prix TTC"], ["ht", "Prix HT"], ["full", "Détaillé HT, TVA, TTC"]] as const).map(([k, l]) => (
          <Tile key={k} label={l} active={s.columns === k} disabled={disabled} onClick={() => set("columns", k)}><ColumnsThumb kind={k} /></Tile>
        ))}
      </Group>

      <Group title="Totaux">
        {([["box", "Encadré"], ["plain", "Simple"], ["band", "Bandeau"]] as const).map(([k, l]) => (
          <Tile key={k} label={l} active={look.totals === k} disabled={disabled} onClick={() => set("totalsStyle", k)}><TotalsThumb kind={k} color={s.color} /></Tile>
        ))}
      </Group>

      <Group title={isLetterhead ? "En-tête (votre papier à en-tête est conservé)" : "En-tête de la facture"}>
        {(isLetterhead
          ? ([["none", "Titre seul"], ["plain", "Avec bloc entreprise"]] as const)
          : ([["line", "Filet"], ["band", "Bandeau"], ["plain", "Simple"], ["boxed", "Encadré"], ["split", "Titre en couleur"], ["centered", "Centré"]] as const)
        ).map(([k, l]) => (
          <Tile key={k} label={l} active={look.header === k} disabled={disabled}
            onClick={() => isLetterhead ? setMany({ headerStyle: k, showCompanyBlock: k !== "none" }) : set("headerStyle", k)}>
            <HeaderThumb kind={k} color={s.color} />
          </Tile>
        ))}
      </Group>

      <Group title="Hauteur des lignes">
        {([["compact", "Serrée"], ["normal", "Normale"], ["airy", "Aérée"]] as const).map(([k, l]) => (
          <Tile key={k} label={l} active={s.rowDensity === k} disabled={disabled} onClick={() => set("rowDensity", k)}>
            <Thumb>{Array.from({ length: k === "compact" ? 6 : k === "airy" ? 3 : 4 }, (_, i) => {
              const gap = k === "compact" ? 6 : k === "airy" ? 11 : 8.5;
              return <rect key={i} x="6" y={5 + i * gap} width="48" height="2.2" rx="1" fill="#b8bec5" />;
            })}</Thumb>
          </Tile>
        ))}
      </Group>

      <div className="grid grid-cols-2 gap-x-3">
        <Checkbox label="Numéroter les lignes" checked={s.lineNumbers} disabled={disabled} onChange={(v) => set("lineNumbers", v)} />
        <Checkbox label="Afficher l'unité (KG, L…)" checked={s.showUnit} disabled={disabled} onChange={(v) => set("showUnit", v)} />
      </div>
    </div>
  );
}
