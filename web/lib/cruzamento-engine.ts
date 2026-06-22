/**
 * Motor de criticidade do Cruzamento Inteligente.
 *
 * Transforma os `itens` do /dashboard/ipt-preview (enriquecidos com o histórico
 * de trocas/manutenções por módulo) em uma triagem por setor orientada à TOMADA
 * DE DECISÃO: ordena pelo impacto real no IPT (não pelo gap cru) e classifica a
 * causa-raiz pela ÓTICA DE SAÚDE DO MÓDULO (I-IV):
 *
 *   I   hibernando    — módulo oscila: aparece "com sinal"/carga mas não computa
 *                       execução, dorme, ou volta desatualizado após a troca.
 *   II  hardware      — já passou por troca/manutenção e segue morto, ou nunca
 *                       teve sinal — problema do equipamento, não da operação.
 *   III operacao      — equipamento saudável, mas execução baixa/ausente.
 *   IV  pontos_cegos  — sem SELIMP nem DDMX: não dá nem pra medir.
 *       divergencia   — SELIMP × DDMX divergem: o número que pesa no IPT pode
 *                       estar errado (contestável).
 *
 * Princípio central: quanto MAIS despachos previstos um setor tem, mais ele pesa
 * no IPT. Por isso varrição diária (≈26 previstos/mês) precisa flutuar para o topo
 * naturalmente — o que acontece quando ordenamos por "despachos-equivalentes
 * perdidos" em vez de por percentual.
 *
 * O diferenciador I vs II é o HISTÓRICO DE INTERVENÇÃO: se já trocamos a bateria
 * e/ou fizemos manutenção e o sinal não voltou (ou nunca houve sinal), é hardware;
 * se oscila/dorme mas às vezes responde, é hibernação.
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

/**
 * Contexto enriquecido por módulo (numero_selimp), montado pela página a partir
 * de getIptModulosBateria + getBateriaTrocas + getModuloManutencoes. Decoplado
 * dos tipos crus de API: a página é quem traduz.
 */
export interface ModuloContext {
  /** Total de trocas de bateria já realizadas no módulo. */
  qtdTrocas: number;
  /** Houve ao menos uma troca registrada. */
  temTroca: boolean;
  /** A troca mais recente deixou o módulo SEM SINAL (não resolveu). */
  ultimaTrocaSemSinal: boolean;
  /** Houve ao menos uma manutenção REALIZADA. */
  manutencaoRealizada: boolean;
  /** Manutenção REALIZADA mas o sinal não foi recuperado (não resolveu). */
  manutencaoRealizadaSemSinal: boolean;
}

/** Mapa de contexto por módulo, chaveado por numero_selimp em MAIÚSCULAS. */
export type ModuloContextMap = Record<string, ModuloContext>;

/** Causa-raiz provável (saúde do módulo) → define o responsável por resolver. */
export type RootCause = "pontos_cegos" | "hardware" | "hibernando" | "divergencia" | "operacao" | "ok";

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
  pontos_cegos: {
    id: "pontos_cegos",
    label: "Pontos cegos",
    responsavel: "Base / Cadastro",
    descricao: "Setor previsto sem módulo SELIMP e sem DDMX — não dá nem para medir a execução. Corrigir a base.",
  },
  hardware: {
    id: "hardware",
    label: "Hardware / Fornecedor",
    responsavel: "Suporte",
    descricao:
      "Já passou por troca/manutenção e segue sem sinal, ou nunca comunicou — problema do equipamento, não da operação.",
  },
  hibernando: {
    id: "hibernando",
    label: "Hiberna / Bateria",
    responsavel: "Manutenção",
    descricao:
      "Módulo oscila: aparece com sinal/carga mas não computa execução, dorme, ou voltou desatualizado após a troca.",
  },
  divergencia: {
    id: "divergencia",
    label: "Divergência SELIMP×DDMX",
    responsavel: "Contestação",
    descricao:
      "Diferença relevante entre SELIMP e DDMX — o percentual que pesa no IPT pode estar errado; priorizar contestação.",
  },
  operacao: {
    id: "operacao",
    label: "Operação",
    responsavel: "Operação",
    descricao: "Equipamento saudável e setor previsto, mas execução baixa/ausente — provável não cumprimento da operação.",
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
  /** Divergência |SELIMP − interno| (em pontos) que sinaliza problema de cadastro/contestação. */
  DIVERGENCIA_PP: 12,
  /** Nº de trocas a partir do qual o módulo conta como "troca sem efeito". */
  TROCAS_SEM_EFEITO: 2,
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

  // Equipamento / medição
  temBateria: boolean;
  temDdmx: boolean;
  bateriaMedia: number | null;
  bateriaCriticos: number;
  bateriaProblema: boolean;
  comSinal: boolean;
  nuncaTeveSinal: boolean;

  // Histórico de intervenção (vem do contexto enriquecido)
  qtdTrocas: number;
  intervencaoSemSucesso: boolean;
  manutencaoRealizadaSemSinal: boolean;

  // Cadastro / divergência
  percentualSelimp: number | null;
  percentualInterno: number | null;
  divergencia: number | null;

  // Classificação
  causaRaiz: RootCause;
  /** true quando a causa veio de observação manual salva (não do automático). */
  causaManual: boolean;
  status: SectorStatus;

  // Flags transversais (não exclusivas da causa primária)
  /** Várias trocas e ainda ruim → desperdício de manutenção / hardware reincidente. */
  trocaSemEfeito: boolean;
  /** Divergência onde DDMX/interno > SELIMP → IPT possivelmente injusto. */
  contestavel: boolean;

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

/** Mapeia o título de uma observação global para uma causa-raiz (override manual). */
function causaFromObsGlobal(titulo: string): RootCause | null {
  const t = (titulo ?? "").toLowerCase();
  if (!t) return null;
  if (t.includes("hardware") || t.includes("suporte") || t.includes("fornecedor") || t.includes("morto") || t.includes("defeito")) {
    return "hardware";
  }
  if (t.includes("hiberna") || t.includes("dorme") || t.includes("oscila") || t.includes("bateria") || t.includes("desatualiz")) {
    return "hibernando";
  }
  if (t.includes("diverg") || t.includes("contesta")) {
    return "divergencia";
  }
  if (
    t.includes("cego") ||
    t.includes("sem módulo") ||
    t.includes("sem modulo") ||
    t.includes("sem bateria") ||
    t.includes("selimp") ||
    t.includes("setor incorreto") ||
    t.includes("endere") ||
    t.includes("cadastro") ||
    t.includes("pendente")
  ) {
    return "pontos_cegos";
  }
  if (t.includes("operação") || t.includes("operacao") || t.includes("não cumpriu") || t.includes("nao cumpriu") || t.includes("nunca")) {
    return "operacao";
  }
  return null;
}

/** Agrega o contexto de intervenção dos módulos SELIMP de um setor. */
function aggregateModuloCtx(selimps: string[], ctxMap?: ModuloContextMap) {
  let qtdTrocas = 0;
  let temTroca = false;
  let ultimaTrocaSemSinal = false;
  let manutencaoRealizada = false;
  let manutencaoRealizadaSemSinal = false;
  if (ctxMap) {
    for (const sel of selimps) {
      const c = ctxMap[(sel ?? "").toUpperCase()];
      if (!c) continue;
      qtdTrocas += c.qtdTrocas;
      temTroca = temTroca || c.temTroca;
      ultimaTrocaSemSinal = ultimaTrocaSemSinal || c.ultimaTrocaSemSinal;
      manutencaoRealizada = manutencaoRealizada || c.manutencaoRealizada;
      manutencaoRealizadaSemSinal = manutencaoRealizadaSemSinal || c.manutencaoRealizadaSemSinal;
    }
  }
  return { qtdTrocas, temTroca, ultimaTrocaSemSinal, manutencaoRealizada, manutencaoRealizadaSemSinal };
}

export interface AnalyzeOpts {
  obs?: ObservacoesMap;
  /** Contexto de intervenção por módulo (numero_selimp em maiúsculas). */
  modulos?: ModuloContextMap;
}

/** Constrói a análise de um setor a partir do item do preview + contexto. */
export function analyzeSector(item: PreviewItem, opts?: AnalyzeOpts): SectorAnalysis {
  const obs = opts?.obs;
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

  // ── Equipamento / medição ──
  const resumo = item.bateria_resumo_setor;
  const modulosBateria = item.modulos_bateria ?? [];
  const totalModulos = resumo?.total ?? modulosBateria.length ?? 0;
  const temBateria = totalModulos > 0; // tem módulo SELIMP
  const equipamentos = item.equipamentos ?? [];
  const temDdmx =
    equipamentos.length > 0 || dias.some((d) => (d.bateria_ddmx_dia?.total ?? 0) > 0);

  const bateriaMedia =
    item.produtividade_bateria_media ??
    resumo?.produtividade_media ??
    (modulosBateria.length
      ? modulosBateria.reduce((a, m) => a + (m.bateria_percentual ?? m.produtividade_bateria ?? 0), 0) /
        modulosBateria.length
      : null);
  const bateriaCriticos = resumo?.criticos ?? 0;
  const comSinalQtd = resumo?.com_sinal ?? 0;
  const semSinalQtd = resumo?.sem_sinal ?? 0;
  const comSinal = comSinalQtd > 0;
  const semSinalTotal = temBateria && comSinalQtd === 0;
  const bateriaProblema =
    temBateria &&
    ((bateriaMedia != null && bateriaMedia <= THRESHOLDS.BATERIA_PROBLEMA_PCT) ||
      bateriaCriticos > 0 ||
      (totalModulos > 0 && semSinalQtd >= totalModulos));

  // Nunca teve sinal: sem sinal no snapshot e em nenhum dia do detalhe.
  const algumDiaComSinal = dias.some((d) =>
    (d.bateria_setor_dia?.modulos ?? []).some((m) => /on|com/i.test(m.status_comunicacao ?? ""))
  );
  const nuncaTeveSinal = temBateria && !comSinal && !algumDiaComSinal;

  // ── Histórico de intervenção (contexto enriquecido) ──
  const selimps = modulosBateria.map((m) => m.numero_selimp).filter(Boolean);
  const ctx = aggregateModuloCtx(selimps, opts?.modulos);
  const qtdTrocas = ctx.qtdTrocas;
  const temIntervencao = ctx.temTroca || ctx.manutencaoRealizada;
  const intervencaoSemSucesso = ctx.ultimaTrocaSemSinal || ctx.manutencaoRealizadaSemSinal;

  // ── Execução ──
  const execucaoBaixa = percentualMedio == null || percentualMedio < THRESHOLDS.IRREGULAR_PCT;
  const execucaoZero = (percentualMedio != null && percentualMedio <= 0) || (previstos > 0 && despachados === 0);
  // Produtividade do módulo ~0 apesar de carga (sintoma de hibernação).
  const produtZero = bateriaMedia != null && bateriaMedia <= THRESHOLDS.BATERIA_PROBLEMA_PCT;

  // ── Divergência ──
  const percentualSelimp = item.percentual_selimp;
  const percentualInterno = item.percentual_nosso;
  const divergencia =
    percentualSelimp != null && percentualInterno != null
      ? Math.abs(percentualSelimp - percentualInterno)
      : null;

  // ── Status de severidade ──
  let status: SectorStatus;
  if (previstos > 0 && despachados === 0) status = "nunca";
  else if (percentualMedio != null && percentualMedio < THRESHOLDS.CRITICO_PCT) status = "critico";
  else if (percentualMedio != null && percentualMedio < THRESHOLDS.IRREGULAR_PCT) status = "irregular";
  else status = "ok";

  // ── Causa-raiz: observação manual tem prioridade; senão a cascata I-IV. ──
  const obsGlobal = obs?.globais?.[plano] ?? null;
  const causaManualCandidate = obsGlobal ? causaFromObsGlobal(obsGlobal.titulo) : null;

  let causaRaiz: RootCause;
  let causaManual = false;
  if (causaManualCandidate) {
    causaRaiz = causaManualCandidate;
    causaManual = true;
  } else if (!temBateria && !temDdmx && previstos > 0) {
    // IV-a — sem SELIMP e sem DDMX: não dá nem pra medir.
    causaRaiz = "pontos_cegos";
  } else if (
    temBateria &&
    execucaoBaixa &&
    ((temIntervencao && (intervencaoSemSucesso || semSinalTotal || bateriaProblema)) || nuncaTeveSinal)
  ) {
    // II — já intervimos e segue morto, ou nunca teve sinal.
    causaRaiz = "hardware";
  } else if (temBateria && execucaoBaixa && (bateriaProblema || (comSinal && produtZero))) {
    // I — oscila/dorme: tem sinal/carga mas não computa.
    causaRaiz = "hibernando";
  } else if (divergencia != null && divergencia > THRESHOLDS.DIVERGENCIA_PP) {
    // IV-c — antes de operação: se DDMX executou e SELIMP zerou, não é a operação.
    causaRaiz = "divergencia";
  } else if (execucaoBaixa) {
    // III — equipamento saudável e execução baixa.
    causaRaiz = "operacao";
  } else {
    causaRaiz = "ok";
  }

  // ── Flags transversais ──
  const trocaSemEfeito =
    qtdTrocas >= THRESHOLDS.TROCAS_SEM_EFEITO &&
    (semSinalTotal || bateriaProblema || intervencaoSemSucesso || execucaoZero);
  const contestavel =
    divergencia != null &&
    divergencia > THRESHOLDS.DIVERGENCIA_PP &&
    (percentualInterno ?? 0) > (percentualSelimp ?? 0);

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
    temDdmx,
    bateriaMedia,
    bateriaCriticos,
    bateriaProblema,
    comSinal,
    nuncaTeveSinal,
    qtdTrocas,
    intervencaoSemSucesso,
    manutencaoRealizadaSemSinal: ctx.manutencaoRealizadaSemSinal,
    percentualSelimp,
    percentualInterno,
    divergencia,
    causaRaiz,
    causaManual,
    status,
    trocaSemEfeito,
    contestavel,
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
  /** Lista derivada para o card "trocas/manutenções sem efeito" (IV-b). */
  trocasSemEfeito: SectorAnalysis[];
}

const EMPTY_POR_CAUSA = (): Record<RootCause, { setores: number; impacto: number }> => ({
  pontos_cegos: { setores: 0, impacto: 0 },
  hardware: { setores: 0, impacto: 0 },
  hibernando: { setores: 0, impacto: 0 },
  divergencia: { setores: 0, impacto: 0 },
  operacao: { setores: 0, impacto: 0 },
  ok: { setores: 0, impacto: 0 },
});

/**
 * Analisa todos os setores e devolve o ranking (por impacto) + agregações.
 * `apenasComPrevisao` exclui setores sem dias previstos no período (ruído).
 */
export function buildCruzamento(
  itens: PreviewItem[],
  opts?: { obs?: ObservacoesMap; modulos?: ModuloContextMap; apenasComPrevisao?: boolean }
): CruzamentoResult {
  const apenasComPrevisao = opts?.apenasComPrevisao ?? true;
  let setores = itens.map((it) => analyzeSector(it, { obs: opts?.obs, modulos: opts?.modulos }));
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
    trocasSemEfeito: setores.filter((s) => s.trocaSemEfeito),
  };
}
