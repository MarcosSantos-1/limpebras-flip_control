import { pool } from "../db.js";
import { listCronogramaSetores, type CronogramaSetorInfo } from "./cronograma.js";
import { normalizarSetor, SERVICO_POR_CODIGO, getFrequenciaDescricao, parseSetor } from "../constants/ipt.js";
import { parseDespachoColagem } from "./parseDespachoColagem.js";

/** dom..sab → tokens usados em cronograma_setores.dias_semana. */
const WEEKDAY_TOKEN = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;

/** 3º dígito do setor → turno (1=Diurno, 2=Vespertino, 3=Noturno). */
const TURNO_POR_DIGITO: Record<string, string> = { "1": "Diurno", "2": "Vespertino", "3": "Noturno" };

/** Deriva o turno pela nomenclatura do setor (quando não está no cronograma). */
function turnoPelaNomenclatura(setor: string): string | null {
  const p = parseSetor(setor);
  return p ? (TURNO_POR_DIGITO[p.turno] ?? null) : null;
}

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

/** "Diurno/Vespertino" é tratado como "Diurno" (turno único). */
function normalizeTurno(turno: string | null): string | null {
  if (!turno) return turno;
  if (/diurno\s*\/\s*vespertino/i.test(turno)) return "Diurno";
  return turno;
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
    ? setores.filter((s) => (normalizeTurno(s.turno) ?? "").toLowerCase() === filtros.turno!.toLowerCase())
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
      turno: normalizeTurno(s.turno),
      esperado,
      despachadoManual,
      despachosSelimp,
      percentual,
      status,
      veiculos: manual?.veiculos ?? [],
      proximaProgramacao: proximaProgramacao(s, dia),
    });
  }

  // --- Fora do plano: setores DESPACHADOS (colagem) que NÃO existem no cronograma. ---
  // Eles são salvos em despachos_diarios mas o laço acima só percorre o cronograma, então
  // sumiam da tela/KPIs. Aqui derivamos serviço, sub e turno pela própria nomenclatura do setor.
  const cronSet = new Set(setores.map((s) => s.setor));
  for (const [setor, manual] of despDia as Map<string, { status: string | null; veiculos: string[] }>) {
    if (cronSet.has(setor)) continue; // já tratado no laço do cronograma
    if (/cancel|inativ/i.test(manual.status ?? "")) continue;
    const parsed = parseSetor(setor);
    if (!parsed) continue;
    const turnoTxt = TURNO_POR_DIGITO[parsed.turno] ?? null;
    // Respeita filtros explícitos (quando chamado com sub/turno).
    if (filtros.subprefeitura && parsed.sub !== filtros.subprefeitura) continue;
    if (filtros.turno && (turnoTxt ?? "").toLowerCase() !== filtros.turno.toLowerCase()) continue;
    const sel = selDia.get(setor) as SelimpDia | undefined;
    linhas.push({
      setor,
      subprefeitura: parsed.sub,
      tipo_servico: SERVICO_POR_CODIGO[parsed.servico] ?? parsed.servico,
      frequencia: getFrequenciaDescricao(parsed.frequencia) || null,
      turno: turnoTxt,
      esperado: false,
      despachadoManual: true,
      despachosSelimp: sel?.count ?? 0,
      percentual: sel?.pct != null ? Math.round(sel.pct) : null,
      status: "fora_plano",
      veiculos: manual.veiculos ?? [],
      proximaProgramacao: null,
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

  const turnos = Array.from(
    new Set(setores.map((s) => normalizeTurno(s.turno)).filter((t): t is string => !!t)),
  ).sort();

  return { dia, kpis, linhas, tendencia14d, turnos };
}

export interface ColarDespachoItem {
  setor: string;
  subprefeitura: string | null;
  tipo_servico: string;
  turno: string | null;
  status: string | null;
  // colado esperado x colado inesperado; "descartado" = status não-despachável (cancelado/inativo)
  situacao: "conforme" | "fora_plano" | "descartado";
  motivoDescarte: string | null; // "Cancelado" | "Inativo" quando situacao === "descartado"
  dataPlanejada: string | null;
  veiculos: number;
}

/**
 * Status da SELIMP que NÃO devem virar despacho na colagem:
 *  - Cancelado: serviço cancelado — mostra como feedback, mas não grava nem cobre o setor.
 *  - Inativo: setor que começa em outro turno — deixar o outro turno despachar.
 * Os demais (Ativo, Encerrado, Pendente, etc.) são despacháveis.
 */
function statusDescartado(status: string | null): "Cancelado" | "Inativo" | null {
  const s = (status ?? "").toLowerCase();
  if (/cancel/.test(s)) return "Cancelado";
  if (/inativ/.test(s)) return "Inativo";
  return null;
}

export interface ColarTurnoResumo {
  turno: string; // "Diurno" | "Vespertino" | "Noturno" | "Sem turno"
  previstos: number; // esperados no dia
  despachados: number; // esperados que vieram na colagem
  faltam: number; // previstos - despachados
}

export interface ColarDespachosResult {
  dia: string;
  extraidos: number;
  despachaveis: number; // extraídos com status despachável (o que será gravado)
  descartados: number; // cancelados/inativos: mostrados como feedback, não gravados
  gravados: number;
  conforme: number; // esperado e despachado
  fora_plano: number; // despachado mas não esperado
  nao_despachado: number; // esperado e não despachado
  avisos: string[];
  itens: ColarDespachoItem[]; // cada despacho colado, separado
  porTurno: ColarTurnoResumo[]; // previstos x despachados x faltam por turno
}

const ORDEM_TURNO: Record<string, number> = { Diurno: 0, Vespertino: 1, Noturno: 2 };

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
  let descartados = 0;
  const despachadosSet = new Set<string>();
  const itens: ColarDespachoItem[] = [];
  for (const reg of parsed.registros) {
    const info = infoPorSetor.get(reg.setor);
    const esperado = info ? esperadoNoDia(info, dia, datasSetPorSetor.get(reg.setor)!) : false;
    const descarte = statusDescartado(reg.status);

    if (descarte) {
      // Cancelado/Inativo: feedback ao usuário, mas NÃO grava nem cobre o setor.
      descartados++;
      itens.push({
        setor: reg.setor,
        subprefeitura: info?.subSigla ?? null,
        tipo_servico: info ? tipoServicoLabel(info) : "—",
        turno: normalizeTurno(info?.turno ?? null),
        status: reg.status,
        situacao: "descartado",
        motivoDescarte: descarte,
        dataPlanejada: reg.dataPlanejada,
        veiculos: reg.veiculos.length,
      });
      continue;
    }

    despachadosSet.add(reg.setor);
    if (!info) {
      avisos.push(`Setor despachado fora do cronograma: ${reg.setor}.`);
      foraPlano++;
    } else if (esperado) {
      conforme++;
    } else {
      foraPlano++;
    }
    itens.push({
      setor: reg.setor,
      subprefeitura: info?.subSigla ?? null,
      tipo_servico: info ? tipoServicoLabel(info) : "—",
      turno: normalizeTurno(info?.turno ?? null),
      status: reg.status,
      situacao: esperado ? "conforme" : "fora_plano",
      motivoDescarte: null,
      dataPlanejada: reg.dataPlanejada,
      veiculos: reg.veiculos.length,
    });
  }
  // Ordena: fora do plano primeiro (mais acionável), depois conforme, descartados por último.
  const ordemSituacao: Record<ColarDespachoItem["situacao"], number> = {
    fora_plano: 0,
    conforme: 1,
    descartado: 2,
  };
  itens.sort(
    (a, b) => ordemSituacao[a.situacao] - ordemSituacao[b.situacao] || a.setor.localeCompare(b.setor),
  );

  // Despachos JÁ SALVOS no dia (de colagens anteriores) contam como cobertos —
  // senão um turno que já foi adicionado apareceria como "faltante" no resumo.
  const jaSalvosRes = await pool.query<{ setor: string }>(
    `SELECT DISTINCT setor FROM despachos_diarios
     WHERE data = $1::date AND (status IS NULL OR status !~* 'cancel|inativ')`,
    [dia],
  );
  const cobertos = new Set<string>(despachadosSet);
  for (const r of jaSalvosRes.rows) cobertos.add(normalizarSetor(r.setor));

  // Esperados no dia que não estão cobertos (colagem atual + já salvos) + resumo por turno.
  let naoDespachado = 0;
  const turnoMap = new Map<string, { previstos: number; despachados: number }>();
  for (const s of setores) {
    if (!esperadoNoDia(s, dia, datasSetPorSetor.get(s.setor)!)) continue;
    const despachado = cobertos.has(s.setor);
    if (!despachado) naoDespachado++;
    const turno = normalizeTurno(s.turno) ?? "Sem turno";
    const bucket = turnoMap.get(turno) ?? { previstos: 0, despachados: 0 };
    bucket.previstos++;
    if (despachado) bucket.despachados++;
    turnoMap.set(turno, bucket);
  }
  const porTurno: ColarTurnoResumo[] = Array.from(turnoMap.entries())
    .map(([turno, v]) => ({ turno, previstos: v.previstos, despachados: v.despachados, faltam: v.previstos - v.despachados }))
    .sort((a, b) => (ORDEM_TURNO[a.turno] ?? 99) - (ORDEM_TURNO[b.turno] ?? 99) || a.turno.localeCompare(b.turno));

  // Só grava registros despacháveis (exclui Cancelado/Inativo).
  const despachaveisRegs = parsed.registros.filter((reg) => !statusDescartado(reg.status));

  let gravados = 0;
  if (!opts.dryRun && despachaveisRegs.length > 0) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const reg of despachaveisRegs) {
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
    despachaveis: despachaveisRegs.length,
    descartados,
    gravados: opts.dryRun ? 0 : gravados,
    conforme,
    fora_plano: foraPlano,
    nao_despachado: naoDespachado,
    avisos,
    itens,
    porTurno,
  };
}

export interface DespacharManualResult {
  dia: string;
  gravados: number;
  setores: string[];
}

/**
 * Despacho manual de uma seleção de setores para um dia. Grava em despachos_diarios
 * (origem 'manual'), derivando o turno do cronograma ou da nomenclatura do setor.
 * Em conflito (já despachado) preserva veículos/datas existentes — só reforça o status.
 */
export async function despacharManual(dia: string, setores: string[]): Promise<DespacharManualResult> {
  const limpos = Array.from(new Set((setores ?? []).map((s) => normalizarSetor(s)).filter(Boolean)));
  if (limpos.length === 0) return { dia, gravados: 0, setores: [] };

  const cron = await listCronogramaSetores({});
  const turnoPorSetor = new Map(cron.map((s) => [s.setor, normalizeTurno(s.turno)]));

  const client = await pool.connect();
  let gravados = 0;
  try {
    await client.query("BEGIN");
    for (const setor of limpos) {
      const turno = turnoPorSetor.get(setor) ?? turnoPelaNomenclatura(setor);
      const res = await client.query(
        `INSERT INTO despachos_diarios
           (setor, data, turno, status, modelo, veiculos, data_planejada, data_maxima, origem, raw, updated_at)
         VALUES ($1, $2::date, $3, 'Despacho manual', NULL, ARRAY[]::text[], NULL, NULL, 'manual', $4::jsonb, NOW())
         ON CONFLICT (setor, data) DO UPDATE SET
           status = 'Despacho manual',
           origem = 'manual',
           turno = COALESCE(despachos_diarios.turno, EXCLUDED.turno),
           updated_at = NOW()`,
        [setor, dia, turno, JSON.stringify({ origem: "manual", despachado_em: new Date().toISOString() })],
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
  return { dia, gravados, setores: limpos };
}
