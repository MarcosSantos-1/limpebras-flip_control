/**
 * Classificação automática de um dia de despacho DDMX.
 *
 * Problema de bateria é só leitura desatualizada do despacho. Percentual baixo,
 * bateria zerada, troca e manutenção não entram. Execução de até 80%, inclusive,
 * só é problema de execução quando o dia tem bateria DDMX não desatualizada, com
 * sinal e com percentual (mesmo 5%). Contestação não muda a classe.
 * Observação diária também marca o despacho na tela, fora desta função.
 */

export const EXECUCAO_DIA_THRESHOLDS = {
  /** DDMX até este percentual, inclusive, com despacho e bateria DDMX válida, é problema de execução. */
  PERCENTUAL_BAIXO: 80,
} as const;

export type ClasseAutoDia = "bateria" | "execucao";

export interface ClassificacaoExecucaoDia {
  classe: ClasseAutoDia | null;
  /** Bateria SELIMP desatualizada no despacho. */
  bateria_selimp: boolean;
  /** Bateria DDMX desatualizada no despacho (varrição). */
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
  /**
   * Há ao menos uma leitura do despacho não desatualizada, com sinal
   * (última comunicação) e com percentual de bateria, mesmo 5%.
   */
  com_sinal_e_bateria: boolean;
}

export interface ClassificarExecucaoDiaInput {
  percentualDdmx: number | null;
  despachosDdmx: number;
  /** Varrição também olha a bateria DDMX do dia. */
  varricao: boolean;
  selimp: SinaisBateriaSelimpDia | null;
  ddmxBateria: SinaisBateriaDdmxDia | null;
}

function problemaBateria(sinais: { desatualizadas: number } | null): boolean {
  if (!sinais) return false;
  return sinais.desatualizadas > 0;
}

export function classificarExecucaoDia(input: ClassificarExecucaoDiaInput): ClassificacaoExecucaoDia {
  const bateriaSelimp = problemaBateria(input.selimp);
  const bateriaDdmx = input.varricao && problemaBateria(input.ddmxBateria);
  const percentualBaixo =
    input.despachosDdmx > 0 &&
    input.ddmxBateria?.com_sinal_e_bateria === true &&
    input.percentualDdmx != null &&
    Number.isFinite(input.percentualDdmx) &&
    input.percentualDdmx <= EXECUCAO_DIA_THRESHOLDS.PERCENTUAL_BAIXO;

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
