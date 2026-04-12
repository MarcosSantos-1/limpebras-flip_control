import * as XLSX from "xlsx";
import { formatDataInstalacaoBr } from "./formatDataInstalacaoBr.js";

export interface ModuloBateriaRow {
  subprefeitura: string;
  setor: string;
  numero_selimp: string;
  dias_execucao: string;
  comunicacao: "ON" | "OFF";
  bateria: string;
  bateria_percentual: number;
  ultima_comunicacao: Date | null;
  status_sinal_geral: string;
  status_bateria: string;
  data_instalacao: string;
  quantidade_trocas: number;
  dias_on: number;
  dias_off: number;
  produtividade: number;
}

function canonicalHeader(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function cell(value: unknown): string {
  return String(value ?? "").trim();
}

function extractPercent(value: string): number {
  const match = value.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (!match) return 0;
  return Math.round(Number(match[1].replace(",", ".")));
}

function parseBrDate(value: string): Date | null {
  if (!value) return null;
  const trimmed = value.trim();

  const brMatch = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (brMatch) {
    const day = Number(brMatch[1]);
    const month = Number(brMatch[2]);
    const year = Number(brMatch[3].length === 2 ? `20${brMatch[3]}` : brMatch[3]);
    const hour = Number(brMatch[4] ?? 0);
    const minute = Number(brMatch[5] ?? 0);
    const second = Number(brMatch[6] ?? 0);
    const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const direct = new Date(trimmed);
  return Number.isNaN(direct.getTime()) ? null : direct;
}

const HEADER_MAP: Record<string, string> = {
  subprefeitura: "subprefeitura",
  setor: "setor",
  numero_selimp: "numero_selimp",
  dias_de_execucao: "dias_execucao",
  comunicacao: "comunicacao",
  bateria: "bateria",
  ultima_comunicacao: "ultima_comunicacao",
  status_sinal_geral: "status_sinal_geral",
  status_bateria: "status_bateria",
  data_instalacao: "data_instalacao",
  quantidade_trocas: "quantidade_trocas",
  dias_on: "dias_on",
  dias_off: "dias_off",
  produtividade: "produtividade",
};

const SIGNAL_ALIASES = [
  "subprefeitura",
  "setor",
  "numero_selimp",
  "comunicacao",
  "bateria",
  "status_bateria",
  "produtividade",
];

function detectHeaderRow(rawRows: unknown[][]): number {
  const aliases = SIGNAL_ALIASES.map(canonicalHeader);
  let bestRow = -1;
  let bestScore = -1;

  for (let i = 0; i < Math.min(rawRows.length, 25); i++) {
    const row = rawRows[i] ?? [];
    const canonical = row.map((c) => canonicalHeader(cell(c)));
    let score = 0;
    for (const alias of aliases) {
      if (canonical.includes(alias)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }

  if (bestRow < 0 || bestScore <= 0) {
    throw new Error("Nao foi possivel identificar o cabecalho da planilha de modulos/bateria.");
  }
  return bestRow;
}

/** Format a JS Date to dd/MM/yyyy without timezone ambiguity. */
function dateTobrStr(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** Fallback for spreadsheets that export installation dates as US text (MM/DD/YYYY). */
function usSlashDateToBrStr(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";

  const usMatch = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!usMatch) return formatDataInstalacaoBr(trimmed);

  const month = Number(usMatch[1]);
  const day = Number(usMatch[2]);
  let year = usMatch[3];
  if (year.length === 2) year = `20${year}`;

  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

/** Resolve a date cell: prefer a native Date object (from cellDates read), fall back to string parsing. */
function resolveDateCell(nativeValue: unknown, fallbackStr: string): Date | null {
  if (nativeValue instanceof Date && !Number.isNaN(nativeValue.getTime())) {
    return nativeValue;
  }
  return parseBrDate(fallbackStr);
}

/** Format an installation date cell to dd/MM/yyyy. Prefers the native Date object from the
 *  cellDates-enabled read to avoid MM/DD vs DD/MM ambiguity in XLSX string output. */
function resolveInstalacaoStr(nativeValue: unknown, fallbackStr: string): string {
  if (nativeValue instanceof Date && !Number.isNaN(nativeValue.getTime())) {
    return dateTobrStr(nativeValue);
  }
  return usSlashDateToBrStr(fallbackStr);
}

export function parseModulosBateriaWorkbook(buffer: Buffer): ModuloBateriaRow[] {
  // Primary read: raw: false gives nicely formatted strings for text/percent fields
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });

  if (!rawRows.length) return [];

  // Secondary read: cellDates: true + raw: true gives JS Date objects for date cells,
  // avoiding the MM/DD vs DD/MM ambiguity that XLSX string formatting introduces.
  const workbookDates = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetDates = workbookDates.Sheets[sheetName] ?? {};
  const rawRowsDates = XLSX.utils.sheet_to_json<unknown[]>(sheetDates, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });

  const headerIdx = detectHeaderRow(rawRows);
  const headerCells = (rawRows[headerIdx] ?? []).map((c) => canonicalHeader(cell(c)));

  const colMap: Record<string, number> = {};
  for (let c = 0; c < headerCells.length; c++) {
    const canonical = headerCells[c];
    if (canonical && HEADER_MAP[canonical]) {
      colMap[HEADER_MAP[canonical]] = c;
    }
  }

  const rows: ModuloBateriaRow[] = [];

  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const values = rawRows[i] ?? [];
    const dateValues = rawRowsDates[i] ?? [];
    const get = (field: string) => cell(values[colMap[field] ?? -1]);
    const getNative = (field: string): unknown => dateValues[colMap[field] ?? -1];

    const setor = get("setor");
    if (!setor) continue;

    const bateriaRaw = get("bateria");
    const comunicacaoRaw = get("comunicacao").toUpperCase();
    const prodRaw = get("produtividade");

    rows.push({
      subprefeitura: get("subprefeitura"),
      setor,
      numero_selimp: get("numero_selimp"),
      dias_execucao: get("dias_execucao"),
      comunicacao: comunicacaoRaw === "ON" ? "ON" : "OFF",
      bateria: bateriaRaw,
      bateria_percentual: extractPercent(bateriaRaw),
      ultima_comunicacao: resolveDateCell(getNative("ultima_comunicacao"), get("ultima_comunicacao")),
      status_sinal_geral: get("status_sinal_geral"),
      status_bateria: get("status_bateria"),
      data_instalacao: resolveInstalacaoStr(getNative("data_instalacao"), get("data_instalacao")),
      quantidade_trocas: parseInt(get("quantidade_trocas"), 10) || 0,
      dias_on: parseInt(get("dias_on"), 10) || 0,
      dias_off: parseInt(get("dias_off"), 10) || 0,
      produtividade: extractPercent(prodRaw),
    });
  }

  return rows;
}
