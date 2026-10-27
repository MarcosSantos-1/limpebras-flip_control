/**
 * Classificação automática de um dia de despacho DDMX.
 *
 * Problema de bateria é leitura desatualizada ou zerada (0%). Percentual baixo
 * de bateria, troca e manutenção não entram. Execução abaixo de 75% só é
 * problema de execução quando o dia tem bateria no DDMX. Contestação não muda
 * a classe.
 */

export const EXECUCAO_DIA_THRESHOLDS = {
  /** DDMX abaixo disso, com despacho e com bateria DDMX no dia, é problema de execução. */
  PERCENTUAL_BAIXO: 75,
} as const;

export type ClasseAutoDia = "bateria" | "execucao";

export interface ClassificacaoExecucaoDia {
  classe: ClasseAutoDia | null;
  /** Bateria SELIMP desatualizada ou zerada. */
  bateria_selimp: boolean;
  /** Bateria DDMX desatualizada ou zerada (varrição). */
  bateria_ddmx: boolean;
}

export interface SinaisBateriaSelimpDia {
  media_percentual: number | null;
  /** Pior leitura do dia. Uma bateria baixa no meio de várias já interfere. */
  min_percentual?: number | null;
  desatualizadas: number;
  troca: boolean;
  em_manutencao: boolean;
  manutencao_realizada: boolean;
}

export interface SinaisBateriaDdmxDia {
  media_percentual: number | null;
  /** Pior leitura do dia. Uma bateria baixa no meio de várias já interfere. */
  min_percentual?: number | null;
  desatualizadas: number;
}

export interface ClassificarExecucaoDiaInput {
  percentualDdmx: number | null;
  despachosDdmx: number;
  /** Varrição também olha a bateria DDMX do dia. */
  varricao: boolean;
  selimp: SinaisBateriaSelimpDia | null;
  ddmxBateria: SinaisBateriaDdmxDia | null;
}

function leituraZerada(media: number | null, minima?: number | null): boolean {
  const pior = minima != null && Number.isFinite(minima) ? minima : media;
  return pior === 0;
}

function problemaBateria(sinais: { desatualizadas: number; media_percentual: number | null; min_percentual?: number | null } | null): boolean {
  if (!sinais) return false;
  return sinais.desatualizadas > 0 || leituraZerada(sinais.media_percentual, sinais.min_percentual);
}

export function classificarExecucaoDia(input: ClassificarExecucaoDiaInput): ClassificacaoExecucaoDia {
  const bateriaSelimp = problemaBateria(input.selimp);
  const bateriaDdmx = input.varricao && problemaBateria(input.ddmxBateria);
  const percentualBaixo =
    input.despachosDdmx > 0 &&
    input.ddmxBateria != null &&
    input.percentualDdmx != null &&
    Number.isFinite(input.percentualDdmx) &&
    input.percentualDdmx < EXECUCAO_DIA_THRESHOLDS.PERCENTUAL_BAIXO;

  if (!percentualBaixo) {
    return { classe: null, bateria_selimp: bateriaSelimp, bateria_ddmx: bateriaDdmx };
  }
  return { classe: "execucao", bateria_selimp: bateriaSelimp, bateria_ddmx: bateriaDdmx };
}

/** Chave `modulo|YYYY-MM-DD` presente no conjunto de contestações do período. */
export function contestadoNoDia(
  modulosSelimp: readonly string[],
  data: string,
  contestacoes: ReadonlySet<string>,
): boolean {
  const dia = data.slice(0, 10);
  if (!dia) return false;
  return modulosSelimp.some((modulo) => {
    const selimp = modulo.trim();
    return selimp.length > 0 && contestacoes.has(`${selimp}|${dia}`);
  });
}
