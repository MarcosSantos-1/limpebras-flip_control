import { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";
import { cacheKey, getOrSet, invalidatePrefix } from "../cache.js";
import {
  pontuacaoIA,
  pontuacaoIRD,
  pontuacaoIF,
  pontuacaoIFFromPercentual,
  pontuacaoIPT,
  descontoADC,
  type IndicadorResult,
} from "../services/indicadores.js";
import { calcularCenariosIPT, calcularPFComDetalhes, type IptCenarios, type PfDetalhes } from "../services/ipt-pf-algoritmo.js";
import { montarRespostaConservador, type Linha as IptLinhaConservador } from "../services/ipt-conservador.js";
import { BFS_IF_EXCLUSAO_SQL, sqlBfsFiscalNaoEhSelimp } from "../constants/bfs.js";
import { SUB_SIGLAS, DOMICILIOS_POR_REGIONAL, regionalToSigla } from "../constants/regionais.js";
import {
  normalizarSetor,
  compareSetores,
  getFrequenciaDescricao,
  parseSetor,
  getSubFromPlano,
  getTipoServicoFromPlano,
  SERVICO_ASSEIO_POPULACAO_RUA,
  CRONOGRAMA_SERVICOS,
  getYesterdayDateKeyBrt,
  parseDateKeyLocal,
  diffInDaysAbs,
  isFrequencyDate,
  findPreviousExpectedByFrequency,
  findNextExpectedByFrequency,
  findPreviousExpectedByFrequencyStrict,
  pickNearestDate,
  resolveTipoServicoExibicao,
} from "../constants/ipt.js";
import { config } from "../config.js";
import { requireHost } from "../auth.js";
import { buildIptPreviewFromConsolidado } from "../services/ipt-consolidado-preview.js";
import { listCronogramaSetores } from "../services/cronograma.js";
import { buildDespachosResponse, colarDespachos, despacharManual } from "../services/despachosDiarios.js";
import { percentDisplayToDecimal } from "../services/parseRelatorioConsolidado.js";
import { formatDataInstalacaoBr } from "../services/formatDataInstalacaoBr.js";

/** Ordens SELIMP a partir das planilhas consolidadas (prioridade sobre Report oficial). */
async function fetchOrdensConsolidadoNoPeriodo(
  client: any,
  inicio: string,
  fim: string
): Promise<{ ordens: Array<{ percentual: number }>; P: number; R: number; F: number; cenarios?: IptCenarios }> {
  const veicRes = await client.query(
    `SELECT setor, raw
     FROM ipt_imports
     WHERE file_type = 'ipt_consolidado_veiculos'
       AND data_referencia >= $1::date AND data_referencia <= $2::date`,
    [inicio, fim]
  );
  const varrRes = await client.query(
    `SELECT setor, raw
     FROM ipt_imports
     WHERE file_type = 'ipt_consolidado_varricao'
       AND data_referencia >= $1::date AND data_referencia <= $2::date`,
    [inicio, fim]
  );
  const allRows = [...(veicRes.rows ?? []), ...(varrRes.rows ?? [])];
  const ordens: Array<{ percentual: number }> = [];
  if (allRows.length === 0) {
    return { ordens, P: 0, R: 0, F: 0 };
  }
  const porPlano = new Map<string, number[]>();
  for (const row of allRows) {
    const plano = normalizarSetor(String(row.setor ?? "").trim());
    if (!plano) continue;
    const raw = (row.raw ?? {}) as Record<string, unknown>;
    const s = Number(raw.percentual_selimp);
    if (!Number.isFinite(s)) continue;
    const pctDecimal = percentDisplayToDecimal(s > 1 ? s : s * 100);
    const arr = porPlano.get(plano) ?? [];
    arr.push(pctDecimal);
    porPlano.set(plano, arr);
  }
  for (const arr of porPlano.values()) {
    const max = Math.max(...arr);
    const media = arr.reduce((a, b) => a + b, 0) / arr.length;
    const blend = 0.48 * max + 0.52 * media;
    ordens.push({ percentual: Math.min(1, Math.max(0, blend)) });
  }
  const A = ordens.length;
  const percentualOficial = await getIptOficialMensal(client, inicio, fim);
  const cenarios = calcularCenariosIPT({
    ordens,
    totalLinhas: allRows.length,
    linhasEncerradas: allRows.length,
    zerosTotal: ordens.filter((ordem) => ordem.percentual === 0).length,
    zerosEncerradas: ordens.filter((ordem) => ordem.percentual === 0).length,
    planosDistintos: ordens.length,
    percentualOficial,
  });
  return { ordens, P: A, R: 1, F: 1, cenarios: cenarios ?? undefined };
}

/** Extrai data (yyyy-MM-dd) do raw. Checa chaves conhecidas e qualquer chave que contenha "data". */
function extractRawDateForIpt(raw: IptRaw): string | null {
  const preferidos = ["data", "data_planejado", "data_execucao", "data_criacao", "data_liberacao", "data_referencia"];
  for (const k of preferidos) {
    const v = raw[k];
    if (v != null && String(v).trim()) {
      const key = parseDateToKey(String(v).trim());
      if (key) return key;
    }
  }
  for (const k of Object.keys(raw)) {
    if (/data|data_|_data/.test(k.toLowerCase()) && !/estimada|metodo/.test(k.toLowerCase())) {
      const v = raw[k];
      if (v != null && String(v).trim()) {
        const key = parseDateToKey(String(v).trim());
        if (key) return key;
      }
    }
  }
  return null;
}

function parseDateToKey(value: string): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return null;
}

/**
 * Extrai ordens da planilha SELIMP no período.
 * Prioriza consolidado; fallback para ipt_report_linhas.
 */
async function fetchOrdensSelimpNoPeriodo(
  client: any,
  inicio: string,
  fim: string
): Promise<{ ordens: Array<{ percentual: number }>; P: number; R: number; F: number; cenarios?: IptCenarios }> {
  const consolidado = await fetchOrdensConsolidadoNoPeriodo(client, inicio, fim);
  if (consolidado.ordens.length > 0) {
    return consolidado;
  }

  const reportRes = await client.query(
    `SELECT plano, percentual_execucao, status
     FROM ipt_report_linhas
     WHERE data_estimada >= $1::date AND data_estimada <= $2::date`,
    [inicio, fim]
  );

  const ordens: Array<{ percentual: number }> = [];

  if ((reportRes.rows?.length ?? 0) > 0) {
    const porPlano = new Map<string, number[]>();
    let linhasEncerradas = 0;
    let zerosEncerradas = 0;
    let zerosTotal = 0;
    for (const row of reportRes.rows) {
      const pctRawAll = Number(row.percentual_execucao);
      const pctAll = Number.isFinite(pctRawAll) ? Math.min(1, Math.max(0, pctRawAll > 1 ? pctRawAll / 100 : pctRawAll)) : null;
      if (pctAll === 0) zerosTotal += 1;
      const statusNorm = normalizeMatchText(String(row.status ?? ""));
      if (!statusNorm.includes("encerrado")) continue;
      linhasEncerradas += 1;
      const plano = normalizarSetor(String(row.plano ?? "").trim());
      if (!plano) continue;
      const pctRaw = Number(row.percentual_execucao);
      if (!Number.isFinite(pctRaw)) continue;
      const pctDecimal = Math.min(1, Math.max(0, pctRaw > 1 ? pctRaw / 100 : pctRaw));
      if (pctDecimal === 0) zerosEncerradas += 1;
      const arr = porPlano.get(plano) ?? [];
      arr.push(pctDecimal);
      porPlano.set(plano, arr);
    }
    for (const arr of porPlano.values()) {
      const max = Math.max(...arr);
      const media = arr.reduce((a, b) => a + b, 0) / arr.length;
      const blend = 0.48 * max + 0.52 * media;
      ordens.push({ percentual: Math.min(1, Math.max(0, blend)) });
    }
    const A = ordens.length;
    const percentualOficial = await getIptOficialMensal(client, inicio, fim);
    const cenarios = calcularCenariosIPT({
      ordens,
      totalLinhas: reportRes.rows.length,
      linhasEncerradas,
      zerosTotal,
      zerosEncerradas,
      planosDistintos: A,
      percentualOficial,
    });
    return { ordens, P: A, R: 1, F: 1, cenarios: cenarios ?? undefined };
  }

  return { ordens, P: 0, R: 0, F: 0 };
}

/**
 * IPT via algoritmo oficial SELIMP: PF = 0.7 × qualidade + 0.3 × cobertura.
 */
async function getAutoIPTFromReport(client: any, inicio: string, fim: string): Promise<number | null> {
  const { ordens, cenarios } = await fetchOrdensSelimpNoPeriodo(client, inicio, fim);
  if (ordens.length === 0) return null;
  return cenarios?.estimado.percentual ?? null;
}

async function getAutoIPTCenariosFromReport(client: any, inicio: string, fim: string): Promise<IptCenarios | null> {
  const { ordens, cenarios } = await fetchOrdensSelimpNoPeriodo(client, inicio, fim);
  if (ordens.length === 0) return null;
  return cenarios ?? null;
}

/**
 * IPT com detalhes do algoritmo para a página de explicação.
 */
async function getAutoIPTDetalhesFromReport(
  client: any,
  inicio: string,
  fim: string
): Promise<{ percent: number; detalhes: PfDetalhes } | null> {
  const { ordens, P, R, F } = await fetchOrdensSelimpNoPeriodo(client, inicio, fim);
  if (ordens.length === 0) return null;
  const result = calcularPFComDetalhes({ P, R, F, ordens });
  if (!result) return null;
  return { percent: Number((result.pf * 100).toFixed(2)), detalhes: result.detalhes };
}

type IptRaw = Record<string, string>;

function isFullMonthPeriod(inicio: string, fim: string): { ano: number; mes: number } | null {
  const match = inicio.match(/^(\d{4})-(\d{2})-01$/);
  if (!match) return null;
  const ano = Number(match[1]);
  const mes = Number(match[2]);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const fimEsperado = `${ano}-${String(mes).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;
  return fim === fimEsperado ? { ano, mes } : null;
}

async function getIptOficialMensal(client: any, inicio: string, fim: string): Promise<number | null> {
  const periodo = isFullMonthPeriod(inicio, fim);
  if (!periodo) return null;
  const res = await client.query(`SELECT percentual FROM ipt_oficial_mensal WHERE ano = $1 AND mes = $2`, [
    periodo.ano,
    periodo.mes,
  ]);
  const percentual = Number(res.rows[0]?.percentual);
  return Number.isFinite(percentual) ? percentual : null;
}

const normalizeModuleCode = (value: string): string =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();

const toExecPercent = (value: string): number | null => {
  if (!value) return null;
  const cleaned = value.replace(",", ".").replace("%", "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const normalizeMatchText = (value: string): string =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const isStatusEncerrado = (raw: IptRaw): boolean => {
  const status = normalizeMatchText(String(raw.status ?? ""));
  return status.includes("encerrado");
};

type ImportRow = { raw: Record<string, unknown> };

type RefGroup = {
  key: string;
  tipo: string;
  inicioRef: string;
  fimRef: string;
  rows: ImportRow[];
};

const isDateYmd = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v);

const normalizeRefTipo = (v: unknown): string => normalizeMatchText(String(v ?? ""));

const getTipoScore = (tipo: string): number => {
  if (tipo === "mensal") return 3;
  if (tipo === "fim_de_semana") return 2;
  if (tipo === "d_minus_1") return 1;
  return 0;
};

const selectBestReferenceRows = (rows: ImportRow[], inicio: string, fim: string): ImportRow[] => {
  const groups = new Map<string, RefGroup>();
  for (const row of rows) {
    const raw = (row.raw ?? {}) as Record<string, unknown>;
    const tipo = normalizeRefTipo(raw._periodo_tipo);
    const inicioRef = String(raw._periodo_inicial_referencia ?? "").trim();
    const fimRef = String(raw._periodo_final_referencia ?? "").trim();
    if (!tipo || !isDateYmd(inicioRef) || !isDateYmd(fimRef)) continue;
    const key = `${tipo}|${inicioRef}|${fimRef}`;
    const current = groups.get(key);
    if (current) current.rows.push(row);
    else groups.set(key, { key, tipo, inicioRef, fimRef, rows: [row] });
  }

  if (groups.size === 0) return rows;

  const requestIsFullMonth = /^\d{4}-\d{2}-01$/.test(inicio);
  const candidatos = Array.from(groups.values()).filter((g) => g.inicioRef >= inicio && g.fimRef <= fim);
  const base = candidatos.length > 0 ? candidatos : Array.from(groups.values());
  base.sort((a, b) => {
    const scoreDiff = getTipoScore(b.tipo) - getTipoScore(a.tipo);
    if (scoreDiff !== 0) return scoreDiff;
    if (a.fimRef !== b.fimRef) return b.fimRef.localeCompare(a.fimRef);
    if (a.inicioRef !== b.inicioRef) return b.inicioRef.localeCompare(a.inicioRef);
    return b.rows.length - a.rows.length;
  });

  if (!requestIsFullMonth) return base[0].rows;

  const mensal = base.find((g) => g.tipo === "mensal");
  return (mensal ?? base[0]).rows;
};

/** Tenta múltiplas chaves do raw para obter percentual (planilhas usam nomes variados, ex: col U). */
const getPercentualFromRaw = (raw: IptRaw): number | null => {
  const preferidos = [
    "percentual_execucao",
    "percentual_de_execucao",
    "de_execucao",
    "percentual",
    "percentual_execucao_1",
  ];
  for (const k of preferidos) {
    const v = raw[k];
    if (v != null && String(v).trim() !== "") {
      const n = toExecPercent(String(v));
      if (n != null) return n;
    }
  }
  for (const k of Object.keys(raw)) {
    if (/percentual|execucao|execução|coluna_2[01]/.test(k.toLowerCase())) {
      const v = raw[k];
      if (v != null && String(v).trim() !== "") {
        const n = toExecPercent(String(v));
        if (n != null) return n;
      }
    }
  }
  return null;
};

const extractModuleCodes = (equipamentos: string): string[] => {
  if (!equipamentos) return [];
  const parts = equipamentos
    .split(/[;,|]/g)
    .map((p) => normalizeModuleCode(p))
    .filter(Boolean);
  return Array.from(new Set(parts));
};

const normalizeText = (value: string): string =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const parseDias = (value: string): number | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("<")) return 0;
  if (raw.startsWith("+")) {
    const n = Number(raw.slice(1));
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

// isFrequencyDate, toDateKey, parseDateKeyLocal, diffInDaysAbs,
// findPreviousExpectedByFrequency, findNextExpectedByFrequency,
// findPreviousExpectedByFrequencyStrict, pickNearestDate, CRONOGRAMA_SERVICOS
// -> imported from ../constants/ipt.js

const normalizeServiceName = (service: string, plano: string): string => {
  const raw = String(service ?? "").trim();
  const normalized = normalizeText(raw).replace(/\s+/g, " ");
  const compact = normalized.replace(/[^a-z]/g, "");
  const planoCode = String(plano ?? "").toUpperCase();

  // Prioridade: codinome do setor (MT, BL, NH, etc.) — nunca "Não informado"
  const fromPlano = getTipoServicoFromPlano(plano);
  if (fromPlano) return fromPlano;

  if (
    compact.includes("varricaodepraca") ||
    compact.includes("equipeparavarricaodepracas") ||
    (compact.includes("praca") && compact.includes("vp")) ||
    compact === "vp"
  ) {
    return "Equipe para varrição de praças";
  }

  if (
    compact.includes("mutirao") ||
    (compact.includes("zeladoria") && compact.includes("vias"))
  ) {
    return "Equipe de mutirão de zeladoria de vias e logradouros públicos";
  }

  if (
    compact.includes("asseio") ||
    (compact.includes("populacao") && compact.includes("rua")) ||
    (compact.includes("comercio") && compact.includes("desordenado")) ||
    (compact.includes("morador") && compact.includes("situacaoderua"))
  ) {
    return SERVICO_ASSEIO_POPULACAO_RUA;
  }

  if (
    (compact.includes("lavagem") && compact.includes("especial")) ||
    (compact.includes("equipamentos") && compact.includes("publicos")) ||
    compact === "le"
  ) {
    return "Lavagem especial de equipamentos públicos";
  }

  if (planoCode.includes("VJ")) {
    return "Varrição manual de vias e logradouros públicos - sarjetas";
  }
  if (planoCode.includes("VL")) {
    return "Varrição manual de vias e logradouros públicos - sarjetas e calçadas";
  }

  const canonicalBueiro =
    "Limpeza e desobstrução de bueiros, bocas de lobo e bocas de leão";
  if (
    planoCode.includes("BL") ||
    compact.includes("bocadelobo") ||
    compact.includes("bueiro") ||
    compact.includes("desobstrucao") ||
    (compact.includes("limpeza") && (compact.includes("bl") || compact.includes("boca")))
  ) {
    return canonicalBueiro;
  }

  const parsed = parseSetor(plano);
  if (parsed?.servico === "CV") {
    return "Coleta manual de resíduos de varrição com compactador";
  }

  return getTipoServicoFromPlano(plano) || raw || "";
};

const isModuleInactive = (statusBateria: string, statusComunicacao: string, diasSemComunicacao: number | null): boolean => {
  const bat = normalizeText(statusBateria);
  const com = normalizeText(statusComunicacao);

  if (com === "off") return true;
  if (diasSemComunicacao != null && diasSemComunicacao >= 5) return true;
  if (
    /(descarregado|inativo|desativado|sem modulo|nao instalado|nao ativo|nao despachado)/.test(bat)
  ) {
    return true;
  }
  return false;
};

function calcularMediaIfPorSubprefeitura(
  bySigla: Record<string, { total: number; sem_irregularidade: number }>
): number {
  const percentuais = SUB_SIGLAS.map((sigla) => {
    const { total, sem_irregularidade } = bySigla[sigla];
    return total > 0 ? (sem_irregularidade / total) * 100 : 0;
  });

  const somaPercentuais = percentuais.reduce((acc, value) => acc + value, 0);
  // Regra solicitada: quando alguma sub ficar zerada, usa divisor 3.
  const divisor = percentuais.some((value) => value === 0) ? 3 : 4;
  return somaPercentuais / divisor;
}

type DashboardIndicadorTipo = "IA" | "IRD" | "IF" | "IPT" | "ADC";

/**
 * Carrega as linhas (1 OS = 1 linha) preservando zeros, subprefeitura e serviço,
 * para alimentar o IPT conservador. Não agrupa por plano — o agrupamento fica
 * a cargo de cada variante no serviço de cálculo.
 *
 * Fonte: consolidado (veículos + varrição) > fallback report SELIMP encerrado.
 */
async function fetchLinhasParaConservador(
  client: any,
  inicio: string,
  fim: string,
): Promise<{ linhas: IptLinhaConservador[]; fonte: string }> {
  const veicRes = await client.query(
    `SELECT setor, raw
     FROM ipt_imports
     WHERE file_type = 'ipt_consolidado_veiculos'
       AND data_referencia >= $1::date AND data_referencia <= $2::date`,
    [inicio, fim],
  );
  const varrRes = await client.query(
    `SELECT setor, raw
     FROM ipt_imports
     WHERE file_type = 'ipt_consolidado_varricao'
       AND data_referencia >= $1::date AND data_referencia <= $2::date`,
    [inicio, fim],
  );
  const consolidadoRows = [...(veicRes.rows ?? []), ...(varrRes.rows ?? [])];

  if (consolidadoRows.length > 0) {
    const linhas: IptLinhaConservador[] = [];
    for (const row of consolidadoRows) {
      const plano = normalizarSetor(String(row.setor ?? "").trim());
      if (!plano) continue;
      const raw = (row.raw ?? {}) as Record<string, unknown>;
      const s = Number(raw.percentual_selimp);
      if (!Number.isFinite(s)) continue;
      const pctDecimal = percentDisplayToDecimal(s > 1 ? s : s * 100);
      linhas.push({
        plano,
        percentual: Math.min(1, Math.max(0, pctDecimal)),
        subprefeitura: String(raw.subprefeitura ?? "").trim() || undefined,
        servico: String(raw.servico ?? "").trim() || undefined,
      });
    }
    return { linhas, fonte: "consolidado_selimp" };
  }

  const reportRes = await client.query(
    `SELECT plano, percentual_execucao, status, subprefeitura, tipo_servico
     FROM ipt_report_linhas
     WHERE data_estimada >= $1::date AND data_estimada <= $2::date`,
    [inicio, fim],
  );
  const linhas: IptLinhaConservador[] = [];
  for (const row of reportRes.rows ?? []) {
    const statusNorm = normalizeMatchText(String(row.status ?? ""));
    if (!statusNorm.includes("encerrado")) continue;
    const plano = normalizarSetor(String(row.plano ?? "").trim());
    if (!plano) continue;
    const pctRaw = Number(row.percentual_execucao);
    if (!Number.isFinite(pctRaw)) continue;
    const pctDecimal = Math.min(1, Math.max(0, pctRaw > 1 ? pctRaw / 100 : pctRaw));
    linhas.push({
      plano,
      percentual: pctDecimal,
      subprefeitura: String(row.subprefeitura ?? "").trim() || undefined,
      servico: String(row.tipo_servico ?? "").trim() || undefined,
    });
  }
  return { linhas, fonte: "report_selimp_encerrado" };
}

type AdcOverrideRow = {
  ano: number;
  mes: number;
  modo: "por_indicador" | "total";
  pontuacao_ird: string | null;
  pontuacao_ia: string | null;
  pontuacao_if: string | null;
  pontuacao_ipt: string | null;
  adc_total: string | null;
  observacao: string;
};

async function fetchAdcOverride(client: any, periodoInicial: string): Promise<AdcOverrideRow | null> {
  const [y, m] = periodoInicial.split("-").map(Number);
  if (!y || !m) return null;
  const res = await client.query(
    `SELECT ano, mes, modo, pontuacao_ird, pontuacao_ia, pontuacao_if, pontuacao_ipt, adc_total, observacao
     FROM adc_override_mensal WHERE ano = $1 AND mes = $2`,
    [y, m]
  );
  return (res.rows[0] as AdcOverrideRow | undefined) ?? null;
}

function applyAdcOverrideToKpis(payload: Record<string, unknown>, override: AdcOverrideRow) {
  const base = payload as {
    indicadores: {
      ird: IndicadorResult;
      ia: IndicadorResult & Record<string, unknown>;
      if: IndicadorResult & Record<string, unknown>;
      ipt: IndicadorResult & Record<string, unknown>;
    };
    ipt_sem_dados: boolean;
    sacs_hoje: number;
    cncs_urgentes: number;
  };
  const observacao = String(override.observacao ?? "").trim();
  if (override.modo === "total") {
    const adcTotal = Number(override.adc_total ?? 0);
    return {
      ...base,
      indicadores: {
        ird: { ...base.indicadores.ird, pontuacao: 0, valor: 0 },
        ia: { ...base.indicadores.ia, pontuacao: 0, valor: 0 },
        if: { ...base.indicadores.if, pontuacao: 0, valor: 0 },
        ipt: { ...base.indicadores.ipt, pontuacao: 0, valor: 0 },
      },
      adc_override: {
        ativo: true,
        modo: "total" as const,
        observacao,
        adc_total: adcTotal,
      },
    };
  }

  const pontuacaoIrd = Number(override.pontuacao_ird ?? 0);
  const pontuacaoIa = Number(override.pontuacao_ia ?? 0);
  const pontuacaoIf = Number(override.pontuacao_if ?? 0);
  const pontuacaoIpt = Number(override.pontuacao_ipt ?? 0);
  const adcTotal = pontuacaoIrd + pontuacaoIa + pontuacaoIf + pontuacaoIpt;

  return {
    ...base,
    indicadores: {
      ird: { ...base.indicadores.ird, pontuacao: pontuacaoIrd, valor: 0 },
      ia: { ...base.indicadores.ia, pontuacao: pontuacaoIa, valor: 0 },
      if: { ...base.indicadores.if, pontuacao: pontuacaoIf, valor: 0 },
      ipt: { ...base.indicadores.ipt, pontuacao: pontuacaoIpt, valor: 0 },
    },
    adc_override: {
      ativo: true,
      modo: "por_indicador" as const,
      observacao,
      adc_total: adcTotal,
      pontuacao_ird: pontuacaoIrd,
      pontuacao_ia: pontuacaoIa,
      pontuacao_if: pontuacaoIf,
      pontuacao_ipt: pontuacaoIpt,
    },
  };
}

export const indicadoresRoutes: FastifyPluginAsync = async (fastify) => {
  /** KPIs do dashboard: contagens e indicadores no período */
  fastify.get<{
    Querystring: { periodo_inicial?: string; periodo_final?: string };
  }>("/dashboard/kpis", async (request, reply) => {
    const { periodo_inicial: inicio, periodo_final: fim } = request.query;
    if (!inicio || !fim) {
      return reply.code(400).send({ detail: "periodo_inicial e periodo_final obrigatórios (YYYY-MM-DD)" });
    }

    const key = cacheKey("kpis", { periodo_inicial: inicio, periodo_final: fim });
    const payload = await getOrSet(key, async () => {
      const client = await pool.connect();
      try {
      // IA: Base = Data_Registro, Finalizado_fora_de_escopo = NÃO, Classificação = Solicitação.
      // Fora do prazo = Responsividade_Execução = NÃO; No prazo = SIM.
      const iaTotal = await client.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(responsividade_execucao, ''))) = 'SIM') AS no_prazo,
                COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(responsividade_execucao, ''))) = 'NÃO') AS fora_prazo
         FROM sacs
         WHERE data_registro >= $1::date AND data_registro < ($2::date + interval '1 day')
           AND (finalizado_fora_de_escopo IS NULL OR UPPER(TRIM(finalizado_fora_de_escopo)) = 'NÃO')
           AND TRIM(classificacao_do_servico) = 'Solicitação'`,
        [inicio, fim]
      );
      const iaRow = iaTotal.rows[0];
      const totalSolicitacoes = Number(iaRow?.total ?? 0);
      const noPrazo = Number(iaRow?.no_prazo ?? 0);
      const foraPrazo = Number(iaRow?.fora_prazo ?? 0);
      const totalCalculoIA = noPrazo + foraPrazo;
      const ia = pontuacaoIA(noPrazo, totalCalculoIA);

      // IRD: Reclamação, não fora escopo, PROCEDE
      const irdCount = await client.query(
        `SELECT COUNT(*) AS total FROM sacs
         WHERE data_registro >= $1::date AND data_registro < ($2::date + interval '1 day')
           AND (finalizado_fora_de_escopo IS NULL OR UPPER(TRIM(finalizado_fora_de_escopo)) = 'NÃO')
           AND TRIM(classificacao_do_servico) = 'Reclamação'
           AND (procedente_por_status IS NOT NULL AND UPPER(TRIM(procedente_por_status)) = 'PROCEDE')`,
        [inicio, fim]
      );
      const irdReclamacoes = Number(irdCount.rows[0]?.total ?? 0);
      const ird = pontuacaoIRD(irdReclamacoes);

      // IF: todos BFS no período EXCETO os 3 serviços excluídos; exclui fiscais SELIMP (coluna Fiscal "SELIMP -...")
      const ifExcludeSql = BFS_IF_EXCLUSAO_SQL.map((_, i) => `tipo_servico NOT ILIKE $${3 + i}`).join(" AND ");
      const ifFiscalSql = sqlBfsFiscalNaoEhSelimp();
      const ifByRegional = await client.query(
        `SELECT regional,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE TRIM(status) = 'Sem Irregularidades') AS sem_irregularidade
         FROM bfs
         WHERE data_fiscalizacao >= $1::date AND data_fiscalizacao < ($2::date + interval '1 day')
           AND ${ifExcludeSql}
           AND ${ifFiscalSql}
         GROUP BY regional`,
        [inicio, fim, ...BFS_IF_EXCLUSAO_SQL]
      );
      const bySigla: Record<string, { total: number; sem_irregularidade: number }> = {};
      for (const sigla of SUB_SIGLAS) bySigla[sigla] = { total: 0, sem_irregularidade: 0 };
      for (const row of ifByRegional.rows as Array<{ regional: string; total: string; sem_irregularidade: string }>) {
        const sigla = regionalToSigla(row.regional);
        if (sigla && bySigla[sigla]) {
          bySigla[sigla].total += Number(row.total ?? 0);
          bySigla[sigla].sem_irregularidade += Number(row.sem_irregularidade ?? 0);
        }
      }
      const mediaPercentual = calcularMediaIfPorSubprefeitura(bySigla);
      const ifInd = pontuacaoIFFromPercentual(mediaPercentual);
      const totalBfs = Object.values(bySigla).reduce((a, x) => a + x.total, 0);
      const semIrreg = Object.values(bySigla).reduce((a, x) => a + x.sem_irregularidade, 0);

      const iaDashboard = {
        ...ia,
        // Para dashboard, IA deve mostrar percentual.
        valor: ia.percentual ?? 0,
        total_base: totalSolicitacoes,
        total_calculo: totalCalculoIA,
        total_no_prazo: noPrazo,
        total_fora_prazo: foraPrazo,
      };
      const ifDashboard = {
        ...ifInd,
        valor: ifInd.percentual ?? 0,
        total_fiscalizacoes: totalBfs,
        total_sem_irregularidade: semIrreg,
        if_por_sub: SUB_SIGLAS.map((sigla) => {
          const { total, sem_irregularidade } = bySigla[sigla];
          const pct = total > 0 ? (sem_irregularidade / total) * 100 : 0;
          return { subprefeitura: sigla, total, sem_irregularidade, if_percentual: pct };
        }),
      };
      const autoIptCenarios = await getAutoIPTCenariosFromReport(client, inicio, fim);
      const iptPercent = autoIptCenarios?.estimado.percentual ?? null;
      const iptDashboard =
        iptPercent != null
          ? { ...pontuacaoIPT(iptPercent), valor: iptPercent, cenarios: autoIptCenarios }
          : { valor: 0, percentual: 0, pontuacao: 0 };
      const iptSemDados = autoIptCenarios == null;

      // SACs hoje (opcional: período = hoje)
      const hoje = new Date().toISOString().slice(0, 10);
      const sacsHoje = await client.query(
        `SELECT COUNT(*) AS total FROM sacs WHERE data_registro::date = $1::date`,
        [hoje]
      );

      const basePayload = {
        indicadores: { ird, ia: iaDashboard, if: ifDashboard, ipt: iptDashboard },
        ipt_sem_dados: iptSemDados,
        sacs_hoje: Number(sacsHoje.rows[0]?.total ?? 0),
        cncs_urgentes: 0,
      };

      const override = await fetchAdcOverride(client, inicio);
      if (override) {
        return applyAdcOverrideToKpis(basePayload, override);
      }

      return basePayload;
      } finally {
        client.release();
      }
    });
    return payload;
  });

  /** Calcular ADC completo (IRD + IA + IF + IPT opcional) */
  fastify.post<{
    Querystring: { periodo_inicial: string; periodo_final: string; valor_ipt?: string };
  }>("/indicadores/calcular/adc", async (request, reply) => {
    const { periodo_inicial: inicio, periodo_final: fim, valor_ipt } = request.query;
    if (!inicio || !fim) {
      return reply.code(400).send({ detail: "periodo_inicial e periodo_final obrigatórios" });
    }

    const client = await pool.connect();
    try {
      let iptPercent = valor_ipt != null ? Number(valor_ipt) : undefined;

      // IA: fora do prazo = Responsividade_Execução = NÃO; no prazo = SIM
      const iaTotal = await client.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(responsividade_execucao, ''))) = 'SIM') AS no_prazo,
                COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(responsividade_execucao, ''))) = 'NÃO') AS fora_prazo
         FROM sacs WHERE data_registro >= $1::date AND data_registro < ($2::date + interval '1 day')
           AND (finalizado_fora_de_escopo IS NULL OR UPPER(TRIM(finalizado_fora_de_escopo)) = 'NÃO')
           AND TRIM(classificacao_do_servico) = 'Solicitação'`,
        [inicio, fim]
      );
      const iaRow = iaTotal.rows[0];
      const iaNoPrazo = Number(iaRow?.no_prazo ?? 0);
      const iaForaPrazo = Number(iaRow?.fora_prazo ?? 0);
      const iaTotalBase = Number(iaRow?.total ?? 0);
      const iaTotalCalculo = iaNoPrazo + iaForaPrazo;
      const ia = pontuacaoIA(iaNoPrazo, iaTotalCalculo);

      // IRD
      const irdCount = await client.query(
        `SELECT COUNT(*) AS total FROM sacs
         WHERE data_registro >= $1::date AND data_registro < ($2::date + interval '1 day')
           AND (finalizado_fora_de_escopo IS NULL OR UPPER(TRIM(finalizado_fora_de_escopo)) = 'NÃO')
           AND TRIM(classificacao_do_servico) = 'Reclamação'
           AND (procedente_por_status IS NOT NULL AND UPPER(TRIM(procedente_por_status)) = 'PROCEDE')`,
        [inicio, fim]
      );
      const ird = pontuacaoIRD(Number(irdCount.rows[0]?.total ?? 0));

      // IF: todos BFS no período EXCETO os 3 serviços excluídos; exclui fiscais SELIMP (coluna Fiscal "SELIMP -...")
      const ifExcludeSql = BFS_IF_EXCLUSAO_SQL.map((_, i) => `tipo_servico NOT ILIKE $${3 + i}`).join(" AND ");
      const ifFiscalSql = sqlBfsFiscalNaoEhSelimp();
      const ifByRegional = await client.query(
        `SELECT regional, COUNT(*) AS total,
                COUNT(*) FILTER (WHERE TRIM(status) = 'Sem Irregularidades') AS sem_irregularidade
         FROM bfs WHERE data_fiscalizacao >= $1::date AND data_fiscalizacao < ($2::date + interval '1 day')
           AND ${ifExcludeSql}
           AND ${ifFiscalSql}
         GROUP BY regional`,
        [inicio, fim, ...BFS_IF_EXCLUSAO_SQL]
      );
      const bySigla: Record<string, { total: number; sem_irregularidade: number }> = {};
      for (const sigla of SUB_SIGLAS) bySigla[sigla] = { total: 0, sem_irregularidade: 0 };
      for (const row of ifByRegional.rows as Array<{ regional: string; total: string; sem_irregularidade: string }>) {
        const sigla = regionalToSigla(row.regional);
        if (sigla && bySigla[sigla]) {
          bySigla[sigla].total += Number(row.total ?? 0);
          bySigla[sigla].sem_irregularidade += Number(row.sem_irregularidade ?? 0);
        }
      }
      const mediaPercentual = calcularMediaIfPorSubprefeitura(bySigla);
      const ifInd = pontuacaoIFFromPercentual(mediaPercentual);
      const ifTotal = Object.values(bySigla).reduce((a, x) => a + x.total, 0);
      const ifSemIrregularidade = Object.values(bySigla).reduce((a, x) => a + x.sem_irregularidade, 0);

      if (iptPercent == null || isNaN(iptPercent)) {
        iptPercent = (await getAutoIPTFromReport(client, inicio, fim)) ?? undefined;
      }

      const ipt: IndicadorResult = iptPercent != null && !isNaN(iptPercent)
        ? pontuacaoIPT(iptPercent)
        : { valor: 0, percentual: 0, pontuacao: 0 };

      const total = ia.pontuacao + ird.pontuacao + ifInd.pontuacao + ipt.pontuacao;
      const descontoInfo = descontoADC(total);

      const iaPayload = {
        ...ia,
        valor: ia.valor, // IA em x100 (percentual)
        total_base: iaTotalBase,
        total_calculo: iaTotalCalculo,
        total_no_prazo: iaNoPrazo,
        total_fora_prazo: iaForaPrazo,
      };
      const ifPayload = {
        ...ifInd,
        valor: ifInd.valor, // IF em x1000
        total_fiscalizacoes: ifTotal,
        total_sem_irregularidade: ifSemIrregularidade,
      };
      const descontoPercent = Math.max(0, 100 - descontoInfo.percentualRecebimento);
      const valorMensal = config.valorMensalContrato;
      const glosaReal = valorMensal * (descontoPercent / 100);

      return {
        ird,
        ia: iaPayload,
        if: ifPayload,
        ipt,
        total,
        pontuacao_total: total,
        percentual_contrato: descontoInfo.percentualRecebimento,
        desconto: descontoPercent,
        desconto_detalhe: descontoInfo,
        valor_mensal_contrato: valorMensal,
        glosa_real: glosaReal,
      };
    } finally {
      client.release();
    }
  });

  /** Detalhes dos indicadores para a página de explicação (IRD, IA, IF, IPT com componentes) */
  fastify.get<{
    Querystring: { periodo_inicial?: string; periodo_final?: string; subprefeitura?: string };
  }>("/indicadores/detalhes", async (request, reply) => {
    const { periodo_inicial: inicio, periodo_final: fim, subprefeitura } = request.query;
    if (!inicio || !fim) {
      return reply.code(400).send({ detail: "periodo_inicial e periodo_final obrigatórios" });
    }

    const client = await pool.connect();
    try {
      const domicilios = 511_093;

      // IA: Base = Data_Registro, Finalizado_fora_de_escopo = NÃO, Classificação = Solicitação.
      // Fora do prazo = Responsividade_Execução = NÃO (contagem explícita); No prazo = SIM.
      let iaSql = `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(responsividade_execucao, ''))) = 'SIM') AS no_prazo,
                COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(responsividade_execucao, ''))) = 'NÃO') AS fora_prazo
         FROM sacs WHERE data_registro >= $1::date AND data_registro < ($2::date + interval '1 day')
           AND (finalizado_fora_de_escopo IS NULL OR UPPER(TRIM(finalizado_fora_de_escopo)) = 'NÃO')
           AND TRIM(classificacao_do_servico) = 'Solicitação'`;
      const iaParams: (string | undefined)[] = [inicio, fim];
      if (subprefeitura) {
        iaSql += ` AND regional = $3`;
        iaParams.push(subprefeitura);
      }
      const iaTotal = await client.query(iaSql, iaParams);
      const iaRow = iaTotal.rows[0];
      const totalSolicitacoes = Number(iaRow?.total ?? 0);
      const noPrazo = Number(iaRow?.no_prazo ?? 0);
      const foraPrazo = Number(iaRow?.fora_prazo ?? 0);
      const totalCalculoIA = noPrazo + foraPrazo;
      const iaResult = pontuacaoIA(noPrazo, totalCalculoIA);

      // IRD: reclamações procedentes (total e por regional para tabela)
      let irdSql = `SELECT COUNT(*) AS total FROM sacs
         WHERE data_registro >= $1::date AND data_registro < ($2::date + interval '1 day')
           AND (finalizado_fora_de_escopo IS NULL OR UPPER(TRIM(finalizado_fora_de_escopo)) = 'NÃO')
           AND TRIM(classificacao_do_servico) = 'Reclamação'
           AND (procedente_por_status IS NOT NULL AND UPPER(TRIM(procedente_por_status)) = 'PROCEDE')`;
      const irdParams: (string | undefined)[] = [inicio, fim];
      if (subprefeitura) {
        irdSql += ` AND regional = $3`;
        irdParams.push(subprefeitura);
      }
      const irdCount = await client.query(irdSql, irdParams);
      const totalProcedentes = Number(irdCount.rows[0]?.total ?? 0);
      const irdResult = pontuacaoIRD(totalProcedentes);

      // IRD por regional (para tabela de visualização)
      const irdByRegional = await client.query(
        `SELECT regional, COUNT(*) AS total FROM sacs
         WHERE data_registro >= $1::date AND data_registro < ($2::date + interval '1 day')
           AND (finalizado_fora_de_escopo IS NULL OR UPPER(TRIM(finalizado_fora_de_escopo)) = 'NÃO')
           AND TRIM(classificacao_do_servico) = 'Reclamação'
           AND (procedente_por_status IS NOT NULL AND UPPER(TRIM(procedente_por_status)) = 'PROCEDE')
         GROUP BY regional`,
        [inicio, fim]
      );
      const irdPorRegional: Record<string, number> = {};
      for (const sigla of SUB_SIGLAS) irdPorRegional[sigla] = 0;
      for (const row of irdByRegional.rows as Array<{ regional: string; total: string }>) {
        const sigla = regionalToSigla(row.regional);
        if (sigla && irdPorRegional[sigla] !== undefined) {
          irdPorRegional[sigla] += Number(row.total ?? 0);
        }
      }
      const irdPorSub = SUB_SIGLAS.map((sigla) => ({
        subprefeitura: sigla,
        label: sigla === "CV" ? "Casa Verde / Limão / Cachoeirinha" : sigla === "JT" ? "Jaçanã / Tremembé" : sigla === "MG" ? "Vila Maria / Vila Guilherme" : "Santana / Tucuruvi",
        reclamacoes: irdPorRegional[sigla] ?? 0,
        domicilios: DOMICILIOS_POR_REGIONAL[sigla] ?? 0,
        ird_valor: (DOMICILIOS_POR_REGIONAL[sigla] ?? 0) > 0 ? ((irdPorRegional[sigla] ?? 0) / (DOMICILIOS_POR_REGIONAL[sigla] ?? 1)) * 1000 : 0,
      }));

      // IF: todos BFS no período EXCETO os 3 serviços excluídos; exclui fiscais SELIMP (coluna Fiscal "SELIMP -...")
      const ifExcludeSql = BFS_IF_EXCLUSAO_SQL.map((_, i) => `tipo_servico NOT ILIKE $${3 + i}`).join(" AND ");
      const ifFiscalSql = sqlBfsFiscalNaoEhSelimp();
      const ifByRegional = await client.query(
        `SELECT regional,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE TRIM(status) = 'Sem Irregularidades') AS sem_irregularidade
         FROM bfs
         WHERE data_fiscalizacao >= $1::date AND data_fiscalizacao < ($2::date + interval '1 day')
           AND ${ifExcludeSql}
           AND ${ifFiscalSql}
         GROUP BY regional`,
        [inicio, fim, ...BFS_IF_EXCLUSAO_SQL]
      );
      const ifBySigla: Record<string, { total: number; sem_irregularidade: number }> = {};
      for (const sigla of SUB_SIGLAS) ifBySigla[sigla] = { total: 0, sem_irregularidade: 0 };
      for (const row of ifByRegional.rows as Array<{ regional: string; total: string; sem_irregularidade: string }>) {
        const sigla = regionalToSigla(row.regional);
        if (sigla && ifBySigla[sigla]) {
          ifBySigla[sigla].total += Number(row.total ?? 0);
          ifBySigla[sigla].sem_irregularidade += Number(row.sem_irregularidade ?? 0);
        }
      }
      const mediaPercentualIf = calcularMediaIfPorSubprefeitura(ifBySigla);
      const ifResult = pontuacaoIFFromPercentual(mediaPercentualIf);
      const totalBfs = Object.values(ifBySigla).reduce((a, x) => a + x.total, 0);
      const semIrreg = Object.values(ifBySigla).reduce((a, x) => a + x.sem_irregularidade, 0);

      const periodo = { inicial: inicio, final: fim };

      // Formata número com separador de milhar (BR)
      const fmt = (n: number, dec = 0) => n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
      const fmt3 = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

      const ird = {
        valor: irdResult.valor,
        pontuacao: irdResult.pontuacao,
        total_reclamacoes: totalProcedentes,
        total_procedentes: totalProcedentes,
        domicilios,
        ird_por_regional: irdPorSub,
        tipos_considerados: ["Reclamação escalonada procedente"],
        filtros_aplicados: [
          "Data_Registro no período",
          "Finalizado_como_fora_de_escopo = NÃO",
          "Classificação_do_Serviço = Reclamação",
          "Procedente_por_status = PROCEDE",
        ],
        memoria_calculo:
          totalProcedentes >= 0 && domicilios > 0
            ? `IRD = (reclamações procedentes / domicílios) × 1000 = (${fmt(totalProcedentes)} / ${fmt(domicilios)}) × 1000 = ${fmt3(irdResult.valor)}`
            : "IRD = (reclamações procedentes / domicílios) × 1000 — Nenhuma reclamação procedente no período.",
      };

      // SAC por subprefeitura (demandantes + escalonados, para outras views)
      const sacPorSubRes = await client.query(
        `SELECT regional,
                COUNT(*) FILTER (WHERE TRIM(classificacao_do_servico) = 'Solicitação' AND (finalizado_fora_de_escopo IS NULL OR UPPER(TRIM(finalizado_fora_de_escopo)) = 'NÃO')) AS demandantes,
                COUNT(*) FILTER (WHERE TRIM(classificacao_do_servico) = 'Reclamação' AND (finalizado_fora_de_escopo IS NULL OR UPPER(TRIM(finalizado_fora_de_escopo)) = 'NÃO') AND (procedente_por_status IS NOT NULL AND UPPER(TRIM(procedente_por_status)) = 'PROCEDE')) AS escalonados
         FROM sacs
         WHERE data_registro >= $1::date AND data_registro < ($2::date + interval '1 day')
         GROUP BY regional`,
        [inicio, fim]
      );
      const sacPorRegional: Record<string, { demandantes: number; escalonados: number }> = {};
      for (const sigla of SUB_SIGLAS) sacPorRegional[sigla] = { demandantes: 0, escalonados: 0 };
      for (const row of sacPorSubRes.rows as Array<{ regional: string; demandantes: string; escalonados: string }>) {
        const sigla = regionalToSigla(row.regional);
        if (sigla && sacPorRegional[sigla]) {
          sacPorRegional[sigla].demandantes += Number(row.demandantes ?? 0);
          sacPorRegional[sigla].escalonados += Number(row.escalonados ?? 0);
        }
      }
      const sacPorSub = SUB_SIGLAS.map((sigla) => {
        const { demandantes, escalonados } = sacPorRegional[sigla];
        const total = demandantes + escalonados;
        return {
          subprefeitura: sigla,
          label: sigla === "CV" ? "Casa Verde / Limão / Cachoeirinha" : sigla === "JT" ? "Jaçanã / Tremembé" : sigla === "MG" ? "Vila Maria / Vila Guilherme" : "Santana / Tucuruvi",
          demandantes,
          escalonados,
          total,
        };
      });

      // IA por sub: no_prazo e fora_prazo (mesma base do cálculo IA: Solicitação, fora escopo NÃO, responsividade SIM/NÃO)
      const iaPorSubRes = await client.query(
        `SELECT regional,
                COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(responsividade_execucao, ''))) = 'SIM') AS no_prazo,
                COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(responsividade_execucao, ''))) = 'NÃO') AS fora_prazo
         FROM sacs
         WHERE data_registro >= $1::date AND data_registro < ($2::date + interval '1 day')
           AND (finalizado_fora_de_escopo IS NULL OR UPPER(TRIM(finalizado_fora_de_escopo)) = 'NÃO')
           AND TRIM(classificacao_do_servico) = 'Solicitação'
           AND (UPPER(TRIM(COALESCE(responsividade_execucao, ''))) = 'SIM' OR UPPER(TRIM(COALESCE(responsividade_execucao, ''))) = 'NÃO')
         GROUP BY regional`,
        [inicio, fim]
      );
      const iaPorRegional: Record<string, { no_prazo: number; fora_prazo: number }> = {};
      for (const sigla of SUB_SIGLAS) iaPorRegional[sigla] = { no_prazo: 0, fora_prazo: 0 };
      for (const row of iaPorSubRes.rows as Array<{ regional: string; no_prazo: string; fora_prazo: string }>) {
        const sigla = regionalToSigla(row.regional);
        if (sigla && iaPorRegional[sigla]) {
          iaPorRegional[sigla].no_prazo += Number(row.no_prazo ?? 0);
          iaPorRegional[sigla].fora_prazo += Number(row.fora_prazo ?? 0);
        }
      }
      const iaPorSub = SUB_SIGLAS.map((sigla) => {
        const { no_prazo, fora_prazo } = iaPorRegional[sigla];
        const solic_procedentes = no_prazo + fora_prazo;
        return {
          subprefeitura: sigla,
          label: sigla === "CV" ? "Casa Verde / Limão / Cachoeirinha" : sigla === "JT" ? "Jaçanã / Tremembé" : sigla === "MG" ? "Vila Maria / Vila Guilherme" : "Santana / Tucuruvi",
          no_prazo,
          fora_prazo,
          solic_procedentes,
        };
      });

      const sacForaPrazoPorSub = iaPorSub.map((r) => ({
        subprefeitura: r.subprefeitura,
        label: r.label,
        fora_prazo: r.fora_prazo,
      }));

      const totalSolic = totalSolicitacoes;
      const ia = {
        valor: iaResult.valor,
        percentual: iaResult.percentual ?? 0,
        pontuacao: iaResult.pontuacao,
        total_no_prazo: noPrazo,
        total_fora_prazo: foraPrazo,
        total_solicitacoes: totalSolic,
        total_calculo: totalCalculoIA,
        sac_por_sub: sacPorSub,
        sac_fora_prazo_por_sub: sacForaPrazoPorSub,
        ia_por_sub: iaPorSub,
        filtros_aplicados: [
          "Data_Registro no período",
          "Finalizado_como_fora_de_escopo = NÃO",
          "Classificação_do_Serviço = Solicitação",
          "No prazo = Responsividade_Execução = SIM",
          "Fora do prazo = Responsividade_Execução = NÃO (contagem explícita das linhas com NÃO)",
        ],
        memoria_calculo:
          totalCalculoIA > 0
            ? `IA = (no prazo / (no prazo + fora do prazo)) × 100 = (${fmt(noPrazo)} / ${fmt(totalCalculoIA)}) × 100 = ${(iaResult.percentual ?? iaResult.valor ?? 0).toFixed(2)}%\nNo prazo (SIM): ${fmt(noPrazo)} | Fora do prazo (NÃO): ${fmt(foraPrazo)} | Base total filtro: ${fmt(totalSolic)}`
            : "IA = (no prazo / (no prazo + fora do prazo)) × 100 — Sem linhas SIM/NÃO para o período filtrado.",
      };

      const ifPorSub = SUB_SIGLAS.map((sigla) => {
        const { total, sem_irregularidade } = ifBySigla[sigla];
        const pct = total > 0 ? (sem_irregularidade / total) * 100 : 0;
        const subResult = pontuacaoIFFromPercentual(pct);
        return {
          subprefeitura: sigla,
          sem_irregularidades: sem_irregularidade,
          vistorias_total: total,
          if_percentual: pct,
          media_mesclada: mediaPercentualIf,
          pontuacao_mesclada: ifResult.pontuacao,
          pontuacao_sub: subResult.pontuacao,
        };
      });

      const ifDetalhe = {
        valor: ifResult.valor,
        percentual: ifResult.percentual ?? 0,
        pontuacao: ifResult.pontuacao,
        total_fiscalizacoes: totalBfs,
        total_sem_irregularidade: semIrreg,
        total_com_irregularidade: totalBfs - semIrreg,
        status_referencia: "Sem Irregularidades",
        servicos_excluidos: [
          "Coleta e transporte de entulho e grandes objetos depositados irregularmente nas vias, logradouros e áreas públicas",
          "Fornecimento, instalação e reposição de papeleiras e outros equipamentos de recepção de resíduos",
          "Remoção de animais mortos de proprietários não identificados em vias e logradouros públicos",
          "Operação dos Ecopontos",
          "Remoção de Resíduos dos Ecopontos",
        ],
        if_por_sub: ifPorSub,
        filtros_aplicados: [
          "Data_Fiscalizacao no período",
          "Todos os BFS exceto 5 serviços: Coleta e transporte de entulho e grandes objetos...; Fornecimento, instalação e reposição de papeleiras...; Remoção de animais mortos de proprietários não identificados...; Operação dos Ecopontos; Remoção de Resíduos dos Ecopontos",
          "Exclui BFS cujo fiscal (coluna Fiscal) começa por \"SELIMP -\" (fiscalização interna SELIMP)",
          "Sem irregularidade = Status = 'Sem Irregularidades'",
          "Cálculo: IF por sub (JT, CV, ST, MG) = (sem irregularidades / total) × 100, média dos 4 = IF final",
        ],
        memoria_calculo:
          totalBfs > 0
            ? `IF = média das 4 subs: (JT: ${ifPorSub.find((s) => s.subprefeitura === "JT")?.if_percentual?.toFixed(1) ?? 0}% + CV: ${ifPorSub.find((s) => s.subprefeitura === "CV")?.if_percentual?.toFixed(1) ?? 0}% + ST: ${ifPorSub.find((s) => s.subprefeitura === "ST")?.if_percentual?.toFixed(1) ?? 0}% + MG: ${ifPorSub.find((s) => s.subprefeitura === "MG")?.if_percentual?.toFixed(1) ?? 0}%) / 4 = ${(ifResult.percentual ?? 0).toFixed(2)}%`
            : "IF = (média dos % por sub) — Nenhum BFS escalonado no período.",
      };

      const autoIptDetalhes = await getAutoIPTDetalhesFromReport(client, inicio, fim);
      const autoIptCenarios = await getAutoIPTCenariosFromReport(client, inicio, fim);
      const iptPercent = autoIptCenarios?.estimado.percentual ?? autoIptDetalhes?.percent ?? null;
      const ipt =
        iptPercent != null
          ? {
              ...pontuacaoIPT(iptPercent),
              valor: iptPercent,
              ipt_detalhes: autoIptDetalhes?.detalhes,
              ipt_cenarios: autoIptCenarios,
              filtros_aplicados: autoIptDetalhes
                ? [
                    "Prioridade: ipt_consolidado_veiculos / ipt_consolidado_varricao (datas e percentuais na planilha)",
                    "Se nao houver consolidado no periodo: ipt_report_selimp (Status Encerrado, plano, de_execucao)",
                    "Cenario estimado: PF otimista quando zeros encerrados estao abaixo do limite critico; media conservadora por plano quando zeros ficam criticos",
                  ]
                : [
                    "Sem dados IPT no periodo — importe as planilhas consolidadas (Upload, secao prioritaria) ou o Report SELIMP",
                  ],
            }
          : undefined;

      const pontuacaoTotal = (irdResult.pontuacao ?? 0) + (iaResult.pontuacao ?? 0) + (ifResult.pontuacao ?? 0) + (ipt?.pontuacao ?? 0);
      const descontoInfo = descontoADC(pontuacaoTotal);
      const descontoPercent = Math.max(0, 100 - descontoInfo.percentualRecebimento);
      const valorMensalDetalhe = config.valorMensalContrato;
      const glosaReal = valorMensalDetalhe * (descontoPercent / 100);

      return {
        periodo,
        subprefeitura: subprefeitura ?? null,
        ird,
        ia,
        if: ifDetalhe,
        ipt,
        resumo_adc: {
          pontuacao_total: pontuacaoTotal,
          percentual_contrato: descontoInfo.percentualRecebimento,
          desconto: descontoPercent,
          valor_mensal_contrato: valorMensalDetalhe,
          glosa_real: glosaReal,
        },
      };
    } finally {
      client.release();
    }
  });

  fastify.get<{
    Querystring: { tipo?: DashboardIndicadorTipo; periodo_inicial?: string; periodo_final?: string };
  }>("/dashboard/indicadores/historico", async (request, reply) => {
    const tipo = String(request.query.tipo ?? "ADC").toUpperCase() as DashboardIndicadorTipo;
    const inicio = String(request.query.periodo_inicial ?? "").trim();
    const fim = String(request.query.periodo_final ?? "").trim();
    if (!["IA", "IRD", "IF", "IPT", "ADC"].includes(tipo)) {
      return reply.code(400).send({ detail: "tipo deve ser IA, IRD, IF, IPT ou ADC." });
    }
    if (!isDateYmd(inicio) || !isDateYmd(fim) || inicio > fim) {
      return reply.code(400).send({ detail: "Informe periodo_inicial e periodo_final validos (YYYY-MM-DD)." });
    }

    const client = await pool.connect();
    try {
      const r = await client.query(
        `SELECT
           id,
           snapshot_at,
           periodo_inicial::text AS periodo_inicial,
           periodo_final::text AS periodo_final,
           periodo_tipo,
           valor,
           percentual,
           pontuacao,
           quantidade_base,
           source_file,
           metadata
         FROM metric_snapshots
         WHERE snapshot_type = 'indicador'
           AND metric_key = $1
           AND periodo_final >= $2::date
           AND periodo_inicial <= $3::date
         ORDER BY snapshot_at, id`,
        [tipo, inicio, fim]
      );
      const historico = r.rows.map((row: any) => ({
        id: Number(row.id),
        data: row.snapshot_at instanceof Date ? row.snapshot_at.toISOString() : row.snapshot_at,
        tipo,
        valor: row.valor != null ? Number(row.valor) : row.percentual != null ? Number(row.percentual) : null,
        percentual: row.percentual != null ? Number(row.percentual) : null,
        pontuacao: row.pontuacao != null ? Number(row.pontuacao) : null,
        periodo_inicial: row.periodo_inicial,
        periodo_final: row.periodo_final,
        periodo_tipo: row.periodo_tipo,
        quantidade_base: Number(row.quantidade_base ?? 0),
        source_file: row.source_file,
        metadata: row.metadata ?? {},
      }));
      return { tipo, periodo: { inicial: inicio, final: fim }, historico };
    } finally {
      client.release();
    }
  });

  fastify.get<{
    Querystring: { tipo_servico?: string; periodo_inicial?: string; periodo_final?: string };
  }>("/ipt/snapshots/servicos", async (request, reply) => {
    const tipoServico = String(request.query.tipo_servico ?? "").trim();
    const inicio = String(request.query.periodo_inicial ?? "").trim();
    const fim = String(request.query.periodo_final ?? "").trim();
    if (!tipoServico) return reply.code(400).send({ detail: "tipo_servico e obrigatorio." });
    if (!isDateYmd(inicio) || !isDateYmd(fim) || inicio > fim) {
      return reply.code(400).send({ detail: "Informe periodo_inicial e periodo_final validos (YYYY-MM-DD)." });
    }

    const client = await pool.connect();
    try {
      const r = await client.query(
        `SELECT
           id,
           snapshot_at,
           metric_key,
           metric_label,
           periodo_inicial::text AS periodo_inicial,
           periodo_final::text AS periodo_final,
           periodo_tipo,
           percentual,
           percentual_dia,
           media_sem_zerados,
           quantidade_planos,
           total_despachos,
           total_despachos_dia,
           despachos_zerados,
           despachos_zerados_dia,
           source_file,
           metadata,
           updated_at
         FROM metric_snapshots
         WHERE snapshot_type = 'ipt_servico_acc'
           AND metric_label = $1
           AND periodo_final >= $2::date
           AND periodo_final <= $3::date
         ORDER BY periodo_final, id`,
        [tipoServico, inicio, fim]
      );
      const snapshotRows = r.rows as Array<any>;
      const minPeriodoInicial = snapshotRows.reduce<string | null>((min, row) => {
        const value = String(row.periodo_inicial ?? "").slice(0, 10);
        if (!value) return min;
        return min == null || value < min ? value : min;
      }, null);
      const maxPeriodoFinal = snapshotRows.reduce<string | null>((max, row) => {
        const value = String(row.periodo_final ?? "").slice(0, 10);
        if (!value) return max;
        return max == null || value > max ? value : max;
      }, null);
      const plannedByDay = new Map<string, { total: number; naoDespachados: number }>();
      if (minPeriodoInicial && maxPeriodoFinal) {
        const plannedRes = await client.query(
          `SELECT plano, tipo_servico, status, data_estimada::date::text AS data_ref
           FROM ipt_report_linhas
           WHERE data_estimada >= $1::date
             AND data_estimada <= $2::date
             AND LOWER(COALESCE(status, '')) NOT LIKE '%cancel%'`,
          [minPeriodoInicial, maxPeriodoFinal]
        );
        for (const row of plannedRes.rows as Array<{
          plano: string | null;
          tipo_servico: string | null;
          status: string | null;
          data_ref: string | null;
        }>) {
          const plano = normalizarSetor(String(row.plano ?? "").trim());
          if (!plano || !row.data_ref) continue;
          const label = resolveTipoServicoExibicao(plano, row.tipo_servico ?? "") || row.tipo_servico || "Nao informado";
          if (label !== tipoServico) continue;
          const day = String(row.data_ref).slice(0, 10);
          const current = plannedByDay.get(day) ?? { total: 0, naoDespachados: 0 };
          current.total += 1;
          if (normalizeMatchText(String(row.status ?? "")).includes("nao despach")) {
            current.naoDespachados += 1;
          }
          plannedByDay.set(day, current);
        }
      }
      const plannedForRange = (start: string, end: string) => {
        let total = 0;
        let naoDespachados = 0;
        for (const [day, value] of plannedByDay.entries()) {
          if (day >= start && day <= end) {
            total += value.total;
            naoDespachados += value.naoDespachados;
          }
        }
        return { total, naoDespachados };
      };
      return {
        tipo_servico: tipoServico,
        periodo: { inicial: inicio, final: fim },
        pontos: snapshotRows.map((row: any) => {
          const periodoInicial = String(row.periodo_inicial ?? "").slice(0, 10);
          const periodoFinal = String(row.periodo_final ?? "").slice(0, 10);
          const plannedAcc = plannedForRange(periodoInicial, periodoFinal);
          const plannedDay = plannedByDay.get(periodoFinal) ?? { total: 0, naoDespachados: 0 };
          const totalDespachos = Number(row.total_despachos ?? 0);
          const totalDespachosDia = Number(row.total_despachos_dia ?? 0);
          return {
            id: Number(row.id),
            snapshot_at: row.snapshot_at instanceof Date ? row.snapshot_at.toISOString() : row.snapshot_at,
            metric_key: row.metric_key,
            metric_label: row.metric_label,
            periodo_inicial: row.periodo_inicial,
            periodo_final: row.periodo_final,
            periodo_tipo: row.periodo_tipo,
            percentual: row.percentual != null ? Number(row.percentual) : null,
            percentual_dia: row.percentual_dia != null ? Number(row.percentual_dia) : null,
            media_sem_zerados: row.media_sem_zerados != null ? Number(row.media_sem_zerados) : null,
            quantidade_planos: Number(row.quantidade_planos ?? 0),
            total_despachos: totalDespachos,
            total_despachos_dia: totalDespachosDia,
            despachos_previstos: plannedAcc.total,
            despachos_previstos_dia: plannedDay.total,
            despachos_nao_despachados: plannedAcc.naoDespachados,
            despachos_nao_despachados_dia: plannedDay.naoDespachados,
            cobertura_despachos: plannedAcc.total > 0 ? Number(((totalDespachos / plannedAcc.total) * 100).toFixed(2)) : null,
            cobertura_despachos_dia: plannedDay.total > 0 ? Number(((totalDespachosDia / plannedDay.total) * 100).toFixed(2)) : null,
            despachos_zerados: Number(row.despachos_zerados ?? 0),
            despachos_zerados_dia: Number(row.despachos_zerados_dia ?? 0),
            source_file: row.source_file,
            metadata: row.metadata ?? {},
            updated_at: row.updated_at,
          };
        }),
      };
    } finally {
      client.release();
    }
  });

  /** Diagnóstico: meses com report SELIMP em ipt_report_linhas. */
  fastify.get("/indicadores/ipt-selimp-diagnostico", async (_request, reply) => {
    const client = await pool.connect();
    try {
      const r = await client.query(
        `SELECT
           EXTRACT(YEAR FROM periodo_inicial)::int AS ano,
           EXTRACT(MONTH FROM periodo_inicial)::int AS mes,
           COUNT(*)::int AS total_linhas,
           COUNT(*) FILTER (
             WHERE LOWER(COALESCE(status, '')) LIKE '%encerrado%'
           )::int AS total_encerradas,
           MAX(source_file) AS source_file,
           MAX(updated_at) AS updated_at
         FROM ipt_report_linhas
         GROUP BY 1, 2
         ORDER BY ano, mes`
      );
      return { meses: r.rows };
    } finally {
      client.release();
    }
  });

  /** IPT por mês: quantidade de ordens e percentual (sempre calculado da planilha). */
  fastify.get<{ Querystring: { ano?: string } }>("/indicadores/ipt-por-mes", async (request, reply) => {
    const ano = Number((request.query as { ano?: string })?.ano ?? new Date().getFullYear());
    if (!Number.isFinite(ano) || ano < 2020 || ano > 2030) {
      return reply.code(400).send({ detail: "ano inválido (2020-2030)" });
    }
    const client = await pool.connect();
    try {
      const meses: Array<{ mes: number; quantidade: number; percentual: number | null }> = [];
      for (let m = 1; m <= 12; m++) {
        const inicio = `${ano}-${String(m).padStart(2, "0")}-01`;
        const ultimoDia = new Date(ano, m, 0).getDate();
        const fim = `${ano}-${String(m).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;
        const { ordens } = await fetchOrdensSelimpNoPeriodo(client, inicio, fim);
        const quantidade = ordens.length;
        const percentual = quantidade > 0 ? await getAutoIPTFromReport(client, inicio, fim) : null;
        meses.push({
          mes: m,
          quantidade,
          percentual: percentual != null ? percentual : null,
        });
      }
      return { ano, meses };
    } finally {
      client.release();
    }
  });

  /**
   * IPT Conservador — variantes paralelas + diagnóstico.
   *
   * Retorna 7 variantes (v1..v7) e um diagnóstico (zeros, planos zerados, subs críticas)
   * para permitir comparação entre o IPT otimista atual e proxies SELIMP. Não substitui
   * /dashboard/indicadores; é um endpoint paralelo para acompanhamento de risco de glosa.
   *
   * Query: ?periodo_inicial=YYYY-MM-DD&periodo_final=YYYY-MM-DD
   */
  fastify.get<{
    Querystring: { periodo_inicial?: string; periodo_final?: string };
  }>("/indicadores/ipt-conservador", async (request, reply) => {
    const inicio = String(request.query.periodo_inicial ?? "").trim();
    const fim = String(request.query.periodo_final ?? "").trim();
    if (!isDateYmd(inicio) || !isDateYmd(fim) || inicio > fim) {
      return reply.code(400).send({ detail: "Informe periodo_inicial e periodo_final validos (YYYY-MM-DD)." });
    }
    const client = await pool.connect();
    try {
      const { linhas, fonte } = await fetchLinhasParaConservador(client, inicio, fim);
      const resposta = montarRespostaConservador({ inicio, fim, fonte }, linhas);
      return resposta;
    } finally {
      client.release();
    }
  });

  /**
   * Evolucao diaria por servico — alimenta a visualizacao "estamos indo bem ou nao".
   *
   * Le snapshot_type = 'ipt_servico_diario' (gravado a cada upload do consolidado),
   * agrupado por dia. Sem agregacao artificial: cada linha eh o valor de uma planilha
   * importada. Permite filtrar por servico e periodo.
   *
   * Query: ?tipo_servico=... &periodo_inicial=YYYY-MM-DD &periodo_final=YYYY-MM-DD
   */
  fastify.get<{
    Querystring: { tipo_servico?: string; periodo_inicial?: string; periodo_final?: string };
  }>("/indicadores/ipt-servico-evolucao", async (request, reply) => {
    const tipo = String(request.query.tipo_servico ?? "").trim();
    const inicio = String(request.query.periodo_inicial ?? "").trim();
    const fim = String(request.query.periodo_final ?? "").trim();
    if (!isDateYmd(inicio) || !isDateYmd(fim) || inicio > fim) {
      return reply.code(400).send({ detail: "periodo_inicial e periodo_final obrigatorios (YYYY-MM-DD)." });
    }
    const client = await pool.connect();
    try {
      const params: any[] = [inicio, fim];
      let filterServico = "";
      if (tipo) {
        params.push(tipo);
        filterServico = ` AND metric_label = $${params.length}`;
      }
      const r = await client.query(
        `SELECT
           periodo_final::text AS data,
           metric_key,
           metric_label AS tipo_servico,
           percentual,
           percentual_dia,
           media_sem_zerados,
           quantidade_planos,
           total_despachos,
           total_despachos_dia,
           despachos_zerados,
           despachos_zerados_dia,
           source_file,
           snapshot_at
         FROM metric_snapshots
         WHERE snapshot_type = 'ipt_servico_acc'
           AND periodo_final >= $1::date
           AND periodo_final <= $2::date
           ${filterServico}
         ORDER BY periodo_final, metric_label`,
        params,
      );
      return {
        periodo: { inicio, fim },
        tipo_servico: tipo || null,
        pontos: r.rows.map((row: any) => ({
          data: row.data,
          tipo_servico: row.tipo_servico,
          metric_key: row.metric_key,
          percentual_com_zeros: row.percentual != null ? Number(row.percentual) : null,
          percentual_dia: row.percentual_dia != null ? Number(row.percentual_dia) : null,
          percentual_sem_zeros: row.media_sem_zerados != null ? Number(row.media_sem_zerados) : null,
          planos: Number(row.quantidade_planos ?? 0),
          despachos: Number(row.total_despachos ?? 0),
          despachos_dia: Number(row.total_despachos_dia ?? 0),
          zerados: Number(row.despachos_zerados ?? 0),
          zerados_dia: Number(row.despachos_zerados_dia ?? 0),
          source_file: row.source_file,
          snapshot_at: row.snapshot_at,
        })),
      };
    } finally {
      client.release();
    }
  });

  /**
   * Lista todos os servicos com snapshot no periodo (para popular dropdown da viz).
   */
  fastify.get<{
    Querystring: { periodo_inicial?: string; periodo_final?: string };
  }>("/indicadores/ipt-servicos-disponiveis", async (request, reply) => {
    const inicio = String(request.query.periodo_inicial ?? "").trim();
    const fim = String(request.query.periodo_final ?? "").trim();
    if (!isDateYmd(inicio) || !isDateYmd(fim) || inicio > fim) {
      return reply.code(400).send({ detail: "periodo_inicial e periodo_final obrigatorios (YYYY-MM-DD)." });
    }
    const client = await pool.connect();
    try {
      const r = await client.query(
        `SELECT DISTINCT metric_label AS tipo_servico, metric_key
         FROM metric_snapshots
         WHERE snapshot_type = 'ipt_servico_acc'
           AND periodo_final >= $1::date
           AND periodo_final <= $2::date
         ORDER BY 1`,
        [inicio, fim],
      );
      return { servicos: r.rows };
    } finally {
      client.release();
    }
  });

  fastify.get<{
    Querystring: { periodo_inicial?: string; periodo_final?: string; mostrar_todos?: string; subprefeitura?: string };
  }>("/dashboard/ipt-preview", async (request, reply) => {
    const { periodo_inicial: inicio, periodo_final: fim, mostrar_todos, subprefeitura: subFilter } = request.query;
    const showAll = mostrar_todos === "1";
    const yesterdayKey = getYesterdayDateKeyBrt();

    let escopo: "dia_anterior" | "periodo" | "todos" = "periodo";
    let scopeStart: string | null = inicio ?? yesterdayKey;
    let scopeEnd: string | null = fim ?? yesterdayKey;
    if (showAll) {
      escopo = "todos";
      scopeStart = null;
      scopeEnd = null;
    } else if (inicio && fim) {
      escopo = "periodo";
      scopeStart = inicio;
      scopeEnd = fim;
    } else {
      scopeStart = yesterdayKey;
      scopeEnd = yesterdayKey;
      escopo = "dia_anterior";
    }

    const key = cacheKey("ipt_preview", {
      periodo_inicial: inicio,
      periodo_final: fim,
      mostrar_todos: mostrar_todos ?? "",
      subprefeitura: subFilter ?? "",
      ...(escopo === "dia_anterior" && scopeStart ? { ref_dia: scopeStart } : {}),
    });
    const payload = await getOrSet(key, async () => {
      const client = await pool.connect();
      try {
        return await buildIptPreviewFromConsolidado(client, {
          escopo,
          scopeStart,
          scopeEnd,
          subFilter: subFilter ?? "",
          yesterdayKey,
        });
      } finally {
        client.release();
      }
    });
    return payload;
  });

  /** Diagnóstico: contagens e amostra de ipt_imports para debugar DDMX/SELIMP */
  fastify.get("/dashboard/ipt-diagnostico", async (_request, reply) => {
    const client = await pool.connect();
    try {
      const counts = await client.query(
        `SELECT file_type, COUNT(*)::int AS total, MAX(updated_at) AS ultimo
         FROM ipt_imports
         GROUP BY file_type
         ORDER BY file_type`
      );
      const ddmxAmostra = await client.query(
        `SELECT id, file_type, setor, data_referencia,
          raw->>'rota' AS rota, raw->>'plano' AS plano, raw->>'percentual_execucao' AS pct,
          raw->>'data_planejado' AS data_planejado, updated_at
         FROM ipt_imports
         WHERE file_type IN ('ipt_historico_os', 'ipt_historico_os_varricao', 'ipt_historico_os_compactadores')
         ORDER BY updated_at DESC
         LIMIT 15`
      );
      const selimpAmostra = await client.query(
        `SELECT id, file_type, setor, data_referencia,
          raw->>'plano' AS plano, raw->>'de_execucao' AS pct, raw->>'status' AS status, updated_at
         FROM ipt_imports
         WHERE file_type = 'ipt_report_selimp'
         ORDER BY updated_at DESC
         LIMIT 15`
      );
      return {
        contagem_por_tipo: counts.rows,
        ddmx_amostra: ddmxAmostra.rows,
        selimp_amostra: selimpAmostra.rows,
      };
    } finally {
      client.release();
    }
  });

  /** IPT: Observações globais e diárias - GET (lista por período) */
  fastify.get<{
    Querystring: { scope_start?: string; scope_end?: string };
  }>("/ipt/observacoes", async (request, reply) => {
    const { scope_start: scopeStart, scope_end: scopeEnd } = request.query;
    const client = await pool.connect();
    try {
      const globaisRes = await client.query(
        `SELECT id, setor, titulo, descricao, data_cancelamento, created_at
         FROM ipt_observacoes_globais
         WHERE data_cancelamento IS NULL
         ORDER BY setor`
      );
      const globais = globaisRes.rows.reduce(
        (acc: Record<string, { id: number; titulo: string; descricao: string | null }>, row: { setor: string; id: number; titulo: string; descricao: string | null }) => {
          acc[row.setor] = { id: row.id, titulo: row.titulo, descricao: row.descricao };
          return acc;
        },
        {}
      );

      let diarias: Record<string, Record<string, { id: number; titulo: string; descricao: string | null }>> = {};
      if (scopeStart && scopeEnd) {
        const diariasRes = await client.query(
          `SELECT id, setor, data::text AS data, titulo, descricao
           FROM ipt_observacoes_diarias
           WHERE data >= $1::date AND data <= $2::date
             AND data_cancelamento IS NULL
           ORDER BY setor, data`,
          [scopeStart, scopeEnd]
        );
        for (const row of diariasRes.rows as Array<{ setor: string; data: string; id: number; titulo: string; descricao: string | null }>) {
          const dataKey = row.data.replace(/T.*/, "");
          if (!diarias[row.setor]) diarias[row.setor] = {};
          diarias[row.setor][dataKey] = { id: row.id, titulo: row.titulo, descricao: row.descricao };
        }
      }
      return { globais, diarias };
    } finally {
      client.release();
    }
  });

  /**
   * IPT/Despachos: cronograma do plano de trabalho vigente por setor.
   * Retorna `modelo`, `dias_semana` (fixos) e `datas` (escalonados) para a página de
   * Despachos calcular o "esperado" por dia a partir do plano real.
   * Filtros opcionais: subprefeitura (sigla CV/JT/MG/ST), servico (código 2 letras), modelo.
   */
  fastify.get<{
    Querystring: { subprefeitura?: string; servico?: string; modelo?: string };
  }>("/ipt/despachos/cronograma", async (request) => {
    const q = request.query ?? {};
    const setores = await listCronogramaSetores({
      subSigla: q.subprefeitura?.trim() || undefined,
      servico: q.servico?.trim() || undefined,
      modelo: q.modelo?.trim() || undefined,
    });
    return {
      total: setores.length,
      setores: setores.map((s) => ({
        setor: s.setor,
        modelo: s.modelo,
        servico: s.servico,
        subprefeitura: s.subprefeitura,
        sub_sigla: s.subSigla,
        frequencia_texto: s.frequenciaTexto,
        frequencia_codigo: s.frequenciaCodigo,
        turno: s.turno,
        local: s.local,
        feira: s.feira,
        dias_semana: s.diasSemana,
        ano_plano: s.anoPlano,
        datas: s.datas,
      })),
    };
  });

  /**
   * Despachos SELIMP — visão do dia: cruza cronograma (esperado) × lançamentos
   * (despachos_diarios) × Report SELIMP (percentual histórico). Retorna kpis, linhas
   * (só acionáveis) e tendência de 14 dias. Filtros: subprefeitura (sigla), servico, turno.
   */
  fastify.get<{
    Querystring: { dia?: string; subprefeitura?: string; servico?: string; turno?: string };
  }>("/ipt/despachos", async (request, reply) => {
    const q = request.query ?? {};
    const dia = (q.dia ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
      return reply.code(400).send({ detail: "Parâmetro 'dia' (YYYY-MM-DD) obrigatório." });
    }
    return buildDespachosResponse(dia, {
      subprefeitura: q.subprefeitura?.trim() || undefined,
      servico: q.servico?.trim() || undefined,
      turno: q.turno?.trim() || undefined,
    });
  });

  /**
   * Despachos SELIMP — importa a colagem da grade da SELIMP para um dia.
   * Extrai os setores despachados, cruza com o cronograma e grava em despachos_diarios.
   * `dryRun: true` retorna a prévia sem gravar.
   */
  fastify.post<{
    Body: { dia?: string; texto?: string; dryRun?: boolean };
  }>("/ipt/despachos/colar", async (request, reply) => {
    const { dia, texto, dryRun } = request.body ?? {};
    if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
      return reply.code(400).send({ detail: "Parâmetro 'dia' (YYYY-MM-DD) obrigatório." });
    }
    if (!texto || !texto.trim()) {
      return reply.code(400).send({ detail: "Cole a grade de despachos da SELIMP no campo de texto." });
    }
    const result = await colarDespachos(dia, texto, { dryRun: dryRun === true });
    if (!dryRun) invalidatePrefix("ipt_preview");
    return result;
  });

  /** IPT: Despacho manual de uma seleção de setores. */
  fastify.post<{
    Body: { dia?: string; setores?: string[] };
  }>("/ipt/despachos/manual", async (request, reply) => {
    const { dia, setores } = request.body ?? {};
    if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
      return reply.code(400).send({ detail: "Parâmetro 'dia' (YYYY-MM-DD) obrigatório." });
    }
    if (!Array.isArray(setores) || setores.length === 0) {
      return reply.code(400).send({ detail: "Selecione ao menos um setor para despachar." });
    }
    const result = await despacharManual(dia, setores);
    invalidatePrefix("ipt_preview");
    return result;
  });

  /** IPT: Criar observação global */
  fastify.post<{
    Body: { setor: string; titulo: string; descricao?: string };
  }>("/ipt/observacoes/globais", async (request, reply) => {
    const { setor, titulo, descricao } = request.body ?? {};
    if (!setor?.trim() || !titulo?.trim()) {
      return reply.code(400).send({ detail: "setor e titulo são obrigatórios" });
    }
    const client = await pool.connect();
    try {
      const r = await client.query(
        `INSERT INTO ipt_observacoes_globais (setor, titulo, descricao, updated_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id, setor, titulo, descricao`,
        [setor.trim(), titulo.trim(), descricao?.trim() || null]
      );
      invalidatePrefix("ipt_preview");
      return r.rows[0];
    } finally {
      client.release();
    }
  });

  /** IPT: Cancelar observação global (registra data_cancelamento) */
  fastify.post<{
    Params: { id: string };
  }>("/ipt/observacoes/globais/:id/cancelar", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return reply.code(400).send({ detail: "ID inválido" });
    }
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE ipt_observacoes_globais SET data_cancelamento = NOW(), updated_at = NOW() WHERE id = $1`,
        [id]
      );
      invalidatePrefix("ipt_preview");
      return { ok: true };
    } finally {
      client.release();
    }
  });

  /** IPT: Criar observação diária */
  fastify.post<{
    Body: { setor: string; data: string; titulo: string; descricao?: string };
  }>("/ipt/observacoes/diarias", async (request, reply) => {
    const { setor, data, titulo, descricao } = request.body ?? {};
    if (!setor?.trim() || !data || !titulo?.trim()) {
      return reply.code(400).send({ detail: "setor, data e titulo são obrigatórios" });
    }
    const dataNorm = data.replace(/T.*/, "");
    const client = await pool.connect();
    try {
      const r = await client.query(
        `INSERT INTO ipt_observacoes_diarias (setor, data, titulo, descricao, updated_at)
         VALUES ($1, $2::date, $3, $4, NOW())
         RETURNING id, setor, data::text AS data, titulo, descricao`,
        [setor.trim(), dataNorm, titulo.trim(), descricao?.trim() || null]
      );
      invalidatePrefix("ipt_preview");
      return r.rows[0];
    } finally {
      client.release();
    }
  });

  /** IPT: Cancelar observação diária (registra data_cancelamento) */
  fastify.post<{
    Params: { id: string };
  }>("/ipt/observacoes/diarias/:id/cancelar", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return reply.code(400).send({ detail: "ID inválido" });
    }
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE ipt_observacoes_diarias SET data_cancelamento = NOW(), updated_at = NOW() WHERE id = $1`,
        [id]
      );
      invalidatePrefix("ipt_preview");
      return { ok: true };
    } finally {
      client.release();
    }
  });

  fastify.get<{
    Querystring: { inicio: string; fim: string };
  }>("/ipt/report-diario", async (request, reply) => {
    const { inicio, fim } = request.query;
    if (!inicio || !fim) {
      return reply.code(400).send({ detail: "Informe inicio e fim (YYYY-MM-DD)." });
    }

    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT
           data_estimada::text AS data,
           COUNT(*)::int AS total_linhas,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) LIKE '%encerrado%')::int AS encerradas,
           ROUND(AVG(percentual_execucao) FILTER (WHERE LOWER(COALESCE(status, '')) LIKE '%encerrado%'), 2) AS media_percentual,
           COUNT(DISTINCT plano) FILTER (WHERE LOWER(COALESCE(status, '')) LIKE '%encerrado%')::int AS planos_distintos,
           jsonb_object_agg(
             COALESCE(confianca_estimativa, 'desconhecida'),
             (SELECT COUNT(*) FROM ipt_report_linhas r2
              WHERE r2.data_estimada = ipt_report_linhas.data_estimada
                AND r2.confianca_estimativa = ipt_report_linhas.confianca_estimativa
                AND r2.periodo_inicial >= $1::date AND r2.periodo_final <= $2::date)
           ) FILTER (WHERE confianca_estimativa IS NOT NULL) AS confianca_dist
         FROM ipt_report_linhas
         WHERE data_estimada >= $1::date AND data_estimada <= $2::date
         GROUP BY data_estimada
         ORDER BY data_estimada`,
        [inicio, fim]
      );

      const dias = res.rows.map((row: any) => {
        const encerradas = Number(row.encerradas ?? 0);
        const total = Number(row.total_linhas ?? 0);
        return {
          data: row.data,
          total_linhas: total,
          encerradas,
          media_percentual: row.media_percentual != null ? Number(row.media_percentual) : null,
          planos_distintos: Number(row.planos_distintos ?? 0),
          taxa_encerramento: total > 0 ? Number(((encerradas / total) * 100).toFixed(2)) : 0,
        };
      });

      return {
        periodo: { inicio, fim },
        dias,
        total_dias: dias.length,
        total_linhas: dias.reduce((s: number, d: any) => s + d.total_linhas, 0),
        total_encerradas: dias.reduce((s: number, d: any) => s + d.encerradas, 0),
      };
    } finally {
      client.release();
    }
  });

  fastify.post<{
    Querystring: { periodo_inicial: string; periodo_final: string; percentual_total: string };
  }>("/indicadores/salvar/ipt", async (request, reply) => {
    const { periodo_inicial: inicio, periodo_final: fim, percentual_total } = request.query;
    if (!inicio || !fim || percentual_total == null) {
      return reply.code(400).send({ detail: "periodo_inicial, periodo_final e percentual_total são obrigatórios" });
    }
    const percentual = Number(percentual_total);
    if (!Number.isFinite(percentual) || percentual < 0 || percentual > 100) {
      return reply.code(400).send({ detail: "percentual_total deve ser um número entre 0 e 100" });
    }

    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO ipt_registros (periodo_inicial, periodo_final, percentual_total, updated_at)
         VALUES ($1::date, $2::date, $3, NOW())
         ON CONFLICT (periodo_inicial, periodo_final)
         DO UPDATE SET percentual_total = EXCLUDED.percentual_total, updated_at = NOW()`,
        [inicio, fim, percentual]
      );
      invalidatePrefix("kpis");
      const ipt = pontuacaoIPT(percentual);
      return {
        ok: true,
        periodo_inicial: inicio,
        periodo_final: fim,
        percentual_total: percentual,
        pontuacao: ipt.pontuacao,
      };
    } finally {
      client.release();
    }
  });

  fastify.get("/dashboard/ipt-modulos-bateria", async (_request, reply) => {
    const cacheResult = await getOrSet(
      cacheKey("ipt_modulos_bateria", {}),
      async () => {
        const metaRow = await pool.query<{
          source_file: string | null;
          updated_at: Date | null;
          total_registros: number;
        }>(
          `SELECT
             MAX(source_file) AS source_file,
             MAX(updated_at) AS updated_at,
             COUNT(*)::int AS total_registros
           FROM modulo_selimp`
        );
        const meta = metaRow.rows[0];

        const result = await pool.query(
          `SELECT
             id,
             modulo_selimp,
             setores,
             sub,
             dias_execucao,
             setores_dias,
             comunicacao,
             ultima_comunicacao,
             bateria_raw,
             bateria_percentual,
             status_bateria,
             data_selimp::text AS data_selimp,
             qtd_trocas,
             dias_on,
             dias_off,
             produtividade_bateria,
             status_sinal_calculado,
             status_sinal_manual
           FROM modulo_selimp
           ORDER BY setores NULLS LAST, modulo_selimp`
        );

        // ---- Enriquecimento por setor (km, praça, execução) + série temporal ----
        // Todas as queries são resilientes: falha em uma não derruba o endpoint.
        const PERIODO_DIAS = 30;
        const execMap = new Map<string, number>();
        const execHistoryMap = new Map<string, Array<{ data: string; percentual: number }>>();
        const kmMap = new Map<string, number>();
        const pracaMap = new Map<string, string>();
        const offStreakMap = new Map<string, number>();
        let evolucaoProdutividade: { data: string; produtividade: number }[] = [];
        // Execução SELIMP por tipo de serviço × subprefeitura (mês corrente) — gráfico "Produtividade dos Setores".
        let execucaoPorServicoSub: { servico: string; sub: string; execucao: number }[] = [];

        await Promise.all([
          // % de execução por setor (ipt_report_linhas, encerrados, últimos 30 dias)
          (async () => {
            try {
              const rows = await pool.query<{ plano: string; data: string; pct: string | null }>(
                `SELECT plano,
                        to_char(data_estimada, 'YYYY-MM-DD') AS data,
                        AVG(CASE WHEN percentual_execucao > 1 THEN percentual_execucao ELSE percentual_execucao * 100 END) AS pct
                   FROM ipt_report_linhas
                  WHERE data_estimada >= (CURRENT_DATE - $1::int)
                    AND LOWER(COALESCE(status, '')) LIKE '%encerrad%'
                    AND percentual_execucao IS NOT NULL
                  GROUP BY plano, data_estimada
                  ORDER BY data_estimada DESC, plano`,
                [PERIODO_DIAS],
              );
              for (const r of rows.rows) {
                const key = normalizarSetor(r.plano);
                if (!key || r.pct == null) continue;
                const percentual = Math.round(Number(r.pct) * 100) / 100;
                if (!Number.isFinite(percentual)) continue;
                const list = execHistoryMap.get(key) ?? [];
                list.push({ data: r.data, percentual });
                execHistoryMap.set(key, list);
              }
              for (const [key, list] of execHistoryMap) {
                const media = list.length > 0
                  ? list.reduce((sum, item) => sum + item.percentual, 0) / list.length
                  : null;
                if (media != null) execMap.set(key, Math.round(media * 100) / 100);
              }
            } catch {
              /* execução é opcional */
            }
          })(),
          // KM de produção por setor (setores_modulos)
          (async () => {
            try {
              const rows = await pool.query<{ setor: string; km_prod: string | null }>(
                `SELECT setor, km_prod FROM setores_modulos WHERE setor IS NOT NULL AND km_prod IS NOT NULL`,
              );
              for (const r of rows.rows) {
                const key = normalizarSetor(r.setor);
                if (key && r.km_prod != null) kmMap.set(key, Number(r.km_prod));
              }
            } catch {
              /* km é opcional */
            }
          })(),
          // Praça / local por setor (cronograma_setores)
          (async () => {
            try {
              const rows = await pool.query<{ setor: string; local: string | null }>(
                `SELECT setor, local FROM cronograma_setores WHERE setor IS NOT NULL AND local IS NOT NULL AND TRIM(local) <> ''`,
              );
              for (const r of rows.rows) {
                const key = normalizarSetor(r.setor);
                if (key && r.local) pracaMap.set(key, String(r.local));
              }
            } catch {
              /* praça é opcional */
            }
          })(),
          // Dias OFF consecutivos (streak mais recente de exportações sem comunicação ON)
          (async () => {
            try {
              const rows = await pool.query<{ selimp: string; streak: number }>(
                `WITH dias AS (
                   SELECT TRIM(selimp_id) AS selimp, data_exportacao,
                          BOOL_OR(UPPER(TRIM(COALESCE(status_comunicacao, ''))) = 'ON') AS is_on
                     FROM ipt_dados_bateria
                    WHERE selimp_id IS NOT NULL AND TRIM(selimp_id) <> ''
                    GROUP BY TRIM(selimp_id), data_exportacao
                 ),
                 ordenado AS (
                   SELECT selimp, is_on,
                          SUM(CASE WHEN is_on THEN 1 ELSE 0 END) OVER (
                            PARTITION BY selimp ORDER BY data_exportacao DESC
                          ) AS ons_depois
                     FROM dias
                 )
                 SELECT selimp, COUNT(*)::int AS streak
                   FROM ordenado
                  WHERE NOT is_on AND ons_depois = 0
                  GROUP BY selimp`,
              );
              for (const r of rows.rows) offStreakMap.set(r.selimp, Number(r.streak));
            } catch {
              /* streak é opcional */
            }
          })(),
          // Série temporal de produtividade das baterias (% ON por data de exportação)
          (async () => {
            try {
              const rows = await pool.query<{ data: string; on_count: number; total: number }>(
                `SELECT data_exportacao::text AS data,
                        COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(status_comunicacao, ''))) = 'ON')::int AS on_count,
                        COUNT(*)::int AS total
                   FROM ipt_dados_bateria
                  WHERE selimp_id IS NOT NULL AND TRIM(selimp_id) <> ''
                    AND data_exportacao >= date_trunc('month', CURRENT_DATE)::date
                  GROUP BY data_exportacao
                  ORDER BY data_exportacao`,
              );
              evolucaoProdutividade = rows.rows.map((r) => ({
                data: r.data,
                produtividade: r.total > 0 ? Math.round((r.on_count / r.total) * 100) : 0,
              }));
            } catch {
              /* série temporal é opcional */
            }
          })(),
          // Execução SELIMP por tipo de serviço × subprefeitura no mês corrente (ipt_report_linhas × setores_modulos)
          (async () => {
            try {
              const rows = await pool.query<{ servico: string | null; sub: string | null; pct: string | null }>(
                `SELECT sm.servico, sm.subprefeitura AS sub,
                        AVG(CASE WHEN r.percentual_execucao > 1 THEN r.percentual_execucao ELSE r.percentual_execucao * 100 END) AS pct
                   FROM ipt_report_linhas r
                   JOIN setores_modulos sm ON sm.setor = r.plano
                  WHERE r.data_estimada >= date_trunc('month', CURRENT_DATE)::date
                    AND LOWER(COALESCE(r.status, '')) LIKE '%encerrad%'
                    AND r.percentual_execucao IS NOT NULL
                  GROUP BY sm.servico, sm.subprefeitura`,
              );
              execucaoPorServicoSub = rows.rows
                .filter((r) => r.servico && r.sub && r.pct != null)
                .map((r) => ({
                  servico: String(r.servico),
                  sub: String(r.sub),
                  execucao: Math.round(Number(r.pct) * 100) / 100,
                }))
                .filter((r) => Number.isFinite(r.execucao));
            } catch {
              /* execução por serviço é opcional */
            }
          })(),
        ]);

        const modules = result.rows.map((r) => {
          const ultima = r.ultima_comunicacao;
          const statusSinal = String(r.status_sinal_manual ?? r.status_sinal_calculado ?? "");
          const setoresDias = (Array.isArray(r.setores_dias)
            ? (r.setores_dias as { setor?: unknown; dias?: unknown }[])
            : []
          ).map((d) => {
            const setorStr = String(d?.setor ?? "");
            const key = normalizarSetor(setorStr);
            const execucao = execMap.get(key);
            const execucoes = key ? execHistoryMap.get(key) ?? [] : [];
            const km = kmMap.get(key);
            const praca = pracaMap.get(key);
            return {
              setor: setorStr,
              dias: String(d?.dias ?? ""),
              km: km != null ? km : null,
              praca: praca ?? null,
              execucao: execucao != null ? execucao : null,
              execucoes,
            };
          });
          const execVals = setoresDias
            .map((s) => s.execucao)
            .filter((v): v is number => v != null);
          const produtividadeExecucao =
            execVals.length > 0
              ? Math.round((execVals.reduce((a, b) => a + b, 0) / execVals.length) * 100) / 100
              : null;
          return {
            id: r.id,
            subprefeitura: String(r.sub ?? ""),
            setor: String(r.setores ?? ""),
            numeroSelimp: String(r.modulo_selimp ?? ""),
            diasExecucao: String(r.dias_execucao ?? ""),
            setoresDias,
            produtividadeExecucao,
            comunicacao: String(r.comunicacao ?? "OFF"),
            bateria: String(r.bateria_raw ?? ""),
            bateriaPercentual: Number(r.bateria_percentual ?? 0),
            ultimaComunicacao:
              ultima instanceof Date
                ? ultima.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
                : ultima
                  ? new Date(String(ultima)).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
                  : "",
            statusSinalGeral: statusSinal,
            statusBateria: String(r.status_bateria ?? ""),
            dataInstalacao: formatDataInstalacaoBr(String(r.data_selimp ?? "")),
            quantidadeTrocas: Number(r.qtd_trocas ?? 0),
            diasOn: Number(r.dias_on ?? 0),
            diasOff: Number(r.dias_off ?? 0),
            diasOffConsecutivos: offStreakMap.get(String(r.modulo_selimp ?? "").trim()) ?? 0,
            produtividade: Number(r.produtividade_bateria ?? 0),
          };
        });

        const total = modules.length;
        const online = modules.filter((m) => m.comunicacao === "ON").length;
        const offline = total - online;
        const avgProductivity = total > 0
          ? Math.round(modules.reduce((sum, m) => sum + m.produtividade, 0) / total)
          : 0;
        const criticalAlerts = modules.filter(
          (m) => m.statusBateria === "DESATUALIZADA" || m.produtividade < 50
        ).length;
        const lowBattery = modules.filter(
          (m) => m.statusBateria === "BAIXA" || m.bateriaPercentual < 40
        ).length;

        const lastUpdate = meta?.updated_at
          ? new Date(meta.updated_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
          : null;

        return {
          modules,
          stats: { total, online, offline, avgProductivity, criticalAlerts, lowBattery },
          evolucaoProdutividade,
          execucaoPorServicoSub,
          lastUpdate,
          latestBatch: meta?.updated_at
            ? {
                id: null,
                importedAt: new Date(meta.updated_at).toISOString(),
                sourceFile: meta.source_file ?? "",
                totalRegistros: meta.total_registros,
              }
            : null,
        };
      },
      15
    );

    return cacheResult;
  });

  fastify.get<{ Querystring: { ano?: string; mes?: string } }>("/indicadores/adc-override", async (request, reply) => {
    const ano = Number(request.query.ano);
    const mes = Number(request.query.mes);
    if (!Number.isFinite(ano) || !Number.isFinite(mes) || mes < 1 || mes > 12) {
      return reply.code(400).send({ detail: "ano e mes são obrigatórios (mes 1-12)" });
    }

    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT ano, mes, modo, pontuacao_ird, pontuacao_ia, pontuacao_if, pontuacao_ipt, adc_total, observacao, updated_at
         FROM adc_override_mensal WHERE ano = $1 AND mes = $2`,
        [ano, mes]
      );
      const row = res.rows[0];
      if (!row) {
        return { ativo: false, ano, mes };
      }
      return {
        ativo: true,
        ano: row.ano,
        mes: row.mes,
        modo: row.modo,
        pontuacao_ird: row.pontuacao_ird != null ? Number(row.pontuacao_ird) : null,
        pontuacao_ia: row.pontuacao_ia != null ? Number(row.pontuacao_ia) : null,
        pontuacao_if: row.pontuacao_if != null ? Number(row.pontuacao_if) : null,
        pontuacao_ipt: row.pontuacao_ipt != null ? Number(row.pontuacao_ipt) : null,
        adc_total: row.adc_total != null ? Number(row.adc_total) : null,
        observacao: String(row.observacao ?? ""),
        updated_at: row.updated_at,
      };
    } finally {
      client.release();
    }
  });

  fastify.put<{
    Body: {
      ano: number;
      mes: number;
      modo: "por_indicador" | "total";
      pontuacao_ird?: number | null;
      pontuacao_ia?: number | null;
      pontuacao_if?: number | null;
      pontuacao_ipt?: number | null;
      adc_total?: number | null;
      observacao: string;
    };
  }>("/indicadores/adc-override", async (request, reply) => {
    const user = await requireHost(request, reply);
    if (!user) return;

    const { ano, mes, modo, pontuacao_ird, pontuacao_ia, pontuacao_if, pontuacao_ipt, adc_total, observacao } =
      request.body ?? ({} as any);

    if (!Number.isFinite(ano) || !Number.isFinite(mes) || mes < 1 || mes > 12) {
      return reply.code(400).send({ detail: "ano e mes inválidos" });
    }
    if (modo !== "por_indicador" && modo !== "total") {
      return reply.code(400).send({ detail: "modo deve ser por_indicador ou total" });
    }
    const obs = String(observacao ?? "").trim();
    if (!obs) {
      return reply.code(400).send({ detail: "observacao é obrigatória no modo manual" });
    }

    if (modo === "total") {
      const total = Number(adc_total);
      if (!Number.isFinite(total) || total < 0 || total > 100) {
        return reply.code(400).send({ detail: "adc_total deve estar entre 0 e 100" });
      }
    } else {
      const limits = [
        { name: "pontuacao_ird", val: pontuacao_ird, max: 20 },
        { name: "pontuacao_ia", val: pontuacao_ia, max: 20 },
        { name: "pontuacao_if", val: pontuacao_if, max: 20 },
        { name: "pontuacao_ipt", val: pontuacao_ipt, max: 40 },
      ];
      for (const { name, val, max } of limits) {
        const n = Number(val);
        if (!Number.isFinite(n) || n < 0 || n > max) {
          return reply.code(400).send({ detail: `${name} deve estar entre 0 e ${max}` });
        }
      }
    }

    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO adc_override_mensal
           (ano, mes, modo, pontuacao_ird, pontuacao_ia, pontuacao_if, pontuacao_ipt, adc_total, observacao, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (ano, mes) DO UPDATE SET
           modo = EXCLUDED.modo,
           pontuacao_ird = EXCLUDED.pontuacao_ird,
           pontuacao_ia = EXCLUDED.pontuacao_ia,
           pontuacao_if = EXCLUDED.pontuacao_if,
           pontuacao_ipt = EXCLUDED.pontuacao_ipt,
           adc_total = EXCLUDED.adc_total,
           observacao = EXCLUDED.observacao,
           updated_at = NOW()`,
        [
          ano,
          mes,
          modo,
          modo === "por_indicador" ? Number(pontuacao_ird) : null,
          modo === "por_indicador" ? Number(pontuacao_ia) : null,
          modo === "por_indicador" ? Number(pontuacao_if) : null,
          modo === "por_indicador" ? Number(pontuacao_ipt) : null,
          modo === "total" ? Number(adc_total) : null,
          obs,
        ]
      );
      invalidatePrefix("kpis");
      return { ok: true, ano, mes, modo };
    } finally {
      client.release();
    }
  });

  fastify.delete<{ Querystring: { ano?: string; mes?: string } }>("/indicadores/adc-override", async (request, reply) => {
    const user = await requireHost(request, reply);
    if (!user) return;

    const ano = Number(request.query.ano);
    const mes = Number(request.query.mes);
    if (!Number.isFinite(ano) || !Number.isFinite(mes) || mes < 1 || mes > 12) {
      return reply.code(400).send({ detail: "ano e mes são obrigatórios (mes 1-12)" });
    }

    const client = await pool.connect();
    try {
      await client.query(`DELETE FROM adc_override_mensal WHERE ano = $1 AND mes = $2`, [ano, mes]);
      invalidatePrefix("kpis");
      return { ok: true, ativo: false, ano, mes };
    } finally {
      client.release();
    }
  });
};
