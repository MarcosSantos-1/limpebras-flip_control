import * as XLSX from "xlsx";
import { normalizarSetor, parseSetor } from "../constants/ipt.js";

export interface SetorModuloRow {
  setor: string;
  subprefeitura: string | null;
  servico: string | null;
  frequencia: string | null;
  diasExecucao: string | null;
  kmProd: number | null;
  selimpCodigo: string | null;
  selimpInstalacao: Date | null;
  ddmxCodigo: string | null;
  ddmxInstalacao: Date | null;
  raw: Record<string, unknown>;
}

export interface ParseSetoresModulosResult {
  rows: SetorModuloRow[];
  totalPlanilha: number;
  ignoradas: number;
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

function excelSerialToUtcDate(serial: number): Date {
  const days = Math.floor(serial);
  const utcMs = (days - 25569) * 86400 * 1000;
  return new Date(utcMs);
}

function parseDateValue(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 1000) {
    return excelSerialToUtcDate(value);
  }
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const brMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (brMatch) {
    let day = Number(brMatch[1]);
    let month = Number(brMatch[2]);
    const year = Number(brMatch[3].length === 2 ? `20${brMatch[3]}` : brMatch[3]);
    // Excel às vezes exporta MM/DD/AA (ex.: 12/26/25 = 26 de dezembro).
    if (month > 12 && day >= 1 && day <= 12) {
      [day, month] = [month, day];
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const parsed = new Date(Date.UTC(year, month - 1, day));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function toDateOnly(d: Date | null): Date | null {
  if (!d) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function parseCodigo(value: unknown): string | null {
  const s = normalizeCell(value);
  return s || null;
}

function parseKmProd(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function rowToRecord(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith("__")) continue;
    out[k] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
  }
  return out;
}

/**
 * Parse planilha SETORES.xlsx (aba SETORES ou primeira aba).
 * Colunas: SETOR, SUBPREFEITURA, SERVIÇO, FREQUÊNCIA, DIAS DE EXECUÇÃO, KM_PROD,
 * SELIMP, INSTALAÇÃO SELIMP, DDMX, INSTALAÇÃO DDMX.
 */
export function parseSetoresModulosWorkbook(buffer: Buffer): ParseSetoresModulosResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames.includes("SETORES")
    ? "SETORES"
    : workbook.SheetNames[0];
  if (!sheetName) {
    return { rows: [], totalPlanilha: 0, ignoradas: 0 };
  }

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
  });

  const rows: SetorModuloRow[] = [];
  let ignoradas = 0;

  for (const rawRow of rawRows) {
    const keyed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawRow)) {
      keyed[canonicalHeader(k)] = v;
    }

    const setorRaw = normalizeCell(keyed.setor);
    if (!setorRaw) {
      ignoradas += 1;
      continue;
    }

    const setor = normalizarSetor(setorRaw);
    if (!setor || !parseSetor(setor)) {
      ignoradas += 1;
      continue;
    }

    const subprefeitura = parseCodigo(keyed.subprefeitura);
    const servico = parseCodigo(keyed.servico);
    const frequencia = parseCodigo(keyed.frequencia);
    const diasExecucao = parseCodigo(keyed.dias_de_execucao);

    rows.push({
      setor,
      subprefeitura,
      servico,
      frequencia,
      diasExecucao,
      kmProd: parseKmProd(keyed.km_prod),
      selimpCodigo: parseCodigo(keyed.selimp),
      selimpInstalacao: toDateOnly(parseDateValue(keyed.instalacao_selimp)),
      ddmxCodigo: parseCodigo(keyed.ddmx),
      ddmxInstalacao: toDateOnly(parseDateValue(keyed.instalacao_ddmx)),
      raw: rowToRecord(rawRow),
    });
  }

  return {
    rows,
    totalPlanilha: rawRows.length,
    ignoradas,
  };
}
