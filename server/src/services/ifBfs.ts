import { pool } from "../db.js";
import { BFS_IF_EXCLUSAO_SQL, sqlBfsFiscalNaoEhSelimp } from "../constants/bfs.js";
import { SUB_SIGLAS, regionalToSigla } from "../constants/regionais.js";

/** Sub sem BFS não possui irregularidade constatada e entra como 100% no IF. */
export function calcularPercentualIfSub(total: number, semIrregularidade: number): number {
  return total > 0 ? (semIrregularidade / total) * 100 : 100;
}

/** Média aritmética dos % das 4 subs (JT, CV, ST, MG). */
export function calcularMediaIfPorSubprefeitura(
  bySigla: Record<string, { total: number; sem_irregularidade: number }>
): number {
  const percentuais = SUB_SIGLAS.map((sigla) => {
    const { total, sem_irregularidade } = bySigla[sigla];
    return calcularPercentualIfSub(total, sem_irregularidade);
  });
  const somaPercentuais = percentuais.reduce((acc, value) => acc + value, 0);
  return somaPercentuais / SUB_SIGLAS.length;
}

/**
 * IF estimado alinhado ao ADC: BFS no período, exclui 5 serviços e fiscais SELIMP -;
 * todas as subs → média dos 4 percentuais; uma sub → (sem irreg. / total) × 100 naquela sub.
 */
export async function computeIfEstimadoAdc(params: {
  periodo_inicial: string;
  periodo_final: string;
  subprefeitura?: string;
}): Promise<{
  if_percent: number;
  total_fiscalizacoes: number;
  total_sem_irregularidade: number;
}> {
  const { periodo_inicial: inicio, periodo_final: fim, subprefeitura } = params;
  const ifExcludeSql = BFS_IF_EXCLUSAO_SQL.map((_, i) => `tipo_servico NOT ILIKE $${3 + i}`).join(" AND ");
  const ifFiscalSql = sqlBfsFiscalNaoEhSelimp();
  const sub = subprefeitura && subprefeitura !== "todas" ? subprefeitura : null;

  const r = await pool.query(
    `SELECT regional,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE TRIM(COALESCE(status, '')) = 'Sem Irregularidades') AS sem_irregularidade
     FROM bfs
     WHERE data_fiscalizacao >= $1::date AND data_fiscalizacao < ($2::date + interval '1 day')
       AND ${ifExcludeSql}
       AND ${ifFiscalSql}
       ${sub ? `AND regional = $${3 + BFS_IF_EXCLUSAO_SQL.length}` : ""}
     GROUP BY regional`,
    sub ? [inicio, fim, ...BFS_IF_EXCLUSAO_SQL, sub] : [inicio, fim, ...BFS_IF_EXCLUSAO_SQL]
  );

  if (sub) {
    let total = 0;
    let semIrreg = 0;
    for (const row of r.rows as Array<{ total: string; sem_irregularidade: string }>) {
      total += Number(row.total ?? 0);
      semIrreg += Number(row.sem_irregularidade ?? 0);
    }
    const ifPercent = calcularPercentualIfSub(total, semIrreg);
    return {
      if_percent: ifPercent,
      total_fiscalizacoes: total,
      total_sem_irregularidade: semIrreg,
    };
  }

  const bySigla: Record<string, { total: number; sem_irregularidade: number }> = {};
  for (const sigla of SUB_SIGLAS) bySigla[sigla] = { total: 0, sem_irregularidade: 0 };
  for (const row of r.rows as Array<{ regional: string; total: string; sem_irregularidade: string }>) {
    const sigla = regionalToSigla(row.regional);
    if (sigla && bySigla[sigla]) {
      bySigla[sigla].total += Number(row.total ?? 0);
      bySigla[sigla].sem_irregularidade += Number(row.sem_irregularidade ?? 0);
    }
  }
  const totalFiscalizacoes = Object.values(bySigla).reduce((a, x) => a + x.total, 0);
  const totalSemIrregularidade = Object.values(bySigla).reduce((a, x) => a + x.sem_irregularidade, 0);
  const ifPercent = calcularMediaIfPorSubprefeitura(bySigla);
  return {
    if_percent: ifPercent,
    total_fiscalizacoes: totalFiscalizacoes,
    total_sem_irregularidade: totalSemIrregularidade,
  };
}
