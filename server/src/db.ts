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
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("ALTER TABLE sacs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()").catch(() => {});
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
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("ALTER TABLE bfs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_bfs_data_fiscalizacao ON bfs(data_fiscalizacao)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_bfs_tipo_servico ON bfs(tipo_servico)").catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS cncs (
        id SERIAL PRIMARY KEY,
        numero_bfs TEXT NOT NULL,
        numero_cnc TEXT,
        situacao_cnc TEXT,
        data_sincronizacao TIMESTAMPTZ,
        data_fiscalizacao TIMESTAMPTZ,
        data_execucao TIMESTAMPTZ,
        fiscal TEXT,
        regional TEXT,
        area TEXT,
        setor TEXT,
        turno TEXT,
        servico TEXT,
        responsividade TEXT,
        endereco TEXT,
        coordenada TEXT,
        fiscal_contratada TEXT,
        raw JSONB,
        source_file TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_cncs_numero_bfs ON cncs(numero_bfs)").catch(() => {});
    await client.query("DROP INDEX IF EXISTS ux_cncs_numero_bfs").catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS ouvidoria (
        id SERIAL PRIMARY KEY,
        raw JSONB,
        source_file TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("ALTER TABLE ouvidoria ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()").catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS acic (
        id SERIAL PRIMARY KEY,
        raw JSONB,
        source_file TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("ALTER TABLE acic ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()").catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS ipt_registros (
        id SERIAL PRIMARY KEY,
        periodo_inicial DATE NOT NULL,
        periodo_final DATE NOT NULL,
        percentual_total NUMERIC(8,4) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (periodo_inicial, periodo_final)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ipt_oficial_mensal (
        ano INTEGER NOT NULL,
        mes INTEGER NOT NULL,
        percentual NUMERIC(8,4) NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (ano, mes)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ipt_selimp_mensal (
        ano INTEGER NOT NULL,
        mes INTEGER NOT NULL,
        ordens JSONB NOT NULL DEFAULT '[]',
        total_linhas INTEGER NOT NULL DEFAULT 0,
        total_encerradas INTEGER NOT NULL DEFAULT 0,
        periodo_inicial DATE,
        periodo_final DATE,
        quantidade_esperada INTEGER,
        validacao_ok BOOLEAN NOT NULL DEFAULT FALSE,
        source_file TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (ano, mes)
      );
    `);
    await client.query("ALTER TABLE ipt_selimp_mensal ADD COLUMN IF NOT EXISTS total_linhas INTEGER NOT NULL DEFAULT 0").catch(() => {});
    await client.query("ALTER TABLE ipt_selimp_mensal ADD COLUMN IF NOT EXISTS total_encerradas INTEGER NOT NULL DEFAULT 0").catch(() => {});
    await client.query("ALTER TABLE ipt_selimp_mensal ADD COLUMN IF NOT EXISTS periodo_inicial DATE").catch(() => {});
    await client.query("ALTER TABLE ipt_selimp_mensal ADD COLUMN IF NOT EXISTS periodo_final DATE").catch(() => {});
    await client.query("ALTER TABLE ipt_selimp_mensal ADD COLUMN IF NOT EXISTS quantidade_esperada INTEGER").catch(() => {});
    await client.query("ALTER TABLE ipt_selimp_mensal ADD COLUMN IF NOT EXISTS validacao_ok BOOLEAN NOT NULL DEFAULT FALSE").catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS ipt_imports (
        id SERIAL PRIMARY KEY,
        file_type TEXT NOT NULL,
        record_key TEXT NOT NULL,
        setor TEXT,
        data_referencia TIMESTAMPTZ,
        ano_referencia INTEGER,
        mes_referencia INTEGER,
        data_estimada BOOLEAN NOT NULL DEFAULT FALSE,
        metodo_data_referencia TEXT,
        servico TEXT,
        raw JSONB NOT NULL,
        source_file TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("ALTER TABLE ipt_imports ADD COLUMN IF NOT EXISTS ano_referencia INTEGER").catch(() => {});
    await client.query("ALTER TABLE ipt_imports ADD COLUMN IF NOT EXISTS mes_referencia INTEGER").catch(() => {});
    await client.query("ALTER TABLE ipt_imports ADD COLUMN IF NOT EXISTS data_estimada BOOLEAN NOT NULL DEFAULT FALSE").catch(() => {});
    await client.query("ALTER TABLE ipt_imports ADD COLUMN IF NOT EXISTS metodo_data_referencia TEXT").catch(() => {});
    await client
      .query("CREATE UNIQUE INDEX IF NOT EXISTS ux_ipt_imports_file_key ON ipt_imports(file_type, record_key)")
      .catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_ipt_imports_tipo ON ipt_imports(file_type)").catch(() => {});
    await client
      .query("CREATE INDEX IF NOT EXISTS idx_ipt_imports_data_referencia ON ipt_imports(data_referencia)")
      .catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_ipt_imports_setor ON ipt_imports(setor)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_ipt_imports_mes_ref ON ipt_imports(file_type, ano_referencia, mes_referencia)").catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS ipt_cronograma (
        id SERIAL PRIMARY KEY,
        servico TEXT NOT NULL,
        setor TEXT NOT NULL,
        data_esperada DATE NOT NULL,
        ano INTEGER,
        raw JSONB,
        source_file TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (servico, setor, data_esperada)
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_ipt_cronograma_servico ON ipt_cronograma(servico)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_ipt_cronograma_setor ON ipt_cronograma(setor)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_ipt_cronograma_data ON ipt_cronograma(data_esperada)").catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS ipt_observacoes_globais (
        id SERIAL PRIMARY KEY,
        setor TEXT NOT NULL,
        titulo TEXT NOT NULL,
        descricao TEXT,
        data_cancelamento TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_ipt_obs_globais_setor ON ipt_observacoes_globais(setor)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_ipt_obs_globais_ativo ON ipt_observacoes_globais(setor) WHERE data_cancelamento IS NULL").catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS ipt_observacoes_diarias (
        id SERIAL PRIMARY KEY,
        setor TEXT NOT NULL,
        data DATE NOT NULL,
        titulo TEXT NOT NULL,
        descricao TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_ipt_obs_diarias_setor_data ON ipt_observacoes_diarias(setor, data)").catch(() => {});
  } finally {
    client.release();
  }
}
