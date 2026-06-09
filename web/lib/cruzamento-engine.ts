/**
 * Motor de criticidade do Cruzamento Inteligente.
 *
 * Transforma os `itens` do /dashboard/ipt-preview em uma análise por setor
 * orientada à TOMADA DE DECISÃO: ordena pelo impacto real no IPT (não pelo gap
 * cru) e classifica a causa-raiz provável (operação / bateria / cadastro / nunca),
 * que é o que a operação precisa para "dar um jeito".
 *
 * Princípio central: quanto MAIS despachos previstos um setor tem, mais ele pesa
 * no IPT. Por isso varrição diária (≈26 previstos/mês) precisa flutuar para o topo
 * naturalmente — o que acontece quando ordenamos por "despachos-equivalentes
 * perdidos" em vez de por percentual.
 */

import type { IptPreviewResponse } from "@/lib/api";
import { getSubFromPlano, getFrequenciaDescricao } from "@/lib/ipt-utils";

/** Item por setor exatamente como o backend devolve em `itens`. */
export type PreviewItem = NonNullable<IptPreviewResponse["itens"]>[number];

/** Observações já salvas (registro do "relatório"), vindas de getIptObservacoes. */
export type ObservacoesMap = {
  globais: Record<string, { id: number; titulo: string; descricao: string | null }>;
  diarias: Record<string, Record<string, { id: number; titulo: string; descricao: string | null }>>;
};

/** Causa-raiz provável → define o responsável por resolver. */
export type RootCause = "operacao" | "bateria" | "cadastro" | "nunca" | "ok";

/** Status de severidade (badge). */
export type SectorStatus = "nunca" | "critico" | "irregular" | "ok";

export type FrequenciaClasse =
  | "diaria"
  | "alternado"
  | "bissemanal"
  | "semanal"
  | "quinzenal"
  | "mensal"
  | "outro";

export interface RootCauseMeta {
  id: RootCause;
  label: string;
  /** Quem precisa agir. */
  responsavel: string;
  /** Descrição curta para tooltip/relatório. */
  descricao: string;
}

export const ROOT_CAUSE_META: Record<RootCause, RootCauseMeta> = {
  operacao: {
    id: "operacao",
    label: "Operação",
    responsavel: "Operação",
    descricao: "Equipamento OK e setor previsto, mas execução baixa/ausente — provável não cumprimento da operação.",
  },
  bateria: {
    id: "bateria",
    label: "Bateria / Equipamento",
    responsavel: "Manutenção",
    descricao: "Módulo com bateria baixa, crítica ou desatualizada — não é responsabilidade da operação.",
  },
  cadastro: {
    id: "cadastro",
    label: "Cadastro / SELIMP",
    responsavel: "Cadastro / Base",
    descricao: "Divergência relevante SELIMP × interno ou setor sem módulo atrelado — corrigir a base.",
  },
  nunca: {
    id: "nunca",
    label: "Nunca executado",
    responsavel: "Investigação",
    descricao: "Zero execução em todo o período com equipamento funcionando — investigação prioritária.",
  },
  ok: {
    id: "ok",
    label: "Sem alerta",
    responsavel: "—",
    descricao: "Execução dentro do esperado no período.",
  },
};

export const STATUS_META: Record<SectorStatus, { label: string; className: string }> = {
  nunca: { label: "Nunca executado", className: "border-rose-500/40 bg-rose-500/12 text-rose-700 dark:text-rose-300" },
  critico: { label: "Crítico", className: "border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300" },
  irregular: { label: "Irregular", className: "border-yellow-500/40 bg-yellow-500/12 text-yellow-700 dark:text-yellow-300" },
  ok: { label: "OK", className: "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
};

/** Limiares (documentados para facilitar calibragem). */
export const THRESHOLDS = {
  /** % médio abaixo disso = execução crítica. */
  CRITICO_PCT: 40,
  /** % médio abaixo disso = irregular. */
  IRREGULAR_PCT: 75,
  /** Produtividade média de bateria (≤) que caracteriza problema de equipamento. */
  BATERIA_PROBLEMA_PCT: 30,
  /** Divergência |SELIMP − interno| (em pontos) que sinaliza problema de cadastro. */
  DIVERGENCIA_PP: 12,
} as const;

export interface SectorAnalysis {
  plano: string;
  sub: string;
  tipoServico: string;
  isVarricao: boolean;
  frequenciaLabel: string;
  frequenciaClasse: FrequenciaClasse;

  // Execução no período
  previstos: number;
  despachados: number;
  naoDespachados: number;
  zerados: number;
  percentualMedio: number | null;
  cobertura: number | null;

  // Impacto no IPT — "despachos-equivalentes perdidos"
  impactoIpt: number;

  // Bateria
  temBateria: boolean;
  bateriaMedia: number | null;
  bateriaCriticos: number;
  bateriaProblema: boolean;

  // Cadastro / divergência
  percentualSelimp: number | null;
  percentualInterno: number | null;
  divergencia: number | null;

  // Classificação
  causaRaiz: RootCause;
  /** true quando a causa veio de observação manual salva (não do automático). */
  causaManual: boolean;
  status: SectorStatus;

  // Registro / relatório
  temObsGlobal: boolean;
  obsGlobalTitulo: string | null;

  // detalhe diário cru (para o heatmap/drawer)
  detalhes: PreviewItem["detalhes_diarios"];
}

const clampPct = (v: number) => Math.max(0, Math.min(100, v));

function freqCodeFromPlano(plano: string): string {
  const m = plano.replace(/\s+/g, "").toUpperCase().match(/^(?:CV|JT|MG|ST)\d(\d{4})[A-Z]{2}\d{4}/);
  return m ? m[1] : "";
}

function frequenciaClasseFromCode(code: string): FrequenciaClasse {
  const prefix = code.slice(0, 2);
  switch (prefix) {
    case "01":
      return "diaria";
    case "02":
      return "alternado";
    case "03":
      return "bissemanal";
    case "04":
      return "semanal";
    case "05":
      return "quinzenal";
    case "06":
      return "mensal";
    default:
      return "outro";
  }
}

function isVarricaoServico(tipoServico: string): boolean {
  const t = (tipoServico ?? "").toLowerCase();
  return t.includes("varri") || t.includes("sarjeta");
}

/** Mapeia o título de uma observação global para uma causa-raiz. */
function causaFromObsGlobal(titulo: string): RootCause | null {
  const t = (titulo ?? "").toLowerCase();
  if (!t) return null;
  if (t.includes("setor incorreto") || t.includes("selimp") || t.includes("endere") || t.includes("sem bateria") || t.includes("sem módulo") || t.includes("sem modulo") || t.includes("alteração") || t.includes("alteracao") || t.includes("pendente")) {
    return "cadastro";
  }
  if (t.includes("bateria")) return "bateria";
  if (t.includes("nunca")) return "nunca";
  return null;
}

/** Constrói a análise de um setor a partir do item do preview. */
export function analyzeSector(item: PreviewItem, obs?: ObservacoesMap): SectorAnalysis {
  const plano = item.plano;
  const sub = getSubFromPlano(plano) || item.subprefeitura || "—";
  const dias = item.detalhes_diarios ?? [];
  const esperadoDias = dias.filter((d) => d.esperado);
  const comDespacho = esperadoDias.filter((d) => (d.despachos_selimp ?? 0) > 0);

  const previstos = esperadoDias.length;
  const despachados = comDespacho.length;
  const naoDespachados = Math.max(0, previstos - despachados);
  const zerados = comDespacho.filter((d) => (d.percentual_selimp ?? 0) <= 0).length;

  const pctValues = comDespacho.map((d) => clampPct(d.percentual_selimp ?? 0)); // com zerados
  const percentualMedio = pctValues.length
    ? pctValues.reduce((a, b) => a + b, 0) / pctValues.length
    : despachados === 0 && previstos > 0
      ? 0
      : null;
  const cobertura = previstos > 0 ? (despachados / previstos) * 100 : null;

  const pctParaImpacto = percentualMedio ?? 0;
  const impactoIpt = previstos > 0 ? previstos * (1 - clampPct(pctParaImpacto) / 100) : 0;

  // Bateria
  const resumo = item.bateria_resumo_setor;
  const totalModulos = resumo?.total ?? item.modulos_bateria?.length ?? 0;
  const temBateria = totalModulos > 0;
  const bateriaMedia =
    item.produtividade_bateria_media ??
    resumo?.produtividade_media ??
    (item.modulos_bateria && item.modulos_bateria.length
      ? item.modulos_bateria.reduce((a, m) => a + (m.bateria_percentual ?? m.produtividade_bateria ?? 0), 0) /
        item.modulos_bateria.length
      : null);
  const bateriaCriticos = resumo?.criticos ?? 0;
  const semSinal = resumo?.sem_sinal ?? 0;
  const bateriaProblema =
    temBateria &&
    ((bateriaMedia != null && bateriaMedia <= THRESHOLDS.BATERIA_PROBLEMA_PCT) ||
      bateriaCriticos > 0 ||
      (totalModulos > 0 && semSinal >= totalModulos));

  // Divergência
  const percentualSelimp = item.percentual_selimp;
  const percentualInterno = item.percentual_nosso;
  const divergencia =
    percentualSelimp != null && percentualInterno != null
      ? Math.abs(percentualSelimp - percentualInterno)
      : null;

  // Status de severidade
  let status: SectorStatus;
  if (previstos > 0 && despachados === 0) status = "nunca";
  else if (percentualMedio != null && percentualMedio < THRESHOLDS.CRITICO_PCT) status = "critico";
  else if (percentualMedio != null && percentualMedio < THRESHOLDS.IRREGULAR_PCT) status = "irregular";
  else status = "ok";

  // Causa-raiz: observação manual tem prioridade; senão regras automáticas.
  const obsGlobal = obs?.globais?.[plano] ?? null;
  const causaManualCandidate = obsGlobal ? causaFromObsGlobal(obsGlobal.titulo) : null;

  let causaRaiz: RootCause;
  let causaManual = false;
  if (causaManualCandidate) {
    causaRaiz = causaManualCandidate;
    causaManual = true;
  } else if (!temBateria && previstos > 0 && despachados === 0) {
    // Setor sem módulo atrelado e sem execução = problema de cadastro/base.
    causaRaiz = "cadastro";
  } else if (bateriaProblema && (percentualMedio == null || percentualMedio < THRESHOLDS.IRREGULAR_PCT)) {
    causaRaiz = "bateria";
  } else if (previstos > 0 && despachados === 0) {
    causaRaiz = "nunca";
  } else if (divergencia != null && divergencia > THRESHOLDS.DIVERGENCIA_PP) {
    causaRaiz = "cadastro";
  } else if (percentualMedio != null && percentualMedio < THRESHOLDS.IRREGULAR_PCT) {
    causaRaiz = "operacao";
  } else {
    causaRaiz = "ok";
  }

  const code = freqCodeFromPlano(plano);
  const frequenciaLabel = item.frequencia
    ? /^\d{4}$/.test(item.frequencia)
      ? getFrequenciaDescricao(item.frequencia)
      : item.frequencia
    : code
      ? getFrequenciaDescricao(code)
      : "—";

  return {
    plano,
    sub,
    tipoServico: item.tipo_servico || "Não informado",
    isVarricao: isVarricaoServico(item.tipo_servico),
    frequenciaLabel,
    frequenciaClasse: frequenciaClasseFromCode(code),
    previstos,
    despachados,
    naoDespachados,
    zerados,
    percentualMedio,
    cobertura,
    impactoIpt,
    temBateria,
    bateriaMedia,
    bateriaCriticos,
    bateriaProblema,
    percentualSelimp,
    percentualInterno,
    divergencia,
    causaRaiz,
    causaManual,
    status,
    temObsGlobal: Boolean(obsGlobal),
    obsGlobalTitulo: obsGlobal?.titulo ?? null,
    detalhes: dias,
  };
}

export interface CruzamentoResumo {
  totalSetores: number;
  setoresComPrevisao: number;
  setoresCriticos: number;
  nuncaExecutados: number;
  impactoTotal: number;
  impactoTop10: number;
  /** % do impacto total concentrado no top 10. */
  concentracaoTop10: number;
  previstosTotal: number;
  naoDespachadosTotal: number;
  zeradosTotal: number;
  coberturaGeral: number | null;
  porCausa: Record<RootCause, { setores: number; impacto: number }>;
}

export interface CruzamentoPorGrupo {
  chave: string;
  setores: number;
  impacto: number;
  naoDespachados: number;
  previstos: number;
  cobertura: number | null;
}

export interface CruzamentoResult {
  setores: SectorAnalysis[];
  resumo: CruzamentoResumo;
  porSub: CruzamentoPorGrupo[];
  porServico: CruzamentoPorGrupo[];
}

const EMPTY_POR_CAUSA = (): Record<RootCause, { setores: number; impacto: number }> => ({
  operacao: { setores: 0, impacto: 0 },
  bateria: { setores: 0, impacto: 0 },
  cadastro: { setores: 0, impacto: 0 },
  nunca: { setores: 0, impacto: 0 },
  ok: { setores: 0, impacto: 0 },
});

/**
 * Analisa todos os setores e devolve o ranking (por impacto) + agregações.
 * `apenasComPrevisao` exclui setores sem dias previstos no período (ruído).
 */
export function buildCruzamento(
  itens: PreviewItem[],
  opts?: { obs?: ObservacoesMap; apenasComPrevisao?: boolean }
): CruzamentoResult {
  const apenasComPrevisao = opts?.apenasComPrevisao ?? true;
  let setores = itens.map((it) => analyzeSector(it, opts?.obs));
  if (apenasComPrevisao) setores = setores.filter((s) => s.previstos > 0);

  // Ranking principal: por impacto no IPT (desc), desempate por previstos.
  setores.sort((a, b) => b.impactoIpt - a.impactoIpt || b.previstos - a.previstos || a.plano.localeCompare(b.plano));

  const porCausa = EMPTY_POR_CAUSA();
  let impactoTotal = 0;
  let previstosTotal = 0;
  let naoDespachadosTotal = 0;
  let zeradosTotal = 0;
  let despachadosTotal = 0;

  const subMap = new Map<string, CruzamentoPorGrupo>();
  const servMap = new Map<string, CruzamentoPorGrupo>();

  const bump = (map: Map<string, CruzamentoPorGrupo>, chave: string, s: SectorAnalysis) => {
    const g = map.get(chave) ?? { chave, setores: 0, impacto: 0, naoDespachados: 0, previstos: 0, cobertura: null };
    g.setores += 1;
    g.impacto += s.impactoIpt;
    g.naoDespachados += s.naoDespachados;
    g.previstos += s.previstos;
    map.set(chave, g);
  };

  for (const s of setores) {
    porCausa[s.causaRaiz].setores += 1;
    porCausa[s.causaRaiz].impacto += s.impactoIpt;
    impactoTotal += s.impactoIpt;
    previstosTotal += s.previstos;
    naoDespachadosTotal += s.naoDespachados;
    zeradosTotal += s.zerados;
    despachadosTotal += s.despachados;
    bump(subMap, s.sub, s);
    bump(servMap, s.tipoServico, s);
  }

  const finalizeGroup = (g: CruzamentoPorGrupo): CruzamentoPorGrupo => ({
    ...g,
    cobertura: g.previstos > 0 ? ((g.previstos - g.naoDespachados) / g.previstos) * 100 : null,
  });

  const impactoTop10 = setores.slice(0, 10).reduce((a, s) => a + s.impactoIpt, 0);
  const setoresCriticos = setores.filter((s) => s.status !== "ok").length;
  const nuncaExecutados = setores.filter((s) => s.status === "nunca").length;

  const resumo: CruzamentoResumo = {
    totalSetores: setores.length,
    setoresComPrevisao: setores.filter((s) => s.previstos > 0).length,
    setoresCriticos,
    nuncaExecutados,
    impactoTotal,
    impactoTop10,
    concentracaoTop10: impactoTotal > 0 ? (impactoTop10 / impactoTotal) * 100 : 0,
    previstosTotal,
    naoDespachadosTotal,
    zeradosTotal,
    coberturaGeral: previstosTotal > 0 ? (despachadosTotal / previstosTotal) * 100 : null,
    porCausa,
  };

  return {
    setores,
    resumo,
    porSub: Array.from(subMap.values()).map(finalizeGroup).sort((a, b) => b.impacto - a.impacto),
    porServico: Array.from(servMap.values()).map(finalizeGroup).sort((a, b) => b.impacto - a.impacto),
  };
}
