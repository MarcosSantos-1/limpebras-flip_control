import { parse } from "csv-parse/sync";
import { parseFlipDate } from "../utils/date.js";
import { isBfsNaoDemandante } from "../constants/bfs.js";

const SEP = ";";
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
  raw: Record<string, string>;
}

export function parseSacCsv(buffer: Buffer, sourceFile: string): SacRow[] {
  const records = parseDelimitedRecords(buffer);

  if (records.length === 0) return [];

  return records.map((row) => {
    const dataRegistroStr = getCanonical(row, ["data_registro"]);
    const dataExecucaoStr = getCanonical(row, ["data_execucao"]);
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

export function parseOuvidoriaCsv(buffer: Buffer): Record<string, string>[] {
  return parseDelimitedRecords(buffer);
}

export function parseAcicCsv(buffer: Buffer): Record<string, string>[] {
  return parseDelimitedRecords(buffer);
}
