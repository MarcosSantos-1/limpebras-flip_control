/**
 * Exporta a lista de gargalos: o que puxa o percentual, separado entre
 * problema operacional e pendentes.
 */

import * as XLSX from "xlsx";
import { format } from "date-fns";
import type { GargaloSetor, GrupoGargalo, MotivoGargalo } from "@/lib/api";

export const MOTIVO_GARGALO_LABEL: Record<MotivoGargalo, string> = {
  bateria: "Bateria",
  falta_envio: "Falta de envio",
  planejamento: "Planejamento / cadastro",
  nunca: "Nunca ou quase nunca",
  execucao_baixa: "Execução baixa",
};

const GRUPO_LABEL: Record<GrupoGargalo, string> = {
  nosso: "Pendentes",
  operacional: "Problema operacional",
};

const HEADERS = [
  "Prioridade",
  "Grupo",
  "Motivo",
  "Setor",
  "SUB",
  "Serviço",
  "Frequência",
  "Previstos",
  "Encerrados",
  "Não enviados",
  "% médio",
  "Pontos (pp)",
  "O que pesa",
  "Observação",
] as const;

function fraseLista(s: GargaloSetor): string {
  const motivo = s.frase.charAt(0).toUpperCase() + s.frase.slice(1);
  if (s.pp >= 0.05) return `Tira ${s.pp.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} pp deste serviço — ${s.frase}`;
  return motivo;
}

function buildRow(s: GargaloSetor, index: number): (string | number)[] {
  return [
    index + 1,
    GRUPO_LABEL[s.grupo],
    MOTIVO_GARGALO_LABEL[s.motivo],
    s.plano,
    s.sub,
    s.tipoServico,
    s.frequencia,
    s.previstos,
    s.encerrados,
    s.naoEnviados,
    s.percentual == null ? "" : Number(s.percentual.toFixed(1)),
    Number(s.pp.toFixed(1)),
    fraseLista(s),
    s.obsTitulo ?? "",
  ];
}

const COL_WIDTHS = [11, 22, 24, 18, 6, 42, 28, 11, 12, 14, 10, 12, 64, 28].map((w) => ({ wch: w }));

export interface GargalosExportMeta {
  periodoLabel: string;
  subLabel: string;
  servicoLabel: string;
}

function sheetFrom(rows: GargaloSetor[], meta: GargalosExportMeta): XLSX.WorkSheet {
  const cabecalho = [
    ["Gargalos de execução", meta.periodoLabel],
    ["Subprefeitura", meta.subLabel],
    ["Serviço", meta.servicoLabel],
    [],
  ];
  const sheet = XLSX.utils.aoa_to_sheet([
    ...cabecalho,
    Array.from(HEADERS),
    ...rows.map(buildRow),
  ]);
  sheet["!cols"] = COL_WIDTHS;
  return sheet;
}

export function exportGargalos(setores: GargaloSetor[], meta: GargalosExportMeta) {
  const workbook = XLSX.utils.book_new();
  const operacional = setores.filter((s) => s.grupo === "operacional");
  const pendentes = setores.filter((s) => s.grupo === "nosso");
  XLSX.utils.book_append_sheet(workbook, sheetFrom([...operacional, ...pendentes], meta), "Todos");
  XLSX.utils.book_append_sheet(workbook, sheetFrom(operacional, meta), "Problema operacional");
  XLSX.utils.book_append_sheet(workbook, sheetFrom(pendentes, meta), "Pendentes");
  XLSX.writeFile(workbook, `gargalos_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
}
