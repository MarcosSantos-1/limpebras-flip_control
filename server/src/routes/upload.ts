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
import { parseCronogramaWorkbook } from "../services/parseCronogramaIpt.js";
import { normalizarSetor, parseSetor } from "../constants/ipt.js";
import { parseConsolidadoVeiculos, parseConsolidadoVarricao } from "../services/parseRelatorioConsolidado.js";
import { estimarDatasReport, type ReportLinhaRaw } from "../services/estimarDataReport.js";
import { mergeAcicOverridesAfterImportRow } from "../services/acicImportMerge.js";
import { parseModulosBateriaWorkbook } from "../services/parseModulosBateria.js";
import { requirePageAccess } from "../auth.js";

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
    if (!ensureIptRestrictedUploadAccess(request, reply, ["/upload/ipt-modulos-bateria", "/upload/last-updates"])) {
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

  const getLastIptUpdate = async (fileType: IptFileType | "ipt_consolidado_veiculos" | "ipt_consolidado_varricao") => {
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
    if (fileType === "ipt_consolidado_veiculos") {
      const last = await pool.query(
        `SELECT source_file, updated_at FROM ipt_consolidado_veiculos_dados ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`
      );
      const count = await pool.query(`SELECT COUNT(*)::int AS total FROM ipt_consolidado_veiculos_dados`);
      return {
        ultimo_import: last.rows[0]?.updated_at ?? null,
        source_file: last.rows[0]?.source_file ?? null,
        total_registros: Number(count.rows[0]?.total ?? 0),
      };
    }
    if (fileType === "ipt_consolidado_varricao") {
      const last = await pool.query(
        `SELECT source_file, updated_at FROM ipt_consolidado_varricao_dados ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`
      );
      const count = await pool.query(`SELECT COUNT(*)::int AS total FROM ipt_consolidado_varricao_dados`);
      return {
        ultimo_import: last.rows[0]?.updated_at ?? null,
        source_file: last.rows[0]?.source_file ?? null,
        total_registros: Number(count.rows[0]?.total ?? 0),
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

      if (fileType === "ipt_consolidado_veiculos") {
        const parsed = parseConsolidadoVeiculos(buffer);
        parse_stats = { ...parsed.stats };
        if (parsed.rows.length === 0) throw new Error("Nenhum registro valido na planilha");

        await client.query(`DELETE FROM ipt_consolidado_veiculos_dados WHERE TRUE`);
        let inserted = 0;
        for (const row of parsed.rows) {
          const raw = row.raw as Record<string, unknown>;
          await client.query(
            `INSERT INTO ipt_consolidado_veiculos_dados (
              placa, operacao, motorista, setor, data_referencia,
              liberacao, saida, status, retorno, tempo_trabalho,
              percentual_limpebras, percentual_selimp,
              raw, source_file, updated_at
            ) VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, NOW())`,
            [
              String(raw.placa_liberada ?? "").trim() || null,
              String(raw.operacao ?? "").trim() || null,
              String(raw.motorista ?? "").trim() || null,
              row.setor,
              row.dataReferencia,
              String(raw.liberacao ?? "").trim() || null,
              String(raw.saida ?? "").trim() || null,
              String(raw.status ?? "").trim() || null,
              String(raw.retorno ?? "").trim() || null,
              String(raw.tempo_trabalho ?? "").trim() || null,
              typeof raw.percentual_limpebras === "number" ? raw.percentual_limpebras : null,
              typeof raw.percentual_selimp === "number" ? raw.percentual_selimp : null,
              JSON.stringify(raw),
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
          total: parsed.rows.length,
          inseridos: inserted,
          atualizados: 0,
          duplicados: 0,
          erros: 0,
          ultimo_import: new Date().toISOString(),
          source_file: sourceFile,
          parse_stats,
        };
      }

      const rows = parseConsolidadoVarricao(buffer);
      if (rows.length === 0) throw new Error("Nenhum registro valido na planilha");

      await client.query(`DELETE FROM ipt_consolidado_varricao_dados WHERE TRUE`);
      let inserted = 0;
      for (const row of rows) {
        const raw = row.raw as Record<string, unknown>;
        await client.query(
          `INSERT INTO ipt_consolidado_varricao_dados (
            setor, frequencia_rotulo, data_referencia,
            percentual_selimp, percentual_ddmx,
            raw, source_file, updated_at
          ) VALUES ($1, $2, $3::date, $4, $5, $6::jsonb, $7, NOW())`,
          [
            row.setor,
            String(raw.frequencia_rotulo ?? "").trim() || null,
            row.dataReferencia,
            typeof raw.percentual_selimp === "number" ? raw.percentual_selimp : null,
            typeof raw.percentual_ddmx === "number" ? raw.percentual_ddmx : null,
            JSON.stringify(raw),
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
        total: rows.length,
        inseridos: inserted,
        atualizados: 0,
        duplicados: 0,
        erros: 0,
        ultimo_import: new Date().toISOString(),
        source_file: sourceFile,
        parse_stats,
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

      if (!mesRef && (!modoRef || !periodoInicial || !periodoFinal)) {
        return reply.code(400).send({
          detail: "Informe mes_referencia (YYYY-MM) ou modo_referencia + periodo_inicial + periodo_final.",
        });
      }

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
      } else {
        if ((modoRef !== "d_minus_1" && modoRef !== "fim_de_semana") || !periodoInicial || !periodoFinal) {
          return reply.code(400).send({ detail: "modo_referencia inválido. Use d_minus_1 ou fim_de_semana." });
        }
        if (!isDateKey(periodoInicial) || !isDateKey(periodoFinal)) {
          return reply.code(400).send({ detail: "periodo_inicial e periodo_final devem estar no formato YYYY-MM-DD." });
        }
        if (periodoInicial > periodoFinal) {
          return reply.code(400).send({ detail: "periodo_inicial não pode ser maior que periodo_final." });
        }
        inicio = periodoInicial;
        fim = periodoFinal;
        modoReferencia = modoRef;
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

      const linhasComData = await estimarDatasReport(linhasParaEstimar, inicio, fim);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

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
               data_estimada, metodo_estimativa, confianca_estimativa,
               periodo_inicial, periodo_final, periodo_tipo, posicao_original,
               frequencia, servico_codigo, raw, source_file, updated_at
             ) VALUES (
               $1, $2, $3, $4, $5, $6,
               $7::date, $8, $9,
               $10::date, $11::date, $12, $13,
               $14, $15, $16::jsonb, $17, NOW()
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

        await client.query("COMMIT");
        invalidatePrefix("ipt_preview");
        invalidatePrefix("kpis");

        const encerradas = linhasComData.filter(
          (l) => l.status.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes("encerrado")
        ).length;
        const altaConfianca = linhasComData.filter((l) => l.confianca_estimativa === "alta").length;
        const mediaConfianca = linhasComData.filter((l) => l.confianca_estimativa === "media").length;
        const baixaConfianca = linhasComData.filter((l) => l.confianca_estimativa === "baixa").length;

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
          source_file: sourceFile,
          estimativa: {
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

  fastify.post("/upload/ipt-status-bateria", async (request, reply) => {
    try {
      const result = await importIptFile("ipt_status_bateria", request);
      await recordUploadEvent("selimp", "iptStatusBateria", String(result.source_file ?? ""), result);
      return result;
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Falha no upload IPT";
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

        // Create a new batch record for this import snapshot
        const batchResult = await client.query<{ id: string }>(
          `INSERT INTO ipt_modulos_bateria_batches (source_file, total_registros)
           VALUES ($1, $2) RETURNING id`,
          [data.filename, rows.length]
        );
        const batchId = batchResult.rows[0].id;

        let inserted = 0;
        for (const row of rows) {
          const raw: Record<string, unknown> = {
            comunicacao: row.comunicacao,
            bateria_percentual: row.bateria_percentual,
            status_sinal_geral: row.status_sinal_geral,
            status_bateria: row.status_bateria,
            data_instalacao: row.data_instalacao,
            quantidade_trocas: row.quantidade_trocas,
            dias_on: row.dias_on,
            dias_off: row.dias_off,
            produtividade: row.produtividade,
          };
          await client.query(
            `INSERT INTO ipt_modulos_bateria (
              subprefeitura, setor, numero_selimp, dias_execucao,
              ultima_comunicacao, bateria, raw, source_file, batch_id, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, NOW())`,
            [
              row.subprefeitura || null,
              row.setor,
              row.numero_selimp || null,
              row.dias_execucao || null,
              row.ultima_comunicacao,
              row.bateria || null,
              JSON.stringify(raw),
              data.filename,
              batchId,
            ]
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
          batch_id: batchId,
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
    const last = await pool.query(
      `SELECT source_file, updated_at FROM ipt_cronograma ORDER BY updated_at DESC NULLS LAST LIMIT 1`
    );
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM ipt_cronograma`);
    return {
      ultimo_import: last.rows[0]?.updated_at ?? null,
      source_file: last.rows[0]?.source_file ?? null,
      total_registros: Number(count.rows[0]?.total ?? 0),
    };
  };

  const getLastModulosBateriaUpdate = async () => {
    try {
      const last = await pool.query(
        `SELECT id, source_file, imported_at, total_registros
         FROM ipt_modulos_bateria_batches ORDER BY imported_at DESC NULLS LAST LIMIT 1`
      );
      return {
        ultimo_import: last.rows[0]?.imported_at ?? null,
        source_file: last.rows[0]?.source_file ?? null,
        total_registros: Number(last.rows[0]?.total_registros ?? 0),
        batch_id: last.rows[0]?.id ?? null,
      };
    } catch {
      return { ultimo_import: null, source_file: null, total_registros: 0, batch_id: null };
    }
  };

  fastify.post("/upload/ipt-cronograma", async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ detail: "Arquivo XLSX obrigatório (BL.xlsx, MT.xlsx, NH.xlsx, LM.xlsx ou GO.xlsx)" });
    const buffer = await data.toBuffer();
    const sourceFile = data.filename;
    const rows = parseCronogramaWorkbook(buffer, sourceFile);
    if (rows.length === 0) {
      return reply.code(400).send({
        detail: "Nenhum registro extraído. Use BL.xlsx, MT.xlsx, NH.xlsx, LM.xlsx ou GO.xlsx com estrutura esperada.",
      });
    }

    const servico = rows[0]?.servico;
    const client = await pool.connect();
    try {
      await client.query("DELETE FROM ipt_cronograma WHERE servico = $1", [servico]);

      let inserted = 0;
      for (const row of rows) {
        const dataStr = row.dataEsperada.toISOString().slice(0, 10);
        await client.query(
          `INSERT INTO ipt_cronograma (servico, setor, data_esperada, ano, raw, source_file, updated_at)
           VALUES ($1, $2, $3::date, $4, $5::jsonb, $6, NOW())
           ON CONFLICT (servico, setor, data_esperada)
           DO UPDATE SET raw = EXCLUDED.raw, source_file = EXCLUDED.source_file, updated_at = NOW()`,
          [row.servico, row.setor, dataStr, row.ano ?? null, JSON.stringify(row.raw), sourceFile]
        );
        inserted += 1;
      }
      invalidatePrefix("ipt_preview");
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
      getLastIptUpdate("ipt_status_bateria"),
      getLastCronogramaUpdate(),
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
    await pool.query("DELETE FROM ipt_selimp_mensal RETURNING ano, mes").catch(() => {});
    await pool.query("DELETE FROM ipt_imports WHERE file_type = 'ipt_report_selimp'").catch(() => {});
    invalidatePrefix("ipt_preview");
    invalidatePrefix("kpis");
    return { deleted: r.rowCount ?? 0 };
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
    const r = await pool.query(`DELETE FROM ipt_consolidado_veiculos_dados RETURNING id`);
    await pool.query(`DELETE FROM ipt_imports WHERE file_type = 'ipt_consolidado_veiculos'`).catch(() => {});
    invalidatePrefix("ipt_preview");
    invalidatePrefix("kpis");
    return { deleted: r.rowCount ?? 0 };
  });

  fastify.post("/upload/clear-ipt-consolidado-varricao", async (_request, reply) => {
    const r = await pool.query(`DELETE FROM ipt_consolidado_varricao_dados RETURNING id`);
    await pool.query(`DELETE FROM ipt_imports WHERE file_type = 'ipt_consolidado_varricao'`).catch(() => {});
    invalidatePrefix("ipt_preview");
    invalidatePrefix("kpis");
    return { deleted: r.rowCount ?? 0 };
  });

  fastify.post("/upload/clear-ipt-modulos-bateria", async (_request, reply) => {
    // Deleting from the batches table cascades to ipt_modulos_bateria via ON DELETE CASCADE
    const r = await pool.query(`DELETE FROM ipt_modulos_bateria_batches RETURNING id`);
    invalidatePrefix("ipt_modulos_bateria");
    invalidatePrefix("kpis");
    return { deleted: r.rowCount ?? 0 };
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
      const stats = { report: 0, veiculos: 0, varricao: 0 };

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

      // 2. Migrar ipt_consolidado_veiculos -> ipt_consolidado_veiculos_dados
      const veicRows = await client.query(
        `SELECT raw, setor, data_referencia, source_file
         FROM ipt_imports
         WHERE file_type = 'ipt_consolidado_veiculos'`
      );
      for (const row of veicRows.rows) {
        const raw = (row.raw ?? {}) as Record<string, unknown>;
        await client.query(
          `INSERT INTO ipt_consolidado_veiculos_dados (
            placa, operacao, motorista, setor, data_referencia,
            liberacao, saida, status, retorno, tempo_trabalho,
            percentual_limpebras, percentual_selimp,
            raw, source_file, updated_at
          ) VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,NOW())`,
          [
            String(raw.placa_liberada ?? "").trim() || null,
            String(raw.operacao ?? "").trim() || null,
            String(raw.motorista ?? "").trim() || null,
            row.setor,
            row.data_referencia,
            String(raw.liberacao ?? "").trim() || null,
            String(raw.saida ?? "").trim() || null,
            String(raw.status ?? "").trim() || null,
            String(raw.retorno ?? "").trim() || null,
            String(raw.tempo_trabalho ?? "").trim() || null,
            typeof raw.percentual_limpebras === "number" ? raw.percentual_limpebras : null,
            typeof raw.percentual_selimp === "number" ? raw.percentual_selimp : null,
            JSON.stringify(raw),
            row.source_file,
          ]
        );
        stats.veiculos += 1;
      }

      // 3. Migrar ipt_consolidado_varricao -> ipt_consolidado_varricao_dados
      const varrRows = await client.query(
        `SELECT raw, setor, data_referencia, source_file
         FROM ipt_imports
         WHERE file_type = 'ipt_consolidado_varricao'`
      );
      for (const row of varrRows.rows) {
        const raw = (row.raw ?? {}) as Record<string, unknown>;
        await client.query(
          `INSERT INTO ipt_consolidado_varricao_dados (
            setor, frequencia_rotulo, data_referencia,
            percentual_selimp, percentual_ddmx,
            raw, source_file, updated_at
          ) VALUES ($1,$2,$3::date,$4,$5,$6::jsonb,$7,NOW())`,
          [
            row.setor,
            String(raw.frequencia_rotulo ?? "").trim() || null,
            row.data_referencia,
            typeof raw.percentual_selimp === "number" ? raw.percentual_selimp : null,
            typeof raw.percentual_ddmx === "number" ? raw.percentual_ddmx : null,
            JSON.stringify(raw),
            row.source_file,
          ]
        );
        stats.varricao += 1;
      }

      // 4. Migrar DDMX historico_os -> ipt_ddmx_veiculos (subtipo light)
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

      // 5. Migrar DDMX historico_os_compactadores -> ipt_ddmx_veiculos (subtipo compactadores)
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

      // 6. Migrar DDMX historico_os_varricao -> ipt_ddmx_varricao
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
        mensagem: `Migrados: ${stats.report} report, ${stats.veiculos} veiculos, ${stats.varricao} varricao, ${ddmxLightCount} ddmx light, ${ddmxCompCount} ddmx compactadores, ${ddmxVarrCount} ddmx varricao.`,
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  });
};
