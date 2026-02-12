import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseUrl.includes("neon.tech") ? { rejectUnauthorized: false } : undefined,
});

/**
 * Migrations: apenas cria tabelas/índices se não existirem.
 * NUNCA apaga dados – se precisar resetar, faça manualmente no Neon.
 */
export async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS sacs (
        id SERIAL PRIMARY KEY,
        numero_chamado TEXT,
        data_registro TIMESTAMPTZ,
        finalizado_fora_de_escopo TEXT,
        classificacao_do_servico TEXT,
        responsividade_execucao TEXT,
        procedente_por_status TEXT,
        regional TEXT,
        servico TEXT,
        endereco TEXT,
        data_execucao TIMESTAMPTZ,
        raw JSONB,
        source_file TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_sacs_data_registro ON sacs(data_registro)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_sacs_classificacao ON sacs(classificacao_do_servico)").catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS bfs (
        id SERIAL PRIMARY KEY,
        numero_bfs TEXT,
        data_fiscalizacao TIMESTAMPTZ,
        data_vistoria TIMESTAMPTZ,
        status TEXT,
        tipo_servico TEXT,
        regional TEXT,
        endereco TEXT,
        raw JSONB,
        source_file TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_bfs_data_fiscalizacao ON bfs(data_fiscalizacao)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_bfs_tipo_servico ON bfs(tipo_servico)").catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS ouvidoria (
        id SERIAL PRIMARY KEY,
        raw JSONB,
        source_file TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS acic (
        id SERIAL PRIMARY KEY,
        raw JSONB,
        source_file TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  } finally {
    client.release();
  }
}
