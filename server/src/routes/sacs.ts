import { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";

export const sacsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Querystring: {
      periodo_inicial?: string;
      periodo_final?: string;
      subprefeitura?: string;
      fora_do_prazo?: string | boolean;
      tipo?: "IA" | "IRD" | "all" | string;
      tipo_servico?: string;
      procedente?: "PROCEDE" | "NAO_PROCEDE" | "todos" | string;
      status?: string;
      limit?: number | string;
    };
  }>(
    "/sacs",
    async (request, reply) => {
      const {
        periodo_inicial,
        periodo_final,
        subprefeitura,
        fora_do_prazo,
        tipo,
        tipo_servico,
        procedente,
        status,
        limit,
      } = request.query;
      let sql =
        "SELECT id, numero_chamado, data_registro, classificacao_do_servico, responsividade_execucao, procedente_por_status, finalizado_fora_de_escopo, regional, servico, endereco, data_execucao FROM sacs WHERE 1=1";
      const params: (string | number)[] = [];
      let i = 1;
      if (periodo_inicial) {
        sql += ` AND data_registro >= $${i}::date`;
        params.push(periodo_inicial);
        i++;
      }
      if (periodo_final) {
        sql += ` AND data_registro < ($${i}::date + interval '1 day')`;
        params.push(periodo_final);
        i++;
      }
      if (subprefeitura && subprefeitura !== "todas") {
        sql += ` AND regional = $${i}`;
        params.push(subprefeitura);
        i++;
      }

      const foraDoPrazoFlag = fora_do_prazo === true || fora_do_prazo === "true";
      if (foraDoPrazoFlag) {
        sql += ` AND UPPER(TRIM(COALESCE(responsividade_execucao, ''))) = 'NÃO'`;
      }

      // IA/IRD com as regras de negócio
      if (tipo === "IA") {
        sql += ` AND TRIM(COALESCE(classificacao_do_servico, '')) = 'Solicitação'`;
        sql += ` AND UPPER(TRIM(COALESCE(finalizado_fora_de_escopo, ''))) = 'NÃO'`;
      } else if (tipo === "IRD") {
        sql += ` AND TRIM(COALESCE(classificacao_do_servico, '')) = 'Reclamação'`;
        sql += ` AND UPPER(TRIM(COALESCE(finalizado_fora_de_escopo, ''))) = 'NÃO'`;
        sql += ` AND UPPER(TRIM(COALESCE(procedente_por_status, ''))) = 'PROCEDE'`;
      }

      if (tipo_servico && tipo_servico !== "todos") {
        sql += ` AND servico ILIKE $${i}`;
        params.push(`%${tipo_servico}%`);
        i++;
      }

      if (procedente && procedente !== "todos") {
        if (procedente === "PROCEDE") {
          sql += ` AND UPPER(TRIM(COALESCE(procedente_por_status, ''))) = 'PROCEDE'`;
        } else if (procedente === "NAO_PROCEDE") {
          sql += ` AND UPPER(TRIM(COALESCE(procedente_por_status, ''))) <> 'PROCEDE'`;
        }
      }

      if (status && status !== "todos") {
        if (status === "Finalizado" || status === "Executado") {
          sql += ` AND data_execucao IS NOT NULL`;
        } else if (
          status === "Em Execução" ||
          status === "Aguardando Agendamento" ||
          status === "Aguardando Análise"
        ) {
          sql += ` AND data_execucao IS NULL`;
        }
      }

      const requestedLimit = Number(limit);
      const effectiveLimit =
        Number.isFinite(requestedLimit) && requestedLimit > 0
          ? Math.min(requestedLimit, 50000)
          : 10000;
      sql += ` ORDER BY data_registro DESC LIMIT $${i}`;
      params.push(effectiveLimit);
      const r = await pool.query(sql, params);
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
      return { items: rows, total: rows.length };
    }
  );

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

  fastify.get("/sacs/urgentes", async () => {
    return { items: [] };
  });
};
