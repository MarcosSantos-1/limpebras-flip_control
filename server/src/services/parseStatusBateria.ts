import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

export interface StatusBateriaRow {
  recordKey: string;
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
  statusBateria: string;
  dias: string;
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

function normalizeCell(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "").trim();
}

function isEmptyRow(row: unknown[]): boolean {
  return row.every((cell) => {
    if (cell instanceof Date) return false;
    return String(cell ?? "").trim() === "";
  });
}

function parseDateValue(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

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

    if (second > 12) {
      const parsed = new Date(Date.UTC(year, first - 1, second, hour, minute, sec));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    if (second < 1 || second > 12) return null;
    const parsed = new Date(Date.UTC(year, second - 1, first, hour, minute, sec));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function parseBateria(raw: string): { percentual: number | null; desatualizada: boolean } {
  if (!raw) return { percentual: null, desatualizada: false };
  const desatualizada = raw.toLowerCase().includes("bateria desatualizada");
  const percentMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (percentMatch) {
    return { percentual: parseFloat(percentMatch[1].replace(",", ".")), desatualizada };
  }
  const num = parseFloat(raw.replace(",", "."));
  if (!Number.isNaN(num) && num >= 0 && num <= 1) {
    return { percentual: Math.round(num * 10000) / 100, desatualizada };
  }
  if (!Number.isNaN(num) && num >= 0 && num <= 100) {
    return { percentual: num, desatualizada };
  }
  return { percentual: null, desatualizada };
}

function extractTipoModulo(nome: string): "LUTOCAR" | "PORTATIL" {
  const upper = nome.toUpperCase();
  if (upper.includes("PORTATEI") || upper.includes("PORTATIL")) return "PORTATIL";
  return "LUTOCAR";
}

function extractSelimpId(nome: string, selimpRaw: string): string {
  if (selimpRaw) return selimpRaw;
  const parts = nome.split("-");
  return parts[parts.length - 1]?.trim() ?? "";
}

function buildRecordKey(dataExportacao: string, nome: string): string {
  return `hash_${createHash("sha1").update(`${dataExportacao}|${nome}`).digest("hex")}`;
}

const HEADER_ALIASES: Record<string, string[]> = {
  nome: ["nome", "placa", "modulo"],
  subprefeitura: ["subprefeitura", "sub_prefeitura", "regional"],
  setor: ["setor"],
  selimp: ["selimp", "numero_selimp", "numero selimp"],
  dias_execucao: ["dias de execucao", "dias_de_execucao", "dias execucao"],
  status_comunicacao: ["comunicacao", "status comunicacao", "status_comunicacao", "status de comunicacao"],
  bateria: ["bateria", "percentual_bateria", "percentual bateria"],
  ultima_comunicacao: ["ultima comunicacao", "ultima_comunicacao", "data de ultima comunicacao", "data_de_ultima_comunicacao"],
  status_bateria: ["status de bateria", "status_de_bateria", "status bateria"],
  dias: ["dias"],
};

function findHeaderIndex(rawRows: unknown[][]): number {
  const signals = ["nome", "status_bateria", "bateria", "comunicacao"].map(canonicalHeader);

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
    throw new Error("Não foi possível identificar o cabeçalho da planilha Status de Bateria.");
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

export function parseStatusBateria(buffer: Buffer, dataExportacao: string): StatusBateriaRow[] {
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

  const colNome = resolveColumnIndex(headerCells, HEADER_ALIASES.nome);
  const colSubprefeitura = resolveColumnIndex(headerCells, HEADER_ALIASES.subprefeitura);
  const colSetor = resolveColumnIndex(headerCells, HEADER_ALIASES.setor);
  const colSelimp = resolveColumnIndex(headerCells, HEADER_ALIASES.selimp);
  const colDiasExecucao = resolveColumnIndex(headerCells, HEADER_ALIASES.dias_execucao);
  const colStatusComunicacao = resolveColumnIndex(headerCells, HEADER_ALIASES.status_comunicacao);
  const colBateria = resolveColumnIndex(headerCells, HEADER_ALIASES.bateria);
  const colUltimaComunicacao = resolveColumnIndex(headerCells, HEADER_ALIASES.ultima_comunicacao);
  const colStatusBateria = resolveColumnIndex(headerCells, HEADER_ALIASES.status_bateria);
  const colDias = resolveColumnIndex(headerCells, HEADER_ALIASES.dias);

  const getCell = (row: unknown[], colIdx: number, fallback: number): string => {
    const idx = colIdx >= 0 ? colIdx : fallback;
    return normalizeCell(row[idx]);
  };

  const getRaw = (row: unknown[], colIdx: number, fallback: number): unknown => {
    const idx = colIdx >= 0 ? colIdx : fallback;
    return row[idx];
  };

  const out: StatusBateriaRow[] = [];
  const seen = new Set<string>();

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i] ?? [];
    if (isEmptyRow(row)) continue;

    const nome = getCell(row, colNome, 0);
    if (!nome) continue;

    const recordKey = buildRecordKey(dataExportacao, nome);
    if (seen.has(recordKey)) continue;
    seen.add(recordKey);

    const subprefeitura = getCell(row, colSubprefeitura, 1);
    const setor = getCell(row, colSetor, 2);
    const selimpRaw = getCell(row, colSelimp, 3);
    const selimpId = extractSelimpId(nome, selimpRaw);
    const diasExecucao = getCell(row, colDiasExecucao, 4);
    const statusComunicacao = getCell(row, colStatusComunicacao, 5);
    const bateriaRaw = getCell(row, colBateria, 6);
    const ultimaComunicacao = parseDateValue(getRaw(row, colUltimaComunicacao, 7));
    const statusBateria = getCell(row, colStatusBateria, 8);
    const dias = getCell(row, colDias, 9);

    const { percentual: bateriaPercentual, desatualizada: bateriaDesatualizada } = parseBateria(bateriaRaw);

    out.push({
      recordKey,
      nome,
      tipoModulo: extractTipoModulo(nome),
      subprefeitura,
      setor,
      selimpId,
      diasExecucao,
      statusComunicacao,
      bateriaRaw,
      bateriaPercentual,
      bateriaDesatualizada,
      ultimaComunicacao,
      statusBateria,
      dias,
    });
  }

  return out;
}
