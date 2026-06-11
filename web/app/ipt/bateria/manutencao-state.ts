"use client";

import { useCallback, useSyncExternalStore } from "react";

// ===== Tipos =====

export type ManutencaoStatus = "ATIVA" | "PENDENTE" | "EM ANÁLISE" | "FINALIZADA";

export const MANUTENCAO_STATUS: ManutencaoStatus[] = ["ATIVA", "PENDENTE", "EM ANÁLISE", "FINALIZADA"];

/** Override editável por módulo (data da manutenção / "não houve"). */
export interface ManutencaoOverride {
  /** yyyy-MM-dd */
  dataManutencao?: string;
  naoHouve?: boolean;
}

export type ManutencaoMap = Record<string, ManutencaoOverride>;

const STORAGE_KEY = "manutencoes-bateria-state-v1";

// ===== Persistência (localStorage) =====

function readStorage(): ManutencaoMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ManutencaoMap) : {};
  } catch {
    return {};
  }
}

// ===== Store externo (useSyncExternalStore / SSR) =====

const EMPTY: ManutencaoMap = {};
let cache: ManutencaoMap | null = null;
const listeners = new Set<() => void>();

function ensureCache(): ManutencaoMap {
  if (cache === null) cache = readStorage();
  return cache;
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getSnapshot(): ManutencaoMap {
  return ensureCache();
}
function getServerSnapshot(): ManutencaoMap {
  return EMPTY;
}
function commit(next: ManutencaoMap) {
  cache = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((l) => l());
}

export function useManutencaoState() {
  const overrides = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setOverride = useCallback((selimp: string, patch: ManutencaoOverride) => {
    const next = { ...ensureCache() };
    next[selimp] = { ...next[selimp], ...patch };
    commit(next);
  }, []);

  return { overrides, setOverride };
}

// ===== Mock determinístico (até backend) =====

/** Hash estável (FNV-1a). */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
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
  status: ManutencaoStatus;
  qtdManutencoes: number;
  /** Data sugerida (mock) — yyyy-MM-dd. Sobrescrita pelo override do usuário. */
  dataManutencaoSugerida: string;
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

/** Deriva o estado de manutenção (mock) de um módulo, combinando sinais reais
 * com pseudo-aleatoriedade determinística por SELIMP. */
export function computeManutencao(m: ManutencaoModuleInput): ManutencaoInfo {
  const seed = hashString(m.numeroSelimp || "—");
  const emManutencao = m.statusSinalGeral === MANUT_EM || m.statusSinalGeral === MANUT_EM2;

  let status: ManutencaoStatus;
  if (emManutencao) status = "ATIVA";
  else if (m.statusBateria === "DESATUALIZADA") status = seed % 2 === 0 ? "PENDENTE" : "EM ANÁLISE";
  else status = MANUTENCAO_STATUS[seed % MANUTENCAO_STATUS.length];

  const qtdManutencoes = (seed % 5) + (m.quantidadeTrocas > 0 ? 1 : 0);
  const diasSemAtualizacao = Math.min(m.diasOff + ((seed >> 4) % 10), 90);

  // Data sugerida: alguns dias atrás (determinístico).
  const dayOffset = (seed >> 2) % 60;
  const d = new Date(2026, 5, 11);
  d.setDate(d.getDate() - dayOffset);
  const dataManutencaoSugerida = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  return {
    status,
    qtdManutencoes,
    dataManutencaoSugerida,
    historico: {
      manutencoes: qtdManutencoes,
      trocasBateria: m.quantidadeTrocas,
      trocasAposUltimaComunicacao: (seed >> 3) % 3,
      diasOn: m.diasOn,
      diasOff: m.diasOff,
      diasSemAtualizacao,
    },
  };
}
