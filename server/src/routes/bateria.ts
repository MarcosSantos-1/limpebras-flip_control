import { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";
import { invalidatePrefix } from "../cache.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_RE.test(value);
}

function cleanSelimp(value: unknown): string {
  return String(value ?? "").trim();
}

// ===== Trocas de bateria =====

export interface TrocaRecordDto {
  selimp: string;
  setor?: string;
  status: "agendada" | "concluida";
  dataAgendada?: string;
  sucesso?: boolean;
  percentualEntrada?: number;
  dataTroca?: string;
  ultimaComunicacao?: string;
}

export interface TrocaHistoryDto extends TrocaRecordDto {
  id: string;
  tipoTroca?: string;
  bateriaAntes?: string;
  bateriaAntesPercentual?: number;
  statusBateriaAntes?: string;
  bateriaDepoisPercentual?: number;
  statusSinalDepois?: string;
  createdAt?: string;
}

interface TrocaRow {
  modulo_selimp: string;
  setor: string | null;
  status: string;
  data_agendada: string | null;
  sucesso: boolean | null;
  percentual_entrada: string | null;
  data_troca: string | null;
  ultima_comunicacao: string | null;
}

interface TrocaEventoRow extends TrocaRow {
  id: number;
  tipo_troca: string | null;
  bateria_antes_raw: string | null;
  bateria_antes_percentual: string | null;
  status_bateria_antes: string | null;
  bateria_depois_percentual: string | null;
  status_sinal_depois: string | null;
  created_at: string | null;
}

function mapTroca(r: TrocaRow): TrocaRecordDto {
  return {
    selimp: r.modulo_selimp,
    setor: r.setor ?? undefined,
    status: r.status === "concluida" ? "concluida" : "agendada",
    dataAgendada: r.data_agendada ?? undefined,
    sucesso: r.sucesso ?? undefined,
    percentualEntrada: r.percentual_entrada != null ? Number(r.percentual_entrada) : undefined,
    dataTroca: r.data_troca ?? undefined,
    ultimaComunicacao: r.ultima_comunicacao ?? undefined,
  };
}

function mapTrocaHistory(r: TrocaEventoRow): TrocaHistoryDto {
  return {
    ...mapTroca(r),
    id: String(r.id),
    tipoTroca: r.tipo_troca ?? undefined,
    bateriaAntes: r.bateria_antes_raw ?? undefined,
    bateriaAntesPercentual: r.bateria_antes_percentual != null ? Number(r.bateria_antes_percentual) : undefined,
    statusBateriaAntes: r.status_bateria_antes ?? undefined,
    bateriaDepoisPercentual: r.bateria_depois_percentual != null ? Number(r.bateria_depois_percentual) : undefined,
    statusSinalDepois: r.status_sinal_depois ?? undefined,
    createdAt: r.created_at ?? undefined,
  };
}

function currentToHistory(r: TrocaRow): TrocaHistoryDto {
  return {
    ...mapTroca(r),
    id: `current-${r.modulo_selimp}`,
    tipoTroca: r.status === "agendada" ? "Agendamento" : undefined,
  };
}

const SELECT_TROCA = `
  SELECT modulo_selimp, setor, status,
         data_agendada::text AS data_agendada,
         sucesso, percentual_entrada,
         data_troca::text AS data_troca,
         ultima_comunicacao::text AS ultima_comunicacao
    FROM bateria_trocas`;

const SELECT_TROCA_EVENTO = `
  SELECT id, modulo_selimp, setor, status, tipo_troca,
         data_agendada::text AS data_agendada,
         sucesso, percentual_entrada,
         data_troca::text AS data_troca,
         ultima_comunicacao::text AS ultima_comunicacao,
         bateria_antes_raw,
         bateria_antes_percentual,
         status_bateria_antes,
         bateria_depois_percentual,
         status_sinal_depois,
         created_at::text AS created_at
    FROM bateria_trocas_eventos`;

// ===== Manutenções =====

export interface ManutencaoRecordDto {
  solicitada: boolean;
  dataSolicitacao?: string;
  dataManutencao?: string;
  naoHouve: boolean;
}

interface ManutencaoRow {
  modulo_selimp: string;
  solicitada: boolean;
  data_solicitacao: string | null;
  data_manutencao: string | null;
  nao_houve: boolean;
}

function mapManutencao(r: ManutencaoRow): ManutencaoRecordDto {
  return {
    solicitada: Boolean(r.solicitada),
    dataSolicitacao: r.data_solicitacao ?? undefined,
    dataManutencao: r.data_manutencao ?? undefined,
    naoHouve: Boolean(r.nao_houve),
  };
}

const MANUTENCAO_STATUS_SINAL = "MANUTENÇÃO";

export const bateriaRoutes: FastifyPluginAsync = async (fastify) => {
  // ---- Trocas ----

  fastify.get("/bateria/trocas", async () => {
    const [res, eventos] = await Promise.all([
      pool.query<TrocaRow>(`${SELECT_TROCA} ORDER BY modulo_selimp`),
      pool.query<TrocaEventoRow>(`${SELECT_TROCA_EVENTO} ORDER BY modulo_selimp, COALESCE(data_troca, data_agendada) DESC NULLS LAST, created_at DESC, id DESC`),
    ]);
    const records: Record<string, TrocaRecordDto> = {};
    const history: Record<string, TrocaHistoryDto[]> = {};
    for (const r of res.rows) records[r.modulo_selimp] = mapTroca(r);
    for (const r of eventos.rows) {
      if (!history[r.modulo_selimp]) history[r.modulo_selimp] = [];
      history[r.modulo_selimp].push(mapTrocaHistory(r));
    }
    for (const r of res.rows) {
      if (!history[r.modulo_selimp]?.length) {
        history[r.modulo_selimp] = [currentToHistory(r)];
      }
    }
    return { records, history };
  });

  fastify.post<{
    Body: { items?: { selimp?: string; setor?: string; dataAgendada?: string; tipoTroca?: string }[] };
  }>("/bateria/trocas/agendar", async (request, reply) => {
    const items = Array.isArray(request.body?.items) ? request.body.items : [];
    const valid = items
      .map((it) => ({
        selimp: cleanSelimp(it?.selimp),
        setor: String(it?.setor ?? "").trim() || null,
        dataAgendada: it?.dataAgendada,
        tipoTroca: String(it?.tipoTroca ?? "").trim() || "Agendamento",
      }))
      .filter((it) => it.selimp && isIsoDate(it.dataAgendada));
    if (valid.length === 0) {
      return reply.code(400).send({ detail: "items deve conter ao menos um { selimp, dataAgendada (yyyy-MM-dd) }" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const it of valid) {
        await client.query(
          `INSERT INTO bateria_trocas (modulo_selimp, setor, status, data_agendada, updated_at)
           VALUES ($1, $2, 'agendada', $3::date, NOW())
           ON CONFLICT (modulo_selimp) DO UPDATE SET
             setor = COALESCE(EXCLUDED.setor, bateria_trocas.setor),
             status = 'agendada',
             data_agendada = EXCLUDED.data_agendada,
             updated_at = NOW()`,
          [it.selimp, it.setor, it.dataAgendada]
        );
        await client.query(
          `INSERT INTO bateria_trocas_eventos (modulo_selimp, setor, status, tipo_troca, data_agendada)
           VALUES ($1, $2, 'agendada', $3, $4::date)`,
          [it.selimp, it.setor, it.tipoTroca, it.dataAgendada]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return { ok: true, agendadas: valid.length };
  });

  fastify.post<{
    Body: {
      items?: {
        selimp?: string;
        setor?: string;
        sucesso?: boolean;
        percentualEntrada?: number | null;
        dataTroca?: string;
        ultimaComunicacao?: string;
        tipoTroca?: string;
        bateriaAntes?: string;
        bateriaAntesPercentual?: number | null;
        statusBateriaAntes?: string;
        bateriaDepoisPercentual?: number | null;
        statusSinalDepois?: string;
      }[];
    };
  }>("/bateria/trocas/concluir", async (request, reply) => {
    const items = Array.isArray(request.body?.items) ? request.body.items : [];
    const valid = items
      .map((it) => ({
        selimp: cleanSelimp(it?.selimp),
        setor: String(it?.setor ?? "").trim() || null,
        sucesso: Boolean(it?.sucesso),
        percentualEntrada:
          it?.percentualEntrada != null && Number.isFinite(Number(it.percentualEntrada))
            ? Math.min(100, Math.max(0, Number(it.percentualEntrada)))
            : null,
        dataTroca: isIsoDate(it?.dataTroca) ? it.dataTroca : null,
        ultimaComunicacao: isIsoDate(it?.ultimaComunicacao) ? it.ultimaComunicacao : null,
        tipoTroca: String(it?.tipoTroca ?? "").trim() || null,
        bateriaAntes: String(it?.bateriaAntes ?? "").trim() || null,
        bateriaAntesPercentual:
          it?.bateriaAntesPercentual != null && Number.isFinite(Number(it.bateriaAntesPercentual))
            ? Math.min(100, Math.max(0, Number(it.bateriaAntesPercentual)))
            : null,
        statusBateriaAntes: String(it?.statusBateriaAntes ?? "").trim() || null,
        bateriaDepoisPercentual:
          it?.bateriaDepoisPercentual != null && Number.isFinite(Number(it.bateriaDepoisPercentual))
            ? Math.min(100, Math.max(0, Number(it.bateriaDepoisPercentual)))
            : null,
        statusSinalDepois: String(it?.statusSinalDepois ?? "").trim() || null,
      }))
      .filter((it) => it.selimp && it.dataTroca);
    if (valid.length === 0) {
      return reply.code(400).send({ detail: "items deve conter ao menos um { selimp, dataTroca (yyyy-MM-dd) }" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const it of valid) {
        await client.query(
          `INSERT INTO bateria_trocas (modulo_selimp, setor, status, sucesso, percentual_entrada, data_troca, ultima_comunicacao, updated_at)
           VALUES ($1, $2, 'concluida', $3, $4, $5::date, $6::date, NOW())
           ON CONFLICT (modulo_selimp) DO UPDATE SET
             setor = COALESCE(EXCLUDED.setor, bateria_trocas.setor),
             status = 'concluida',
             sucesso = EXCLUDED.sucesso,
             percentual_entrada = EXCLUDED.percentual_entrada,
             data_troca = EXCLUDED.data_troca,
             ultima_comunicacao = EXCLUDED.ultima_comunicacao,
             updated_at = NOW()`,
          [it.selimp, it.setor, it.sucesso, it.percentualEntrada, it.dataTroca, it.ultimaComunicacao]
        );
        await client.query(
          `INSERT INTO bateria_trocas_eventos (
             modulo_selimp, setor, status, tipo_troca, sucesso, percentual_entrada,
             data_troca, ultima_comunicacao, bateria_antes_raw,
             bateria_antes_percentual, status_bateria_antes,
             bateria_depois_percentual, status_sinal_depois
           )
           VALUES ($1, $2, 'concluida', $3, $4, $5, $6::date, $7::date, $8, $9, $10, $11, $12)`,
          [
            it.selimp,
            it.setor,
            it.tipoTroca,
            it.sucesso,
            it.percentualEntrada,
            it.dataTroca,
            it.ultimaComunicacao,
            it.bateriaAntes,
            it.bateriaAntesPercentual,
            it.statusBateriaAntes,
            it.bateriaDepoisPercentual ?? it.percentualEntrada,
            it.statusSinalDepois,
          ]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return { ok: true, concluidas: valid.length };
  });

  fastify.delete<{ Params: { selimp: string } }>("/bateria/trocas/:selimp", async (request, reply) => {
    const selimp = cleanSelimp(request.params.selimp);
    if (!selimp) return reply.code(400).send({ detail: "selimp é obrigatório" });
    await pool.query(`DELETE FROM bateria_trocas WHERE modulo_selimp = $1`, [selimp]);
    return { ok: true };
  });

  // ---- Manutenções ----

  fastify.get("/bateria/manutencoes", async () => {
    const res = await pool.query<ManutencaoRow>(
      `SELECT modulo_selimp, solicitada,
              data_solicitacao::text AS data_solicitacao,
              data_manutencao::text AS data_manutencao,
              nao_houve
         FROM bateria_manutencoes
        ORDER BY modulo_selimp`
    );
    const records: Record<string, ManutencaoRecordDto> = {};
    for (const r of res.rows) records[r.modulo_selimp] = mapManutencao(r);
    return { records };
  });

  fastify.put<{
    Params: { selimp: string };
    Body: { dataManutencao?: string | null; naoHouve?: boolean | null };
  }>("/bateria/manutencoes/:selimp", async (request, reply) => {
    const selimp = cleanSelimp(request.params.selimp);
    if (!selimp) return reply.code(400).send({ detail: "selimp é obrigatório" });
    const dataManutencao = isIsoDate(request.body?.dataManutencao) ? request.body.dataManutencao : null;
    const naoHouve = typeof request.body?.naoHouve === "boolean" ? request.body.naoHouve : null;
    if (dataManutencao == null && naoHouve == null) {
      return reply.code(400).send({ detail: "informe dataManutencao (yyyy-MM-dd) e/ou naoHouve (boolean)" });
    }

    // Patch parcial: campos não enviados são preservados.
    await pool.query(
      `INSERT INTO bateria_manutencoes (modulo_selimp, data_manutencao, nao_houve, updated_at)
       VALUES ($1, $2::date, COALESCE($3, FALSE), NOW())
       ON CONFLICT (modulo_selimp) DO UPDATE SET
         data_manutencao = COALESCE($2::date, bateria_manutencoes.data_manutencao),
         nao_houve = COALESCE($3, bateria_manutencoes.nao_houve),
         updated_at = NOW()`,
      [selimp, dataManutencao, naoHouve]
    );
    return { ok: true };
  });

  fastify.post<{
    Body: { selimps?: string[]; dataSolicitacao?: string };
  }>("/bateria/manutencoes/solicitar", async (request, reply) => {
    const selimps = (Array.isArray(request.body?.selimps) ? request.body.selimps : [])
      .map(cleanSelimp)
      .filter(Boolean);
    const dataSolicitacao = request.body?.dataSolicitacao;
    if (selimps.length === 0 || !isIsoDate(dataSolicitacao)) {
      return reply.code(400).send({ detail: "selimps (lista) e dataSolicitacao (yyyy-MM-dd) são obrigatórios" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO bateria_manutencoes (modulo_selimp, solicitada, data_solicitacao, updated_at)
         SELECT s, TRUE, $2::date, NOW() FROM unnest($1::text[]) AS s
         ON CONFLICT (modulo_selimp) DO UPDATE SET
           solicitada = TRUE,
           data_solicitacao = EXCLUDED.data_solicitacao,
           updated_at = NOW()`,
        [selimps, dataSolicitacao]
      );
      // Move o status global do módulo para MANUTENÇÃO (preservado pelos imports).
      await client.query(
        `UPDATE modulo_selimp
            SET status_sinal_manual = $2, updated_at = NOW()
          WHERE modulo_selimp = ANY($1::text[])
            AND COALESCE(status_sinal_manual, '') <> $2`,
        [selimps, MANUTENCAO_STATUS_SINAL]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    invalidatePrefix("ipt_modulos_bateria");
    return { ok: true, solicitadas: selimps.length };
  });

  fastify.post<{
    Body: { selimp?: string };
  }>("/bateria/manutencoes/cancelar", async (request, reply) => {
    const selimp = cleanSelimp(request.body?.selimp);
    if (!selimp) return reply.code(400).send({ detail: "selimp é obrigatório" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE bateria_manutencoes
            SET solicitada = FALSE, data_solicitacao = NULL, updated_at = NOW()
          WHERE modulo_selimp = $1`,
        [selimp]
      );
      // Só limpa o status manual se foi esta dinâmica que o definiu.
      await client.query(
        `UPDATE modulo_selimp
            SET status_sinal_manual = NULL, updated_at = NOW()
          WHERE modulo_selimp = $1 AND status_sinal_manual = $2`,
        [selimp, MANUTENCAO_STATUS_SINAL]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    invalidatePrefix("ipt_modulos_bateria");
    return { ok: true };
  });
};
