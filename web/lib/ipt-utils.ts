/**
 * Utilitários IPT (espelhados do backend).
 * Formato setor: CV(SUB) 1(turno) 0500(frequência) GO(serviço) 0015(mapa)
 * Regra: os primeiros 2 caracteres do plano são a SUB (CV, JT, MG, ST).
 */

export const SUB_SIGLAS = ["CV", "JT", "MG", "ST"] as const;

/** Extrai a sigla da SUB dos primeiros 2 caracteres do plano, quando forem CV, JT, MG ou ST. */
export function getSubFromPlano(plano?: string): string {
  const match = String(plano ?? "").trim().toUpperCase().match(/^(CV|JT|MG|ST)/);
  return match ? match[1] : "";
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

export function getFrequenciaDescricao(codigo: string): string {
  return FREQUENCIAS[codigo] ?? codigo;
}

export function getSortKey(setor: string): { sub: string; servico: string; mapa: string } {
  const raw = String(setor ?? "").trim().toUpperCase();
  const subMatch = raw.match(/^(CV|JT|MG|ST)(\d)(\d{4})([A-Z]{2})(\d{4})/i);
  if (subMatch) {
    return {
      sub: subMatch[1].toUpperCase(),
      servico: subMatch[4].toUpperCase(),
      mapa: subMatch[5],
    };
  }
  const mapaMatch = raw.match(/(\d{4})(?:\s|$|[-])/);
  const mapa = mapaMatch ? mapaMatch[1] : "9999";
  const servMatch = raw.match(/([A-Z]{2})\d{4}/i);
  const servico = servMatch ? servMatch[1].toUpperCase() : "";
  const sub = raw.match(/^(CV|JT|MG|ST)/i)?.[1]?.toUpperCase() ?? "";
  return { sub, servico, mapa };
}

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

/**
 * Data de instalação vinda da API em dd/MM/yyyy — mantém o valor já normalizado.
 */
export function formatIptDataInstalacaoBr(input: string | null | undefined): string {
  if (input == null) return "";
  const s = String(input).trim();
  if (!s) return "";

  const slashDate = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (slashDate) {
    const first = Number(slashDate[1]);
    const second = Number(slashDate[2]);
    let yyyy = slashDate[3];
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    let day = first;
    let month = second;

    if (first > 12 && second <= 12) {
      day = first;
      month = second;
    } else if (second > 12 && first <= 12) {
      day = second;
      month = first;
    }

    const dd = String(day).padStart(2, "0");
    const mm = String(month).padStart(2, "0");
    return `${dd}/${mm}/${yyyy}`;
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    return `${iso[3]}/${iso[2]}/${iso[1]}`;
  }

  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = d.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  return s;
}
