"use client";

/**
 * Peças visuais compartilhadas das abas de Trocas (CLIMP e DDMX):
 * botões, cards, tooltip, ordenação, badges de bateria e status de troca.
 */

import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Estado mínimo de uma troca para rótulos/badges (CLIMP ou DDMX). */
export type TrocaStatusLike = { status: "agendada" | "concluida"; sucesso?: boolean | null };

// --- Design Constants ---
export const GLASS_CARD =
  "border border-border bg-card shadow-lg shadow-zinc-900/[0.06] dark:border-white/10 dark:bg-muted/60 dark:shadow-black/40";

export const BTN_EMERALD =
  "bg-linear-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-500 hover:to-teal-500 shadow-md shadow-emerald-950/10 border-0 font-semibold transition-all hover:scale-[1.01] active:scale-[0.99]";

export const BTN_SKY =
  "bg-linear-to-r from-sky-600 to-blue-600 text-white hover:from-sky-500 hover:to-blue-500 shadow-md shadow-blue-950/10 border-0 font-semibold transition-all hover:scale-[1.01] active:scale-[0.99]";

export const BTN_AMBER =
  "bg-linear-to-r from-amber-500 to-orange-600 text-white hover:from-amber-400 hover:to-orange-500 shadow-md shadow-orange-950/10 border-0 font-semibold transition-all hover:scale-[1.01] active:scale-[0.99]";

export const BTN_RED =
  "bg-linear-to-r from-red-600 to-rose-600 text-white hover:from-red-500 hover:to-rose-500 shadow-md shadow-rose-950/10 border-0 font-semibold transition-all hover:scale-[1.01] active:scale-[0.99]";

export const BTN_CYAN =
  "bg-linear-to-r from-cyan-500 to-sky-600 text-white hover:from-cyan-400 hover:to-sky-500 shadow-md shadow-cyan-950/10 border-0 font-semibold transition-all hover:scale-[1.01] active:scale-[0.99]";

export const BTN_SECONDARY =
  "bg-linear-to-r from-zinc-200 to-slate-300 dark:from-zinc-800 dark:to-slate-700 text-zinc-800 dark:text-zinc-200 hover:from-zinc-300 hover:to-slate-400 dark:hover:from-zinc-700/80 dark:hover:to-slate-600/80 shadow-sm border-0 font-semibold transition-all hover:scale-[1.01] active:scale-[0.99]";

export const EXPANDED_ROW =
  "bg-linear-to-r from-emerald-600 via-emerald-600 to-teal-700 text-zinc-100 shadow-[0_8px_24px_-12px_rgba(16,185,129,0.85)] [&_*]:!text-zinc-100";

export const SUCESSO_MIN_PCT_DEPOIS = 60;

/** Cabeçalho clicável com toggle de ordenação (desc → asc → nenhum). */
export function SortToggle({ label, dir, onClick }: { label: string; dir: "asc" | "desc" | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 whitespace-pre-line text-left leading-tight transition-colors hover:text-foreground",
        dir ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
      )}
      title="Ordenar"
    >
      {label}
      {dir === "desc" ? (
        <ArrowDown className="h-3.5 w-3.5" />
      ) : dir === "asc" ? (
        <ArrowUp className="h-3.5 w-3.5" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}

export function SetorCell({ value }: { value: string }) {
  const parts = value.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return <span className="max-w-[220px] font-mono text-xs leading-snug sm:text-sm">{value}</span>;
  }
  return (
    <div className="max-w-[220px] font-mono text-xs leading-snug sm:text-sm">
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 ? <br /> : null}
          {part}
        </span>
      ))}
    </div>
  );
}

/** Tooltip discreto fixo no viewport; suporta quebras de linha com \n. */
export function InfoTooltip({ text, children }: { text: string; children?: ReactNode }) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; placement: "top" | "bottom" } | null>(null);

  const show = useCallback(() => {
    const el = triggerRef.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    const tooltipHalfWidth = 130;
    const left = Math.min(window.innerWidth - tooltipHalfWidth - 12, Math.max(tooltipHalfWidth + 12, rect.left + rect.width / 2));
    const placement = rect.top > 96 ? "top" : "bottom";
    const top = placement === "top" ? rect.top - 8 : rect.bottom + 8;
    setPosition({ left, top, placement });
  }, []);

  const hide = useCallback(() => setPosition(null), []);

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex items-center"
      onMouseEnter={show}
      onMouseMove={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children ?? (
        <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground/70 transition-colors hover:text-foreground" />
      )}
      {position && typeof document !== "undefined"
        ? createPortal(
            <span
              role="tooltip"
              className="pointer-events-none fixed z-[9999] w-max max-w-[260px] -translate-x-1/2 whitespace-pre-line rounded-xl border border-border/70 bg-popover px-3 py-2 text-left text-xs font-normal leading-snug text-popover-foreground shadow-2xl ring-1 ring-black/5"
              style={{
                left: position.left,
                top: position.top,
                transform: position.placement === "top" ? "translate(-50%, -100%)" : "translate(-50%, 0)",
              }}
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

export const STATUS_BAT_OPTIONS = ["ALTA", "REGULAR", "BAIXA", "CRÍTICA", "DESATUALIZADA"];

/** Data de hoje em yyyy-MM-dd (horário local). */
export function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** yyyy-MM-dd → dd/MM/yyyy. */
export function fmtIsoBr(iso?: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export function fmtDisplayDate(value?: string): string {
  if (!value) return "—";
  const normalized = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? fmtIsoBr(normalized) : value;
}

/** Normaliza um percentual de bateria para o rótulo "XX%".
 * Aceita escala 0–100 (82 → "82%") ou decimal 0–1 (0.82 → "82%"); cai para o raw quando não há percentual. */
export function pctBatteryLabel(percent?: number | null, raw?: string): string {
  if (percent != null && Number.isFinite(Number(percent))) {
    const n = Number(percent);
    const v = n > 0 && n <= 1 ? Math.round(n * 100) : Math.round(n);
    return `${v}%`;
  }
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  const num = parseFloat(s.replace(",", "."));
  if (!Number.isNaN(num)) {
    const v = num > 0 && num <= 1 ? Math.round(num * 100) : Math.round(num);
    return `${v}%`;
  }
  return s;
}

/** Deriva o status da bateria a partir do percentual (mesmos limiares do backend:
 * >70 ALTA · >30 REGULAR · >15 BAIXA · senão CRÍTICA). */
export function statusBateriaFromPct(percent?: number | null): string | null {
  if (percent == null || !Number.isFinite(Number(percent))) return null;
  const n = Number(percent) > 0 && Number(percent) <= 1 ? Number(percent) * 100 : Number(percent);
  if (n > 70) return "ALTA";
  if (n > 30) return "REGULAR";
  if (n > 15) return "BAIXA";
  return "CRÍTICA";
}

export function trocaStatusLabel(item: TrocaStatusLike): string {
  if (item.status === "agendada") return "📅 Agendada";
  // sucesso é automático e tem 3 estados: indefinido = ainda sem leitura pós-troca.
  if (item.sucesso == null) return "⏳ Aguardando avaliação";
  return item.sucesso ? "✅ Concluída com sucesso" : "❌ Concluída sem sucesso";
}

/** Emoji correspondente ao estado da troca (para destacar na linha do histórico). */
export function trocaStatusEmoji(item: TrocaStatusLike): string {
  if (item.status === "agendada") return "📅";
  if (item.sucesso == null) return "⏳";
  return item.sucesso ? "✅" : "❌";
}

export function trocaStatusBadgeClass(item: TrocaStatusLike): string {
  if (item.status === "agendada") return "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400";
  if (item.sucesso == null) return "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300";
  return item.sucesso
    ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400"
    : "bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400";
}

export const STATUS_BAT_BADGE: Record<string, string> = {
  ALTA: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
  REGULAR: "bg-orange-500/15 text-orange-600 border-orange-500/30 dark:text-orange-400",
  BAIXA: "bg-blue-500/15 text-blue-600 border-blue-500/30 dark:text-blue-400",
  CRÍTICA: "bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400",
  DESATUALIZADA: "bg-purple-500/15 text-purple-600 border-purple-500/30 dark:text-purple-400",
};

export function statusBatBadge(status: string): string {
  return STATUS_BAT_BADGE[status] ?? "bg-zinc-500/15 text-zinc-600 border-zinc-500/30 dark:text-zinc-300";
}

export function getStatusColorClass(status: string | null | undefined): string {
  if (!status) return "text-foreground font-bold";
  const s = status.toUpperCase();
  if (s.includes("ALTA")) return "text-emerald-600 dark:text-emerald-400 font-bold";
  if (s.includes("REGULAR")) return "text-orange-600 dark:text-orange-400 font-bold";
  if (s.includes("BAIXA")) return "text-blue-600 dark:text-blue-400 font-bold";
  if (s.includes("CRÍTICA") || s.includes("CRITICA")) return "text-red-600 dark:text-red-400 font-bold";
  if (s.includes("DESATUALIZADA")) return "text-orange-500 dark:text-orange-400 font-bold";
  return "text-foreground font-bold";
}

export function renderBatteryStatus(status: string | null | undefined, showEmoji = true) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const cls = statusBatBadge(status);
  if (!showEmoji) {
    return (
      <Badge className={cn("font-semibold", cls)}>
        {status}
      </Badge>
    );
  }
  let emoji = "🔋";
  if (status === "REGULAR") emoji = "⚡";
  else if (status === "BAIXA") emoji = "⚠️";
  else if (status === "CRÍTICA") emoji = "🚨";
  else if (status === "DESATUALIZADA") emoji = "📴";
  return (
    <Badge className={cn("gap-1.5 font-semibold", cls)}>
      <span>{emoji}</span>
      <span>{status}</span>
    </Badge>
  );
}
