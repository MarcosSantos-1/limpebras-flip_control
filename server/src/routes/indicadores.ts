import { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";
import {
  pontuacaoIA,
  pontuacaoIRD,
  pontuacaoIF,
  pontuacaoIFFromPercentual,
  pontuacaoIPT,
  descontoADC,
  type IndicadorResult,
} from "../services/indicadores.js";
import { BFS_IF_EXCLUSAO_SQL } from "../constants/bfs.js";
import { SUB_SIGLAS, DOMICILIOS_POR_REGIONAL, regionalToSigla } from "../constants/regionais.js";
import {
  normalizarSetor,
  compareSetores,
  getFrequenciaDescricao,
  parseSetor,
  getSubFromPlano,
} from "../constants/ipt.js";

async function getSavedIPT(client: any, inicio: string, fim: string): Promise<number | null> {
  const r = await client.query(
    `SELECT percentual_total
     FROM ipt_registros
     WHERE periodo_inicial = $1::date
       AND periodo_final = $2::date
     ORDER BY updated_at DESC
     LIMIT 1`,
    [inicio, fim]
  );
  if (!r.rows.length) return null;
  const v = Number(r.rows[0]?.percentual_total);
  return Number.isFinite(v) ? v : null;
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
 * IPT = soma de todos os percentuais de módulos com status "Encerrado" (SELIMP report)
 * dividido pela quantidade de despachos = média em %. Depois extrai pontuação.
 * Usa data_referencia ou extrai data do raw (data, data_planejado, data_execucao) para filtrar por período.
 */
async function getAutoIPTFromReport(client: any, inicio: string, fim: string): Promise<number | null> {
  const rows = await client.query(
    `SELECT raw, data_referencia, updated_at
     FROM ipt_imports
     WHERE file_type = 'ipt_report_selimp'`,
    []
  );

  let somaPercentuais = 0;
  let qtdDespachos = 0;

  for (const row of rows.rows as Array<{ raw: IptRaw; data_referencia: string | Date | null; updated_at: string | Date | null }>) {
    const raw = (row.raw ?? {}) as IptRaw;
    const status = normalizeText(String(raw.status ?? "").trim());
    if (!status.includes("encerrado")) continue;
    const plano = normalizarSetor(String(raw.plano ?? "").trim());
    if (!plano) continue;
    const percentual = toExecPercent(String(raw.de_execucao ?? raw.percentual_execucao ?? "").trim());
    if (percentual == null) continue;

    let dateKey: string | null = null;
    const dataRef = row.data_referencia;
    if (dataRef) {
      if (typeof dataRef === "string" && /^\d{4}-\d{2}-\d{2}/.test(dataRef)) dateKey = dataRef.slice(0, 10);
      else {
        const d = dataRef instanceof Date ? dataRef : new Date(dataRef);
        if (!Number.isNaN(d.getTime())) {
          dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
        }
      }
    }
    if (!dateKey) dateKey = extractRawDateForIpt(raw);
    if (!dateKey) {
      const upd = row.updated_at;
      if (upd) {
        const d = upd instanceof Date ? upd : new Date(upd);
        if (!Number.isNaN(d.getTime()))
          dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      }
    }
    if (!dateKey || dateKey < inicio || dateKey > fim) continue;

    somaPercentuais += percentual;
    qtdDespachos += 1;
  }

  if (qtdDespachos === 0) return null;
  const ipt = somaPercentuais / qtdDespachos;
  return Number(ipt.toFixed(2));
}

type IptRaw = Record<string, string>;

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

const CRONOGRAMA_SERVICOS = new Set(["BL", "MT", "NH", "LM", "GO"]);

const toDateKey = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const parseDateKeyLocal = (dateKey: string): Date => new Date(`${dateKey}T00:00:00`);

const diffInDaysAbs = (a: string, b: string): number => {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.round(Math.abs(parseDateKeyLocal(a).getTime() - parseDateKeyLocal(b).getTime()) / oneDay);
};

const isFrequencyDate = (frequencia: string, dateKey: string): boolean => {
  const d = parseDateKeyLocal(dateKey);
  const day = d.getDay(); // 0..6 (dom..sab)
  const month = d.getMonth(); // 0..11
  const monthDay = d.getDate(); // 1..31
  switch (frequencia) {
    case "0101":
    case "0102":
    case "0103":
    case "0104":
    case "0105":
    case "0106":
    case "0108":
    case "0110":
      return true;
    case "0202":
      return day === 1 || day === 3 || day === 5;
    case "0203":
      return day === 2 || day === 4 || day === 6;
    case "0302":
      return day === 1 || day === 4;
    case "0303":
      return day === 2 || day === 5;
    case "0304":
      return day === 3 || day === 6;
    case "0401":
      return day === 0;
    case "0402":
      return day === 1;
    case "0403":
      return day === 2;
    case "0404":
      return day === 3;
    case "0405":
      return day === 4;
    case "0406":
      return day === 5;
    case "0407":
      return day === 6;
    case "0500":
      return monthDay === 1 || monthDay === 15;
    case "0600":
      return monthDay === 1;
    case "0700":
      return monthDay === 1 && [0, 3, 6, 9].includes(month);
    case "0800":
      return monthDay === 1 && [0, 4, 8].includes(month);
    case "0900":
      return monthDay === 1 && [0, 6].includes(month);
    case "1000":
      return monthDay === 1 && month % 2 === 0;
    default:
      return false;
  }
};

const findPreviousExpectedByFrequency = (frequencia: string, referenceDateKey: string): string | null => {
  for (let i = 0; i <= 120; i += 1) {
    const d = parseDateKeyLocal(referenceDateKey);
    d.setDate(d.getDate() - i);
    const key = toDateKey(d);
    if (!key) continue;
    if (isFrequencyDate(frequencia, key)) return key;
  }
  return null;
};

const findNextExpectedByFrequency = (frequencia: string, referenceDateKey: string): string | null => {
  for (let i = 1; i <= 120; i += 1) {
    const d = parseDateKeyLocal(referenceDateKey);
    d.setDate(d.getDate() + i);
    const key = toDateKey(d);
    if (!key) continue;
    if (isFrequencyDate(frequencia, key)) return key;
  }
  return null;
};

const pickNearestDate = (referenceDateKey: string, dates: string[], maxDistanceDays: number): string | null => {
  let best: { date: string; diff: number } | null = null;
  for (const date of dates) {
    const diff = diffInDaysAbs(referenceDateKey, date);
    if (diff > maxDistanceDays) continue;
    if (!best || diff < best.diff) best = { date, diff };
  }
  return best?.date ?? null;
};

const normalizeServiceName = (service: string, plano: string): string => {
  const raw = String(service ?? "").trim();
  const normalized = normalizeText(raw).replace(/\s+/g, " ");
  const compact = normalized.replace(/[^a-z]/g, "");
  const planoCode = String(plano ?? "").toUpperCase();

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

  return raw;
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

export const indicadoresRoutes: FastifyPluginAsync = async (fastify) => {
  /** KPIs do dashboard: contagens e indicadores no período */
  fastify.get<{
    Querystring: { periodo_inicial?: string; periodo_final?: string };
  }>("/dashboard/kpis", async (request, reply) => {
    const { periodo_inicial: inicio, periodo_final: fim } = request.query;
    if (!inicio || !fim) {
      return reply.code(400).send({ detail: "periodo_inicial e periodo_final obrigatórios (YYYY-MM-DD)" });
    }

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

      // IF: todos BFS no período EXCETO os 3 serviços excluídos
      const ifExcludeSql = BFS_IF_EXCLUSAO_SQL.map((_, i) => `tipo_servico NOT ILIKE $${3 + i}`).join(" AND ");
      const ifByRegional = await client.query(
        `SELECT regional,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE TRIM(status) = 'Sem Irregularidades') AS sem_irregularidade
         FROM bfs
         WHERE data_fiscalizacao >= $1::date AND data_fiscalizacao < ($2::date + interval '1 day')
           AND ${ifExcludeSql}
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
      let somaPercentuais = 0;
      for (const sigla of SUB_SIGLAS) {
        const { total, sem_irregularidade } = bySigla[sigla];
        somaPercentuais += total > 0 ? (sem_irregularidade / total) * 100 : 0;
      }
      const mediaPercentual = somaPercentuais / 4;
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
      const autoIptPercent = await getAutoIPTFromReport(client, inicio, fim);
      const savedIptPercent = await getSavedIPT(client, inicio, fim);
      const iptPercent = autoIptPercent ?? savedIptPercent;
      const iptDashboard =
        iptPercent != null
          ? { ...pontuacaoIPT(iptPercent), valor: iptPercent }
          : { valor: 0, percentual: 0, pontuacao: 0 };
      const iptSemDados = autoIptPercent == null && savedIptPercent == null;

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

      // IF: todos BFS no período EXCETO os 3 serviços excluídos
      const ifExcludeSql = BFS_IF_EXCLUSAO_SQL.map((_, i) => `tipo_servico NOT ILIKE $${3 + i}`).join(" AND ");
      const ifByRegional = await client.query(
        `SELECT regional, COUNT(*) AS total,
                COUNT(*) FILTER (WHERE TRIM(status) = 'Sem Irregularidades') AS sem_irregularidade
         FROM bfs WHERE data_fiscalizacao >= $1::date AND data_fiscalizacao < ($2::date + interval '1 day')
           AND ${ifExcludeSql}
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
      let somaPct = 0;
      for (const sigla of SUB_SIGLAS) {
        const { total, sem_irregularidade } = bySigla[sigla];
        somaPct += total > 0 ? (sem_irregularidade / total) * 100 : 0;
      }
      const mediaPercentual = somaPct / 4;
      const ifInd = pontuacaoIFFromPercentual(mediaPercentual);
      const ifTotal = Object.values(bySigla).reduce((a, x) => a + x.total, 0);
      const ifSemIrregularidade = Object.values(bySigla).reduce((a, x) => a + x.sem_irregularidade, 0);

      if (iptPercent == null || isNaN(iptPercent)) {
        const autoIpt = await getAutoIPTFromReport(client, inicio, fim);
        const saved = await getSavedIPT(client, inicio, fim);
        iptPercent = autoIpt ?? saved ?? undefined;
      }

      const ipt: IndicadorResult = iptPercent != null && !isNaN(iptPercent)
        ? pontuacaoIPT(iptPercent)
        : { valor: 0, percentual: 0, pontuacao: 0 };

      const total = ia.pontuacao + ird.pontuacao + ifInd.pontuacao + ipt.pontuacao;
      const descontoInfo = descontoADC(total);

      const iaPayload = {
        ...ia,
        valor: ia.valor, // IA em x1000
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

      return {
        ird,
        ia: iaPayload,
        if: ifPayload,
        ipt,
        total,
        // Campos legados usados pela tela /indicadores
        pontuacao_total: total,
        percentual_contrato: descontoInfo.percentualRecebimento,
        desconto: descontoPercent,
        // Campo detalhado novo
        desconto_detalhe: descontoInfo,
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

      // IF: todos BFS no período EXCETO os 3 serviços excluídos
      const ifExcludeSql = BFS_IF_EXCLUSAO_SQL.map((_, i) => `tipo_servico NOT ILIKE $${3 + i}`).join(" AND ");
      const ifByRegional = await client.query(
        `SELECT regional,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE TRIM(status) = 'Sem Irregularidades') AS sem_irregularidade
         FROM bfs
         WHERE data_fiscalizacao >= $1::date AND data_fiscalizacao < ($2::date + interval '1 day')
           AND ${ifExcludeSql}
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
      let somaPctIf = 0;
      for (const sigla of SUB_SIGLAS) {
        const { total, sem_irregularidade } = ifBySigla[sigla];
        somaPctIf += total > 0 ? (sem_irregularidade / total) * 100 : 0;
      }
      const mediaPercentualIf = somaPctIf / 4;
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

      const totalSolic = totalSolicitacoes;
      const ia = {
        valor: iaResult.valor,
        percentual: iaResult.percentual ?? 0,
        pontuacao: iaResult.pontuacao,
        total_no_prazo: noPrazo,
        total_fora_prazo: foraPrazo,
        total_solicitacoes: totalSolic,
        total_calculo: totalCalculoIA,
        filtros_aplicados: [
          "Data_Registro no período",
          "Finalizado_como_fora_de_escopo = NÃO",
          "Classificação_do_Serviço = Solicitação",
          "No prazo = Responsividade_Execução = SIM",
          "Fora do prazo = Responsividade_Execução = NÃO (contagem explícita das linhas com NÃO)",
        ],
        memoria_calculo:
          totalCalculoIA > 0
            ? `IA = (no prazo / (no prazo + fora do prazo)) × 1000 = (${fmt(noPrazo)} / ${fmt(totalCalculoIA)}) × 1000 = ${(iaResult.valor ?? 0).toFixed(2)} (equivale a ${(iaResult.percentual ?? 0).toFixed(2)}%)\nNo prazo (SIM): ${fmt(noPrazo)} | Fora do prazo (NÃO): ${fmt(foraPrazo)} | Base total filtro: ${fmt(totalSolic)}`
            : "IA = (no prazo / (no prazo + fora do prazo)) × 1000 — Sem linhas SIM/NÃO para o período filtrado.",
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
        ],
        if_por_sub: ifPorSub,
        filtros_aplicados: [
          "Data_Fiscalizacao no período",
          "Todos os BFS exceto 3 serviços: Coleta e transporte de entulho e grandes objetos...; Fornecimento, instalação e reposição de papeleiras...; Remoção de animais mortos de proprietários não identificados...",
          "Sem irregularidade = Status = 'Sem Irregularidades'",
          "Cálculo: IF por sub (JT, CV, ST, MG) = (sem irregularidades / total) × 100, média dos 4 = IF final",
        ],
        memoria_calculo:
          totalBfs > 0
            ? `IF = média das 4 subs: (JT: ${ifPorSub.find((s) => s.subprefeitura === "JT")?.if_percentual?.toFixed(1) ?? 0}% + CV: ${ifPorSub.find((s) => s.subprefeitura === "CV")?.if_percentual?.toFixed(1) ?? 0}% + ST: ${ifPorSub.find((s) => s.subprefeitura === "ST")?.if_percentual?.toFixed(1) ?? 0}% + MG: ${ifPorSub.find((s) => s.subprefeitura === "MG")?.if_percentual?.toFixed(1) ?? 0}%) / 4 = ${(ifResult.percentual ?? 0).toFixed(2)}%`
            : "IF = (média dos % por sub) — Nenhum BFS escalonado no período.",
      };

      const autoIptPercent = await getAutoIPTFromReport(client, inicio, fim);
      const savedIptPercent = await getSavedIPT(client, inicio, fim);
      const iptPercent = autoIptPercent ?? savedIptPercent;
      const ipt =
        iptPercent != null
          ? {
              ...pontuacaoIPT(iptPercent),
              valor: iptPercent,
            }
          : undefined;

      return {
        periodo,
        subprefeitura: subprefeitura ?? null,
        ird,
        ia,
        if: ifDetalhe,
        ipt,
      };
    } finally {
      client.release();
    }
  });

  fastify.get("/dashboard/indicadores/historico", async (_request, _reply) => {
    return { historico: [] };
  });

  fastify.get<{
    Querystring: { periodo_inicial?: string; periodo_final?: string; mostrar_todos?: string; subprefeitura?: string };
  }>("/dashboard/ipt-preview", async (request, reply) => {
    const { periodo_inicial: inicio, periodo_final: fim, mostrar_todos, subprefeitura: subFilter } = request.query;
    const showAll = mostrar_todos === "1";
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = toDateKey(yesterday)!;

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

    const client = await pool.connect();
    try {
      const [reportRows, nossoRows, cronogramaRows] = await Promise.all([
        client.query(
          `SELECT raw, data_referencia, updated_at
           FROM ipt_imports
           WHERE file_type = 'ipt_report_selimp'
           ORDER BY updated_at DESC`
        ),
        client.query(
          `SELECT raw, data_referencia, updated_at
           FROM ipt_imports
           WHERE file_type IN ('ipt_historico_os', 'ipt_historico_os_varricao', 'ipt_historico_os_compactadores')
           ORDER BY updated_at DESC`
        ),
        client.query(
          `SELECT servico, setor, data_esperada
           FROM ipt_cronograma`
        ),
      ]);

      const cronogramaBySetor = new Map<string, string[]>();
      const cronogramaSet = new Set<string>();
      for (const row of cronogramaRows.rows as Array<{ servico: string; setor: string; data_esperada: string | Date }>) {
        const setor = normalizarSetor(String(row.setor ?? "").trim());
        const dateKey = toDateKey(row.data_esperada);
        if (!setor || !dateKey) continue;
        const current = cronogramaBySetor.get(setor) ?? [];
        current.push(dateKey);
        cronogramaBySetor.set(setor, current);
        cronogramaSet.add(`${setor}|${dateKey}`);
      }
      for (const [setor, dates] of cronogramaBySetor.entries()) {
        dates.sort((a, b) => a.localeCompare(b));
        cronogramaBySetor.set(setor, Array.from(new Set(dates)));
      }

      const nossoDatesByPlano = new Map<string, string[]>();
      const extractRawDate = (raw: IptRaw): string | null => {
        const d =
          String(raw.data ?? "").trim() ||
          String(raw.data_planejado ?? "").trim() ||
          String(raw.data_execucao ?? "").trim() ||
          String(raw.data_criacao ?? "").trim() ||
          String(raw.data_liberacao ?? "").trim();
        if (!d) return null;
        const parsed = new Date(d);
        if (!Number.isNaN(parsed.getTime())) return toDateKey(parsed);
        const match = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (!match) return null;
        const year = match[3].length === 2 ? `20${match[3]}` : match[3];
        return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
      };

      for (const row of nossoRows.rows as Array<{ raw: IptRaw; data_referencia: string | Date | null }>) {
        const raw = (row.raw ?? {}) as IptRaw;
        const plano = normalizarSetor(String(raw.rota ?? raw.plano ?? "").trim());
        if (!plano) continue;
        const percent = getPercentualFromRaw(raw);
        if (percent == null) continue;
        const dateKey = toDateKey(row.data_referencia) ?? extractRawDate(raw);
        if (!dateKey) continue;
        const dates = nossoDatesByPlano.get(plano) ?? [];
        dates.push(dateKey);
        nossoDatesByPlano.set(plano, dates);
      }
      for (const [plano, dates] of nossoDatesByPlano.entries()) {
        nossoDatesByPlano.set(plano, Array.from(new Set(dates)).sort((a, b) => a.localeCompare(b)));
      }

      const byPlano = new Map<
        string,
        {
          plano: string;
          subprefeitura: string;
          tipo_servico: string;
          servico_sigla: string | null;
          turno: string | null;
          frequencia_codigo: string | null;
          frequencia: string | null;
          mapa: string | null;
          equipamentos: Set<string>;
          diario: Map<
            string,
            {
              selimp_sum: number;
              selimp_count: number;
              nosso_sum: number;
              nosso_count: number;
              despachos_selimp: number;
              despachos_nosso: number;
              estimados: number;
            }
          >;
        }
      >();

      const getOrCreatePlano = (plano: string) => {
        const parsed = parseSetor(plano);
        const existing = byPlano.get(plano);
        if (existing) return existing;
        const subFromPlano = parsed?.sub ?? getSubFromPlano(plano);
        const created = {
          plano,
          subprefeitura: subFromPlano,
          tipo_servico: "",
          servico_sigla: parsed?.servico ?? null,
          turno: parsed?.turno ?? null,
          frequencia_codigo: parsed?.frequencia ?? null,
          frequencia: parsed ? getFrequenciaDescricao(parsed.frequencia) : null,
          mapa: parsed?.mapa ?? null,
          equipamentos: new Set<string>(),
          diario: new Map<string, { selimp_sum: number; selimp_count: number; nosso_sum: number; nosso_count: number; despachos_selimp: number; despachos_nosso: number; estimados: number }>(),
        };
        byPlano.set(plano, created);
        return created;
      };

      const ensureBucket = (planoEntry: ReturnType<typeof getOrCreatePlano>, dateKey: string) => {
        const current = planoEntry.diario.get(dateKey) ?? {
          selimp_sum: 0,
          selimp_count: 0,
          nosso_sum: 0,
          nosso_count: 0,
          despachos_selimp: 0,
          despachos_nosso: 0,
          estimados: 0,
        };
        planoEntry.diario.set(dateKey, current);
        return current;
      };

      for (const row of reportRows.rows as Array<{ raw: IptRaw; data_referencia: string | Date | null; updated_at: string | Date }>) {
        const raw = (row.raw ?? {}) as IptRaw;
        const plano = normalizarSetor(String(raw.plano ?? "").trim());
        if (!plano) continue;
        const planoEntry = getOrCreatePlano(plano);
        const subFromRaw = String(raw.subprefeitura ?? "").trim();
        if (!planoEntry.subprefeitura && subFromRaw) planoEntry.subprefeitura = subFromRaw;
        const tipoServico = normalizeServiceName(String(raw.tipo_de_servico ?? raw.tipo_servico ?? "").trim(), plano);
        if (!planoEntry.tipo_servico && tipoServico) planoEntry.tipo_servico = tipoServico;
        extractModuleCodes(String(raw.equipamentos ?? "")).forEach((code) => planoEntry.equipamentos.add(code));

        const percentual = toExecPercent(String(raw.de_execucao ?? raw.percentual_execucao ?? "").trim());
        const dataArquivo = toDateKey(row.data_referencia) ?? extractRawDate(raw);
        const flagEstimado = String((raw as Record<string, unknown>)._data_referencia_estimada ?? "") === "true" || Boolean((raw as Record<string, unknown>)._data_referencia_estimada);
        let dateKey = dataArquivo;
        let estimado = false;
        if (!dateKey || flagEstimado) {
          estimado = true;
          const parsed = parseSetor(plano);
          const refDate = toDateKey(row.updated_at) ?? scopeEnd ?? yesterdayKey;
          let inferida: string | null = null;
          if (parsed?.frequencia) inferida = findPreviousExpectedByFrequency(parsed.frequencia, refDate);
          const nossoDates = nossoDatesByPlano.get(plano) ?? [];
          const porCruzamento = pickNearestDate(refDate, nossoDates, 5);
          dateKey = porCruzamento ?? inferida ?? yesterdayKey;
        }
        if (!dateKey) continue;
        const bucket = ensureBucket(planoEntry, dateKey);
        if (percentual != null) {
          bucket.selimp_sum += percentual;
          bucket.selimp_count += 1;
        }
        bucket.despachos_selimp += 1;
        if (estimado) bucket.estimados += 1;
      }

      for (const row of nossoRows.rows as Array<{ raw: IptRaw; data_referencia: string | Date | null }>) {
        const raw = (row.raw ?? {}) as IptRaw;
        const plano = normalizarSetor(String(raw.rota ?? raw.plano ?? "").trim());
        if (!plano) continue;
        const planoEntry = getOrCreatePlano(plano);
        const tipoServico = normalizeServiceName(String(raw.tipo_de_servico ?? raw.tipo_servico ?? "").trim(), plano);
        if (!planoEntry.tipo_servico && tipoServico) planoEntry.tipo_servico = tipoServico;
        const percentual = getPercentualFromRaw(raw);
        const dateKey = toDateKey(row.data_referencia) ?? extractRawDate(raw);
        if (!dateKey) continue;
        const bucket = ensureBucket(planoEntry, dateKey);
        if (percentual != null) {
          bucket.nosso_sum += percentual;
          bucket.nosso_count += 1;
        }
        bucket.despachos_nosso += 1;
      }

      for (const setor of cronogramaBySetor.keys()) getOrCreatePlano(setor);

      const isExpectedOnDate = (plano: string, dateKey: string): boolean => {
        const parsed = parseSetor(plano);
        if (!parsed) return false;
        if (CRONOGRAMA_SERVICOS.has(parsed.servico)) {
          const dates = cronogramaBySetor.get(plano) ?? [];
          if (dates.length > 0) return dates.includes(dateKey);
        }
        return isFrequencyDate(parsed.frequencia, dateKey);
      };

      const nextProgramacao = (plano: string, baseDateKey: string): string | null => {
        const parsed = parseSetor(plano);
        if (!parsed) return null;
        if (CRONOGRAMA_SERVICOS.has(parsed.servico)) {
          const dates = cronogramaBySetor.get(plano) ?? [];
          const next = dates.find((d) => d > baseDateKey);
          if (next) return next;
        }
        return findNextExpectedByFrequency(parsed.frequencia, baseDateKey);
      };

      /** Retorna ~5 datas do cronograma: 2 anteriores, referência, 2 posteriores */
      const getCronogramaPreview = (plano: string, referenciaKey: string): string[] => {
        const parsed = parseSetor(plano);
        if (!parsed) return [];
        const out: string[] = [];
        if (CRONOGRAMA_SERVICOS.has(parsed.servico)) {
          const dates = cronogramaBySetor.get(plano) ?? [];
          if (dates.length === 0) return [];
          const idx = dates.findIndex((d) => d >= referenciaKey);
          const centerIdx = idx >= 0 ? idx : dates.length - 1;
          for (let i = -2; i <= 2; i += 1) {
            const j = centerIdx + i;
            if (j >= 0 && j < dates.length) out.push(dates[j]);
          }
          return out;
        }
        let curr = referenciaKey;
        const prevs: string[] = [];
        for (let i = 0; i < 2; i += 1) {
          const p = findPreviousExpectedByFrequency(parsed.frequencia, curr);
          if (!p) break;
          prevs.unshift(p);
          curr = p;
        }
        out.push(...prevs);
        out.push(referenciaKey);
        curr = referenciaKey;
        for (let i = 0; i < 2; i += 1) {
          const n = findNextExpectedByFrequency(parsed.frequencia, curr);
          if (!n) break;
          out.push(n);
          curr = n;
        }
        return out;
      };

      const rows = Array.from(byPlano.values())
        .map((item) => {
          const dates = Array.from(item.diario.keys()).sort((a, b) => a.localeCompare(b));
          const inScopeDates = dates.filter((dateKey) => {
            if (escopo === "todos") return true;
            return dateKey >= (scopeStart as string) && dateKey <= (scopeEnd as string);
          });
          const considerDates = escopo === "todos" ? dates : inScopeDates;

          let sumSelimp = 0;
          let countSelimp = 0;
          let despachosSelimp = 0;
          let sumNosso = 0;
          let countNosso = 0;
          let despachosNosso = 0;
          let estimados = 0;
          const detalhes = considerDates
            .map((dateKey) => {
              const bucket = item.diario.get(dateKey);
              if (!bucket) return null;
              const percentualSelimp = bucket.selimp_count > 0 ? Number((bucket.selimp_sum / bucket.selimp_count).toFixed(2)) : null;
              const percentualNosso = bucket.nosso_count > 0 ? Number((bucket.nosso_sum / bucket.nosso_count).toFixed(2)) : null;
              sumSelimp += bucket.selimp_sum;
              countSelimp += bucket.selimp_count;
              despachosSelimp += bucket.despachos_selimp;
              sumNosso += bucket.nosso_sum;
              countNosso += bucket.nosso_count;
              despachosNosso += bucket.despachos_nosso;
              estimados += bucket.estimados;
              return {
                data: dateKey,
                esperado: isExpectedOnDate(item.plano, dateKey),
                percentual_selimp: percentualSelimp,
                percentual_nosso: percentualNosso,
                despachos_selimp: bucket.despachos_selimp,
                despachos_nosso: bucket.despachos_nosso,
                data_estimada: bucket.estimados > 0,
              };
            })
            .filter((d): d is NonNullable<typeof d> => d != null)
            .sort((a, b) => b.data.localeCompare(a.data));

          /* Mapa diário: percentual = soma(percentuais) / total_despachos (ex: 4 dias 100% + 1 dia 0% = 80%) */
          const percentualSelimp = despachosSelimp > 0 ? Number((sumSelimp / despachosSelimp).toFixed(2)) : null;
          const percentualNosso = despachosNosso > 0 ? Number((sumNosso / despachosNosso).toFixed(2)) : null;
          const origem =
            countSelimp > 0 && countNosso > 0 ? "ambos" : countSelimp > 0 ? "somente_selimp" : "somente_nosso";

          let mostrar = true;
          if (escopo === "dia_anterior") {
            mostrar = isExpectedOnDate(item.plano, scopeStart as string);
          } else if (escopo === "periodo") {
            const hasDispatch = despachosSelimp > 0 || despachosNosso > 0;
            const hasExpected = (() => {
              for (let d = parseDateKeyLocal(scopeStart as string); toDateKey(d)! <= (scopeEnd as string); d.setDate(d.getDate() + 1)) {
                const key = toDateKey(d)!;
                if (isExpectedOnDate(item.plano, key)) return true;
              }
              return false;
            })();
            mostrar = hasDispatch || hasExpected;
          }
          if (!mostrar) return null;

          const baseProxima = escopo === "periodo" ? (scopeEnd as string) : yesterdayKey;
          const nextDate = nextProgramacao(item.plano, baseProxima);
          const refCronograma = nextDate ?? baseProxima;
          const cronogramaPreview = getCronogramaPreview(item.plano, refCronograma);
          return {
            plano: item.plano,
            subprefeitura: item.subprefeitura || "Não informado",
            tipo_servico: item.tipo_servico || "Não informado",
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
            equipamentos: Array.from(item.equipamentos),
            proxima_programacao: nextDate,
            cronograma_preview: cronogramaPreview,
            data_estimativa_count: estimados,
            detalhes_diarios: detalhes,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r != null)
        .sort((a, b) => compareSetores(a.plano, b.plano, "asc"));

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
      const iptSomaSelimp = rowsFiltered.reduce((acc, r) => acc + (r.percentual_selimp ?? 0), 0);
      const iptMedioSelimp = rowsFiltered.length > 0 ? Number((iptSomaSelimp / rowsFiltered.length).toFixed(2)) : null;
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

      const legacySubMap = new Map<string, { quantidade: number; sum: number; count: number }>();
      const legacyServMap = new Map<string, { quantidade: number; sum: number; count: number }>();
      for (const r of rowsFiltered) {
        const subKey = r.subprefeitura || "Não informado";
        const subAgg = legacySubMap.get(subKey) ?? { quantidade: 0, sum: 0, count: 0 };
        subAgg.quantidade += 1;
        if (r.percentual_selimp != null) {
          subAgg.sum += r.percentual_selimp;
          subAgg.count += 1;
        }
        legacySubMap.set(subKey, subAgg);

        const srvKey = r.tipo_servico || "Não informado";
        const srvAgg = legacyServMap.get(srvKey) ?? { quantidade: 0, sum: 0, count: 0 };
        srvAgg.quantidade += 1;
        if (r.percentual_selimp != null) {
          srvAgg.sum += r.percentual_selimp;
          srvAgg.count += 1;
        }
        legacyServMap.set(srvKey, srvAgg);
      }
      const subprefeituras = Array.from(legacySubMap.entries()).map(([subprefeitura, v]) => ({
        subprefeitura,
        quantidade_planos: v.quantidade,
        media_execucao: v.count > 0 ? Number((v.sum / v.count).toFixed(2)) : null,
      }));
      const servicos = Array.from(legacyServMap.entries()).map(([tipo_servico, v]) => ({
        tipo_servico,
        quantidade_planos: v.quantidade,
        media_execucao: v.count > 0 ? Number((v.sum / v.count).toFixed(2)) : null,
      }));
      const mesclados = rowsFiltered.map((r) => ({
        plano: r.plano,
        subprefeitura: r.subprefeitura,
        tipo_servico: r.tipo_servico,
        status_execucao: r.despachos_selimp > 0 ? "Despachado" : "Não despachado",
        percentual_execucao: r.percentual_selimp,
        equipamentos: r.equipamentos,
        modulos_status: [] as Array<{
          codigo: string;
          status_bateria: string;
          status_comunicacao: string;
          bateria: string;
          dias_sem_comunicacao: number | null;
          data_ultima_comunicacao: string;
          ativo: boolean;
        }>,
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
      }));
      const divergencias = comparativoItens.filter((r) => Math.abs((r.percentual_selimp ?? 0) - (r.percentual_nosso ?? 0)) >= 5).length;
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
          ipt_soma_percentuais: Number(iptSomaSelimp.toFixed(2)),
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
};
