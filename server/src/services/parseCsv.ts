import { parse } from "csv-parse/sync";
import { parseFlipDate } from "../utils/date.js";
import { isBfsNaoDemandante } from "../constants/bfs.js";

const SEP = ";";
export type FlipCsvType = "sacs" | "cnc" | "cncsDetalhes" | "acic" | "ouvidoria";
const SAC_REQUIRED_CANONICAL = [
  "data_registro",
  "finalizado_como_fora_de_escopo",
  "procedente_por_status",
  "classificacao_do_servico",
  "responsividade_execucao",
];

function normalizeHeader(h: string): string {
  return h.replace(/\s+/g, " ").trim();
}

function canonicalKey(h: string): string {
  return normalizeHeader(h)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeText(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function headerScore(text: string, expected: string[]): number {
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const headers = firstLine.split(SEP).map(canonicalKey);
  let score = 0;
  for (const k of expected) {
    if (headers.includes(k)) score++;
  }
  return score;
}

function decodeCsvBuffer(buffer: Buffer): string {
  const utf8 = buffer.toString("utf-8").replace(/^\uFEFF/, "");
  const latin1 = buffer.toString("latin1").replace(/^\uFEFF/, "");

  const utf8Score = headerScore(utf8, SAC_REQUIRED_CANONICAL);
  const latin1Score = headerScore(latin1, SAC_REQUIRED_CANONICAL);

  // FLIP costuma vir em ANSI/Latin1; se UTF-8 não reconhecer colunas acentuadas, usa Latin1.
  return latin1Score > utf8Score ? latin1 : utf8;
}

function readSampleRecords(text: string): Record<string, string>[] {
  return parse(text, {
    delimiter: SEP,
    columns: (headers) => headers.map((h: string) => normalizeHeader(h)),
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
    to_line: 8,
  }) as Record<string, string>[];
}

function getSampleColumnValues(records: Record<string, string>[], aliases: string[]): string[] {
  return records
    .map((row) => getCanonical(row, aliases))
    .filter(Boolean)
    .slice(0, 6);
}

export function detectFlipCsvType(buffer: Buffer, sourceFile: string): FlipCsvType | null {
  const text = decodeCsvBuffer(buffer);
  const headers = (text.split(/\r?\n/)[0] ?? "").split(SEP).map(canonicalKey);
  const name = normalizeText(sourceFile);

  // ACIC tem identificador único por linha (N_ACIC). O CSV costuma repetir colunas de BFS/CNC (n_bfs, data_fiscalizacao),
  // que antes faziam cair na detecção de CNC / consulta CNC antes de origem ou nome do arquivo.
  if (headers.includes("n_acic") || headers.includes("numero_acic")) {
    return "acic";
  }

  if (headers.includes("n_bfs") || headers.includes("n_cnc") || headers.includes("situacao_cnc")) {
    return "cncsDetalhes";
  }

  if (headerScore(text, SAC_REQUIRED_CANONICAL) >= 4 || headers.includes("numero_chamado")) {
    return "sacs";
  }

  if ((headers.includes("numero_bfs") || headers.includes("n_bfs")) && headers.includes("data_fiscalizacao")) {
    return "cnc";
  }

  const records = readSampleRecords(text);
  const origemValues = getSampleColumnValues(records, ["origem"]).map(normalizeText);
  if (origemValues.some((value) => value.includes("ouvid"))) {
    return "ouvidoria";
  }
  if (origemValues.some((value) => value.includes("acic"))) {
    return "acic";
  }

  if (name.includes("ouvid")) return "ouvidoria";
  if (name.includes("acic")) return "acic";
  if (name.includes("sac")) return "sacs";
  if (name.includes("bfs")) return "cnc";
  if (name.includes("cnc")) return "cncsDetalhes";

  return null;
}

function parseDelimitedRecords(buffer: Buffer): Record<string, string>[] {
  const text = decodeCsvBuffer(buffer);
  return parse(text, {
    delimiter: SEP,
    columns: (headers) => headers.map((h: string) => normalizeHeader(h)),
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
}

function getCanonical(row: Record<string, string>, aliases: string[]): string {
  const byCanonical: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    byCanonical[canonicalKey(k)] = v;
  }
  for (const alias of aliases) {
    const val = byCanonical[alias];
    if (val !== undefined && val !== null) return (val || "").trim();
  }
  return "";
}

export interface SacRow {
  numero_chamado: string;
  data_registro: Date | null;
  finalizado_fora_de_escopo: string;
  classificacao_do_servico: string;
  responsividade_execucao: string;
  procedente_por_status: string;
  regional: string;
  servico: string;
  endereco: string;
  data_execucao: Date | null;
  data_agendamento: Date | null;
  data_acionamento_agendamento: Date | null;
  data_realizacao_confirmacao_execucao: Date | null;
  data_ultima_atualizacao: Date | null;
  status_planilha: string;
  raw: Record<string, string>;
}

export function parseSacCsv(buffer: Buffer, sourceFile: string): SacRow[] {
  const records = parseDelimitedRecords(buffer);

  if (records.length === 0) return [];

  return records.map((row) => {
    const dataRegistroStr = getCanonical(row, ["data_registro"]);
    const dataExecucaoStr = getCanonical(row, ["data_execucao", "data_de_execucao"]);
    const dataAgendStr = getCanonical(row, ["data_agendamento", "data_de_agendamento"]);
    const dataAcionamentoStr = getCanonical(row, [
      "data_acionamento_agendamento",
      "data_de_acionamento_agendamento",
    ]);
    const dataRealizacaoStr = getCanonical(row, [
      "data_realizacao_confirmacao_execucao",
      "data_realizacao_da_confirmacao_de_execucao",
    ]);
    const dataUltimaStr = getCanonical(row, ["data_ultima_atualizacao", "data_da_ultima_atualizacao"]);
    const statusPl = getCanonical(row, ["status", "situacao", "status_do_chamado", "status_chamado"]);
    return {
      numero_chamado: getCanonical(row, ["numero_chamado"]),
      data_registro: parseFlipDate(dataRegistroStr),
      finalizado_fora_de_escopo: getCanonical(row, ["finalizado_como_fora_de_escopo"]).toUpperCase(),
      classificacao_do_servico: getCanonical(row, [
        "classificacao_do_servico",
        "classificacao_servico",
      ]),
      responsividade_execucao: getCanonical(row, ["responsividade_execucao"]).toUpperCase(),
      procedente_por_status: getCanonical(row, ["procedente_por_status"]).toUpperCase(),
      regional: getCanonical(row, ["regional"]),
      servico: getCanonical(row, ["servico"]),
      endereco: getCanonical(row, ["endereco"]),
      data_execucao: parseFlipDate(dataExecucaoStr),
      data_agendamento: parseFlipDate(dataAgendStr),
      data_acionamento_agendamento: parseFlipDate(dataAcionamentoStr),
      data_realizacao_confirmacao_execucao: parseFlipDate(dataRealizacaoStr),
      data_ultima_atualizacao: parseFlipDate(dataUltimaStr),
      status_planilha: statusPl.trim(),
      raw: { ...row },
    } as SacRow;
  });
}

export interface BfsRow {
  numero_bfs: string;
  data_fiscalizacao: Date | null;
  data_vistoria: Date | null;
  status: string;
  tipo_servico: string;
  regional: string;
  endereco: string;
  /** Coluna Fiscal do CSV (também persistida em bfs.fiscal para filtro IF). */
  fiscal: string;
  raw: Record<string, string>;
}

export function parseBfsCsv(buffer: Buffer, _sourceFile: string): BfsRow[] {
  const records = parseDelimitedRecords(buffer);

  return records.map((row) => {
    const dataFiscStr = getCanonical(row, ["data_fiscalizacao"]);
    const dataVistStr = getCanonical(row, ["data_vistoria"]);
    return {
      numero_bfs: getCanonical(row, ["numero_bfs", "n_bfs"]),
      data_fiscalizacao: parseFlipDate(dataFiscStr),
      data_vistoria: parseFlipDate(dataVistStr),
      status: getCanonical(row, ["status"]),
      tipo_servico: getCanonical(row, ["tipo_servico", "servico"]),
      regional: getCanonical(row, ["regionaal", "regional"]),
      endereco: getCanonical(row, ["endereco"]),
      fiscal: getCanonical(row, ["fiscal"]),
      raw: { ...row },
    } as BfsRow;
  });
}

/**
 * Retorna apenas linhas BFS que são Não Demandantes (entram no IF).
 */
export function filterBfsNaoDemandantes(rows: BfsRow[]): BfsRow[] {
  return rows.filter((r) => isBfsNaoDemandante(r.tipo_servico));
}

/**
 * Parser para FLIP_CONSULTA_CNC (CSV de CNCs com detalhes).
 */
export interface CncDetalhesRow {
  numero_bfs: string;
  numero_cnc: string;
  situacao_cnc: string;
  data_sincronizacao: Date | null;
  data_fiscalizacao: Date | null;
  data_execucao: Date | null;
  fiscal: string;
  regional: string;
  area: string;
  setor: string;
  turno: string;
  servico: string;
  responsividade: string;
  endereco: string;
  coordenada: string;
  fiscal_contratada: string;
  raw: Record<string, string>;
}

function parseDelimitedRecordsCnc(buffer: Buffer): Record<string, string>[] {
  const utf8 = buffer.toString("utf-8").replace(/^\uFEFF/, "");
  const latin1 = buffer.toString("latin1").replace(/^\uFEFF/, "");
  const firstLineUtf8 = utf8.split("\n")[0] ?? "";
  const utf8Headers = firstLineUtf8.split(SEP).map(canonicalKey);
  const text = utf8Headers.includes("n_bfs") || utf8Headers.includes("n_cnc") ? utf8 : latin1;
  return parse(text, {
    delimiter: SEP,
    columns: (headers: string[]) => headers.map((h: string) => normalizeHeader(h)),
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
}

export function parseCncDetalhesCsv(buffer: Buffer, _sourceFile: string): CncDetalhesRow[] {
  const records = parseDelimitedRecordsCnc(buffer);
  return records.map((row) => {
    const dataSyncStr = getCanonical(row, [
      "data_sincronizacao",
      "data_sincronizacao_cnc",
      "entrada_cnc",
      "registro_cnc",
    ]);
    const dataFiscStr = getCanonical(row, ["data_fiscalizacao"]);
    const dataExecStr = getCanonical(row, [
      "data_execucao",
      "data_execucao_cnc",
      "finalizacao_do_registro",
      "finalizacao_registro",
      "data_finalizacao",
      "data_finalizacao_registro",
      "data_finalizacao_cnc",
      "data_de_finalizacao",
      "finalizacao",
    ]);
    return {
      numero_bfs: getCanonical(row, ["n_bfs", "numero_bfs"]),
      numero_cnc: getCanonical(row, ["n_cnc", "numero_cnc"]),
      situacao_cnc: getCanonical(row, ["situacao_cnc"]),
      data_sincronizacao: parseFlipDate(dataSyncStr),
      data_fiscalizacao: parseFlipDate(dataFiscStr),
      data_execucao: parseFlipDate(dataExecStr),
      fiscal: getCanonical(row, ["fiscal"]),
      regional: getCanonical(row, ["regional"]),
      area: getCanonical(row, ["area"]),
      setor: getCanonical(row, ["setor"]),
      turno: getCanonical(row, ["turno"]),
      servico: getCanonical(row, ["servico"]),
      responsividade: getCanonical(row, ["responsividade"]),
      endereco: getCanonical(row, ["endereco"]),
      coordenada: getCanonical(row, ["coordenada"]),
      fiscal_contratada: getCanonical(row, ["fiscal_contratada"]),
      raw: { ...row },
    } as CncDetalhesRow;
  });
}

export function parseOuvidoriaCsv(buffer: Buffer): Record<string, string>[] {
  return parseDelimitedRecords(buffer);
}

export function parseAcicCsv(buffer: Buffer): Record<string, string>[] {
  return parseDelimitedRecords(buffer);
}
