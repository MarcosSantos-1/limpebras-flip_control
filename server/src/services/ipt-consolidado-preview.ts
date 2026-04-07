import type { PoolClient } from "pg";
import {
  normalizarSetor,
  compareSetores,
  parseSetor,
  getSubFromPlano,
  getTipoServicoCanonicoPlano,
  getFrequenciaDescricao,
} from "../constants/ipt.js";

const normalizeText = (value: string): string =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const normalizeModuleCode = (value: string): string =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();

function toDateKey(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getUTCFullYear();
    const m = String(parsed.getUTCMonth() + 1).padStart(2, "0");
    const d = String(parsed.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

type Escopo = "dia_anterior" | "periodo" | "todos";

export async function buildIptPreviewFromConsolidado(
  client: PoolClient,
  params: {
    escopo: Escopo;
    scopeStart: string | null;
    scopeEnd: string | null;
    subFilter?: string;
    yesterdayKey: string;
  }
): Promise<Record<string, unknown>> {
  const { escopo, scopeStart, scopeEnd, subFilter, yesterdayKey } = params;

  // --- Report SELIMP (ipt_report_linhas) ---
  let reportDateFilter = "";
  const rparams: unknown[] = [];
  if (escopo === "dia_anterior" && scopeStart) {
    rparams.push(scopeStart);
    reportDateFilter = ` AND data_estimada = $${rparams.length}::date`;
  } else if (escopo === "periodo" && scopeStart && scopeEnd) {
    rparams.push(scopeStart, scopeEnd);
    reportDateFilter = ` AND data_estimada >= $1::date AND data_estimada <= $2::date`;
  }
  const reportQuery = `SELECT plano, data_estimada, percentual_execucao, status, tipo_servico, frequencia, metodo_estimativa
     FROM ipt_report_linhas
     WHERE data_estimada IS NOT NULL
       AND LOWER(COALESCE(status, '')) LIKE '%encerrad%'
       ${reportDateFilter}
     ORDER BY plano, data_estimada`;

  // --- DDMX (novas tabelas dedicadas + fallback ipt_imports legado) ---
  const ddmxFileTypes = ["ipt_historico_os", "ipt_historico_os_varricao", "ipt_historico_os_compactadores"];
  let ddmxDateFilter = "";
  const dparams: unknown[] = [ddmxFileTypes];
  if (escopo === "dia_anterior" && scopeStart) {
    dparams.push(scopeStart);
    ddmxDateFilter = ` AND data_referencia = $${dparams.length}::date`;
  } else if (escopo === "periodo" && scopeStart && scopeEnd) {
    dparams.push(scopeStart, scopeEnd);
    ddmxDateFilter = ` AND data_referencia >= $2::date AND data_referencia <= $3::date`;
  }
  const ddmxLegacyQuery = `SELECT setor, data_referencia, raw, servico
     FROM ipt_imports
     WHERE file_type = ANY($1) ${ddmxDateFilter}
     ORDER BY setor, data_referencia`;

  let ddmxNewDateFilter = "";
  const newDateParams: unknown[] = [];
  if (escopo === "dia_anterior" && scopeStart) {
    newDateParams.push(scopeStart);
    ddmxNewDateFilter = ` AND data_referencia = $1::date`;
  } else if (escopo === "periodo" && scopeStart && scopeEnd) {
    newDateParams.push(scopeStart, scopeEnd);
    ddmxNewDateFilter = ` AND data_referencia >= $1::date AND data_referencia <= $2::date`;
  }
  const ddmxVarricaoQuery = `SELECT setor, data_referencia, raw, servico
     FROM ipt_ddmx_varricao
     WHERE TRUE ${ddmxNewDateFilter}
     ORDER BY setor, data_referencia`;
  const ddmxVeiculosQuery = `SELECT setor, data_referencia, raw, servico
     FROM ipt_ddmx_veiculos
     WHERE TRUE ${ddmxNewDateFilter}
     ORDER BY setor, data_referencia`;

  const [reportRes, ddmxLegacyRes, bateriaRows] = await Promise.all([
    client.query(reportQuery, rparams),
    client.query(ddmxLegacyQuery, dparams),
    client.query(
      `SELECT raw, updated_at
       FROM ipt_imports
       WHERE file_type = 'ipt_status_bateria'
       ORDER BY updated_at DESC`
    ),
  ]);

  type DdmxRow = {
    setor: string | null;
    data_referencia: string | Date | null;
    raw: Record<string, unknown>;
    servico: string | null;
  };
  let ddmxVarricaoRows: DdmxRow[] = [];
  let ddmxVeiculosRows: DdmxRow[] = [];
  try {
    const [vr, vv] = await Promise.all([
      client.query(ddmxVarricaoQuery, newDateParams),
      client.query(ddmxVeiculosQuery, newDateParams),
    ]);
    ddmxVarricaoRows = (vr.rows ?? []) as DdmxRow[];
    ddmxVeiculosRows = (vv.rows ?? []) as DdmxRow[];
  } catch {
    // Tabelas ipt_ddmx_* ainda nao criadas (migracao pendente) — usa so ipt_imports legado
  }

  const ddmxRows = [...ddmxVarricaoRows, ...ddmxVeiculosRows, ...(ddmxLegacyRes.rows ?? [])] as DdmxRow[];

  // --- Bateria ---
  const bateriaMap = new Map<
    string,
    { status_bateria: string; bateria?: string; data_ultima_comunicacao?: string; dias?: string }
  >();
  const bateriaResumoModulos: Array<{
    codigo: string;
    status_bateria: string;
    bateria?: string;
    data_ultima_comunicacao?: string;
    dias?: string;
    nivel: "critico" | "alerta" | "ok" | "desconhecido";
  }> = [];

  for (const row of (bateriaRows.rows ?? []) as Array<{ raw: Record<string, string> }>) {
    const raw = row.raw ?? {};
    const codigoOriginal = String(raw.placa ?? raw.nome ?? "").trim();
    const codigo = normalizeModuleCode(codigoOriginal);
    if (!codigo) continue;
    const statusBateria = String(raw.status_de_bateria ?? raw.status_bateria ?? raw.bateria ?? "").trim();
    const bateriaPct = String(raw.bateria ?? raw.percentual ?? raw.percentual_bateria ?? "").trim();
    const dataUltima = String(raw.data_de_ultima_comunicacao ?? raw.data_ultima_recarga ?? "").trim();
    const dias = String(raw.dias ?? "").trim();
    const info = {
      status_bateria: statusBateria || "—",
      bateria: bateriaPct || undefined,
      data_ultima_comunicacao: dataUltima || undefined,
      dias: dias || undefined,
    };
    bateriaMap.set(codigo, info);
    const pctNum = parseFloat(bateriaPct.replace(",", ".").replace("%", ""));
    let nivel: "critico" | "alerta" | "ok" | "desconhecido" = "desconhecido";
    if (!Number.isNaN(pctNum)) {
      if (pctNum < 20) nivel = "critico";
      else if (pctNum < 60) nivel = "alerta";
      else nivel = "ok";
    } else if (/critico|baixo|descarregad/i.test(statusBateria)) nivel = "critico";
    else if (/alerta|medio|aten/i.test(statusBateria)) nivel = "alerta";
    bateriaResumoModulos.push({
      codigo: codigoOriginal || codigo,
      status_bateria: info.status_bateria,
      bateria: info.bateria,
      data_ultima_comunicacao: info.data_ultima_comunicacao,
      dias: info.dias,
      nivel,
    });
  }

  // --- Estrutura por plano ---
  type Bucket = {
    selimp_sum: number;
    selimp_count: number;
    selimp_zero_count: number;
    nosso_sum: number;
    nosso_count: number;
    despachos_selimp: number;
    despachos_nosso: number;
    estimados: number;
  };

  type PlanoEntry = {
    plano: string;
    subprefeitura: string;
    tipo_servico: string;
    servico_sigla: string | null;
    turno: string | null;
    frequencia_codigo: string | null;
    frequencia: string | null;
    mapa: string | null;
    equipamentos: Set<string>;
    diario: Map<string, Bucket>;
  };

  const byPlano = new Map<string, PlanoEntry>();

  const getOrCreatePlano = (plano: string): PlanoEntry => {
    const parsed = parseSetor(plano);
    const existing = byPlano.get(plano);
    if (existing) return existing;
    const subFromPlano = parsed?.sub ?? getSubFromPlano(plano);
    const created: PlanoEntry = {
      plano,
      subprefeitura: subFromPlano,
      tipo_servico: "",
      servico_sigla: parsed?.servico ?? null,
      turno: parsed?.turno ?? null,
      frequencia_codigo: parsed?.frequencia ?? null,
      frequencia: parsed ? getFrequenciaDescricao(parsed.frequencia) : null,
      mapa: parsed?.mapa ?? null,
      equipamentos: new Set<string>(),
      diario: new Map<string, Bucket>(),
    };
    byPlano.set(plano, created);
    return created;
  };

  const ensureBucket = (planoEntry: PlanoEntry, dateKey: string): Bucket => {
    const current = planoEntry.diario.get(dateKey) ?? {
      selimp_sum: 0,
      selimp_count: 0,
      selimp_zero_count: 0,
      nosso_sum: 0,
      nosso_count: 0,
      despachos_selimp: 0,
      despachos_nosso: 0,
      estimados: 0,
    };
    planoEntry.diario.set(dateKey, current);
    return current;
  };

  // --- 1. Report SELIMP → percentual_selimp ---
  for (const row of (reportRes.rows ?? []) as Array<{
    plano: string;
    data_estimada: string | Date | null;
    percentual_execucao: number | null;
    status: string | null;
    tipo_servico: string | null;
    frequencia: string | null;
    metodo_estimativa: string | null;
  }>) {
    const plano = normalizarSetor(String(row.plano ?? "").trim());
    if (!plano) continue;
    const dateKey = toDateKey(row.data_estimada);
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;

    const planoEntry = getOrCreatePlano(plano);
    if (!planoEntry.tipo_servico && row.tipo_servico) planoEntry.tipo_servico = row.tipo_servico;

    const bucket = ensureBucket(planoEntry, dateKey);
    const pctRaw = Number(row.percentual_execucao);
    if (Number.isFinite(pctRaw)) {
      const pctVal = pctRaw > 1 ? pctRaw : pctRaw * 100;
      bucket.selimp_sum += pctVal;
      bucket.selimp_count += 1;
      bucket.despachos_selimp += 1;
      if (pctVal === 0) bucket.selimp_zero_count += 1;
    }
    if (row.metodo_estimativa && row.metodo_estimativa !== "cronograma" && row.metodo_estimativa !== "cronograma+cross_ref") {
      bucket.estimados += 1;
    }
  }

  // --- 2. DDMX → percentual_nosso (novas tabelas + legado, deduplicados pelo merge acima) ---
  for (const row of ddmxRows) {
    const rawData = row.raw ?? {};
    // DDMX: rota é o campo principal para o plano (ex: MG10101VP0001)
    const rotaOrSetor = String(rawData.rota ?? rawData.plano ?? rawData.setor ?? row.setor ?? "").trim();
    const plano = normalizarSetor(rotaOrSetor);
    if (!plano) continue;
    const dateKey = toDateKey(row.data_referencia);
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;

    const planoEntry = getOrCreatePlano(plano);

    // tipo_servico do DDMX
    if (!planoEntry.tipo_servico) {
      const tipoRaw = String(rawData.tipo_de_servico ?? rawData.tipo_servico ?? rawData.servico ?? row.servico ?? "").trim();
      if (tipoRaw) planoEntry.tipo_servico = tipoRaw;
    }

    // equipamentos/veiculos
    const placa = String(rawData.veiculo ?? rawData.placa ?? rawData.placa_liberada ?? "").trim();
    if (placa) planoEntry.equipamentos.add(normalizeModuleCode(placa));

    const bucket = ensureBucket(planoEntry, dateKey);

    // Extrai percentual do DDMX - tenta vários campos possíveis
    const pctCandidates = [
      rawData.percentual_execucao,
      rawData.percentual_de_execucao,
      rawData.percentual_conclusao,
      rawData.percentual,
      rawData.de_execucao,
    ];
    let pctNum: number | null = null;
    for (const candidate of pctCandidates) {
      if (candidate == null) continue;
      const cleaned = String(candidate).replace(",", ".").replace("%", "").trim();
      const n = Number(cleaned);
      if (Number.isFinite(n)) {
        pctNum = n;
        break;
      }
    }

    if (pctNum != null) {
      const pctVal = pctNum > 1 ? pctNum : pctNum * 100;
      bucket.nosso_sum += pctVal;
      bucket.nosso_count += 1;
      bucket.despachos_nosso += 1;
    } else {
      // Mesmo sem percentual, registra o despacho DDMX
      bucket.despachos_nosso += 1;
    }
  }

  // --- Montar resultado ---
  const rows = Array.from(byPlano.values())
    .map((item) => {
      const dates = Array.from(item.diario.keys()).sort((a, b) => a.localeCompare(b));
      const inScopeDates =
        escopo === "todos"
          ? dates
          : dates.filter((dateKey) => {
              if (!scopeStart || !scopeEnd) return true;
              return dateKey >= scopeStart && dateKey <= scopeEnd;
            });
      const considerDates = escopo === "todos" ? dates : inScopeDates;

      let sumSelimp = 0;
      let countSelimp = 0;
      let despachosSelimp = 0;
      let zeroCountSelimp = 0;
      let sumNosso = 0;
      let countNosso = 0;
      let despachosNosso = 0;
      let estimados = 0;

      const detalhes = considerDates
        .map((dateKey) => {
          const bucket = item.diario.get(dateKey);
          if (!bucket) return null;
          const percentualSelimp =
            bucket.selimp_count > 0 ? Number((bucket.selimp_sum / bucket.selimp_count).toFixed(2)) : null;
          const percentualNosso =
            bucket.nosso_count > 0 ? Number((bucket.nosso_sum / bucket.nosso_count).toFixed(2)) : null;
          sumSelimp += bucket.selimp_sum;
          countSelimp += bucket.selimp_count;
          despachosSelimp += bucket.despachos_selimp;
          zeroCountSelimp += bucket.selimp_zero_count;
          sumNosso += bucket.nosso_sum;
          countNosso += bucket.nosso_count;
          despachosNosso += bucket.despachos_nosso;
          estimados += bucket.estimados;
          return {
            data: dateKey,
            esperado: false,
            percentual_selimp: percentualSelimp,
            percentual_nosso: percentualNosso,
            despachos_selimp: bucket.despachos_selimp,
            despachos_nosso: bucket.despachos_nosso,
            data_estimada: false,
          };
        })
        .filter((d): d is NonNullable<typeof d> => d != null)
        .sort((a, b) => b.data.localeCompare(a.data));

      const percentualSelimp = countSelimp > 0 ? Number((sumSelimp / countSelimp).toFixed(2)) : null;
      const percentualNosso = countNosso > 0 ? Number((sumNosso / countNosso).toFixed(2)) : null;
      const origem =
        despachosSelimp > 0 && despachosNosso > 0
          ? "ambos"
          : despachosSelimp > 0
          ? "somente_selimp"
          : despachosNosso > 0
          ? "somente_nosso"
          : "sem_despacho";

      let mostrar = true;
      if (escopo === "dia_anterior" || escopo === "periodo") {
        mostrar = despachosSelimp > 0 || despachosNosso > 0;
      }

      if (!mostrar) return null;

      const fromPlano = getTipoServicoCanonicoPlano(item.plano);
      const tipoServicoFinal =
        fromPlano ||
        (item.tipo_servico && !/n[aã]o\s*informado/i.test(item.tipo_servico) ? item.tipo_servico : "—");

      return {
        plano: item.plano,
        subprefeitura: item.subprefeitura || "—",
        tipo_servico: tipoServicoFinal,
        servico_sigla: item.servico_sigla,
        turno: item.turno,
        frequencia_codigo: item.frequencia_codigo,
        frequencia: item.frequencia,
        mapa: item.mapa,
        percentual_selimp: percentualSelimp,
        percentual_nosso: percentualNosso,
        despachos_selimp: despachosSelimp,
        despachos_nosso: despachosNosso,
        origem,
        raw_selimp_sum: sumSelimp,
        raw_selimp_count: countSelimp,
        raw_selimp_nonzero_count: countSelimp - zeroCountSelimp,
        equipamentos: Array.from(item.equipamentos),
        bateria_por_equipamento: Object.fromEntries(
          Array.from(item.equipamentos)
            .map((codigo) => {
              const info = bateriaMap.get(normalizeModuleCode(codigo));
              return info ? [codigo, info] : null;
            })
            .filter((x): x is [string, { status_bateria: string; bateria?: string }] => x != null)
        ),
        proxima_programacao: null as string | null,
        cronograma_preview: [] as string[],
        data_estimativa_count: estimados,
        detalhes_diarios: detalhes,
        _fonte_preview: origem === "ambos" ? "report+ddmx" : despachosSelimp > 0 ? "report" : "ddmx",
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null)
    .sort((a, b) => compareSetores(a.plano, b.plano, "asc"));

  // --- Enriquecer com cronograma (proxima_programacao + cronograma_preview) ---
  if (rows.length > 0) {
    const allSetores = rows.map((r) => r.plano);
    const allSetoresNorm = rows.map((r) => normalizarSetor(r.plano));
    const cronRes = await client.query<{ setor: string; data_esperada: string }>(
      `SELECT setor, to_char(data_esperada, 'YYYY-MM-DD') AS data_esperada
       FROM ipt_cronograma
       WHERE TRIM(setor) = ANY($1) OR TRIM(setor) = ANY($2)
       ORDER BY setor, data_esperada`,
      [allSetores, allSetoresNorm]
    );

    const cronMap = new Map<string, string[]>();
    for (const cr of cronRes.rows) {
      const key = normalizarSetor(cr.setor.trim());
      if (!cronMap.has(key)) cronMap.set(key, []);
      cronMap.get(key)!.push(cr.data_esperada);
    }

    const today = yesterdayKey;
    for (const row of rows) {
      const key = normalizarSetor(row.plano);
      const allDates = cronMap.get(key);
      if (!allDates || allDates.length === 0) continue;

      const sorted = [...new Set(allDates)].sort();
      const pastOrToday = sorted.filter((d) => d <= today);
      const future = sorted.filter((d) => d > today);

      const recentIdx = pastOrToday.length > 0 ? pastOrToday.length - 1 : -1;
      const previousIdx = recentIdx > 0 ? recentIdx - 1 : -1;

      const preview: string[] = [];
      if (previousIdx >= 0) preview.push(pastOrToday[previousIdx]);
      if (recentIdx >= 0) preview.push(pastOrToday[recentIdx]);
      for (let i = 0; i < 3 && i < future.length; i++) {
        preview.push(future[i]);
      }
      if (preview.length < 5 && recentIdx < 0 && future.length > 3) {
        preview.push(future[3]);
      }

      row.cronograma_preview = preview;
      row.proxima_programacao = future.length > 0 ? future[0] : null;
    }
  }

  let rowsFiltered = rows;
  if (subFilter && subFilter.trim() !== "" && subFilter.toLowerCase() !== "all") {
    const subFilterNorm = normalizeText(subFilter).replace(/[^a-z]/g, "");
    rowsFiltered = rows.filter((r) => {
      const subNorm = normalizeText(r.subprefeitura || "").replace(/[^a-z]/g, "");
      const sigla = getSubFromPlano(r.plano);
      return (
        subNorm === subFilterNorm ||
        subNorm.includes(subFilterNorm) ||
        subFilterNorm.includes(subNorm) ||
        sigla.toUpperCase() === subFilter.toUpperCase() ||
        r.subprefeitura === subFilter
      );
    });
  }

  const totalDespachosSelimp = rowsFiltered.reduce((acc, r) => acc + r.despachos_selimp, 0);
  const totalDespachosNosso = rowsFiltered.reduce((acc, r) => acc + r.despachos_nosso, 0);
  const totalRawSelimpSum = rowsFiltered.reduce((acc, r) => acc + r.raw_selimp_sum, 0);
  const totalRawSelimpCount = rowsFiltered.reduce((acc, r) => acc + r.raw_selimp_count, 0);
  const totalRawSelimpNonzeroCount = rowsFiltered.reduce((acc, r) => acc + r.raw_selimp_nonzero_count, 0);
  const iptMedioSelimp =
    totalRawSelimpCount > 0 ? Number((totalRawSelimpSum / totalRawSelimpCount).toFixed(2)) : null;
  const iptMedioSelimpSemZerados =
    totalRawSelimpNonzeroCount > 0 ? Number((totalRawSelimpSum / totalRawSelimpNonzeroCount).toFixed(2)) : null;
  const planosDespachadosSelimp = rowsFiltered.filter((r) => r.despachos_selimp > 0).length;
  const ddmxSumPond = rowsFiltered.reduce((acc, r) => {
    if (r.percentual_nosso != null && r.despachos_nosso > 0)
      return acc + r.percentual_nosso * r.despachos_nosso;
    return acc;
  }, 0);
  const ddmxCountPond = rowsFiltered.reduce(
    (acc, r) => (r.percentual_nosso != null && r.despachos_nosso > 0 ? acc + r.despachos_nosso : acc),
    0
  );
  const percentualMedioDdmx =
    ddmxCountPond > 0 ? Number((ddmxSumPond / ddmxCountPond).toFixed(2)) : null;

  const legacySubMap = new Map<string, { quantidade: number; despachoSum: number; despachoCount: number; despachoNonzeroCount: number }>();
  const legacyServMap = new Map<string, { quantidade: number; despachoSum: number; despachoCount: number; despachoNonzeroCount: number }>();
  for (const r of rowsFiltered) {
    const subKey = r.subprefeitura || "Não informado";
    const subAgg = legacySubMap.get(subKey) ?? { quantidade: 0, despachoSum: 0, despachoCount: 0, despachoNonzeroCount: 0 };
    subAgg.quantidade += 1;
    subAgg.despachoSum += r.raw_selimp_sum;
    subAgg.despachoCount += r.raw_selimp_count;
    subAgg.despachoNonzeroCount += r.raw_selimp_nonzero_count;
    legacySubMap.set(subKey, subAgg);

    const srvKey = r.tipo_servico || "Não informado";
    const srvAgg = legacyServMap.get(srvKey) ?? { quantidade: 0, despachoSum: 0, despachoCount: 0, despachoNonzeroCount: 0 };
    srvAgg.quantidade += 1;
    srvAgg.despachoSum += r.raw_selimp_sum;
    srvAgg.despachoCount += r.raw_selimp_count;
    srvAgg.despachoNonzeroCount += r.raw_selimp_nonzero_count;
    legacyServMap.set(srvKey, srvAgg);
  }
  const subprefeituras = Array.from(legacySubMap.entries()).map(([subprefeitura, v]) => ({
    subprefeitura,
    quantidade_planos: v.quantidade,
    media_execucao: v.despachoCount > 0 ? Number((v.despachoSum / v.despachoCount).toFixed(2)) : null,
    media_sem_zerados: v.despachoNonzeroCount > 0 ? Number((v.despachoSum / v.despachoNonzeroCount).toFixed(2)) : null,
    total_despachos: v.despachoCount,
    despachos_zerados: v.despachoCount - v.despachoNonzeroCount,
  }));
  const servicos = Array.from(legacyServMap.entries()).map(([tipo_servico, v]) => ({
    tipo_servico,
    quantidade_planos: v.quantidade,
    media_execucao: v.despachoCount > 0 ? Number((v.despachoSum / v.despachoCount).toFixed(2)) : null,
    media_sem_zerados: v.despachoNonzeroCount > 0 ? Number((v.despachoSum / v.despachoNonzeroCount).toFixed(2)) : null,
    total_despachos: v.despachoCount,
    despachos_zerados: v.despachoCount - v.despachoNonzeroCount,
  }));

  const mesclados = rowsFiltered.map((r) => ({
    plano: r.plano,
    subprefeitura: r.subprefeitura,
    tipo_servico: r.tipo_servico,
    status_execucao: r.despachos_selimp > 0 ? "Despachado" : "Não despachado",
    percentual_execucao: r.percentual_selimp,
    equipamentos: r.equipamentos,
    modulos_status: [] as Array<Record<string, unknown>>,
    plano_ativo: r.despachos_selimp > 0 || r.despachos_nosso > 0,
    sem_status_bateria: false,
    atualizado_em: new Date().toISOString(),
  }));

  const comparativoItens = rowsFiltered.map((r) => ({
    plano: r.plano,
    subprefeitura: r.subprefeitura,
    tipo_servico: r.tipo_servico,
    percentual_selimp: r.percentual_selimp,
    percentual_nosso: r.percentual_nosso,
    diferenca_percentual:
      r.percentual_selimp != null && r.percentual_nosso != null
        ? Number((r.percentual_selimp - r.percentual_nosso).toFixed(2))
        : null,
    origem: r.origem,
    turno: r.turno,
    frequencia: r.frequencia,
    despachos_selimp: r.despachos_selimp,
    raw_selimp_sum: r.raw_selimp_sum,
    raw_selimp_count: r.raw_selimp_count,
    raw_selimp_nonzero_count: r.raw_selimp_nonzero_count,
  }));
  const divergencias = comparativoItens.filter(
    (r) => Math.abs((r.percentual_selimp ?? 0) - (r.percentual_nosso ?? 0)) >= 5
  ).length;
  const somenteSelimp = comparativoItens.filter((r) => r.origem === "somente_selimp").length;
  const somenteNosso = comparativoItens.filter((r) => r.origem === "somente_nosso").length;

  return {
    periodo: {
      inicial: escopo === "todos" ? null : scopeStart,
      final: escopo === "todos" ? null : scopeEnd,
      escopo,
      data_referencia_padrao: yesterdayKey,
    },
    resumo: {
      total_planos: rowsFiltered.length,
      total_planos_despachados: planosDespachadosSelimp,
      total_planos_ativos: rowsFiltered.filter((r) => r.despachos_selimp > 0 || r.despachos_nosso > 0).length,
      media_execucao_planos_ativos: iptMedioSelimp,
      media_com_zerados: iptMedioSelimp,
      media_sem_zerados: iptMedioSelimpSemZerados,
      percentual_medio_ddmx: percentualMedioDdmx,
      total_modulos_relacionados: rowsFiltered.reduce((acc, r) => acc + r.equipamentos.length, 0),
      total_modulos_ativos: rowsFiltered.reduce((acc, r) => acc + r.equipamentos.length, 0),
      total_modulos_inativos: 0,
      sem_status_bateria: rowsFiltered.filter((r) => r.equipamentos.length === 0).length,
      comunicacao_off: 0,
      bateria_critica: 0,
      bateria_alerta: 0,
      total_setores: rowsFiltered.length,
      total_despachos_selimp: totalDespachosSelimp,
      total_despachos_nosso: totalDespachosNosso,
      total_despachos_zerados: totalRawSelimpCount - totalRawSelimpNonzeroCount,
      ipt_soma_percentuais: Number(totalRawSelimpSum.toFixed(2)),
      ipt_media_percentual: iptMedioSelimp,
    },
    subprefeituras,
    servicos,
    mesclados,
    comparativo: {
      total_linhas: comparativoItens.length,
      divergencias,
      somente_selimp: somenteSelimp,
      somente_nosso: somenteNosso,
      itens: comparativoItens,
    },
    itens: rowsFiltered,
    bateria_resumo: {
      total: bateriaResumoModulos.length,
      criticos: bateriaResumoModulos.filter((m) => m.nivel === "critico").length,
      alerta: bateriaResumoModulos.filter((m) => m.nivel === "alerta").length,
      ok: bateriaResumoModulos.filter((m) => m.nivel === "ok").length,
      modulos: bateriaResumoModulos,
    },
    preview_fonte: "report+ddmx",
  };
}
