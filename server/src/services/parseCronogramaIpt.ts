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
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDatasFromCell(value: string): Date[] {
  return value
    .split(/[;\s,]+/)
    .map((s) => parseDateBR(s))
    .filter((d): d is Date => d != null);
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
    const cronoIdx = headerRow.findIndex((h) => /^cronograma$/i.test(h.replace(/\s/g, "")));
    if (setorIdx < 0 || cronoIdx < 0) return [];
    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i] ?? [];
      const setor = normalizeCell(row[setorIdx]).replace(/\s/g, "").toUpperCase();
      const crono = normalizeCell(row[cronoIdx]);
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

  if (servico === "NH") {
    const setorIdx = headerRow.findIndex((h) => /^setor$/i.test(h.replace(/\s/g, "")));
    const crono2Idx = headerRow.findIndex((h) => /^cronograma2$/i.test(h.replace(/\s/g, "")));
    const cronoIdx = headerRow.findIndex((h) => /^cronograma$/i.test(h.replace(/\s/g, "")));
    if (setorIdx < 0 || (crono2Idx < 0 && cronoIdx < 0)) return [];
    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i] ?? [];
      const setor = normalizeCell(row[setorIdx]).replace(/\s/g, "").toUpperCase();
      const cronoAtual = crono2Idx >= 0 ? normalizeCell(row[crono2Idx]) : "";
      const cronoAntigo = cronoIdx >= 0 ? normalizeCell(row[cronoIdx]) : "";
      const crono = cronoAtual || cronoAntigo;
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

  // BL, MT, GO: colunas CV, ST, JT, MG + CRONOGRAMA2 (fallback CRONOGRAMA)
  const subCols = ["CV", "ST", "JT", "MG"].map((sub) =>
    headerRow.findIndex((h) => h.trim().toUpperCase() === sub)
  );
  const crono2Idx = headerRow.findIndex((h) => /^cronograma2$/i.test(h.replace(/\s/g, "")));
  const cronoIdx = headerRow.findIndex((h) => /^cronograma$/i.test(h.replace(/\s/g, "")));
  if ((crono2Idx < 0 && cronoIdx < 0) || subCols.every((c) => c < 0)) return [];

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i] ?? [];
    const cronoAtual = crono2Idx >= 0 ? normalizeCell(row[crono2Idx]) : "";
    const cronoAntigo = cronoIdx >= 0 ? normalizeCell(row[cronoIdx]) : "";
    const crono = cronoAtual || cronoAntigo;
    const datas = parseDatasFromCell(crono);
    for (const colIdx of subCols) {
      if (colIdx < 0) continue;
      const setor = normalizeCell(row[colIdx]).replace(/\s/g, "").toUpperCase();
      if (!setor || !looksLikeSetor(setor)) continue;
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
  }
  return out;
}
