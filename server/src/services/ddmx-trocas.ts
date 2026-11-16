/**
 * Regras das trocas de bateria dos módulos DDMX (rastreador secundário).
 * Mesma leitura das trocas CLIMP: status por faixa de bateria e sucesso
 * automático pela primeira leitura DDMX depois da troca.
 */

export type StatusBateriaDdmx = "ALTA" | "REGULAR" | "BAIXA" | "CRÍTICA" | "DESATUALIZADA" | "SEM LEITURA";

/** Mesmo mínimo das trocas CLIMP para considerar a troca com sucesso. */
export const SUCESSO_MIN_PCT_DEPOIS_DDMX = 60;

/** Mesmos limiares da CLIMP: >70 ALTA · >30 REGULAR · >15 BAIXA · senão CRÍTICA. */
export function statusBateriaDdmx(
  leitura: { bateria: number | null; desatualizada: boolean } | null | undefined,
): StatusBateriaDdmx {
  if (!leitura) return "SEM LEITURA";
  if (leitura.desatualizada) return "DESATUALIZADA";
  const p = leitura.bateria;
  if (p == null || !Number.isFinite(p)) return "SEM LEITURA";
  if (p > 70) return "ALTA";
  if (p > 30) return "REGULAR";
  if (p > 15) return "BAIXA";
  return "CRÍTICA";
}

/** Motivo da troca a partir do status atual (mesma lógica da aba CLIMP). */
export function motivoTrocaDdmx(status: StatusBateriaDdmx): string {
  switch (status) {
    case "DESATUALIZADA":
    case "SEM LEITURA":
      return "Corretiva";
    case "CRÍTICA":
    case "BAIXA":
      return "Preventiva";
    default:
      return "Desnecessária";
  }
}

export type LeituraDdmx = {
  data: string;
  plano: string;
  bateria: number | null;
  bateriaRaw: string | null;
  desatualizada: boolean;
  ultimaComunicacao: string | null;
  percentualExecucao: number | null;
};

export type AvaliacaoTroca = {
  /** null = aguardando leitura pós-troca. */
  sucesso: boolean | null;
  depois: LeituraDdmx | null;
};

/**
 * Sucesso automático: primeira leitura DDMX em dia posterior à troca
 * (no próprio dia a leitura pode ser de antes da troca). Desatualizada ou
 * abaixo do mínimo = sem sucesso; sem leitura ainda = aguardando.
 */
export function avaliarTrocaDdmx(dataTroca: string | null, leiturasAsc: LeituraDdmx[], manual?: boolean | null): AvaliacaoTroca {
  if (!dataTroca) return { sucesso: manual ?? null, depois: null };
  const depois = leiturasAsc.find((l) => l.data > dataTroca) ?? null;
  if (manual != null) return { sucesso: manual, depois };
  if (!depois) return { sucesso: null, depois: null };
  if (depois.desatualizada || depois.bateria == null) return { sucesso: false, depois };
  return { sucesso: depois.bateria >= SUCESSO_MIN_PCT_DEPOIS_DDMX, depois };
}

/** Uma leitura por dia: a de maior bateria válida entre os setores do módulo. */
export function leiturasDiariasModulo(leituras: LeituraDdmx[]): LeituraDdmx[] {
  const porDia = new Map<string, LeituraDdmx>();
  for (const l of leituras) {
    const cur = porDia.get(l.data);
    if (!cur) {
      porDia.set(l.data, l);
      continue;
    }
    const melhor =
      cur.desatualizada && !l.desatualizada
        ? l
        : !cur.desatualizada && l.desatualizada
          ? cur
          : (l.bateria ?? -1) > (cur.bateria ?? -1)
            ? l
            : cur;
    porDia.set(l.data, {
      ...melhor,
      percentualExecucao: Math.max(cur.percentualExecucao ?? -1, l.percentualExecucao ?? -1) < 0
        ? null
        : Math.max(cur.percentualExecucao ?? -1, l.percentualExecucao ?? -1),
    });
  }
  return [...porDia.values()].sort((a, b) => a.data.localeCompare(b.data));
}

/**
 * Despacho de hoje ainda em andamento não tem data final e aparece como
 * "desatualizado" — não conta como leitura (nem para status, nem para sucesso).
 */
export function semDiaEmAndamento(leiturasAsc: LeituraDdmx[], hoje: string): LeituraDdmx[] {
  return leiturasAsc.filter((l) => !(l.data >= hoje && l.desatualizada));
}
