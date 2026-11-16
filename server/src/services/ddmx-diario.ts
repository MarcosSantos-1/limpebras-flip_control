import { pool } from "../db.js";
import { normalizarSetor, parseSetor, resolveTipoServicoExibicao } from "../constants/ipt.js";
import {
  chaveDataDdmx,
  extrairIntervaloDdmx,
  extrairPercentualDdmx,
  isServicoBolha,
  parseDataDdmx,
  percentualDoDia,
  servicoForaDoDespachoDdmx,
  type LinhaExecucaoDia,
} from "./ddmx-operacional.js";
import { parseDdmxBateriaFromRaw } from "./parseDdmxBateria.js";

/**
 * Agregação diária a partir só do DDMX (rastreador secundário).
 * Sem o report CLIMP, é a única fonte de % de execução por despacho:
 * 1 despacho = 1 plano num dia (maior linha DDMX do dia; bolha com regra de permanência).
 */

export type DdmxDespacho = {
  plano: string;
  servico: string;
  subprefeitura: string | null;
  data: string;
  percentual: number | null;
  bateriaPercentual: number | null;
  /** Leitura bruta do módulo (ex.: "11.2v") correspondente ao percentual. */
  bateriaRaw: string | null;
  /** Só desatualizada quando nenhuma linha do dia trouxe leitura válida. */
  bateriaDesatualizada: boolean;
  /** Maior "data última comunicação do módulo" vista no dia (texto DDMX). */
  ultimaComunicacao: string | null;
};

export type DdmxLinha = { setor: string | null; data_referencia: unknown; raw: Record<string, unknown> | null };

export function agruparDespachosDdmx(linhas: DdmxLinha[], inicio: string, fim: string): DdmxDespacho[] {
  type Acc = {
    plano: string;
    data: string;
    bolha: boolean;
    linhas: LinhaExecucaoDia[];
    bat: number | null;
    batRaw: string | null;
    valida: boolean;
    desat: boolean;
    ultima: string | null;
    ultimaTs: number;
  };
  const acc = new Map<string, Acc>();
  for (const row of linhas) {
    const raw = (row.raw ?? {}) as Record<string, unknown>;
    const rota = String(raw.rota ?? raw.plano ?? raw.setor ?? row.setor ?? "").trim();
    const plano = normalizarSetor(rota);
    if (!plano) continue;
    const sigla = parseSetor(plano)?.servico;
    if (servicoForaDoDespachoDdmx(sigla)) continue;
    const data = chaveDataDdmx(row.data_referencia, raw);
    if (!data || data < inicio || data > fim) continue;
    const key = `${plano}|${data}`;
    const cur: Acc = acc.get(key) ?? {
      plano,
      data,
      bolha: isServicoBolha(sigla),
      linhas: [],
      bat: null,
      batRaw: null,
      valida: false,
      desat: false,
      ultima: null,
      ultimaTs: -Infinity,
    };
    const pct = extrairPercentualDdmx(raw);
    const intervalo = extrairIntervaloDdmx(raw);
    cur.linhas.push({ percentual: pct != null ? Math.min(100, Math.max(0, pct)) : null, inicio: intervalo.inicio, fim: intervalo.fim });
    const bat = parseDdmxBateriaFromRaw(raw);
    if (bat.bateria_desatualizada) {
      cur.desat = true;
      // Linhas "fantasma" (início ---) não sobrescrevem uma leitura válida do dia.
      if (!cur.valida && bat.bateria_percentual != null && (cur.bat == null || bat.bateria_percentual > cur.bat)) {
        cur.bat = bat.bateria_percentual;
        cur.batRaw = bat.bateria_raw || null;
      }
    } else if (bat.bateria_percentual != null) {
      if (!cur.valida || cur.bat == null || bat.bateria_percentual > cur.bat) {
        cur.bat = bat.bateria_percentual;
        cur.batRaw = bat.bateria_raw || null;
      }
      cur.valida = true;
    }
    if (bat.ultima_comunicacao) {
      const ts = parseDataDdmx(bat.ultima_comunicacao)?.getTime() ?? -Infinity;
      if (ts >= cur.ultimaTs) {
        cur.ultimaTs = ts;
        cur.ultima = bat.ultima_comunicacao;
      }
    }
    acc.set(key, cur);
  }
  return [...acc.values()].map((a) => ({
    plano: a.plano,
    servico: servicoLabel(a.plano),
    subprefeitura: parseSetor(a.plano)?.sub ?? null,
    data: a.data,
    // Mesma regra do IPT Geral: maior linha do plano no dia; bolha aplica permanência.
    percentual: percentualDoDia(a.linhas, a.bolha),
    bateriaPercentual: a.bat,
    bateriaRaw: a.batRaw,
    bateriaDesatualizada: a.desat && !a.valida,
    ultimaComunicacao: a.ultima,
  }));
}

/**
 * Carrega os despachos DDMX do período. `planos` restringe às rotas informadas
 * (ex.: setores de módulos DDMX) — reduz bastante o volume lido.
 */
export async function carregarDespachosDdmx(inicio: string, fim: string, planos?: string[]): Promise<DdmxDespacho[]> {
  // Margem de 1 dia: data_referencia pode divergir da data de execução no raw.
  const filtroPlano = planos ? "AND UPPER(TRIM(raw->>'rota')) = ANY($3::text[])" : "";
  const sql = (t: string) =>
    `SELECT setor, data_referencia, raw FROM ${t}
      WHERE (data_referencia IS NULL OR (data_referencia >= $1::date - 1 AND data_referencia <= $2::date + 1))
      ${filtroPlano}`;
  const params: unknown[] = planos ? [inicio, fim, planos.map((p) => p.trim().toUpperCase())] : [inicio, fim];
  if (planos && planos.length === 0) return [];
  const linhas: DdmxLinha[] = [];
  for (const t of ["ipt_ddmx_varricao", "ipt_ddmx_veiculos"]) {
    try {
      const r = await pool.query<DdmxLinha>(sql(t), params);
      linhas.push(...r.rows);
    } catch {
      /* tabela ainda não criada */
    }
  }
  return agruparDespachosDdmx(linhas, inicio, fim);
}

export type DdmxPontoDia = {
  data: string;
  despachos: number;
  despachosComPercentual: number;
  zerados: number;
  percentualDia: number | null;
  percentualDiaSemZerados: number | null;
  percentualAcumulado: number | null;
  percentualAcumuladoSemZerados: number | null;
  despachosAcumulados: number;
  zeradosAcumulados: number;
  bateriaDesatualizada: number;
  planos: number;
};

const media = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const r2 = (v: number | null) => (v == null ? null : Number(v.toFixed(2)));

/** Série diária (com acumulado do período) — opcionalmente filtrada por serviço. */
export function serieDiariaDdmx(despachos: DdmxDespacho[], servico?: string): DdmxPontoDia[] {
  const lista = servico ? despachos.filter((d) => d.servico === servico) : despachos;
  const porDia = new Map<string, DdmxDespacho[]>();
  for (const d of lista) {
    const arr = porDia.get(d.data) ?? [];
    arr.push(d);
    porDia.set(d.data, arr);
  }
  const dias = [...porDia.keys()].sort();
  const accPct: number[] = [];
  const accPlanos = new Set<string>();
  let accDesp = 0;
  let accZer = 0;
  return dias.map((data) => {
    const itens = porDia.get(data)!;
    const pcts = itens.map((i) => i.percentual).filter((v): v is number => v != null);
    const zerados = pcts.filter((v) => v <= 0).length;
    accPct.push(...pcts);
    accDesp += itens.length;
    accZer += zerados;
    for (const i of itens) accPlanos.add(i.plano);
    return {
      data,
      despachos: itens.length,
      despachosComPercentual: pcts.length,
      zerados,
      percentualDia: r2(media(pcts)),
      percentualDiaSemZerados: r2(media(pcts.filter((v) => v > 0))),
      percentualAcumulado: r2(media(accPct)),
      percentualAcumuladoSemZerados: r2(media(accPct.filter((v) => v > 0))),
      despachosAcumulados: accDesp,
      zeradosAcumulados: accZer,
      bateriaDesatualizada: itens.filter((i) => i.bateriaDesatualizada).length,
      planos: accPlanos.size,
    };
  });
}

export type DdmxResumoServico = {
  servico: string;
  despachos: number;
  planos: number;
  percentual: number | null;
  percentualSemZerados: number | null;
  zerados: number;
  abaixo80: number;
};

export function resumoPorServicoDdmx(despachos: DdmxDespacho[]): DdmxResumoServico[] {
  const grupos = new Map<string, DdmxDespacho[]>();
  for (const d of despachos) {
    const arr = grupos.get(d.servico) ?? [];
    arr.push(d);
    grupos.set(d.servico, arr);
  }
  return [...grupos.entries()]
    .map(([servico, itens]) => {
      const pcts = itens.map((i) => i.percentual).filter((v): v is number => v != null);
      return {
        servico,
        despachos: itens.length,
        planos: new Set(itens.map((i) => i.plano)).size,
        percentual: r2(media(pcts)),
        percentualSemZerados: r2(media(pcts.filter((v) => v > 0))),
        zerados: pcts.filter((v) => v <= 0).length,
        abaixo80: pcts.filter((v) => v < 80).length,
      };
    })
    .sort((a, b) => b.despachos - a.despachos);
}

function servicoLabel(plano: string): string {
  const label = resolveTipoServicoExibicao(plano, "");
  if (label && label !== "—") return label;
  return parseSetor(plano)?.servico || "Não informado";
}
