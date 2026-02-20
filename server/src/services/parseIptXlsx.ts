import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

export type IptFileType =
  | "ipt_historico_os"
  | "ipt_historico_os_varricao"
  | "ipt_report_selimp"
  | "ipt_status_bateria";

export interface IptParsedRow {
  recordKey: string;
  setor: string;
  dataReferencia: Date | null;
  servico: string;
  raw: Record<string, string>;
}

interface ParseConfig {
  keyAliases: string[];
  setorAliases: string[];
  dateAliases: string[];
  servicoAliases: string[];
  signalAliases: string[];
}

const FILE_CONFIG: Record<IptFileType, ParseConfig> = {
  ipt_historico_os: {
    keyAliases: ["id", "rota", "veiculo"],
    setorAliases: ["setor"],
    dateAliases: ["data_planejado", "data_criacao", "data_liberacao", "data_inicio", "data_final"],
    servicoAliases: ["tipo_de_servico", "tipo_servico"],
    signalAliases: ["rota", "setor", "percentual_execucao", "data_planejado", "id"],
  },
  ipt_historico_os_varricao: {
    keyAliases: ["id", "rota", "veiculo"],
    setorAliases: ["setor"],
    dateAliases: ["data_planejado", "data_criacao", "data_liberacao", "data_inicio", "data_final"],
    servicoAliases: ["tipo_de_servico", "tipo_servico"],
    signalAliases: ["rota", "setor", "percentual_execucao", "data_planejado", "id"],
  },
  ipt_report_selimp: {
    keyAliases: ["plano"],
    setorAliases: ["subprefeitura", "sub_prefeitura"],
    dateAliases: ["data", "data_planejado", "data_execucao"],
    servicoAliases: ["tipo_de_servico", "tipo_servico"],
    signalAliases: ["status", "plano", "subprefeitura", "tipo_de_servico", "de_execucao"],
  },
  ipt_status_bateria: {
    keyAliases: ["placa", "nome"],
    setorAliases: ["setor", "subprefeitura", "regional"],
    dateAliases: ["data_de_ultima_comunicacao"],
    servicoAliases: ["status_de_bateria"],
    signalAliases: ["nome", "placa", "status_de_bateria", "dias", "data_de_ultima_comunicacao"],
  },
};

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
  return String(value ?? "").trim();
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;

  const match = value.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function firstByAliases(row: Record<string, string>, aliases: string[]): string {
  for (const alias of aliases) {
    const key = canonicalHeader(alias);
    const value = row[key];
    if (value && value.trim()) return value.trim();
  }
  return "";
}

function isEmptyRow(row: unknown[]): boolean {
  return row.every((cell) => normalizeCell(cell) === "");
}

function detectHeaderRow(rawRows: unknown[][], config: ParseConfig): number {
  const aliases = config.signalAliases.map(canonicalHeader);
  let bestRow = -1;
  let bestScore = -1;

  for (let i = 0; i < Math.min(rawRows.length, 25); i += 1) {
    const row = rawRows[i] ?? [];
    const canonical = row.map((cell) => canonicalHeader(normalizeCell(cell)));
    if (canonical.every((cell) => !cell)) continue;
    let score = 0;
    for (const alias of aliases) {
      if (canonical.includes(alias)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }

  if (bestRow < 0 || bestScore <= 0) {
    throw new Error("Não foi possível identificar o cabeçalho da planilha IPT.");
  }
  return bestRow;
}

function buildRecordKey(fileType: IptFileType, row: Record<string, string>, aliases: string[]): string {
  if (fileType === "ipt_report_selimp") {
    const composed = [
      row[canonicalHeader("plano")] ?? "",
      row[canonicalHeader("subprefeitura")] ?? row[canonicalHeader("sub_prefeitura")] ?? "",
      row[canonicalHeader("tipo_de_servico")] ?? row[canonicalHeader("tipo_servico")] ?? "",
      row[canonicalHeader("data")] ?? row[canonicalHeader("data_planejado")] ?? row[canonicalHeader("data_execucao")] ?? "",
      row[canonicalHeader("de_execucao")] ?? row[canonicalHeader("percentual_execucao")] ?? "",
      row[canonicalHeader("status")] ?? "",
      row[canonicalHeader("equipamentos")] ?? "",
    ].join("|");
    return `hash_${createHash("sha1").update(fileType).update(composed).digest("hex")}`;
  }

  const rawKey = firstByAliases(row, aliases);
  if (rawKey) return rawKey;

  const hash = createHash("sha1")
    .update(fileType)
    .update(JSON.stringify(row))
    .digest("hex");
  return `hash_${hash}`;
}

export function parseIptWorkbook(buffer: Buffer, fileType: IptFileType): IptParsedRow[] {
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

  const config = FILE_CONFIG[fileType];
  const headerRowIndex = detectHeaderRow(rawRows, config);
  const headerCells = (rawRows[headerRowIndex] ?? []).map((cell) => canonicalHeader(normalizeCell(cell)));

  const out: IptParsedRow[] = [];
  for (let i = headerRowIndex + 1; i < rawRows.length; i += 1) {
    const values = rawRows[i] ?? [];
    if (isEmptyRow(values)) continue;

    const raw: Record<string, string> = {};
    for (let c = 0; c < headerCells.length; c += 1) {
      const key = headerCells[c] || `coluna_${c + 1}`;
      raw[key] = normalizeCell(values[c]);
    }

    const recordKey = buildRecordKey(fileType, raw, config.keyAliases);
    const setor = firstByAliases(raw, config.setorAliases);
    const dataReferencia = parseDate(firstByAliases(raw, config.dateAliases));
    const servico = firstByAliases(raw, config.servicoAliases);
    out.push({
      recordKey,
      setor,
      dataReferencia,
      servico,
      raw,
    });
  }

  return out;
}
