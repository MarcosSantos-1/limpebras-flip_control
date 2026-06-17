"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { apiService, type BateriaTrocaHistoryRecord, type BateriaTrocaRecord } from "@/lib/api";

// ===== Tipos =====

export type TrocaStatus = "agendada" | "concluida";

export type MotivoTroca = "Manutenção" | "Corretiva" | "Preventiva" | "Desnecessária";

export type TrocaRecord = BateriaTrocaRecord;

export type TrocaMap = Record<string, TrocaRecord>;
export type TrocaHistoryRecord = BateriaTrocaHistoryRecord;
export type TrocaHistoryMap = Record<string, TrocaHistoryRecord[]>;

interface TrocaSnapshot {
  records: TrocaMap;
  history: TrocaHistoryMap;
}

// ===== Store externo (useSyncExternalStore), hidratado da API =====

const EMPTY: TrocaSnapshot = { records: {}, history: {} };
let cache: TrocaSnapshot = EMPTY;
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function commitLocal(next: TrocaSnapshot) {
  cache = next;
  emit();
}

async function loadFromApi(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const { records, history } = await apiService.getBateriaTrocas();
      cache = { records, history: history ?? {} };
      loaded = true;
      emit();
    } catch (err) {
      console.error("Erro ao carregar trocas de bateria", err);
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Recarrega do servidor (usado para reconciliar após falha de mutação). */
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

function getSnapshot(): TrocaSnapshot {
  return cache;
}

function getServerSnapshot(): TrocaSnapshot {
  return EMPTY;
}

function nowLocalId(prefix: string, selimp: string): string {
  return `${prefix}-${selimp}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function prependHistory(history: TrocaHistoryMap, item: TrocaHistoryRecord): TrocaHistoryMap {
  const current = history[item.selimp] ?? [];
  return {
    ...history,
    [item.selimp]: [item, ...current],
  };
}

// ===== Hook =====

export interface AgendarInput {
  selimp: string;
  setor?: string;
  dataAgendada: string;
  tipoTroca?: string;
}

export interface ConcluirInput {
  selimp: string;
  setor?: string;
  /** Sucesso é automático (derivado no servidor); não é mais informado na conclusão. */
  percentualEntrada?: number;
  dataTroca: string;
  ultimaComunicacao: string;
  tipoTroca?: string;
  bateriaAntes?: string;
  bateriaAntesPercentual?: number;
  statusBateriaAntes?: string;
  bateriaDepoisPercentual?: number;
  statusSinalDepois?: string;
}

export function useTrocaState() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!loaded) void loadFromApi();
  }, []);

  const agendar = useCallback((inputs: AgendarInput | AgendarInput[]) => {
    const list = Array.isArray(inputs) ? inputs : [inputs];
    if (list.length === 0) return;
    const nextRecords = { ...cache.records };
    let nextHistory = cache.history;
    for (const it of list) {
      nextRecords[it.selimp] = {
        ...nextRecords[it.selimp],
        selimp: it.selimp,
        setor: it.setor,
        status: "agendada",
        dataAgendada: it.dataAgendada,
      };
      nextHistory = prependHistory(nextHistory, {
        id: nowLocalId("agendada", it.selimp),
        selimp: it.selimp,
        setor: it.setor,
        status: "agendada",
        dataAgendada: it.dataAgendada,
        tipoTroca: it.tipoTroca,
        createdAt: new Date().toISOString(),
      });
    }
    commitLocal({ records: nextRecords, history: nextHistory });
    apiService.agendarBateriaTrocas(list).catch((err) => {
      console.error("Erro ao agendar trocas", err);
      reloadFromApi();
    });
  }, []);

  const concluir = useCallback((inputs: ConcluirInput | ConcluirInput[]) => {
    const list = Array.isArray(inputs) ? inputs : [inputs];
    if (list.length === 0) return;
    const nextRecords = { ...cache.records };
    let nextHistory = cache.history;
    for (const it of list) {
      nextRecords[it.selimp] = {
        ...nextRecords[it.selimp],
        selimp: it.selimp,
        setor: it.setor ?? nextRecords[it.selimp]?.setor,
        status: "concluida",
        sucesso: undefined,
        percentualEntrada: it.percentualEntrada,
        dataTroca: it.dataTroca,
        ultimaComunicacao: it.ultimaComunicacao,
      };
      nextHistory = prependHistory(nextHistory, {
        id: nowLocalId("concluida", it.selimp),
        selimp: it.selimp,
        setor: it.setor ?? nextRecords[it.selimp]?.setor,
        status: "concluida",
        sucesso: undefined,
        percentualEntrada: it.percentualEntrada,
        dataTroca: it.dataTroca,
        ultimaComunicacao: it.ultimaComunicacao,
        tipoTroca: it.tipoTroca,
        bateriaAntes: it.bateriaAntes,
        bateriaAntesPercentual: it.bateriaAntesPercentual,
        statusBateriaAntes: it.statusBateriaAntes,
        bateriaDepoisPercentual: it.bateriaDepoisPercentual ?? it.percentualEntrada,
        statusSinalDepois: it.statusSinalDepois,
        createdAt: new Date().toISOString(),
      });
    }
    commitLocal({ records: nextRecords, history: nextHistory });
    // Recarrega para obter sucesso/tipo derivados dos snapshots no servidor.
    apiService
      .concluirBateriaTrocas(list)
      .then(() => reloadFromApi())
      .catch((err) => {
        console.error("Erro ao concluir trocas", err);
        reloadFromApi();
      });
  }, []);

  const remover = useCallback((selimp: string) => {
    const nextRecords = { ...cache.records };
    delete nextRecords[selimp];
    commitLocal({ ...cache, records: nextRecords });
    apiService.removerBateriaTroca(selimp).catch((err) => {
      console.error("Erro ao remover troca", err);
      reloadFromApi();
    });
  }, []);

  return { records: snapshot.records, history: snapshot.history, agendar, concluir, remover };
}

// ===== Alertas (derivados de dados reais) =====

export interface AlertaInfo {
  hasAlert: boolean;
  trocasSemAtualizarSinal: number;
  baixaProdutividade: boolean;
  produtividade: number;
  diasOffline: number;
  diasOfflineConsecutivos: number;
  historicoManutencoes: { data: string; descricao: string }[];
}

export interface AlertaModuleInput {
  numeroSelimp: string;
  statusBateria: string;
  produtividade: number;
  diasOff: number;
  diasOffConsecutivos?: number;
}

/** Deriva os alertas de um módulo a partir de dados reais:
 * status/produtividade/dias OFF do snapshot importado, troca registrada no
 * painel e histórico de manutenção registrado. */
export function computeAlerta(
  m: AlertaModuleInput,
  troca?: TrocaRecord,
  historicoManutencoes: { data: string; descricao: string }[] = [],
): AlertaInfo {
  // Troca concluída em que sinal/bateria não atualizaram (registrada como "sem sucesso").
  const trocasSemAtualizarSinal = troca?.status === "concluida" && troca.sucesso === false ? 1 : 0;
  const diasOfflineConsecutivos = m.diasOffConsecutivos ?? 0;
  const baixaProdutividade = m.produtividade < 20;

  const statusCritico = m.statusBateria === "DESATUALIZADA" || m.statusBateria === "CRÍTICA";
  const hasAlert =
    statusCritico ||
    trocasSemAtualizarSinal > 0 ||
    baixaProdutividade ||
    m.diasOff >= 7 ||
    diasOfflineConsecutivos >= 3 ||
    historicoManutencoes.length > 0;

  return {
    hasAlert,
    trocasSemAtualizarSinal,
    baixaProdutividade,
    produtividade: m.produtividade,
    diasOffline: m.diasOff,
    diasOfflineConsecutivos,
    historicoManutencoes,
  };
}
