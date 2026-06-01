import type { PoolClient } from "pg";
import {
  normalizarSetor,
  compareSetores,
  parseSetor,
  getSubFromPlano,
  resolveTipoServicoExibicao,
  getFrequenciaDescricao,
  generateFrequencyDates,
  isFrequencyDate,
  findNextExpectedByFrequency,
  parseDateKeyLocal,
  registerVpCanonicalFromSelimp,
  resolveVpCanonicalFromDdmx,
} from "../constants/ipt.js";
import { calcularCenariosIPT } from "./ipt-pf-algoritmo.js";

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

function isFullMonthPeriod(inicio: string | null, fim: string | null): { ano: number; mes: number } | null {
  if (!inicio || !fim) return null;
  const match = inicio.match(/^(\d{4})-(\d{2})-01$/);
  if (!match) return null;
  const ano = Number(match[1]);
  const mes = Number(match[2]);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const fimEsperado = `${ano}-${String(mes).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;
  return fim === fimEsperado ? { ano, mes } : null;
}

async function getIptOficialMensal(client: PoolClient, inicio: string | null, fim: string | null): Promise<number | null> {
  const periodo = isFullMonthPeriod(inicio, fim);
  if (!periodo) return null;
  const res = await client.query(`SELECT percentual FROM ipt_oficial_mensal WHERE ano = $1 AND mes = $2`, [
    periodo.ano,
    periodo.mes,
  ]);
  const percentual = Number(res.rows[0]?.percentual);
  return Number.isFinite(percentual) ? percentual : null;
}

function dateKeyAddDays(dateKey: string, deltaDays: number): string {
  const d = parseDateKeyLocal(dateKey);
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Mesma lógica visual da prévia de ipt_cronograma: ~5 datas (passado recente + próximas). */
function buildCronogramaPreviewFromSorted(sortedUnique: string[], todayKey: string): string[] {
  const sorted = [...sortedUnique].sort();
  const pastOrToday = sorted.filter((d) => d <= todayKey);
  const future = sorted.filter((d) => d > todayKey);
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
  return preview;
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

  const modulosSetoresQuery = `SELECT
      sm.setor,
      TRIM(sm.selimp_codigo) AS selimp_codigo,
      TRIM(sm.ddmx_codigo) AS ddmx_codigo,
      m.modulo_selimp,
      m.nome,
      m.comunicacao,
      m.ultima_comunicacao,
      m.bateria_raw,
      m.bateria_percentual::float8 AS bateria_percentual,
      m.status_bateria,
      m.dias_on,
      m.dias_off,
      m.produtividade_bateria::float8 AS produtividade_bateria,
      COALESCE(m.status_sinal_manual, m.status_sinal_calculado) AS status_sinal
    FROM setores_modulos sm
    LEFT JOIN modulo_selimp m
      ON TRIM(m.modulo_selimp) = TRIM(sm.selimp_codigo)
    WHERE sm.selimp_codigo IS NOT NULL
      AND TRIM(sm.selimp_codigo) <> ''
    ORDER BY sm.setor, sm.selimp_codigo`;

  let bateriaHistoricoDateFilter = "";
  const bateriaHistoricoParams: unknown[] = [];
  if (escopo === "dia_anterior" && scopeStart) {
    bateriaHistoricoParams.push(scopeStart);
    bateriaHistoricoDateFilter = ` AND data_exportacao = $${bateriaHistoricoParams.length}::date`;
  } else if (escopo === "periodo" && scopeStart && scopeEnd) {
    bateriaHistoricoParams.push(scopeStart, scopeEnd);
    bateriaHistoricoDateFilter = ` AND data_exportacao >= $1::date AND data_exportacao <= $2::date`;
  }
  const bateriaHistoricoQuery = `SELECT DISTINCT ON (TRIM(selimp_id), data_exportacao)
      TRIM(selimp_id) AS selimp_id,
      data_exportacao::text AS data_exportacao,
      status_comunicacao,
      bateria_raw,
      bateria_percentual::float8 AS bateria_percentual,
      bateria_desatualizada,
      ultima_comunicacao
    FROM ipt_dados_bateria
    WHERE selimp_id IS NOT NULL
      AND TRIM(selimp_id) <> ''
      ${bateriaHistoricoDateFilter}
    ORDER BY TRIM(selimp_id), data_exportacao, updated_at DESC, id DESC`;

  const [reportRes, ddmxLegacyRes, bateriaRows, modulosSetoresRes, bateriaHistoricoRes] = await Promise.all([
    client.query(reportQuery, rparams),
    client.query(ddmxLegacyQuery, dparams),
    client.query(
      `SELECT raw, updated_at
       FROM ipt_imports
       WHERE file_type = 'ipt_status_bateria'
       ORDER BY updated_at DESC`
    ),
    client.query(modulosSetoresQuery),
    client.query(bateriaHistoricoQuery, bateriaHistoricoParams),
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

  type ModuloBateriaPreview = {
    codigo: string;
    numero_selimp: string;
    nome: string;
    setor: string;
    tipo: "lutocar" | "portatil";
    status_bateria: string;
    status_sinal: string;
    comunicacao: string;
    bateria: string;
    bateria_percentual: number | null;
    ultima_comunicacao: string | null;
    dias_on: number;
    dias_off: number;
    produtividade_bateria: number;
  };

  type BateriaResumoSetor = {
    total: number;
    produtividade_media: number | null;
    com_sinal: number;
    sem_sinal: number;
    criticos: number;
    alerta: number;
  };

  type BateriaModuloDia = {
    numero_selimp: string;
    status_comunicacao: string;
    bateria_raw: string;
    bateria_percentual: number | null;
    bateria_desatualizada: boolean;
    ultima_comunicacao: string | null;
  };

  type BateriaSetorDia = {
    total: number;
    desatualizadas: number;
    media_percentual: number | null;
    modulos: BateriaModuloDia[];
  };

  const modulosBySetor = new Map<string, ModuloBateriaPreview[]>();
  const moduloByDdmx = new Map<string, ModuloBateriaPreview>();
  const bateriaHistoricoByModuloDate = new Map<string, BateriaModuloDia>();

  const pushModuloSetor = (setor: string, modulo: ModuloBateriaPreview) => {
    const key = normalizarSetor(setor);
    if (!key) return;
    const current = modulosBySetor.get(key) ?? [];
    if (!current.some((m) => m.numero_selimp === modulo.numero_selimp)) {
      current.push(modulo);
    }
    modulosBySetor.set(key, current);
  };

  for (const row of (modulosSetoresRes.rows ?? []) as Array<{
    setor: string | null;
    selimp_codigo: string | null;
    ddmx_codigo: string | null;
    modulo_selimp: string | null;
    nome: string | null;
    comunicacao: string | null;
    ultima_comunicacao: string | Date | null;
    bateria_raw: string | null;
    bateria_percentual: number | null;
    status_bateria: string | null;
    dias_on: number | null;
    dias_off: number | null;
    produtividade_bateria: number | null;
    status_sinal: string | null;
  }>) {
    const setor = normalizarSetor(String(row.setor ?? "").trim());
    const numeroSelimp = String(row.modulo_selimp ?? row.selimp_codigo ?? "").trim();
    if (!setor || !numeroSelimp) continue;

    const modulo: ModuloBateriaPreview = {
      codigo: numeroSelimp,
      numero_selimp: numeroSelimp,
      nome: String(row.nome ?? ""),
      setor,
      tipo: "lutocar",
      status_bateria: String(row.status_bateria ?? ""),
      status_sinal: String(row.status_sinal ?? ""),
      comunicacao: String(row.comunicacao ?? ""),
      bateria: String(row.bateria_raw ?? ""),
      bateria_percentual: row.bateria_percentual == null ? null : Number(row.bateria_percentual),
      ultima_comunicacao: row.ultima_comunicacao ? String(row.ultima_comunicacao) : null,
      dias_on: Number(row.dias_on ?? 0),
      dias_off: Number(row.dias_off ?? 0),
      produtividade_bateria: Number(row.produtividade_bateria ?? 0),
    };

    pushModuloSetor(setor, modulo);
    const ddmxKey = normalizeModuleCode(String(row.ddmx_codigo ?? ""));
    if (ddmxKey) moduloByDdmx.set(ddmxKey, modulo);
  }

  for (const row of (bateriaHistoricoRes.rows ?? []) as Array<{
    selimp_id: string | null;
    data_exportacao: string | null;
    status_comunicacao: string | null;
    bateria_raw: string | null;
    bateria_percentual: number | null;
    bateria_desatualizada: boolean | null;
    ultima_comunicacao: string | Date | null;
  }>) {
    const selimpId = String(row.selimp_id ?? "").trim();
    const dataExportacao = String(row.data_exportacao ?? "").slice(0, 10);
    if (!selimpId || !dataExportacao) continue;
    bateriaHistoricoByModuloDate.set(`${selimpId}|${dataExportacao}`, {
      numero_selimp: selimpId,
      status_comunicacao: String(row.status_comunicacao ?? ""),
      bateria_raw: String(row.bateria_raw ?? ""),
      bateria_percentual: row.bateria_percentual == null ? null : Number(row.bateria_percentual),
      bateria_desatualizada: Boolean(row.bateria_desatualizada),
      ultima_comunicacao: row.ultima_comunicacao ? String(row.ultima_comunicacao) : null,
    });
  }

  const summarizeModulosBateria = (modulos: ModuloBateriaPreview[]): BateriaResumoSetor => {
    const total = modulos.length;
    const produtividadeVals = modulos
      .map((m) => Number(m.produtividade_bateria))
      .filter((n) => Number.isFinite(n));
    const produtividadeMedia =
      produtividadeVals.length > 0
        ? Number((produtividadeVals.reduce((sum, n) => sum + n, 0) / produtividadeVals.length).toFixed(2))
        : null;

    return {
      total,
      produtividade_media: produtividadeMedia,
      com_sinal: modulos.filter((m) => normalizeText(m.status_sinal) === "com sinal").length,
      sem_sinal: modulos.filter((m) => normalizeText(m.status_sinal) === "sem sinal").length,
      criticos: modulos.filter((m) => normalizeText(m.status_bateria).includes("critica")).length,
      alerta: modulos.filter((m) => {
        const status = normalizeText(m.status_bateria);
        return status.includes("baixa") || status.includes("desatualizada");
      }).length,
    };
  };

  const summarizeBateriaDia = (modulos: ModuloBateriaPreview[], dateKey: string): BateriaSetorDia | null => {
    const historico = modulos
      .map((modulo) => bateriaHistoricoByModuloDate.get(`${modulo.numero_selimp}|${dateKey}`))
      .filter((item): item is BateriaModuloDia => item != null);
    if (historico.length === 0) return null;

    const percentuais = historico
      .map((item) => item.bateria_percentual)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return {
      total: historico.length,
      desatualizadas: historico.filter(
        (item) => item.bateria_desatualizada || normalizeText(item.bateria_raw).includes("desatualizada")
      ).length,
      media_percentual:
        percentuais.length > 0
          ? Number((percentuais.reduce((sum, value) => sum + value, 0) / percentuais.length).toFixed(2))
          : null,
      modulos: historico,
    };
  };

  // --- Estrutura por plano ---
  type Bucket = {
    selimp_sum: number;
    selimp_count: number;
    selimp_zero_count: number;
    selimp_max: number | null;
    nosso_sum: number;
    nosso_count: number;
    despachos_selimp: number;
    despachos_nosso: number;
    estimados: number;
    data_estimada_alg: boolean;
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
  const vpCanonicalByMergeKey = new Map<string, string>();

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
      selimp_max: null,
      nosso_sum: 0,
      nosso_count: 0,
      despachos_selimp: 0,
      despachos_nosso: 0,
      estimados: 0,
      data_estimada_alg: false,
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
    const planoRaw = normalizarSetor(String(row.plano ?? "").trim());
    if (!planoRaw) continue;
    const plano = registerVpCanonicalFromSelimp(planoRaw, vpCanonicalByMergeKey);
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
      bucket.selimp_max = bucket.selimp_max == null ? pctVal : Math.max(bucket.selimp_max, pctVal);
      if (pctVal === 0) bucket.selimp_zero_count += 1;
    }
    if (row.metodo_estimativa) {
      const metodo = row.metodo_estimativa;
      const dataRealSelimp =
        metodo === "selimp_data_planejada" || metodo === "cronograma" || metodo === "cronograma+cross_ref";
      if (!dataRealSelimp) {
        bucket.estimados += 1;
        bucket.data_estimada_alg = true;
      }
    }
  }

  // --- 2. DDMX → percentual_nosso (novas tabelas + legado, deduplicados pelo merge acima) ---
  for (const row of ddmxRows) {
    const rawData = row.raw ?? {};
    // DDMX: rota é o campo principal para o plano (ex: MG10101VP0001)
    const rotaOrSetor = String(rawData.rota ?? rawData.plano ?? rawData.setor ?? row.setor ?? "").trim();
    const planoRaw = normalizarSetor(rotaOrSetor);
    if (!planoRaw) continue;
    const plano = resolveVpCanonicalFromDdmx(planoRaw, vpCanonicalByMergeKey);
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
      let maxSelimp: number | null = null;
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
          if (bucket.selimp_max != null) maxSelimp = maxSelimp == null ? bucket.selimp_max : Math.max(maxSelimp, bucket.selimp_max);
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
            data_estimada: bucket.data_estimada_alg,
          };
        })
        .filter((d): d is NonNullable<typeof d> => d != null)
        .sort((a, b) => b.data.localeCompare(a.data));

      const percentualSelimp = countSelimp > 0 ? Number((sumSelimp / countSelimp).toFixed(2)) : null;
      const iptOrdemBlend =
        percentualSelimp != null && maxSelimp != null
          ? Number((0.48 * maxSelimp + 0.52 * percentualSelimp).toFixed(2))
          : null;
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

      const tipoServicoFinal = resolveTipoServicoExibicao(item.plano, item.tipo_servico);
      const modulosDoSetor = [...(modulosBySetor.get(normalizarSetor(item.plano)) ?? [])];
      for (const equipamento of item.equipamentos) {
        const modulo = moduloByDdmx.get(normalizeModuleCode(equipamento));
        if (modulo && !modulosDoSetor.some((m) => m.numero_selimp === modulo.numero_selimp)) {
          modulosDoSetor.push(modulo);
        }
      }
      const bateriaResumoSetor = summarizeModulosBateria(modulosDoSetor);
      const detalhesComBateria = detalhes.map((detalhe) => ({
        ...detalhe,
        bateria_setor_dia: summarizeBateriaDia(modulosDoSetor, detalhe.data),
      }));

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
        raw_selimp_max: maxSelimp,
        ipt_ordem_blend: iptOrdemBlend,
        equipamentos: Array.from(item.equipamentos),
        bateria_por_equipamento: Object.fromEntries(
          Array.from(item.equipamentos)
            .map((codigo) => {
              const modulo = moduloByDdmx.get(normalizeModuleCode(codigo));
              const info = modulo
                ? {
                    status_bateria: modulo.status_bateria,
                    bateria: modulo.bateria || (modulo.bateria_percentual == null ? undefined : `${modulo.bateria_percentual}%`),
                    data_ultima_comunicacao: modulo.ultima_comunicacao ?? undefined,
                    dias_on: modulo.dias_on,
                    dias_off: modulo.dias_off,
                    produtividade_bateria: modulo.produtividade_bateria,
                    status_sinal: modulo.status_sinal,
                    numero_selimp: modulo.numero_selimp,
                  }
                : bateriaMap.get(normalizeModuleCode(codigo));
              return info ? [codigo, info] : null;
            })
            .filter((x): x is [string, { status_bateria: string; bateria?: string }] => x != null)
        ),
        modulos_bateria: modulosDoSetor,
        produtividade_bateria_media: bateriaResumoSetor.produtividade_media,
        bateria_resumo_setor: bateriaResumoSetor,
        proxima_programacao: null as string | null,
        cronograma_preview: [] as string[],
        data_estimativa_count: estimados,
        detalhes_diarios: detalhesComBateria,
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
      if (allDates && allDates.length > 0) {
        const sorted = [...new Set(allDates)].sort();
        const future = sorted.filter((d) => d > today);
        row.cronograma_preview = buildCronogramaPreviewFromSorted(sorted, today);
        row.proxima_programacao = future.length > 0 ? future[0] : null;
      } else if (row.frequencia_codigo) {
        const winStart = dateKeyAddDays(today, -120);
        const winEnd = dateKeyAddDays(today, 120);
        const freqDates = generateFrequencyDates(row.frequencia_codigo, winStart, winEnd);
        const sorted = [...new Set(freqDates)].sort();
        if (sorted.length > 0) {
          const future = sorted.filter((d) => d > today);
          row.cronograma_preview = buildCronogramaPreviewFromSorted(sorted, today);
          row.proxima_programacao =
            future.length > 0 ? future[0] : findNextExpectedByFrequency(row.frequencia_codigo, today);
        }
      }
    }

    for (const row of rows) {
      const key = normalizarSetor(row.plano);
      const cronDates = cronMap.get(key) ?? [];
      const cronSet = new Set(cronDates);
      const freqCode = row.frequencia_codigo;
      for (const d of row.detalhes_diarios) {
        const inCron = cronSet.has(d.data);
        const inFreq =
          freqCode != null && String(freqCode).length === 4 && isFrequencyDate(String(freqCode), d.data);
        d.esperado = inCron || inFreq;
      }
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
  const cenariosIpt = calcularCenariosIPT({
    ordens: rowsFiltered
      .map((r) => r.ipt_ordem_blend)
      .filter((value): value is number => value != null && Number.isFinite(value))
      .map((percentual) => ({ percentual: percentual / 100 })),
    totalLinhas: totalRawSelimpCount,
    linhasEncerradas: totalRawSelimpCount,
    zerosTotal: totalRawSelimpCount - totalRawSelimpNonzeroCount,
    zerosEncerradas: totalRawSelimpCount - totalRawSelimpNonzeroCount,
    planosDistintos: rowsFiltered.filter((r) => r.ipt_ordem_blend != null).length,
    percentualOficial: await getIptOficialMensal(client, scopeStart, scopeEnd),
  });
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
  const produtividadeBateriaVals = rowsFiltered
    .map((r) => r.produtividade_bateria_media)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  const produtividadeBateriaMedia =
    produtividadeBateriaVals.length > 0
      ? Number((produtividadeBateriaVals.reduce((sum, n) => sum + n, 0) / produtividadeBateriaVals.length).toFixed(2))
      : null;
  const totalModulosBateriaRelacionados = rowsFiltered.reduce((acc, r) => acc + r.modulos_bateria.length, 0);
  const totalModulosComSinal = rowsFiltered.reduce((acc, r) => acc + r.bateria_resumo_setor.com_sinal, 0);
  const totalModulosSemSinal = rowsFiltered.reduce((acc, r) => acc + r.bateria_resumo_setor.sem_sinal, 0);
  const totalModulosCriticos = rowsFiltered.reduce((acc, r) => acc + r.bateria_resumo_setor.criticos, 0);
  const totalModulosAlerta = rowsFiltered.reduce((acc, r) => acc + r.bateria_resumo_setor.alerta, 0);

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
    modulos_status: r.modulos_bateria.map((m) => ({
      codigo: m.numero_selimp,
      status_bateria: m.status_bateria,
      status_comunicacao: m.comunicacao,
      bateria: m.bateria,
      bateria_percentual: m.bateria_percentual,
      produtividade_bateria: m.produtividade_bateria,
      dias_on: m.dias_on,
      dias_off: m.dias_off,
      data_ultima_comunicacao: m.ultima_comunicacao,
      ativo: normalizeText(m.status_sinal) === "com sinal",
    })),
    plano_ativo: r.despachos_selimp > 0 || r.despachos_nosso > 0,
    sem_status_bateria: r.modulos_bateria.length === 0,
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
      produtividade_bateria_media: produtividadeBateriaMedia,
      total_modulos_relacionados: totalModulosBateriaRelacionados,
      total_modulos_ativos: totalModulosComSinal,
      total_modulos_inativos: totalModulosSemSinal,
      sem_status_bateria: rowsFiltered.filter((r) => r.modulos_bateria.length === 0).length,
      comunicacao_off: totalModulosSemSinal,
      bateria_critica: totalModulosCriticos,
      bateria_alerta: totalModulosAlerta,
      total_setores: rowsFiltered.length,
      total_despachos_selimp: totalDespachosSelimp,
      total_despachos_nosso: totalDespachosNosso,
      total_despachos_zerados: totalRawSelimpCount - totalRawSelimpNonzeroCount,
      ipt_soma_percentuais: Number(totalRawSelimpSum.toFixed(2)),
      ipt_media_percentual: iptMedioSelimp,
      ipt_cenarios: cenariosIpt,
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
