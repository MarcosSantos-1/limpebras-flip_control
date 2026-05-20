import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

export interface HistoricoBateriaRow {
  recordKey: string;
  dataExportacao: Date;
  nome: string;
  tipoModulo: "LUTOCAR" | "PORTATIL";
  subprefeitura: string;
  setor: string;
  selimpId: string;
  diasExecucao: string;
  statusComunicacao: string;
  bateriaRaw: string;
  bateriaPercentual: number | null;
  bateriaDesatualizada: boolean;
  ultimaComunicacao: Date | null;
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

/**
 * Normalizes a cell value to string.
 * When XLSX reads with cellDates:true + raw:true, date cells come as JS Date objects —
 * we convert them to ISO string so the rest of the pipeline handles them uniformly.
 */
function normalizeCell(value: unknown): string {
  if (value instanceof Date) {
    // Serialize as ISO so parseDateValue can pick it up as a Date object directly
    return value.toISOString();
  }
  return String(value ?? "").trim();
}

function isEmptyRow(row: unknown[]): boolean {
  return row.every((cell) => {
    if (cell instanceof Date) return false;
    return String(cell ?? "").trim() === "";
  });
}

/**
 * Parses a date from a cell value. Accepts:
 *  - JS Date objects (from cellDates:true + raw:true)
 *  - ISO strings (yyyy-mm-ddThh:mm:ssZ)
 *  - BR format strings (dd/mm/yyyy or dd/mm/yy, with optional time)
 *  - Validates month ≤ 12 to avoid US-format misreads (MM/DD/YYYY → month overflow)
 */
function parseDateValue(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  // ISO string from serialized Date (our own normalizeCell output)
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // dd/mm/yyyy or dd/mm/yy (with optional time) — BR format
  const brMatch = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (brMatch) {
    const first = Number(brMatch[1]);
    const second = Number(brMatch[2]);
    const year = Number(brMatch[3].length === 2 ? `20${brMatch[3]}` : brMatch[3]);
    const hour = Number(brMatch[4] ?? 0);
    const minute = Number(brMatch[5] ?? 0);
    const sec = Number(brMatch[6] ?? 0);

    // Validate: if second > 12 it can only be the day (BR format confirmed)
    // If first > 12 it can only be the day (US-style month would be invalid)
    // If both ≤ 12, assume BR (day/month)
    if (second > 12) {
      // Looks like US format MM/DD: swap to get day=second, month=first
      const parsed = new Date(Date.UTC(year, first - 1, second, hour, minute, sec));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    // Standard BR: day=first, month=second
    if (second < 1 || second > 12) return null;
    const parsed = new Date(Date.UTC(year, second - 1, first, hour, minute, sec));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // ISO date-only yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(raw + "T00:00:00Z");
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

/**
 * Normaliza o valor bruto da célula bateria antes de armazenar em bateria_raw.
 * Excel armazena porcentagens como decimal (0.64), não como "64%".
 * Se o valor for número ou string decimal no range 0–1, converte para "XX%".
 */
function normalizeBateriaRaw(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) {
    return `${Math.round(value * 100)}%`;
  }
  const s = String(value ?? "").trim();
  const num = parseFloat(s);
  if (!Number.isNaN(num) && num >= 0 && num < 1 && !s.includes("%")) {
    return `${Math.round(num * 100)}%`;
  }
  return s;
}

function parseBateria(raw: string): { percentual: number | null; desatualizada: boolean } {
  if (!raw) return { percentual: null, desatualizada: false };
  const desatualizada = raw.toLowerCase().includes("desatualizada");
  const percentMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (percentMatch) {
    return { percentual: parseFloat(percentMatch[1].replace(",", ".")), desatualizada };
  }
  const num = parseFloat(raw.replace(",", "."));
  if (!Number.isNaN(num) && num >= 0 && num <= 100) {
    return { percentual: num, desatualizada };
  }
  return { percentual: null, desatualizada };
}

/** Extracts tipo_modulo from nome field (LUTOCAR or PORTATIL). */
function extractTipoModulo(nome: string): "LUTOCAR" | "PORTATIL" {
  const upper = nome.toUpperCase();
  if (upper.includes("PORTATEI") || upper.includes("PORTATIL")) return "PORTATIL";
  return "LUTOCAR";
}

/** Extrai selimp_id dos dois últimos segmentos do nome: "SMSUB-LUTOCAR-03-0005" → "03-0005". */
function extractSelimpId(nome: string): string {
  const parts = nome.split("-").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join("-");
  return parts[parts.length - 1] ?? "";
}

const HEADER_ALIASES: Record<string, string[]> = {
  data_exportacao: ["data exportacao", "data_exportacao", "data de exportacao"],
  nome: ["nome"],
  subprefeitura: ["subprefeitura"],
  setor: ["setor"],
  selimp: ["selimp"],
  dias_execucao: ["dias de execucao", "dias_de_execucao", "dias execucao"],
  status_comunicacao: ["status comunicacao", "status_comunicacao", "status de comunicacao"],
  bateria: ["bateria"],
  ultima_comunicacao: ["ultima comunicacao", "ultima_comunicacao", "ultima comunicacao"],
};

function findHeaderIndex(rawRows: unknown[][]): number {
  const signals = ["nome", "subprefeitura", "bateria", "status_comunicacao"].map(canonicalHeader);

  let bestRow = -1;
  let bestScore = -1;

  for (let i = 0; i < Math.min(rawRows.length, 25); i++) {
    const row = rawRows[i] ?? [];
    const canonical = row.map((cell) => canonicalHeader(normalizeCell(cell)));
    let score = 0;
    for (const signal of signals) {
      if (canonical.some((c) => c.includes(signal.replace(/_/g, "")) || c === signal)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }

  if (bestRow < 0 || bestScore <= 0) {
    throw new Error("Não foi possível identificar o cabeçalho da planilha de Histórico de Bateria.");
  }
  return bestRow;
}

function resolveColumnIndex(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const canonical = canonicalHeader(alias);
    const idx = headers.findIndex((h) => h === canonical || h.includes(canonical.replace(/_/g, "")));
    if (idx >= 0) return idx;
  }
  return -1;
}

export function parseHistoricoBateria(buffer: Buffer, sourceFile = ""): HistoricoBateriaRow[] {
  // cellDates:true + raw:true → date cells come as JS Date objects, avoiding
  // the MM/DD vs DD/MM ambiguity caused by Excel's locale-dependent format strings.
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });

  if (!rawRows.length) return [];

  const headerRowIdx = findHeaderIndex(rawRows);
  const headerCells = (rawRows[headerRowIdx] ?? []).map((cell) => canonicalHeader(normalizeCell(cell)));

  // Resolve column positions by alias
  const colDataExportacao = resolveColumnIndex(headerCells, HEADER_ALIASES.data_exportacao);
  const colNome = resolveColumnIndex(headerCells, HEADER_ALIASES.nome);
  const colSubprefeitura = resolveColumnIndex(headerCells, HEADER_ALIASES.subprefeitura);
  const colSetor = resolveColumnIndex(headerCells, HEADER_ALIASES.setor);
  const colSelimp = resolveColumnIndex(headerCells, HEADER_ALIASES.selimp);
  const colDiasExecucao = resolveColumnIndex(headerCells, HEADER_ALIASES.dias_execucao);
  const colStatusComunicacao = resolveColumnIndex(headerCells, HEADER_ALIASES.status_comunicacao);
  const colBateria = resolveColumnIndex(headerCells, HEADER_ALIASES.bateria);
  const colUltimaComunicacao = resolveColumnIndex(headerCells, HEADER_ALIASES.ultima_comunicacao);

  // Fallback to positional columns (A=0, B=1, ..., I=8) when aliases don't match
  const getCell = (row: unknown[], colIdx: number, fallback: number): string => {
    const idx = colIdx >= 0 ? colIdx : fallback;
    return normalizeCell(row[idx]);
  };

  const out: HistoricoBateriaRow[] = [];
  const seen = new Set<string>();

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i] ?? [];
    if (isEmptyRow(row)) continue;

    const dataRawValue = (colDataExportacao >= 0 ? row[colDataExportacao] : row[0]);
    const dataExportacao = parseDateValue(dataRawValue);
    if (!dataExportacao) continue;

    const nome = getCell(row, colNome, 1);
    if (!nome) continue;

    const dataStr = dataExportacao.toISOString().slice(0, 10);
    const recordKey = `hash_${createHash("sha1").update(`${dataStr}|${nome}`).digest("hex")}`;

    if (seen.has(recordKey)) continue;
    seen.add(recordKey);

    const subprefeitura = getCell(row, colSubprefeitura, 2);
    const setor = getCell(row, colSetor, 3);
    const selimpRaw = getCell(row, colSelimp, 4);
    const diasExecucao = getCell(row, colDiasExecucao, 5);
    const statusComunicacao = getCell(row, colStatusComunicacao, 6);
    const bateriaRaw = normalizeBateriaRaw(colBateria >= 0 ? row[colBateria] : row[7]);
    const ultimaComunicacaoRawValue = (colUltimaComunicacao >= 0 ? row[colUltimaComunicacao] : row[8]);

    const { percentual: bateriaPercentual, desatualizada: bateriaDesatualizada } = parseBateria(bateriaRaw);
    const ultimaComunicacao = parseDateValue(ultimaComunicacaoRawValue);
    const tipoModulo = extractTipoModulo(nome);
    const selimpId =
      tipoModulo === "PORTATIL" ? "" : selimpRaw || extractSelimpId(nome);

    out.push({
      recordKey,
      dataExportacao,
      nome,
      tipoModulo,
      subprefeitura,
      setor,
      selimpId,
      diasExecucao,
      statusComunicacao,
      bateriaRaw,
      bateriaPercentual,
      bateriaDesatualizada,
      ultimaComunicacao,
    });
  }

  return out;
}
