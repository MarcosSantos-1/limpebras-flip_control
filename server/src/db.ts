import pg from "pg";
import { config } from "./config.js";
import { encryptPassword } from "./auth-crypto.js";
import { APP_PAGE_KEYS, DEFAULT_USER_ALLOWED_PAGES } from "./auth-shared.js";

const { Pool } = pg;

const isNeon = config.databaseUrl.includes("neon.tech");

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: isNeon ? { rejectUnauthorized: false } : undefined,
  ...(config.dbPoolMax != null ? { max: config.dbPoolMax } : {}),
  ...(config.dbIdleTimeoutMs != null ? { idleTimeoutMillis: config.dbIdleTimeoutMs } : {}),
});

/**
 * Migrations: cria tabelas/índices core se não existirem (CREATE IF NOT EXISTS).
 * Dados IPT consolidado, módulos bateria e selimp mensal ficam em ipt_imports / ipt_report_linhas —
 * não recriamos tabelas dedicadas removidas no Neon.
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
    await client.query("ALTER TABLE sacs ADD COLUMN IF NOT EXISTS data_agendamento TIMESTAMPTZ").catch(() => {});
    await client
      .query("ALTER TABLE sacs ADD COLUMN IF NOT EXISTS data_realizacao_confirmacao_execucao TIMESTAMPTZ")
      .catch(() => {});
    await client.query("ALTER TABLE sacs ADD COLUMN IF NOT EXISTS data_ultima_atualizacao TIMESTAMPTZ").catch(() => {});
    await client.query("ALTER TABLE sacs ADD COLUMN IF NOT EXISTS status_planilha TEXT").catch(() => {});
    await client.query("ALTER TABLE sacs ADD COLUMN IF NOT EXISTS data_acionamento_agendamento TIMESTAMPTZ").catch(() => {});

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
      CREATE TABLE IF NOT EXISTS adc_override_mensal (
        ano INTEGER NOT NULL,
        mes INTEGER NOT NULL,
        modo TEXT NOT NULL CHECK (modo IN ('por_indicador', 'total')),
        pontuacao_ird NUMERIC(5,2),
        pontuacao_ia NUMERIC(5,2),
        pontuacao_if NUMERIC(5,2),
        pontuacao_ipt NUMERIC(5,2),
        adc_total NUMERIC(5,2),
        observacao TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (ano, mes)
      );
    `);

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

    /**
     * Cronograma do Plano de Trabalho (importação anual das planilhas Escalonados/Fixos).
     * Substitui o uso de ipt_cronograma (mantida no banco, sem uso). Separa as informações
     * do setor (cronograma_setores) das datas explícitas (cronograma_datas).
     */
    await client.query(`
      CREATE TABLE IF NOT EXISTS cronograma_setores (
        id SERIAL PRIMARY KEY,
        setor TEXT NOT NULL UNIQUE,
        modelo TEXT NOT NULL,
        servico TEXT,
        subprefeitura TEXT,
        sub_sigla TEXT,
        frequencia_texto TEXT,
        frequencia_codigo TEXT,
        turno TEXT,
        local TEXT,
        feira TEXT,
        dias_semana TEXT[],
        dia_semana_texto TEXT,
        ano_plano INTEGER,
        source_file TEXT,
        raw JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_cronograma_setores_servico ON cronograma_setores(servico)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_cronograma_setores_sub ON cronograma_setores(sub_sigla)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_cronograma_setores_modelo ON cronograma_setores(modelo)").catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS cronograma_datas (
        id SERIAL PRIMARY KEY,
        setor TEXT NOT NULL REFERENCES cronograma_setores(setor) ON DELETE CASCADE,
        data DATE NOT NULL,
        ano INTEGER,
        source_file TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (setor, data)
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_cronograma_datas_setor ON cronograma_datas(setor)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_cronograma_datas_data ON cronograma_datas(data)").catch(() => {});

    /**
     * Despachos diários (página Despachos SELIMP): lançamento operacional por setor/dia,
     * alimentado pela COLAGEM da grade da SELIMP (parseDespachoColagem) ou manualmente.
     * O percentual de execução vem depois, do Report SELIMP D-1 (ipt_report_linhas).
     */
    await client.query(`
      CREATE TABLE IF NOT EXISTS despachos_diarios (
        id SERIAL PRIMARY KEY,
        setor TEXT NOT NULL,
        data DATE NOT NULL,
        turno TEXT,
        status TEXT,
        modelo TEXT,
        veiculos TEXT[],
        data_planejada TEXT,
        data_maxima TEXT,
        origem TEXT NOT NULL DEFAULT 'selimp_colagem',
        raw JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (setor, data)
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_despachos_diarios_data ON despachos_diarios(data)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_despachos_diarios_setor ON despachos_diarios(setor)").catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS setores_modulos (
        id SERIAL PRIMARY KEY,
        setor TEXT NOT NULL UNIQUE,
        subprefeitura TEXT,
        servico TEXT,
        frequencia TEXT,
        dias_execucao TEXT,
        km_prod NUMERIC(12,6),
        selimp_codigo TEXT,
        selimp_instalacao DATE,
        ddmx_codigo TEXT,
        ddmx_instalacao DATE,
        raw JSONB NOT NULL,
        source_file TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_setores_modulos_subpref ON setores_modulos(subprefeitura)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_setores_modulos_selimp ON setores_modulos(selimp_codigo)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_setores_modulos_ddmx ON setores_modulos(ddmx_codigo)").catch(() => {});

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
        data_cancelamento TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(
      "ALTER TABLE ipt_observacoes_diarias ADD COLUMN IF NOT EXISTS data_cancelamento TIMESTAMPTZ"
    ).catch(() => {});
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
    await client.query("CREATE INDEX IF NOT EXISTS idx_report_linhas_servico_data ON ipt_report_linhas(tipo_servico, data_estimada)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_report_linhas_status ON ipt_report_linhas(status)").catch(() => {});
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS ux_report_linhas_plano_periodo_pos ON ipt_report_linhas(plano, periodo_inicial, periodo_final, posicao_original)").catch(() => {});
    await client.query("ALTER TABLE ipt_report_linhas ADD COLUMN IF NOT EXISTS despacho_esperado BOOLEAN").catch(() => {});

    await client
      .query(
        `DO $$
         BEGIN
           IF to_regclass('public.metric_snapshots') IS NULL
              AND to_regclass('public.ipt_metric_snapshots') IS NOT NULL THEN
             ALTER TABLE ipt_metric_snapshots RENAME TO metric_snapshots;
           END IF;
         END $$;`
      )
      .catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS metric_snapshots (
        id SERIAL PRIMARY KEY,
        snapshot_type TEXT NOT NULL,
        metric_key TEXT NOT NULL,
        metric_label TEXT NOT NULL,
        snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        periodo_inicial DATE NOT NULL,
        periodo_final DATE NOT NULL,
        periodo_tipo TEXT NOT NULL,
        valor NUMERIC(12,4),
        percentual NUMERIC(8,4),
        percentual_dia NUMERIC(8,4),
        pontuacao NUMERIC(8,4),
        media_sem_zerados NUMERIC(8,4),
        quantidade_planos INTEGER NOT NULL DEFAULT 0,
        quantidade_base INTEGER NOT NULL DEFAULT 0,
        total_despachos INTEGER NOT NULL DEFAULT 0,
        total_despachos_dia INTEGER NOT NULL DEFAULT 0,
        despachos_zerados INTEGER NOT NULL DEFAULT 0,
        despachos_zerados_dia INTEGER NOT NULL DEFAULT 0,
        source_file TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW()").catch(() => {});
    await client.query("ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS valor NUMERIC(12,4)").catch(() => {});
    await client.query("ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS percentual_dia NUMERIC(8,4)").catch(() => {});
    await client.query("ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS pontuacao NUMERIC(8,4)").catch(() => {});
    await client.query("ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS quantidade_base INTEGER NOT NULL DEFAULT 0").catch(() => {});
    await client.query("ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS total_despachos_dia INTEGER NOT NULL DEFAULT 0").catch(() => {});
    await client.query("ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS despachos_zerados_dia INTEGER NOT NULL DEFAULT 0").catch(() => {});
    await client
      .query(
        `CREATE INDEX IF NOT EXISTS idx_metric_snapshots_lookup
         ON metric_snapshots(snapshot_type, metric_key, snapshot_at)`
      )
      .catch(() => {});
    await client
      .query(
        `CREATE INDEX IF NOT EXISTS idx_metric_snapshots_periodo
         ON metric_snapshots(snapshot_type, periodo_inicial, periodo_final)`
      )
      .catch(() => {});
    // Permite UPSERT em insertMetricSnapshot. Antes de criar a constraint, dedupe
    // pelo registro mais recente (id maior vence).
    await client
      .query(
        `DELETE FROM metric_snapshots a
         USING metric_snapshots b
         WHERE a.id < b.id
           AND a.snapshot_type = b.snapshot_type
           AND a.metric_key = b.metric_key
           AND a.periodo_inicial = b.periodo_inicial
           AND a.periodo_final = b.periodo_final
           AND a.periodo_tipo = b.periodo_tipo`
      )
      .catch(() => {});
    await client
      .query(
        `CREATE UNIQUE INDEX IF NOT EXISTS ux_metric_snapshots_upsert
         ON metric_snapshots(snapshot_type, metric_key, periodo_inicial, periodo_final, periodo_tipo)`
      )
      .catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS ipt_ddmx_varricao (
        id SERIAL PRIMARY KEY,
        record_key TEXT NOT NULL,
        setor TEXT,
        data_referencia DATE,
        servico TEXT,
        raw JSONB NOT NULL,
        source_file TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS ux_ddmx_varricao_key ON ipt_ddmx_varricao(record_key)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_ddmx_varricao_data ON ipt_ddmx_varricao(data_referencia)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_ddmx_varricao_setor ON ipt_ddmx_varricao(setor)").catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS ipt_ddmx_veiculos (
        id SERIAL PRIMARY KEY,
        subtipo TEXT NOT NULL,
        record_key TEXT NOT NULL,
        setor TEXT,
        data_referencia DATE,
        servico TEXT,
        raw JSONB NOT NULL,
        source_file TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS ux_ddmx_veiculos_key ON ipt_ddmx_veiculos(subtipo, record_key)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_ddmx_veiculos_data ON ipt_ddmx_veiculos(data_referencia)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_ddmx_veiculos_setor ON ipt_ddmx_veiculos(setor)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_ddmx_veiculos_subtipo ON ipt_ddmx_veiculos(subtipo)").catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS ipt_dados_bateria (
        id                    SERIAL PRIMARY KEY,
        record_key            TEXT NOT NULL UNIQUE,
        data_exportacao       DATE NOT NULL,
        nome                  TEXT NOT NULL,
        tipo_modulo           TEXT NOT NULL DEFAULT 'LUTOCAR',
        subprefeitura         TEXT,
        setor                 TEXT,
        selimp_id             TEXT,
        dias_execucao         TEXT,
        status_comunicacao    TEXT,
        bateria_raw           TEXT,
        bateria_percentual    NUMERIC(5,2),
        bateria_desatualizada BOOLEAN DEFAULT FALSE,
        ultima_comunicacao    TIMESTAMPTZ,
        source_file           TEXT,
        created_at            TIMESTAMPTZ DEFAULT NOW(),
        updated_at            TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_dados_bateria_data ON ipt_dados_bateria(data_exportacao)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_dados_bateria_subpref ON ipt_dados_bateria(subprefeitura)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_dados_bateria_nome ON ipt_dados_bateria(nome)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_dados_bateria_tipo ON ipt_dados_bateria(tipo_modulo)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_dados_bateria_selimp ON ipt_dados_bateria(selimp_id)").catch(() => {});
    await client.query(
      `UPDATE ipt_dados_bateria SET selimp_id = NULL, updated_at = NOW()
       WHERE tipo_modulo = 'PORTATIL' AND selimp_id IS NOT NULL`
    ).catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS modulo_selimp (
        id                         SERIAL PRIMARY KEY,
        modulo_selimp              TEXT NOT NULL UNIQUE,
        nome                       TEXT,
        setores                    TEXT,
        sub                        TEXT,
        dias_execucao              TEXT,
        setores_dias               JSONB,
        comunicacao                TEXT,
        ultima_comunicacao         TIMESTAMPTZ,
        bateria_raw                TEXT,
        bateria_percentual         NUMERIC(5,2),
        status_bateria             TEXT,
        data_selimp                DATE,
        qtd_trocas                 INTEGER NOT NULL DEFAULT 0,
        dias_on                    INTEGER NOT NULL DEFAULT 0,
        dias_off                   INTEGER NOT NULL DEFAULT 0,
        produtividade_bateria      NUMERIC(7,2) NOT NULL DEFAULT 0,
        status_sinal_calculado     TEXT NOT NULL DEFAULT 'SEM SINAL',
        status_sinal_manual        TEXT,
        latest_data_exportacao     DATE,
        source_file                TEXT,
        created_at                 TIMESTAMPTZ DEFAULT NOW(),
        updated_at                 TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("ALTER TABLE modulo_selimp ADD COLUMN IF NOT EXISTS setores_dias JSONB").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_modulo_selimp_sub ON modulo_selimp(sub)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_modulo_selimp_comunicacao ON modulo_selimp(comunicacao)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_modulo_selimp_status_bateria ON modulo_selimp(status_bateria)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_modulo_selimp_data_selimp ON modulo_selimp(data_selimp)").catch(() => {});
    await client.query("CREATE INDEX IF NOT EXISTS idx_modulo_selimp_produtividade ON modulo_selimp(produtividade_bateria)").catch(() => {});
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_modulo_selimp_status_sinal ON modulo_selimp((COALESCE(status_sinal_manual, status_sinal_calculado)))"
    ).catch(() => {});

    // Agendamento/conclusão de trocas de bateria — 1 registro corrente por módulo
    await client.query(`
      CREATE TABLE IF NOT EXISTS bateria_trocas (
        id                  SERIAL PRIMARY KEY,
        modulo_selimp       TEXT NOT NULL UNIQUE,
        setor               TEXT,
        status              TEXT NOT NULL DEFAULT 'agendada',
        data_agendada       DATE,
        sucesso             BOOLEAN,
        percentual_entrada  NUMERIC(5,2),
        data_troca          DATE,
        ultima_comunicacao  DATE,
        created_at          TIMESTAMPTZ DEFAULT NOW(),
        updated_at          TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_bateria_trocas_status ON bateria_trocas(status)").catch(() => {});

    // Manutenções por módulo: solicitação (status global → MANUTENÇÃO) + data/não houve
    await client.query(`
      CREATE TABLE IF NOT EXISTS bateria_manutencoes (
        id                SERIAL PRIMARY KEY,
        modulo_selimp     TEXT NOT NULL UNIQUE,
        solicitada        BOOLEAN NOT NULL DEFAULT FALSE,
        data_solicitacao  DATE,
        data_manutencao   DATE,
        nao_houve         BOOLEAN NOT NULL DEFAULT FALSE,
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_bateria_manutencoes_solicitada ON bateria_manutencoes(solicitada) WHERE solicitada").catch(() => {});

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
