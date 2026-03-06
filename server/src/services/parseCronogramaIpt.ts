import * as XLSX from "xlsx";

const CRONOGRAMAS_SERVICOS = ["BL", "MT", "NH", "LM", "GO"] as const;

export interface CronogramaRow {
  servico: string;
  setor: string;
  dataEsperada: Date;
  ano?: number;
  raw: Record<string, unknown>;
}

function normalizeCell(value: unknown): string {
  return String(value ?? "").trim();
}

function parseDateBR(value: string): Date | null {
  const raw = value.trim();
  if (!raw) return null;
  // Formato BR: dd/mm/yyyy ou dd/mm/yy
  const matchBR = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (matchBR) {
    const day = Number(matchBR[1]);
    const month = Number(matchBR[2]);
    const year = Number(matchBR[3].length === 2 ? `20${matchBR[3]}` : matchBR[3]);
    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  // Formato ISO: yyyy-mm-dd
  const matchISO = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (matchISO) {
    const parsed = new Date(Number(matchISO[1]), Number(matchISO[2]) - 1, Number(matchISO[3]));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function parseDatasFromCell(value: string): Date[] {
  if (!value || !String(value).trim()) return [];
  // Split por separadores comuns: ; , espaço, quebra de linha, tab
  const parts = String(value)
    .split(/[;\s,\t\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const dates: Date[] = [];
  for (const p of parts) {
    const d = parseDateBR(p);
    if (d) dates.push(d);
  }
  return dates;
}

function looksLikeSetor(value: string): boolean {
  const v = value.replace(/\s/g, "").toUpperCase();
  return /^(CV|JT|MG|ST)\d{5}[A-Z]{2}\d{4}$/.test(v);
}

/**
 * Parse cronograma XLSX.
 * BL, MT, GO: colunas CV, ST, JT, MG com setores; prioriza CRONOGRAMA2 (atual), fallback CRONOGRAMA
 * NH: coluna SETOR, prioriza CRONOGRAMA2 (atual), fallback CRONOGRAMA
 * LM: coluna SETOR, CRONOGRAMA (única coluna)
 * Servico vem do nome do arquivo (BL.xlsx → BL).
 */
export function parseCronogramaWorkbook(buffer: Buffer, filename: string): CronogramaRow[] {
  const servicoMatch = filename.replace(/\.xlsx?$/i, "").toUpperCase();
  const servico = CRONOGRAMAS_SERVICOS.includes(servicoMatch as (typeof CRONOGRAMAS_SERVICOS)[number])
    ? servicoMatch
    : null;
  if (!servico) return [];

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

  const headerRow = (rawRows[0] ?? []).map((c) => normalizeCell(c));
  const out: CronogramaRow[] = [];

  if (servico === "LM") {
    const setorIdx = headerRow.findIndex((h) => /^setor$/i.test(h.replace(/\s/g, "")));
    const cronoColIndices = headerRow
      .map((h, idx) => ({ h: h.replace(/\s/g, ""), idx }))
      .filter(({ h }) => /^cronograma\d*$/i.test(h) || /^cronograma$/i.test(h))
      .map(({ idx }) => idx);
    if (setorIdx < 0 || cronoColIndices.length === 0) return [];
    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i] ?? [];
      const setor = normalizeCell(row[setorIdx]).replace(/\s/g, "").toUpperCase();
      const allDateStrs = cronoColIndices.map((idx) => normalizeCell(row[idx])).filter(Boolean);
      const crono = allDateStrs.join("; ");
      if (!setor || !looksLikeSetor(setor)) continue;
      const datas = parseDatasFromCell(crono);
      const uniqueDates = Array.from(new Set(datas.map((d) => d.getTime()))).map((t) => new Date(t));
      for (const d of uniqueDates) {
        out.push({
          servico,
          setor,
          dataEsperada: d,
          ano: d.getFullYear(),
          raw: { setor, cronograma: crono },
        });
      }
    }
    return out;
  }

  if (servico === "NH") {
    const setorIdx = headerRow.findIndex((h) => /^setor$/i.test(h.replace(/\s/g, "")));
    const cronoColIndices = headerRow
      .map((h, idx) => ({ h: h.replace(/\s/g, ""), idx }))
      .filter(({ h }) => /^cronograma(\d)*$/i.test(h) || /^cronograma$/i.test(h))
      .map(({ idx }) => idx);
    if (setorIdx < 0 || cronoColIndices.length === 0) return [];
    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i] ?? [];
      const setor = normalizeCell(row[setorIdx]).replace(/\s/g, "").toUpperCase();
      const allDateStrs = cronoColIndices.map((idx) => normalizeCell(row[idx])).filter(Boolean);
      const crono = allDateStrs.join("; ");
      if (!setor || !looksLikeSetor(setor)) continue;
      const datas = parseDatasFromCell(crono);
      for (const d of datas) {
        out.push({
          servico,
          setor,
          dataEsperada: d,
          ano: d.getFullYear(),
          raw: { setor, cronograma: crono },
        });
      }
    }
    return out;
  }

  // BL, MT, GO: colunas CV, ST, JT, MG + CRONOGRAMA1, CRONOGRAMA2, CRONOGRAMA
  // Mescla datas de todas as colunas de cronograma para ter 5+ datas (2 ant, atual, 2 fut)
  const subCols = ["CV", "ST", "JT", "MG"].map((sub) =>
    headerRow.findIndex((h) => h.trim().toUpperCase() === sub)
  );
  const cronoColIndices = headerRow
    .map((h, idx) => ({ h: h.replace(/\s/g, ""), idx }))
    .filter(({ h }) => /^cronograma(\d)*$/i.test(h) || /^cronograma$/i.test(h))
    .map(({ idx }) => idx)
    .sort((a, b) => {
      const na = (headerRow[a] ?? "").replace(/\s/g, "").toUpperCase();
      const nb = (headerRow[b] ?? "").replace(/\s/g, "").toUpperCase();
      const numA = na.match(/\d+$/)?.[0] ?? "0";
      const numB = nb.match(/\d+$/)?.[0] ?? "0";
      return Number(numB) - Number(numA); // CRONOGRAMA2 antes de CRONOGRAMA1
    });
  if (cronoColIndices.length === 0 || subCols.every((c) => c < 0)) return [];

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i] ?? [];
    const allDateStrs: string[] = [];
    for (const colIdx of cronoColIndices) {
      const cell = normalizeCell(row[colIdx]);
      if (cell) allDateStrs.push(cell);
    }
    const crono = allDateStrs.join("; ");
    const datas = parseDatasFromCell(crono);
    const uniqueDates = Array.from(new Set(datas.map((d) => d.getTime())))
      .map((t) => new Date(t))
      .sort((a, b) => a.getTime() - b.getTime());
    for (const colIdx of subCols) {
      if (colIdx < 0) continue;
      const setor = normalizeCell(row[colIdx]).replace(/\s/g, "").toUpperCase();
      if (!setor || !looksLikeSetor(setor)) continue;
      for (const d of uniqueDates) {
        out.push({
          servico,
          setor,
          dataEsperada: d,
          ano: d.getFullYear(),
          raw: { setor, cronograma: crono },
        });
      }
    }
  }
  return out;
}
