/**
 * Constantes e utilitários para IPT.
 * Formato do setor: CV(SUB) 1(turno) 0500(frequência) GO(serviço) 0015(mapa)
 * Ex: CV10500GO0015 -> CV, 1, 0500, GO, 0015
 */

export interface ParsedSetor {
  sub: string;
  turno: string;
  frequencia: string;
  servico: string;
  mapa: string;
  setorNormalizado: string;
}

export const FREQUENCIAS: Record<string, string> = {
  "0101": "diária - 1x/dia",
  "0102": "diária - 2x/dia",
  "0103": "diária - 3x/dia",
  "0104": "diária - 4x/dia",
  "0105": "diária - 5x/dia",
  "0106": "diária - 6x/dia",
  "0108": "diária - 8x/dia",
  "0110": "diária - 10/dia",
  "0202": "Alternado - Alt. Segunda / Quarta / Sexta",
  "0203": "Alternado - Alt. Terça / Quinta / Sábado",
  "0302": "Bissemanal - Bis. Segunda / Quinta",
  "0303": "Bissemanal - Bis. Terça / Sexta",
  "0304": "Bissemanal - Bis. Quarta / Sábado",
  "0401": "Semanal - Sem. Domingo",
  "0402": "Semanal - Sem. Segunda",
  "0403": "Semanal - Sem. Terça",
  "0404": "Semanal - Sem. Quarta",
  "0405": "Semanal - Sem. Quinta",
  "0406": "Semanal - Sem. Sexta",
  "0407": "Semanal - Sem. Sábado",
  "0500": "Quinzenal - 2x/Mês",
  "0600": "Mensal - 1x/Mês",
  "0700": "trimestral - 4x/Ano",
  "0800": "Quadrimestral - 3x/Ano",
  "0900": "Semestral - 2x/ano",
  "1000": "Bimestral - 6x/ano",
};

const SUB_SIGLAS = ["CV", "JT", "MG", "ST"] as const;
const FREQ_PATTERN = /^\d{4}$/;

const SUFIXOS_DIA_SEMANA = /\s*-\s*(DOMINGO|SEGUNDA|TER[CÇ]A|QUARTA|QUINTA|SEXTA|S[AÁ]BADO)\s*$/i;

/**
 * Remove sufixos como " - NOVO", " - DOMINGO", " - SEGUNDA" etc. do setor.
 * Unifica JT10700MT0090 - NOVO com JT10700MT0090 e CV20401CV0001 - DOMINGO com CV20401CV0001.
 */
export function normalizarSetor(setor: string): string {
  let s = String(setor ?? "")
    .trim()
    .replace(/\s*-\s*NOVO\s*$/i, "")
    .replace(/\s*-\s*OBS[ERVAÇÃO]*\s*$/i, "");
  s = s.replace(SUFIXOS_DIA_SEMANA, "").trim();
  /** Remove espaços internos para unificar "CV 1 0500 MT 0015" com "CV10500MT0015" */
  s = s.replace(/\s+/g, "");
  return s;
}

/**
 * Parse do setor no formato: SUB + turno + frequência + serviço + mapa.
 * Ex: CV10500GO0015 -> { sub: CV, turno: 1, frequencia: 0500, servico: GO, mapa: 0015 }
 */
export function parseSetor(setor: string): ParsedSetor | null {
  const raw = String(setor ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
  if (!raw || raw.length < 13) return null;

  // Padrão: 2 sub + 1 turno + 4 freq + 2 servico + 4 mapa = 13
  const subMatch = raw.match(/^(CV|JT|MG|ST)(\d)(\d{4})([A-Z]{2})(\d{4})/i);
  if (subMatch) {
    return {
      sub: subMatch[1].toUpperCase(),
      turno: subMatch[2],
      frequencia: subMatch[3],
      servico: subMatch[4].toUpperCase(),
      mapa: subMatch[5],
      setorNormalizado: subMatch[0],
    };
  }
  return null;
}

/**
 * Mapeamento codinome do setor (2 letras) -> nome completo do serviço.
 * Nunca exibir "Não informado" — sempre usar este mapeamento quando disponível.
 */
export const SERVICO_POR_CODIGO: Record<string, string> = {
  MT: "Equipe de Mutirão de Zeladoria de Vias e Logradouros Públicos",
  BL: "Limpeza e desobstrução de bueiros, bocas de lobo e bocas de leão",
  LF: "Lavagem de vias pós feiras livres",
  NH: "Limpeza de áreas externas e internas de núcleos habitacionais de difícil acesso",
  LE: "Lavagem especial de equipamentos públicos",
  GO: "Coleta de grandes objetos (cata-bagulho)",
  VP: "Equipe para varrição de praças",
  VJ: "Varrição manual de vias e logradouros públicos - sarjetas",
  VL: "Varrição manual de vias e logradouros públicos - sarjetas e calçadas",
  /** Varrição mecanizada (código no plano, ex.: CV10302VM0002) */
  VM: "Varrição mecanizada de vias e logradouros públicos",
  LM: "Equipe de asseio a locais com população em situação de rua e comércio desordenado",
  CV: "Coleta manual de resíduos de varrição com compactador",
};

/**
 * Nome canônico do serviço a partir do plano (BL, VP, MT, VJ, VL, GO, etc.).
 * Usa a sigla da nomenclatura → `SERVICO_POR_CODIGO` (VJ e VL permanecem distintos).
 * Use para exibição e agregação (evita rótulos curtos da planilha duplicando o nome oficial).
 */
export function getTipoServicoCanonicoPlano(plano: string): string {
  const parsed = parseSetor(plano);
  if (!parsed) return "";
  return SERVICO_POR_CODIGO[parsed.servico] ?? "";
}

/**
 * Retorna o tipo de serviço conforme o codinome do setor (MT, BL, NH, etc.).
 * Nunca retorna "Não informado".
 */
export function getTipoServicoFromPlano(plano: string): string {
  return getTipoServicoCanonicoPlano(plano);
}

/**
 * Extrai a sigla da SUB dos primeiros 2 caracteres do plano (CV, JT, MG, ST).
 * Regra canônica: os primeiros 2 caracteres definem a subprefeitura.
 */
export function getSubFromPlano(plano: string): string {
  const match = String(plano ?? "").trim().toUpperCase().match(/^(CV|JT|MG|ST)/);
  return match ? match[1] : "";
}

/**
 * Retorna a descrição da frequência (ex: "diária - 1x/dia").
 */
export function getFrequenciaDescricao(codigo: string): string {
  return FREQUENCIAS[codigo] ?? codigo;
}

/**
 * Chave de ordenação: sigla do serviço (VP, VJ, VL, etc), depois 4 últimos dígitos (mapa).
 * Ordem: 1) Sigla sub (CV<JT<MG<ST), 2) Serviço (VP, VJ, VL, MT, GO, etc), 3) Mapa (últimos 4 dígitos).
 */
export function getSortKey(setor: string): { sub: string; servico: string; mapa: string } {
  const p = parseSetor(setor);
  if (p) {
    return {
      sub: p.sub,
      servico: p.servico,
      mapa: p.mapa,
    };
  }
  // Fallback: extrair últimos 4 dígitos se existirem
  const mapaMatch = String(setor).match(/(\d{4})(?:\s|$|[-])/);
  const mapa = mapaMatch ? mapaMatch[1] : "9999";
  const servMatch = String(setor).match(/([A-Z]{2})\d{4}/i);
  const servico = servMatch ? servMatch[1].toUpperCase() : "";
  const subMatch = String(setor).match(/^(CV|JT|MG|ST)/i);
  const sub = subMatch ? subMatch[1].toUpperCase() : "";
  return { sub, servico, mapa };
}

/**
 * Compara dois setores para ordenação crescente.
 * Ordem: sub (CV<JT<MG<ST), servico (VP<VJ<VL<...), mapa (0015<0090<...).
 */
export function compareSetores(a: string, b: string, direction: "asc" | "desc" = "asc"): number {
  const ka = getSortKey(a);
  const kb = getSortKey(b);
  let cmp = ka.sub.localeCompare(kb.sub);
  if (cmp !== 0) return direction === "asc" ? cmp : -cmp;
  cmp = ka.servico.localeCompare(kb.servico);
  if (cmp !== 0) return direction === "asc" ? cmp : -cmp;
  cmp = ka.mapa.localeCompare(kb.mapa);
  return direction === "asc" ? cmp : -cmp;
}

export const CRONOGRAMA_SERVICOS = new Set(["BL", "MT", "NH", "LM", "GO", "LE"]);

export function toDateKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * D-1 (ontem) no calendário de São Paulo — alinha IPT com Report SELIMP e evita
 * divergência entre servidor em UTC (produção) e máquina local em BRT (dev).
 */
export function getYesterdayDateKeyBrt(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const mo = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  const todayUtc = new Date(Date.UTC(y, mo - 1, day));
  todayUtc.setUTCDate(todayUtc.getUTCDate() - 1);
  const yy = todayUtc.getUTCFullYear();
  const mm = String(todayUtc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(todayUtc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function parseDateKeyLocal(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00`);
}

export function diffInDaysAbs(a: string, b: string): number {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.round(Math.abs(parseDateKeyLocal(a).getTime() - parseDateKeyLocal(b).getTime()) / oneDay);
}

export function isFrequencyDate(frequencia: string, dateKey: string): boolean {
  const d = parseDateKeyLocal(dateKey);
  const day = d.getDay();
  const month = d.getMonth();
  const monthDay = d.getDate();
  switch (frequencia) {
    case "0101": case "0102": case "0103": case "0104":
    case "0105": case "0106": case "0108": case "0110":
      return true;
    case "0202": return day === 1 || day === 3 || day === 5;
    case "0203": return day === 2 || day === 4 || day === 6;
    case "0302": return day === 1 || day === 4;
    case "0303": return day === 2 || day === 5;
    case "0304": return day === 3 || day === 6;
    case "0401": return day === 0;
    case "0402": return day === 1;
    case "0403": return day === 2;
    case "0404": return day === 3;
    case "0405": return day === 4;
    case "0406": return day === 5;
    case "0407": return day === 6;
    case "0500": return monthDay === 1 || monthDay === 15;
    case "0600": return monthDay === 1;
    case "0700": return monthDay === 1 && [0, 3, 6, 9].includes(month);
    case "0800": return monthDay === 1 && [0, 4, 8].includes(month);
    case "0900": return monthDay === 1 && [0, 6].includes(month);
    case "1000": return monthDay === 1 && month % 2 === 0;
    default: return false;
  }
}

/** Gera todas as datas dentro de [inicio, fim] que correspondem à frequência. */
export function generateFrequencyDates(frequencia: string, inicio: string, fim: string): string[] {
  const dates: string[] = [];
  const startDate = parseDateKeyLocal(inicio);
  const endDate = parseDateKeyLocal(fim);
  const current = new Date(startDate);
  while (current <= endDate) {
    const key = toDateKey(current);
    if (key && isFrequencyDate(frequencia, key)) {
      dates.push(key);
    }
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

export function findPreviousExpectedByFrequency(frequencia: string, referenceDateKey: string): string | null {
  for (let i = 0; i <= 120; i += 1) {
    const d = parseDateKeyLocal(referenceDateKey);
    d.setDate(d.getDate() - i);
    const key = toDateKey(d);
    if (!key) continue;
    if (isFrequencyDate(frequencia, key)) return key;
  }
  return null;
}

export function findNextExpectedByFrequency(frequencia: string, referenceDateKey: string): string | null {
  for (let i = 1; i <= 120; i += 1) {
    const d = parseDateKeyLocal(referenceDateKey);
    d.setDate(d.getDate() + i);
    const key = toDateKey(d);
    if (!key) continue;
    if (isFrequencyDate(frequencia, key)) return key;
  }
  return null;
}

export function findPreviousExpectedByFrequencyStrict(frequencia: string, referenceDateKey: string): string | null {
  for (let i = 1; i <= 120; i += 1) {
    const d = parseDateKeyLocal(referenceDateKey);
    d.setDate(d.getDate() - i);
    const key = toDateKey(d);
    if (!key) continue;
    if (isFrequencyDate(frequencia, key)) return key;
  }
  return null;
}

export function pickNearestDate(referenceDateKey: string, dates: string[], maxDistanceDays: number): string | null {
  let best: { date: string; diff: number } | null = null;
  for (const date of dates) {
    const diff = diffInDaysAbs(referenceDateKey, date);
    if (diff > maxDistanceDays) continue;
    if (!best || diff < best.diff) best = { date, diff };
  }
  return best?.date ?? null;
}
