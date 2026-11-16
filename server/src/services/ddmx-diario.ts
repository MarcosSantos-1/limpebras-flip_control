import { pool } from "../db.js";
import { normalizarSetor, parseSetor, resolveTipoServicoExibicao } from "../constants/ipt.js";
import { chaveDataDdmx, extrairPercentualDdmx, servicoForaDoDespachoDdmx } from "./ddmx-operacional.js";
import { parseDdmxBateriaFromRaw } from "./parseDdmxBateria.js";

/**
 * Agregação diária a partir só do DDMX (rastreador secundário).
 * Sem o report CLIMP, é a única fonte de % de execução por despacho:
 * 1 despacho = 1 plano num dia (média das linhas DDMX daquele plano/dia).
 */

export type DdmxDespacho = {
  plano: string;
  servico: string;
  subprefeitura: string | null;
  data: string;
  percentual: number | null;
  bateriaPercentual: number | null;
  bateriaDesatualizada: boolean;
};

export type DdmxLinha = { setor: string | null; data_referencia: unknown; raw: Record<string, unknown> | null };

export function agruparDespachosDdmx(linhas: DdmxLinha[], inicio: string, fim: string): DdmxDespacho[] {
  const acc = new Map<string, { plano: string; data: string; sum: number; count: number; bat: number | null; desat: boolean }>();
  for (const row of linhas) {
    const raw = (row.raw ?? {}) as Record<string, unknown>;
    const rota = String(raw.rota ?? raw.plano ?? raw.setor ?? row.setor ?? "").trim();
    const plano = normalizarSetor(rota);
    if (!plano) continue;
    if (servicoForaDoDespachoDdmx(parseSetor(plano)?.servico)) continue;
    const data = chaveDataDdmx(row.data_referencia, raw);
    if (!data || data < inicio || data > fim) continue;
    const key = `${plano}|${data}`;
    const cur = acc.get(key) ?? { plano, data, sum: 0, count: 0, bat: null, desat: false };
    const pct = extrairPercentualDdmx(raw);
    if (pct != null) {
      cur.sum += Math.min(100, Math.max(0, pct));
      cur.count += 1;
    }
    const bat = parseDdmxBateriaFromRaw(raw);
    if (bat.bateria_percentual != null) cur.bat = Math.max(cur.bat ?? 0, bat.bateria_percentual);
    if (bat.bateria_desatualizada) cur.desat = true;
    acc.set(key, cur);
  }
  return [...acc.values()].map((a) => ({
    plano: a.plano,
    servico: servicoLabel(a.plano),
    subprefeitura: parseSetor(a.plano)?.sub ?? null,
    data: a.data,
    percentual: a.count > 0 ? a.sum / a.count : null,
    bateriaPercentual: a.bat,
    bateriaDesatualizada: a.desat,
  }));
}

export async function carregarDespachosDdmx(inicio: string, fim: string): Promise<DdmxDespacho[]> {
  // Margem de 1 dia: data_referencia pode divergir da data de execução no raw.
  const sql = (t: string) =>
    `SELECT setor, data_referencia, raw FROM ${t}
      WHERE data_referencia IS NULL OR (data_referencia >= $1::date - 1 AND data_referencia <= $2::date + 1)`;
  const linhas: DdmxLinha[] = [];
  for (const t of ["ipt_ddmx_varricao", "ipt_ddmx_veiculos"]) {
    try {
      const r = await pool.query<DdmxLinha>(sql(t), [inicio, fim]);
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
