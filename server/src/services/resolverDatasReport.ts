import {
  isFrequencyDate,
  normalizarSetor,
  parseSetor,
} from "../constants/ipt.js";
import {
  carregarCronograma,
  estimarDatasReport,
  type ReportLinhaComData,
  type ReportLinhaRaw,
} from "./estimarDataReport.js";

const DATA_PLANEJADA_ALIASES = ["data_planejada", "data", "data_planejado", "data_execucao"] as const;

function canonicalHeader(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Parse dd/mm/yyyy ou ISO para date key YYYY-MM-DD. */
export function parseDataPlanejadaRaw(value: string): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;

  const brMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (brMatch) {
    const day = Number(brMatch[1]);
    const month = Number(brMatch[2]);
    const year = Number(brMatch[3].length === 2 ? `20${brMatch[3]}` : brMatch[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const direct = new Date(trimmed);
  if (Number.isNaN(direct.getTime())) return null;
  const y = direct.getFullYear();
  const m = String(direct.getMonth() + 1).padStart(2, "0");
  const d = String(direct.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function extrairDataPlanejadaRaw(raw: Record<string, string>): string | null {
  for (const alias of DATA_PLANEJADA_ALIASES) {
    const value = raw[canonicalHeader(alias)];
    if (!value) continue;
    const dateKey = parseDataPlanejadaRaw(value);
    if (dateKey) return dateKey;
  }
  return null;
}

export function isDespachoEsperado(
  plano: string,
  dateKey: string,
  cronogramaMap: Map<string, string[]>
): boolean {
  const normalized = normalizarSetor(plano);
  if (!normalized || !dateKey) return false;

  const cronDates = cronogramaMap.get(normalized) ?? [];
  if (cronDates.includes(dateKey)) return true;

  const parsed = parseSetor(normalized);
  if (parsed?.frequencia && isFrequencyDate(parsed.frequencia, dateKey)) return true;

  return false;
}

export interface ResolverDatasReportStats {
  com_data_selimp: number;
  estimadas: number;
  despachos_inesperados: number;
  fora_periodo: number;
}

export interface ResolverDatasReportResult {
  linhas: ReportLinhaComData[];
  stats: ResolverDatasReportStats;
}

/**
 * Usa "Data planejada" da SELIMP quando disponível; fallback para estimarDatasReport.
 */
export async function resolverDatasReport(
  linhas: ReportLinhaRaw[],
  periodoInicial: string,
  periodoFinal: string
): Promise<ResolverDatasReportResult> {
  const cronogramaMap = await carregarCronograma(periodoInicial, periodoFinal);

  const comDataSelimp: ReportLinhaComData[] = [];
  const semData: ReportLinhaRaw[] = [];
  let foraPeriodo = 0;

  for (const linha of linhas) {
    const plano = normalizarSetor(linha.plano);
    const dataPlanejada = extrairDataPlanejadaRaw(linha.raw ?? {});
    const parsed = parseSetor(plano);

    if (dataPlanejada) {
      if (dataPlanejada < periodoInicial || dataPlanejada > periodoFinal) {
        foraPeriodo += 1;
      }
      comDataSelimp.push({
        ...linha,
        plano: plano || linha.plano,
        frequencia: parsed?.frequencia ?? "",
        servico_codigo: parsed?.servico ?? "",
        data_estimada: dataPlanejada,
        metodo_estimativa: "selimp_data_planejada",
        confianca_estimativa: "alta",
        despacho_esperado: isDespachoEsperado(plano, dataPlanejada, cronogramaMap),
      });
    } else {
      semData.push(linha);
    }
  }

  const estimadas =
    semData.length > 0 ? await estimarDatasReport(semData, periodoInicial, periodoFinal) : [];

  const linhasResolvidas = [...comDataSelimp, ...estimadas].sort(
    (a, b) => a.posicao_original - b.posicao_original
  );

  const despachosInesperados = comDataSelimp.filter((l) => l.despacho_esperado === false).length;

  return {
    linhas: linhasResolvidas,
    stats: {
      com_data_selimp: comDataSelimp.length,
      estimadas: estimadas.length,
      despachos_inesperados: despachosInesperados,
      fora_periodo: foraPeriodo,
    },
  };
}
