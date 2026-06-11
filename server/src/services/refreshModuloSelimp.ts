import type { PoolClient } from "pg";

export interface RefreshModuloSelimpResult {
  atualizados: number;
  removidos: number;
}

/**
 * Recalcula o snapshot por módulo SELIMP a partir do cadastro de setores e do
 * histórico de bateria. Campos manuais/operacionais são preservados no upsert.
 */
export async function refreshModuloSelimp(client: PoolClient): Promise<RefreshModuloSelimpResult> {
  const upsert = await client.query(`
    WITH setores AS (
      SELECT
        TRIM(selimp_codigo) AS modulo_selimp,
        string_agg(DISTINCT setor, '/' ORDER BY setor) AS setores,
        string_agg(DISTINCT subprefeitura, '/' ORDER BY subprefeitura) AS sub,
        string_agg(DISTINCT dias_execucao, '/' ORDER BY dias_execucao) AS dias_execucao,
        jsonb_agg(DISTINCT jsonb_build_object('setor', setor, 'dias', COALESCE(dias_execucao, '')))
          FILTER (WHERE setor IS NOT NULL AND TRIM(setor) <> '') AS setores_dias,
        MIN(selimp_instalacao) AS data_selimp
      FROM setores_modulos
      WHERE selimp_codigo IS NOT NULL AND TRIM(selimp_codigo) <> ''
      GROUP BY TRIM(selimp_codigo)
    ),
    latest AS (
      SELECT DISTINCT ON (TRIM(selimp_id))
        TRIM(selimp_id) AS modulo_selimp,
        nome,
        data_exportacao,
        CASE
          WHEN UPPER(TRIM(COALESCE(status_comunicacao, ''))) = 'ON' THEN 'ON'
          WHEN UPPER(TRIM(COALESCE(status_comunicacao, ''))) = 'OFF' THEN 'OFF'
          ELSE COALESCE(NULLIF(TRIM(status_comunicacao), ''), 'OFF')
        END AS comunicacao,
        bateria_raw,
        bateria_percentual,
        bateria_desatualizada,
        ultima_comunicacao,
        source_file
      FROM ipt_dados_bateria
      WHERE selimp_id IS NOT NULL AND TRIM(selimp_id) <> ''
      ORDER BY TRIM(selimp_id), data_exportacao DESC, updated_at DESC, id DESC
    ),
    source_modules AS (
      SELECT modulo_selimp FROM setores
      UNION
      SELECT modulo_selimp FROM latest
    ),
    historico AS (
      SELECT
        sm.modulo_selimp,
        COUNT(DISTINCT b.data_exportacao) FILTER (
          WHERE UPPER(TRIM(COALESCE(b.status_comunicacao, ''))) = 'ON'
        )::int AS dias_on,
        COUNT(DISTINCT b.data_exportacao) FILTER (
          WHERE UPPER(TRIM(COALESCE(b.status_comunicacao, ''))) = 'OFF'
        )::int AS dias_off
      FROM source_modules sm
      LEFT JOIN setores s ON s.modulo_selimp = sm.modulo_selimp
      LEFT JOIN ipt_dados_bateria b
        ON TRIM(b.selimp_id) = sm.modulo_selimp
       AND (s.data_selimp IS NULL OR b.data_exportacao >= s.data_selimp)
      GROUP BY sm.modulo_selimp
    ),
    computed AS (
      SELECT
        sm.modulo_selimp,
        l.nome,
        s.setores,
        s.sub,
        s.dias_execucao,
        s.setores_dias,
        COALESCE(l.comunicacao, 'OFF') AS comunicacao,
        l.ultima_comunicacao,
        l.bateria_raw,
        l.bateria_percentual,
        CASE
          WHEN l.bateria_raw ILIKE '%desatualizada%' OR COALESCE(l.bateria_desatualizada, FALSE) THEN 'DESATUALIZADA'
          WHEN l.bateria_percentual IS NULL THEN NULL
          WHEN l.bateria_percentual > 70 THEN 'ALTA'
          WHEN l.bateria_percentual > 30 THEN 'REGULAR'
          WHEN l.bateria_percentual > 15 THEN 'BAIXA'
          ELSE 'CRÍTICA'
        END AS status_bateria,
        s.data_selimp,
        COALESCE(h.dias_on, 0) AS dias_on,
        COALESCE(h.dias_off, 0) AS dias_off,
        CASE
          WHEN COALESCE(h.dias_on, 0) + COALESCE(h.dias_off, 0) = 0 THEN 0
          ELSE ROUND((COALESCE(h.dias_on, 0)::numeric / NULLIF(COALESCE(h.dias_on, 0) + COALESCE(h.dias_off, 0), 0)) * 100, 2)
        END AS produtividade_bateria,
        CASE
          WHEN l.comunicacao = 'ON'
           AND l.bateria_raw IS NOT NULL
           AND TRIM(l.bateria_raw) <> ''
           AND NOT (l.bateria_raw ILIKE '%desatualizada%' OR COALESCE(l.bateria_desatualizada, FALSE))
           AND l.ultima_comunicacao IS NOT NULL
           AND (l.ultima_comunicacao AT TIME ZONE 'America/Sao_Paulo')::date >= (COALESCE(l.data_exportacao, (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date) - 1)
          THEN 'COM SINAL'
          ELSE 'SEM SINAL'
        END AS status_sinal_calculado,
        l.data_exportacao AS latest_data_exportacao,
        l.source_file
      FROM source_modules sm
      LEFT JOIN setores s ON s.modulo_selimp = sm.modulo_selimp
      LEFT JOIN latest l ON l.modulo_selimp = sm.modulo_selimp
      LEFT JOIN historico h ON h.modulo_selimp = sm.modulo_selimp
    )
    INSERT INTO modulo_selimp (
      modulo_selimp, nome, setores, sub, dias_execucao, setores_dias,
      comunicacao, ultima_comunicacao, bateria_raw, bateria_percentual,
      status_bateria, data_selimp, dias_on, dias_off, produtividade_bateria,
      status_sinal_calculado, latest_data_exportacao, source_file, updated_at
    )
    SELECT
      modulo_selimp, nome, setores, sub, dias_execucao, setores_dias,
      comunicacao, ultima_comunicacao, bateria_raw, bateria_percentual,
      status_bateria, data_selimp, dias_on, dias_off, produtividade_bateria,
      status_sinal_calculado, latest_data_exportacao, source_file, NOW()
    FROM computed
    ON CONFLICT (modulo_selimp) DO UPDATE SET
      nome = EXCLUDED.nome,
      setores = EXCLUDED.setores,
      sub = EXCLUDED.sub,
      dias_execucao = EXCLUDED.dias_execucao,
      setores_dias = EXCLUDED.setores_dias,
      comunicacao = EXCLUDED.comunicacao,
      ultima_comunicacao = EXCLUDED.ultima_comunicacao,
      bateria_raw = EXCLUDED.bateria_raw,
      bateria_percentual = EXCLUDED.bateria_percentual,
      status_bateria = EXCLUDED.status_bateria,
      data_selimp = EXCLUDED.data_selimp,
      qtd_trocas = modulo_selimp.qtd_trocas,
      dias_on = EXCLUDED.dias_on,
      dias_off = EXCLUDED.dias_off,
      produtividade_bateria = EXCLUDED.produtividade_bateria,
      status_sinal_calculado = EXCLUDED.status_sinal_calculado,
      status_sinal_manual = modulo_selimp.status_sinal_manual,
      latest_data_exportacao = EXCLUDED.latest_data_exportacao,
      source_file = EXCLUDED.source_file,
      updated_at = NOW()
  `);

  const removed = await client.query(`
    WITH source_modules AS (
      SELECT TRIM(selimp_codigo) AS modulo_selimp
      FROM setores_modulos
      WHERE selimp_codigo IS NOT NULL AND TRIM(selimp_codigo) <> ''
      UNION
      SELECT TRIM(selimp_id) AS modulo_selimp
      FROM ipt_dados_bateria
      WHERE selimp_id IS NOT NULL AND TRIM(selimp_id) <> ''
    )
    DELETE FROM modulo_selimp m
    WHERE NOT EXISTS (
      SELECT 1 FROM source_modules sm WHERE sm.modulo_selimp = m.modulo_selimp
    )
  `);

  return {
    atualizados: upsert.rowCount ?? 0,
    removidos: removed.rowCount ?? 0,
  };
}
