import { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";

export const acicRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/acic", async (_request, _reply) => {
    const r = await pool.query("SELECT id, raw, source_file, created_at FROM acic ORDER BY created_at DESC LIMIT 500");
    return { items: r.rows.map((row) => ({ id: String(row.id), ...row.raw, source_file: row.source_file })), total: r.rows.length };
  });

  fastify.get<{ Params: { id: string } }>("/acic/:id", async (request, reply) => {
    const r = await pool.query("SELECT * FROM acic WHERE id = $1", [request.params.id]);
    if (r.rows.length === 0) return reply.code(404).send({ detail: "ACIC não encontrado" });
    const row = r.rows[0];
    return { id: String(row.id), ...row.raw };
  });
};
