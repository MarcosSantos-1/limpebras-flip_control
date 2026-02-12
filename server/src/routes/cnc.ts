import { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";

export const cncRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { periodo_inicial?: string; periodo_final?: string } }>(
    "/cnc",
    async (request, reply) => {
      const { periodo_inicial, periodo_final } = request.query;
      let sql = "SELECT id, numero_bfs, data_fiscalizacao, data_vistoria, status, tipo_servico, regional, endereco FROM bfs WHERE 1=1";
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
      sql += " ORDER BY data_fiscalizacao DESC LIMIT 2000";
      const r = await pool.query(sql, params);
      const rows = r.rows.map((row) => ({
        id: String(row.id),
        bfs: row.numero_bfs,
        subprefeitura: row.regional,
        status: row.status,
        data_abertura: row.data_fiscalizacao ? new Date(row.data_fiscalizacao).toISOString() : null,
        endereco: row.endereco,
      }));
      return { items: rows, total: rows.length };
    }
  );
};
