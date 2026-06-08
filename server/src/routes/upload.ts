import { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { invalidatePrefix } from "../cache.js";
import {
  detectFlipCsvType,
  parseSacCsv,
  parseBfsCsv,
  parseOuvidoriaCsv,
  parseAcicCsv,
  parseCncDetalhesCsv,
  type CncDetalhesRow,
} from "../services/parseCsv.js";
import { detectDdmxWorkbookType, parseIptWorkbook, type IptFileType } from "../services/parseIptXlsx.js";
import { reconcileCronograma, type CronogramaImportFile } from "../services/importCronogramaPlano.js";
import { getLastCronogramaImport } from "../services/cronograma.js";
import { parseSetoresModulosWorkbook } from "../services/parseSetoresModulos.js";
import { enrichDadosBateriaFromSetoresModulos } from "../services/enrichDadosBateriaFromSetores.js";
import { normalizarSetor, parseSetor, resolveTipoServicoExibicao } from "../constants/ipt.js";
import { parseConsolidadoVeiculos, parseConsolidadoVarricao } from "../services/parseRelatorioConsolidado.js";
import { type ReportLinhaRaw } from "../services/estimarDataReport.js";
import { resolverDatasReport, extrairDataPlanejadaRaw } from "../services/resolverDatasReport.js";
import { mergeAcicOverridesAfterImportRow } from "../services/acicImportMerge.js";
import { parseModulosBateriaWorkbook } from "../services/parseModulosBateria.js";
import { parseStatusBateria } from "../services/parseStatusBateria.js";
import { parseHistoricoBateria } from "../services/parseHistoricoBateria.js";
import { refreshModuloSelimp } from "../services/refreshModuloSelimp.js";
import { requirePageAccess } from "../auth.js";
import { pontuacaoIA, pontuacaoIRD, pontuacaoIFFromPercentual, pontuacaoIPT } from "../services/indicadores.js";
import { calcularCenariosIPT } from "../services/ipt-pf-algoritmo.js";
import { BFS_IF_EXCLUSAO_SQL, sqlBfsFiscalNaoEhSelimp } from "../constants/bfs.js";
import { SUB_SIGLAS, regionalToSigla } from "../constants/regionais.js";

function ensureIptRestrictedUploadAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  allowedPaths: string[]
): boolean {
  const user = request.authUser;
  if (!user || !user.isIptRestricted) return true;
  const path = String(request.url ?? "").split("?")[0] ?? "";
  const allowed = allowedPaths.includes(path);
  if (allowed) return true;
  reply.code(403).send({ detail: "Perfil IPT restrito sem acesso a este upload." });
  return false;
}

function normCncKeyForMerge(numeroCnc: string | null | undefined): string {
  return (numeroCnc ?? "").trim();
}

type MergeCncDetalhesOpts = {
  /** Apaga CNCs com data_fiscalizacao no intervalo [inicial, final] (datas YYYY-MM-DD), depois insere o CSV. Útil para trocar só o mês de apuração. */
  periodoInicial?: string;
  periodoFinal?: string;
  /** Zera a tabela (comportamento legado: um CSV com todas as CNCs). */
  substituirTudo?: boolean;
};

/**
 * Importa detalhes CNC sem TRUNCATE: por padrão remove só linhas que batem com (numero_bfs, numero_cnc)
 * presentes no arquivo e reinsere — importações parciais (ex.: um mês) não apagam o restante da base.
 */
async function mergeImportCncDetalhes(
  client: PoolClient,
  rows: CncDetalhesRow[],
  sourceFile: string,
  opts?: MergeCncDetalhesOpts
): Promise<{ inseridos: number; total: number }> {
  await client.query("BEGIN");
  try {
    if (opts?.substituirTudo) {
      await client.query("TRUNCATE TABLE cncs RESTART IDENTITY");
    } else if (
      opts?.periodoInicial &&
      opts?.periodoFinal &&
      /^\d{4}-\d{2}-\d{2}$/.test(opts.periodoInicial) &&
      /^\d{4}-\d{2}-\d{2}$/.test(opts.periodoFinal)
    ) {
      await client.query(
        `DELETE FROM cncs
         WHERE data_fiscalizacao IS NOT NULL
           AND data_fiscalizacao >= $1::date
           AND data_fiscalizacao < ($2::date + interval '1 day')`,
        [opts.periodoInicial, opts.periodoFinal]
      );
    } else {
      const bfsArr: string[] = [];
      const cncArr: string[] = [];
      for (const r of rows) {
        const bfs = (r.numero_bfs || "").trim();
        if (!bfs) continue;
        bfsArr.push(bfs);
        cncArr.push(normCncKeyForMerge(r.numero_cnc));
      }
      if (bfsArr.length > 0) {
        await client.query(
          `DELETE FROM cncs c
           USING unnest($1::text[], $2::text[]) AS t(bfs, cnc_norm)
           WHERE c.numero_bfs = t.bfs
             AND COALESCE(NULLIF(TRIM(c.numero_cnc), ''), '') = t.cnc_norm`,
          [bfsArr, cncArr]
        );
      }
    }

    let inseridos = 0;
    for (const r of rows) {
      if (!r.numero_bfs?.trim()) continue;
      const raw = r.raw && typeof r.raw === "object" ? { ...r.raw } : {};
      const dataSync = r.data_sincronizacao instanceof Date ? r.data_sincronizacao : null;
      const dataFisc = r.data_fiscalizacao instanceof Date ? r.data_fiscalizacao : null;
      const dataExec = r.data_execucao instanceof Date ? r.data_execucao : null;
      await client.query(
        `INSERT INTO cncs (
          numero_bfs, numero_cnc, situacao_cnc, data_sincronizacao, data_fiscalizacao, data_execucao,
          fiscal, regional, area, setor, turno, servico, responsividade, endereco, coordenada,
          fiscal_contratada, raw, source_file, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, NOW())`,
        [
          r.numero_bfs || null,
          r.numero_cnc || null,
          r.situacao_cnc || null,
          dataSync,
          dataFisc,
          dataExec,
          r.fiscal || null,
          r.regional || null,
          r.area || null,
          r.setor || null,
          r.turno || null,
          r.servico || null,
          r.responsividade || null,
          r.endereco || null,
          r.coordenada || null,
          r.fiscal_contratada || null,
          JSON.stringify(raw),
          sourceFile,
        ]
      );
      inseridos += 1;
    }
    await client.query("COMMIT");
    return { inseridos, total: rows.length };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

function toExecPercent(value: string): number | null {
  if (!value) return null;
  const n = Number(String(value).replace(",", ".").replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}

function extractOrdensFromReportRows(rows: { raw?: Record<string, string> }[]): Array<Record<string, unknown> & { percentual: number }> {
  const normalizeText = (v: string) =>
    String(v ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  const ordens: Array<Record<string, unknown> & { percentual: number }> = [];
  for (const row of rows) {
    const raw = row.raw ?? {};
    const status = normalizeText(String(raw.status ?? "").trim());
    if (!status.includes("encerrado")) continue;
    const plano = normalizarSetor(String(raw.plano ?? "").trim());
    if (!plano) continue;
    let pct = toExecPercent(String(raw.de_execucao ?? raw.percentual_execucao ?? "").trim());
    if (pct == null) pct = 0;
    if (pct > 0 && pct <= 1) pct *= 100;
    const percentual = Math.min(1, Math.max(0, pct / 100));
    ordens.push({ ...raw, percentual });
  }
  return ordens;
}

function normalizeSnapshotKey(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160);
}

function isReportStatusEncerrado(status: string | null | undefined): boolean {
  return String(status ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .includes("encerrado");
}

function toDateKeyFromDate(value: Date | null | undefined): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return value.toISOString().slice(0, 10);
}

function getImportDateRange(values: Array<Date | null | undefined>): { inicio: string; fim: string } | null {
  const keys = values.map(toDateKeyFromDate).filter((v): v is string => Boolean(v));
  if (keys.length === 0) return null;
  keys.sort();
  return { inicio: keys[0], fim: keys[keys.length - 1] };
}

function getMonthStartKey(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
}

function getMonthEndKey(monthStart: string): string {
  const [yearRaw, monthRaw] = monthStart.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const last = new Date(Date.UTC(year, month, 0));
  return `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, "0")}-${String(
    last.getUTCDate()
  ).padStart(2, "0")}`;
}

function getMonthStartKeysInRange(inicio: string, fim: string): string[] {
  const start = new Date(`${getMonthStartKey(inicio)}T00:00:00.000Z`);
  const end = new Date(`${getMonthStartKey(fim)}T00:00:00.000Z`);
  const out: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    out.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-01`);
  }
  return out;
}

async function insertMetricSnapshot(
  client: PoolClient,
  opts: {
    snapshotType: string;
    metricKey: string;
    metricLabel: string;
    periodoInicial: string;
    periodoFinal: string;
    periodoTipo: string;
    valor?: number | null;
    percentual?: number | null;
    percentualDia?: number | null;
    pontuacao?: number | null;
    mediaSemZerados?: number | null;
    quantidadePlanos?: number;
    quantidadeBase?: number;
    totalDespachos?: number;
    totalDespachosDia?: number;
    despachosZerados?: number;
    despachosZeradosDia?: number;
    sourceFile: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO metric_snapshots (
       snapshot_type, metric_key, metric_label, snapshot_at,
       periodo_inicial, periodo_final, periodo_tipo,
       valor, percentual, percentual_dia, pontuacao, media_sem_zerados,
       quantidade_planos, quantidade_base, total_despachos, total_despachos_dia,
       despachos_zerados, despachos_zerados_dia,
       source_file, metadata, updated_at
     ) VALUES (
       $1, $2, $3, NOW(),
       $4::date, $5::date, $6,
       $7, $8, $9, $10, $11,
       $12, $13, $14, $15,
       $16, $17,
       $18, $19::jsonb, NOW()
     )
     ON CONFLICT (snapshot_type, metric_key, periodo_inicial, periodo_final, periodo_tipo)
     DO UPDATE SET
       metric_label = EXCLUDED.metric_label,
       snapshot_at = NOW(),
       valor = EXCLUDED.valor,
       percentual = EXCLUDED.percentual,
       percentual_dia = EXCLUDED.percentual_dia,
       pontuacao = EXCLUDED.pontuacao,
       media_sem_zerados = EXCLUDED.media_sem_zerados,
       quantidade_planos = EXCLUDED.quantidade_planos,
       quantidade_base = EXCLUDED.quantidade_base,
       total_despachos = EXCLUDED.total_despachos,
       total_despachos_dia = EXCLUDED.total_despachos_dia,
       despachos_zerados = EXCLUDED.despachos_zerados,
       despachos_zerados_dia = EXCLUDED.despachos_zerados_dia,
       source_file = EXCLUDED.source_file,
       metadata = EXCLUDED.metadata,
       updated_at = NOW()`,
    [
      opts.snapshotType,
      opts.metricKey,
      opts.metricLabel,
      opts.periodoInicial,
      opts.periodoFinal,
      opts.periodoTipo,
      opts.valor ?? null,
      opts.percentual ?? null,
      opts.percentualDia ?? null,
      opts.pontuacao ?? null,
      opts.mediaSemZerados ?? null,
      opts.quantidadePlanos ?? 0,
      opts.quantidadeBase ?? 0,
      opts.totalDespachos ?? 0,
      opts.totalDespachosDia ?? 0,
      opts.despachosZerados ?? 0,
      opts.despachosZeradosDia ?? 0,
      opts.sourceFile,
      JSON.stringify(opts.metadata ?? {}),
    ]
  );
}

async function insertIptServiceSnapshots(
  client: PoolClient,
  opts: {
    periodoInicial: string;
    periodoFinal: string;
    periodoTipo: ReportReferenceMode;
    sourceFile: string;
  }
): Promise<number> {
  /**
   * Snapshot acumulado por serviço: agrega de `periodo_inicial` até HOJE (ou `periodo_final`,
   * o menor), excluindo despachos com `data_estimada` futura (planejados ainda sem execução).
   *
   * Antes a média incluía linhas estimadas para dias futuros (geralmente com 0%), o que
   * achatava o percentual exibido nos cards. Agora o snapshot reflete o acumulado real
   * até a data da importação — exatamente o que o card "Serviços (ativos)" mostra.
   */
  const res = await client.query<{
    tipo_servico: string | null;
    quantidade_planos: string;
    total_despachos: string;
    despachos_zerados: string;
    percentual: string | null;
    media_sem_zerados: string | null;
  }>(
    `SELECT
       COALESCE(NULLIF(TRIM(tipo_servico), ''), 'Nao informado') AS tipo_servico,
       COUNT(DISTINCT plano)::int AS quantidade_planos,
       COUNT(*)::int AS total_despachos,
       COUNT(*) FILTER (WHERE COALESCE(percentual_execucao, 0) <= 0)::int AS despachos_zerados,
       ROUND(AVG(percentual_execucao), 4) AS percentual,
       ROUND(AVG(percentual_execucao) FILTER (WHERE percentual_execucao > 0), 4) AS media_sem_zerados
     FROM ipt_report_linhas
     WHERE periodo_inicial = $1::date
       AND periodo_final = $2::date
       AND periodo_tipo = $3
       AND LOWER(COALESCE(status, '')) LIKE '%encerrado%'
       AND percentual_execucao IS NOT NULL
       AND (data_estimada IS NULL OR data_estimada <= LEAST(CURRENT_DATE, $2::date))
     GROUP BY 1
     ORDER BY 1`,
    [opts.periodoInicial, opts.periodoFinal, opts.periodoTipo]
  );

  let upserted = 0;
  for (const row of res.rows) {
    const label = row.tipo_servico || "Nao informado";
    const key = normalizeSnapshotKey(label) || "nao_informado";
    await insertMetricSnapshot(client, {
      snapshotType: "ipt_servico",
      metricKey: key,
      metricLabel: label,
      periodoInicial: opts.periodoInicial,
      periodoFinal: opts.periodoFinal,
      periodoTipo: opts.periodoTipo,
      valor: row.percentual != null ? Number(row.percentual) : null,
      percentual: row.percentual != null ? Number(row.percentual) : null,
      mediaSemZerados: row.media_sem_zerados != null ? Number(row.media_sem_zerados) : null,
      quantidadePlanos: Number(row.quantidade_planos ?? 0),
      totalDespachos: Number(row.total_despachos ?? 0),
      despachosZerados: Number(row.despachos_zerados ?? 0),
      sourceFile: opts.sourceFile,
      metadata: { generated_from: "ipt_report_linhas", acumulado_ate: "min(today, periodo_final)" },
    });
    upserted += 1;
  }
  return upserted;
}

async function rebuildIptServiceAccSnapshotsForMonth(
  client: PoolClient,
  opts: { monthStart: string; sourceFile: string; deleteExisting?: boolean }
): Promise<number> {
  const monthEnd = getMonthEndKey(opts.monthStart);
  if (opts.deleteExisting !== false) {
    await client.query(
      `DELETE FROM metric_snapshots
       WHERE snapshot_type = 'ipt_servico_acc'
         AND periodo_inicial = $1::date
         AND periodo_final >= $1::date
         AND periodo_final <= $2::date`,
      [opts.monthStart, monthEnd]
    );
  }

  const res = await client.query<{
    tipo_servico: string | null;
    data_ref: string;
    plano: string;
    percentual_execucao: string | number;
  }>(
    `SELECT
       COALESCE(NULLIF(TRIM(tipo_servico), ''), 'Nao informado') AS tipo_servico,
       data_estimada::date::text AS data_ref,
       plano,
       percentual_execucao
     FROM ipt_report_linhas
     WHERE data_estimada >= $1::date
       AND data_estimada <= LEAST($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date)
       AND LOWER(COALESCE(status, '')) LIKE '%encerrad%'
       AND percentual_execucao IS NOT NULL
     ORDER BY data_estimada, tipo_servico, plano`,
    [opts.monthStart, monthEnd]
  );

  const byService = new Map<string, Map<string, Array<{ plano: string; percentual: number }>>>();
  for (const row of res.rows) {
    const plano = normalizarSetor(row.plano);
    const labelResolved = resolveTipoServicoExibicao(plano, row.tipo_servico ?? "");
    const label = labelResolved && labelResolved !== "—" ? labelResolved : row.tipo_servico || "Nao informado";
    const percentual = Number(row.percentual_execucao);
    if (!Number.isFinite(percentual)) continue;
    if (!byService.has(label)) byService.set(label, new Map());
    const byDay = byService.get(label)!;
    const dayRows = byDay.get(row.data_ref) ?? [];
    dayRows.push({ plano, percentual });
    byDay.set(row.data_ref, dayRows);
  }

  let upserted = 0;
  for (const [label, byDay] of byService) {
    const key = normalizeSnapshotKey(label) || "nao_informado";
    let totalSum = 0;
    let totalCount = 0;
    let positiveSum = 0;
    let positiveCount = 0;
    let zeroCount = 0;
    const planos = new Set<string>();
    for (const day of [...byDay.keys()].sort()) {
      const dayRows = byDay.get(day) ?? [];
      let daySum = 0;
      let dayZeroCount = 0;
      for (const item of dayRows) {
        totalSum += item.percentual;
        totalCount += 1;
        daySum += item.percentual;
        planos.add(item.plano);
        if (item.percentual > 0) {
          positiveSum += item.percentual;
          positiveCount += 1;
        } else {
          zeroCount += 1;
          dayZeroCount += 1;
        }
      }
      const percentual = totalCount > 0 ? Number((totalSum / totalCount).toFixed(4)) : null;
      const percentualDia = dayRows.length > 0 ? Number((daySum / dayRows.length).toFixed(4)) : null;
      const mediaSemZerados = positiveCount > 0 ? Number((positiveSum / positiveCount).toFixed(4)) : 0;
      await insertMetricSnapshot(client, {
        snapshotType: "ipt_servico_acc",
        metricKey: key,
        metricLabel: label,
        periodoInicial: opts.monthStart,
        periodoFinal: day,
        periodoTipo: "acumulado",
        valor: percentual,
        percentual,
        percentualDia,
        mediaSemZerados,
        quantidadePlanos: planos.size,
        totalDespachos: totalCount,
        totalDespachosDia: dayRows.length,
        despachosZerados: zeroCount,
        despachosZeradosDia: dayZeroCount,
        sourceFile: opts.sourceFile,
        metadata: {
          generated_from: "ipt_report_linhas",
          acumulado: true,
          acumulado_de: opts.monthStart,
          percentual_dia: "media_com_zerados_do_dia",
          service_label_strategy: "resolveTipoServicoExibicao",
        },
      });
      upserted += 1;
    }
  }
  return upserted;
}

async function rebuildIptServiceAccSnapshotsForRange(
  client: PoolClient,
  opts: { periodoInicial: string; periodoFinal: string; sourceFile: string }
): Promise<number> {
  const months = getMonthStartKeysInRange(opts.periodoInicial, opts.periodoFinal);
  let total = 0;
  for (const monthStart of months) {
    total += await rebuildIptServiceAccSnapshotsForMonth(client, {
      monthStart,
      sourceFile: opts.sourceFile,
      deleteExisting: true,
    });
  }
  return total;
}

async function rebuildAllIptServiceAccSnapshots(
  client: PoolClient,
  sourceFile = "rebuild_ipt_report_linhas"
): Promise<{ deletedOld: number; deletedAcc: number; upserted: number; months: string[] }> {
  const deletedOldRes = await client.query(
    `DELETE FROM metric_snapshots
     WHERE snapshot_type IN ('ipt_servico', 'ipt_servico_diario')`
  );
  const deletedAccRes = await client.query(
    `DELETE FROM metric_snapshots
     WHERE snapshot_type = 'ipt_servico_acc'`
  );
  const monthsRes = await client.query<{ month_start: string }>(
    `SELECT DISTINCT date_trunc('month', data_estimada)::date::text AS month_start
     FROM ipt_report_linhas
     WHERE data_estimada IS NOT NULL
     ORDER BY 1`
  );
  let upserted = 0;
  const months = monthsRes.rows.map((row) => row.month_start);
  for (const monthStart of months) {
    upserted += await rebuildIptServiceAccSnapshotsForMonth(client, {
      monthStart,
      sourceFile,
      deleteExisting: false,
    });
  }
  return {
    deletedOld: deletedOldRes.rowCount ?? 0,
    deletedAcc: deletedAccRes.rowCount ?? 0,
    upserted,
    months,
  };
}

/**
 * Snapshot por (serviço, dia) a partir do consolidado SELIMP.
 *
 * Lê de ipt_imports (file_type = ipt_consolidado_veiculos / varricao) os registros
 * do source_file recém-importado e agrega por (servico, data_referencia::date),
 * salvando 1 snapshot por par. A média é calculada DIRETO sobre raw.percentual_selimp
 * (escala 0–100). Preserva os zeros tal como veem nas planilhas — NADA é inventado.
 *
 * Para cada (servico, dia) salva:
 *   - percentual = AVG(raw.percentual_selimp)            // com zeros
 *   - media_sem_zerados = AVG(...) FILTER (> 0)          // sem zeros
 *   - quantidade_planos = COUNT(DISTINCT setor)
 *   - total_despachos = COUNT(*)
 *   - despachos_zerados = COUNT(*) FILTER (<= 0)
 *
 * Chave única do snapshot: (snapshot_type, metric_key, periodo_inicial, periodo_final, periodo_tipo)
 *   - metric_key = slug(servico)
 *   - periodo_inicial = periodo_final = data do dia
 *   - periodo_tipo = "diario"
 *
 * Reimportar a mesma planilha simplesmente atualiza o snapshot existente.
 */
async function insertIptServiceSnapshotsFromConsolidado(
  client: PoolClient,
  opts: { sourceFile: string }
): Promise<number> {
  const res = await client.query<{
    servico: string;
    data_ref: string;
    quantidade_planos: string;
    total_despachos: string;
    despachos_zerados: string;
    percentual: string | null;
    media_sem_zerados: string | null;
  }>(
    `SELECT
       COALESCE(NULLIF(TRIM(servico), ''), 'Nao informado') AS servico,
       (data_referencia AT TIME ZONE 'America/Sao_Paulo')::date::text AS data_ref,
       COUNT(DISTINCT setor)::int AS quantidade_planos,
       COUNT(*)::int AS total_despachos,
       COUNT(*) FILTER (WHERE COALESCE((raw->>'percentual_selimp')::numeric, 0) <= 0)::int AS despachos_zerados,
       ROUND(AVG((raw->>'percentual_selimp')::numeric), 4) AS percentual,
       ROUND(AVG((raw->>'percentual_selimp')::numeric) FILTER (WHERE (raw->>'percentual_selimp')::numeric > 0), 4) AS media_sem_zerados
     FROM ipt_imports
     WHERE file_type IN ('ipt_consolidado_veiculos','ipt_consolidado_varricao')
       AND source_file = $1
       AND (raw->>'percentual_selimp') IS NOT NULL
     GROUP BY 1, 2
     ORDER BY 2, 1`,
    [opts.sourceFile]
  );

  let upserted = 0;
  for (const row of res.rows) {
    const label = row.servico || "Nao informado";
    const key = normalizeSnapshotKey(label) || "nao_informado";
    await insertMetricSnapshot(client, {
      snapshotType: "ipt_servico_diario",
      metricKey: key,
      metricLabel: label,
      periodoInicial: row.data_ref,
      periodoFinal: row.data_ref,
      periodoTipo: "diario",
      valor: row.percentual != null ? Number(row.percentual) : null,
      percentual: row.percentual != null ? Number(row.percentual) : null,
      mediaSemZerados: row.media_sem_zerados != null ? Number(row.media_sem_zerados) : null,
      quantidadePlanos: Number(row.quantidade_planos ?? 0),
      totalDespachos: Number(row.total_despachos ?? 0),
      despachosZerados: Number(row.despachos_zerados ?? 0),
      sourceFile: opts.sourceFile,
      metadata: { generated_from: "ipt_imports_consolidado" },
    });
    upserted += 1;
  }
  return upserted;
}

function calcularMediaIfPorSubprefeituraSnapshot(
  bySigla: Record<string, { total: number; sem_irregularidade: number }>
): number {
  const percentuais = SUB_SIGLAS.map((sigla) => {
    const { total, sem_irregularidade } = bySigla[sigla];
    return total > 0 ? (sem_irregularidade / total) * 100 : 0;
  });
  const somaPercentuais = percentuais.reduce((acc, value) => acc + value, 0);
  const divisor = percentuais.some((value) => value === 0) ? 3 : 4;
  return somaPercentuais / divisor;
}

function isFullMonthPeriod(inicio: string, fim: string): { ano: number; mes: number } | null {
  const match = inicio.match(/^(\d{4})-(\d{2})-01$/);
  if (!match) return null;
  const ano = Number(match[1]);
  const mes = Number(match[2]);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const fimEsperado = `${ano}-${String(mes).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;
  return fim === fimEsperado ? { ano, mes } : null;
}

async function getIptOficialMensalSnapshot(client: PoolClient, inicio: string, fim: string): Promise<number | null> {
  const periodo = isFullMonthPeriod(inicio, fim);
  if (!periodo) return null;
  const res = await client.query(`SELECT percentual FROM ipt_oficial_mensal WHERE ano = $1 AND mes = $2`, [
    periodo.ano,
    periodo.mes,
  ]);
  const percentual = Number(res.rows[0]?.percentual);
  return Number.isFinite(percentual) ? percentual : null;
}

async function getIptPercentFromReportSnapshot(
  client: PoolClient,
  inicio: string,
  fim: string
): Promise<{ percentual: number; base: number } | null> {
  const reportRes = await client.query(
    `SELECT plano, percentual_execucao, status
     FROM ipt_report_linhas
     WHERE data_estimada >= $1::date AND data_estimada <= $2::date`,
    [inicio, fim]
  );
  const porPlano = new Map<string, number[]>();
  let linhasEncerradas = 0;
  let zerosEncerradas = 0;
  let zerosTotal = 0;
  for (const row of reportRes.rows as Array<{ plano: string; percentual_execucao: string | number | null; status: string | null }>) {
    const pctRawAll = Number(row.percentual_execucao);
    const pctAll = Number.isFinite(pctRawAll) ? Math.min(1, Math.max(0, pctRawAll > 1 ? pctRawAll / 100 : pctRawAll)) : null;
    if (pctAll === 0) zerosTotal += 1;
    if (!isReportStatusEncerrado(row.status)) continue;
    linhasEncerradas += 1;
    const plano = normalizarSetor(String(row.plano ?? "").trim());
    if (!plano) continue;
    const pctRaw = Number(row.percentual_execucao);
    if (!Number.isFinite(pctRaw)) continue;
    const pctDecimal = Math.min(1, Math.max(0, pctRaw > 1 ? pctRaw / 100 : pctRaw));
    if (pctDecimal === 0) zerosEncerradas += 1;
    const arr = porPlano.get(plano) ?? [];
    arr.push(pctDecimal);
    porPlano.set(plano, arr);
  }
  const ordens: Array<{ percentual: number }> = [];
  for (const arr of porPlano.values()) {
    const max = Math.max(...arr);
    const media = arr.reduce((a, b) => a + b, 0) / arr.length;
    const blend = 0.48 * max + 0.52 * media;
    ordens.push({ percentual: Math.min(1, Math.max(0, blend)) });
  }
  if (ordens.length === 0) return null;
  const cenarios = calcularCenariosIPT({
    ordens,
    totalLinhas: reportRes.rows.length,
    linhasEncerradas,
    zerosTotal,
    zerosEncerradas,
    planosDistintos: ordens.length,
    percentualOficial: await getIptOficialMensalSnapshot(client, inicio, fim),
  });
  if (!cenarios) return null;
  return { percentual: cenarios.estimado.percentual, base: ordens.length };
}

async function snapshotIndicadoresFromDb(
  client: PoolClient,
  opts: {
    periodoInicial: string;
    periodoFinal: string;
    periodoTipo: string;
    sourceFile: string;
    includeIaIrd?: boolean;
    includeIf?: boolean;
    includeIpt?: boolean;
  }
): Promise<number> {
  let saved = 0;
  let iaPontuacao: number | null = null;
  let irdPontuacao: number | null = null;
  let ifPontuacao: number | null = null;
  let iptPontuacao: number | null = null;
  let hasSacSource = false;
  let hasIfSource = false;
  let hasIptSource = false;

  if (opts.includeIaIrd) {
    const iaTotal = await client.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(responsividade_execucao, ''))) = 'SIM') AS no_prazo,
              COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(responsividade_execucao, ''))) = 'NÃƒO') AS fora_prazo
       FROM sacs
       WHERE data_registro >= $1::date AND data_registro < ($2::date + interval '1 day')
         AND source_file = $3
         AND (finalizado_fora_de_escopo IS NULL OR UPPER(TRIM(finalizado_fora_de_escopo)) = 'NÃƒO')
         AND TRIM(classificacao_do_servico) = 'SolicitaÃ§Ã£o'`,
      [opts.periodoInicial, opts.periodoFinal, opts.sourceFile]
    );
    const iaRow = iaTotal.rows[0];
    const noPrazo = Number(iaRow?.no_prazo ?? 0);
    const foraPrazo = Number(iaRow?.fora_prazo ?? 0);
    const totalCalculoIA = noPrazo + foraPrazo;
    hasSacSource = Number(iaRow?.total ?? 0) > 0;
    if (hasSacSource && totalCalculoIA > 0) {
      const ia = pontuacaoIA(noPrazo, totalCalculoIA);
      iaPontuacao = ia.pontuacao;
      await insertMetricSnapshot(client, {
        snapshotType: "indicador",
        metricKey: "IA",
        metricLabel: "IA",
        periodoInicial: opts.periodoInicial,
        periodoFinal: opts.periodoFinal,
        periodoTipo: opts.periodoTipo,
        valor: ia.valor,
        percentual: ia.percentual ?? ia.valor,
        pontuacao: ia.pontuacao,
        quantidadeBase: totalCalculoIA,
        sourceFile: opts.sourceFile,
        metadata: { no_prazo: noPrazo, fora_prazo: foraPrazo },
      });
      saved += 1;
    }

    const irdCount = await client.query(
      `SELECT COUNT(*) AS total FROM sacs
       WHERE data_registro >= $1::date AND data_registro < ($2::date + interval '1 day')
         AND source_file = $3
         AND (finalizado_fora_de_escopo IS NULL OR UPPER(TRIM(finalizado_fora_de_escopo)) = 'NÃƒO')
         AND TRIM(classificacao_do_servico) = 'ReclamaÃ§Ã£o'
         AND (procedente_por_status IS NOT NULL AND UPPER(TRIM(procedente_por_status)) = 'PROCEDE')`,
      [opts.periodoInicial, opts.periodoFinal, opts.sourceFile]
    );
    if (hasSacSource) {
      const reclamacoes = Number(irdCount.rows[0]?.total ?? 0);
      const ird = pontuacaoIRD(reclamacoes);
      irdPontuacao = ird.pontuacao;
      await insertMetricSnapshot(client, {
        snapshotType: "indicador",
        metricKey: "IRD",
        metricLabel: "IRD",
        periodoInicial: opts.periodoInicial,
        periodoFinal: opts.periodoFinal,
        periodoTipo: opts.periodoTipo,
        valor: ird.valor,
        pontuacao: ird.pontuacao,
        quantidadeBase: reclamacoes,
        sourceFile: opts.sourceFile,
        metadata: { reclamacoes_procedentes: reclamacoes },
      });
      saved += 1;
    }
  }

  if (opts.includeIf) {
    const ifExcludeSql = BFS_IF_EXCLUSAO_SQL.map((_, i) => `tipo_servico NOT ILIKE $${4 + i}`).join(" AND ");
    const ifFiscalSql = sqlBfsFiscalNaoEhSelimp();
    const ifByRegional = await client.query(
      `SELECT regional,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE TRIM(status) = 'Sem Irregularidades') AS sem_irregularidade
       FROM bfs
       WHERE data_fiscalizacao >= $1::date AND data_fiscalizacao < ($2::date + interval '1 day')
         AND source_file = $3
         AND ${ifExcludeSql}
         AND ${ifFiscalSql}
       GROUP BY regional`,
      [opts.periodoInicial, opts.periodoFinal, opts.sourceFile, ...BFS_IF_EXCLUSAO_SQL]
    );
    const bySigla: Record<string, { total: number; sem_irregularidade: number }> = {};
    for (const sigla of SUB_SIGLAS) bySigla[sigla] = { total: 0, sem_irregularidade: 0 };
    for (const row of ifByRegional.rows as Array<{ regional: string; total: string; sem_irregularidade: string }>) {
      const sigla = regionalToSigla(row.regional);
      if (sigla && bySigla[sigla]) {
        bySigla[sigla].total += Number(row.total ?? 0);
        bySigla[sigla].sem_irregularidade += Number(row.sem_irregularidade ?? 0);
      }
    }
    const totalBfs = Object.values(bySigla).reduce((a, x) => a + x.total, 0);
    hasIfSource = totalBfs > 0;
    if (hasIfSource) {
      const semIrregularidade = Object.values(bySigla).reduce((a, x) => a + x.sem_irregularidade, 0);
      const percentual = calcularMediaIfPorSubprefeituraSnapshot(bySigla);
      const ifInd = pontuacaoIFFromPercentual(percentual);
      ifPontuacao = ifInd.pontuacao;
      await insertMetricSnapshot(client, {
        snapshotType: "indicador",
        metricKey: "IF",
        metricLabel: "IF",
        periodoInicial: opts.periodoInicial,
        periodoFinal: opts.periodoFinal,
        periodoTipo: opts.periodoTipo,
        valor: ifInd.valor,
        percentual: ifInd.percentual ?? percentual,
        pontuacao: ifInd.pontuacao,
        quantidadeBase: totalBfs,
        sourceFile: opts.sourceFile,
        metadata: { sem_irregularidade: semIrregularidade, if_por_sub: bySigla },
      });
      saved += 1;
    }
  }

  if (opts.includeIpt) {
    const iptPercent = await getIptPercentFromReportSnapshot(client, opts.periodoInicial, opts.periodoFinal);
    hasIptSource = iptPercent != null;
    if (iptPercent) {
      const ipt = pontuacaoIPT(iptPercent.percentual);
      iptPontuacao = ipt.pontuacao;
      await insertMetricSnapshot(client, {
        snapshotType: "indicador",
        metricKey: "IPT",
        metricLabel: "IPT",
        periodoInicial: opts.periodoInicial,
        periodoFinal: opts.periodoFinal,
        periodoTipo: opts.periodoTipo,
        valor: ipt.valor,
        percentual: ipt.percentual,
        pontuacao: ipt.pontuacao,
        quantidadeBase: iptPercent.base,
        sourceFile: opts.sourceFile,
        metadata: { generated_from: "ipt_report_linhas" },
      });
      saved += 1;
    }
  }

  saved += await snapshotAdcIfComplete(client, {
    periodoInicial: opts.periodoInicial,
    periodoFinal: opts.periodoFinal,
    periodoTipo: opts.periodoTipo,
    sourceFile: opts.sourceFile,
  });

  return saved;
}

async function snapshotAdcIfComplete(
  client: PoolClient,
  opts: {
    periodoInicial: string;
    periodoFinal: string;
    periodoTipo: string;
    sourceFile: string;
  }
): Promise<number> {
  const r = await client.query(
    `SELECT DISTINCT ON (metric_key)
       id,
       metric_key,
       pontuacao,
       snapshot_at
     FROM metric_snapshots
     WHERE snapshot_type = 'indicador'
       AND metric_key IN ('IA', 'IRD', 'IF', 'IPT')
       AND periodo_final >= $1::date
       AND periodo_inicial <= $2::date
       AND pontuacao IS NOT NULL
     ORDER BY metric_key, snapshot_at DESC, id DESC`,
    [opts.periodoInicial, opts.periodoFinal]
  );
  const byKey = new Map<string, { id: number; pontuacao: number; snapshot_at: Date | string }>();
  for (const row of r.rows as Array<{ id: number; metric_key: string; pontuacao: string | number; snapshot_at: Date | string }>) {
    const pontuacao = Number(row.pontuacao);
    if (!Number.isFinite(pontuacao)) continue;
    byKey.set(row.metric_key, { id: Number(row.id), pontuacao, snapshot_at: row.snapshot_at });
  }
  const ia = byKey.get("IA");
  const ird = byKey.get("IRD");
  const ifInd = byKey.get("IF");
  const ipt = byKey.get("IPT");
  if (!ia || !ird || !ifInd || !ipt) return 0;

  const total = Math.min(ia.pontuacao, 20) + Math.min(ird.pontuacao, 20) + Math.min(ifInd.pontuacao, 20) + ipt.pontuacao;
  const latestSourceSnapshot = [ia, ird, ifInd, ipt]
    .map((item) => (item.snapshot_at instanceof Date ? item.snapshot_at.getTime() : new Date(item.snapshot_at).getTime()))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => b - a)[0];
  const latestSourceIso = latestSourceSnapshot ? new Date(latestSourceSnapshot).toISOString() : null;
  const alreadyExists = await client.query(
    `SELECT 1
     FROM metric_snapshots
     WHERE snapshot_type = 'indicador'
       AND metric_key = 'ADC'
       AND periodo_inicial = $1::date
       AND periodo_final = $2::date
       AND metadata->>'latest_component_snapshot_at' = $3
     LIMIT 1`,
    [opts.periodoInicial, opts.periodoFinal, latestSourceIso]
  );
  if ((alreadyExists.rowCount ?? 0) > 0) return 0;

    await insertMetricSnapshot(client, {
      snapshotType: "indicador",
      metricKey: "ADC",
      metricLabel: "ADC",
      periodoInicial: opts.periodoInicial,
      periodoFinal: opts.periodoFinal,
      periodoTipo: opts.periodoTipo,
      valor: total,
      pontuacao: total,
      sourceFile: opts.sourceFile,
      metadata: {
        ia_snapshot_id: ia.id,
        ird_snapshot_id: ird.id,
        if_snapshot_id: ifInd.id,
        ipt_snapshot_id: ipt.id,
        ia: ia.pontuacao,
        ird: ird.pontuacao,
        if: ifInd.pontuacao,
        ipt: ipt.pontuacao,
        latest_component_snapshot_at: latestSourceIso,
      },
    });
  return 1;
}

type ReportReferenceMode = "d_minus_1" | "fim_de_semana" | "mensal";
type SessionUploadType =
  | "sacs"
  | "cnc"
  | "cncsDetalhes"
  | "acic"
  | "ouvidoria"
  | "iptHistoricoOs"
  | "iptHistoricoOsVarricao"
  | "iptHistoricoOsCompactadores"
  | "iptDdmxVarricao"
  | "iptDdmxCompactadores"
  | "iptDdmxLight"
  | "iptReport"
  | "iptStatusBateria"
  | "iptCronograma"
  | "iptConsolidadoVeiculos"
  | "iptConsolidadoVarricao"
  | "iptModulosBateria";
type SessionKey = "flip" | "ddmx" | "selimp";

interface UploadSummary {
  processados: number;
  total: number;
  inseridos: number;
  atualizados: number;
  duplicados: number;
  erros: number;
  ultimo_import: string;
  referencia_importada?: string;
  modo_referencia?: string;
  periodo_inicial?: string;
  periodo_final?: string;
  ordens_encerradas?: number;
  snapshots_indicadores?: number;
  snapshots_servicos?: number;
  tipo_detectado?: SessionUploadType;
  sessao?: SessionKey;
  source_file?: string;
}

function mapIptTypeToSessionType(fileType: IptFileType): SessionUploadType {
  switch (fileType) {
    case "ipt_historico_os":
      return "iptHistoricoOs";
    case "ipt_historico_os_varricao":
      return "iptHistoricoOsVarricao";
    case "ipt_historico_os_compactadores":
      return "iptHistoricoOsCompactadores";
    case "ipt_report_selimp":
      return "iptReport";
    case "ipt_status_bateria":
      return "iptStatusBateria";
  }
}

function mapSessionTypeToLabel(type: SessionUploadType): string {
  switch (type) {
    case "sacs":
      return "SACs";
    case "cnc":
      return "BFS";
    case "cncsDetalhes":
      return "CNC";
    case "acic":
      return "ACIC";
    case "ouvidoria":
      return "Ouvidoria";
    case "iptHistoricoOs":
      return "DDMX — Veículos (histórico OS)";
    case "iptHistoricoOsVarricao":
      return "DDMX — Varrição (histórico OS)";
    case "iptHistoricoOsCompactadores":
      return "DDMX — Compactadores (histórico OS)";
    case "iptDdmxVarricao":
      return "DDMX — Varrição";
    case "iptDdmxCompactadores":
      return "DDMX — Compactadores";
    case "iptDdmxLight":
      return "DDMX — Light (Veículos)";
    case "iptReport":
      return "IPT - Report SELIMP";
    case "iptStatusBateria":
      return "IPT - Status de Bateria";
    case "iptCronograma":
      return "IPT - Cronograma";
    case "iptConsolidadoVeiculos":
      return "IPT — Consolidado (veículos)";
    case "iptConsolidadoVarricao":
      return "IPT — Consolidado (varrição)";
    case "iptModulosBateria":
      return "IPT — Baterias x Módulos";
  }
}

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function describeReportReference(mode: ReportReferenceMode, inicio: string, fim: string): string {
  if (mode === "d_minus_1") return `D-1 (${inicio})`;
  if (mode === "fim_de_semana") return `Sexta a domingo (${inicio} a ${fim})`;
  if (inicio === fim) return inicio;
  return `${inicio} a ${fim}`;
}

export const uploadRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", async (request, reply) => {
    const user = await requirePageAccess(request, reply, "upload");
    if (!user) return reply;
    if (
      !ensureIptRestrictedUploadAccess(request, reply, [
        "/upload/ipt-status-bateria",
        "/upload/ipt-historico-bateria",
        "/upload/clear-ipt-dados-bateria",
        "/upload/last-updates",
      ])
    ) {
      return reply;
    }
  });

  const getLastUpdate = async (table: "sacs" | "bfs" | "acic" | "ouvidoria" | "cncs") => {
    const last = await pool.query(
      `SELECT source_file, updated_at FROM ${table} ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`
    );
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM ${table}`);
    return {
      ultimo_import: last.rows[0]?.updated_at ?? null,
      source_file: last.rows[0]?.source_file ?? null,
      total_registros: Number(count.rows[0]?.total ?? 0),
    };
  };

  type DdmxNewTableKey = "ddmx_varricao" | "ddmx_veiculos_light" | "ddmx_veiculos_compactadores";

  const getLastDdmxUpdate = async (key: DdmxNewTableKey) => {
    try {
      if (key === "ddmx_varricao") {
        const last = await pool.query(
          `SELECT source_file, updated_at FROM ipt_ddmx_varricao ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`
        );
        const count = await pool.query(`SELECT COUNT(*)::int AS total FROM ipt_ddmx_varricao`);
        return {
          ultimo_import: last.rows[0]?.updated_at ?? null,
          source_file: last.rows[0]?.source_file ?? null,
          total_registros: Number(count.rows[0]?.total ?? 0),
        };
      }
      const subtipo = key === "ddmx_veiculos_light" ? "light" : "compactadores";
      const last = await pool.query(
        `SELECT source_file, updated_at FROM ipt_ddmx_veiculos WHERE subtipo = $1 ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`,
        [subtipo]
      );
      const count = await pool.query(
        `SELECT COUNT(*)::int AS total FROM ipt_ddmx_veiculos WHERE subtipo = $1`,
        [subtipo]
      );
      return {
        ultimo_import: last.rows[0]?.updated_at ?? null,
        source_file: last.rows[0]?.source_file ?? null,
        total_registros: Number(count.rows[0]?.total ?? 0),
      };
    } catch {
      return { ultimo_import: null, source_file: null, total_registros: 0 };
    }
  };

  const getLastIptUpdate = async (
    fileType: IptFileType | "ipt_consolidado_veiculos" | "ipt_consolidado_varricao" | "ipt_modulos_bateria"
  ) => {
    if (fileType === "ipt_report_selimp") {
      const last = await pool.query(
        `SELECT
           source_file,
           updated_at,
           periodo_tipo,
           periodo_inicial::text AS periodo_inicial,
           periodo_final::text AS periodo_final
         FROM ipt_report_linhas
         ORDER BY updated_at DESC
         LIMIT 1`
      );
      const count = await pool.query(
        `SELECT
           COUNT(*)::bigint AS total_linhas,
           COUNT(*) FILTER (
             WHERE LOWER(COALESCE(status, '')) LIKE '%encerrado%'
           )::bigint AS total_encerradas
         FROM ipt_report_linhas`
      );
      const r = last.rows[0];
      const refLabel = r
        ? describeReportReference(
            (r.periodo_tipo ?? "mensal") as ReportReferenceMode,
            r.periodo_inicial ?? "",
            r.periodo_final ?? "",
          )
        : null;
      return {
        ultimo_import: r?.updated_at ?? null,
        source_file: r?.source_file ?? null,
        total_registros: Number(count.rows[0]?.total_linhas ?? 0),
        total_encerradas: Number(count.rows[0]?.total_encerradas ?? 0),
        ultima_referencia: refLabel,
        periodo_tipo: r?.periodo_tipo ?? null,
        periodo_inicial: r?.periodo_inicial ?? null,
        periodo_final: r?.periodo_final ?? null,
      };
    }
    const last = await pool.query(
      `SELECT source_file, updated_at FROM ipt_imports WHERE file_type = $1 ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`,
      [fileType]
    );
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM ipt_imports WHERE file_type = $1`,
      [fileType]
    );
    return {
      ultimo_import: last.rows[0]?.updated_at ?? null,
      source_file: last.rows[0]?.source_file ?? null,
      total_registros: Number(count.rows[0]?.total ?? 0),
    };
  };

  const recordUploadEvent = async (
    session: SessionKey,
    uploadType: SessionUploadType,
    sourceFile: string,
    summary: UploadSummary
  ) => {
    await pool.query(
      `INSERT INTO upload_events (
        session_key, upload_type, source_file, processados, total, inseridos, atualizados, duplicados, erros,
        referencia_importada, metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW())`,
      [
        session,
        uploadType,
        sourceFile,
        summary.processados ?? 0,
        summary.total ?? 0,
        summary.inseridos ?? 0,
        summary.atualizados ?? 0,
        summary.duplicados ?? 0,
        summary.erros ?? 0,
        summary.referencia_importada ?? null,
        JSON.stringify({
          modo_referencia: summary.modo_referencia ?? null,
          periodo_inicial: summary.periodo_inicial ?? null,
          periodo_final: summary.periodo_final ?? null,
          ordens_encerradas: summary.ordens_encerradas ?? null,
          snapshots_indicadores: summary.snapshots_indicadores ?? null,
          snapshots_servicos: summary.snapshots_servicos ?? null,
        }),
      ]
    );
  };

  const getSessionHistory = async (session: SessionKey) => {
    const result = await pool.query(
      `SELECT
         upload_type,
         source_file,
         processados,
         total,
         inseridos,
         atualizados,
         duplicados,
         erros,
         referencia_importada,
         metadata,
         created_at
       FROM upload_events
       WHERE session_key = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 10`,
      [session]
    );
    return result.rows.map((row) => ({
      tipo: row.upload_type,
      tipo_label: mapSessionTypeToLabel(row.upload_type as SessionUploadType),
      source_file: row.source_file,
      processados: Number(row.processados ?? 0),
      total: Number(row.total ?? 0),
      inseridos: Number(row.inseridos ?? 0),
      atualizados: Number(row.atualizados ?? 0),
      duplicados: Number(row.duplicados ?? 0),
      erros: Number(row.erros ?? 0),
      referencia_importada: row.referencia_importada ?? null,
      periodo_inicial: row.metadata?.periodo_inicial ?? null,
      periodo_final: row.metadata?.periodo_final ?? null,
      ordens_encerradas: row.metadata?.ordens_encerradas ?? null,
      created_at: row.created_at,
    }));
  };

  const getSessionOverview = async (
    session: SessionKey,
    fallback: { ultimo_import?: string | null; source_file?: string | null; total_registros?: number }
  ) => {
    const history = await getSessionHistory(session);
    const latest = history[0];
    return {
      ultimo_import: latest?.created_at ?? fallback.ultimo_import ?? null,
      source_file: latest?.source_file ?? fallback.source_file ?? null,
      total_registros: latest?.processados ?? fallback.total_registros ?? 0,
      tipo_detectado: latest?.tipo ?? null,
      tipo_detectado_label: latest?.tipo_label ?? null,
      referencia_importada: latest?.referencia_importada ?? null,
      history,
    };
  };

  const importFileByDetectedType = async (
    uploadType: SessionUploadType,
    buffer: Buffer,
    sourceFile: string
  ): Promise<UploadSummary> => {
    if (uploadType === "sacs") {
      const rows = parseSacCsv(buffer, sourceFile);
      const client = await pool.connect();
      try {
        let inserted = 0;
        let updated = 0;
        for (const r of rows) {
          const updatedResult = await client.query(
            `UPDATE sacs SET
              data_registro = $2,
              finalizado_fora_de_escopo = $3,
              classificacao_do_servico = $4,
              responsividade_execucao = $5,
              procedente_por_status = $6,
              regional = $7,
              servico = $8,
              endereco = $9,
              data_execucao = $10,
              data_agendamento = $11,
              data_acionamento_agendamento = $12,
              data_realizacao_confirmacao_execucao = $13,
              data_ultima_atualizacao = $14,
              status_planilha = $15,
              raw = $16,
              source_file = $17,
              updated_at = NOW()
            WHERE numero_chamado = $1`,
            [
              r.numero_chamado || null,
              r.data_registro,
              r.finalizado_fora_de_escopo || null,
              r.classificacao_do_servico || null,
              r.responsividade_execucao || null,
              r.procedente_por_status || null,
              r.regional || null,
              r.servico || null,
              r.endereco || null,
              r.data_execucao,
              r.data_agendamento,
              r.data_acionamento_agendamento,
              r.data_realizacao_confirmacao_execucao,
              r.data_ultima_atualizacao,
              r.status_planilha || null,
              JSON.stringify(r.raw),
              sourceFile,
            ]
          );
          if ((updatedResult.rowCount ?? 0) > 0) {
            updated += updatedResult.rowCount ?? 0;
            continue;
          }
          await client.query(
            `INSERT INTO sacs (
              numero_chamado, data_registro, finalizado_fora_de_escopo, classificacao_do_servico,
              responsividade_execucao, procedente_por_status, regional, servico, endereco, data_execucao,
              data_agendamento, data_acionamento_agendamento, data_realizacao_confirmacao_execucao, data_ultima_atualizacao, status_planilha,
              raw, source_file, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())`,
            [
              r.numero_chamado || null,
              r.data_registro,
              r.finalizado_fora_de_escopo || null,
              r.classificacao_do_servico || null,
              r.responsividade_execucao || null,
              r.procedente_por_status || null,
              r.regional || null,
              r.servico || null,
              r.endereco || null,
              r.data_execucao,
              r.data_agendamento,
              r.data_acionamento_agendamento,
              r.data_realizacao_confirmacao_execucao,
              r.data_ultima_atualizacao,
              r.status_planilha || null,
              JSON.stringify(r.raw),
              sourceFile,
            ]
          );
          inserted += 1;
        }
        invalidatePrefix("sacs");
        invalidatePrefix("kpis");
        const range = getImportDateRange(rows.map((r) => r.data_registro));
        const snapshotsIndicadores = range
          ? await snapshotIndicadoresFromDb(client, {
              periodoInicial: range.inicio,
              periodoFinal: range.fim,
              periodoTipo: "importacao",
              sourceFile,
              includeIaIrd: true,
            })
          : 0;
        return {
          processados: inserted + updated,
          total: rows.length,
          inseridos: inserted,
          atualizados: updated,
          duplicados: 0,
          erros: 0,
          ultimo_import: new Date().toISOString(),
          snapshots_indicadores: snapshotsIndicadores,
        };
      } finally {
        client.release();
      }
    }

    if (uploadType === "cnc") {
      const rows = parseBfsCsv(buffer, sourceFile);
      const client = await pool.connect();
      try {
        let inserted = 0;
        let updated = 0;
        for (const r of rows) {
          const updatedResult = await client.query(
            `UPDATE bfs SET
              data_fiscalizacao = $2,
              data_vistoria = $3,
              status = $4,
              tipo_servico = $5,
              regional = $6,
              endereco = $7,
              fiscal = $8,
              raw = $9,
              source_file = $10,
              updated_at = NOW()
            WHERE numero_bfs = $1`,
            [
              r.numero_bfs || null,
              r.data_fiscalizacao,
              r.data_vistoria,
              r.status || null,
              r.tipo_servico || null,
              r.regional || null,
              r.endereco || null,
              r.fiscal || null,
              JSON.stringify(r.raw),
              sourceFile,
            ]
          );
          if ((updatedResult.rowCount ?? 0) > 0) {
            updated += updatedResult.rowCount ?? 0;
            continue;
          }
          await client.query(
            `INSERT INTO bfs (
              numero_bfs, data_fiscalizacao, data_vistoria, status, tipo_servico, regional, endereco, fiscal, raw, source_file, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
            [
              r.numero_bfs || null,
              r.data_fiscalizacao,
              r.data_vistoria,
              r.status || null,
              r.tipo_servico || null,
              r.regional || null,
              r.endereco || null,
              r.fiscal || null,
              JSON.stringify(r.raw),
              sourceFile,
            ]
          );
          inserted += 1;
        }
        invalidatePrefix("cnc");
        invalidatePrefix("cnc_defesa");
        invalidatePrefix("kpis");
        const range = getImportDateRange(rows.map((r) => r.data_fiscalizacao));
        const snapshotsIndicadores = range
          ? await snapshotIndicadoresFromDb(client, {
              periodoInicial: range.inicio,
              periodoFinal: range.fim,
              periodoTipo: "importacao",
              sourceFile,
              includeIf: true,
            })
          : 0;
        return {
          processados: inserted + updated,
          total: rows.length,
          inseridos: inserted,
          atualizados: updated,
          duplicados: 0,
          erros: 0,
          ultimo_import: new Date().toISOString(),
          snapshots_indicadores: snapshotsIndicadores,
        };
      } finally {
        client.release();
      }
    }

    if (uploadType === "cncsDetalhes") {
      const rows = parseCncDetalhesCsv(buffer, sourceFile);
      const client = await pool.connect();
      try {
        const { inseridos } = await mergeImportCncDetalhes(client, rows, sourceFile);
        invalidatePrefix("cnc");
        invalidatePrefix("cnc_defesa");
        invalidatePrefix("kpis");
        return {
          processados: inseridos,
          total: rows.length,
          inseridos,
          atualizados: 0,
          duplicados: 0,
          erros: 0,
          ultimo_import: new Date().toISOString(),
        };
      } finally {
        client.release();
      }
    }

    if (uploadType === "ouvidoria") {
      const rows = parseOuvidoriaCsv(buffer);
      const client = await pool.connect();
      try {
        let inserted = 0;
        for (const row of rows) {
          await client.query(`INSERT INTO ouvidoria (raw, source_file, updated_at) VALUES ($1, $2, NOW())`, [
            JSON.stringify(row),
            sourceFile,
          ]);
          inserted += 1;
        }
        return {
          processados: inserted,
          total: rows.length,
          inseridos: inserted,
          atualizados: 0,
          duplicados: 0,
          erros: 0,
          ultimo_import: new Date().toISOString(),
        };
      } finally {
        client.release();
      }
    }

    if (uploadType === "acic") {
      const rows = parseAcicCsv(buffer);
      const client = await pool.connect();
      try {
        let inserted = 0;
        for (const row of rows) {
          await client.query(`INSERT INTO acic (raw, source_file, updated_at) VALUES ($1, $2, NOW())`, [
            JSON.stringify(row),
            sourceFile,
          ]);
          await mergeAcicOverridesAfterImportRow(client, row as Record<string, unknown>);
          inserted += 1;
        }
        return {
          processados: inserted,
          total: rows.length,
          inseridos: inserted,
          atualizados: 0,
          duplicados: 0,
          erros: 0,
          ultimo_import: new Date().toISOString(),
        };
      } finally {
        client.release();
      }
    }

    throw new Error(`Tipo de importacao nao suportado: ${uploadType}`);
  };

  const importIptBuffer = async (
    fileType: IptFileType,
    buffer: Buffer,
    sourceFile: string,
    opts?: { mesReferencia?: string }
  ) => {
    const rows = parseIptWorkbook(buffer, fileType);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const client = await pool.connect();
    try {
      let inserted = 0;
      let updated = 0;

      let dataRefFallback: Date = yesterday;
      if (fileType === "ipt_report_selimp" && opts?.mesReferencia) {
        const match = opts.mesReferencia.match(/^(\d{4})-(\d{2})$/);
        if (match) {
          const ano = Number(match[1]);
          const mes = Number(match[2]);
          const ultimoDia = new Date(Date.UTC(ano, mes, 0));
          if (!Number.isNaN(ultimoDia.getTime())) {
            dataRefFallback = ultimoDia;
          }
        }
      }

      // ipt_report_selimp: antes de inserir, DELETAR dados do mesmo período para evitar bagunça
      if (fileType === "ipt_report_selimp") {
        const d = dataRefFallback instanceof Date ? dataRefFallback : new Date(dataRefFallback);
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth() + 1;
        const day = d.getUTCDate();
        const dateKey = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        if (opts?.mesReferencia) {
          const [anoStr, mesStr] = opts.mesReferencia.split("-").map(Number);
          const ini = `${anoStr}-${String(mesStr).padStart(2, "0")}-01`;
          const ultDia = new Date(Date.UTC(anoStr, mesStr, 0)).getUTCDate();
          const fim = `${anoStr}-${String(mesStr).padStart(2, "0")}-${String(ultDia).padStart(2, "0")}`;
          await client.query(
            `DELETE FROM ipt_imports WHERE file_type = 'ipt_report_selimp' AND data_referencia::date >= $1::date AND data_referencia::date <= $2::date`,
            [ini, fim]
          );
        } else {
          await client.query(
            `DELETE FROM ipt_imports WHERE file_type = 'ipt_report_selimp' AND data_referencia::date = $1::date`,
            [dateKey]
          );
        }
      }

      for (const row of rows) {
        const raw = { ...(row.raw ?? {}) } as Record<string, unknown>;
        let dataReferencia = row.dataReferencia;
        if (fileType === "ipt_report_selimp" && !dataReferencia) {
          dataReferencia = dataRefFallback;
          raw._data_referencia_estimada = !opts?.mesReferencia;
          raw._metodo_data_referencia = opts?.mesReferencia ? `mes_${opts.mesReferencia}` : "fallback_d_1_upload";
        }
        let recordKey = row.recordKey;
        if (fileType === "ipt_report_selimp" && dataReferencia) {
          const d = dataReferencia instanceof Date ? dataReferencia : new Date(dataReferencia);
          const dateKey = !Number.isNaN(d.getTime())
            ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
            : "";
          if (dateKey) recordKey = `${row.recordKey}|${dateKey}`;
        }
        const result = await client.query(
          `INSERT INTO ipt_imports (
            file_type, record_key, setor, data_referencia, servico, raw, source_file, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW())
          ON CONFLICT (file_type, record_key)
          DO UPDATE SET
            setor = EXCLUDED.setor,
            data_referencia = EXCLUDED.data_referencia,
            servico = EXCLUDED.servico,
            raw = EXCLUDED.raw,
            source_file = EXCLUDED.source_file,
            updated_at = NOW()
          RETURNING (xmax = 0) AS inserted`,
          [
            fileType,
            recordKey,
            row.setor || null,
            dataReferencia,
            row.servico || null,
            JSON.stringify(raw),
            sourceFile,
          ]
        );
        const wasInserted = Boolean(result.rows[0]?.inserted);
        if (wasInserted) inserted += 1;
        else updated += 1;
      }

      invalidatePrefix("ipt_preview");
      invalidatePrefix("kpis");
      return {
        processados: inserted + updated,
        total: rows.length,
        inseridos: inserted,
        atualizados: updated,
        duplicados: 0,
        erros: 0,
        ultimo_import: new Date().toISOString(),
        source_file: sourceFile,
      };
    } finally {
      client.release();
    }
  };

  type DdmxTarget = "varricao" | "compactadores" | "light";
  const ddmxParseConfig: Record<DdmxTarget, IptFileType> = {
    varricao: "ipt_historico_os_varricao",
    compactadores: "ipt_historico_os_compactadores",
    light: "ipt_historico_os",
  };

  const importDdmxBuffer = async (
    target: DdmxTarget,
    buffer: Buffer,
    sourceFile: string
  ) => {
    const parseType = ddmxParseConfig[target];
    const rows = parseIptWorkbook(buffer, parseType);

    const client = await pool.connect();
    try {
      let inserted = 0;
      let updated = 0;

      if (target === "varricao") {
        for (const row of rows) {
          const result = await client.query(
            `INSERT INTO ipt_ddmx_varricao (
              record_key, setor, data_referencia, servico, raw, source_file, updated_at
            ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW())
            ON CONFLICT (record_key)
            DO UPDATE SET
              setor = EXCLUDED.setor,
              data_referencia = EXCLUDED.data_referencia,
              servico = EXCLUDED.servico,
              raw = EXCLUDED.raw,
              source_file = EXCLUDED.source_file,
              updated_at = NOW()
            RETURNING (xmax = 0) AS inserted`,
            [
              row.recordKey,
              row.setor || null,
              row.dataReferencia,
              row.servico || null,
              JSON.stringify(row.raw),
              sourceFile,
            ]
          );
          if (Boolean(result.rows[0]?.inserted)) inserted += 1;
          else updated += 1;
        }
      } else {
        const subtipo = target;
        for (const row of rows) {
          const result = await client.query(
            `INSERT INTO ipt_ddmx_veiculos (
              subtipo, record_key, setor, data_referencia, servico, raw, source_file, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW())
            ON CONFLICT (subtipo, record_key)
            DO UPDATE SET
              setor = EXCLUDED.setor,
              data_referencia = EXCLUDED.data_referencia,
              servico = EXCLUDED.servico,
              raw = EXCLUDED.raw,
              source_file = EXCLUDED.source_file,
              updated_at = NOW()
            RETURNING (xmax = 0) AS inserted`,
            [
              subtipo,
              row.recordKey,
              row.setor || null,
              row.dataReferencia,
              row.servico || null,
              JSON.stringify(row.raw),
              sourceFile,
            ]
          );
          if (Boolean(result.rows[0]?.inserted)) inserted += 1;
          else updated += 1;
        }
      }

      invalidatePrefix("ipt_preview");
      invalidatePrefix("kpis");
      return {
        processados: inserted + updated,
        total: rows.length,
        inseridos: inserted,
        atualizados: updated,
        duplicados: 0,
        erros: 0,
        ultimo_import: new Date().toISOString(),
        source_file: sourceFile,
      };
    } finally {
      client.release();
    }
  };

  const importConsolidadoBuffer = async (
    fileType: "ipt_consolidado_veiculos" | "ipt_consolidado_varricao",
    buffer: Buffer,
    sourceFile: string
  ) => {
    let parse_stats: Record<string, number | string> | undefined;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const consolidadoRows =
        fileType === "ipt_consolidado_veiculos"
          ? (() => {
              const parsed = parseConsolidadoVeiculos(buffer);
              parse_stats = { ...parsed.stats };
              return parsed.rows;
            })()
          : parseConsolidadoVarricao(buffer);

      if (consolidadoRows.length === 0) throw new Error("Nenhum registro valido na planilha");

      await client.query(`DELETE FROM ipt_imports WHERE file_type = $1`, [fileType]);
      let inserted = 0;
      for (const row of consolidadoRows) {
        await client.query(
          `INSERT INTO ipt_imports (
            file_type, record_key, setor, data_referencia, servico, raw, source_file, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW())`,
          [
            fileType,
            row.recordKey,
            row.setor,
            row.dataReferencia,
            row.servico || null,
            JSON.stringify(row.raw),
            sourceFile,
          ]
        );
        inserted += 1;
      }
      await client.query("COMMIT");
      invalidatePrefix("ipt_preview");
      invalidatePrefix("kpis");
      return {
        processados: inserted,
        total: consolidadoRows.length,
        inseridos: inserted,
        atualizados: 0,
        duplicados: 0,
        erros: 0,
        ultimo_import: new Date().toISOString(),
        snapshots_servicos: 0,
        source_file: sourceFile,
        ...(parse_stats ? { parse_stats } : {}),
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  };

  const importIptFile = async (
    fileType: IptFileType,
    request: FastifyRequest,
    opts?: { mesReferencia?: string }
  ) => {
    const data = await request.file();
    if (!data) {
      throw new Error("Arquivo XLSX obrigatório");
    }
    const buffer = await data.toBuffer();
    const sourceFile = data.filename;
    return importIptBuffer(fileType, buffer, sourceFile, opts);
  };

  fastify.post<{ Params: { session: SessionKey } }>("/upload/session/:session", async (request, reply) => {
    const session = request.params.session;
    if (session !== "flip" && session !== "ddmx") {
      return reply.code(400).send({ detail: "Sessao invalida. Use flip ou ddmx." });
    }

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ detail: session === "flip" ? "Arquivo CSV obrigatorio" : "Arquivo XLSX obrigatorio" });
    }

    const buffer = await data.toBuffer();
    const sourceFile = data.filename;
    const lowerName = sourceFile.toLowerCase();

    try {
      if (session === "flip") {
        if (!lowerName.endsWith(".csv")) {
          return reply.code(400).send({ detail: "A sessao FLIP aceita apenas arquivos CSV." });
        }
        const detectedType = detectFlipCsvType(buffer, sourceFile);
        if (!detectedType) {
          return reply.code(400).send({
            detail: "Nao foi possivel identificar o tipo do CSV do FLIP. Verifique a estrutura ou a coluna Origem.",
          });
        }
        const summary = await importFileByDetectedType(detectedType, buffer, sourceFile);
        await recordUploadEvent("flip", detectedType, sourceFile, summary);
        return {
          ...summary,
          tipo_detectado: detectedType,
          tipo_detectado_label: mapSessionTypeToLabel(detectedType),
          sessao: "flip",
          source_file: sourceFile,
        };
      }

      if (!lowerName.endsWith(".xlsx") && !lowerName.endsWith(".xls")) {
        return reply.code(400).send({ detail: "A sessao DDMX aceita apenas arquivos XLSX." });
      }
      const detectedIptType = detectDdmxWorkbookType(buffer, sourceFile);
      if (!detectedIptType) {
        return reply.code(400).send({
          detail: "Nao foi possivel identificar o tipo da planilha DDMX. Use um arquivo de Historico OS, Varricao ou Compactadores.",
        });
      }
      const summary = await importIptBuffer(detectedIptType, buffer, sourceFile);
      const sessionType = mapIptTypeToSessionType(detectedIptType);
      await recordUploadEvent("ddmx", sessionType, sourceFile, summary);
      return {
        ...summary,
        tipo_detectado: sessionType,
        tipo_detectado_label: mapSessionTypeToLabel(sessionType),
        sessao: "ddmx",
        source_file: sourceFile,
      };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Falha no upload";
      return reply.code(400).send({ detail });
    }
  });

  const ddmxUploadHandler = (target: DdmxTarget, sessionType: SessionUploadType) =>
    async (request: FastifyRequest, reply: any) => {
      const data = await request.file();
      if (!data) return reply.code(400).send({ detail: "Arquivo XLSX obrigatório" });
      const lowerName = data.filename.toLowerCase();
      if (!lowerName.endsWith(".xlsx") && !lowerName.endsWith(".xls")) {
        return reply.code(400).send({ detail: "Aceita apenas arquivos XLSX/XLS." });
      }
      try {
        const buffer = await data.toBuffer();
        const summary = await importDdmxBuffer(target, buffer, data.filename);
        await recordUploadEvent("ddmx", sessionType, data.filename, summary);
        return {
          ...summary,
          tipo_detectado: sessionType,
          tipo_detectado_label: mapSessionTypeToLabel(sessionType),
          sessao: "ddmx",
          source_file: data.filename,
        };
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : "Falha no upload DDMX";
        return reply.code(400).send({ detail });
      }
    };

  fastify.post("/upload/ipt-ddmx-varricao", ddmxUploadHandler("varricao", "iptDdmxVarricao"));
  fastify.post("/upload/ipt-ddmx-compactadores", ddmxUploadHandler("compactadores", "iptDdmxCompactadores"));
  fastify.post("/upload/ipt-ddmx-light", ddmxUploadHandler("light", "iptDdmxLight"));

  fastify.post("/upload/sacs-csv", async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ detail: "Arquivo CSV obrigatório" });
    const buffer = await data.toBuffer();
    const sourceFile = data.filename;
    const rows = parseSacCsv(buffer, sourceFile);

    const client = await pool.connect();
    try {
      let inserted = 0;
      let updated = 0;
      for (const r of rows) {
        const updatedResult = await client.query(
          `UPDATE sacs SET
            data_registro = $2,
            finalizado_fora_de_escopo = $3,
            classificacao_do_servico = $4,
            responsividade_execucao = $5,
            procedente_por_status = $6,
            regional = $7,
            servico = $8,
            endereco = $9,
            data_execucao = $10,
            data_agendamento = $11,
            data_acionamento_agendamento = $12,
            data_realizacao_confirmacao_execucao = $13,
            data_ultima_atualizacao = $14,
            status_planilha = $15,
            raw = $16,
            source_file = $17,
            updated_at = NOW()
          WHERE numero_chamado = $1`,
          [
            r.numero_chamado || null,
            r.data_registro,
            r.finalizado_fora_de_escopo || null,
            r.classificacao_do_servico || null,
            r.responsividade_execucao || null,
            r.procedente_por_status || null,
            r.regional || null,
            r.servico || null,
            r.endereco || null,
            r.data_execucao,
            r.data_agendamento,
            r.data_acionamento_agendamento,
            r.data_realizacao_confirmacao_execucao,
            r.data_ultima_atualizacao,
            r.status_planilha || null,
            JSON.stringify(r.raw),
            sourceFile,
          ]
        );
        if ((updatedResult.rowCount ?? 0) > 0) {
          updated += updatedResult.rowCount ?? 0;
          continue;
        }

        await client.query(
          `INSERT INTO sacs (
            numero_chamado, data_registro, finalizado_fora_de_escopo, classificacao_do_servico,
            responsividade_execucao, procedente_por_status, regional, servico, endereco, data_execucao,
            data_agendamento, data_acionamento_agendamento, data_realizacao_confirmacao_execucao, data_ultima_atualizacao, status_planilha,
            raw, source_file, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())`,
          [
            r.numero_chamado || null,
            r.data_registro,
            r.finalizado_fora_de_escopo || null,
            r.classificacao_do_servico || null,
            r.responsividade_execucao || null,
            r.procedente_por_status || null,
            r.regional || null,
            r.servico || null,
            r.endereco || null,
            r.data_execucao,
            r.data_agendamento,
            r.data_acionamento_agendamento,
            r.data_realizacao_confirmacao_execucao,
            r.data_ultima_atualizacao,
            r.status_planilha || null,
            JSON.stringify(r.raw),
            sourceFile,
          ]
        );
        inserted += 1;
      }
      invalidatePrefix("sacs");
      invalidatePrefix("kpis");
      return {
        processados: inserted + updated,
        total: rows.length,
        inseridos: inserted,
        atualizados: updated,
        duplicados: 0,
        erros: 0,
        ultimo_import: new Date().toISOString(),
      };
    } finally {
      client.release();
    }
  });

  fastify.post("/upload/cnc-csv", async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ detail: "Arquivo CSV obrigatório (BFS/CNC)" });
    const buffer = await data.toBuffer();
    const sourceFile = data.filename;
    const rows = parseBfsCsv(buffer, sourceFile);

    const client = await pool.connect();
    try {
      let inserted = 0;
      let updated = 0;
      for (const r of rows) {
        const updatedResult = await client.query(
          `UPDATE bfs SET
            data_fiscalizacao = $2,
            data_vistoria = $3,
            status = $4,
            tipo_servico = $5,
            regional = $6,
            endereco = $7,
            fiscal = $8,
            raw = $9,
            source_file = $10,
            updated_at = NOW()
          WHERE numero_bfs = $1`,
          [
            r.numero_bfs || null,
            r.data_fiscalizacao,
            r.data_vistoria,
            r.status || null,
            r.tipo_servico || null,
            r.regional || null,
            r.endereco || null,
            r.fiscal || null,
            JSON.stringify(r.raw),
            sourceFile,
          ]
        );
        if ((updatedResult.rowCount ?? 0) > 0) {
          updated += updatedResult.rowCount ?? 0;
          continue;
        }
        await client.query(
          `INSERT INTO bfs (
            numero_bfs, data_fiscalizacao, data_vistoria, status, tipo_servico, regional, endereco, fiscal, raw, source_file, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
          [
            r.numero_bfs || null,
            r.data_fiscalizacao,
            r.data_vistoria,
            r.status || null,
            r.tipo_servico || null,
            r.regional || null,
            r.endereco || null,
            r.fiscal || null,
            JSON.stringify(r.raw),
            sourceFile,
          ]
        );
        inserted += 1;
      }
      invalidatePrefix("cnc");
      invalidatePrefix("cnc_defesa");
      invalidatePrefix("kpis");
      return {
        processados: inserted + updated,
        total: rows.length,
        inseridos: inserted,
        atualizados: updated,
        duplicados: 0,
        erros: 0,
        ultimo_import: new Date().toISOString(),
      };
    } finally {
      client.release();
    }
  });

  /**
   * Importa FLIP_CONSULTA_CNC — merge incremental (não zera a tabela inteira).
   * Query opcional:
   * - `periodo_inicial` + `periodo_final` (YYYY-MM-DD): apaga CNCs com data_fiscalizacao nesse intervalo e insere o CSV (troca só o mês de apuração).
   * - `substituir_tudo=1`: TRUNCATE + CSV completo (legado).
   * Sem parâmetros: apaga só pares (numero_bfs, numero_cnc) que aparecem no arquivo e reinsere essas linhas.
   */
  fastify.post<{
    Querystring: {
      periodo_inicial?: string;
      periodo_final?: string;
      substituir_tudo?: string;
    };
  }>("/upload/cnc-detalhes-csv", async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ detail: "Arquivo CSV obrigatório (FLIP_CONSULTA_CNC)" });
    let buffer: Buffer;
    try {
      buffer = await data.toBuffer();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ detail: `Erro ao ler arquivo: ${msg}` });
    }
    const sourceFile = data.filename;
    let rows;
    try {
      rows = parseCncDetalhesCsv(buffer, sourceFile);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ detail: `Erro ao interpretar CSV (formato FLIP_CONSULTA_CNC esperado): ${msg}` });
    }

    const q = request.query;
    const substituirTudo = q.substituir_tudo === "1" || q.substituir_tudo === "true";

    const client = await pool.connect();
    try {
      const { inseridos } = await mergeImportCncDetalhes(client, rows, sourceFile, {
        substituirTudo,
        periodoInicial: q.periodo_inicial,
        periodoFinal: q.periodo_final,
      });
      invalidatePrefix("cnc");
      invalidatePrefix("cnc_defesa");
      invalidatePrefix("kpis");
      return {
        processados: inseridos,
        total: rows.length,
        inseridos,
        atualizados: 0,
        duplicados: 0,
        erros: 0,
        ultimo_import: new Date().toISOString(),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      fastify.log.error(err);
      return reply.code(500).send({ detail: `Erro ao importar CNC: ${msg}` });
    } finally {
      client.release();
    }
  });

  fastify.post("/upload/ouvidoria-csv", async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ detail: "Arquivo CSV obrigatório" });
    const buffer = await data.toBuffer();
    const sourceFile = data.filename;
    const rows = parseOuvidoriaCsv(buffer);

    const client = await pool.connect();
    try {
      let inserted = 0;
      for (const row of rows) {
        await client.query(`INSERT INTO ouvidoria (raw, source_file, updated_at) VALUES ($1, $2, NOW())`, [
          JSON.stringify(row),
          sourceFile,
        ]);
        inserted++;
      }
      return {
        processados: inserted,
        total: rows.length,
        inseridos: inserted,
        atualizados: 0,
        duplicados: 0,
        erros: 0,
        ultimo_import: new Date().toISOString(),
      };
    } finally {
      client.release();
    }
  });

  fastify.post("/upload/acic-csv", async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ detail: "Arquivo CSV obrigatório" });
    const buffer = await data.toBuffer();
    const sourceFile = data.filename;
    const rows = parseAcicCsv(buffer);

    const client = await pool.connect();
    try {
      let inserted = 0;
      for (const row of rows) {
        await client.query(`INSERT INTO acic (raw, source_file, updated_at) VALUES ($1, $2, NOW())`, [
          JSON.stringify(row),
          sourceFile,
        ]);
        await mergeAcicOverridesAfterImportRow(client, row as Record<string, unknown>);
        inserted++;
      }
      return {
        processados: inserted,
        total: rows.length,
        inseridos: inserted,
        atualizados: 0,
        duplicados: 0,
        erros: 0,
        ultimo_import: new Date().toISOString(),
      };
    } finally {
      client.release();
    }
  });

  fastify.post("/upload/ipt-historico-os", async (request, reply) => {
    try {
      return await importIptFile("ipt_historico_os", request);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Falha no upload IPT";
      return reply.code(400).send({ detail });
    }
  });

  fastify.post("/upload/ipt-historico-os-varricao", async (request, reply) => {
    try {
      return await importIptFile("ipt_historico_os_varricao", request);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Falha no upload IPT";
      return reply.code(400).send({ detail });
    }
  });

  fastify.post("/upload/ipt-historico-os-compactadores", async (request, reply) => {
    try {
      return await importIptFile("ipt_historico_os_compactadores", request);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Falha no upload IPT";
      return reply.code(400).send({ detail });
    }
  });

  fastify.post("/upload/ipt-consolidado-veiculos", async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ detail: "Arquivo obrigatorio" });
    const lower = data.filename.toLowerCase();
    if (!lower.endsWith(".xls") && !lower.endsWith(".xlsx")) {
      return reply.code(400).send({ detail: "Use planilha XLS ou XLSX." });
    }
    try {
      const buffer = await data.toBuffer();
      const summary = await importConsolidadoBuffer("ipt_consolidado_veiculos", buffer, data.filename);
      await recordUploadEvent("selimp", "iptConsolidadoVeiculos", data.filename, summary);
      return summary;
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Falha no upload";
      return reply.code(400).send({ detail });
    }
  });

  fastify.post("/upload/ipt-consolidado-varricao", async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ detail: "Arquivo obrigatorio" });
    const lower = data.filename.toLowerCase();
    if (!lower.endsWith(".xls") && !lower.endsWith(".xlsx")) {
      return reply.code(400).send({ detail: "Use planilha XLS ou XLSX." });
    }
    try {
      const buffer = await data.toBuffer();
      const summary = await importConsolidadoBuffer("ipt_consolidado_varricao", buffer, data.filename);
      await recordUploadEvent("selimp", "iptConsolidadoVarricao", data.filename, summary);
      return summary;
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Falha no upload";
      return reply.code(400).send({ detail });
    }
  });

  fastify.post<{
    Querystring: {
      mes_referencia?: string;
      modo_referencia?: string;
      periodo_inicial?: string;
      periodo_final?: string;
    };
  }>("/upload/ipt-report", async (request, reply) => {
    try {
      const query = request.query as {
        mes_referencia?: string;
        modo_referencia?: string;
        periodo_inicial?: string;
        periodo_final?: string;
      };
      const mesRef = query.mes_referencia;
      const modoRef = query.modo_referencia as ReportReferenceMode | undefined;
      const periodoInicial = query.periodo_inicial;
      const periodoFinal = query.periodo_final;
      // A planilha do report agora traz a data real por linha (coluna "Data planejada").
      // Quando nenhum período é informado, ele é derivado da própria planilha.
      const temPeriodoExplicito = Boolean(modoRef && periodoInicial && periodoFinal);

      const data = await request.file();
      if (!data) return reply.code(400).send({ detail: "Arquivo XLSX obrigatório" });
      const buffer = await data.toBuffer();
      const sourceFile = data.filename;
      const rows = parseIptWorkbook(buffer, "ipt_report_selimp");
      if (rows.length === 0) return reply.code(400).send({ detail: "Nenhum registro na planilha" });

      const ordens = extractOrdensFromReportRows(rows);

      let modoReferencia: ReportReferenceMode;
      let inicio: string;
      let fim: string;

      if (mesRef) {
        const match = mesRef.match(/^(\d{4})-(\d{2})$/);
        if (!match) {
          return reply.code(400).send({ detail: `mes_referencia inválido: "${mesRef}"` });
        }
        const ano = Number(match[1]);
        const mes = Number(match[2]);
        const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
        inicio = `${ano}-${String(mes).padStart(2, "0")}-01`;
        fim = `${ano}-${String(mes).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;
        modoReferencia = "mensal";
      } else if (temPeriodoExplicito) {
        // Caminho legado: período informado explicitamente (compatibilidade).
        if (modoRef !== "d_minus_1" && modoRef !== "fim_de_semana") {
          return reply.code(400).send({ detail: "modo_referencia inválido. Use d_minus_1 ou fim_de_semana." });
        }
        if (!isDateKey(periodoInicial!) || !isDateKey(periodoFinal!)) {
          return reply.code(400).send({ detail: "periodo_inicial e periodo_final devem estar no formato YYYY-MM-DD." });
        }
        if (periodoInicial! > periodoFinal!) {
          return reply.code(400).send({ detail: "periodo_inicial não pode ser maior que periodo_final." });
        }
        inicio = periodoInicial!;
        fim = periodoFinal!;
        modoReferencia = modoRef;
      } else {
        // Caminho padrão: deriva o período das datas reais da planilha (coluna "Data planejada").
        const datasPlanilha = Array.from(
          new Set(
            rows
              .map((row) => extrairDataPlanejadaRaw(row.raw ?? {}))
              .filter((d): d is string => !!d),
          ),
        ).sort();
        if (datasPlanilha.length === 0) {
          return reply.code(400).send({
            detail:
              "A planilha não possui a coluna de data (\"Data planejada\"). Não foi possível determinar o período automaticamente.",
          });
        }
        inicio = datasPlanilha[0];
        fim = datasPlanilha[datasPlanilha.length - 1];
        modoReferencia = inicio === fim ? "d_minus_1" : "fim_de_semana";
      }

      const referenciaLabel = describeReportReference(modoReferencia, inicio, fim);

      const linhasParaEstimar: ReportLinhaRaw[] = rows.map((row, idx) => {
        const raw = row.raw ?? {};
        const plano = normalizarSetor(String(raw.plano ?? "").trim()) || row.setor || "";
        const parsed = parseSetor(plano);
        let pct = toExecPercent(String(raw.de_execucao ?? raw.percentual_execucao ?? "").trim());
        if (pct != null && pct > 0 && pct <= 1) pct *= 100;
        return {
          plano,
          subprefeitura: String(raw.subprefeitura ?? raw.sub_prefeitura ?? "").trim(),
          tipo_servico: String(raw.tipo_de_servico ?? raw.tipo_servico ?? "").trim(),
          status: String(raw.status ?? "").trim(),
          percentual_execucao: pct,
          equipamentos: String(raw.equipamentos ?? "").trim(),
          raw,
          posicao_original: idx,
        };
      });

      const { linhas: linhasComData, stats: resolverStats } = await resolverDatasReport(
        linhasParaEstimar,
        inicio,
        fim
      );

      // Datas reais presentes na planilha (após resolução) — base para a sobrescrita.
      const datasNaPlanilha = Array.from(
        new Set(linhasComData.map((l) => l.data_estimada).filter((d): d is string => !!d)),
      );

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Sobrescrita: remove TUDO que já existe para as datas reais da planilha,
        // independentemente de como foram etiquetadas em importações anteriores
        // (evita dias "sumindo" e duplicação por períodos sobrepostos).
        if (datasNaPlanilha.length > 0) {
          await client.query(
            `DELETE FROM ipt_report_linhas WHERE data_estimada = ANY($1::date[])`,
            [datasNaPlanilha]
          );
        }
        // Limpa também eventuais linhas legadas sem data sob o mesmo período.
        await client.query(
          `DELETE FROM ipt_report_linhas
           WHERE periodo_inicial = $1::date AND periodo_final = $2::date AND periodo_tipo = $3`,
          [inicio, fim, modoReferencia]
        );

        let inserted = 0;
        for (const linha of linhasComData) {
          await client.query(
            `INSERT INTO ipt_report_linhas (
               plano, subprefeitura, tipo_servico, status, percentual_execucao, equipamentos,
               data_estimada, metodo_estimativa, confianca_estimativa, despacho_esperado,
               periodo_inicial, periodo_final, periodo_tipo, posicao_original,
               frequencia, servico_codigo, raw, source_file, updated_at
             ) VALUES (
               $1, $2, $3, $4, $5, $6,
               $7::date, $8, $9, $10,
               $11::date, $12::date, $13, $14,
               $15, $16, $17::jsonb, $18, NOW()
             )
             ON CONFLICT (plano, periodo_inicial, periodo_final, posicao_original)
             DO UPDATE SET
               subprefeitura = EXCLUDED.subprefeitura,
               tipo_servico = EXCLUDED.tipo_servico,
               status = EXCLUDED.status,
               percentual_execucao = EXCLUDED.percentual_execucao,
               equipamentos = EXCLUDED.equipamentos,
               data_estimada = EXCLUDED.data_estimada,
               metodo_estimativa = EXCLUDED.metodo_estimativa,
               confianca_estimativa = EXCLUDED.confianca_estimativa,
               despacho_esperado = EXCLUDED.despacho_esperado,
               periodo_tipo = EXCLUDED.periodo_tipo,
               frequencia = EXCLUDED.frequencia,
               servico_codigo = EXCLUDED.servico_codigo,
               raw = EXCLUDED.raw,
               source_file = EXCLUDED.source_file,
               updated_at = NOW()`,
            [
              linha.plano,
              linha.subprefeitura || null,
              linha.tipo_servico || null,
              linha.status || null,
              linha.percentual_execucao,
              linha.equipamentos || null,
              linha.data_estimada,
              linha.metodo_estimativa,
              linha.confianca_estimativa,
              linha.despacho_esperado,
              inicio,
              fim,
              modoReferencia,
              linha.posicao_original,
              linha.frequencia || null,
              linha.servico_codigo || null,
              JSON.stringify(linha.raw),
              sourceFile,
            ]
          );
          inserted += 1;
        }

        const snapshotsGerados = await rebuildIptServiceAccSnapshotsForRange(client, {
          periodoInicial: inicio,
          periodoFinal: fim,
          sourceFile,
        });
        const snapshotsIndicadores = await snapshotIndicadoresFromDb(client, {
          periodoInicial: inicio,
          periodoFinal: fim,
          periodoTipo: modoReferencia,
          sourceFile,
          includeIpt: true,
        });

        await client.query("COMMIT");
        invalidatePrefix("ipt_preview");
        invalidatePrefix("kpis");

        const encerradas = linhasComData.filter((l) => isReportStatusEncerrado(l.status)).length;
        const altaConfianca = linhasComData.filter((l) => l.confianca_estimativa === "alta").length;
        const mediaConfianca = linhasComData.filter((l) => l.confianca_estimativa === "media").length;
        const baixaConfianca = linhasComData.filter((l) => l.confianca_estimativa === "baixa").length;
        const estimadasCount = linhasComData.filter(
          (l) => l.metodo_estimativa !== "selimp_data_planejada"
        ).length;

        const result = {
          processados: inserted,
          total: rows.length,
          inseridos: inserted,
          atualizados: 0,
          duplicados: 0,
          erros: 0,
          ultimo_import: new Date().toISOString(),
          referencia_importada: referenciaLabel,
          modo_referencia: modoReferencia,
          periodo_inicial: inicio,
          periodo_final: fim,
          ordens_encerradas: encerradas,
          snapshots_servicos: snapshotsGerados,
          snapshots_indicadores: snapshotsIndicadores,
          source_file: sourceFile,
          estimativa: {
            com_data_selimp: resolverStats.com_data_selimp,
            estimadas: estimadasCount,
            despachos_inesperados: resolverStats.despachos_inesperados,
            fora_periodo: resolverStats.fora_periodo,
            alta_confianca: altaConfianca,
            media_confianca: mediaConfianca,
            baixa_confianca: baixaConfianca,
          },
        };
        await recordUploadEvent("selimp", "iptReport", sourceFile, result);
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Falha no upload IPT";
      return reply.code(400).send({ detail });
    }
  });

  fastify.post<{
    Querystring: { data_referencia?: string };
  }>("/upload/ipt-status-bateria", async (request, reply) => {
    const dataReferencia = String(request.query.data_referencia ?? "").trim();
    if (!dataReferencia || !isDateKey(dataReferencia)) {
      return reply.code(400).send({
        detail: "Informe data_referencia no formato YYYY-MM-DD (dia da exportação SELIMP).",
      });
    }

    const data = await request.file();
    if (!data) return reply.code(400).send({ detail: "Arquivo XLSX obrigatório" });
    const lower = data.filename.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
      return reply.code(400).send({ detail: "Aceita apenas arquivos XLSX/XLS." });
    }

    try {
      const buffer = await data.toBuffer();
      const rows = parseStatusBateria(buffer, dataReferencia);
      if (rows.length === 0) {
        throw new Error("Nenhum registro válido na planilha Status de Bateria.");
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Apaga todos os registros do mesmo dia antes de inserir (evita duplicatas no reupload)
        await client.query(
          `DELETE FROM ipt_dados_bateria WHERE data_exportacao = $1::date`,
          [dataReferencia]
        );

        let inseridos = 0;

        for (const row of rows) {
          const ultimaComunicacaoStr = row.ultimaComunicacao ? row.ultimaComunicacao.toISOString() : null;
          await client.query(
            `INSERT INTO ipt_dados_bateria (
              record_key, data_exportacao, nome, tipo_modulo,
              selimp_id, status_comunicacao,
              bateria_raw, bateria_percentual, bateria_desatualizada,
              ultima_comunicacao, source_file, updated_at
            ) VALUES (
              $1, $2::date, $3, $4,
              $5, $6,
              $7, $8, $9,
              $10, $11, NOW()
            )`,
            [
              row.recordKey,
              dataReferencia,
              row.nome,
              row.tipoModulo,
              row.selimpId || null,
              row.statusComunicacao || null,
              row.bateriaRaw || null,
              row.bateriaPercentual ?? null,
              row.bateriaDesatualizada,
              ultimaComunicacaoStr,
              data.filename,
            ]
          );
          inseridos++;
        }

        const { atualizados: enriquecidosSetores } = await enrichDadosBateriaFromSetoresModulos(client, {
          dataExportacao: dataReferencia,
        });
        const moduloSelimp = await refreshModuloSelimp(client);

        await client.query("COMMIT");
        invalidatePrefix("bateria");
        invalidatePrefix("ipt_dados_bateria");
        invalidatePrefix("ipt_modulos_bateria");
        invalidatePrefix("ipt_preview");

        const referenciaLabel = `Status Bateria (${dataReferencia})`;
        const summary = {
          processados: rows.length,
          total: rows.length,
          inseridos,
          atualizados: enriquecidosSetores,
          enriquecidos_setores: enriquecidosSetores,
          modulo_selimp_atualizados: moduloSelimp.atualizados,
          modulo_selimp_removidos: moduloSelimp.removidos,
          duplicados: 0,
          erros: 0,
          ultimo_import: new Date().toISOString(),
          source_file: data.filename,
          referencia_importada: referenciaLabel,
          periodo_inicial: dataReferencia,
          periodo_final: dataReferencia,
        };
        await recordUploadEvent("selimp", "iptStatusBateria", data.filename, summary);
        return summary;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Falha no upload";
      return reply.code(400).send({ detail });
    }
  });

  /**
   * Upload do arquivo histórico de bateria (múltiplas datas em coluna A).
   * Para cada data presente no arquivo: apaga os registros do dia e insere os novos.
   */
  fastify.post("/upload/ipt-historico-bateria", async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ detail: "Arquivo XLSX obrigatório" });
    const lower = data.filename.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
      return reply.code(400).send({ detail: "Aceita apenas arquivos XLSX/XLS." });
    }

    try {
      const buffer = await data.toBuffer();
      const rows = parseHistoricoBateria(buffer, data.filename);
      if (rows.length === 0) {
        throw new Error("Nenhum registro válido encontrado. Verifique se o arquivo contém coluna de data e nome.");
      }

      // Agrupa por data_exportacao (string YYYY-MM-DD)
      const porData = new Map<string, typeof rows>();
      for (const row of rows) {
        const dateKey = row.dataExportacao.toISOString().slice(0, 10);
        const bucket = porData.get(dateKey) ?? [];
        bucket.push(row);
        porData.set(dateKey, bucket);
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        let totalInseridos = 0;

        for (const [dateKey, dayRows] of porData) {
          // Limpa o dia antes de inserir
          await client.query(
            `DELETE FROM ipt_dados_bateria WHERE data_exportacao = $1::date`,
            [dateKey]
          );

          // Bulk insert: monta um único INSERT com todas as linhas do dia
          // para evitar N roundtrips ao banco (cada linha = 11 params)
          const COLS = 11;
          const values: unknown[] = [];
          const placeholders: string[] = [];

          dayRows.forEach((row, i) => {
            const base = i * COLS;
            placeholders.push(
              `($${base + 1}, $${base + 2}::date, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, NOW())`
            );
            values.push(
              row.recordKey,
              dateKey,
              row.nome,
              row.tipoModulo,
              row.selimpId || null,
              row.statusComunicacao || null,
              row.bateriaRaw || null,
              row.bateriaPercentual ?? null,
              row.bateriaDesatualizada,
              row.ultimaComunicacao ? row.ultimaComunicacao.toISOString() : null,
              data.filename,
            );
          });

          await client.query(
            `INSERT INTO ipt_dados_bateria (
              record_key, data_exportacao, nome, tipo_modulo,
              selimp_id, status_comunicacao,
              bateria_raw, bateria_percentual, bateria_desatualizada,
              ultima_comunicacao, source_file, updated_at
            ) VALUES ${placeholders.join(", ")}`,
            values
          );
          totalInseridos += dayRows.length;
        }

        const datasImportadas = [...porData.keys()].sort();
        const { atualizados: enriquecidosSetores } = await enrichDadosBateriaFromSetoresModulos(client, {
          dataExportacoes: datasImportadas,
        });
        const moduloSelimp = await refreshModuloSelimp(client);

        await client.query("COMMIT");
        invalidatePrefix("bateria");
        invalidatePrefix("ipt_dados_bateria");
        invalidatePrefix("ipt_modulos_bateria");
        invalidatePrefix("ipt_preview");
        const summary = {
          processados: rows.length,
          total: rows.length,
          inseridos: totalInseridos,
          atualizados: enriquecidosSetores,
          enriquecidos_setores: enriquecidosSetores,
          modulo_selimp_atualizados: moduloSelimp.atualizados,
          modulo_selimp_removidos: moduloSelimp.removidos,
          duplicados: 0,
          erros: 0,
          ultimo_import: new Date().toISOString(),
          source_file: data.filename,
          datas_importadas: datasImportadas,
          total_datas: datasImportadas.length,
        };
        await recordUploadEvent("selimp", "iptStatusBateria", data.filename, summary);
        return summary;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Falha no upload histórico de bateria";
      return reply.code(400).send({ detail });
    }
  });

  fastify.post("/upload/ipt-modulos-bateria", async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ detail: "Arquivo XLSX obrigatório" });
    const lower = data.filename.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
      return reply.code(400).send({ detail: "Aceita apenas arquivos XLSX/XLS." });
    }
    try {
      const buffer = await data.toBuffer();
      const rows = parseModulosBateriaWorkbook(buffer);
      if (rows.length === 0) throw new Error("Nenhum registro valido na planilha");

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`DELETE FROM ipt_imports WHERE file_type = 'ipt_modulos_bateria'`);

        let inserted = 0;
        for (const row of rows) {
          const recordKey = `${row.setor}|${row.numero_selimp || "sem_numero"}`;
          const raw: Record<string, unknown> = {
            subprefeitura: row.subprefeitura,
            numero_selimp: row.numero_selimp,
            dias_execucao: row.dias_execucao,
            comunicacao: row.comunicacao,
            bateria: row.bateria,
            bateria_percentual: row.bateria_percentual,
            ultima_comunicacao: row.ultima_comunicacao,
            status_sinal_geral: row.status_sinal_geral,
            status_bateria: row.status_bateria,
            data_instalacao: row.data_instalacao,
            quantidade_trocas: row.quantidade_trocas,
            dias_on: row.dias_on,
            dias_off: row.dias_off,
            produtividade: row.produtividade,
          };
          await client.query(
            `INSERT INTO ipt_imports (
              file_type, record_key, setor, data_referencia, servico, raw, source_file, updated_at
            ) VALUES ('ipt_modulos_bateria', $1, $2, NULL, NULL, $3::jsonb, $4, NOW())`,
            [recordKey, row.setor, JSON.stringify(raw), data.filename]
          );
          inserted++;
        }

        await client.query("COMMIT");
        invalidatePrefix("ipt_modulos_bateria");
        invalidatePrefix("kpis");

        const batchAt = new Date().toISOString();
        const summary = {
          processados: inserted,
          total: rows.length,
          inseridos: inserted,
          atualizados: 0,
          duplicados: 0,
          erros: 0,
          ultimo_import: batchAt,
          source_file: data.filename,
        };
        await recordUploadEvent("selimp", "iptModulosBateria", data.filename, summary);
        return summary;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Falha no upload";
      return reply.code(400).send({ detail });
    }
  });

  const getLastCronogramaUpdate = async () => {
    try {
      const info = await getLastCronogramaImport();
      return {
        ultimo_import: info.ultimo_import,
        source_file: info.source_file,
        total_registros: info.total_setores,
        total_datas: info.total_datas,
      };
    } catch {
      return { ultimo_import: null, source_file: null, total_registros: 0, total_datas: 0 };
    }
  };

  const getLastSetoresModulosUpdate = async () => {
    try {
      const last = await pool.query(
        `SELECT source_file, updated_at FROM setores_modulos ORDER BY updated_at DESC NULLS LAST LIMIT 1`
      );
      const count = await pool.query(`SELECT COUNT(*)::int AS total FROM setores_modulos`);
      return {
        ultimo_import: last.rows[0]?.updated_at ?? null,
        source_file: last.rows[0]?.source_file ?? null,
        total_registros: Number(count.rows[0]?.total ?? 0),
      };
    } catch {
      return { ultimo_import: null, source_file: null, total_registros: 0 };
    }
  };

  const getLastModulosBateriaUpdate = async () => getLastIptUpdate("ipt_modulos_bateria");

  const getLastStatusBateriaUpdate = async () => {
    try {
      const last = await pool.query(
        `SELECT source_file, updated_at, data_exportacao::text AS data_exportacao
         FROM ipt_dados_bateria
         ORDER BY updated_at DESC NULLS LAST, id DESC
         LIMIT 1`
      );
      const count = await pool.query(`SELECT COUNT(*)::int AS total FROM ipt_dados_bateria`);
      const r = last.rows[0];
      const dataRef = r?.data_exportacao ? String(r.data_exportacao).slice(0, 10) : null;
      return {
        ultimo_import: r?.updated_at ?? null,
        source_file: r?.source_file ?? null,
        total_registros: Number(count.rows[0]?.total ?? 0),
        ultima_referencia: dataRef ? `Status Bateria (${formatPtDateKey(dataRef)})` : null,
        periodo_inicial: dataRef,
        periodo_final: dataRef,
      };
    } catch {
      return { ultimo_import: null, source_file: null, total_registros: 0 };
    }
  };

  function formatPtDateKey(dateKey: string): string {
    const [y, m, d] = dateKey.split("-").map(Number);
    if (!y || !m || !d) return dateKey;
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("pt-BR", { timeZone: "UTC" });
  }

  /**
   * Importação anual do Cronograma do Plano de Trabalho.
   * Aceita as duas planilhas (Escalonados + Fixos) num único envio multipart.
   * Campo `dryRun` (default "true"): retorna o relatório do que aconteceria sem gravar.
   * Com `dryRun=false`: mescla datas, atualiza setores e remove (cascade) os ausentes.
   */
  fastify.post("/upload/cronograma", async (request, reply) => {
    const arquivos: CronogramaImportFile[] = [];
    let dryRun = true;
    let replaceDatas = false;
    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          if (!/\.xlsx?$/i.test(part.filename)) {
            // descarta o stream para não travar o multipart
            await part.toBuffer();
            return reply.code(400).send({ detail: `Arquivo inválido: ${part.filename}. Envie .xlsx.` });
          }
          arquivos.push({ filename: part.filename, buffer: await part.toBuffer() });
        } else if (part.fieldname === "dryRun") {
          dryRun = String((part as { value?: unknown }).value ?? "true").toLowerCase() !== "false";
        } else if (part.fieldname === "replaceDatas") {
          replaceDatas = String((part as { value?: unknown }).value ?? "false").toLowerCase() === "true";
        }
      }
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Falha ao ler os arquivos.";
      return reply.code(400).send({ detail });
    }

    if (arquivos.length === 0) {
      return reply.code(400).send({
        detail: "Envie as planilhas do cronograma (Escalonados e Fixos) em formato .xlsx.",
      });
    }

    try {
      const report = await reconcileCronograma(arquivos, { dryRun, replaceDatas });

      if (report.setores_arquivo === 0) {
        return reply.code(400).send({
          detail:
            "Nenhum setor válido extraído. Confira a aba 'Cronogramas' e as colunas (SETOR, DATA n ou DIA DA SEMANA).",
          ...report,
        });
      }

      if (!dryRun) {
        invalidatePrefix("ipt_preview");
        invalidatePrefix("kpis");
        const sourceFiles = report.por_arquivo.map((a) => a.arquivo).join(", ") || "cronograma";
        await pool
          .query(
            `INSERT INTO upload_events
               (session_key, upload_type, source_file, processados, total, inseridos, atualizados, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
            [
              "cronograma",
              "cronograma",
              sourceFiles,
              report.setores_arquivo,
              report.setores_arquivo,
              report.novos,
              report.atualizados,
              JSON.stringify(report),
            ],
          )
          .catch(() => {});
      }

      return report;
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Falha ao importar o cronograma.";
      return reply.code(400).send({ detail });
    }
  });

  /**
   * Substitui o cadastro em setores_modulos e recalcula modulo_selimp.
   * Não chama enrichDadosBateriaFromSetoresModulos — ipt_dados_bateria existente permanece intacto.
   */
  fastify.post("/upload/ipt-setores-modulos", async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ detail: "Arquivo XLSX obrigatório (SETORES.xlsx)" });
    }
    const buffer = await data.toBuffer();
    const sourceFile = data.filename;
    if (!/\.xlsx?$/i.test(sourceFile)) {
      return reply.code(400).send({ detail: "Formato inválido. Envie um arquivo .xlsx (SETORES.xlsx)." });
    }

    const parsed = parseSetoresModulosWorkbook(buffer);
    if (parsed.rows.length === 0) {
      return reply.code(400).send({
        detail:
          "Nenhum setor válido extraído. Verifique a aba SETORES e as colunas SETOR, SUBPREFEITURA, SERVIÇO, etc.",
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM setores_modulos");

      let inserted = 0;
      for (const row of parsed.rows) {
        const selimpDate = row.selimpInstalacao
          ? row.selimpInstalacao.toISOString().slice(0, 10)
          : null;
        const ddmxDate = row.ddmxInstalacao ? row.ddmxInstalacao.toISOString().slice(0, 10) : null;
        await client.query(
          `INSERT INTO setores_modulos (
            setor, subprefeitura, servico, frequencia, dias_execucao, km_prod,
            selimp_codigo, selimp_instalacao, ddmx_codigo, ddmx_instalacao,
            raw, source_file, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10::date, $11::jsonb, $12, NOW())`,
          [
            row.setor,
            row.subprefeitura,
            row.servico,
            row.frequencia,
            row.diasExecucao,
            row.kmProd,
            row.selimpCodigo,
            selimpDate,
            row.ddmxCodigo,
            ddmxDate,
            JSON.stringify(row.raw),
            sourceFile,
          ]
        );
        inserted += 1;
      }

      const moduloSelimp = await refreshModuloSelimp(client);
      await client.query("COMMIT");
      invalidatePrefix("ipt_modulos_bateria");
      invalidatePrefix("ipt_preview");
      return {
        processados: inserted,
        total: parsed.totalPlanilha,
        inseridos: inserted,
        atualizados: 0,
        duplicados: 0,
        erros: 0,
        ignoradas: parsed.ignoradas,
        ipt_dados_bateria_alterados: 0,
        modulo_selimp_atualizados: moduloSelimp.atualizados,
        modulo_selimp_removidos: moduloSelimp.removidos,
        ultimo_import: new Date().toISOString(),
        source_file: sourceFile,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  const getLastCncsUpdate = async () => {
    try {
      return await getLastUpdate("cncs");
    } catch {
      return { ultimo_import: null, source_file: null, total_registros: 0 };
    }
  };

  fastify.get("/upload/last-updates", async (_request, reply) => {
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate, private");
    reply.header("Pragma", "no-cache");
    const [
      sacs,
      cnc,
      acic,
      ouvidoria,
      cncsDetalhes,
      iptHistoricoOs,
      iptHistoricoOsVarricao,
      iptHistoricoOsCompactadores,
      ddmxVarricao,
      ddmxCompactadores,
      ddmxLight,
      iptReport,
      iptStatusBateria,
      iptCronograma,
      iptSetoresModulos,
      iptConsolidadoVeiculos,
      iptConsolidadoVarricao,
      iptModulosBateria,
      dashboardOntemRow,
    ] = await Promise.all([
      getLastUpdate("sacs"),
      getLastUpdate("bfs"),
      getLastUpdate("acic"),
      getLastUpdate("ouvidoria"),
      getLastCncsUpdate(),
      getLastIptUpdate("ipt_historico_os"),
      getLastIptUpdate("ipt_historico_os_varricao"),
      getLastIptUpdate("ipt_historico_os_compactadores"),
      getLastDdmxUpdate("ddmx_varricao"),
      getLastDdmxUpdate("ddmx_veiculos_compactadores"),
      getLastDdmxUpdate("ddmx_veiculos_light"),
      getLastIptUpdate("ipt_report_selimp"),
      getLastStatusBateriaUpdate(),
      getLastCronogramaUpdate(),
      getLastSetoresModulosUpdate(),
      getLastIptUpdate("ipt_consolidado_veiculos"),
      getLastIptUpdate("ipt_consolidado_varricao"),
      getLastModulosBateriaUpdate(),
      pool
        .query<{
          ontem_brt: string;
          flip_cobre_ontem: boolean;
          ipt_report_cobre_ontem: boolean;
        }>(
          `WITH ref AS (
             SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date - 1 AS d
           )
           SELECT
             TO_CHAR(ref.d, 'YYYY-MM-DD') AS ontem_brt,
             (
               EXISTS (
                 SELECT 1 FROM bfs b, ref
                 WHERE (
                   (b.data_fiscalizacao IS NOT NULL
                     AND (b.data_fiscalizacao AT TIME ZONE 'America/Sao_Paulo')::date = ref.d)
                   OR (b.data_vistoria IS NOT NULL
                     AND (b.data_vistoria AT TIME ZONE 'America/Sao_Paulo')::date = ref.d)
                 )
               )
               OR EXISTS (
                 SELECT 1 FROM cncs c, ref
                 WHERE (
                   (c.data_fiscalizacao IS NOT NULL
                     AND (c.data_fiscalizacao AT TIME ZONE 'America/Sao_Paulo')::date = ref.d)
                   OR (c.data_execucao IS NOT NULL
                     AND (c.data_execucao AT TIME ZONE 'America/Sao_Paulo')::date = ref.d)
                   OR (c.data_sincronizacao IS NOT NULL
                     AND (c.data_sincronizacao AT TIME ZONE 'America/Sao_Paulo')::date = ref.d)
                 )
               )
               OR EXISTS (
                 SELECT 1 FROM sacs s, ref
                 WHERE s.data_registro IS NOT NULL
                   AND (s.data_registro AT TIME ZONE 'America/Sao_Paulo')::date = ref.d
               )
             ) AS flip_cobre_ontem,
             (
               EXISTS (
                 SELECT 1 FROM ipt_report_linhas r, ref
                 WHERE ref.d BETWEEN r.periodo_inicial AND r.periodo_final
               )
               OR EXISTS (
                 SELECT 1 FROM ipt_report_linhas r, ref
                 WHERE r.data_estimada IS NOT NULL AND r.data_estimada = ref.d
               )
             ) AS ipt_report_cobre_ontem
           FROM ref`
        )
        .then((r) => r.rows[0]),
    ]);
    const [flipSession, ddmxSession, selimpSession] = await Promise.all([
      getSessionOverview("flip", {
        ultimo_import:
          cncsDetalhes.ultimo_import ??
          cnc.ultimo_import ??
          sacs.ultimo_import ??
          ouvidoria.ultimo_import ??
          acic.ultimo_import ??
          null,
        source_file:
          cncsDetalhes.source_file ??
          cnc.source_file ??
          sacs.source_file ??
          ouvidoria.source_file ??
          acic.source_file ??
          null,
        total_registros:
          Number(cncsDetalhes.total_registros ?? 0) +
          Number(cnc.total_registros ?? 0) +
          Number(sacs.total_registros ?? 0) +
          Number(ouvidoria.total_registros ?? 0) +
          Number(acic.total_registros ?? 0),
      }),
      getSessionOverview("ddmx", {
        ultimo_import:
          ddmxCompactadores.ultimo_import ??
          ddmxVarricao.ultimo_import ??
          ddmxLight.ultimo_import ??
          iptHistoricoOsCompactadores.ultimo_import ??
          iptHistoricoOsVarricao.ultimo_import ??
          iptHistoricoOs.ultimo_import ??
          null,
        source_file:
          ddmxCompactadores.source_file ??
          ddmxVarricao.source_file ??
          ddmxLight.source_file ??
          iptHistoricoOsCompactadores.source_file ??
          iptHistoricoOsVarricao.source_file ??
          iptHistoricoOs.source_file ??
          null,
        total_registros:
          Number(ddmxVarricao.total_registros ?? 0) +
          Number(ddmxCompactadores.total_registros ?? 0) +
          Number(ddmxLight.total_registros ?? 0) +
          Number(iptHistoricoOs.total_registros ?? 0) +
          Number(iptHistoricoOsVarricao.total_registros ?? 0) +
          Number(iptHistoricoOsCompactadores.total_registros ?? 0),
      }),
      getSessionOverview("selimp", {
        ultimo_import: iptReport.ultimo_import ?? iptStatusBateria.ultimo_import ?? null,
        source_file: iptReport.source_file ?? iptStatusBateria.source_file ?? null,
        total_registros: Number(iptReport.total_registros ?? 0) + Number(iptStatusBateria.total_registros ?? 0),
      }),
    ]);

    const ontemBrt = String(dashboardOntemRow?.ontem_brt ?? "").trim();
    const flipCobreOntem = Boolean(dashboardOntemRow?.flip_cobre_ontem);
    /** Qualquer linha do Report SELIMP cujo período cubra D-1 BRT (não só a última linha por updated_at). */
    const iptReportCobreOntem = Boolean(dashboardOntemRow?.ipt_report_cobre_ontem);

    return {
      sacs,
      cnc,
      acic,
      ouvidoria,
      cncsDetalhes,
      iptHistoricoOs,
      iptHistoricoOsVarricao,
      iptHistoricoOsCompactadores,
      ddmxVarricao,
      ddmxCompactadores,
      ddmxLight,
      iptReport,
      iptStatusBateria,
      iptCronograma,
      iptSetoresModulos,
      iptConsolidadoVeiculos,
      iptConsolidadoVarricao,
      iptModulosBateria,
      sessions: {
        flip: flipSession,
        ddmx: ddmxSession,
        selimp: selimpSession,
      },
      dashboard_import_check: {
        data_referencia_ontem_brt: ontemBrt || null,
        flip_cobre_ontem: flipCobreOntem,
        ipt_report_cobre_ontem: iptReportCobreOntem,
        precisa_upload: !(flipCobreOntem && iptReportCobreOntem),
      },
    };
  });

  fastify.post("/upload/clear-sacs", async (_request, reply) => {
    const r = await pool.query("DELETE FROM sacs WHERE source_file IS NOT NULL RETURNING id");
    invalidatePrefix("sacs");
    invalidatePrefix("kpis");
    return { deleted: r.rowCount ?? 0 };
  });

  fastify.post("/upload/clear-cnc", async (_request, reply) => {
    const r = await pool.query("DELETE FROM bfs RETURNING id");
    invalidatePrefix("cnc");
    invalidatePrefix("kpis");
    return { deleted: r.rowCount ?? 0 };
  });

  fastify.post("/upload/clear-ouvidoria", async (_request, reply) => {
    const r = await pool.query("DELETE FROM ouvidoria RETURNING id");
    return { deleted: r.rowCount ?? 0 };
  });

  fastify.post("/upload/clear-acic", async (_request, reply) => {
    const r = await pool.query("DELETE FROM acic RETURNING id");
    return { deleted: r.rowCount ?? 0 };
  });

  fastify.post("/upload/clear-ipt-report", async (_request, reply) => {
    const r = await pool.query("DELETE FROM ipt_report_linhas RETURNING id");
    await pool.query("DELETE FROM ipt_imports WHERE file_type = 'ipt_report_selimp'").catch(() => {});
    invalidatePrefix("ipt_preview");
    invalidatePrefix("kpis");
    return { deleted: r.rowCount ?? 0 };
  });

  fastify.post("/upload/rebuild-ipt-service-snapshots", async (_request, reply) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await rebuildAllIptServiceAccSnapshots(client);
      await client.query("COMMIT");
      invalidatePrefix("ipt_preview");
      invalidatePrefix("kpis");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      const detail = error instanceof Error ? error.message : "Falha ao recriar snapshots acumulados de serviço.";
      return reply.code(500).send({ detail });
    } finally {
      client.release();
    }
  });

  fastify.post<{
    Querystring: { periodo_inicial?: string; periodo_final?: string };
  }>("/upload/clear-ipt-report-periodo", async (request, reply) => {
    const { periodo_inicial, periodo_final } = request.query;
    if (!periodo_inicial || !periodo_final) {
      return reply.code(400).send({ detail: "Informe periodo_inicial e periodo_final (YYYY-MM-DD)." });
    }
    const r = await pool.query(
      `DELETE FROM ipt_report_linhas
       WHERE periodo_inicial = $1::date AND periodo_final = $2::date
       RETURNING id`,
      [periodo_inicial, periodo_final]
    );
    invalidatePrefix("ipt_preview");
    invalidatePrefix("kpis");
    return { deleted: r.rowCount ?? 0, periodo_inicial, periodo_final };
  });

  /** Remove Historico OS DDMX (todas as variantes) de ipt_imports + novas tabelas. */
  fastify.post("/upload/clear-ipt-ddmx", async (_request, reply) => {
    const r1 = await pool.query(
      `DELETE FROM ipt_imports WHERE file_type IN ('ipt_historico_os', 'ipt_historico_os_varricao', 'ipt_historico_os_compactadores') RETURNING id`
    );
    const r2 = await pool.query(`DELETE FROM ipt_ddmx_varricao RETURNING id`);
    const r3 = await pool.query(`DELETE FROM ipt_ddmx_veiculos RETURNING id`);
    invalidatePrefix("ipt_preview");
    invalidatePrefix("kpis");
    return { deleted: (r1.rowCount ?? 0) + (r2.rowCount ?? 0) + (r3.rowCount ?? 0) };
  });

  fastify.post("/upload/clear-ddmx-varricao", async (_request, reply) => {
    const r = await pool.query(`DELETE FROM ipt_ddmx_varricao RETURNING id`);
    invalidatePrefix("ipt_preview");
    invalidatePrefix("kpis");
    return { deleted: r.rowCount ?? 0 };
  });

  fastify.post("/upload/clear-ddmx-compactadores", async (_request, reply) => {
    const r = await pool.query(`DELETE FROM ipt_ddmx_veiculos WHERE subtipo = 'compactadores' RETURNING id`);
    invalidatePrefix("ipt_preview");
    invalidatePrefix("kpis");
    return { deleted: r.rowCount ?? 0 };
  });

  fastify.post("/upload/clear-ddmx-light", async (_request, reply) => {
    const r = await pool.query(`DELETE FROM ipt_ddmx_veiculos WHERE subtipo = 'light' RETURNING id`);
    invalidatePrefix("ipt_preview");
    invalidatePrefix("kpis");
    return { deleted: r.rowCount ?? 0 };
  });

  fastify.post("/upload/clear-ipt-consolidado-veiculos", async (_request, reply) => {
    const r = await pool.query(`DELETE FROM ipt_imports WHERE file_type = 'ipt_consolidado_veiculos' RETURNING id`);
    invalidatePrefix("ipt_preview");
    invalidatePrefix("kpis");
    return { deleted: r.rowCount ?? 0 };
  });

  fastify.post("/upload/clear-ipt-consolidado-varricao", async (_request, reply) => {
    const r = await pool.query(`DELETE FROM ipt_imports WHERE file_type = 'ipt_consolidado_varricao' RETURNING id`);
    invalidatePrefix("ipt_preview");
    invalidatePrefix("kpis");
    return { deleted: r.rowCount ?? 0 };
  });

  fastify.post("/upload/clear-ipt-modulos-bateria", async (_request, reply) => {
    const r = await pool.query(`DELETE FROM ipt_imports WHERE file_type = 'ipt_modulos_bateria' RETURNING id`);
    invalidatePrefix("ipt_modulos_bateria");
    invalidatePrefix("kpis");
    return { deleted: r.rowCount ?? 0 };
  });

  /** Esvazia ipt_dados_bateria e reinicia o serial id (próximo import começa em 1). */
  fastify.post("/upload/clear-ipt-dados-bateria", async (_request, reply) => {
    const countBefore = await pool.query(`SELECT COUNT(*)::int AS total FROM ipt_dados_bateria`);
    const client = await pool.connect();
    let moduloSelimp = { atualizados: 0, removidos: 0 };
    try {
      await client.query("BEGIN");
      await client.query(`TRUNCATE TABLE ipt_dados_bateria RESTART IDENTITY`);
      moduloSelimp = await refreshModuloSelimp(client);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    invalidatePrefix("bateria");
    invalidatePrefix("ipt_dados_bateria");
    invalidatePrefix("ipt_modulos_bateria");
    invalidatePrefix("ipt_preview");
    return {
      deleted: Number(countBefore.rows[0]?.total ?? 0),
      modulo_selimp_atualizados: moduloSelimp.atualizados,
      modulo_selimp_removidos: moduloSelimp.removidos,
      sequence_reset: true,
    };
  });

  /** Remove registros manuais de IPT (ipt_registros). Não utilizado mais – IPT vem da planilha ou oficial. */
  fastify.post("/upload/clear-ipt-registros", async (_request, reply) => {
    const r = await pool.query("DELETE FROM ipt_registros RETURNING id");
    invalidatePrefix("kpis");
    return { deleted: r.rowCount ?? 0 };
  });

  /**
   * Migra dados existentes de ipt_imports para as novas tabelas dedicadas.
   * Idempotente: insere apenas linhas que ainda nao existem.
   */
  fastify.post("/upload/migrar-ipt-tabelas", async (_request, reply) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const stats = { report: 0 };

      // 1. Migrar ipt_report_selimp -> ipt_report_linhas
      const reportRows = await client.query(
        `SELECT raw, setor, data_referencia, source_file, created_at, updated_at
         FROM ipt_imports
         WHERE file_type = 'ipt_report_selimp'
         ORDER BY id`
      );
      for (let i = 0; i < reportRows.rows.length; i++) {
        const row = reportRows.rows[i];
        const raw = (row.raw ?? {}) as Record<string, unknown>;
        const plano = normalizarSetor(String(raw.plano ?? row.setor ?? "").trim());
        if (!plano) continue;
        const parsed = parseSetor(plano);
        const periodoTipo = String(raw._periodo_tipo ?? "mensal");
        const periodoInicial = String(raw._periodo_inicial_referencia ?? row.data_referencia?.toISOString().slice(0, 10) ?? "2026-01-01");
        const periodoFinal = String(raw._periodo_final_referencia ?? row.data_referencia?.toISOString().slice(0, 10) ?? "2026-01-31");
        let pct: number | null = null;
        const rawPct = String(raw.de_execucao ?? raw.percentual_execucao ?? "").replace(",", ".").replace("%", "").trim();
        if (rawPct) {
          const n = Number(rawPct);
          if (Number.isFinite(n)) pct = n;
        }
        await client.query(
          `INSERT INTO ipt_report_linhas (
            plano, subprefeitura, tipo_servico, status, percentual_execucao, equipamentos,
            data_estimada, metodo_estimativa, confianca_estimativa,
            periodo_inicial, periodo_final, periodo_tipo, posicao_original,
            frequencia, servico_codigo, raw, source_file, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11::date,$12,$13,$14,$15,$16::jsonb,$17,NOW())
          ON CONFLICT (plano, periodo_inicial, periodo_final, posicao_original) DO NOTHING`,
          [
            plano,
            String(raw.subprefeitura ?? raw.sub_prefeitura ?? "").trim() || null,
            String(raw.tipo_de_servico ?? raw.tipo_servico ?? "").trim() || null,
            String(raw.status ?? "").trim() || null,
            pct,
            String(raw.equipamentos ?? "").trim() || null,
            row.data_referencia ? row.data_referencia.toISOString().slice(0, 10) : null,
            String(raw._metodo_data_referencia ?? "migrado_ipt_imports"),
            "baixa",
            periodoInicial,
            periodoFinal,
            periodoTipo,
            i,
            parsed?.frequencia || null,
            parsed?.servico || null,
            JSON.stringify(raw),
            row.source_file,
          ]
        );
        stats.report += 1;
      }

      // 2. Migrar DDMX historico_os -> ipt_ddmx_veiculos (subtipo light)
      const ddmxLightRows = await client.query(
        `SELECT record_key, setor, data_referencia, servico, raw, source_file
         FROM ipt_imports WHERE file_type = 'ipt_historico_os'`
      );
      let ddmxLightCount = 0;
      for (const row of ddmxLightRows.rows) {
        await client.query(
          `INSERT INTO ipt_ddmx_veiculos (subtipo, record_key, setor, data_referencia, servico, raw, source_file, updated_at)
           VALUES ('light', $1, $2, $3, $4, $5::jsonb, $6, NOW())
           ON CONFLICT (subtipo, record_key) DO NOTHING`,
          [row.record_key, row.setor, row.data_referencia, row.servico, JSON.stringify(row.raw), row.source_file]
        );
        ddmxLightCount += 1;
      }

      // 3. Migrar DDMX historico_os_compactadores -> ipt_ddmx_veiculos (subtipo compactadores)
      const ddmxCompRows = await client.query(
        `SELECT record_key, setor, data_referencia, servico, raw, source_file
         FROM ipt_imports WHERE file_type = 'ipt_historico_os_compactadores'`
      );
      let ddmxCompCount = 0;
      for (const row of ddmxCompRows.rows) {
        await client.query(
          `INSERT INTO ipt_ddmx_veiculos (subtipo, record_key, setor, data_referencia, servico, raw, source_file, updated_at)
           VALUES ('compactadores', $1, $2, $3, $4, $5::jsonb, $6, NOW())
           ON CONFLICT (subtipo, record_key) DO NOTHING`,
          [row.record_key, row.setor, row.data_referencia, row.servico, JSON.stringify(row.raw), row.source_file]
        );
        ddmxCompCount += 1;
      }

      // 4. Migrar DDMX historico_os_varricao -> ipt_ddmx_varricao
      const ddmxVarrRows = await client.query(
        `SELECT record_key, setor, data_referencia, servico, raw, source_file
         FROM ipt_imports WHERE file_type = 'ipt_historico_os_varricao'`
      );
      let ddmxVarrCount = 0;
      for (const row of ddmxVarrRows.rows) {
        await client.query(
          `INSERT INTO ipt_ddmx_varricao (record_key, setor, data_referencia, servico, raw, source_file, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW())
           ON CONFLICT (record_key) DO NOTHING`,
          [row.record_key, row.setor, row.data_referencia, row.servico, JSON.stringify(row.raw), row.source_file]
        );
        ddmxVarrCount += 1;
      }

      await client.query("COMMIT");
      invalidatePrefix("ipt_preview");
      invalidatePrefix("kpis");
      return {
        ok: true,
        migrados: {
          ...stats,
          ddmx_light: ddmxLightCount,
          ddmx_compactadores: ddmxCompCount,
          ddmx_varricao: ddmxVarrCount,
        },
        mensagem: `Migrados: ${stats.report} report, ${ddmxLightCount} ddmx light, ${ddmxCompCount} ddmx compactadores, ${ddmxVarrCount} ddmx varricao. Consolidado e modulos bateria permanecem em ipt_imports.`,
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  });
};
