import * as XLSX from "xlsx";
import { normalizarSetor } from "../constants/ipt.js";

export type ConsolidadoVeiculoRow = {
  recordKey: string;
  setor: string;
  dataReferencia: Date;
  servico: string;
  raw: Record<string, unknown>;
};

/** Estatísticas da leitura da aba (útil quando linhas importadas < linhas da planilha). */
export type ParseVeiculosStats = {
  /** Linhas de dados abaixo do cabeçalho (não inclui linha 0). */
  linhas_na_planilha: number;
  linhas_importadas: number;
  ignoradas_linha_vazia: number;
  ignoradas_sem_setor: number;
  ignoradas_sem_data: number;
};

export type ParseVeiculosResult = {
  rows: ConsolidadoVeiculoRow[];
  stats: ParseVeiculosStats;
};

function cellAt(row: unknown[], i: number): unknown {
  return row[i] ?? "";
}

/** Data na coluna "Data": serial Excel, texto dd/mm/aaaa, ou ISO. */
function parseDataVeiculoCell(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return excelSerialToUtcDate(value);
  }
  const s = String(value).trim();
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (br) {
    const y = br[3].length === 2 ? `20${br[3]}` : br[3];
    const d = new Date(`${y}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}T12:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(`${s.slice(0, 10)}T12:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return new Date(parsed);
  return null;
}

export type ConsolidadoVarricaoRow = {
  recordKey: string;
  setor: string;
  dataReferencia: Date;
  servico: string;
  raw: Record<string, unknown>;
};

/** Excel serial (dias desde 1899-12-30 UTC) → Date local (só parte inteira). */
function excelSerialToUtcDate(serial: number): Date {
  const days = Math.floor(serial);
  const utcMs = (days - 25569) * 86400 * 1000;
  return new Date(utcMs);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function dateToDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Normaliza percentual vindo da planilha para escala 0–100 (exibição / médias). */
export function normalizePercentDisplay(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", ".").replace("%", "").trim());
  if (!Number.isFinite(n)) return null;
  if (n >= 0 && n <= 1) return Number((n * 100).toFixed(2));
  return Number(Math.min(100, Math.max(0, n)).toFixed(2));
}

/** Converte percentual 0–100 para decimal 0–1 (algoritmo PF). */
export function percentDisplayToDecimal(pct: number): number {
  return Math.min(1, Math.max(0, pct / 100));
}

function parseHeaderDateBr(cell: unknown): string | null {
  const s = String(cell ?? "").split(/\r?\n/)[0].trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** Célula matriz: "94.41% - 10.70v" → SELIMP % e DDMX % (número antes de v). */
export function parseVarricaoCell(cell: unknown): { selimp: number; ddmx: number } | null {
  const s = String(cell ?? "").trim();
  if (!s) return null;
  const m = s.match(/([\d.,]+)\s*%\s*-\s*([\d.,]+)\s*v/i);
  if (!m) return null;
  const selimp = Number(String(m[1]).replace(",", "."));
  const ddmx = Number(String(m[2]).replace(",", "."));
  if (!Number.isFinite(selimp) || !Number.isFinite(ddmx)) return null;
  return { selimp, ddmx };
}

/**
 * Planilha tipo veículos: colunas Placa, Operação, Setor, Data (serial Excel), …, % Limpebras, % selimp.
 * Nota: o SheetJS pode retornar `row.length` menor que 12 quando as últimas colunas estão vazias — por isso
 * usamos `cellAt` em vez de exigir `row.length >= 12` (isso descartava centenas de linhas válidas).
 */
export function parseConsolidadoVeiculos(buffer: Buffer): ParseVeiculosResult {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) {
    return {
      rows: [],
      stats: {
        linhas_na_planilha: 0,
        linhas_importadas: 0,
        ignoradas_linha_vazia: 0,
        ignoradas_sem_setor: 0,
        ignoradas_sem_data: 0,
      },
    };
  }
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
  if (matrix.length < 2) {
    return {
      rows: [],
      stats: {
        linhas_na_planilha: 0,
        linhas_importadas: 0,
        ignoradas_linha_vazia: 0,
        ignoradas_sem_setor: 0,
        ignoradas_sem_data: 0,
      },
    };
  }

  const out: ConsolidadoVeiculoRow[] = [];
  let ignoradas_linha_vazia = 0;
  let ignoradas_sem_setor = 0;
  let ignoradas_sem_data = 0;
  let rowIndex = 0;
  const linhas_na_planilha = matrix.length - 1;

  for (let r = 1; r < matrix.length; r += 1) {
    const row = matrix[r];
    if (!Array.isArray(row)) continue;

    const placa = String(cellAt(row, 0)).trim();
    const operacao = String(cellAt(row, 1)).trim();
    const setorRaw = String(cellAt(row, 3)).trim();
    const serial = cellAt(row, 4);

    const linhaSemConteudo =
      !placa && !operacao && !setorRaw && (serial === "" || serial == null);
    if (linhaSemConteudo) {
      ignoradas_linha_vazia += 1;
      continue;
    }

    const setor = normalizarSetor(setorRaw);
    if (!setor) {
      ignoradas_sem_setor += 1;
      continue;
    }

    const dataRef = parseDataVeiculoCell(serial);
    if (!dataRef) {
      ignoradas_sem_data += 1;
      continue;
    }

    const pctLimpebras = normalizePercentDisplay(cellAt(row, 10));
    const pctSelimp = normalizePercentDisplay(cellAt(row, 11));

    const raw: Record<string, unknown> = {
      placa_liberada: placa,
      operacao: operacao,
      motorista: String(cellAt(row, 2)).trim(),
      setor,
      data_execucao_serial: typeof serial === "number" ? serial : null,
      data_referencia_key: dateToDateKey(dataRef),
      liberacao: String(cellAt(row, 5)).trim(),
      saida: String(cellAt(row, 6)).trim(),
      status: String(cellAt(row, 7)).trim(),
      retorno: String(cellAt(row, 8)).trim(),
      tempo_trabalho: String(cellAt(row, 9)).trim(),
      percentual_limpebras: pctLimpebras,
      percentual_selimp: pctSelimp,
      _fonte: "ipt_consolidado_veiculos",
    };

    const recordKey = `v|${rowIndex}|${setor}|${dateToDateKey(dataRef)}|${placa || "semplaca"}`;
    rowIndex += 1;
    out.push({
      recordKey,
      setor,
      dataReferencia: dataRef,
      servico: operacao,
      raw,
    });
  }

  return {
    rows: out,
    stats: {
      linhas_na_planilha,
      linhas_importadas: out.length,
      ignoradas_linha_vazia,
      ignoradas_sem_setor,
      ignoradas_sem_data,
    },
  };
}

/**
 * Planilha matriz varrição: linha 0 = datas; colunas 0–1 = setor e frequência; demais = células "X% - Yv".
 */
export function parseConsolidadoVarricao(buffer: Buffer): ConsolidadoVarricaoRow[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
  if (matrix.length < 2) return [];

  const header = matrix[0];
  const out: ConsolidadoVarricaoRow[] = [];

  for (let r = 1; r < matrix.length; r += 1) {
    const row = matrix[r];
    if (!Array.isArray(row) || row.length < 3) continue;
    const setorRaw = String(row[0] ?? "").trim();
    const setor = normalizarSetor(setorRaw);
    if (!setor) continue;
    const freqLabel = String(row[1] ?? "").trim();

    for (let c = 2; c < header.length; c += 1) {
      const h = String(header[c] ?? "").trim();
      if (/^m[eé]dia$/i.test(h.replace(/\s+/g, ""))) break;
      const dk = parseHeaderDateBr(header[c]);
      if (!dk) continue;
      const parsed = parseVarricaoCell(row[c]);
      if (!parsed) continue;
      const dataRef = new Date(`${dk}T12:00:00.000Z`);
      const raw: Record<string, unknown> = {
        setor,
        frequencia_rotulo: freqLabel,
        data_referencia_key: dk,
        percentual_selimp: parsed.selimp,
        percentual_ddmx: parsed.ddmx,
        _fonte: "ipt_consolidado_varricao",
      };
      const recordKey = `m|${setor}|${dk}|${c}`;
      out.push({
        recordKey,
        setor,
        dataReferencia: dataRef,
        servico: freqLabel,
        raw,
      });
    }
  }
  return out;
}
