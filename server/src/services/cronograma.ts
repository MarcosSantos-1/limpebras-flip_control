import type { Pool, PoolClient } from "pg";
import { pool } from "../db.js";
import { normalizarSetor } from "../constants/ipt.js";

/** Aceita o pool ou um client de transação. */
type Querier = Pool | PoolClient;

export interface CronogramaSetorInfo {
  setor: string;
  modelo: string; // 'escalonado' | 'fixo'
  servico: string | null;
  subprefeitura: string | null;
  subSigla: string | null;
  frequenciaTexto: string | null;
  frequenciaCodigo: string | null;
  turno: string | null;
  local: string | null;
  feira: string | null;
  diasSemana: string[] | null;
  anoPlano: number | null;
  datas: string[]; // YYYY-MM-DD (vazio para fixos)
}

/**
 * Datas (YYYY-MM-DD) por setor para a lista informada.
 * Chave do mapa = setor normalizado. Substitui leituras de ipt_cronograma por lista de setores.
 */
export async function getCronogramaDatas(
  setores: string[],
  db: Querier = pool,
): Promise<Map<string, string[]>> {
  const norm = Array.from(new Set(setores.map((s) => normalizarSetor(s)).filter(Boolean)));
  const map = new Map<string, string[]>();
  if (norm.length === 0) return map;
  const res = await db.query<{ setor: string; data: string }>(
    `SELECT setor, to_char(data, 'YYYY-MM-DD') AS data
     FROM cronograma_datas
     WHERE setor = ANY($1)
     ORDER BY setor, data`,
    [norm],
  );
  for (const row of res.rows) {
    const arr = map.get(row.setor) ?? [];
    arr.push(row.data);
    map.set(row.setor, arr);
  }
  return map;
}

/**
 * Datas dentro de [inicio, fim] agrupadas por setor normalizado.
 * Substitui `carregarCronograma` (que lia ipt_cronograma).
 */
export async function getCronogramaDatasRange(
  inicio: string,
  fim: string,
  db: Querier = pool,
): Promise<Map<string, string[]>> {
  const res = await db.query<{ setor: string; data: string }>(
    `SELECT setor, to_char(data, 'YYYY-MM-DD') AS data
     FROM cronograma_datas
     WHERE data >= $1::date AND data <= $2::date
     ORDER BY data`,
    [inicio, fim],
  );
  const map = new Map<string, string[]>();
  for (const row of res.rows) {
    const setor = normalizarSetor(row.setor);
    if (!setor || !row.data) continue;
    const arr = map.get(setor) ?? [];
    arr.push(row.data);
    map.set(setor, arr);
  }
  return map;
}

function mapRowToInfo(row: any): CronogramaSetorInfo {
  return {
    setor: row.setor,
    modelo: row.modelo,
    servico: row.servico ?? null,
    subprefeitura: row.subprefeitura ?? null,
    subSigla: row.sub_sigla ?? null,
    frequenciaTexto: row.frequencia_texto ?? null,
    frequenciaCodigo: row.frequencia_codigo ?? null,
    turno: row.turno ?? null,
    local: row.local ?? null,
    feira: row.feira ?? null,
    diasSemana: Array.isArray(row.dias_semana) ? row.dias_semana : null,
    anoPlano: row.ano_plano ?? null,
    datas: Array.isArray(row.datas) ? row.datas.filter(Boolean) : [],
  };
}

/** Info completa + datas de um único setor (ou null se não cadastrado). */
export async function getCronogramaInfo(
  setor: string,
  db: Querier = pool,
): Promise<CronogramaSetorInfo | null> {
  const norm = normalizarSetor(setor);
  if (!norm) return null;
  const res = await db.query(
    `SELECT s.*, COALESCE(
        (SELECT array_agg(to_char(d.data, 'YYYY-MM-DD') ORDER BY d.data)
         FROM cronograma_datas d WHERE d.setor = s.setor),
        '{}'
      ) AS datas
     FROM cronograma_setores s
     WHERE s.setor = $1`,
    [norm],
  );
  return res.rows[0] ? mapRowToInfo(res.rows[0]) : null;
}

export interface ListCronogramaOpts {
  subSigla?: string;
  servico?: string;
  modelo?: string;
}

/**
 * Lista setores do cronograma com info + datas. Usado pela página de Despachos
 * para calcular "esperado" por dia a partir do plano real (datas p/ escalonados,
 * dias_semana p/ fixos).
 */
export async function listCronogramaSetores(
  opts: ListCronogramaOpts = {},
  db: Querier = pool,
): Promise<CronogramaSetorInfo[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.subSigla) {
    params.push(opts.subSigla.toUpperCase());
    where.push(`s.sub_sigla = $${params.length}`);
  }
  if (opts.servico) {
    params.push(opts.servico.toUpperCase());
    where.push(`s.servico = $${params.length}`);
  }
  if (opts.modelo) {
    params.push(opts.modelo);
    where.push(`s.modelo = $${params.length}`);
  }
  const res = await db.query(
    `SELECT s.*, COALESCE(
        (SELECT array_agg(to_char(d.data, 'YYYY-MM-DD') ORDER BY d.data)
         FROM cronograma_datas d WHERE d.setor = s.setor),
        '{}'
      ) AS datas
     FROM cronograma_setores s
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY s.setor`,
    params,
  );
  return res.rows.map(mapRowToInfo);
}

/** Último import do cronograma (para o overview de upload). */
export async function getLastCronogramaImport(
  db: Querier = pool,
): Promise<{ ultimo_import: string | null; total_setores: number; total_datas: number; source_file: string | null }> {
  const last = await db.query<{ source_file: string | null; updated_at: string | null }>(
    `SELECT source_file, updated_at FROM cronograma_setores ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
  );
  const setores = await db.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM cronograma_setores`);
  const datas = await db.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM cronograma_datas`);
  return {
    ultimo_import: last.rows[0]?.updated_at ?? null,
    source_file: last.rows[0]?.source_file ?? null,
    total_setores: setores.rows[0]?.total ?? 0,
    total_datas: datas.rows[0]?.total ?? 0,
  };
}
