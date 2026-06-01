/**
 * Algoritmo oficial SELIMP para cálculo do Percentual Final (PF) e pontuação IPT.
 *
 * PF = 0.7 × min(Q̄ + min(σ, 0.08), 1) + 0.3 × min(A/C, 1)
 *
 * Onde:
 * - C = P × R/F (capacidade esperada)
 * - Q̄ = (1/N) × Σ Qᵢ (média das conclusões > 0%)
 * - N = A - Z (ordens com conclusão > 0%)
 */

export interface PfParams {
  /** Ordens planejadas */
  P: number;
  /** Rastreadores ativos */
  R: number;
  /** Frota total */
  F: number;
  /** Ordens com percentual em decimal 0–1 (cada uma = ordem atribuída; 0 = zerada) */
  ordens: Array<{ percentual: number }>;
}

/**
 * Calcula o desvio padrão amostral dos percentuais (Qᵢ).
 * Retorna 0 se N < 2.
 */
function desvioPadrao(valores: number[]): number {
  const n = valores.length;
  if (n < 2) return 0;
  const media = valores.reduce((s, v) => s + v, 0) / n;
  const somaQuadrados = valores.reduce((s, v) => s + (v - media) ** 2, 0);
  return Math.sqrt(somaQuadrados / (n - 1));
}

/**
 * Calcula o Percentual Final (PF) conforme algoritmo SELIMP.
 *
 * @param params - P, R, F e lista de ordens com percentual em 0–1
 * @returns PF em escala 0–1, ou null se não houver dados para calcular
 */
export function calcularPF(params: PfParams): number | null {
  const { P, R, F, ordens } = params;

  const A = ordens.length;
  if (A === 0) return null;

  const ordensComConclusao = ordens.filter((o) => o.percentual > 0);
  const Z = A - ordensComConclusao.length;
  const N = A - Z;

  // Qualidade: Q̄ e σ apenas das ordens com conclusão > 0%
  let Qb = 0;
  let sigma = 0;
  if (N > 0) {
    const qiValues = ordensComConclusao.map((o) => o.percentual);
    Qb = qiValues.reduce((s, v) => s + v, 0) / N;
    sigma = desvioPadrao(qiValues);
  }

  // Capacidade esperada: C = P × R/F. Fallback: se F=0 ou indisponível, usar C = A (cobertura 100%)
  let C: number;
  if (P > 0 && R >= 0 && F > 0) {
    C = P * (R / F);
  } else {
    C = A; // fallback: min(A/C, 1) = 1
  }

  // Cobertura: min(A/C, 1). Se C=0, evita divisão por zero usando 1.
  const cobertura = C > 0 ? Math.min(A / C, 1) : 1;

  // Qualidade ajustada: min(Q̄ + min(σ, 0.08), 1)
  const qualidadeAjustada = Math.min(Qb + Math.min(sigma, 0.08), 1);

  // PF = 0.7 × qualidade + 0.3 × cobertura
  const PF = Math.min(1, Math.max(0, 0.7 * qualidadeAjustada + 0.3 * cobertura));
  return PF;
}

export interface PfDetalhes {
  P: number;
  R: number;
  F: number;
  A: number;
  Z: number;
  N: number;
  Qb: number;
  sigma: number;
  C: number;
  cobertura: number;
  qualidade_ajustada: number;
  PF: number;
}

export interface IptCenarioValor {
  percentual: number;
  pontuacao: number;
}

export interface IptCenariosDiagnostico {
  total_linhas: number;
  linhas_encerradas: number;
  zeros_total: number;
  zeros_encerradas: number;
  planos_distintos: number;
  taxa_zeros_encerradas: number;
  diferenca_otimista_conservador: number;
  criterio_estimativa: string;
  Qb: number;
  sigma: number;
  qualidade_ajustada: number;
  cobertura_usada: number;
  cobertura_stress: number;
  cobertura_fonte: "oficial_selimp" | "presumida_100";
  percentual_oficial?: number | null;
  risco: "baixo" | "medio" | "alto";
}

export interface IptCenarios {
  estimado: IptCenarioValor;
  conservador: IptCenarioValor;
  otimista: IptCenarioValor;
  diagnostico: IptCenariosDiagnostico;
}

/**
 * Calcula o PF e retorna os detalhes intermediários para exibição.
 */
export function calcularPFComDetalhes(params: PfParams): { pf: number; detalhes: PfDetalhes } | null {
  const { P, R, F, ordens } = params;

  const A = ordens.length;
  if (A === 0) return null;

  const ordensComConclusao = ordens.filter((o) => o.percentual > 0);
  const Z = A - ordensComConclusao.length;
  const N = A - Z;

  let Qb = 0;
  let sigma = 0;
  if (N > 0) {
    const qiValues = ordensComConclusao.map((o) => o.percentual);
    Qb = qiValues.reduce((s, v) => s + v, 0) / N;
    sigma = desvioPadrao(qiValues);
  }

  let C: number;
  if (P > 0 && R >= 0 && F > 0) {
    C = P * (R / F);
  } else {
    C = A;
  }

  const cobertura = C > 0 ? Math.min(A / C, 1) : 1;
  const qualidadeAjustada = Math.min(Qb + Math.min(sigma, 0.08), 1);
  const PF = Math.min(1, Math.max(0, 0.7 * qualidadeAjustada + 0.3 * cobertura));

  return {
    pf: PF,
    detalhes: {
      P,
      R,
      F,
      A,
      Z,
      N,
      Qb,
      sigma,
      C,
      cobertura,
      qualidade_ajustada: qualidadeAjustada,
      PF,
    },
  };
}

/**
 * Converte PF (0–1) em pontuação IPT conforme faixas oficiais.
 */
export function calcularPontuacaoIPT(pf: number): number {
  if (pf >= 0.9) return 40;
  if (pf >= 0.8) return 38;
  if (pf >= 0.7) return 36;
  if (pf >= 0.6) return 32;
  if (pf >= 0.5) return 28;
  if (pf >= 0.4) return 24;
  if (pf >= 0.3) return 20;
  if (pf >= 0.2) return 16;
  if (pf >= 0.1) return 12;
  return 0;
}

function pontuacaoPercentual(percentual: number): number {
  return calcularPontuacaoIPT(Math.min(1, Math.max(0, percentual / 100)));
}

/**
 * Gera cenarios para acompanhamento do IPT quando P/R/F reais nao estao
 * disponiveis. O PF atual e mantido como cenario otimista; o conservador usa
 * a media dos percentuais por plano ja com zeros; o estimado troca para o
 * conservador quando a proporcao de zeros em ordens encerradas fica critica.
 */
export function calcularCenariosIPT(params: {
  ordens: Array<{ percentual: number }>;
  totalLinhas?: number;
  linhasEncerradas?: number;
  zerosTotal?: number;
  zerosEncerradas?: number;
  planosDistintos?: number;
  percentualOficial?: number | null;
  coberturaStress?: number;
}): IptCenarios | null {
  const ordens = params.ordens.filter((ordem) => Number.isFinite(ordem.percentual));
  if (ordens.length === 0) return null;

  const ordensComConclusao = ordens.filter((o) => o.percentual > 0);
  const qiValues = ordensComConclusao.map((o) => Math.min(1, Math.max(0, o.percentual)));
  const Qb = qiValues.length > 0 ? qiValues.reduce((s, v) => s + v, 0) / qiValues.length : 0;
  const sigma = desvioPadrao(qiValues);
  const qualidadeAjustada = Math.min(Qb + Math.min(sigma, 0.08), 1);

  const coberturaOficialRaw =
    params.percentualOficial != null
      ? (params.percentualOficial / 100 - 0.7 * qualidadeAjustada) / 0.3
      : null;
  const coberturaOficial =
    coberturaOficialRaw != null ? Math.min(1, Math.max(0, coberturaOficialRaw)) : null;
  const coberturaUsada = coberturaOficial ?? 1;
  const coberturaStress = Math.min(1, Math.max(0, params.coberturaStress ?? 0.1));
  const calcularPercentual = (cobertura: number) =>
    Number((Math.min(1, Math.max(0, 0.7 * qualidadeAjustada + 0.3 * cobertura)) * 100).toFixed(2));

  const conservadorPercent = calcularPercentual(coberturaStress);
  const otimistaPercent = calcularPercentual(1);
  const estimadoPercent =
    params.percentualOficial != null ? Number(params.percentualOficial.toFixed(2)) : calcularPercentual(coberturaUsada);
  const linhasEncerradas = params.linhasEncerradas ?? ordens.length;
  const zerosEncerradas = params.zerosEncerradas ?? ordens.filter((ordem) => ordem.percentual === 0).length;
  const taxaZerosEncerradas = linhasEncerradas > 0 ? zerosEncerradas / linhasEncerradas : 0;
  const diferenca = Number(Math.abs(otimistaPercent - conservadorPercent).toFixed(2));

  let risco: IptCenariosDiagnostico["risco"] = "baixo";
  if (coberturaOficial != null && estimadoPercent < 90) {
    risco = "alto";
  } else if (coberturaOficial == null && (taxaZerosEncerradas >= 0.3 || diferenca >= 10)) {
    risco = "medio";
  }

  return {
    estimado: {
      percentual: estimadoPercent,
      pontuacao: pontuacaoPercentual(estimadoPercent),
    },
    conservador: {
      percentual: conservadorPercent,
      pontuacao: pontuacaoPercentual(conservadorPercent),
    },
    otimista: {
      percentual: otimistaPercent,
      pontuacao: pontuacaoPercentual(otimistaPercent),
    },
    diagnostico: {
      total_linhas: params.totalLinhas ?? ordens.length,
      linhas_encerradas: linhasEncerradas,
      zeros_total: params.zerosTotal ?? ordens.filter((ordem) => ordem.percentual === 0).length,
      zeros_encerradas: zerosEncerradas,
      planos_distintos: params.planosDistintos ?? ordens.length,
      taxa_zeros_encerradas: Number((taxaZerosEncerradas * 100).toFixed(2)),
      diferenca_otimista_conservador: diferenca,
      criterio_estimativa:
        coberturaOficial != null
          ? "cobertura inferida pelo IPT oficial SELIMP"
          : "cobertura presumida em 100% por falta de P/R/F oficial",
      Qb: Number((Qb * 100).toFixed(2)),
      sigma: Number((sigma * 100).toFixed(2)),
      qualidade_ajustada: Number((qualidadeAjustada * 100).toFixed(2)),
      cobertura_usada: Number((coberturaUsada * 100).toFixed(2)),
      cobertura_stress: Number((coberturaStress * 100).toFixed(2)),
      cobertura_fonte: coberturaOficial != null ? "oficial_selimp" : "presumida_100",
      percentual_oficial: params.percentualOficial ?? null,
      risco,
    },
  };
}
