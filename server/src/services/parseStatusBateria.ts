import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

export interface StatusBateriaRow {
  recordKey: string;
  nome: string;
  tipoModulo: "LUTOCAR" | "PORTATIL";
  selimpId: string;
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

function extractTipoModulo(nome: string): "LUTOCAR" | "PORTATIL" {
  const upper = nome.toUpperCase();
  if (upper.includes("PORTATEI") || upper.includes("PORTATIL")) return "PORTATIL";
  return "LUTOCAR";
}

/**
 * Extrai o selimp_id do nome do módulo pegando os dois últimos segmentos separados por "-".
 * Exemplo: "SMSUB-LUTOCAR-03-0005" → "03-0005"
 */
function extractSelimpId(nome: string): string {
  const parts = nome.split("-").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join("-");
  return parts[parts.length - 1] ?? "";
}

function buildRecordKey(dataExportacao: string, nome: string): string {
  return `hash_${createHash("sha1").update(`${dataExportacao}|${nome}`).digest("hex")}`;
}

const HEADER_ALIASES: Record<string, string[]> = {
  nome: ["nome", "placa", "modulo"],
  status_comunicacao: ["comunicacao", "status comunicacao", "status_comunicacao", "status de comunicacao"],
  // Apenas "bateria" como alias exato — evita bater em "Status de Bateria" (coluna G)
  bateria: ["bateria", "percentual_bateria", "percentual bateria"],
  ultima_comunicacao: ["ultima comunicacao", "ultima_comunicacao", "data de ultima comunicacao", "data_de_ultima_comunicacao"],
};

function findHeaderIndex(rawRows: unknown[][]): number {
  const signals = ["nome", "bateria", "comunicacao"].map(canonicalHeader);

  let bestRow = -1;
  let bestScore = -1;

  for (let i = 0; i < Math.min(rawRows.length, 25); i++) {
    const row = rawRows[i] ?? [];
    const canonical = row.map((cell) => canonicalHeader(normalizeCell(cell)));
    let score = 0;
    for (const signal of signals) {
      if (canonical.some((c) => c === signal)) score++;
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

/**
 * Resolve o índice de coluna por aliases.
 * Tenta match EXATO primeiro; só usa match parcial se nenhum alias exato foi encontrado.
 * Isso evita que "Status de Bateria" seja confundida com "Bateria".
 */
function resolveColumnIndex(headers: string[], aliases: string[]): number {
  // 1ª passagem: match exato
  for (const alias of aliases) {
    const canonical = canonicalHeader(alias);
    const idx = headers.findIndex((h) => h === canonical);
    if (idx >= 0) return idx;
  }
  // 2ª passagem: match parcial (fallback)
  for (const alias of aliases) {
    const canonical = canonicalHeader(alias);
    const needle = canonical.replace(/_/g, "");
    const idx = headers.findIndex((h) => h.replace(/_/g, "").includes(needle));
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
  const colStatusComunicacao = resolveColumnIndex(headerCells, HEADER_ALIASES.status_comunicacao);
  const colBateria = resolveColumnIndex(headerCells, HEADER_ALIASES.bateria);
  const colUltimaComunicacao = resolveColumnIndex(headerCells, HEADER_ALIASES.ultima_comunicacao);

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

    const statusComunicacao = getCell(row, colStatusComunicacao, 3);
    const bateriaRaw = normalizeBateriaRaw(colBateria >= 0 ? row[colBateria] : row[4]); // coluna E (0-indexed = 4)
    const ultimaComunicacao = parseDateValue(getRaw(row, colUltimaComunicacao, 5));

    const { percentual: bateriaPercentual, desatualizada: bateriaDesatualizada } = parseBateria(bateriaRaw);

    const tipoModulo = extractTipoModulo(nome);
    out.push({
      recordKey,
      nome,
      tipoModulo,
      selimpId: tipoModulo === "PORTATIL" ? "" : extractSelimpId(nome),
      statusComunicacao,
      bateriaRaw,
      bateriaPercentual,
      bateriaDesatualizada,
      ultimaComunicacao,
    });
  }

  return out;
}
