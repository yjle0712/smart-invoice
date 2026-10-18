import { useRef, useState } from "react";
import type { BlockPos, FreeBlock } from "@/lib/types";
import { BLOCK_LABEL, DEFAULT_POSITIONS } from "@/pdf/templates";
import { cn } from "@/lib/utils";

const PAGE_W = 210;
const PAGE_H = 297;
const COLORS: Record<FreeBlock, string> = {
  company: "#2c6560", title: "#b07d1a", client: "#1e4f8a", meta: "#7c3aed", table: "#b4372f",
};
/** Hauteur indicative des blocs (mm) pour l'affichage dans l'éditeur. */
const HEIGHT: Record<FreeBlock, number> = { company: 22, title: 18, client: 24, meta: 20, table: 40 };

/**
 * Éditeur visuel : la page A4 (avec le papier à en-tête importé) et les blocs à glisser.
 * Les positions sont en millimètres ; le rendu PDF utilise exactement ces valeurs.
 */
export function FreeLayoutEditor({
  background, positions, onChange, disabled, hidden = [],
}: {
  background: string | null;
  positions: Record<FreeBlock, BlockPos>;
  onChange: (p: Record<FreeBlock, BlockPos>) => void;
  disabled?: boolean;
  hidden?: FreeBlock[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<FreeBlock | null>(null);
  const drag = useRef<{ block: FreeBlock; mode: "move" | "resize"; startX: number; startY: number; orig: BlockPos } | null>(null);

  const mmPerPx = () => PAGE_W / (ref.current?.clientWidth || 420);

  const onPointerDown = (e: React.PointerEvent, block: FreeBlock, mode: "move" | "resize") => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { block, mode, startX: e.clientX, startY: e.clientY, orig: positions[block] };
    setActive(block);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const k = mmPerPx();
    const dx = (e.clientX - d.startX) * k;
    const dy = (e.clientY - d.startY) * k;
    const o = d.orig;
    const next = { ...positions };
    if (d.mode === "move") {
      next[d.block] = {
        ...o,
        x: Math.round(Math.min(PAGE_W - 10, Math.max(0, o.x + dx))),
        y: Math.round(Math.min(PAGE_H - 20, Math.max(0, o.y + dy))),
      };
    } else {
      next[d.block] = { ...o, w: Math.round(Math.min(PAGE_W - o.x, Math.max(30, o.w + dx))) };
    }
    onChange(next);
  };
  const onPointerUp = () => { drag.current = null; };

  const nudge = (block: FreeBlock, dx: number, dy: number) => {
    const o = positions[block];
    onChange({ ...positions, [block]: { ...o, x: Math.max(0, Math.min(PAGE_W - 10, o.x + dx)), y: Math.max(0, Math.min(PAGE_H - 20, o.y + dy)) } });
  };

  return (
    <div>
      <div
        ref={ref}
        className="relative w-full max-w-[460px] select-none overflow-hidden rounded border border-line bg-white shadow-sm"
        style={{ aspectRatio: `${PAGE_W} / ${PAGE_H}`, backgroundImage: background ? `url(${background})` : undefined, backgroundSize: "100% 100%" }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {!background && <div className="absolute inset-0 grid place-items-center text-xs text-muted">Aucun fond : importez votre papier à en-tête</div>}
        {(Object.keys(positions) as FreeBlock[]).filter((b) => !hidden.includes(b)).map((b) => {
          const p = positions[b];
          return (
            <div
              key={b}
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-label={`${BLOCK_LABEL[b]} : x ${p.x} mm, y ${p.y} mm, largeur ${p.w} mm (flèches pour déplacer)`}
              onPointerDown={(e) => onPointerDown(e, b, "move")}
              onFocus={() => setActive(b)}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 5 : 1;
                if (e.key === "ArrowLeft") { e.preventDefault(); nudge(b, -step, 0); }
                if (e.key === "ArrowRight") { e.preventDefault(); nudge(b, step, 0); }
                if (e.key === "ArrowUp") { e.preventDefault(); nudge(b, 0, -step); }
                if (e.key === "ArrowDown") { e.preventDefault(); nudge(b, 0, step); }
              }}
              className={cn("absolute rounded-sm border-2 border-dashed text-[10px] font-medium leading-tight outline-none", disabled ? "cursor-default" : "cursor-move", active === b && "ring-2 ring-offset-1")}
              style={{
                left: `${(p.x / PAGE_W) * 100}%`, top: `${(p.y / PAGE_H) * 100}%`, width: `${(p.w / PAGE_W) * 100}%`, height: `${(HEIGHT[b] / PAGE_H) * 100}%`,
                borderColor: COLORS[b], backgroundColor: `${COLORS[b]}1f`, color: COLORS[b],
              }}
            >
              <span className="m-0.5 inline-block rounded bg-white/90 px-1">{BLOCK_LABEL[b]}</span>
              {b === "table" && <span className="absolute bottom-0.5 left-1 bg-white/90 px-1 text-[9px]">↓ le tableau et les totaux continuent vers le bas</span>}
              {!disabled && (
                <span
                  onPointerDown={(e) => onPointerDown(e, b, "resize")}
                  className="absolute right-0 top-0 h-full w-2 cursor-ew-resize"
                  style={{ backgroundColor: COLORS[b] }}
                  title="Largeur"
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted">
        Glissez les blocs à leur place, tirez le bord droit pour la largeur (ou clic puis flèches du clavier, Maj = 5 mm).
        Le tableau, les totaux et le montant en lettres suivent le tableau et passent sur les pages suivantes si nécessaire.
      </p>
      {active && <p className="text-xs text-text">{BLOCK_LABEL[active]} : x {positions[active].x} mm · y {positions[active].y} mm · largeur {positions[active].w} mm</p>}
    </div>
  );
}

export { DEFAULT_POSITIONS };
