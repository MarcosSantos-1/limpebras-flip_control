"use client";

import { useCallback, useSyncExternalStore } from "react";

// ===== Tipos =====

export type TrocaStatus = "agendada" | "concluida";

export type MotivoTroca = "Manutenção" | "Corretiva" | "Preventiva" | "Desnecessária";

export interface TrocaRecord {
  selimp: string;
  status: TrocaStatus;
  setor?: string;
  /** Data agendada — yyyy-MM-dd */
  dataAgendada?: string;
  // Dados de conclusão:
  sucesso?: boolean;
  percentualEntrada?: number;
  /** yyyy-MM-dd */
  dataTroca?: string;
  /** yyyy-MM-dd */
  ultimaComunicacao?: string;
}

export type TrocaMap = Record<string, TrocaRecord>;

const STORAGE_KEY = "trocas-bateria-state-v1";

// ===== Persistência (localStorage) =====

function readStorage(): TrocaMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as TrocaMap) : {};
  } catch {
    return {};
  }
}

// ===== Store externo (compatível com useSyncExternalStore / SSR) =====

const EMPTY: TrocaMap = {};
let cache: TrocaMap | null = null;
const listeners = new Set<() => void>();

function ensureCache(): TrocaMap {
  if (cache === null) cache = readStorage();
  return cache;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): TrocaMap {
  return ensureCache();
}

function getServerSnapshot(): TrocaMap {
  return EMPTY;
}

function commit(next: TrocaMap) {
  cache = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota / serialization errors */
    }
  }
  listeners.forEach((l) => l());
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

  const agendar = useCallback((inputs: AgendarInput | AgendarInput[]) => {
    const list = Array.isArray(inputs) ? inputs : [inputs];
    const next = { ...ensureCache() };
    for (const it of list) {
      next[it.selimp] = {
        ...next[it.selimp],
        selimp: it.selimp,
        setor: it.setor,
        status: "agendada",
        dataAgendada: it.dataAgendada,
      };
    }
    commit(next);
  }, []);

  const concluir = useCallback((inputs: ConcluirInput | ConcluirInput[]) => {
    const list = Array.isArray(inputs) ? inputs : [inputs];
    const next = { ...ensureCache() };
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
    commit(next);
  }, []);

  const remover = useCallback((selimp: string) => {
    const next = { ...ensureCache() };
    delete next[selimp];
    commit(next);
  }, []);

  return { records, agendar, concluir, remover };
}

// ===== Alertas (métricas reais + mock determinístico) =====

/** Hash estável (FNV-1a) de string → inteiro positivo. Sem Math.random para ser
 * determinístico entre renders/reloads. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const MANUT_DESCRICOES = [
  "Substituição de bateria",
  "Reparo de antena/sinal",
  "Reinstalação do módulo",
  "Verificação de comunicação",
  "Troca preventiva",
];

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
}

/** Deriva o conjunto de alertas de um módulo. Campos reais quando disponíveis,
 * o restante é mock determinístico por SELIMP até existir backend. */
export function computeAlerta(m: AlertaModuleInput): AlertaInfo {
  const seed = hashString(m.numeroSelimp || "—");
  const trocasSemAtualizarSinal = seed % 4; // 0..3
  const diasOfflineConsecutivos = Math.min(m.diasOff, (seed >> 3) % 15);
  const baixaProdutividade = m.produtividade < 20;
  const numManut = seed % 3; // 0..2 registros
  const historicoManutencoes = Array.from({ length: numManut }, (_, i) => {
    const dayOffset = ((seed >> (i + 2)) % 90) + i * 15;
    const d = new Date(2026, 5, 11);
    d.setDate(d.getDate() - dayOffset);
    return {
      data: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`,
      descricao: MANUT_DESCRICOES[(seed >> (i + 1)) % MANUT_DESCRICOES.length],
    };
  });

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
