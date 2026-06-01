import { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";
import { cacheKey, getOrSet } from "../cache.js";
import {
  computeForaDoPrazoSac,
  deriveSacStatus,
  effectiveSacExecutionDate,
  toIsoOrNull,
} from "../services/sac-derive.js";

type SacsListQuery = {
  periodo_inicial?: string;
  periodo_final?: string;
  subprefeitura?: string;
  fora_do_prazo?: string | boolean;
  tipo?: "IA" | "IRD" | "all" | string;
  tipo_servico?: string;
  procedente?: "PROCEDE" | "NAO_PROCEDE" | "todos" | string;
  status?: string;
  q?: string;
};

function buildSacsWhereFragment(q: SacsListQuery): { fragment: string; params: (string | number)[] } {
  let fragment = "";
  const params: (string | number)[] = [];
  let i = 1;

  if (q.periodo_inicial) {
    fragment += ` AND data_registro >= $${i}::date`;
    params.push(q.periodo_inicial);
    i++;
  }
  if (q.periodo_final) {
    fragment += ` AND data_registro < ($${i}::date + interval '1 day')`;
    params.push(q.periodo_final);
    i++;
  }
  if (q.subprefeitura && q.subprefeitura !== "todas") {
    fragment += ` AND regional = $${i}`;
    params.push(q.subprefeitura);
    i++;
  }

  const foraDoPrazoFlag = q.fora_do_prazo === true || q.fora_do_prazo === "true";
  /** IRD ou bueiro (classificação vazia): mesmas regras de prazo na query. */
  const sqlAcionPrazoClass = `(
      TRIM(COALESCE(classificacao_do_servico, '')) = 'Reclamação'
      OR TRIM(COALESCE(classificacao_do_servico, '')) = ''
    )`;
  if (foraDoPrazoFlag) {
    fragment += ` AND (
      (
        TRIM(COALESCE(classificacao_do_servico, '')) = 'Solicitação'
        AND UPPER(TRIM(COALESCE(responsividade_execucao, ''))) = 'NÃO'
      )
      OR (
        ${sqlAcionPrazoClass}
        AND data_acionamento_agendamento IS NULL
        AND (data_execucao IS NOT NULL OR data_realizacao_confirmacao_execucao IS NOT NULL)
        AND UPPER(TRIM(COALESCE(responsividade_execucao, ''))) = 'NÃO'
      )
      OR (
        ${sqlAcionPrazoClass}
        AND data_acionamento_agendamento IS NOT NULL
        AND (
          CASE
            WHEN data_realizacao_confirmacao_execucao IS NOT NULL AND data_execucao IS NOT NULL
              THEN GREATEST(data_realizacao_confirmacao_execucao, data_execucao)
            ELSE COALESCE(data_realizacao_confirmacao_execucao, data_execucao)
          END
        ) IS NOT NULL
        AND (
          (CASE
            WHEN data_realizacao_confirmacao_execucao IS NOT NULL AND data_execucao IS NOT NULL
              THEN GREATEST(data_realizacao_confirmacao_execucao, data_execucao)
            ELSE COALESCE(data_realizacao_confirmacao_execucao, data_execucao)
          END AT TIME ZONE 'America/Sao_Paulo')::date
          > (data_acionamento_agendamento AT TIME ZONE 'America/Sao_Paulo')::date
        )
      )
    )`;
  }

  if (q.tipo === "IA") {
    fragment += ` AND TRIM(COALESCE(classificacao_do_servico, '')) = 'Solicitação'`;
    fragment += ` AND UPPER(TRIM(COALESCE(finalizado_fora_de_escopo, ''))) = 'NÃO'`;
  } else if (q.tipo === "IRD") {
    fragment += ` AND TRIM(COALESCE(classificacao_do_servico, '')) = 'Reclamação'`;
    fragment += ` AND UPPER(TRIM(COALESCE(finalizado_fora_de_escopo, ''))) = 'NÃO'`;
    fragment += ` AND UPPER(TRIM(COALESCE(procedente_por_status, ''))) = 'PROCEDE'`;
  } else if (q.tipo === "Bueiros") {
    fragment += ` AND TRIM(COALESCE(classificacao_do_servico, '')) = ''`;
    fragment += ` AND UPPER(TRIM(COALESCE(finalizado_fora_de_escopo, ''))) = 'NÃO'`;
  }

  if (q.tipo_servico && q.tipo_servico !== "todos") {
    fragment += ` AND servico ILIKE $${i}`;
    params.push(`%${q.tipo_servico}%`);
    i++;
  }

  if (q.procedente && q.procedente !== "todos") {
    if (q.procedente === "PROCEDE") {
      fragment += ` AND UPPER(TRIM(COALESCE(procedente_por_status, ''))) = 'PROCEDE'`;
    } else if (q.procedente === "NAO_PROCEDE") {
      fragment += ` AND UPPER(TRIM(COALESCE(procedente_por_status, ''))) <> 'PROCEDE'`;
    }
  }

  if (q.status && q.status !== "todos") {
    if (q.status === "Finalizado" || q.status === "Executado" || q.status === "Concluído") {
      fragment += ` AND (data_execucao IS NOT NULL OR data_realizacao_confirmacao_execucao IS NOT NULL)`;
    } else if (q.status === "Agendado") {
      fragment += ` AND (data_agendamento IS NOT NULL OR data_acionamento_agendamento IS NOT NULL) AND data_execucao IS NULL AND data_realizacao_confirmacao_execucao IS NULL`;
    } else if (
      q.status === "Em Execução" ||
      q.status === "Aguardando Agendamento" ||
      q.status === "Aguardando Análise"
    ) {
      fragment += ` AND data_execucao IS NULL AND data_realizacao_confirmacao_execucao IS NULL`;
    }
  }

  const search = (q.q ?? "").trim();
  if (search) {
    fragment += ` AND (numero_chamado ILIKE $${i} OR COALESCE(endereco, '') ILIKE $${i})`;
    params.push(`%${search}%`);
    i++;
  }

  return { fragment, params };
}

type SacPgRow = {
  id: unknown;
  numero_chamado: string | null;
  data_registro: Date | string | null;
  data_execucao: Date | string | null;
  data_agendamento?: Date | string | null;
  data_acionamento_agendamento?: Date | string | null;
  data_realizacao_confirmacao_execucao?: Date | string | null;
  data_ultima_atualizacao?: Date | string | null;
  status_planilha?: string | null;
  classificacao_do_servico: string | null;
  responsividade_execucao: string | null;
  procedente_por_status: string | null;
  finalizado_fora_de_escopo: string | null;
  regional: string | null;
  servico: string | null;
  endereco: string | null;
};

function mapSacRowToApi(row: SacPgRow) {
  const dataExec = row.data_execucao ? new Date(row.data_execucao) : null;
  const dataReal = row.data_realizacao_confirmacao_execucao
    ? new Date(row.data_realizacao_confirmacao_execucao)
    : null;
  const dataAgend = row.data_agendamento ? new Date(row.data_agendamento) : null;
  const dataAcion = row.data_acionamento_agendamento ? new Date(row.data_acionamento_agendamento) : null;
  const dataUlt = row.data_ultima_atualizacao ? new Date(row.data_ultima_atualizacao) : null;
  const eff = effectiveSacExecutionDate(dataReal, dataExec);
  const status = deriveSacStatus({
    status_planilha: row.status_planilha,
    data_execucao: dataExec,
    data_realizacao_confirmacao: dataReal,
    data_agendamento: dataAgend,
    data_acionamento_agendamento: dataAcion,
  });
  const fora_do_prazo = computeForaDoPrazoSac({
    classificacao_do_servico: row.classificacao_do_servico,
    responsividade_execucao: row.responsividade_execucao,
    data_acionamento_agendamento: dataAcion,
    data_execucao: dataExec,
    data_realizacao_confirmacao: dataReal,
  });
  return {
    id: String(row.id),
    protocolo: row.numero_chamado ?? "",
    tipo_servico: row.servico ?? "",
    status,
    subprefeitura: row.regional,
    endereco_text: row.endereco,
    data_criacao: toIsoOrNull(row.data_registro),
    data_agendamento: toIsoOrNull(dataAgend),
    data_acionamento_agendamento: toIsoOrNull(dataAcion),
    data_execucao: toIsoOrNull(dataExec),
    data_realizacao_confirmacao_execucao: toIsoOrNull(dataReal),
    data_finalizacao_efetiva: toIsoOrNull(eff),
    data_ultima_atualizacao: toIsoOrNull(dataUlt),
    status_planilha: row.status_planilha ?? null,
    classificacao_servico: row.classificacao_do_servico,
    responsividade_execucao: row.responsividade_execucao,
    finalizado_fora_de_escopo: row.finalizado_fora_de_escopo,
    procedente_por_status: row.procedente_por_status,
    fora_do_prazo,
  };
}

export const sacsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Querystring: SacsListQuery & {
      limit?: number | string;
      page?: number | string;
      page_size?: number | string;
    };
  }>("/sacs", async (request, reply) => {
    const {
      periodo_inicial,
      periodo_final,
      subprefeitura,
      fora_do_prazo,
      tipo,
      tipo_servico,
      procedente,
      status,
      q,
      page: pageRaw,
      page_size: pageSizeRaw,
      limit: limitLegacy,
    } = request.query;

    const listQuery: SacsListQuery = {
      periodo_inicial,
      periodo_final,
      subprefeitura,
      fora_do_prazo,
      tipo,
      tipo_servico,
      procedente,
      status,
      q,
    };

    const pageParsed = Number(pageRaw);
    const page = Number.isFinite(pageParsed) && pageParsed >= 1 ? Math.floor(pageParsed) : 1;

    const pageSizeParsed = Number(pageSizeRaw ?? limitLegacy);
    const pageSize =
      Number.isFinite(pageSizeParsed) && pageSizeParsed > 0
        ? Math.min(Math.floor(pageSizeParsed), 10000)
        : 50;

    const { fragment, params: whereParams } = buildSacsWhereFragment(listQuery);
    const offset = (page - 1) * pageSize;

    const key = cacheKey("sacs", {
      periodo_inicial,
      periodo_final,
      subprefeitura,
      tipo,
      tipo_servico,
      procedente,
      status,
      fora_do_prazo,
      q: (q ?? "").trim(),
      page,
      page_size: pageSize,
    });

    const result = await getOrSet(key, async () => {
      const statsSql = `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE TRIM(COALESCE(classificacao_do_servico, '')) = 'Solicitação'
              AND UPPER(TRIM(COALESCE(finalizado_fora_de_escopo, ''))) = 'NÃO'
              AND UPPER(TRIM(COALESCE(responsividade_execucao, ''))) IN ('SIM', 'NÃO')
          )::int AS demandantes,
          COUNT(*) FILTER (
            WHERE TRIM(COALESCE(classificacao_do_servico, '')) = 'Solicitação'
              AND UPPER(TRIM(COALESCE(finalizado_fora_de_escopo, ''))) = 'NÃO'
              AND UPPER(TRIM(COALESCE(responsividade_execucao, ''))) = 'SIM'
          )::int AS no_prazo,
          COUNT(*) FILTER (
            WHERE TRIM(COALESCE(classificacao_do_servico, '')) = 'Solicitação'
              AND UPPER(TRIM(COALESCE(finalizado_fora_de_escopo, ''))) = 'NÃO'
              AND UPPER(TRIM(COALESCE(responsividade_execucao, ''))) = 'NÃO'
          )::int AS fora_prazo,
          COUNT(*) FILTER (
            WHERE TRIM(COALESCE(classificacao_do_servico, '')) = 'Reclamação'
              AND UPPER(TRIM(COALESCE(finalizado_fora_de_escopo, ''))) = 'NÃO'
              AND UPPER(TRIM(COALESCE(procedente_por_status, ''))) = 'PROCEDE'
          )::int AS escalonados
        FROM sacs WHERE 1=1 ${fragment}`;
      const statsR = await pool.query(statsSql, whereParams);
      const st = statsR.rows[0] as {
        total: number;
        demandantes: number;
        no_prazo: number;
        fora_prazo: number;
        escalonados: number;
      };

      const countSql = `SELECT COUNT(*)::int AS c FROM sacs WHERE 1=1 ${fragment}`;
      const countR = await pool.query(countSql, whereParams);
      const totalRows = Number(countR.rows[0]?.c ?? 0);

      const limitPos = whereParams.length + 1;
      const offsetPos = whereParams.length + 2;
      const listSql = `
        SELECT id, numero_chamado, data_registro, classificacao_do_servico, responsividade_execucao,
          procedente_por_status, finalizado_fora_de_escopo, regional, servico, endereco, data_execucao,
          data_agendamento, data_acionamento_agendamento, data_realizacao_confirmacao_execucao, data_ultima_atualizacao, status_planilha
        FROM sacs WHERE 1=1 ${fragment}
        ORDER BY data_registro DESC
        LIMIT $${limitPos} OFFSET $${offsetPos}`;
      const listParams = [...whereParams, pageSize, offset];
      const r = await pool.query(listSql, listParams);
      const rows = r.rows.map((row: SacPgRow) => mapSacRowToApi(row));

      return {
        items: rows,
        total: totalRows,
        page,
        page_size: pageSize,
        stats: {
          total: st.total,
          demandantes: st.demandantes,
          escalonados: st.escalonados,
          no_prazo: st.no_prazo,
          fora_prazo: st.fora_prazo,
        },
      };
    });
    return result;
  });

  fastify.get("/sacs/urgentes", async () => {
    return { items: [] };
  });

  fastify.get<{ Params: { id: string } }>("/sacs/:id", async (request, reply) => {
    const r = await pool.query("SELECT * FROM sacs WHERE id = $1", [request.params.id]);
    if (r.rows.length === 0) return reply.code(404).send({ detail: "SAC não encontrado" });
    return mapSacRowToApi(r.rows[0] as SacPgRow);
  });

  fastify.post<{ Params: { id: string }; Querystring: { data_agendamento: string } }>(
    "/sacs/:id/agendar",
    async (request, reply) => {
      return { ok: true };
    }
  );

};
