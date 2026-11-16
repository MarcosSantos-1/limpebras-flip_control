"use client";

import { useState } from "react";
import { Radio } from "lucide-react";
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

/** Status DDMX que pedem troca junto com a CLIMP (sugestão inicial do checkbox). */
export function ddmxPedeTroca(status: StatusBateriaDdmx): boolean {
  return status === "DESATUALIZADA" || status === "SEM LEITURA" || status === "CRÍTICA" || status === "BAIXA";
}

function statusBadge(status: StatusBateriaDdmx) {
  if (status === "SEM LEITURA") {
    return <Badge className="border-zinc-500/30 bg-zinc-500/15 font-semibold text-zinc-600 dark:text-zinc-300">SEM LEITURA</Badge>;
  }
  return renderBatteryStatus(status, false);
}

function bateria(m: DdmxModulo): string {
  const l = m.leitura;
  if (!l || l.bateria == null) return "—";
  return `${Math.round(l.bateria)}%${l.bateriaRaw ? ` (${l.bateriaRaw})` : ""}`;
}

/**
 * Checkbox "Trocar bateria DDMX também" do agendamento CLIMP, mostrando
 * o(s) módulo(s) DDMX correspondente(s) com status e agendamento atual.
 */
export function DdmxJuntoCheckbox({
  modulos,
  checked,
  onCheckedChange,
}: {
  modulos: DdmxModulo[];
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  if (modulos.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
        Nenhum módulo DDMX cadastrado para este(s) setor(es) — cadastre na aba Setores para controlar a troca DDMX junto.
      </p>
    );
  }
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors",
        checked ? "border-violet-500/50 bg-violet-500/10" : "border-border/60 bg-muted/20 hover:bg-muted/30",
      )}
    >
      <Checkbox checked={checked} onCheckedChange={(v) => onCheckedChange(Boolean(v))} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Radio className="h-4 w-4 text-violet-500" /> Trocar bateria DDMX também
        </span>
        <span className="block text-[11px] text-muted-foreground">
          Agenda a troca do rastreador DDMX na mesma data. Ao concluir a troca CLIMP você confirma se a DDMX foi trocada; se não, ela fica em aberto na aba Trocas DDMX.
        </span>
        <div className="space-y-1.5">
          {modulos.map((m) => (
            <div key={m.ddmxCodigo} className="flex flex-wrap items-center gap-2 rounded-md bg-background/70 px-2.5 py-1.5 text-xs">
              <span className="font-mono font-semibold">DDMX {m.ddmxCodigo}</span>
              {statusBadge(m.statusBateria)}
              <span className="tabular-nums text-muted-foreground">{bateria(m)}</span>
              {m.agendamento && (
                <span className="text-amber-600 dark:text-amber-400">já agendada p/ {fmtIsoBr(m.agendamento.dataAgendada ?? "")}</span>
              )}
            </div>
          ))}
        </div>
      </div>
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
                {statusBadge(p.modulo.statusBateria)}
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
