"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { toast } from "react-toastify";
import { apiService, type DdmxModulo, type DdmxTrocaInput } from "@/lib/api";

/**
 * Store das trocas DDMX, compartilhado entre a aba "Trocas DDMX" e a aba
 * "Trocas de Bateria" (CLIMP), que agenda/conclui a DDMX junto.
 * O sucesso é derivado no servidor, então toda mutação recarrega da API.
 */

interface DdmxSnapshot {
  modulos: DdmxModulo[];
  atualizadoAte: string | null;
  loaded: boolean;
}

const EMPTY: DdmxSnapshot = { modulos: [], atualizadoAte: null, loaded: false };
let cache: DdmxSnapshot = EMPTY;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function load(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const r = await apiService.getDdmxModulos();
      cache = { modulos: r.modulos, atualizadoAte: r.atualizadoAte, loaded: true };
      emit();
    } catch (err) {
      console.error("Erro ao carregar módulos DDMX", err);
      toast.error("Não foi possível carregar os módulos DDMX.");
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

async function mutate(fn: () => Promise<unknown>, ok: string) {
  try {
    await fn();
    toast.success(ok, { autoClose: 1800 });
  } catch (err) {
    console.error(err);
    toast.error("Falha ao salvar a troca DDMX.");
  } finally {
    await load();
  }
}

export function useDdmxState() {
  const snap = useSyncExternalStore(subscribe, () => cache, () => EMPTY);

  useEffect(() => {
    if (!cache.loaded) void load();
  }, []);

  const recarregar = useCallback(() => load(), []);

  const agendar = useCallback(
    (items: Omit<DdmxTrocaInput, "status">[]) =>
      items.length
        ? mutate(
            () => apiService.salvarDdmxTrocas(items.map((it) => ({ ...it, status: "agendada" as const }))),
            items.length > 1 ? `${items.length} trocas DDMX agendadas.` : "Troca DDMX agendada.",
          )
        : Promise.resolve(),
    [],
  );

  const concluir = useCallback(
    (items: Omit<DdmxTrocaInput, "status">[]) =>
      items.length
        ? mutate(
            () => apiService.salvarDdmxTrocas(items.map((it) => ({ ...it, status: "concluida" as const }))),
            items.length > 1 ? `${items.length} trocas DDMX concluídas.` : "Troca DDMX concluída.",
          )
        : Promise.resolve(),
    [],
  );

  const cancelar = useCallback(
    (codigos: string[]) =>
      codigos.length
        ? mutate(() => apiService.cancelarDdmxAgendamentos(codigos), "Agendamento DDMX cancelado.")
        : Promise.resolve(),
    [],
  );

  const removerEvento = useCallback(
    (id: number) => mutate(() => apiService.excluirDdmxTroca(id), "Registro DDMX excluído."),
    [],
  );

  return { ...snap, recarregar, agendar, concluir, cancelar, removerEvento };
}

/** Módulos DDMX que atendem um módulo CLIMP: pelo código SELIMP e, na falta, pelos setores. */
export function ddmxDoModuloClimp(modulos: DdmxModulo[], selimp: string, setores: string[]): DdmxModulo[] {
  const porSelimp = modulos.filter((m) => m.selimpCodigos.includes(selimp));
  if (porSelimp.length) return porSelimp;
  const alvo = new Set(setores.map((s) => s.trim().toUpperCase()).filter(Boolean));
  return modulos.filter((m) => m.setores.some((s) => alvo.has(s.trim().toUpperCase())));
}
