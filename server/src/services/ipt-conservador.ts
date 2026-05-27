/**
 * IPT Conservador — proxies paralelos do IPT para reduzir surpresa contra a apuração SELIMP.
 *
 * Motivação:
 *   O cálculo atual em routes/indicadores.ts (fetchOrdensSelimpNoPeriodo + calcularPF) tem três
 *   propriedades que inflam o resultado contra a apuração oficial da SELIMP:
 *
 *     1. P = A força cobertura = A/(A·R/F) = 1.0 (30% do PF garantidos),
 *        porque R e F não são informados pela SELIMP.
 *     2. Zeros são removidos antes do Q̄ (ver ipt-pf-algoritmo.ts:47), então
 *        meses com muitos planos zerados ficam "perdoados" no PF.
 *     3. Agrupamento por plano com blend 0.48·max + 0.52·média reduz peso das
 *        linhas zeradas dentro do mesmo plano.
 *
 *   Em meses normais (fev/mar 2026) a diferença é pequena (97–98% vs 97,6/98,0). Em meses
 *   com choque operacional (abr/2026), o PF oficial deu 92,45% enquanto a SELIMP apurou 65,3%.
 *
 *   Este serviço NÃO substitui o cálculo oficial. Ele expõe variantes paralelas com a
 *   mesma base de dados, para que o dashboard possa mostrar IPT otimista (atual) vs
 *   IPT conservador (proxy SELIMP) e disparar alerta quando a diferença passa de um limiar.
 *
 *   Todas as fórmulas operam sobre a mesma matriz `Linha[]` (uma linha por OS/percentual),
 *   garantindo comparabilidade entre meses.
 */

export interface Linha {
  /** Setor/plano normalizado. */
  plano: string;
  /** Percentual em decimal 0..1. Zero é zero, não é null. */
  percentual: number;
  /** Subprefeitura (opcional, para corte). */
  subprefeitura?: string;
  /** Código de serviço normalizado (opcional, para corte). */
  servico?: string;
}

export interface VarianteResultado {
  /** Identificador curto da variante. */
  id: string;
  /** Descrição humana. */
  descricao: string;
  /** Percentual final (0..100), arredondado a 2 casas. null se base vazia. */
  percentual: number | null;
  /** Pontuação IPT (tabela oficial) derivada do percentual. */
  pontuacao: number | null;
  /** Componentes intermediários (quando aplicável). */
  componentes?: Record<string, number | null>;
}

export interface DiagnosticoIpt {
  total_linhas: number;
  linhas_zeradas: number;
  pct_linhas_zeradas: number;
  planos_distintos: number;
  planos_totalmente_zerados: number;
  pct_planos_zerados: number;
  media_geral_com_zeros: number;
  media_geral_sem_zeros: number;
  mediana_geral: number;
  subprefeituras_criticas: Array<{ subprefeitura: string; media_com_zeros: number; planos: number; zeros: number }>;
}

export interface IptConservadorResposta {
  base: { inicio: string; fim: string; fonte: string };
  variantes: VarianteResultado[];
  diagnostico: DiagnosticoIpt;
  recomendacao: {
    otimista: string;     // id da variante "otimista" (espelha o sistema atual)
    conservador: string;  // id da variante recomendada como proxy SELIMP
    risco_glosa: "baixo" | "medio" | "alto";
    gap_pp: number;        // diferença em pontos percentuais entre otimista e conservador
    justificativa: string;
  };
}

/** Pontuação IPT a partir do percentual (0..100). Mantém a tabela oficial do contrato. */
function pontuacaoIPT(percentual: number): number {
  if (percentual >= 90) return 40;
  if (percentual >= 80) return 38;
  if (percentual >= 70) return 36;
  if (percentual >= 60) return 32;
  if (percentual >= 50) return 28;
  if (percentual >= 40) return 24;
  if (percentual >= 30) return 20;
  if (percentual >= 20) return 16;
  if (percentual >= 10) return 12;
  return 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const arr = [...valores].sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
}

function desvioPadrao(valores: number[]): number {
  const n = valores.length;
  if (n < 2) return 0;
  const m = valores.reduce((s, v) => s + v, 0) / n;
  const sq = valores.reduce((s, v) => s + (v - m) ** 2, 0);
  return Math.sqrt(sq / (n - 1));
}

function asResultado(
  id: string,
  descricao: string,
  pctDecimal: number | null,
  componentes?: Record<string, number | null>,
): VarianteResultado {
  if (pctDecimal == null || !Number.isFinite(pctDecimal)) {
    return { id, descricao, percentual: null, pontuacao: null, componentes };
  }
  const pct = round2(Math.min(1, Math.max(0, pctDecimal)) * 100);
  return { id, descricao, percentual: pct, pontuacao: pontuacaoIPT(pct), componentes };
}

/**
 * Calcula todas as variantes candidatas a IPT em paralelo, a partir da mesma base de linhas.
 *
 * Convenção:
 *   - Cada `Linha` representa uma OS/despacho (não um plano agregado).
 *   - `percentual` em decimal 0..1.
 *   - Linhas com `percentual == 0` são MANTIDAS aqui; cada variante decide como tratá-las.
 */
export function calcularVariantesIpt(linhas: Linha[]): {
  variantes: VarianteResultado[];
  diagnostico: DiagnosticoIpt;
} {
  if (linhas.length === 0) {
    return {
      variantes: [],
      diagnostico: {
        total_linhas: 0,
        linhas_zeradas: 0,
        pct_linhas_zeradas: 0,
        planos_distintos: 0,
        planos_totalmente_zerados: 0,
        pct_planos_zerados: 0,
        media_geral_com_zeros: 0,
        media_geral_sem_zeros: 0,
        mediana_geral: 0,
        subprefeituras_criticas: [],
      },
    };
  }

  const totalLinhas = linhas.length;
  const linhasZeradas = linhas.filter((l) => l.percentual <= 0).length;
  const linhasNaoZeradas = linhas.filter((l) => l.percentual > 0);

  // Agregação por plano (mantendo zeros)
  const porPlano = new Map<string, number[]>();
  for (const l of linhas) {
    const arr = porPlano.get(l.plano) ?? [];
    arr.push(l.percentual);
    porPlano.set(l.plano, arr);
  }
  const planosDistintos = porPlano.size;
  let planosZerados = 0;
  const mediasPorPlanoComZeros: number[] = [];
  const medianasPorPlano: number[] = [];
  const blendsPorPlano: number[] = [];
  for (const arr of porPlano.values()) {
    const med = arr.reduce((s, v) => s + v, 0) / arr.length;
    mediasPorPlanoComZeros.push(med);
    medianasPorPlano.push(mediana(arr));
    const max = Math.max(...arr);
    const blend = 0.48 * max + 0.52 * med;
    blendsPorPlano.push(blend);
    if (arr.every((v) => v <= 0)) planosZerados++;
  }

  // Diagnóstico por subprefeitura (top piores)
  const porSub = new Map<string, { soma: number; count: number; planos: Set<string>; zeros: number }>();
  for (const l of linhas) {
    const sub = (l.subprefeitura ?? "—").trim() || "—";
    const cur = porSub.get(sub) ?? { soma: 0, count: 0, planos: new Set<string>(), zeros: 0 };
    cur.soma += l.percentual;
    cur.count += 1;
    cur.planos.add(l.plano);
    if (l.percentual <= 0) cur.zeros += 1;
    porSub.set(sub, cur);
  }
  const subprefeiturasCriticas = Array.from(porSub.entries())
    .map(([subprefeitura, v]) => ({
      subprefeitura,
      media_com_zeros: round2((v.count > 0 ? v.soma / v.count : 0) * 100),
      planos: v.planos.size,
      zeros: v.zeros,
    }))
    .sort((a, b) => a.media_com_zeros - b.media_com_zeros)
    .slice(0, 8);

  const mediaGeralComZeros = linhas.reduce((s, l) => s + l.percentual, 0) / totalLinhas;
  const mediaGeralSemZeros =
    linhasNaoZeradas.length > 0
      ? linhasNaoZeradas.reduce((s, l) => s + l.percentual, 0) / linhasNaoZeradas.length
      : 0;
  const medianaGeral = mediana(linhas.map((l) => l.percentual));

  const variantes: VarianteResultado[] = [];

  // V1 — espelho do cálculo atual (otimista): blend por plano + algoritmo PF com P=A, R=F=1.
  // Q̄ remove zeros (fica com média dos planos com blend > 0), σ até 0.08, cobertura forçada a 1.
  {
    const naoZero = blendsPorPlano.filter((v) => v > 0);
    const Qb = naoZero.length > 0 ? naoZero.reduce((s, v) => s + v, 0) / naoZero.length : 0;
    const sigma = desvioPadrao(naoZero);
    const qualidadeAjustada = Math.min(Qb + Math.min(sigma, 0.08), 1);
    const cobertura = 1; // espelha o bug atual
    const pf = 0.7 * qualidadeAjustada + 0.3 * cobertura;
    variantes.push(
      asResultado(
        "v1_oficial_atual",
        "Espelho do cálculo atual em produção (blend por plano + cobertura forçada a 1, zeros fora da qualidade)",
        pf,
        { Qb, sigma, qualidade_ajustada: qualidadeAjustada, cobertura, planos: planosDistintos },
      ),
    );
  }

  // V2 — mesma fórmula PF, mas com zeros DENTRO do Q̄ (planos zerados penalizam de verdade).
  {
    const valores = blendsPorPlano; // mantém zeros
    const Qb = valores.length > 0 ? valores.reduce((s, v) => s + v, 0) / valores.length : 0;
    const sigma = desvioPadrao(valores);
    const qualidadeAjustada = Math.min(Qb + Math.min(sigma, 0.08), 1);
    const cobertura = 1; // ainda sem P/R/F
    const pf = 0.7 * qualidadeAjustada + 0.3 * cobertura;
    variantes.push(
      asResultado(
        "v2_pf_zeros_dentro",
        "PF oficial com zeros incluídos no Q̄ (mantém cobertura=1)",
        pf,
        { Qb, sigma, qualidade_ajustada: qualidadeAjustada, cobertura, planos: planosDistintos },
      ),
    );
  }

  // V3 — média simples por plano com zeros, sem blend, sem PF wrapper.
  {
    const pct = mediasPorPlanoComZeros.length > 0
      ? mediasPorPlanoComZeros.reduce((s, v) => s + v, 0) / mediasPorPlanoComZeros.length
      : 0;
    variantes.push(
      asResultado(
        "v3_media_planos_com_zeros",
        "Média aritmética por plano (com zeros), depois média entre planos. SEM PF, SEM blend.",
        pct,
        { planos: planosDistintos },
      ),
    );
  }

  // V4 — média simples linha-a-linha com zeros (mais conservador ainda em meses com muitos despachos zerados).
  {
    variantes.push(
      asResultado(
        "v4_media_linhas_com_zeros",
        "Média aritmética de todas as linhas (com zeros), sem agrupar por plano.",
        mediaGeralComZeros,
        { linhas: totalLinhas },
      ),
    );
  }

  // V5 — mediana por plano com zeros (robusta contra outliers altos).
  {
    const pct = medianasPorPlano.length > 0
      ? medianasPorPlano.reduce((s, v) => s + v, 0) / medianasPorPlano.length
      : 0;
    variantes.push(
      asResultado(
        "v5_mediana_planos",
        "Mediana por plano (com zeros), depois média entre planos.",
        pct,
        { planos: planosDistintos },
      ),
    );
  }

  // V6 — PF com blend atual, zeros dentro do Q̄ E cobertura realista por proxy de execução.
  // Proxy: cobertura = fração de planos com pelo menos uma linha não-zero / planos esperados.
  // Sem cronograma confiável, usa planos distintos como denominador.
  {
    const planosComExecucao = Array.from(porPlano.values()).filter((arr) => arr.some((v) => v > 0)).length;
    const cobertura = planosDistintos > 0 ? planosComExecucao / planosDistintos : 0;
    const Qb = blendsPorPlano.length > 0 ? blendsPorPlano.reduce((s, v) => s + v, 0) / blendsPorPlano.length : 0;
    const sigma = desvioPadrao(blendsPorPlano);
    const qualidadeAjustada = Math.min(Qb + Math.min(sigma, 0.08), 1);
    const pf = 0.7 * qualidadeAjustada + 0.3 * cobertura;
    variantes.push(
      asResultado(
        "v6_pf_cobertura_proxy",
        "PF com blend atual, zeros dentro do Q̄ e cobertura proxy = planos executados/planos esperados.",
        pf,
        { Qb, sigma, qualidade_ajustada: qualidadeAjustada, cobertura, planos_executados: planosComExecucao, planos_total: planosDistintos },
      ),
    );
  }

  // V7 — calibração antiga 0,6·V3 + 0,4·V4. MANTIDA como referência histórica.
  // Subestima em meses normais (penaliza demais linhas zeradas que não são problema operacional real).
  {
    const v3 = (variantes.find((v) => v.id === "v3_media_planos_com_zeros")?.percentual ?? 0) / 100;
    const v4 = (variantes.find((v) => v.id === "v4_media_linhas_com_zeros")?.percentual ?? 0) / 100;
    const pct = 0.6 * v3 + 0.4 * v4;
    variantes.push(
      asResultado(
        "v7_combinado_calibrado",
        "Combinação 0,6·V3 + 0,4·V4 (subestima em meses normais; mantido como referência).",
        pct,
        { v3, v4 },
      ),
    );
  }

  // V8 — proxy SELIMP por execução×cobertura.
  // Fórmula:  PF ≈ Q̄_sem_zeros × cobertura_planos
  //   - Q̄_sem_zeros = média das linhas com execução > 0 (qualidade real do que rodou)
  //   - cobertura_planos = planos com pelo menos uma execução > 0 / planos distintos
  // Em meses normais ambos ficam ~1 → 98%. Em meses de choque a cobertura cai → IPT cai.
  {
    const naoZero = linhas.filter((l) => l.percentual > 0);
    const Qb = naoZero.length > 0 ? naoZero.reduce((s, l) => s + l.percentual, 0) / naoZero.length : 0;
    const planosComExecucao = Array.from(porPlano.values()).filter((arr) => arr.some((v) => v > 0)).length;
    const cobertura = planosDistintos > 0 ? planosComExecucao / planosDistintos : 0;
    const pf = Qb * cobertura;
    variantes.push(
      asResultado(
        "v8_execucao_x_cobertura",
        "Q̄_sem_zeros × cobertura_planos. Proxy SELIMP recomendado: bate com fev/mar (98%) e abril (~62%).",
        pf,
        { Qb, cobertura, planos_executados: planosComExecucao, planos_total: planosDistintos },
      ),
    );
  }

  const diagnostico: DiagnosticoIpt = {
    total_linhas: totalLinhas,
    linhas_zeradas: linhasZeradas,
    pct_linhas_zeradas: round2((linhasZeradas / totalLinhas) * 100),
    planos_distintos: planosDistintos,
    planos_totalmente_zerados: planosZerados,
    pct_planos_zerados: planosDistintos > 0 ? round2((planosZerados / planosDistintos) * 100) : 0,
    media_geral_com_zeros: round2(mediaGeralComZeros * 100),
    media_geral_sem_zeros: round2(mediaGeralSemZeros * 100),
    mediana_geral: round2(medianaGeral * 100),
    subprefeituras_criticas: subprefeiturasCriticas,
  };

  return { variantes, diagnostico };
}

/**
 * Monta a resposta final do endpoint, escolhendo qual variante é "otimista" e qual é "conservadora",
 * e calculando o risco de glosa pela diferença em pontos percentuais.
 */
export function montarRespostaConservador(
  base: { inicio: string; fim: string; fonte: string },
  linhas: Linha[],
): IptConservadorResposta {
  const { variantes, diagnostico } = calcularVariantesIpt(linhas);

  const otimistaId = "v1_oficial_atual";
  // Default trocado para V8 (execução × cobertura), que bate com fev/mar/abr nos 3 cenários.
  // V7 mantida na resposta para comparação histórica.
  const conservadorId = "v8_execucao_x_cobertura";

  const otimista = variantes.find((v) => v.id === otimistaId)?.percentual ?? null;
  const conservador = variantes.find((v) => v.id === conservadorId)?.percentual ?? null;
  const gap = otimista != null && conservador != null ? round2(otimista - conservador) : 0;

  let risco: "baixo" | "medio" | "alto" = "baixo";
  if (conservador != null && conservador < 90) risco = "alto";
  else if (gap >= 10) risco = "alto";
  else if (gap >= 5) risco = "medio";

  const justificativa =
    risco === "alto"
      ? `Conservador ${conservador?.toFixed(2)}% — ${gap >= 10 ? `gap de ${gap}pp contra o otimista` : "abaixo de 90"}. Tratar como cenário de risco de glosa.`
      : risco === "medio"
        ? `Gap de ${gap}pp entre otimista e conservador. Verificar planos zerados antes do fechamento.`
        : "Otimista e conservador alinhados; risco de glosa baixo no momento.";

  return {
    base,
    variantes,
    diagnostico,
    recomendacao: {
      otimista: otimistaId,
      conservador: conservadorId,
      risco_glosa: risco,
      gap_pp: gap,
      justificativa,
    },
  };
}
