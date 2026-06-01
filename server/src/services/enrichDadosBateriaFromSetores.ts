import type { PoolClient } from "pg";

export interface EnrichDadosBateriaResult {
  /** Linhas de ipt_dados_bateria atualizadas com sub/setor/dias. */
  atualizados: number;
}

export type EnrichDadosBateriaOptions =
  | { dataExportacao: string }
  | { dataExportacoes: string[] };

/**
 * Preenche subprefeitura, setor e dias_execucao em ipt_dados_bateria
 * cruzando selimp_id com selimp_codigo em setores_modulos.
 * Atualiza somente registros das datas informadas (importação corrente)
 * e criados após o último upload de SETORES (preserva histórico anterior).
 */
export async function enrichDadosBateriaFromSetoresModulos(
  client: PoolClient,
  options: EnrichDadosBateriaOptions
): Promise<EnrichDadosBateriaResult> {
  const dates =
    "dataExportacao" in options
      ? [options.dataExportacao.trim()]
      : options.dataExportacoes.map((d) => d.trim()).filter(Boolean);

  const uniqueDates = [...new Set(dates)];
  if (uniqueDates.length === 0) {
    return { atualizados: 0 };
  }

  const result = await client.query(
    `UPDATE ipt_dados_bateria b
     SET
       subprefeitura = s.subprefeitura,
       setor = s.setor,
       dias_execucao = s.dias_execucao,
       updated_at = NOW()
     FROM (
       SELECT
         TRIM(selimp_codigo) AS selimp_codigo,
         string_agg(DISTINCT subprefeitura, '/' ORDER BY subprefeitura) AS subprefeitura,
         string_agg(setor, '/' ORDER BY setor) AS setor,
         string_agg(DISTINCT dias_execucao, '/' ORDER BY dias_execucao) AS dias_execucao
       FROM setores_modulos
       WHERE selimp_codigo IS NOT NULL AND TRIM(selimp_codigo) <> ''
       GROUP BY TRIM(selimp_codigo)
     ) s
     WHERE TRIM(b.selimp_id) = s.selimp_codigo
       AND b.selimp_id IS NOT NULL
       AND TRIM(b.selimp_id) <> ''
       AND b.data_exportacao = ANY($1::date[])
       AND b.created_at >= (
         SELECT COALESCE(MAX(updated_at), '-infinity'::timestamptz)
         FROM setores_modulos
       )`,
    [uniqueDates]
  );

  return { atualizados: result.rowCount ?? 0 };
}
