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
