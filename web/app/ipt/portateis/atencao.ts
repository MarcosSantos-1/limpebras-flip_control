import type { PortatilHistoricoPonto, PortatilModulo } from "@/lib/api";
import { isServicoFeira } from "./labels";

export type AtencaoLevel = "ok" | "problema" | "hibernando";

export interface AtencaoPortatil {
  level: AtencaoLevel;
  hibernando: boolean;
  motivos: string[];
}

function diaSp(iso?: string | null): string | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(date);
}

function diasEntre(inicio: string, fim: string): number {
  const ms = Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function leituraOnline(ponto?: PortatilHistoricoPonto | null): boolean {
  return Boolean(ponto && ponto.comunicacao === "ON" && !ponto.bateriaDesatualizada);
}

function statusCritica(modulo: PortatilModulo): boolean {
  if (modulo.bateriaDesatualizada) return false;
  return modulo.bateriaPercentual != null && modulo.bateriaPercentual <= 15;
}

/**
 * Atenção do portátil. Feira não hiberna: dia sem leitura é falta de relatório.
 * Os demais só ganham H quando a leitura atual está desatualizada e as duas
 * importações anteriores estavam online.
 */
export function avaliarPortatil(modulo: PortatilModulo, dataExportacaoLote?: string | null): AtencaoPortatil {
  const motivos: string[] = [];
  const feira = isServicoFeira(modulo.atribuicao?.servico);
  const historico = modulo.historico ?? [];
  const desatualizada = modulo.bateriaDesatualizada || modulo.comunicacao === "OFF";
  const anterioresOnline = leituraOnline(historico[1]) && leituraOnline(historico[2]);
  const hibernando = !feira && desatualizada && anterioresOnline;

  if (statusCritica(modulo)) motivos.push("Bateria crítica");

  if (feira) {
    const diaLeitura = diaSp(modulo.ultimaComunicacao);
    const diaLote = diaSp(dataExportacaoLote);
    if (diaLote && diaLeitura !== diaLote) motivos.push("Leitura de feira ausente no dia da exportação");
  }

  if (!hibernando && desatualizada) {
    const diaLeitura = diaSp(modulo.ultimaComunicacao);
    const diaLote = diaSp(dataExportacaoLote);
    if (!diaLeitura || (diaLote != null && diasEntre(diaLeitura, diaLote) > 1)) {
      motivos.push("Sem comunicação há mais de um dia");
    }
  }

  if (motivos.length > 0) return { level: "problema", hibernando: false, motivos };
  if (hibernando) return { level: "hibernando", hibernando: true, motivos: ["Offline agora, online nas duas importações anteriores"] };
  return { level: "ok", hibernando: false, motivos: [] };
}
