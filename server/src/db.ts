import pg from "pg";
import { config } from "./config.js";
import { encryptPassword } from "./auth-crypto.js";
import { APP_PAGE_KEYS, DEFAULT_USER_ALLOWED_PAGES } from "./auth-shared.js";

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
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT,
        password_encrypted TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'active',
        blocked BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT chk_users_role CHECK (role IN ('host', 'user')),
        CONSTRAINT chk_users_status CHECK (status IN ('active', 'inactive'))
      );
    `);
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT").catch(() => {});
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_encrypted TEXT").catch(() => {});
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'").catch(() => {});
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'").catch(() => {});
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT FALSE").catch(() => {});
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()").catch(() => {});
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()").catch(() => {});
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username ON users(username)").catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_page_permissions (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        page_key TEXT NOT NULL,
        allowed BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, page_key)
      );
    `);
    await client.query("ALTER TABLE user_page_permissions ADD COLUMN IF NOT EXISTS allowed BOOLEAN NOT NULL DEFAULT TRUE").catch(
      () => {}
    );
    await client.query("ALTER TABLE user_page_permissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()").catch(
      () => {}
    );
    await client.query("CREATE INDEX IF NOT EXISTS idx_user_page_permissions_page ON user_page_permissions(page_key)").catch(
      () => {}
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        session_id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_token_hash TEXT NOT NULL,
        remember_me BOOLEAN NOT NULL DEFAULT FALSE,
        expires_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS session_token_hash TEXT").catch(() => {});
    await client.query("ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS remember_me BOOLEAN NOT NULL DEFAULT FALSE").catch(
      () => {}
    );
    await client.query("ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ").catch(() => {});
    await client.query("ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW()").catch(
      () => {}
    );
    await client.query("ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()").catch(
      () => {}
    );
    await client.query("ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()").catch(
      () => {}
    );
    await client.query("CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at)").catch(() => {});

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
    await client.query("ALTER TABLE bfs ADD COLUMN IF NOT EXISTS fiscal TEXT").catch(() => {});
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
      CREATE TABLE IF NOT EXISTS acic_overrides (
        n_acic TEXT PRIMARY KEY,
        defesa BOOLEAN DEFAULT FALSE,
        sem_recurso BOOLEAN DEFAULT FALSE,
        valor NUMERIC DEFAULT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(
      "ALTER TABLE acic_overrides ADD COLUMN IF NOT EXISTS entendimento_defesa_previa TEXT DEFAULT NULL"
    ).catch(() => {});
    await client.query(
      "ALTER TABLE acic_overrides ADD COLUMN IF NOT EXISTS multa_clausula_texto TEXT DEFAULT NULL"
    ).catch(() => {});
    await client.query(
      "ALTER TABLE acic_overrides ADD COLUMN IF NOT EXISTS multa_valor_estimativa BOOLEAN DEFAULT FALSE"
    ).catch(() => {});
    await client.query(
      "ALTER TABLE acic_overrides ADD COLUMN IF NOT EXISTS valor_estimativa NUMERIC DEFAULT NULL"
    ).catch(() => {});
    await client.query(
      `UPDATE acic_overrides SET valor_estimativa = valor, valor = NULL
       WHERE multa_valor_estimativa = true AND valor IS NOT NULL AND valor_estimativa IS NULL`
    ).catch(() => {});
    await client.query(
      "ALTER TABLE acic_overrides ADD COLUMN IF NOT EXISTS motivo_penalidade TEXT DEFAULT NULL"
    ).catch(() => {});

    /** Status Defesa / Contestação por número BFS — compartilhado entre usuários (não usa localStorage). */
    await client.query(`
      CREATE TABLE IF NOT EXISTS bfs_defesa_state (
        numero_bfs TEXT PRIMARY KEY,
        status_defesa TEXT NOT NULL DEFAULT 'Analisar',
        dados_contestacao JSONB,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

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
      CREATE TABLE IF NOT EXISTS upload_events (
        id SERIAL PRIMARY KEY,
        session_key TEXT NOT NULL,
        upload_type TEXT NOT NULL,
        source_file TEXT NOT NULL,
        processados INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL DEFAULT 0,
        inseridos INTEGER NOT NULL DEFAULT 0,
        atualizados INTEGER NOT NULL DEFAULT 0,
        duplicados INTEGER NOT NULL DEFAULT 0,
        erros INTEGER NOT NULL DEFAULT 0,
        referencia_importada TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_upload_events_session_created ON upload_events(session_key, created_at DESC)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_upload_events_type_created ON upload_events(upload_type, created_at DESC)").catch(() => {});

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

    await client.query(`
      CREATE TABLE IF NOT EXISTS ipt_report_linhas (
        id SERIAL PRIMARY KEY,
        plano TEXT NOT NULL,
        subprefeitura TEXT,
        tipo_servico TEXT,
        status TEXT,
        percentual_execucao NUMERIC(8,4),
        equipamentos TEXT,
        data_estimada DATE,
        metodo_estimativa TEXT,
        confianca_estimativa TEXT,
        periodo_inicial DATE NOT NULL,
        periodo_final DATE NOT NULL,
        periodo_tipo TEXT,
        posicao_original INTEGER,
        frequencia TEXT,
        servico_codigo TEXT,
        raw JSONB NOT NULL,
        source_file TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_report_linhas_plano ON ipt_report_linhas(plano)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_report_linhas_data ON ipt_report_linhas(data_estimada)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_report_linhas_periodo ON ipt_report_linhas(periodo_inicial, periodo_final)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_report_linhas_status ON ipt_report_linhas(status)").catch(() => {});
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS ux_report_linhas_plano_periodo_pos ON ipt_report_linhas(plano, periodo_inicial, periodo_final, posicao_original)").catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS ipt_consolidado_veiculos_dados (
        id SERIAL PRIMARY KEY,
        placa TEXT,
        operacao TEXT,
        motorista TEXT,
        setor TEXT NOT NULL,
        data_referencia DATE NOT NULL,
        liberacao TEXT,
        saida TEXT,
        status TEXT,
        retorno TEXT,
        tempo_trabalho TEXT,
        percentual_limpebras NUMERIC(8,4),
        percentual_selimp NUMERIC(8,4),
        raw JSONB NOT NULL,
        source_file TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_consol_veic_setor ON ipt_consolidado_veiculos_dados(setor)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_consol_veic_data ON ipt_consolidado_veiculos_dados(data_referencia)").catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS ipt_consolidado_varricao_dados (
        id SERIAL PRIMARY KEY,
        setor TEXT NOT NULL,
        frequencia_rotulo TEXT,
        data_referencia DATE NOT NULL,
        percentual_selimp NUMERIC(8,4),
        percentual_ddmx NUMERIC(8,4),
        raw JSONB NOT NULL,
        source_file TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_consol_varr_setor ON ipt_consolidado_varricao_dados(setor)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_consol_varr_data ON ipt_consolidado_varricao_dados(data_referencia)").catch(() => {});

    const adminEncryptedPassword = encryptPassword("1515");
    const userResult = await client.query<{ id: number }>(
      `INSERT INTO users (username, display_name, password_encrypted, role, status, blocked, created_at, updated_at)
       VALUES ('admin', 'Administrador', $1, 'host', 'active', FALSE, NOW(), NOW())
       ON CONFLICT (username) DO UPDATE SET
         role = 'host',
         status = 'active',
         blocked = FALSE,
         password_encrypted = COALESCE(NULLIF(users.password_encrypted, ''), EXCLUDED.password_encrypted),
         updated_at = NOW()
       RETURNING id`,
      [adminEncryptedPassword]
    );
    const adminUserId = userResult.rows[0]?.id;

    if (adminUserId) {
      for (const pageKey of APP_PAGE_KEYS) {
        await client.query(
          `INSERT INTO user_page_permissions (user_id, page_key, allowed, updated_at)
           VALUES ($1, $2, TRUE, NOW())
           ON CONFLICT (user_id, page_key) DO UPDATE SET allowed = TRUE, updated_at = NOW()`,
          [adminUserId, pageKey]
        );
      }
    }

    const nonHostUsers = await client.query<{ id: number }>(
      `SELECT id FROM users WHERE role <> 'host'`
    );
    for (const row of nonHostUsers.rows) {
      for (const pageKey of DEFAULT_USER_ALLOWED_PAGES) {
        await client.query(
          `INSERT INTO user_page_permissions (user_id, page_key, allowed, updated_at)
           VALUES ($1, $2, TRUE, NOW())
           ON CONFLICT (user_id, page_key) DO NOTHING`,
          [row.id, pageKey]
        );
      }
    }
  } finally {
    client.release();
  }
}
