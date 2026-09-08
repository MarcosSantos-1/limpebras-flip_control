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
): { percentual: number | null; fonte: FontePercentualOperacional } {
  if (percentualSelimp != null && Number.isFinite(percentualSelimp)) {
    return { percentual: percentualSelimp, fonte: "selimp" };
  }
  if (percentualDdmx != null && Number.isFinite(percentualDdmx)) {
    return { percentual: percentualDdmx, fonte: "ddmx" };
  }
  return { percentual: null, fonte: null };
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
