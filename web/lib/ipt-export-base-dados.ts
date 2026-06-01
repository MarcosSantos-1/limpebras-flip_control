import * as XLSX from "xlsx";
import { format } from "date-fns";
import type { IptPreviewBateriaSetorDia, IptPreviewModuloBateria } from "@/lib/api";

export interface IptBaseDadosDetalheDiario {
  data: string;
  esperado: boolean;
  percentual_selimp: number | null;
  percentual_nosso: number | null;
  despachos_selimp: number;
  despachos_nosso: number;
  data_estimada?: boolean;
  bateria_setor_dia?: IptPreviewBateriaSetorDia | null;
}

export interface IptBaseDadosExportRow {
  plano: string;
  subprefeitura: string;
  tipo_servico: string;
  percentual_selimp: number | null;
  percentual_nosso: number | null;
  origem: "ambos" | "somente_selimp" | "somente_nosso";
  equipamentos?: string[];
  modulos_bateria?: IptPreviewModuloBateria[];
  produtividade_bateria_media?: number | null;
  bateria_por_equipamento?: Record<
    string,
    {
      status_bateria: string;
      bateria?: string;
      data_ultima_comunicacao?: string;
      dias?: string;
      dias_on?: number;
      dias_off?: number;
      produtividade_bateria?: number;
      status_sinal?: string;
      numero_selimp?: string;
    }
  >;
  frequencia?: string | null;
  cronograma_preview?: string[];
  detalhes_diarios?: IptBaseDadosDetalheDiario[];
}

export interface IptBaseDadosObservacoes {
  globais: Record<string, { id: number; titulo: string; descricao: string | null }>;
  diarias: Record<string, Record<string, { id: number; titulo: string; descricao: string | null }>>;
}

export interface IptBaseDadosExportMeta {
  periodoLabel: string;
  mesReferencia: string;
}

const HEADERS = [
  "Dia do despacho",
  "Setor",
  "Subprefeitura",
  "Serviço",
  "% SELIMP",
  "Bateria SELIMP",
  "Bateria SELIMP (status)",
  "Produtividade bateria média (SELIMP)",
  "% DDMX",
  "Origem",
  "Obs. global",
  "Obs. diária",
  "Frequência",
  "Cronograma",
  "Equipamentos",
] as const;

function formatDateBr(iso?: string | null): string {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatPercentual(value?: number | null): number | string {
  if (value == null || Number.isNaN(value)) return "";
  return Math.round(value * 10) / 10;
}

function getOrigemLabelFromDetalhe(detalhe: IptBaseDadosDetalheDiario): string {
  if (detalhe.despachos_selimp > 0 && detalhe.despachos_nosso > 0) return "Ambos";
  if (detalhe.despachos_selimp > 0) return "Só SELIMP";
  if (detalhe.despachos_nosso > 0) return "Só DDMX";
  return "--";
}

function getOrigemLabelFromRow(row: IptBaseDadosExportRow): string {
  const origemEfetiva =
    row.percentual_selimp == null && row.percentual_nosso == null ? "sem_despacho" : row.origem;
  if (origemEfetiva === "sem_despacho") return "--";
  if (origemEfetiva === "ambos") return "Ambos";
  if (origemEfetiva === "somente_selimp") return "Só SELIMP";
  return "Só DDMX";
}

function parseBateriaNumero(raw?: string | null, percentual?: number | null): number | string {
  if (percentual != null && !Number.isNaN(percentual)) return formatPercentual(percentual);
  if (!raw) return "";
  const cleaned = raw.replace(",", ".").replace("%", "").trim();
  const n = Number(cleaned);
  if (Number.isFinite(n)) return n > 1 ? Math.round(n * 10) / 10 : Math.round(n * 1000) / 10;
  return "";
}

function deriveStatusFromPercentual(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "Sem status";
  if (value <= 15) return "Crítico";
  if (value <= 30) return "Alerta";
  return "Normal";
}

function formatBateriaSelimpFromDia(bateriaDia?: IptPreviewBateriaSetorDia | null): { numero: number | string; status: string } {
  if (!bateriaDia || bateriaDia.modulos.length === 0) {
    return { numero: "", status: "" };
  }

  if (bateriaDia.desatualizadas > 0) {
    const status = bateriaDia.modulos
      .map((modulo) => {
        const statusText = modulo.bateria_desatualizada ? "Desatualizada" : modulo.bateria_raw || "Sem status";
        return `${modulo.numero_selimp}: ${statusText}`;
      })
      .join("; ");
    return { numero: "", status };
  }

  const numero =
    bateriaDia.media_percentual != null
      ? formatPercentual(bateriaDia.media_percentual)
      : parseBateriaNumero(bateriaDia.modulos[0]?.bateria_raw, bateriaDia.modulos[0]?.bateria_percentual);

  const status = bateriaDia.modulos
    .map((modulo) => {
      const pct = modulo.bateria_percentual ?? (typeof parseBateriaNumero(modulo.bateria_raw, null) === "number"
        ? (parseBateriaNumero(modulo.bateria_raw, null) as number)
        : null);
      const statusText =
        modulo.bateria_raw && parseBateriaNumero(modulo.bateria_raw, null) === ""
          ? modulo.bateria_raw
          : deriveStatusFromPercentual(pct);
      return `${modulo.numero_selimp}: ${statusText}`;
    })
    .join("; ");

  return { numero, status };
}

function formatBateriaSelimpFromRow(row: IptBaseDadosExportRow): { numero: number | string; status: string } {
  const numeros: Array<number | string> = [];
  const statuses: string[] = [];

  if (row.modulos_bateria?.length) {
    for (const mod of row.modulos_bateria) {
      const num = parseBateriaNumero(mod.bateria, mod.bateria_percentual ?? mod.produtividade_bateria);
      if (num !== "") numeros.push(num);
      statuses.push(`${mod.numero_selimp}: ${mod.status_bateria || "Sem status"}`);
    }
  }

  if (row.bateria_por_equipamento && Object.keys(row.bateria_por_equipamento).length > 0) {
    for (const [codigo, info] of Object.entries(row.bateria_por_equipamento)) {
      const num = parseBateriaNumero(info.bateria, info.produtividade_bateria ?? null);
      if (num !== "") numeros.push(num);
      statuses.push(`${codigo}: ${info.status_bateria}`);
    }
  }

  const numero =
    numeros.length === 0
      ? formatPercentual(row.produtividade_bateria_media)
      : numeros.length === 1
      ? numeros[0]
      : numeros.join("; ");

  return { numero, status: statuses.join("; ") };
}

function formatObsGlobal(obs?: { titulo: string; descricao: string | null }): string {
  if (!obs) return "";
  if (obs.descricao?.trim()) return `${obs.titulo} — ${obs.descricao.trim()}`;
  return obs.titulo;
}

function formatObsDiariaForDate(
  diarias?: Record<string, { titulo: string; descricao: string | null }>,
  dateKey?: string
): string {
  if (!diarias || !dateKey) return "";
  const obs = diarias[dateKey.replace(/T.*/, "")];
  if (!obs) return "";
  if (obs.descricao?.trim()) return `${obs.titulo} — ${obs.descricao.trim()}`;
  return obs.titulo;
}

function formatCronograma(dates?: string[]): string {
  if (!dates?.length) return "";
  return dates.map((d) => formatDateBr(d)).filter(Boolean).join(", ");
}

function buildFilename(meta: IptBaseDadosExportMeta): string {
  const safePeriodo = meta.periodoLabel.replace(/[^\d_a-z-]/gi, "_").replace(/_+/g, "_");
  const timestamp = format(new Date(), "yyyyMMdd-HHmmss");
  return `ipt_base_dados_${safePeriodo}_${timestamp}.xlsx`;
}

interface ExpandedExportEntry {
  row: IptBaseDadosExportRow;
  detalhe?: IptBaseDadosDetalheDiario;
}

export function countIptBaseDadosExportRows(rows: IptBaseDadosExportRow[]): number {
  let count = 0;
  for (const row of rows) {
    const despachos =
      row.detalhes_diarios?.filter((d) => d.despachos_selimp > 0 || d.despachos_nosso > 0) ?? [];
    count += despachos.length > 0 ? despachos.length : 1;
  }
  return count;
}

function expandRowsForExport(rows: IptBaseDadosExportRow[]): ExpandedExportEntry[] {
  const expanded: ExpandedExportEntry[] = [];

  for (const row of rows) {
    const despachos =
      row.detalhes_diarios?.filter((d) => d.despachos_selimp > 0 || d.despachos_nosso > 0) ?? [];

    if (despachos.length > 0) {
      for (const detalhe of despachos) {
        expanded.push({ row, detalhe });
      }
      continue;
    }

    expanded.push({ row });
  }

  return expanded.sort((a, b) => {
    const dateA = a.detalhe?.data ?? "";
    const dateB = b.detalhe?.data ?? "";
    if (dateA !== dateB) return dateB.localeCompare(dateA);
    return (a.row.plano || "").localeCompare(b.row.plano || "", "pt-BR");
  });
}

function buildExportRow(
  entry: ExpandedExportEntry,
  observacoes: IptBaseDadosObservacoes
): (string | number)[] {
  const { row, detalhe } = entry;
  const obsGlobal = observacoes.globais[row.plano];
  const dateKey = detalhe?.data.replace(/T.*/, "") ?? "";
  const obsDiaria = formatObsDiariaForDate(observacoes.diarias[row.plano], dateKey);

  const bateria = detalhe
    ? formatBateriaSelimpFromDia(detalhe.bateria_setor_dia)
    : formatBateriaSelimpFromRow(row);

  const pctSelimp = detalhe ? detalhe.percentual_selimp : row.percentual_selimp;
  const pctDdmx = detalhe ? detalhe.percentual_nosso : row.percentual_nosso;
  const origem = detalhe ? getOrigemLabelFromDetalhe(detalhe) : getOrigemLabelFromRow(row);
  const prodBateria =
    detalhe?.bateria_setor_dia?.media_percentual != null
      ? formatPercentual(detalhe.bateria_setor_dia.media_percentual)
      : formatPercentual(row.produtividade_bateria_media);

  return [
    detalhe ? formatDateBr(detalhe.data) : "",
    row.plano || "",
    row.subprefeitura || "",
    row.tipo_servico || "",
    formatPercentual(pctSelimp),
    bateria.numero,
    bateria.status,
    prodBateria,
    formatPercentual(pctDdmx),
    origem,
    formatObsGlobal(obsGlobal),
    obsDiaria,
    row.frequencia || "",
    formatCronograma(row.cronograma_preview),
    (row.equipamentos ?? []).join(", "),
  ];
}

export function exportIptBaseDadosXlsx(
  rows: IptBaseDadosExportRow[],
  observacoes: IptBaseDadosObservacoes,
  meta: IptBaseDadosExportMeta
): void {
  const expanded = expandRowsForExport(rows);
  const dataRows = expanded.map((entry) => buildExportRow(entry, observacoes));

  const sheet = XLSX.utils.aoa_to_sheet([Array.from(HEADERS), ...dataRows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Base de dados");

  const metaSheet = XLSX.utils.aoa_to_sheet([
    ["Período", meta.periodoLabel],
    ["Mês referência", meta.mesReferencia],
    ["Setores exportados", rows.length],
    ["Despachos exportados", expanded.length],
    ["Exportado em", format(new Date(), "dd/MM/yyyy HH:mm:ss")],
  ]);
  XLSX.utils.book_append_sheet(workbook, metaSheet, "Metadados");

  XLSX.writeFile(workbook, buildFilename(meta));
}
