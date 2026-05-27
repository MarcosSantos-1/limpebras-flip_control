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
} from "../constants/ipt.js";
import { config } from "../config.js";
import { buildIptPreviewFromConsolidado } from "../services/ipt-consolidado-preview.js";
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

      return {
        indicadores: { ird, ia: iaDashboard, if: ifDashboard, ipt: iptDashboard },
        ipt_sem_dados: iptSemDados,
        sacs_hoje: Number(sacsHoje.rows[0]?.total ?? 0),
        cncs_urgentes: 0,
      };
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
           media_sem_zerados,
           quantidade_planos,
           total_despachos,
           despachos_zerados,
           source_file,
           metadata,
           updated_at
         FROM metric_snapshots
         WHERE snapshot_type = 'ipt_servico'
           AND metric_label = $1
           AND periodo_final >= $2::date
           AND periodo_inicial <= $3::date
         ORDER BY snapshot_at, id`,
        [tipoServico, inicio, fim]
      );
      return {
        tipo_servico: tipoServico,
        periodo: { inicial: inicio, final: fim },
        pontos: r.rows.map((row: any) => ({
          id: Number(row.id),
          snapshot_at: row.snapshot_at instanceof Date ? row.snapshot_at.toISOString() : row.snapshot_at,
          metric_key: row.metric_key,
          metric_label: row.metric_label,
          periodo_inicial: row.periodo_inicial,
          periodo_final: row.periodo_final,
          periodo_tipo: row.periodo_tipo,
          percentual: row.percentual != null ? Number(row.percentual) : null,
          media_sem_zerados: row.media_sem_zerados != null ? Number(row.media_sem_zerados) : null,
          quantidade_planos: Number(row.quantidade_planos ?? 0),
          total_despachos: Number(row.total_despachos ?? 0),
          despachos_zerados: Number(row.despachos_zerados ?? 0),
          source_file: row.source_file,
          metadata: row.metadata ?? {},
          updated_at: row.updated_at,
        })),
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
           periodo_inicial::text AS data,
           metric_key,
           metric_label AS tipo_servico,
           percentual,
           media_sem_zerados,
           quantidade_planos,
           total_despachos,
           despachos_zerados,
           source_file,
           snapshot_at
         FROM metric_snapshots
         WHERE snapshot_type = 'ipt_servico_diario'
           AND periodo_inicial >= $1::date
           AND periodo_final <= $2::date
           ${filterServico}
         ORDER BY periodo_inicial, metric_label`,
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
          percentual_sem_zeros: row.media_sem_zerados != null ? Number(row.media_sem_zerados) : null,
          planos: Number(row.quantidade_planos ?? 0),
          despachos: Number(row.total_despachos ?? 0),
          zerados: Number(row.despachos_zerados ?? 0),
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
         WHERE snapshot_type = 'ipt_servico_diario'
           AND periodo_inicial >= $1::date
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

        const modules = result.rows.map((r) => {
          const ultima = r.ultima_comunicacao;
          const statusSinal = String(r.status_sinal_manual ?? r.status_sinal_calculado ?? "");
          return {
            id: r.id,
            subprefeitura: String(r.sub ?? ""),
            setor: String(r.setores ?? ""),
            numeroSelimp: String(r.modulo_selimp ?? ""),
            diasExecucao: String(r.dias_execucao ?? ""),
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
};
