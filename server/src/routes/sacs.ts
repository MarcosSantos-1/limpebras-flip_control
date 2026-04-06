import { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";
import { cacheKey, getOrSet } from "../cache.js";

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
  if (foraDoPrazoFlag) {
    fragment += ` AND UPPER(TRIM(COALESCE(responsividade_execucao, ''))) = 'NÃO'`;
  }

  if (q.tipo === "IA") {
    fragment += ` AND TRIM(COALESCE(classificacao_do_servico, '')) = 'Solicitação'`;
    fragment += ` AND UPPER(TRIM(COALESCE(finalizado_fora_de_escopo, ''))) = 'NÃO'`;
  } else if (q.tipo === "IRD") {
    fragment += ` AND TRIM(COALESCE(classificacao_do_servico, '')) = 'Reclamação'`;
    fragment += ` AND UPPER(TRIM(COALESCE(finalizado_fora_de_escopo, ''))) = 'NÃO'`;
    fragment += ` AND UPPER(TRIM(COALESCE(procedente_por_status, ''))) = 'PROCEDE'`;
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
    if (q.status === "Finalizado" || q.status === "Executado") {
      fragment += ` AND data_execucao IS NOT NULL`;
    } else if (
      q.status === "Em Execução" ||
      q.status === "Aguardando Agendamento" ||
      q.status === "Aguardando Análise"
    ) {
      fragment += ` AND data_execucao IS NULL`;
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
        SELECT id, numero_chamado, data_registro, classificacao_do_servico, responsividade_execucao, procedente_por_status, finalizado_fora_de_escopo, regional, servico, endereco, data_execucao
        FROM sacs WHERE 1=1 ${fragment}
        ORDER BY data_registro DESC
        LIMIT $${limitPos} OFFSET $${offsetPos}`;
      const listParams = [...whereParams, pageSize, offset];
      const r = await pool.query(listSql, listParams);
      const rows = r.rows.map((row) => ({
        id: String(row.id),
        protocolo: row.numero_chamado,
        tipo_servico: row.servico,
        status: "Finalizado",
        subprefeitura: row.regional,
        endereco_text: row.endereco,
        data_criacao: row.data_registro ? new Date(row.data_registro).toISOString() : null,
        data_execucao: row.data_execucao ? new Date(row.data_execucao).toISOString() : null,
        classificacao_servico: row.classificacao_do_servico,
        responsividade_execucao: row.responsividade_execucao,
        finalizado_fora_de_escopo: row.finalizado_fora_de_escopo,
        procedente_por_status: row.procedente_por_status,
        fora_do_prazo: (row.responsividade_execucao || "").trim().toUpperCase() === "NÃO",
      }));

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
    const row = r.rows[0];
    return {
      id: String(row.id),
      protocolo: row.numero_chamado,
      tipo_servico: row.servico,
      status: "Finalizado",
      subprefeitura: row.regional,
      endereco_text: row.endereco,
      data_criacao: row.data_registro ? new Date(row.data_registro).toISOString() : null,
      data_execucao: row.data_execucao ? new Date(row.data_execucao).toISOString() : null,
      classificacao_servico: row.classificacao_do_servico,
      responsividade_execucao: row.responsividade_execucao,
      procedente_por_status: row.procedente_por_status,
    };
  });

  fastify.post<{ Params: { id: string }; Querystring: { data_agendamento: string } }>(
    "/sacs/:id/agendar",
    async (request, reply) => {
      return { ok: true };
    }
  );

};
