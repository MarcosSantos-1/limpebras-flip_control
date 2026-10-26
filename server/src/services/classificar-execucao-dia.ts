/**
 * Classificação automática de um dia de despacho DDMX.
 *
 * Problema de bateria é a interferência da fonte (SELIMP ou DDMX): leitura em
 * 30% ou menos, desatualizada, troca ou manutenção. Isso vale mesmo quando o
 * percentual de execução está alto. Percentual abaixo de 75 sem essa
 * interferência é problema de execução. Contestação não muda a classe.
 */

export const EXECUCAO_DIA_THRESHOLDS = {
  /** DDMX abaixo disso, com despacho no dia, entra na classificação. */
  PERCENTUAL_BAIXO: 75,
  /** Média de bateria neste nível (ou abaixo) conta como interferência. */
  BATERIA_INTERFERENCIA: 30,
} as const;

export type ClasseAutoDia = "bateria" | "execucao";

export interface ClassificacaoExecucaoDia {
  classe: ClasseAutoDia | null;
  /** Percentual baixo com interferência vinda da bateria SELIMP. */
  bateria_selimp: boolean;
  /** Percentual baixo com interferência vinda da bateria DDMX (varrição). */
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

function leituraInterfere(media: number | null, minima?: number | null): boolean {
  const valor = minima != null && Number.isFinite(minima) ? minima : media;
  return valor != null && Number.isFinite(valor) && valor <= EXECUCAO_DIA_THRESHOLDS.BATERIA_INTERFERENCIA;
}

function selimpInterfere(selimp: SinaisBateriaSelimpDia | null): boolean {
  if (!selimp) return false;
  return (
    selimp.troca ||
    selimp.em_manutencao ||
    selimp.manutencao_realizada ||
    selimp.desatualizadas > 0 ||
    leituraInterfere(selimp.media_percentual, selimp.min_percentual)
  );
}

function ddmxInterfere(ddmx: SinaisBateriaDdmxDia | null): boolean {
  if (!ddmx) return false;
  return ddmx.desatualizadas > 0 || leituraInterfere(ddmx.media_percentual, ddmx.min_percentual);
}

export function classificarExecucaoDia(input: ClassificarExecucaoDiaInput): ClassificacaoExecucaoDia {
  const bateriaSelimp = selimpInterfere(input.selimp);
  const bateriaDdmx = input.varricao && ddmxInterfere(input.ddmxBateria);
  const percentualBaixo =
    input.despachosDdmx > 0 &&
    input.percentualDdmx != null &&
    Number.isFinite(input.percentualDdmx) &&
    input.percentualDdmx < EXECUCAO_DIA_THRESHOLDS.PERCENTUAL_BAIXO;

  if (!percentualBaixo) {
    return { classe: null, bateria_selimp: bateriaSelimp, bateria_ddmx: bateriaDdmx };
  }
  if (bateriaSelimp || bateriaDdmx) {
    return { classe: "bateria", bateria_selimp: bateriaSelimp, bateria_ddmx: bateriaDdmx };
  }
  return { classe: "execucao", bateria_selimp: false, bateria_ddmx: false };
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
