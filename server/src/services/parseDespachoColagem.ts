import { normalizarSetor, parseSetor } from "../constants/ipt.js";

/**
 * Parser da COLAGEM da plataforma SELIMP (Despachos).
 *
 * Ao copiar a grade de despachos da SELIMP e colar num textarea, cada célula vira uma
 * linha. Cada registro fica como 6 campos em sequência:
 *   1. Setor/plano        (ex.: ST20403VF0006-2026)
 *   2. Modelo de trabalho (ex.: Portáteis)
 *   3. Status             (ex.: Ativo)
 *   4. Data planejada     (ex.: 02/06/2026 11:00:00)
 *   5. Data máxima exec.  (ex.: 02/06/2026 20:00:00)
 *   6. Veículos           (lista separada por vírgula: SMSUB-PORTATEIS-03-0070, ...)
 *
 * O cabeçalho ("Nome", "Modelo de trabalho", "Status", ...) não casa com o padrão de
 * setor e é ignorado. Ancoramos cada registro na linha de setor e lemos o bloco até o
 * próximo setor (veículos podem vir quebrados em mais de uma linha → juntamos o resto).
 */

const PLANO_RE = /^(CV|JT|MG|ST)\d{5}[A-Z]{2}\d{4}(-\d{4})?$/i;

export interface DespachoColado {
  setor: string; // normalizado (sem sufixo -AAAA, sem espaços)
  setorOriginal: string; // como veio na colagem
  modelo: string | null;
  status: string | null;
  dataPlanejada: string | null;
  dataMaxima: string | null;
  veiculos: string[];
}

export interface ParseDespachoColagemResult {
  registros: DespachoColado[];
  total: number;
  ignoradas: number; // linhas que não formaram registro
  avisos: string[];
}

function isPlano(line: string): boolean {
  return PLANO_RE.test(line.replace(/\s+/g, ""));
}

function splitVeiculos(value: string): string[] {
  return value
    .split(/[,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function parseDespachoColagem(texto: string): ParseDespachoColagemResult {
  const avisos: string[] = [];
  const lines = String(texto ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\t/g, " ").trim())
    .filter((l) => l.length > 0);

  // Índices das linhas de setor (âncoras de cada registro).
  const ancoras: number[] = [];
  lines.forEach((l, i) => {
    if (isPlano(l)) ancoras.push(i);
  });

  if (ancoras.length === 0) {
    return {
      registros: [],
      total: 0,
      ignoradas: lines.length,
      avisos: ["Nenhum setor reconhecido na colagem. Cole a grade de despachos da SELIMP (com a coluna do setor)."],
    };
  }

  const porSetor = new Map<string, DespachoColado>();
  let usadas = 0;

  for (let k = 0; k < ancoras.length; k++) {
    const start = ancoras[k];
    const end = k + 1 < ancoras.length ? ancoras[k + 1] : lines.length;
    const bloco = lines.slice(start, end);
    usadas += bloco.length;

    const setorOriginal = bloco[0];
    const setor = normalizarSetor(setorOriginal).toUpperCase();
    if (!parseSetor(setor)) {
      avisos.push(`Setor fora do padrão ignorado: "${setorOriginal}".`);
      continue;
    }

    const modelo = bloco[1] ?? null;
    const status = bloco[2] ?? null;
    const dataPlanejada = bloco[3] ?? null;
    const dataMaxima = bloco[4] ?? null;
    const veiculos = bloco.length > 5 ? splitVeiculos(bloco.slice(5).join(", ")) : [];

    // Último registro do mesmo setor vence (colagens podem repetir).
    porSetor.set(setor, { setor, setorOriginal, modelo, status, dataPlanejada, dataMaxima, veiculos });
  }

  return {
    registros: Array.from(porSetor.values()),
    total: porSetor.size,
    ignoradas: lines.length - usadas,
    avisos,
  };
}
