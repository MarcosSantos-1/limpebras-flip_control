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

function upsertScheduledHistory(history: TrocaHistoryMap, item: TrocaHistoryRecord): TrocaHistoryMap {
  const current = history[item.selimp] ?? [];
  const previous = current.find((h) => h.status === "agendada");
  const scheduled: TrocaHistoryRecord = {
    ...previous,
    ...item,
    id: previous?.id ?? item.id,
    dataPrimeiroAgendamento:
      previous?.dataPrimeiroAgendamento ?? previous?.dataAgendada ?? item.dataPrimeiroAgendamento ?? item.dataAgendada,
    createdAt: previous?.createdAt ?? item.createdAt,
  };
  return {
    ...history,
    [item.selimp]: [scheduled, ...current.filter((h) => h.status !== "agendada")],
  };
}

function removeScheduledHistory(history: TrocaHistoryMap, selimp: string): TrocaHistoryMap {
  const current = history[selimp] ?? [];
  return {
    ...history,
    [selimp]: current.filter((h) => h.status !== "agendada"),
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
      const previous = nextRecords[it.selimp];
      const dataPrimeiroAgendamento =
        previous?.status === "agendada"
          ? previous.dataPrimeiroAgendamento ?? previous.dataAgendada ?? it.dataAgendada
          : it.dataAgendada;
      nextRecords[it.selimp] = {
        ...previous,
        selimp: it.selimp,
        setor: it.setor,
        status: "agendada",
        dataAgendada: it.dataAgendada,
        dataPrimeiroAgendamento,
      };
      nextHistory = upsertScheduledHistory(nextHistory, {
        id: nowLocalId("agendada", it.selimp),
        selimp: it.selimp,
        setor: it.setor,
        status: "agendada",
        dataAgendada: it.dataAgendada,
        dataPrimeiroAgendamento,
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
      nextHistory = prependHistory(removeScheduledHistory(nextHistory, it.selimp), {
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
    commitLocal({ ...cache, records: nextRecords, history: removeScheduledHistory(cache.history, selimp) });
    apiService.removerBateriaTroca(selimp).catch((err) => {
      console.error("Erro ao remover troca", err);
      reloadFromApi();
    });
  }, []);

  return { records: snapshot.records, history: snapshot.history, agendar, concluir, remover };
}

// ===== Alertas (derivados de dados reais) =====

/** Triagem do alerta: sem alerta · em observação (amarelo) · problemático (vermelho). */
export type AlertaLevel = "none" | "observacao" | "problema";

export interface AlertaReason {
  text: string;
  severity: "problema" | "observacao";
}

export interface AlertaInfo {
  level: AlertaLevel;
  /** Mantido por compatibilidade: true quando level !== "none". */
  hasAlert: boolean;
  reasons: AlertaReason[];
  produtividade: number;
  produtividadeExecucao: number | null;
  diasOffline: number;
  diasOfflineConsecutivos: number;
  trocasComSucesso: number;
  trocasSemSucesso: number;
  historicoManutencoes: { data: string; descricao: string }[];
}

export interface AlertaModuleInput {
  numeroSelimp: string;
  statusBateria: string;
  produtividade: number;
  produtividadeExecucao?: number | null;
  diasOff: number;
  diasOffConsecutivos?: number;
}

/**
 * Triagem do módulo a partir de dados reais. Duas classificações para evitar
 * que "tudo fique vermelho": vermelho (problemático) só para condições severas;
 * amarelo (em observação) para sinais de atenção. Critérios considerados:
 * produtividade de execução (30d), trocas com/sem sucesso (a partir da troca),
 * produtividade baixa de bateria, dias ON/OFF e dias offline consecutivos.
 */
export function computeAlerta(
  m: AlertaModuleInput,
  _troca?: TrocaRecord,
  historicoManutencoes: { data: string; descricao: string }[] = [],
  trocaHistory: TrocaHistoryRecord[] = [],
): AlertaInfo {
  const concluidas = trocaHistory.filter((h) => h.status === "concluida");
  const trocasComSucesso = concluidas.filter((h) => h.sucesso === true).length;
  const trocasSemSucesso = concluidas.filter((h) => h.sucesso === false).length;
  const diasOfflineConsecutivos = m.diasOffConsecutivos ?? 0;
  const execucao = m.produtividadeExecucao ?? null;
  const teveTroca = concluidas.length > 0;

  const reasons: AlertaReason[] = [];
  const add = (severity: AlertaReason["severity"], text: string) => reasons.push({ severity, text });

  // Troca sem sucesso (sinal/bateria não recuperaram após a troca) → problemático.
  if (trocasSemSucesso > 0) {
    add("problema", `${trocasSemSucesso} troca(s) sem sucesso — sinal/bateria não recuperaram após a troca`);
  }
  // Status da bateria.
  if (m.statusBateria === "DESATUALIZADA") add("problema", "Bateria desatualizada — módulo sem comunicar");
  else if (m.statusBateria === "CRÍTICA") add("observacao", "Bateria em nível crítico");

  // Produtividade de bateria (a partir da troca, quando houve troca).
  const ctxBateria = teveTroca ? " desde a última troca" : "";
  if (m.produtividade < 20) add("problema", `Produtividade de bateria muito baixa (${m.produtividade}%)${ctxBateria}`);
  else if (m.produtividade < 40) add("observacao", `Produtividade de bateria baixa (${m.produtividade}%)${ctxBateria}`);

  // Produtividade de execução do serviço (30 dias).
  if (execucao != null) {
    if (execucao < 30) add("problema", `Execução do serviço muito baixa (${execucao}% em 30 dias)`);
    else if (execucao < 60) add("observacao", `Execução do serviço abaixo do ideal (${execucao}% em 30 dias)`);
  }
  // Offline consecutivos.
  if (diasOfflineConsecutivos >= 7) add("problema", `${diasOfflineConsecutivos} dias offline consecutivos`);
  else if (diasOfflineConsecutivos >= 3) add("observacao", `${diasOfflineConsecutivos} dias offline consecutivos`);
  // Offline acumulado no período.
  if (m.diasOff >= 21) add("problema", `${m.diasOff} dias offline no período`);
  else if (m.diasOff >= 10) add("observacao", `${m.diasOff} dias offline no período`);

  const level: AlertaLevel = reasons.some((r) => r.severity === "problema")
    ? "problema"
    : reasons.length > 0
      ? "observacao"
      : "none";

  return {
    level,
    hasAlert: level !== "none",
    reasons,
    produtividade: m.produtividade,
    produtividadeExecucao: execucao,
    diasOffline: m.diasOff,
    diasOfflineConsecutivos,
    trocasComSucesso,
    trocasSemSucesso,
    historicoManutencoes,
  };
}
