import type { PoolClient } from "pg";

/**
 * Preenche sub + serviço dos portáteis que ainda não têm linha em portatil_vinculos.
 * Usa o Report SELIMP (fev–jul/2026): só grava quando um par serviço/sub concentra
 * pelo menos 80% das saídas do módulo. Não sobrescreve edição manual.
 */
export async function preencherVinculosPortateisHistorico(client: PoolClient): Promise<number> {
  const result = await client.query(`
    WITH atuais AS (
      SELECT DISTINCT ON (nome) nome
        FROM ipt_dados_bateria
       WHERE tipo_modulo = 'PORTATIL'
       ORDER BY nome, data_exportacao DESC, updated_at DESC, id DESC
    ),
    partes AS (
      SELECT
        upper(trim(p)) AS modulo,
        trim(tipo_servico) AS servico,
        upper(substring(regexp_replace(COALESCE(plano, ''), '\\s', '', 'g') FROM 1 FOR 2)) AS sub
      FROM ipt_report_linhas,
           regexp_split_to_table(COALESCE(equipamentos, ''), '[,;|]') AS p
      WHERE equipamentos ILIKE '%PORTAT%'
        AND trim(p) ILIKE '%PORTAT%'
        AND trim(COALESCE(tipo_servico, '')) <> ''
    ),
    por AS (
      SELECT modulo, servico, sub, COUNT(*)::int AS n
        FROM partes
       WHERE sub IN ('CV', 'JT', 'MG', 'ST')
       GROUP BY modulo, servico, sub
    ),
    ranked AS (
      SELECT
        modulo,
        servico,
        sub,
        n,
        SUM(n) OVER (PARTITION BY modulo) AS total,
        ROW_NUMBER() OVER (PARTITION BY modulo ORDER BY n DESC, servico, sub) AS rk
      FROM por
    )
    INSERT INTO portatil_vinculos (nome, subprefeitura, servico, origem, updated_at)
    SELECT a.nome, r.sub, r.servico, 'historico', NOW()
      FROM ranked r
      JOIN atuais a ON upper(a.nome) = r.modulo
     WHERE r.rk = 1
       AND r.total > 0
       AND r.n::numeric / r.total >= 0.8
       AND NOT EXISTS (
         SELECT 1 FROM portatil_vinculos v WHERE upper(v.nome) = upper(a.nome)
       )
  `);
  return result.rowCount ?? 0;
}
