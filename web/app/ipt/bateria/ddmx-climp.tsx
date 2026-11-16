"use client";

import { useState } from "react";
import { Battery, Hash, Loader2, Radio, Wifi, WifiOff } from "lucide-react";
import type { DdmxModulo, StatusBateriaDdmx } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/motion-ui/motion-dialog";
import { BTN_SECONDARY, BTN_SKY, fmtIsoBr, renderBatteryStatus } from "./bateria-ui";

/** Bateria DDMX desatualizada → a troca DDMX já vem marcada no agendamento CLIMP. */
export function ddmxAutoMarcar(status: StatusBateriaDdmx): boolean {
  return status === "DESATUALIZADA";
}

export function statusDdmxBadge(status: StatusBateriaDdmx, showEmoji = false) {
  if (status === "SEM LEITURA") {
    return (
      <Badge className="gap-1.5 border-zinc-500/30 bg-zinc-500/15 font-semibold text-zinc-600 dark:text-zinc-300">
        {showEmoji && <span>❔</span>}
        SEM LEITURA
      </Badge>
    );
  }
  return renderBatteryStatus(status, showEmoji);
}

function pctLabel(pct: number | null | undefined): string {
  return pct != null && Number.isFinite(pct) ? `${Math.round(pct)}%` : "—";
}

/** Barra de bateria colorida pela faixa (mesmas cores do status). */
function BarraBateria({ pct, desatualizada }: { pct: number | null | undefined; desatualizada?: boolean }) {
  const v = pct != null && Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  const cor = desatualizada ? "bg-zinc-400" : v > 70 ? "bg-emerald-500" : v > 30 ? "bg-orange-500" : v > 15 ? "bg-blue-500" : "bg-red-500";
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full transition-all", cor)} style={{ width: `${v}%` }} />
    </div>
  );
}

/**
 * Card de bateria de um módulo (SELIMP ou DDMX) no agendamento: código,
 * status, percentual com barra e a leitura que embasa o status.
 */
export function BateriaModuloCard({
  titulo,
  codigo,
  status,
  pct,
  detalhe,
  comSinal,
  accent,
}: {
  titulo: string;
  codigo: string;
  status: React.ReactNode;
  pct: number | null | undefined;
  detalhe?: string;
  comSinal: boolean;
  accent?: "climp" | "ddmx";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        accent === "ddmx" ? "border-sky-500/30 bg-sky-500/5" : "border-border/60 bg-muted/30",
      )}
    >
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {accent === "ddmx" ? <Radio className="h-3.5 w-3.5 shrink-0 text-sky-500" /> : <Hash className="h-3.5 w-3.5 shrink-0" />}
        {titulo}
      </span>
      <div className="mt-0.5 flex flex-wrap items-center gap-2">
        <span className="font-medium">{codigo}</span>
        {status}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        {comSinal ? <Wifi className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <WifiOff className="h-3.5 w-3.5 shrink-0 text-red-500" />}
        <Battery className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-lg font-bold tabular-nums text-foreground">{pctLabel(pct)}</span>
        {detalhe && <span className="truncate text-[11px] text-muted-foreground">{detalhe}</span>}
      </div>
      <BarraBateria pct={pct} desatualizada={!comSinal} />
    </div>
  );
}

/** Card(s) "Módulo DDMX" ao lado do "Módulo SELIMP" no agendamento CLIMP. */
export function DdmxModuloCards({ modulos, loaded }: { modulos: DdmxModulo[]; loaded: boolean }) {
  if (!loaded) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando bateria DDMX…
      </div>
    );
  }
  if (modulos.length === 0) {
    return (
      <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Radio className="h-3.5 w-3.5 shrink-0 text-sky-500" /> Módulo DDMX
        </span>
        <p className="mt-1 text-sm font-medium text-muted-foreground">Sem módulo DDMX cadastrado</p>
        <p className="mt-1 text-[11px] text-muted-foreground">Cadastre o código DDMX do setor na aba Setores.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {modulos.map((d) => (
        <BateriaModuloCard
          key={d.ddmxCodigo}
          accent="ddmx"
          titulo="Módulo DDMX"
          codigo={d.ddmxCodigo}
          status={statusDdmxBadge(d.statusBateria)}
          pct={d.leitura?.bateria}
          comSinal={!!d.leitura && !d.leitura.desatualizada}
          detalhe={[
            d.leitura?.bateriaRaw,
            d.leitura ? `leitura ${fmtIsoBr(d.leitura.data).slice(0, 5)}` : "sem leitura recente",
            d.agendamento ? `já agendada p/ ${fmtIsoBr(d.agendamento.dataAgendada ?? "").slice(0, 5)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      ))}
    </div>
  );
}

/** Checkbox "Trocar bateria DDMX também" (auto-marcado quando a DDMX está desatualizada). */
export function DdmxJuntoCheckbox({
  modulos,
  checked,
  onCheckedChange,
}: {
  modulos: DdmxModulo[];
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  if (modulos.length === 0) return null;
  const auto = modulos.some((d) => ddmxAutoMarcar(d.statusBateria));
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
        checked ? "border-sky-500/50 bg-sky-500/10" : "border-border/60 bg-muted/20 hover:bg-muted/30",
      )}
    >
      <Checkbox checked={checked} onCheckedChange={(v) => onCheckedChange(Boolean(v))} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
          Trocar bateria DDMX também
          <span className="font-mono text-xs font-normal text-muted-foreground">({modulos.map((d) => d.ddmxCodigo).join(", ")})</span>
          {auto && (
            <Badge className="border-purple-500/30 bg-purple-500/15 text-[10px] text-purple-600 dark:text-purple-400">
              marcado: DDMX desatualizada
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          Agenda a DDMX na mesma data. Ao concluir a troca você confirma se a DDMX foi trocada; se não, ela fica em aberto na aba Trocas DDMX.
        </span>
      </span>
    </label>
  );
}

/** Linha DDMX de um módulo no agendamento em lote, com o checkbox por módulo. */
export function DdmxLoteLinha({
  modulos,
  checked,
  onCheckedChange,
}: {
  modulos: DdmxModulo[];
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  if (modulos.length === 0) {
    return <p className="mt-2 text-[11px] text-muted-foreground">Sem módulo DDMX cadastrado.</p>;
  }
  return (
    <label
      className={cn(
        "mt-2 flex cursor-pointer flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs",
        checked ? "border-sky-500/50 bg-sky-500/10" : "border-border/50 bg-muted/20",
      )}
    >
      <Checkbox checked={checked} onCheckedChange={(v) => onCheckedChange(Boolean(v))} />
      <Radio className="h-3.5 w-3.5 text-sky-500" />
      <span className="font-semibold">Trocar DDMX</span>
      {modulos.map((d) => (
        <span key={d.ddmxCodigo} className="inline-flex items-center gap-1.5">
          <span className="font-mono">{d.ddmxCodigo}</span>
          {statusDdmxBadge(d.statusBateria)}
          <span className="font-semibold tabular-nums">{pctLabel(d.leitura?.bateria)}</span>
        </span>
      ))}
    </label>
  );
}

export type DdmxPendente = { selimp: string; setor: string; modulo: DdmxModulo };

/**
 * "Bateria DDMX trocada?" — aberto ao concluir uma troca CLIMP que tinha a
 * DDMX agendada junto. Sim registra a troca DDMX; Não deixa em aberto.
 */
export function DdmxTrocadaDialog({
  pendentes,
  dataTroca,
  onConfirm,
  onClose,
}: {
  pendentes: DdmxPendente[];
  dataTroca: string;
  onConfirm: (trocados: DdmxPendente[]) => void;
  onClose: () => void;
}) {
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(pendentes.map((p) => p.modulo.ddmxCodigo)));
  const escolhidos = pendentes.filter((p) => marcados.has(p.modulo.ddmxCodigo));
  return (
    <Dialog open={pendentes.length > 0} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Radio className="h-5 w-5 text-violet-500" /> Bateria DDMX trocada?
          </DialogTitle>
          <DialogDescription>
            A troca CLIMP de {fmtIsoBr(dataTroca)} tinha a bateria DDMX agendada junto. Marque as que foram trocadas.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {pendentes.map((p) => {
            const on = marcados.has(p.modulo.ddmxCodigo);
            return (
              <label
                key={p.modulo.ddmxCodigo}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2",
                  on ? "border-violet-500/50 bg-violet-500/10" : "border-border/60 bg-muted/20",
                )}
              >
                <Checkbox
                  checked={on}
                  onCheckedChange={(v) =>
                    setMarcados((prev) => {
                      const next = new Set(prev);
                      if (v) next.add(p.modulo.ddmxCodigo);
                      else next.delete(p.modulo.ddmxCodigo);
                      return next;
                    })
                  }
                />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs font-semibold">
                    DDMX {p.modulo.ddmxCodigo} <span className="font-normal text-muted-foreground">· CLIMP {p.selimp}</span>
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{p.modulo.setores.join(" / ")}</p>
                </div>
                {statusDdmxBadge(p.modulo.statusBateria)}
              </label>
            );
          })}
        </div>
        <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          As não marcadas continuam agendadas na aba <strong>Trocas DDMX</strong> para troca posterior.
        </p>
        <DialogFooter className="gap-2">
          <Button className={cn(BTN_SECONDARY)} onClick={onClose}>
            Não, deixar em aberto
          </Button>
          <Button className={cn(BTN_SKY)} disabled={escolhidos.length === 0} onClick={() => onConfirm(escolhidos)}>
            Sim, trocada{escolhidos.length > 1 ? `s (${escolhidos.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
