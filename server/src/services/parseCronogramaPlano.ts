import * as XLSX from "xlsx";
import { normalizarSetor, parseSetor, getSubFromPlano, toDateKey } from "../constants/ipt.js";

/**
 * Parser do Cronograma do Plano de Trabalho (importação anual).
 *
 * Dois formatos de planilha (aba `Cronogramas`, um por arquivo):
 *  - **Escalonado**: serviços com datas explícitas (LM, NH, BL, MT, GO).
 *    Colunas SUBPREFEITURA, SETOR, FREQUÊNCIA, TURNO, LOCAL, DATA 1..N.
 *    GO traz 3 linhas por setor (datas não cabiam numa célula) → unificamos por setor.
 *  - **Fixo**: serviços de frequência semanal fixa (VJ, VL, CV, LE, VP, VM, VF, LF, CA).
 *    Colunas SUBPREFEITURA, SETOR, FREQUÊNCIA, TURNO, DIA DA SEMANA, LOCAL, FEIRA.
 *
 * Leitura com `cellDates: true`: células serial do Excel viram `Date` JS (resolve o
 * formato US "5/13/26" sem ambiguidade); células de texto (" 04/04/2026") ficam string
 * e são parseadas como BR dd/mm/yyyy.
 */

export type CronogramaModelo = "escalonado" | "fixo";

export interface CronogramaSetorParsed {
  setor: string; // normalizado via normalizarSetor()
  modelo: CronogramaModelo;
  servico: string | null;
  subprefeitura: string | null;
  subSigla: string | null;
  frequenciaTexto: string | null;
  frequenciaCodigo: string | null;
  turno: string | null;
  local: string | null;
  feira: string | null;
  diasSemana: string[] | null; // fixos: ['seg','qua','sex']; escalonado: null
  diaSemanaTexto: string | null;
  anoPlano: number | null;
  datas: string[]; // YYYY-MM-DD, dedupe + sorted (escalonado)
  sourceFile: string;
  raw: Record<string, unknown>;
}

export interface ParseCronogramaResult {
  modelo: CronogramaModelo | null;
  setores: CronogramaSetorParsed[];
  avisos: string[];
}

/** Ordem canônica da semana (segunda-first) usada para expandir intervalos. */
const WEEK_ORDER = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"] as const;
type DiaToken = (typeof WEEK_ORDER)[number];

function stripAccentsLower(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeHeader(value: unknown): string {
  return stripAccentsLower(value).replace(/\s+/g, " ");
}

function normalizeCell(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Converte uma célula (Date do Excel, número serial ou texto BR/ISO) para YYYY-MM-DD.
 * Retorna null se não for uma data reconhecível.
 */
function coerceDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : toDateKey(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Serial do Excel (fallback caso cellDates não tenha convertido).
    const parsed = XLSX.SSF?.parse_date_code ? XLSX.SSF.parse_date_code(value) : null;
    if (parsed && parsed.y) {
      return toDateKey(new Date(parsed.y, (parsed.m ?? 1) - 1, parsed.d ?? 1));
    }
    return null;
  }
  const raw = String(value).trim();
  if (!raw) return null;

  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (br) {
    let a = Number(br[1]);
    let b = Number(br[2]);
    const year = Number(br[3].length === 2 ? `20${br[3]}` : br[3]);
    // Brasileiro por padrão (dd/mm). Se o 1º campo > 12 e o 2º <= 12 já é dd/mm.
    // Se o 1º <= 12 e o 2º > 12, é mm/dd (US) → troca.
    if (a <= 12 && b > 12) {
      const tmp = a;
      a = b;
      b = tmp;
    }
    const d = new Date(year, b - 1, a);
    return Number.isNaN(d.getTime()) ? null : toDateKey(d);
  }

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(d.getTime()) ? null : toDateKey(d);
  }
  return null;
}

const DIA_MAP: Array<{ re: RegExp; token: DiaToken }> = [
  { re: /\bdomingo\b/, token: "dom" },
  { re: /\bsegunda\b/, token: "seg" },
  { re: /\bterca\b/, token: "ter" },
  { re: /\bquarta\b/, token: "qua" },
  { re: /\bquinta\b/, token: "qui" },
  { re: /\bsexta\b/, token: "sex" },
  { re: /\bsabado\b/, token: "sab" },
];

/**
 * Normaliza a coluna "DIA DA SEMANA" (texto bagunçado: caixa/acento/separadores)
 * para um array canônico de tokens em ordem da semana.
 * Trata intervalos ("Segunda a Domingo", "Segunda a Sábado"), listas ("/", ",", " e ")
 * e dias soltos ("Sábado", "Segunda-Feira").
 */
export function normalizarDiasSemana(texto: unknown): string[] {
  const norm = stripAccentsLower(texto).replace(/-?\s*feira\b/g, ""); // "segunda-feira" → "segunda"
  if (!norm) return [];

  // Dias na ordem em que aparecem no texto.
  const found: Array<{ token: DiaToken; pos: number }> = [];
  for (const { re, token } of DIA_MAP) {
    const m = norm.match(re);
    if (m && typeof m.index === "number") found.push({ token, pos: m.index });
  }
  if (found.length === 0) return [];
  found.sort((x, y) => x.pos - y.pos);

  // Intervalo: conector " a " / " ate " / " à " entre dois dias.
  const isRange = found.length >= 2 && /\s(?:a|ate|à)\s/.test(` ${norm} `);
  let tokens: DiaToken[];
  if (isRange) {
    const start = WEEK_ORDER.indexOf(found[0].token);
    const end = WEEK_ORDER.indexOf(found[found.length - 1].token);
    const range: DiaToken[] = [];
    if (start <= end) {
      for (let i = start; i <= end; i++) range.push(WEEK_ORDER[i]);
    } else {
      // wrap (raro): start..fim + 0..end
      for (let i = start; i < WEEK_ORDER.length; i++) range.push(WEEK_ORDER[i]);
      for (let i = 0; i <= end; i++) range.push(WEEK_ORDER[i]);
    }
    tokens = range;
  } else {
    tokens = found.map((f) => f.token);
  }

  // dedupe + ordem canônica da semana
  const set = new Set(tokens);
  return WEEK_ORDER.filter((d) => set.has(d));
}

interface ColMap {
  setor: number;
  subprefeitura: number;
  frequencia: number;
  turno: number;
  local: number;
  feira: number;
  diaSemana: number;
  datas: number[];
}

function mapColumns(headerRow: unknown[]): ColMap {
  const headers = headerRow.map((h) => normalizeHeader(h));
  const find = (pred: (h: string) => boolean) => headers.findIndex(pred);
  const datas: number[] = [];
  headers.forEach((h, idx) => {
    if (/^data\b/.test(h) || /^data\s*\d+$/.test(h)) datas.push(idx);
  });
  return {
    setor: find((h) => h === "setor"),
    subprefeitura: find((h) => h.startsWith("subprefeitura")),
    frequencia: find((h) => h.startsWith("frequencia")),
    turno: find((h) => h === "turno"),
    local: find((h) => h === "local"),
    feira: find((h) => h === "feira"),
    diaSemana: find((h) => h === "dia da semana"),
    datas,
  };
}

function buildInfo(setorNorm: string, row: unknown[], cols: ColMap) {
  const parsed = parseSetor(setorNorm);
  return {
    servico: parsed?.servico ?? null,
    subprefeitura: cols.subprefeitura >= 0 ? normalizeCell(row[cols.subprefeitura]) || null : null,
    subSigla: getSubFromPlano(setorNorm) || null,
    frequenciaTexto: cols.frequencia >= 0 ? normalizeCell(row[cols.frequencia]) || null : null,
    frequenciaCodigo: parsed?.frequencia ?? null,
    turno: cols.turno >= 0 ? normalizeCell(row[cols.turno]) || null : null,
    local: cols.local >= 0 ? normalizeCell(row[cols.local]) || null : null,
  };
}

export function parseCronogramaWorkbook(buffer: Buffer, filename: string): ParseCronogramaResult {
  const avisos: string[] = [];
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { modelo: null, setores: [], avisos: [`${filename}: planilha sem abas.`] };
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });
  if (rows.length < 2) {
    return { modelo: null, setores: [], avisos: [`${filename}: planilha vazia.`] };
  }

  const cols = mapColumns(rows[0] ?? []);
  if (cols.setor < 0) {
    return { modelo: null, setores: [], avisos: [`${filename}: coluna SETOR não encontrada.`] };
  }

  const modelo: CronogramaModelo | null =
    cols.datas.length > 0 ? "escalonado" : cols.diaSemana >= 0 ? "fixo" : null;
  if (!modelo) {
    return {
      modelo: null,
      setores: [],
      avisos: [`${filename}: formato não reconhecido (sem colunas DATA nem DIA DA SEMANA).`],
    };
  }

  const importYear = new Date().getFullYear();

  if (modelo === "escalonado") {
    const grupos = new Map<string, CronogramaSetorParsed>();
    let invalidos = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const setorRaw = normalizeCell(row[cols.setor]);
      if (!setorRaw) continue;
      const setor = normalizarSetor(setorRaw).toUpperCase();
      if (!parseSetor(setor)) {
        invalidos++;
        continue;
      }
      const datasRow: string[] = [];
      for (const c of cols.datas) {
        const d = coerceDate(row[c]);
        if (d) datasRow.push(d);
      }
      let grupo = grupos.get(setor);
      if (!grupo) {
        const info = buildInfo(setor, row, cols);
        grupo = {
          setor,
          modelo,
          ...info,
          feira: null,
          diasSemana: null,
          diaSemanaTexto: null,
          anoPlano: null,
          datas: [],
          sourceFile: filename,
          raw: { setor: setorRaw },
        };
        grupos.set(setor, grupo);
      }
      grupo.datas.push(...datasRow);
    }
    for (const grupo of grupos.values()) {
      const unique = Array.from(new Set(grupo.datas)).sort();
      grupo.datas = unique;
      grupo.anoPlano = unique.length ? Number(unique[0].slice(0, 4)) : importYear;
    }
    if (invalidos > 0) avisos.push(`${filename}: ${invalidos} linha(s) com setor fora do padrão ignorada(s).`);
    return { modelo, setores: Array.from(grupos.values()), avisos };
  }

  // modelo === "fixo"
  const grupos = new Map<string, CronogramaSetorParsed>();
  let invalidos = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const setorRaw = normalizeCell(row[cols.setor]);
    if (!setorRaw) continue;
    const setor = normalizarSetor(setorRaw).toUpperCase();
    if (!parseSetor(setor)) {
      invalidos++;
      continue;
    }
    if (grupos.has(setor)) continue; // uma linha por setor em fixos
    const info = buildInfo(setor, row, cols);
    const diaSemanaTexto = cols.diaSemana >= 0 ? normalizeCell(row[cols.diaSemana]) || null : null;
    grupos.set(setor, {
      setor,
      modelo,
      ...info,
      feira: cols.feira >= 0 ? normalizeCell(row[cols.feira]) || null : null,
      diasSemana: normalizarDiasSemana(diaSemanaTexto),
      diaSemanaTexto,
      anoPlano: importYear,
      datas: [],
      sourceFile: filename,
      raw: { setor: setorRaw },
    });
  }
  if (invalidos > 0) avisos.push(`${filename}: ${invalidos} linha(s) com setor fora do padrão ignorada(s).`);
  return { modelo, setores: Array.from(grupos.values()), avisos };
}
