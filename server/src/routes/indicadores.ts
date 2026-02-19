import { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";
import {
  pontuacaoIA,
  pontuacaoIRD,
  pontuacaoIF,
  pontuacaoIPT,
  descontoADC,
  type IndicadorResult,
} from "../services/indicadores.js";
import { BFS_NAO_DEMANDANTES } from "../constants/bfs.js";

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

      // IF: apenas BFS Não Demandantes no período
      const ifCount = await client.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE TRIM(status) = 'Sem Irregularidades') AS sem_irregularidade
         FROM bfs
         WHERE data_fiscalizacao >= $1::date AND data_fiscalizacao < ($2::date + interval '1 day')
           AND tipo_servico = ANY($3::text[])`,
        [inicio, fim, BFS_NAO_DEMANDANTES]
      );
      const ifRow = ifCount.rows[0];
      const totalBfs = Number(ifRow?.total ?? 0);
      const semIrreg = Number(ifRow?.sem_irregularidade ?? 0);
      const ifInd = pontuacaoIF(semIrreg, totalBfs);

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
        // Para dashboard, IF deve mostrar percentual.
        valor: ifInd.percentual ?? 0,
        total_fiscalizacoes: totalBfs,
        total_sem_irregularidade: semIrreg,
      };
      const savedIptPercent = await getSavedIPT(client, inicio, fim);
      const iptDashboard =
        savedIptPercent != null ? pontuacaoIPT(savedIptPercent) : { valor: 0, percentual: 0, pontuacao: 0 };

      // SACs hoje (opcional: período = hoje)
      const hoje = new Date().toISOString().slice(0, 10);
      const sacsHoje = await client.query(
        `SELECT COUNT(*) AS total FROM sacs WHERE data_registro::date = $1::date`,
        [hoje]
      );

      return {
        indicadores: { ird, ia: iaDashboard, if: ifDashboard, ipt: iptDashboard },
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

      // IF
      const ifCount = await client.query(
        `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE TRIM(status) = 'Sem Irregularidades') AS sem_irregularidade
         FROM bfs WHERE data_fiscalizacao >= $1::date AND data_fiscalizacao < ($2::date + interval '1 day')
           AND tipo_servico = ANY($3::text[])`,
        [inicio, fim, BFS_NAO_DEMANDANTES]
      );
      const ifRow = ifCount.rows[0];
      const ifSemIrregularidade = Number(ifRow?.sem_irregularidade ?? 0);
      const ifTotal = Number(ifRow?.total ?? 0);
      const ifInd = pontuacaoIF(ifSemIrregularidade, ifTotal);

      if (iptPercent == null || isNaN(iptPercent)) {
        const saved = await getSavedIPT(client, inicio, fim);
        if (saved != null) iptPercent = saved;
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

      // IRD: reclamações procedentes
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

      // IF: BFS Não Demandantes
      const ifCount = await client.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE TRIM(status) = 'Sem Irregularidades') AS sem_irregularidade
         FROM bfs
         WHERE data_fiscalizacao >= $1::date AND data_fiscalizacao < ($2::date + interval '1 day')
           AND tipo_servico = ANY($3::text[])`,
        [inicio, fim, BFS_NAO_DEMANDANTES]
      );
      const ifRow = ifCount.rows[0];
      const totalBfs = Number(ifRow?.total ?? 0);
      const semIrreg = Number(ifRow?.sem_irregularidade ?? 0);
      const ifResult = pontuacaoIF(semIrreg, totalBfs);

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

      const ifDetalhe = {
        valor: ifResult.valor,
        percentual: ifResult.percentual ?? 0,
        pontuacao: ifResult.pontuacao,
        total_fiscalizacoes: totalBfs,
        total_sem_irregularidade: semIrreg,
        total_com_irregularidade: totalBfs - semIrreg,
        status_referencia: "Sem Irregularidades",
        servicos_nao_demandantes: BFS_NAO_DEMANDANTES,
        filtros_aplicados: [
          "Data_Fiscalizacao no período",
          "Apenas BFS Não Demandantes (lista SELIMP)",
          "Sem irregularidade = Status = 'Sem Irregularidades'",
        ],
        memoria_calculo:
          totalBfs > 0
            ? `IF = (BFS sem irregularidade / total BFS não demandantes) × 1000 = (${fmt(semIrreg)} / ${fmt(totalBfs)}) × 1000 = ${(ifResult.valor ?? 0).toFixed(2)} (equivale a ${(ifResult.percentual ?? 0).toFixed(2)}%)`
            : "IF = (sem irregularidade / total BFS) × 1000 — Nenhum BFS não demandante no período.",
      };

      const savedIptPercent = await getSavedIPT(client, inicio, fim);
      const ipt =
        savedIptPercent != null
          ? {
              ...pontuacaoIPT(savedIptPercent),
              valor: savedIptPercent,
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
    Querystring: { periodo_inicial?: string; periodo_final?: string };
  }>("/dashboard/ipt-preview", async (request, reply) => {
    const { periodo_inicial: inicio, periodo_final: fim } = request.query;

    const client = await pool.connect();
    try {
      const statusRows = await client.query(
        `SELECT raw
         FROM ipt_imports
         WHERE file_type = 'ipt_status_bateria'`
      );
      const reportRows = await client.query(
        `SELECT raw, updated_at
         FROM ipt_imports
         WHERE file_type = 'ipt_report_selimp'
         ORDER BY updated_at DESC`
      );
      const nossoRows = await client.query(
        `SELECT file_type, raw, updated_at
         FROM ipt_imports
         WHERE file_type IN ('ipt_historico_os', 'ipt_historico_os_varricao')
         ORDER BY updated_at DESC`
      );

      const statusByModule = new Map<string, IptRaw>();
      for (const row of statusRows.rows) {
        const raw = (row.raw ?? {}) as IptRaw;
        const code = normalizeModuleCode(raw.placa || raw.nome || "");
        if (!code) continue;
        statusByModule.set(code, raw);
      }

      const bySubprefeitura = new Map<string, { quantidade: number; execTotal: number; execCount: number }>();
      const byServico = new Map<string, { quantidade: number; execTotal: number; execCount: number }>();
      const comparativoRows: Array<{
        plano: string;
        subprefeitura: string;
        tipo_servico: string;
        percentual_selimp: number | null;
        percentual_nosso: number | null;
        diferenca_percentual: number | null;
        origem: "ambos" | "somente_selimp" | "somente_nosso";
      }> = [];

      const nossoByPlano = new Map<
        string,
        {
          plano: string;
          setor: string;
          tipo_servico: string;
          percentual_nosso: number | null;
          updated_at: string;
        }
      >();
      for (const row of nossoRows.rows as Array<{ raw: IptRaw; updated_at: string }>) {
        const raw = (row.raw ?? {}) as IptRaw;
        const plano = String(raw.rota ?? "").trim();
        if (!plano || nossoByPlano.has(plano)) continue;
        nossoByPlano.set(plano, {
          plano,
          setor: String(raw.setor ?? "").trim(),
          tipo_servico: String(raw.tipo_de_servico ?? raw.tipo_servico ?? "").trim(),
          percentual_nosso: toExecPercent(String(raw.percentual_execucao ?? "").trim()),
          updated_at: row.updated_at,
        });
      }
      const planosSelimp = new Set<string>();

      let totalPlanos = 0;
      let totalPlanosAtivos = 0;
      let totalModulosRelacionados = 0;
      let totalModulosAtivos = 0;
      let totalModulosInativos = 0;
      let semStatus = 0;
      let comunicacaoOff = 0;
      let bateriaCritica = 0;
      let bateriaBaixa = 0;
      let execAtivaTotal = 0;
      let execAtivaCount = 0;

      const mergedRows = reportRows.rows.map((row: { raw: IptRaw; updated_at: string }) => {
        const raw = (row.raw ?? {}) as IptRaw;
        const plano = String(raw.plano ?? "").trim();
        const subprefeitura = String(raw.subprefeitura ?? "").trim();
        const tipoServico = String(raw.tipo_de_servico ?? "").trim();
        const statusExecucao = String(raw.status ?? "").trim();
        const percentualExecucaoStr = String(raw.de_execucao ?? raw.percentual_execucao ?? "").trim();
        const percentualExecucao = toExecPercent(percentualExecucaoStr);
        const equipamentosStr = String(raw.equipamentos ?? "").trim();

        totalPlanos += 1;
        if (plano) planosSelimp.add(plano);
        const codes = extractModuleCodes(equipamentosStr);
        totalModulosRelacionados += codes.length;

        const moduleStatuses = codes
          .map((code) => {
            const statusRaw = statusByModule.get(code);
            if (!statusRaw) return null;
            const dias = parseDias(String(statusRaw.dias ?? ""));
            const statusBateria = String(statusRaw.status_de_bateria ?? "").trim();
            const statusComunicacao = String(statusRaw.status_de_comunicacao ?? "").trim();
            const inativo = isModuleInactive(statusBateria, statusComunicacao, dias);
            return {
              codigo: code,
              status_bateria: statusBateria,
              status_comunicacao: statusComunicacao,
              bateria: String(statusRaw.bateria ?? "").trim(),
              dias_sem_comunicacao: dias,
              data_ultima_comunicacao: String(statusRaw.data_de_ultima_comunicacao ?? "").trim(),
              ativo: !inativo,
            };
          })
          .filter(Boolean) as Array<{
          codigo: string;
          status_bateria: string;
          status_comunicacao: string;
          bateria: string;
          dias_sem_comunicacao: number | null;
          data_ultima_comunicacao: string;
          ativo: boolean;
        }>;

        if (codes.length > 0 && moduleStatuses.length === 0) semStatus += 1;
        if (moduleStatuses.some((m) => m.status_comunicacao.toUpperCase() === "OFF")) comunicacaoOff += 1;
        totalModulosAtivos += moduleStatuses.filter((m) => m.ativo).length;
        totalModulosInativos += moduleStatuses.filter((m) => !m.ativo).length;
        if (
          moduleStatuses.some((m) =>
            /(descarga|iminencia|iminência|critica|cr[ií]tica|necessita recarga)/i.test(m.status_bateria)
          )
        ) {
          bateriaCritica += 1;
        } else if (moduleStatuses.some((m) => /(carga de trabalho|recarga breve|baixa)/i.test(m.status_bateria))) {
          bateriaBaixa += 1;
        }

        const planoInativoPorStatus = normalizeText(statusExecucao).includes("nao despachado");
        const temModuloAtivo = moduleStatuses.length === 0 ? true : moduleStatuses.some((m) => m.ativo);
        const planoAtivo = !planoInativoPorStatus && temModuloAtivo;
        if (planoAtivo) totalPlanosAtivos += 1;
        if (planoAtivo && percentualExecucao != null) {
          execAtivaTotal += percentualExecucao;
          execAtivaCount += 1;
        }

        const subKey = subprefeitura || "Não informado";
        const subAgg = bySubprefeitura.get(subKey) || { quantidade: 0, execTotal: 0, execCount: 0 };
        subAgg.quantidade += 1;
        if (planoAtivo && percentualExecucao != null) {
          subAgg.execTotal += percentualExecucao;
          subAgg.execCount += 1;
        }
        bySubprefeitura.set(subKey, subAgg);

        const servKey = tipoServico || "Não informado";
        const servAgg = byServico.get(servKey) || { quantidade: 0, execTotal: 0, execCount: 0 };
        servAgg.quantidade += 1;
        if (planoAtivo && percentualExecucao != null) {
          servAgg.execTotal += percentualExecucao;
          servAgg.execCount += 1;
        }
        byServico.set(servKey, servAgg);

        const nosso = nossoByPlano.get(plano);
        const percentualNosso = nosso?.percentual_nosso ?? null;
        const diferenca =
          percentualExecucao != null && percentualNosso != null
            ? Number((percentualExecucao - percentualNosso).toFixed(2))
            : null;
        comparativoRows.push({
          plano,
          subprefeitura,
          tipo_servico: tipoServico,
          percentual_selimp: percentualExecucao,
          percentual_nosso: percentualNosso,
          diferenca_percentual: diferenca,
          origem: nosso ? "ambos" : "somente_selimp",
        });

        return {
          plano,
          subprefeitura,
          tipo_servico: tipoServico,
          status_execucao: statusExecucao,
          percentual_execucao: percentualExecucao,
          plano_ativo: planoAtivo,
          equipamentos: codes,
          modulos_status: moduleStatuses,
          sem_status_bateria: codes.length > 0 && moduleStatuses.length === 0,
          atualizado_em: row.updated_at,
        };
      });

      for (const [plano, nosso] of nossoByPlano.entries()) {
        if (planosSelimp.has(plano)) continue;
        comparativoRows.push({
          plano,
          subprefeitura: nosso.setor || "Não informado",
          tipo_servico: nosso.tipo_servico,
          percentual_selimp: null,
          percentual_nosso: nosso.percentual_nosso,
          diferenca_percentual: null,
          origem: "somente_nosso",
        });
      }

      const subprefeituras = Array.from(bySubprefeitura.entries())
        .map(([subprefeitura, data]) => ({
          subprefeitura,
          quantidade_planos: data.quantidade,
          media_execucao: data.execCount > 0 ? Number((data.execTotal / data.execCount).toFixed(2)) : null,
        }))
        .sort((a, b) => b.quantidade_planos - a.quantidade_planos);

      const servicos = Array.from(byServico.entries())
        .map(([tipo_servico, data]) => ({
          tipo_servico,
          quantidade_planos: data.quantidade,
          media_execucao: data.execCount > 0 ? Number((data.execTotal / data.execCount).toFixed(2)) : null,
        }))
        .sort((a, b) => b.quantidade_planos - a.quantidade_planos);

      const mesclados = mergedRows.slice(0, 200);
      const comparativo = comparativoRows
        .sort((a, b) => {
          const ad = Math.abs(a.diferenca_percentual ?? -1);
          const bd = Math.abs(b.diferenca_percentual ?? -1);
          return bd - ad;
        })
        .slice(0, 400);
      const divergencias = comparativoRows.filter(
        (r) => r.diferenca_percentual != null && Math.abs(r.diferenca_percentual) >= 5
      ).length;
      const apenasSelimp = comparativoRows.filter((r) => r.origem === "somente_selimp").length;
      const apenasNosso = comparativoRows.filter((r) => r.origem === "somente_nosso").length;

      return {
        periodo: {
          inicial: inicio ?? null,
          final: fim ?? null,
        },
        resumo: {
          total_planos: totalPlanos,
          total_planos_ativos: totalPlanosAtivos,
          media_execucao_planos_ativos:
            execAtivaCount > 0 ? Number((execAtivaTotal / execAtivaCount).toFixed(2)) : null,
          total_modulos_relacionados: totalModulosRelacionados,
          total_modulos_ativos: totalModulosAtivos,
          total_modulos_inativos: totalModulosInativos,
          sem_status_bateria: semStatus,
          comunicacao_off: comunicacaoOff,
          bateria_critica: bateriaCritica,
          bateria_alerta: bateriaBaixa,
        },
        subprefeituras,
        servicos,
        mesclados,
        comparativo: {
          total_linhas: comparativoRows.length,
          divergencias,
          somente_selimp: apenasSelimp,
          somente_nosso: apenasNosso,
          itens: comparativo,
        },
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
