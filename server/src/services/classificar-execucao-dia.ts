/**
 * Classificação automática de um dia de despacho DDMX.
 *
 * Percentual abaixo de 75 sem troca e sem interferência de bateria é problema
 * de execução. Troca ou interferência no mesmo dia vira problema de bateria.
 * Contestação é um sinal à parte e não muda esta classe.
 */

export const EXECUCAO_DIA_THRESHOLDS = {
  /** DDMX abaixo disso, com despacho no dia, entra na classificação. */
  PERCENTUAL_BAIXO: 75,
  /** Média de bateria neste nível (ou abaixo) conta como interferência. */
  BATERIA_INTERFERENCIA: 30,
} as const;

export type ClasseAutoDia = "bateria" | "execucao";

export interface SinaisBateriaSelimpDia {
  media_percentual: number | null;
  desatualizadas: number;
  troca: boolean;
  em_manutencao: boolean;
  manutencao_realizada: boolean;
}

export interface SinaisBateriaDdmxDia {
  media_percentual: number | null;
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

function mediaInterfere(media: number | null): boolean {
  return media != null && Number.isFinite(media) && media <= EXECUCAO_DIA_THRESHOLDS.BATERIA_INTERFERENCIA;
}

function selimpInterfere(selimp: SinaisBateriaSelimpDia | null): boolean {
  if (!selimp) return false;
  return (
    selimp.troca ||
    selimp.em_manutencao ||
    selimp.manutencao_realizada ||
    selimp.desatualizadas > 0 ||
    mediaInterfere(selimp.media_percentual)
  );
}

function ddmxInterfere(ddmx: SinaisBateriaDdmxDia | null): boolean {
  if (!ddmx) return false;
  return ddmx.desatualizadas > 0 || mediaInterfere(ddmx.media_percentual);
}

export function classificarExecucaoDia(input: ClassificarExecucaoDiaInput): ClasseAutoDia | null {
  if (input.despachosDdmx <= 0) return null;
  if (input.percentualDdmx == null || !Number.isFinite(input.percentualDdmx)) return null;
  if (input.percentualDdmx >= EXECUCAO_DIA_THRESHOLDS.PERCENTUAL_BAIXO) return null;

  const interferencia = selimpInterfere(input.selimp) || (input.varricao && ddmxInterfere(input.ddmxBateria));
  return interferencia ? "bateria" : "execucao";
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
