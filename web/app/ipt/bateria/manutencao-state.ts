"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { apiService, type BateriaManutencaoRecord } from "@/lib/api";
import type { TrocaRecord } from "./troca-state";

// ===== Tipos =====

export type ManutencaoStatus = "ATIVA" | "PENDENTE" | "EM ANÁLISE" | "FINALIZADA";

export const MANUTENCAO_STATUS: ManutencaoStatus[] = ["ATIVA", "PENDENTE", "EM ANÁLISE", "FINALIZADA"];

/** Registro de manutenção por módulo (persistido no servidor). */
export type ManutencaoOverride = Partial<BateriaManutencaoRecord>;

export type ManutencaoMap = Record<string, ManutencaoOverride>;

// ===== Store externo (useSyncExternalStore), hidratado da API =====

const EMPTY: ManutencaoMap = {};
let cache: ManutencaoMap = EMPTY;
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function commitLocal(next: ManutencaoMap) {
  cache = next;
  emit();
}

async function loadFromApi(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const { records } = await apiService.getBateriaManutencoes();
      cache = records;
      loaded = true;
      emit();
    } catch (err) {
      console.error("Erro ao carregar manutenções de bateria", err);
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

function getSnapshot(): ManutencaoMap {
  return cache;
}

function getServerSnapshot(): ManutencaoMap {
  return EMPTY;
}

// ===== Hook =====

export function useManutencaoState() {
  const overrides = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!loaded) void loadFromApi();
  }, []);

  const setOverride = useCallback(
    (selimp: string, patch: { dataManutencao?: string; naoHouve?: boolean }) => {
      const next = { ...cache };
      next[selimp] = { ...next[selimp], ...patch };
      commitLocal(next);
      apiService.setBateriaManutencao(selimp, patch).catch((err) => {
        console.error("Erro ao salvar manutenção", err);
        reloadFromApi();
      });
    },
    [],
  );

  /** Solicita manutenção para um ou vários módulos (status global → MANUTENÇÃO). */
  const solicitar = useCallback((selimps: string | string[], dataSolicitacao: string) => {
    const list = (Array.isArray(selimps) ? selimps : [selimps]).filter(Boolean);
    if (list.length === 0) return;
    const next = { ...cache };
    for (const s of list) next[s] = { ...next[s], solicitada: true, dataSolicitacao };
    commitLocal(next);
    apiService.solicitarBateriaManutencao(list, dataSolicitacao).catch((err) => {
      console.error("Erro ao solicitar manutenção", err);
      reloadFromApi();
    });
  }, []);

  const cancelarSolicitacao = useCallback((selimp: string) => {
    const next = { ...cache };
    next[selimp] = { ...next[selimp], solicitada: false, dataSolicitacao: undefined };
    commitLocal(next);
    apiService.cancelarBateriaManutencao(selimp).catch((err) => {
      console.error("Erro ao cancelar solicitação de manutenção", err);
      reloadFromApi();
    });
  }, []);

  return { overrides, setOverride, solicitar, cancelarSolicitacao };
}

// ===== Derivações (dados reais) =====

/** yyyy-MM-dd → dd/MM/yyyy. */
function isoToBr(iso?: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/** Histórico de manutenções registrado para o módulo (para o modal de alertas). */
export function historicoFromManutencao(ov?: ManutencaoOverride): { data: string; descricao: string }[] {
  const out: { data: string; descricao: string }[] = [];
  if (ov?.dataManutencao && !ov.naoHouve) {
    out.push({ data: isoToBr(ov.dataManutencao), descricao: "Manutenção registrada" });
  }
  if (ov?.solicitada) {
    out.push({ data: isoToBr(ov.dataSolicitacao), descricao: "Manutenção solicitada (pendente)" });
  }
  return out;
}

export interface ManutencaoModuleInput {
  numeroSelimp: string;
  statusSinalGeral: string;
  statusBateria: string;
  quantidadeTrocas: number;
  diasOn: number;
  diasOff: number;
}

export interface ManutencaoInfo {
  /** null quando não há manutenção conhecida para o módulo. */
  status: ManutencaoStatus | null;
  qtdManutencoes: number;
  historico: {
    manutencoes: number;
    trocasBateria: number;
    trocasAposUltimaComunicacao: number;
    diasOn: number;
    diasOff: number;
    diasSemAtualizacao: number;
  };
}

const MANUT_EM = "MANUTENÇÃO";
const MANUT_EM2 = "MANUTENCAO";

/** Deriva o estado de manutenção do módulo a partir do registro persistido,
 * do status global e da troca registrada no painel. */
export function computeManutencao(
  m: ManutencaoModuleInput,
  ov?: ManutencaoOverride,
  troca?: TrocaRecord,
): ManutencaoInfo {
  const emManutencao = m.statusSinalGeral === MANUT_EM || m.statusSinalGeral === MANUT_EM2;

  let status: ManutencaoStatus | null;
  if (ov?.solicitada) status = "PENDENTE";
  else if (emManutencao) status = "ATIVA";
  else if (ov?.dataManutencao && !ov.naoHouve) status = "FINALIZADA";
  else status = null;

  const qtdManutencoes = ov?.dataManutencao && !ov.naoHouve ? 1 : 0;

  // Troca concluída após a última comunicação registrada na conclusão.
  const trocasAposUltimaComunicacao =
    troca?.status === "concluida" &&
    troca.dataTroca &&
    troca.ultimaComunicacao &&
    troca.dataTroca > troca.ultimaComunicacao
      ? 1
      : 0;

  return {
    status,
    qtdManutencoes,
    historico: {
      manutencoes: qtdManutencoes,
      trocasBateria: m.quantidadeTrocas,
      trocasAposUltimaComunicacao,
      diasOn: m.diasOn,
      diasOff: m.diasOff,
      diasSemAtualizacao: m.diasOff,
    },
  };
}
