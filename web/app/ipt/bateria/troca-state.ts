"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { apiService, type BateriaTrocaRecord } from "@/lib/api";

// ===== Tipos =====

export type TrocaStatus = "agendada" | "concluida";

export type MotivoTroca = "Manutenção" | "Corretiva" | "Preventiva" | "Desnecessária";

export type TrocaRecord = BateriaTrocaRecord;

export type TrocaMap = Record<string, TrocaRecord>;

// ===== Store externo (useSyncExternalStore), hidratado da API =====

const EMPTY: TrocaMap = {};
let cache: TrocaMap = EMPTY;
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function commitLocal(next: TrocaMap) {
  cache = next;
  emit();
}

async function loadFromApi(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const { records } = await apiService.getBateriaTrocas();
      cache = records;
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

function getSnapshot(): TrocaMap {
  return cache;
}

function getServerSnapshot(): TrocaMap {
  return EMPTY;
}

// ===== Hook =====

export interface AgendarInput {
  selimp: string;
  setor?: string;
  dataAgendada: string;
}

export interface ConcluirInput {
  selimp: string;
  sucesso: boolean;
  percentualEntrada?: number;
  dataTroca: string;
  ultimaComunicacao: string;
}

export function useTrocaState() {
  const records = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!loaded) void loadFromApi();
  }, []);

  const agendar = useCallback((inputs: AgendarInput | AgendarInput[]) => {
    const list = Array.isArray(inputs) ? inputs : [inputs];
    if (list.length === 0) return;
    const next = { ...cache };
    for (const it of list) {
      next[it.selimp] = {
        ...next[it.selimp],
        selimp: it.selimp,
        setor: it.setor,
        status: "agendada",
        dataAgendada: it.dataAgendada,
      };
    }
    commitLocal(next);
    apiService.agendarBateriaTrocas(list).catch((err) => {
      console.error("Erro ao agendar trocas", err);
      reloadFromApi();
    });
  }, []);

  const concluir = useCallback((inputs: ConcluirInput | ConcluirInput[]) => {
    const list = Array.isArray(inputs) ? inputs : [inputs];
    if (list.length === 0) return;
    const next = { ...cache };
    for (const it of list) {
      next[it.selimp] = {
        ...next[it.selimp],
        selimp: it.selimp,
        status: "concluida",
        sucesso: it.sucesso,
        percentualEntrada: it.percentualEntrada,
        dataTroca: it.dataTroca,
        ultimaComunicacao: it.ultimaComunicacao,
      };
    }
    commitLocal(next);
    apiService.concluirBateriaTrocas(list).catch((err) => {
      console.error("Erro ao concluir trocas", err);
      reloadFromApi();
    });
  }, []);

  const remover = useCallback((selimp: string) => {
    const next = { ...cache };
    delete next[selimp];
    commitLocal(next);
    apiService.removerBateriaTroca(selimp).catch((err) => {
      console.error("Erro ao remover troca", err);
      reloadFromApi();
    });
  }, []);

  return { records, agendar, concluir, remover };
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
    diasOfflineConsecutivos >= 3;

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
