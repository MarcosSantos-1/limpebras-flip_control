import { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";
import { parseSacCsv, parseBfsCsv, parseOuvidoriaCsv, parseAcicCsv } from "../services/parseCsv.js";
import { BFS_NAO_DEMANDANTES } from "../constants/bfs.js";

export const uploadRoutes: FastifyPluginAsync = async (fastify) => {
  const getLastUpdate = async (table: "sacs" | "bfs" | "acic" | "ouvidoria") => {
    const last = await pool.query(
      `SELECT source_file, updated_at FROM ${table} ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`
    );
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM ${table}`);
    return {
      ultimo_import: last.rows[0]?.updated_at ?? null,
      source_file: last.rows[0]?.source_file ?? null,
      total_registros: Number(count.rows[0]?.total ?? 0),
    };
  };

  fastify.post("/upload/sacs-csv", async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ detail: "Arquivo CSV obrigatório" });
    const buffer = await data.toBuffer();
    const sourceFile = data.filename;
    const rows = parseSacCsv(buffer, sourceFile);

    const client = await pool.connect();
    try {
      let inserted = 0;
      let updated = 0;
      for (const r of rows) {
        const updatedResult = await client.query(
          `UPDATE sacs SET
            data_registro = $2,
            finalizado_fora_de_escopo = $3,
            classificacao_do_servico = $4,
            responsividade_execucao = $5,
            procedente_por_status = $6,
            regional = $7,
            servico = $8,
            endereco = $9,
            data_execucao = $10,
            raw = $11,
            source_file = $12,
            updated_at = NOW()
          WHERE numero_chamado = $1`,
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
        if ((updatedResult.rowCount ?? 0) > 0) {
          updated += updatedResult.rowCount ?? 0;
          continue;
        }

        await client.query(
          `INSERT INTO sacs (
            numero_chamado, data_registro, finalizado_fora_de_escopo, classificacao_do_servico,
            responsividade_execucao, procedente_por_status, regional, servico, endereco, data_execucao, raw, source_file, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
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
        inserted += 1;
      }
      return {
        processados: inserted + updated,
        total: rows.length,
        inseridos: inserted,
        atualizados: updated,
        duplicados: 0,
        erros: 0,
        ultimo_import: new Date().toISOString(),
      };
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
      let updated = 0;
      for (const r of rows) {
        const updatedResult = await client.query(
          `UPDATE bfs SET
            data_fiscalizacao = $2,
            data_vistoria = $3,
            status = $4,
            tipo_servico = $5,
            regional = $6,
            endereco = $7,
            raw = $8,
            source_file = $9,
            updated_at = NOW()
          WHERE numero_bfs = $1`,
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
        if ((updatedResult.rowCount ?? 0) > 0) {
          updated += updatedResult.rowCount ?? 0;
          continue;
        }
        await client.query(
          `INSERT INTO bfs (
            numero_bfs, data_fiscalizacao, data_vistoria, status, tipo_servico, regional, endereco, raw, source_file, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
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
        inserted += 1;
      }
      return {
        processados: inserted + updated,
        total: rows.length,
        inseridos: inserted,
        atualizados: updated,
        duplicados: 0,
        erros: 0,
        ultimo_import: new Date().toISOString(),
      };
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
        await client.query(`INSERT INTO ouvidoria (raw, source_file, updated_at) VALUES ($1, $2, NOW())`, [
          JSON.stringify(row),
          sourceFile,
        ]);
        inserted++;
      }
      return {
        processados: inserted,
        total: rows.length,
        inseridos: inserted,
        atualizados: 0,
        duplicados: 0,
        erros: 0,
        ultimo_import: new Date().toISOString(),
      };
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
        await client.query(`INSERT INTO acic (raw, source_file, updated_at) VALUES ($1, $2, NOW())`, [
          JSON.stringify(row),
          sourceFile,
        ]);
        inserted++;
      }
      return {
        processados: inserted,
        total: rows.length,
        inseridos: inserted,
        atualizados: 0,
        duplicados: 0,
        erros: 0,
        ultimo_import: new Date().toISOString(),
      };
    } finally {
      client.release();
    }
  });

  fastify.get("/upload/last-updates", async () => {
    const [sacs, cnc, acic, ouvidoria] = await Promise.all([
      getLastUpdate("sacs"),
      getLastUpdate("bfs"),
      getLastUpdate("acic"),
      getLastUpdate("ouvidoria"),
    ]);
    return { sacs, cnc, acic, ouvidoria };
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
