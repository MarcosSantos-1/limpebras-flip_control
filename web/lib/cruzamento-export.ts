/**
 * Exporta o "Plano de Ação" do Cruzamento Inteligente em XLSX.
 *
 * Uma aba consolidada (todos os setores, ordenados por impacto) + uma aba por
 * causa-raiz (Pontos cegos / Hardware / Hiberna / Divergência / Operação), para
 * mandar a cada área só o que é dela resolver.
 */

import * as XLSX from "xlsx";
import { format } from "date-fns";
import { ROOT_CAUSE_META, type RootCause, type SectorAnalysis } from "@/lib/cruzamento-engine";

const HEADERS = [
  "Prioridade",
  "Setor",
  "SUB",
  "Serviço",
  "Frequência",
  "Previstos",
  "Despachados",
  "Não despachados",
  "Zerados",
  "% médio",
  "Cobertura %",
  "Impacto IPT",
  "Bateria média %",
  "Divergência (pp)",
  "Nº trocas",
  "Causa provável",
  "Responsável",
  "Flags",
  "Observação registrada",
] as const;

const fmtNum = (v: number | null | undefined, dec = 0) =>
  v == null || !Number.isFinite(v) ? "" : Number(v.toFixed(dec));

function buildRow(s: SectorAnalysis, index: number): (string | number)[] {
  return [
    index + 1,
    s.plano,
    s.sub,
    s.tipoServico,
    s.frequenciaLabel,
    s.previstos,
    s.despachados,
    s.naoDespachados,
    s.zerados,
    fmtNum(s.percentualMedio, 1),
    fmtNum(s.cobertura, 0),
    fmtNum(s.impactoIpt, 1),
    fmtNum(s.bateriaMedia, 0),
    fmtNum(s.divergencia, 0),
    s.qtdTrocas,
    ROOT_CAUSE_META[s.causaRaiz].label,
    ROOT_CAUSE_META[s.causaRaiz].responsavel,
    [s.trocaSemEfeito ? "Troca sem efeito" : "", s.contestavel ? "Contestável" : ""].filter(Boolean).join(" · "),
    s.obsGlobalTitulo ?? "",
  ];
}

const COL_WIDTHS = [
  9, 18, 6, 26, 22, 9, 11, 14, 8, 9, 11, 11, 13, 14, 9, 22, 16, 18, 30,
].map((w) => ({ wch: w }));

export interface CruzamentoExportMeta {
  periodoLabel: string;
  subLabel: string;
  servicoLabel: string;
}

/** Aplica largura de coluna e devolve a sheet pronta. */
function sheetFrom(rows: SectorAnalysis[]): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet([Array.from(HEADERS), ...rows.map(buildRow)]);
  sheet["!cols"] = COL_WIDTHS;
  return sheet;
}

const RESPONSAVEL_ORDER: RootCause[] = ["pontos_cegos", "hardware", "hibernando", "divergencia", "operacao"];

export function exportCruzamentoPlanoAcao(setores: SectorAnalysis[], meta: CruzamentoExportMeta): void {
  const workbook = XLSX.utils.book_new();

  // Aba 1: consolidado (exclui "ok", que não é pauta).
  const pauta = setores.filter((s) => s.causaRaiz !== "ok");
  XLSX.utils.book_append_sheet(workbook, sheetFrom(pauta), "Plano de ação");

  // Abas por responsável.
  for (const causa of RESPONSAVEL_ORDER) {
    const grupo = pauta.filter((s) => s.causaRaiz === causa);
    if (grupo.length === 0) continue;
    // Nomes de aba não podem conter \ / ? * [ ] : (limite de 31 chars).
    const nome = ROOT_CAUSE_META[causa].label.replace(/[\\/?*[\]:]/g, "-").slice(0, 28);
    XLSX.utils.book_append_sheet(workbook, sheetFrom(grupo), nome);
  }

  // Metadados.
  const metaSheet = XLSX.utils.aoa_to_sheet([
    ["Relatório", "Cruzamento Inteligente — Plano de ação"],
    ["Período", meta.periodoLabel],
    ["Subprefeitura", meta.subLabel],
    ["Serviço", meta.servicoLabel],
    ["Setores na pauta", pauta.length],
    ["Impacto IPT total (despachos-equiv.)", fmtNum(pauta.reduce((a, s) => a + s.impactoIpt, 0), 1)],
    ["Gerado em", format(new Date(), "dd/MM/yyyy HH:mm:ss")],
  ]);
  metaSheet["!cols"] = [{ wch: 36 }, { wch: 48 }];
  XLSX.utils.book_append_sheet(workbook, metaSheet, "Metadados");

  XLSX.writeFile(workbook, `plano_acao_cruzamento_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
}
