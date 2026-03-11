import { FastifyPluginAsync, FastifyRequest } from "fastify";
import { pool } from "../db.js";
import { invalidatePrefix } from "../cache.js";
import { parseSacCsv, parseBfsCsv, parseOuvidoriaCsv, parseAcicCsv, parseCncDetalhesCsv } from "../services/parseCsv.js";
import { parseIptWorkbook, type IptFileType } from "../services/parseIptXlsx.js";
import { parseCronogramaWorkbook } from "../services/parseCronogramaIpt.js";
import { normalizarSetor } from "../constants/ipt.js";

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

  const getLastIptUpdate = async (fileType: IptFileType) => {
    if (fileType === "ipt_report_selimp") {
      const last = await pool.query(
        `SELECT
           source_file,
           updated_at,
           raw->>'_periodo_tipo' AS periodo_tipo,
           raw->>'_periodo_inicial_referencia' AS periodo_inicial,
           raw->>'_periodo_final_referencia' AS periodo_final,
           raw->>'_referencia_label' AS referencia_label
         FROM ipt_imports
         WHERE file_type = 'ipt_report_selimp'
         ORDER BY updated_at DESC
         LIMIT 1`
      );
      const count = await pool.query(
        `SELECT
           COUNT(*)::bigint AS total_linhas,
           COUNT(*) FILTER (
             WHERE LOWER(COALESCE(raw->>'status', '')) LIKE '%encerrado%'
           )::bigint AS total_encerradas
         FROM ipt_imports
         WHERE file_type = 'ipt_report_selimp'`
      );
      const r = last.rows[0];
      return {
        ultimo_import: r?.updated_at ?? null,
        source_file: r?.source_file ?? null,
        total_registros: Number(count.rows[0]?.total_linhas ?? 0),
        total_encerradas: Number(count.rows[0]?.total_encerradas ?? 0),
        ultima_referencia: r?.referencia_label ?? null,
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
      };
    } finally {
      client.release();
    }
  };

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
            raw = $11,
            source_file = $12,
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
            responsividade_execucao, procedente_por_status, regional, servico, endereco, data_execucao, raw, source_file, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
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
            raw = $8,
            source_file = $9,
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
            numero_bfs, data_fiscalizacao, data_vistoria, status, tipo_servico, regional, endereco, raw, source_file, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
          [
            r.numero_bfs || null,
            r.data_fiscalizacao,
            r.data_vistoria,
            r.status || null,
            r.tipo_servico || null,
            r.regional || null,
            r.endereco || null,
            JSON.stringify(r.raw),
            sourceFile,
          ]
        );
        inserted += 1;
      }
      invalidatePrefix("cnc");
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

  /** Importa FLIP_CONSULTA_CNC - detalhes das CNCs (data execução, situacao, fiscal contratada, etc). Cruza com BFS via numero_bfs. */
  fastify.post("/upload/cnc-detalhes-csv", async (request, reply) => {
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

    const client = await pool.connect();
    try {
      await client.query("TRUNCATE TABLE cncs RESTART IDENTITY");
      let inserted = 0;
      for (const r of rows) {
        if (!r.numero_bfs?.trim()) continue;
        const raw = (r.raw && typeof r.raw === "object") ? { ...r.raw } : {};
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
        inserted += 1;
      }
      invalidatePrefix("cnc");
      invalidatePrefix("cnc_defesa");
      return {
        processados: inserted,
        total: rows.length,
        inseridos: inserted,
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
      if (ordens.length === 0) return reply.code(400).send({ detail: "Nenhuma ordem com Status=Encerrado encontrada" });

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

      const dataRef = parseDateKey(fim);
      const ano = dataRef.getUTCFullYear();
      const mes = dataRef.getUTCMonth() + 1;
      const referenciaLabel = describeReportReference(modoReferencia, inicio, fim);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        await client.query(
          `DELETE FROM ipt_imports
           WHERE file_type = 'ipt_report_selimp'
             AND raw->>'_periodo_tipo' = $1
             AND raw->>'_periodo_inicial_referencia' = $2
             AND raw->>'_periodo_final_referencia' = $3`,
          [modoReferencia, inicio, fim]
        );
        for (const row of rows) {
          const raw: Record<string, unknown> = {
            ...(row.raw ?? {}),
            _periodo_tipo: modoReferencia,
            _periodo_inicial_referencia: inicio,
            _periodo_final_referencia: fim,
            _referencia_label: referenciaLabel,
            _data_referencia_estimada: true,
            _metodo_data_referencia: `referencia_${modoReferencia}`,
          };
          const recordKey = `${row.recordKey}|${modoReferencia}|${inicio}|${fim}`;
          const setorNormalizado = normalizarSetor(String(raw["plano"] ?? "").trim()) || row.setor || null;
          await client.query(
            `INSERT INTO ipt_imports (
               file_type, record_key, setor, data_referencia, ano_referencia, mes_referencia,
               data_estimada, metodo_data_referencia, servico, raw, source_file, updated_at
             )
             VALUES ('ipt_report_selimp', $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, NOW())
             ON CONFLICT (file_type, record_key) DO UPDATE SET
               setor = EXCLUDED.setor,
               data_referencia = EXCLUDED.data_referencia,
               ano_referencia = EXCLUDED.ano_referencia,
               mes_referencia = EXCLUDED.mes_referencia,
               data_estimada = EXCLUDED.data_estimada,
               metodo_data_referencia = EXCLUDED.metodo_data_referencia,
               servico = EXCLUDED.servico,
               raw = EXCLUDED.raw,
               source_file = EXCLUDED.source_file,
               updated_at = NOW()`,
            [
              recordKey,
              setorNormalizado,
              dataRef,
              ano,
              mes,
              true,
              `referencia_${modoReferencia}`,
              row.servico || null,
              JSON.stringify(raw),
              sourceFile,
            ]
          );
        }

        await client.query("COMMIT");
        invalidatePrefix("ipt_preview");
        invalidatePrefix("kpis");
        return {
          processados: rows.length,
          total: rows.length,
          inseridos: rows.length,
          atualizados: 0,
          duplicados: 0,
          erros: 0,
          ultimo_import: new Date().toISOString(),
          referencia_importada: referenciaLabel,
          modo_referencia: modoReferencia,
          periodo_inicial: inicio,
          periodo_final: fim,
          ordens_encerradas: ordens.length,
        };
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
      return await importIptFile("ipt_status_bateria", request);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Falha no upload IPT";
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

  fastify.get("/upload/last-updates", async () => {
    const [sacs, cnc, acic, ouvidoria, cncsDetalhes, iptHistoricoOs, iptHistoricoOsVarricao, iptHistoricoOsCompactadores, iptReport, iptStatusBateria, iptCronograma] =
      await Promise.all([
      getLastUpdate("sacs"),
      getLastUpdate("bfs"),
      getLastUpdate("acic"),
      getLastUpdate("ouvidoria"),
      getLastCncsUpdate(),
      getLastIptUpdate("ipt_historico_os"),
      getLastIptUpdate("ipt_historico_os_varricao"),
      getLastIptUpdate("ipt_historico_os_compactadores"),
      getLastIptUpdate("ipt_report_selimp"),
      getLastIptUpdate("ipt_status_bateria"),
      getLastCronogramaUpdate(),
      ]);
    return {
      sacs,
      cnc,
      acic,
      ouvidoria,
      cncsDetalhes,
      iptHistoricoOs,
      iptHistoricoOsVarricao,
      iptHistoricoOsCompactadores,
      iptReport,
      iptStatusBateria,
      iptCronograma,
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

  /** Remove todos os dados da planilha Reports (ipt_selimp_mensal). Use antes de reimportar. */
  fastify.post("/upload/clear-ipt-report", async (_request, reply) => {
    const r = await pool.query("DELETE FROM ipt_selimp_mensal RETURNING ano, mes");
    await pool.query("DELETE FROM ipt_imports WHERE file_type = 'ipt_report_selimp'");
    invalidatePrefix("ipt_preview");
    invalidatePrefix("kpis");
    return { deleted: r.rowCount ?? 0 };
  });

  /** Remove registros manuais de IPT (ipt_registros). Não utilizado mais – IPT vem da planilha ou oficial. */
  fastify.post("/upload/clear-ipt-registros", async (_request, reply) => {
    const r = await pool.query("DELETE FROM ipt_registros RETURNING id");
    invalidatePrefix("kpis");
    return { deleted: r.rowCount ?? 0 };
  });
};
