const VOLTS_FLOOR = 1;
const VOLTS_CEIL = 11;
const PERCENT_AT_CEIL = 90;
const EMPTY_DATE_PATTERN = /^[-—–.\s]*$/;

export function isEmptyDispatchDate(value: unknown): boolean {
  if (value == null) return true;
  const s = String(value).trim();
  if (!s) return true;
  if (EMPTY_DATE_PATTERN.test(s)) return true;
  if (s.toLowerCase() === "null" || s.toLowerCase() === "undefined") return true;
  return false;
}

export function parseDdmxBateriaVolts(raw: unknown): { volts: number | null; percentual: number | null } {
  if (raw == null) return { volts: null, percentual: null };
  const s = String(raw).trim();
  if (!s) return { volts: null, percentual: null };

  const match = s.match(/(\d+(?:[.,]\d+)?)\s*v?\b/i);
  if (!match) return { volts: null, percentual: null };

  const volts = parseFloat(match[1].replace(",", "."));
  if (!Number.isFinite(volts)) return { volts: null, percentual: null };

  let percentual: number;
  if (volts <= VOLTS_FLOOR) {
    percentual = 0;
  } else if (volts > VOLTS_CEIL) {
    percentual = PERCENT_AT_CEIL;
  } else {
    percentual = Number((((volts - VOLTS_FLOOR) / (VOLTS_CEIL - VOLTS_FLOOR)) * PERCENT_AT_CEIL).toFixed(2));
  }

  return { volts, percentual };
}

export type DdmxBateriaDispatchItem = {
  rota: string;
  bateria_raw: string;
  bateria_percentual: number | null;
  bateria_desatualizada: boolean;
  ultima_comunicacao: string | null;
};

export function parseDdmxBateriaFromRaw(raw: Record<string, unknown>): Omit<DdmxBateriaDispatchItem, "rota"> {
  const bateriaRaw = String(raw.bateria ?? "").trim();
  const dataInicio = raw.data_inicio;
  const dataFinal = raw.data_final;
  const desatualizada = isEmptyDispatchDate(dataInicio) || isEmptyDispatchDate(dataFinal);
  const { percentual } = parseDdmxBateriaVolts(bateriaRaw);

  const ultimaRaw =
    raw.data_ultima_comunicacao_do_modulo ??
    raw.data_ultima_comunicacao ??
    raw.ultima_comunicacao ??
    null;
  const ultimaComunicacao = ultimaRaw == null || isEmptyDispatchDate(ultimaRaw) ? null : String(ultimaRaw).trim();

  return {
    bateria_raw: bateriaRaw,
    bateria_percentual: percentual,
    bateria_desatualizada: desatualizada,
    ultima_comunicacao: ultimaComunicacao,
  };
}

export type BateriaDdmxDia = {
  total: number;
  desatualizadas: number;
  media_percentual: number | null;
  despachos: DdmxBateriaDispatchItem[];
};

export function summarizeDdmxBateriaDia(items: DdmxBateriaDispatchItem[]): BateriaDdmxDia | null {
  if (items.length === 0) return null;

  const percentuais = items
    .map((item) => item.bateria_percentual)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return {
    total: items.length,
    desatualizadas: items.filter((item) => item.bateria_desatualizada).length,
    media_percentual:
      percentuais.length > 0
        ? Number((percentuais.reduce((sum, value) => sum + value, 0) / percentuais.length).toFixed(2))
        : null,
    despachos: items,
  };
}

const VARRICAO_SERVICOS = new Set(["VJ", "VL", "VP"]);

export function isVarricaoPlano(plano: string, parseSetorFn?: (setor: string) => { servico: string } | null): boolean {
  if (parseSetorFn) {
    const parsed = parseSetorFn(plano);
    if (parsed) return VARRICAO_SERVICOS.has(parsed.servico);
  }
  const upper = String(plano ?? "").toUpperCase();
  return /(VP|VJ|VL)\d{4}/.test(upper);
}
