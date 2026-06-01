import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import pg from "pg";
import { enrichDadosBateriaFromSetoresModulos } from "./enrichDadosBateriaFromSetores.js";

test("enrich SQL só atualiza linhas criadas após o último import de setores_modulos", async () => {
  let capturedSql = "";
  const client = {
    query: async (sql: string) => {
      capturedSql = sql;
      return { rowCount: 0, rows: [], command: "", oid: 0, fields: [] };
    },
  } as unknown as PoolClient;

  await enrichDadosBateriaFromSetoresModulos(client, { dataExportacao: "2026-05-21" });

  assert.match(capturedSql, /created_at >=/);
  assert.match(capturedSql, /MAX\(updated_at\)/);
  assert.match(capturedSql, /FROM setores_modulos/);
  assert.match(capturedSql, /data_exportacao = ANY\(\$1::date\[\]\)/);
});

test("enrich retorna 0 quando nenhuma data é informada", async () => {
  const client = {
    query: async () => {
      throw new Error("query não deveria ser chamada");
    },
  } as unknown as PoolClient;

  const result = await enrichDadosBateriaFromSetoresModulos(client, { dataExportacoes: ["", "  "] });
  assert.equal(result.atualizados, 0);
});

const databaseUrl = process.env.DATABASE_URL?.trim();

test(
  "enrich não altera ipt_dados_bateria criado antes do último SETORES",
  { skip: !databaseUrl },
  async () => {
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl!.includes("neon.tech") ? { rejectUnauthorized: false } : undefined,
    });
    const client = await pool.connect();
    const recordKey = `test-enrich-guard-${Date.now()}`;
    const selimpId = `TEST-${Date.now()}`;
    const dataExportacao = "2020-01-15";
    const setorAntigo = "CV-TEST-OLD";
    const setorNovo = "CV-TEST-NEW";

    try {
      await client.query("BEGIN");

      await client.query(`DELETE FROM ipt_dados_bateria WHERE record_key = $1`, [recordKey]);
      await client.query(`DELETE FROM setores_modulos WHERE setor IN ($1, $2)`, [setorAntigo, setorNovo]);

      await client.query(
        `INSERT INTO setores_modulos (
           setor, subprefeitura, servico, frequencia, dias_execucao,
           selimp_codigo, raw, source_file, updated_at
         ) VALUES ($1, 'JT', '500', '0500', '2', $2, '{}'::jsonb, 'test-old-setores.xlsx', NOW() - INTERVAL '2 days')`,
        [setorAntigo, selimpId]
      );

      await client.query(
        `INSERT INTO ipt_dados_bateria (
           record_key, data_exportacao, nome, tipo_modulo, selimp_id,
           subprefeitura, setor, dias_execucao, status_comunicacao, source_file, created_at
         ) VALUES ($1, $2::date, 'Teste', 'LUTOCAR', $3, 'JT', $4, '2', 'ON', 'test.xlsx', NOW() - INTERVAL '3 days')`,
        [recordKey, dataExportacao, selimpId, setorAntigo]
      );

      await client.query(
        `INSERT INTO setores_modulos (
           setor, subprefeitura, servico, frequencia, dias_execucao,
           selimp_codigo, raw, source_file, updated_at
         ) VALUES ($1, 'JT', '500', '0500', '3', $2, '{}'::jsonb, 'test-new-setores.xlsx', NOW())`,
        [setorNovo, selimpId]
      );

      const { atualizados } = await enrichDadosBateriaFromSetoresModulos(client, {
        dataExportacao,
      });
      assert.equal(atualizados, 0);

      const row = await client.query<{ setor: string }>(
        `SELECT setor FROM ipt_dados_bateria WHERE record_key = $1`,
        [recordKey]
      );
      assert.equal(row.rows[0]?.setor, setorAntigo);

      await client.query("ROLLBACK");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
      await pool.end();
    }
  }
);
