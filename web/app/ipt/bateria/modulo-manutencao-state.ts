"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  apiService,
  type ModuloManutencaoEvento,
  type ModuloManutencaoInput,
  type ManutencaoModuloStatus,
} from "@/lib/api";

export type { ModuloManutencaoEvento, ManutencaoModuloStatus };

export type ManutencaoRecordMap = Record<string, ModuloManutencaoEvento>;
export type ManutencaoHistoryMap = Record<string, ModuloManutencaoEvento[]>;

interface Snapshot {
  records: ManutencaoRecordMap;
  history: ManutencaoHistoryMap;
}

// ===== Store externo (useSyncExternalStore), hidratado da API =====

const EMPTY: Snapshot = { records: {}, history: {} };
let cache: Snapshot = EMPTY;
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function commitLocal(next: Snapshot) {
  cache = next;
  emit();
}

async function loadFromApi(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const { records, history } = await apiService.getModuloManutencoes();
      cache = { records: records ?? {}, history: history ?? {} };
      loaded = true;
      emit();
    } catch (err) {
      console.error("Erro ao carregar manutenções de módulo", err);
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function reloadFromApi() {
  loaded = false;
  void loadFromApi();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Snapshot {
  return cache;
}

function getServerSnapshot(): Snapshot {
  return EMPTY;
}

/** Estado corrente = evento mais recente (data_manutencao/ordenado/created) por módulo. */
function pickLatest(events: ModuloManutencaoEvento[]): ModuloManutencaoEvento | undefined {
  return [...events].sort((a, b) => {
    const ka = a.dataManutencao ?? a.dataOrdenado ?? a.createdAt ?? "";
    const kb = b.dataManutencao ?? b.dataOrdenado ?? b.createdAt ?? "";
    if (ka !== kb) return kb.localeCompare(ka);
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  })[0];
}

// ===== Hook =====

export function useModuloManutencaoState() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!loaded) void loadFromApi();
  }, []);

  /** Registra uma ou mais manutenções (histórico). Atualiza o estado após o servidor responder. */
  const registrar = useCallback(async (inputs: ModuloManutencaoInput | ModuloManutencaoInput[]) => {
    const list = (Array.isArray(inputs) ? inputs : [inputs]).filter((it) => it.selimp);
    if (list.length === 0) return;
    try {
      const { eventos } = await apiService.registrarModuloManutencao(list);
      const nextHistory: ManutencaoHistoryMap = { ...cache.history };
      const nextRecords: ManutencaoRecordMap = { ...cache.records };
      for (const ev of eventos) {
        const cur = nextHistory[ev.selimp] ?? [];
        const merged = [ev, ...cur];
        nextHistory[ev.selimp] = merged;
        const latest = pickLatest(merged);
        if (latest) nextRecords[ev.selimp] = latest;
      }
      commitLocal({ records: nextRecords, history: nextHistory });
    } catch (err) {
      console.error("Erro ao registrar manutenção de módulo", err);
      reloadFromApi();
    }
  }, []);

  const atualizar = useCallback(
    async (id: number, selimp: string, patch: Partial<Omit<ModuloManutencaoInput, "selimp">>) => {
      try {
        const { evento } = await apiService.atualizarModuloManutencao(id, patch);
        const list = (cache.history[selimp] ?? []).map((e) => (e.id === id ? evento : e));
        const nextHistory: ManutencaoHistoryMap = { ...cache.history, [selimp]: list };
        const nextRecords: ManutencaoRecordMap = { ...cache.records };
        const latest = pickLatest(list);
        if (latest) nextRecords[selimp] = latest;
        commitLocal({ records: nextRecords, history: nextHistory });
      } catch (err) {
        console.error("Erro ao atualizar manutenção de módulo", err);
        reloadFromApi();
      }
    },
    [],
  );

  const remover = useCallback(async (id: number, selimp: string) => {
    try {
      await apiService.removerModuloManutencao(id);
      const list = (cache.history[selimp] ?? []).filter((e) => e.id !== id);
      const nextHistory: ManutencaoHistoryMap = { ...cache.history };
      const nextRecords: ManutencaoRecordMap = { ...cache.records };
      if (list.length === 0) {
        delete nextHistory[selimp];
        delete nextRecords[selimp];
      } else {
        nextHistory[selimp] = list;
        const latest = pickLatest(list);
        if (latest) nextRecords[selimp] = latest;
      }
      commitLocal({ records: nextRecords, history: nextHistory });
    } catch (err) {
      console.error("Erro ao remover manutenção de módulo", err);
      reloadFromApi();
    }
  }, []);

  return { records: snapshot.records, history: snapshot.history, registrar, atualizar, remover };
}

// ===== Helpers de exibição =====

export const MANUT_STATUS_LABEL: Record<ManutencaoModuloStatus, string> = {
  PENDENTE: "Pendente",
  ATIVA: "Ativa",
  REALIZADA: "Realizada",
};

/** Ordem de prioridade na listagem: Pendente → Ativa → Realizada. */
export const MANUT_STATUS_ORDER: Record<ManutencaoModuloStatus, number> = {
  PENDENTE: 0,
  ATIVA: 1,
  REALIZADA: 2,
};
