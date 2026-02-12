import { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";
import { parseSacCsv, parseBfsCsv, parseOuvidoriaCsv, parseAcicCsv } from "../services/parseCsv.js";
import { BFS_NAO_DEMANDANTES } from "../constants/bfs.js";

export const uploadRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/upload/sacs-csv", async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ detail: "Arquivo CSV obrigatório" });
    const buffer = await data.toBuffer();
    const sourceFile = data.filename;
    const rows = parseSacCsv(buffer, sourceFile);

    const client = await pool.connect();
    try {
      let inserted = 0;
      for (const r of rows) {
        await client.query(
          `INSERT INTO sacs (
            numero_chamado, data_registro, finalizado_fora_de_escopo, classificacao_do_servico,
            responsividade_execucao, procedente_por_status, regional, servico, endereco, data_execucao, raw, source_file
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            r.numero_chamado || null,
            r.data_registro,
            r.finalizado_fora_de_escopo || null,
            r.classificacao_do_servico || null,
            r.responsividade_execucao || null,
            r.procedente_por_status || null,
            r.regional || null,
            r.servico || null,
            r.endereco || null,
            r.data_execucao,
            JSON.stringify(r.raw),
            sourceFile,
          ]
        );
        inserted++;
      }
      return { inserted, total: rows.length };
    } finally {
      client.release();
    }
  });

  fastify.post("/upload/cnc-csv", async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ detail: "Arquivo CSV obrigatório (BFS/CNC)" });
    const buffer = await data.toBuffer();
    const sourceFile = data.filename;
    const rows = parseBfsCsv(buffer, sourceFile);

    const client = await pool.connect();
    try {
      let inserted = 0;
      for (const r of rows) {
        await client.query(
          `INSERT INTO bfs (
            numero_bfs, data_fiscalizacao, data_vistoria, status, tipo_servico, regional, endereco, raw, source_file
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            r.numero_bfs || null,
            r.data_fiscalizacao,
            r.data_vistoria,
            r.status || null,
            r.tipo_servico || null,
            r.regional || null,
            r.endereco || null,
            JSON.stringify(r.raw),
            sourceFile,
          ]
        );
        inserted++;
      }
      return { inserted, total: rows.length };
    } finally {
      client.release();
    }
  });

  fastify.post("/upload/ouvidoria-csv", async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ detail: "Arquivo CSV obrigatório" });
    const buffer = await data.toBuffer();
    const sourceFile = data.filename;
    const rows = parseOuvidoriaCsv(buffer);

    const client = await pool.connect();
    try {
      let inserted = 0;
      for (const row of rows) {
        await client.query(`INSERT INTO ouvidoria (raw, source_file) VALUES ($1, $2)`, [
          JSON.stringify(row),
          sourceFile,
        ]);
        inserted++;
      }
      return { inserted, total: rows.length };
    } finally {
      client.release();
    }
  });

  fastify.post("/upload/acic-csv", async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ detail: "Arquivo CSV obrigatório" });
    const buffer = await data.toBuffer();
    const sourceFile = data.filename;
    const rows = parseAcicCsv(buffer);

    const client = await pool.connect();
    try {
      let inserted = 0;
      for (const row of rows) {
        await client.query(`INSERT INTO acic (raw, source_file) VALUES ($1, $2)`, [
          JSON.stringify(row),
          sourceFile,
        ]);
        inserted++;
      }
      return { inserted, total: rows.length };
    } finally {
      client.release();
    }
  });

  fastify.post("/upload/clear-sacs", async (_request, reply) => {
    const r = await pool.query("DELETE FROM sacs WHERE source_file IS NOT NULL RETURNING id");
    return { deleted: r.rowCount ?? 0 };
  });

  fastify.post("/upload/clear-cnc", async (_request, reply) => {
    const r = await pool.query("DELETE FROM bfs RETURNING id");
    return { deleted: r.rowCount ?? 0 };
  });

  fastify.post("/upload/clear-ouvidoria", async (_request, reply) => {
    const r = await pool.query("DELETE FROM ouvidoria RETURNING id");
    return { deleted: r.rowCount ?? 0 };
  });

  fastify.post("/upload/clear-acic", async (_request, reply) => {
    const r = await pool.query("DELETE FROM acic RETURNING id");
    return { deleted: r.rowCount ?? 0 };
  });
};
