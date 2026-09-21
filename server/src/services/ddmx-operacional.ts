export type FontePercentualOperacional = "selimp" | "ddmx" | null;
export type FonteAgregadaOperacional = Exclude<FontePercentualOperacional, null> | "mista" | "sem_dados";

export interface AmostraExecucao {
  sum: number;
  count: number;
  nonzeroCount: number;
}

export interface AcumuladorExecucao extends AmostraExecucao {
  fontes: Set<Exclude<FontePercentualOperacional, null>>;
}

export function extrairPercentualDdmx(raw: Record<string, unknown>): number | null {
  const candidates = [
    raw.percentual_execucao,
    raw.percentual_de_execucao,
    raw.percentual_conclusao,
    raw.percentual,
    raw.de_execucao,
    raw.percentual_executado,
  ];

  for (const candidate of candidates) {
    if (candidate == null) continue;
    const cleaned = String(candidate).replace(",", ".").replace("%", "").trim();
    const value = Number(cleaned);
    if (!Number.isFinite(value)) continue;
    return value > 1 ? value : value * 100;
  }
  return null;
}

export function escolherPercentualOperacional(
  percentualSelimp: number | null,
  percentualDdmx: number | null,
  opts?: { bolha?: boolean },
): { percentual: number | null; fonte: FontePercentualOperacional } {
  if (opts?.bolha && percentualDdmx != null && Number.isFinite(percentualDdmx)) {
    return { percentual: percentualDdmx, fonte: "ddmx" };
  }
  if (percentualSelimp != null && Number.isFinite(percentualSelimp)) {
    return { percentual: percentualSelimp, fonte: "selimp" };
  }
  if (percentualDdmx != null && Number.isFinite(percentualDdmx)) {
    return { percentual: percentualDdmx, fonte: "ddmx" };
  }
  return { percentual: null, fonte: null };
}

/** Serviços em que a SELIMP apura permanência: o dia é 100% ou 0%. */
export const SERVICOS_BOLHA = new Set(["LE", "VP", "CA", "CF", "LF", "VF", "LM", "NH"]);

export function isServicoBolha(sigla: string | null | undefined): boolean {
  return SERVICOS_BOLHA.has(String(sigla ?? "").trim().toUpperCase());
}

export interface LinhaExecucaoDia {
  percentual: number | null;
  inicio?: Date | null;
  fim?: Date | null;
}

/** Data de planilha DDMX. Vazio, "---" e texto inválido contam como ausente. */
export function parseDataDdmx(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === "---" || trimmed === "—" || trimmed === "-" || /^n\/?a$/i.test(trimmed)) {
    return null;
  }
  const brMatch = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (brMatch) {
    const year = Number(brMatch[3].length === 2 ? `20${brMatch[3]}` : brMatch[3]);
    const parsed = new Date(
      Date.UTC(
        year,
        Number(brMatch[2]) - 1,
        Number(brMatch[1]),
        Number(brMatch[4] ?? 0),
        Number(brMatch[5] ?? 0),
        Number(brMatch[6] ?? 0),
      ),
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const direct = new Date(trimmed);
  return Number.isNaN(direct.getTime()) ? null : direct;
}

export function extrairIntervaloDdmx(raw: Record<string, unknown>): { inicio: Date | null; fim: Date | null } {
  return {
    inicio: parseDataDdmx(raw.data_inicio ?? raw.data_de_inicio ?? raw.inicio_executado ?? raw.inicio_planejado),
    fim: parseDataDdmx(raw.data_fim ?? raw.data_final ?? raw.data_de_fim ?? raw.data_termino ?? raw.fim_executado),
  };
}

/** Dia do despacho. Se a coluna de data veio vazia, usa o início executado do Histórico de operações. */
export function chaveDataDdmx(dataReferencia: unknown, raw: Record<string, unknown>): string | null {
  const data =
    parseDataDdmx(dataReferencia) ??
    parseDataDdmx(raw.inicio_executado) ??
    parseDataDdmx(raw.inicio_planejado) ??
    parseDataDdmx(raw.data_inicio) ??
    parseDataDdmx(raw.fim_executado) ??
    parseDataDdmx(raw.data_final) ??
    parseDataDdmx(raw.data_fim);
  if (!data) return null;
  const y = data.getUTCFullYear();
  const m = String(data.getUTCMonth() + 1).padStart(2, "0");
  const d = String(data.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Bolha: 100% se a passagem já foi completa (>90%) ou se houve permanência
 * maior que 15 minutos. Caso contrário, 0%.
 */
export function ajustarPercentualBolha(
  percentual: number | null,
  inicio: Date | null,
  fim: Date | null,
): number {
  if (percentual != null && Number.isFinite(percentual) && percentual > 90) return 100;

  const duracaoMin =
    inicio && fim ? (fim.getTime() - inicio.getTime()) / 60000 : null;
  if (percentual != null && percentual >= 1 && duracaoMin != null && duracaoMin > 15) return 100;
  if (fim == null && percentual != null && percentual > 0 && inicio != null) return 100;
  return 0;
}

/**
 * Percentual do setor no dia: a linha de maior execução.
 * Em bolha, a regra de permanência roda nessa linha. Empate: se alguma
 * das empatadas cumpre a permanência, o dia fica 100%.
 */
export function percentualDoDia(linhas: LinhaExecucaoDia[], bolha: boolean): number | null {
  const comPct = linhas.filter((linha) => linha.percentual != null && Number.isFinite(linha.percentual));
  if (comPct.length === 0) return bolha && linhas.length > 0 ? 0 : null;

  const max = Math.max(...comPct.map((linha) => linha.percentual as number));
  if (!bolha) return max;

  const vencedoras = comPct.filter((linha) => Math.abs((linha.percentual as number) - max) < 1e-6);
  let resultado = 0;
  for (const linha of vencedoras) {
    const ajustado = ajustarPercentualBolha(linha.percentual ?? null, linha.inicio ?? null, linha.fim ?? null);
    if (ajustado >= 100) return 100;
    resultado = ajustado;
  }
  return resultado;
}

/** Um valor por plano+dia: o maior percentual daquele dia. A chave do mapa é o plano. */
export function maximosDiariosPorPlano(
  itens: Array<{ plano: string; dia: string; percentual: number }>,
): Map<string, number[]> {
  const porDia = new Map<string, number>();
  for (const item of itens) {
    const chave = `${item.plano}|${item.dia}`;
    const prev = porDia.get(chave);
    if (prev == null || item.percentual > prev) porDia.set(chave, item.percentual);
  }
  const porPlano = new Map<string, number[]>();
  for (const [chave, percentual] of porDia) {
    const plano = chave.slice(0, chave.lastIndexOf("|"));
    const arr = porPlano.get(plano) ?? [];
    arr.push(percentual);
    porPlano.set(plano, arr);
  }
  return porPlano;
}

export function despachoOperacionalPresente(
  sinalizadoManual: boolean,
  despachosSelimp: number,
  percentualDdmx: number | null,
): boolean {
  return sinalizadoManual || despachosSelimp > 0 || percentualDdmx != null;
}

export function criarAcumuladorExecucao(): AcumuladorExecucao {
  return { sum: 0, count: 0, nonzeroCount: 0, fontes: new Set() };
}

export function adicionarFallbackOperacional(
  acumulador: AcumuladorExecucao,
  selimp: AmostraExecucao,
  ddmx: AmostraExecucao,
): void {
  const fonte = selimp.count > 0 ? "selimp" : ddmx.count > 0 ? "ddmx" : null;
  if (!fonte) return;
  const amostra = fonte === "selimp" ? selimp : ddmx;
  acumulador.sum += amostra.sum;
  acumulador.count += amostra.count;
  acumulador.nonzeroCount += amostra.nonzeroCount;
  acumulador.fontes.add(fonte);
}

export function fonteAgregada(fontes: Set<"selimp" | "ddmx">): FonteAgregadaOperacional {
  if (fontes.size === 0) return "sem_dados";
  if (fontes.size > 1) return "mista";
  return fontes.has("selimp") ? "selimp" : "ddmx";
}
