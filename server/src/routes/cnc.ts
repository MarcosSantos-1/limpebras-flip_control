import { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";

export const cncRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Querystring: {
      periodo_inicial?: string;
      periodo_final?: string;
      subprefeitura?: string;
      status?: string;
      tipo_servico?: string;
    };
  }>(
    "/cnc",
    async (request, reply) => {
      const { periodo_inicial, periodo_final, subprefeitura, status, tipo_servico } = request.query;
      let sql =
        "SELECT id, numero_bfs, data_fiscalizacao, data_vistoria, status, tipo_servico, regional, endereco, raw FROM bfs WHERE 1=1";
      const params: (string | number)[] = [];
      let i = 1;
      if (periodo_inicial) {
        sql += ` AND data_fiscalizacao >= $${i}::date`;
        params.push(periodo_inicial);
        i++;
      }
      if (periodo_final) {
        sql += ` AND data_fiscalizacao < ($${i}::date + interval '1 day')`;
        params.push(periodo_final);
        i++;
      }
      if (subprefeitura && subprefeitura !== "todas") {
        sql += ` AND regional = $${i}`;
        params.push(subprefeitura);
        i++;
      }
      if (status && status !== "todos") {
        if (status === "Sem Irregularidades") {
          sql += ` AND TRIM(COALESCE(status, '')) = 'Sem Irregularidades'`;
        } else if (status === "Com Irregularidades") {
          sql += ` AND TRIM(COALESCE(status, '')) <> 'Sem Irregularidades'`;
        } else {
          sql += ` AND status ILIKE $${i}`;
          params.push(`%${status}%`);
          i++;
        }
      }
      if (tipo_servico && tipo_servico !== "todos") {
        sql += ` AND tipo_servico ILIKE $${i}`;
        params.push(`%${tipo_servico}%`);
        i++;
      }
      sql += " ORDER BY data_fiscalizacao DESC LIMIT 2000";
      const r = await pool.query(sql, params);
      const rows = r.rows.map((row) => ({
        id: String(row.id),
        bfs: row.numero_bfs,
        subprefeitura: row.regional,
        status: row.status,
        data_abertura: row.data_fiscalizacao ? new Date(row.data_fiscalizacao).toISOString() : null,
        data_vistoria: row.data_vistoria ? new Date(row.data_vistoria).toISOString() : null,
        endereco: row.endereco,
        tipo_servico: row.tipo_servico,
        fiscal: row.raw?.Fiscal || row.raw?.fiscal || null,
        sem_irregularidade: (row.status || "").trim() === "Sem Irregularidades",
      }));
      return { items: rows, total: rows.length };
    }
  );
};
