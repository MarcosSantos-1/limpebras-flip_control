import { pool } from "../db.js";
import { listCronogramaSetores, type CronogramaSetorInfo } from "./cronograma.js";
import { normalizarSetor, SERVICO_POR_CODIGO, getFrequenciaDescricao } from "../constants/ipt.js";
import { parseDespachoColagem } from "./parseDespachoColagem.js";

/** dom..sab → tokens usados em cronograma_setores.dias_semana. */
const WEEKDAY_TOKEN = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;

export type StatusDia = "conforme" | "nao_despachado" | "fora_plano" | "zerado" | "nao_previsto";

export interface DespachoLinha {
  setor: string;
  subprefeitura: string | null; // sigla CV/JT/MG/ST
  tipo_servico: string;
  frequencia: string | null;
  turno: string | null;
  esperado: boolean;
  despachadoManual: boolean;
  despachosSelimp: number;
  percentual: number | null;
  status: StatusDia;
  veiculos: string[];
  proximaProgramacao: string | null;
}

export interface DespachosKpis {
  previstos: number;
  despachados: number;
  naoDespachados: number;
  foraPlano: number;
  zerados: number;
  cobertura: number;
}

export interface TendenciaDia {
  data: string; // dd/MM
  previstos: number;
  despachados: number;
  cobertura: number;
}

export interface DespachosFiltros {
  subprefeitura?: string; // sigla
  servico?: string; // código 2 letras
  turno?: string;
}

export interface DespachosResponse {
  dia: string;
  kpis: DespachosKpis;
  linhas: DespachoLinha[];
  tendencia14d: TendenciaDia[];
  turnos: string[];
}

function dateKeyToDate(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

function addDaysKey(key: string, delta: number): string {
  const d = dateKeyToDate(key);
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ddMM(key: string): string {
  const [, m, d] = key.split("-");
  return `${d}/${m}`;
}

/** Esperado naquele dia: escalonado = data na lista; fixo = dia da semana no padrão. */
function esperadoNoDia(info: CronogramaSetorInfo, dia: string, datasSet: Set<string>): boolean {
  if (info.modelo === "fixo") {
    const tok = WEEKDAY_TOKEN[dateKeyToDate(dia).getDay()];
    return Array.isArray(info.diasSemana) && info.diasSemana.includes(tok);
  }
  return datasSet.has(dia);
}

function proximaProgramacao(info: CronogramaSetorInfo, dia: string): string | null {
  if (info.modelo === "fixo") {
    if (!info.diasSemana || info.diasSemana.length === 0) return null;
    for (let i = 1; i <= 14; i++) {
      const k = addDaysKey(dia, i);
      if (info.diasSemana.includes(WEEKDAY_TOKEN[dateKeyToDate(k).getDay()])) return ddMM(k);
    }
    return null;
  }
  const futura = info.datas.find((d) => d > dia);
  return futura ? ddMM(futura) : null;
}

function tipoServicoLabel(info: CronogramaSetorInfo): string {
  return (info.servico && SERVICO_POR_CODIGO[info.servico]) || info.frequenciaTexto || info.servico || "—";
}

function statusDoDia(esperado: boolean, despachado: boolean, percentual: number | null): StatusDia {
  if (esperado && !despachado) return "nao_despachado";
  if (!esperado && despachado) return "fora_plano";
  if (despachado && percentual === 0) return "zerado";
  if (esperado && despachado) return "conforme";
  return "nao_previsto";
}

interface SelimpDia {
  count: number;
  pct: number | null;
  zeros: number;
}

/**
 * Monta a visão da página Despachos para um dia: cruza o cronograma (esperado),
 * os lançamentos de despachos_diarios (colagem/manual) e o Report SELIMP D-1
 * (ipt_report_linhas → percentual histórico).
 */
export async function buildDespachosResponse(
  dia: string,
  filtros: DespachosFiltros = {},
): Promise<DespachosResponse> {
  const rangeStart = addDaysKey(dia, -13);

  const setores = await listCronogramaSetores({
    subSigla: filtros.subprefeitura,
    servico: filtros.servico,
  });
  const setoresFiltrados = filtros.turno
    ? setores.filter((s) => (s.turno ?? "").toLowerCase() === filtros.turno!.toLowerCase())
    : setores;

  // Lançamentos manuais/colagem no intervalo (14 dias).
  const despRes = await pool.query<{ setor: string; data: string; status: string | null; veiculos: string[] | null }>(
    `SELECT setor, to_char(data, 'YYYY-MM-DD') AS data, status, veiculos
     FROM despachos_diarios
     WHERE data >= $1::date AND data <= $2::date`,
    [rangeStart, dia],
  );
  const despPorDia = new Map<string, Map<string, { status: string | null; veiculos: string[] }>>();
  for (const r of despRes.rows) {
    const setor = normalizarSetor(r.setor);
    if (!despPorDia.has(r.data)) despPorDia.set(r.data, new Map());
    despPorDia.get(r.data)!.set(setor, { status: r.status, veiculos: r.veiculos ?? [] });
  }

  // Report SELIMP (histórico) no intervalo, agregado por plano+dia.
  const selRes = await pool.query<{
    plano: string;
    data: string;
    c: number;
    pct: number | null;
    zeros: number;
  }>(
    `SELECT plano,
            to_char(data_estimada, 'YYYY-MM-DD') AS data,
            COUNT(*)::int AS c,
            AVG(percentual_execucao) AS pct,
            COUNT(*) FILTER (WHERE COALESCE(percentual_execucao, 0) <= 0)::int AS zeros
     FROM ipt_report_linhas
     WHERE data_estimada >= $1::date AND data_estimada <= $2::date
     GROUP BY plano, data_estimada`,
    [rangeStart, dia],
  );
  const selPorDia = new Map<string, Map<string, SelimpDia>>();
  for (const r of selRes.rows) {
    const setor = normalizarSetor(r.plano);
    if (!setor) continue;
    if (!selPorDia.has(r.data)) selPorDia.set(r.data, new Map());
    const m = selPorDia.get(r.data)!;
    const prev = m.get(setor);
    const pctVal = r.pct == null ? null : Number(r.pct) > 1 ? Number(r.pct) : Number(r.pct) * 100;
    if (!prev) {
      m.set(setor, { count: r.c, pct: pctVal, zeros: r.zeros });
    } else {
      prev.count += r.c;
      prev.zeros += r.zeros;
      if (pctVal != null) prev.pct = prev.pct == null ? pctVal : (prev.pct + pctVal) / 2;
    }
  }

  // Pré-calcula o Set de datas (escalonado) por setor para lookups rápidos.
  const datasSetPorSetor = new Map<string, Set<string>>();
  for (const s of setoresFiltrados) datasSetPorSetor.set(s.setor, new Set(s.datas));

  // --- Linhas do dia (só acionáveis: esperado OU despachado/SELIMP). ---
  const despDia = despPorDia.get(dia) ?? new Map();
  const selDia = selPorDia.get(dia) ?? new Map();
  const linhas: DespachoLinha[] = [];
  for (const s of setoresFiltrados) {
    const esperado = esperadoNoDia(s, dia, datasSetPorSetor.get(s.setor)!);
    const manual = despDia.get(s.setor);
    const sel = selDia.get(s.setor) as SelimpDia | undefined;
    const despachadoManual = !!manual && !/cancel|inativ/i.test(manual.status ?? "");
    const despachosSelimp = sel?.count ?? 0;
    const despachado = despachadoManual || despachosSelimp > 0;
    if (!esperado && !despachado) continue; // fora do recorte acionável

    const percentual = sel?.pct != null ? Math.round(sel.pct) : null;
    const status = statusDoDia(esperado, despachado, percentual);

    linhas.push({
      setor: s.setor,
      subprefeitura: s.subSigla,
      tipo_servico: tipoServicoLabel(s),
      frequencia: s.frequenciaTexto ?? (s.frequenciaCodigo ? getFrequenciaDescricao(s.frequenciaCodigo) : null),
      turno: s.turno,
      esperado,
      despachadoManual,
      despachosSelimp,
      percentual,
      status,
      veiculos: manual?.veiculos ?? [],
      proximaProgramacao: proximaProgramacao(s, dia),
    });
  }

  // Ordena: falhas primeiro (mais acionável).
  const ordem: Record<StatusDia, number> = {
    nao_despachado: 0,
    fora_plano: 1,
    zerado: 2,
    conforme: 3,
    nao_previsto: 4,
  };
  linhas.sort((a, b) => ordem[a.status] - ordem[b.status] || a.setor.localeCompare(b.setor));

  const previstos = linhas.filter((l) => l.esperado).length;
  const despachados = linhas.filter((l) => l.esperado && (l.despachadoManual || l.despachosSelimp > 0)).length;
  const kpis: DespachosKpis = {
    previstos,
    despachados,
    naoDespachados: linhas.filter((l) => l.status === "nao_despachado").length,
    foraPlano: linhas.filter((l) => l.status === "fora_plano").length,
    zerados: linhas.filter((l) => l.status === "zerado").length,
    cobertura: previstos > 0 ? Math.round((despachados / previstos) * 100) : 0,
  };

  // --- Tendência 14 dias ---
  const tendencia14d: TendenciaDia[] = [];
  for (let i = 13; i >= 0; i--) {
    const k = addDaysKey(dia, -i);
    const despK = despPorDia.get(k) ?? new Map();
    const selK = selPorDia.get(k) ?? new Map();
    let prev = 0;
    let desp = 0;
    for (const s of setoresFiltrados) {
      const esperado = esperadoNoDia(s, k, datasSetPorSetor.get(s.setor)!);
      if (!esperado) continue;
      prev += 1;
      const manual = despK.get(s.setor) as { status: string | null } | undefined;
      const despachadoManual = !!manual && !/cancel|inativ/i.test(manual.status ?? "");
      const sel = selK.get(s.setor) as SelimpDia | undefined;
      if (despachadoManual || (sel?.count ?? 0) > 0) desp += 1;
    }
    tendencia14d.push({
      data: ddMM(k),
      previstos: prev,
      despachados: desp,
      cobertura: prev > 0 ? Math.round((desp / prev) * 100) : 0,
    });
  }

  const turnos = Array.from(new Set(setores.map((s) => s.turno).filter((t): t is string => !!t))).sort();

  return { dia, kpis, linhas, tendencia14d, turnos };
}

export interface ColarDespachosResult {
  dia: string;
  extraidos: number;
  gravados: number;
  conforme: number; // esperado e despachado
  fora_plano: number; // despachado mas não esperado
  nao_despachado: number; // esperado e não despachado
  avisos: string[];
}

/**
 * Processa a colagem da SELIMP para um dia: extrai os setores despachados, cruza com o
 * cronograma e grava em despachos_diarios (upsert por setor+data).
 */
export async function colarDespachos(
  dia: string,
  texto: string,
  opts: { dryRun?: boolean } = {},
): Promise<ColarDespachosResult> {
  const parsed = parseDespachoColagem(texto);
  const avisos = [...parsed.avisos];

  // Cronograma para cruzar esperado e descobrir turno.
  const setores = await listCronogramaSetores({});
  const infoPorSetor = new Map(setores.map((s) => [s.setor, s]));
  const datasSetPorSetor = new Map(setores.map((s) => [s.setor, new Set(s.datas)]));

  let conforme = 0;
  let foraPlano = 0;
  const despachadosSet = new Set<string>();
  for (const reg of parsed.registros) {
    despachadosSet.add(reg.setor);
    const info = infoPorSetor.get(reg.setor);
    if (!info) {
      avisos.push(`Setor despachado fora do cronograma: ${reg.setor}.`);
      foraPlano++;
      continue;
    }
    if (esperadoNoDia(info, dia, datasSetPorSetor.get(reg.setor)!)) conforme++;
    else foraPlano++;
  }

  // Esperados no dia que não vieram na colagem.
  let naoDespachado = 0;
  for (const s of setores) {
    if (!esperadoNoDia(s, dia, datasSetPorSetor.get(s.setor)!)) continue;
    if (!despachadosSet.has(s.setor)) naoDespachado++;
  }

  let gravados = 0;
  if (!opts.dryRun && parsed.registros.length > 0) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const reg of parsed.registros) {
        const turno = infoPorSetor.get(reg.setor)?.turno ?? null;
        const res = await client.query(
          `INSERT INTO despachos_diarios
             (setor, data, turno, status, modelo, veiculos, data_planejada, data_maxima, origem, raw, updated_at)
           VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, 'selimp_colagem', $9::jsonb, NOW())
           ON CONFLICT (setor, data) DO UPDATE SET
             turno = EXCLUDED.turno,
             status = EXCLUDED.status,
             modelo = EXCLUDED.modelo,
             veiculos = EXCLUDED.veiculos,
             data_planejada = EXCLUDED.data_planejada,
             data_maxima = EXCLUDED.data_maxima,
             origem = 'selimp_colagem',
             raw = EXCLUDED.raw,
             updated_at = NOW()`,
          [
            reg.setor,
            dia,
            turno,
            reg.status,
            reg.modelo,
            reg.veiculos,
            reg.dataPlanejada,
            reg.dataMaxima,
            JSON.stringify(reg),
          ],
        );
        gravados += res.rowCount ?? 0;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      throw err;
    }
    client.release();
  }

  return {
    dia,
    extraidos: parsed.total,
    gravados: opts.dryRun ? 0 : gravados,
    conforme,
    fora_plano: foraPlano,
    nao_despachado: naoDespachado,
    avisos,
  };
}
