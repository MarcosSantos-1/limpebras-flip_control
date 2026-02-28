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
  return s;
}

/**
 * Parse do setor no formato: SUB + turno + frequência + serviço + mapa.
 * Ex: CV10500GO0015 -> { sub: CV, turno: 1, frequencia: 0500, servico: GO, mapa: 0015 }
 */
export function parseSetor(setor: string): ParsedSetor | null {
  const raw = String(setor ?? "").trim().toUpperCase();
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
