import { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";
import { invalidatePrefix } from "../cache.js";
import { refreshModuloSelimp } from "../services/refreshModuloSelimp.js";

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
  dataPrimeiroAgendamento?: string;
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
  bateriaDepois?: string;
  bateriaDepoisPercentual?: number;
  statusBateriaDepois?: string;
  statusSinalDepois?: string;
  /** yyyy-MM-dd — leitura de sinal/comunicação do snapshot anterior/posterior à troca. */
  ultimaComunicacaoAntes?: string;
  ultimaComunicacaoDepois?: string;
  createdAt?: string;
}

interface TrocaRow {
  modulo_selimp: string;
  setor: string | null;
  status: string;
  data_agendada: string | null;
  data_primeiro_agendamento: string | null;
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
  // Snapshots reais (ipt_dados_bateria) imediatamente antes/depois da troca.
  snap_antes_pct: string | null;
  snap_antes_raw: string | null;
  snap_antes_desat: boolean | null;
  snap_antes_sinal: string | null;
  snap_antes_ultima: string | null;
  snap_depois_pct: string | null;
  snap_depois_raw: string | null;
  snap_depois_desat: boolean | null;
  snap_depois_sinal: string | null;
  snap_depois_ultima: string | null;
}

/** Status da bateria a partir do percentual/flag do snapshot (mesmos limiares do refreshModuloSelimp). */
function statusBateriaFromSnapshot(
  pct: string | null,
  raw: string | null,
  desatualizada: boolean | null,
): string | undefined {
  if ((raw && /desatualizada/i.test(raw)) || desatualizada) return "DESATUALIZADA";
  if (pct == null) return undefined;
  const n = Number(pct);
  if (!Number.isFinite(n)) return undefined;
  if (n > 70) return "ALTA";
  if (n > 30) return "REGULAR";
  if (n > 15) return "BAIXA";
  return "CRÍTICA";
}

/** Bateria após a troca abaixo deste percentual ⇒ troca sem sucesso (mesmo com sinal). */
const SUCESSO_MIN_PCT_DEPOIS = 60;

/**
 * Sucesso automático da troca a partir do snapshot logo APÓS a data da troca:
 * - false quando a bateria continua desatualizada OU ficou abaixo de 60%;
 * - true quando recuperou e a bateria ficou >= 60%;
 * - undefined quando ainda não há leitura posterior à troca ("Aguardando avaliação").
 */
function sucessoFromDepois(r: TrocaEventoRow): boolean | undefined {
  const hasDepois = r.snap_depois_raw != null || r.snap_depois_pct != null;
  if (!hasDepois) return undefined;
  const desat = Boolean(r.snap_depois_desat) || /desatualizada/i.test(String(r.snap_depois_raw ?? ""));
  if (desat) return false;
  const pct = r.snap_depois_pct != null ? Number(r.snap_depois_pct) : null;
  if (pct != null && Number.isFinite(pct) && pct < SUCESSO_MIN_PCT_DEPOIS) return false;
  return true;
}

/** Tem sinal = comunicação ON e bateria não desatualizada. */
function temSinal(sinal: string | null, raw: string | null, desat: boolean | null): boolean {
  const on = String(sinal ?? "").trim().toUpperCase() === "ON";
  const desatualizada = Boolean(desat) || (raw != null && /desatualizada/i.test(raw));
  return on && !desatualizada;
}

/**
 * Classifica o tipo da troca a partir do estado ANTES da troca (motivo):
 * - CORRETIVA: estava sem sinal/desatualizado antes (módulo sem comunicar).
 * - PREVENTIVA: tinha sinal mas bateria baixa/crítica antes.
 * DESNECESSÁRIA NÃO é mais automática — é marcada manualmente na conclusão (toggle).
 * Retorna undefined quando não há dado "antes" para decidir (cai para o tipo gravado).
 */
function classifyTipoTroca(
  antesPct: number | null,
  antesSinal: string | null,
  antesRaw: string | null,
  antesDesat: boolean | null,
  _depoisPct: number | null,
  _depoisSinal: string | null,
  _depoisRaw: string | null,
  _depoisDesat: boolean | null,
): string | undefined {
  const semDadosAntes =
    antesPct == null && (antesSinal == null || antesSinal === "") && antesDesat == null && (antesRaw == null || antesRaw === "");
  if (semDadosAntes) return undefined;
  const sinalAntes = temSinal(antesSinal, antesRaw, antesDesat);
  const baixaAntes = antesPct != null && antesPct <= 30;
  if (!sinalAntes) return "CORRETIVA";
  if (baixaAntes) return "PREVENTIVA";
  return undefined;
}

function mapTroca(r: TrocaRow): TrocaRecordDto {
  return {
    selimp: r.modulo_selimp,
    setor: r.setor ?? undefined,
    status: r.status === "concluida" ? "concluida" : "agendada",
    dataAgendada: r.data_agendada ?? undefined,
    dataPrimeiroAgendamento: r.data_primeiro_agendamento ?? undefined,
    sucesso: r.sucesso ?? undefined,
    percentualEntrada: r.percentual_entrada != null ? Number(r.percentual_entrada) : undefined,
    dataTroca: r.data_troca ?? undefined,
    ultimaComunicacao: r.ultima_comunicacao ?? undefined,
  };
}

function mapTrocaHistory(r: TrocaEventoRow): TrocaHistoryDto {
  // "Antes"/"Depois" reais = snapshot diário mais próximo antes/depois da troca; se não houver,
  // cai para os valores gravados no próprio evento (importação antiga).
  const antesPct =
    r.snap_antes_pct != null
      ? Number(r.snap_antes_pct)
      : r.bateria_antes_percentual != null
        ? Number(r.bateria_antes_percentual)
        : undefined;
  const depoisPct =
    r.snap_depois_pct != null
      ? Number(r.snap_depois_pct)
      : r.bateria_depois_percentual != null
        ? Number(r.bateria_depois_percentual)
        : undefined;
  // Tipo automático (CORRETIVA/PREVENTIVA/DESNECESSÁRIA) derivado dos snapshots
  // reais antes/depois; cai para o tipo gravado (ex.: "Agendamento") quando indefinido.
  const tipoAuto =
    r.status === "concluida"
      ? classifyTipoTroca(
          antesPct ?? null,
          r.snap_antes_sinal,
          r.snap_antes_raw,
          r.snap_antes_desat,
          depoisPct ?? null,
          r.snap_depois_sinal,
          r.snap_depois_raw,
          r.snap_depois_desat,
        )
      : undefined;
  // Sucesso automático: a troca foi "sem sucesso" se o snapshot logo após continua desatualizado.
  // Sem leitura posterior à troca → undefined ("Aguardando avaliação").
  const sucessoAuto = r.status === "concluida" ? sucessoFromDepois(r) : undefined;
  // "Desnecessária" é manual (toggle na conclusão): quando gravada, sempre prevalece.
  const desnecManual = String(r.tipo_troca ?? "").toUpperCase().includes("DESNEC");
  return {
    ...mapTroca(r),
    id: String(r.id),
    sucesso: sucessoAuto,
    tipoTroca: desnecManual ? r.tipo_troca ?? undefined : tipoAuto ?? r.tipo_troca ?? undefined,
    bateriaAntes: r.snap_antes_raw ?? r.bateria_antes_raw ?? undefined,
    bateriaAntesPercentual: antesPct,
    statusBateriaAntes:
      statusBateriaFromSnapshot(r.snap_antes_pct, r.snap_antes_raw, r.snap_antes_desat) ??
      r.status_bateria_antes ??
      undefined,
    bateriaDepois: r.snap_depois_raw ?? undefined,
    bateriaDepoisPercentual: depoisPct,
    statusBateriaDepois: statusBateriaFromSnapshot(r.snap_depois_pct, r.snap_depois_raw, r.snap_depois_desat),
    statusSinalDepois: r.snap_depois_sinal ?? r.status_sinal_depois ?? undefined,
    ultimaComunicacaoAntes: r.snap_antes_ultima ?? undefined,
    ultimaComunicacaoDepois: r.snap_depois_ultima ?? undefined,
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
         data_primeiro_agendamento::text AS data_primeiro_agendamento,
         sucesso, percentual_entrada,
         data_troca::text AS data_troca,
         ultima_comunicacao::text AS ultima_comunicacao
    FROM bateria_trocas`;

// Cada evento é enriquecido com o snapshot diário (ipt_dados_bateria) imediatamente ANTERIOR
// e POSTERIOR à data da troca — dá o status/percentual real de bateria antes e depois da troca.
const SELECT_TROCA_EVENTO = `
  SELECT e.id, e.modulo_selimp, e.setor, e.status, e.tipo_troca,
         e.data_agendada::text AS data_agendada,
         e.data_primeiro_agendamento::text AS data_primeiro_agendamento,
         e.sucesso, e.percentual_entrada,
         e.data_troca::text AS data_troca,
         e.ultima_comunicacao::text AS ultima_comunicacao,
         e.bateria_antes_raw,
         e.bateria_antes_percentual,
         e.status_bateria_antes,
         e.bateria_depois_percentual,
         e.status_sinal_depois,
         e.created_at::text AS created_at,
         antes.bateria_percentual    AS snap_antes_pct,
         antes.bateria_raw           AS snap_antes_raw,
         antes.bateria_desatualizada AS snap_antes_desat,
         antes.status_comunicacao    AS snap_antes_sinal,
         antes.ultima_comunicacao::text AS snap_antes_ultima,
         depois.bateria_percentual    AS snap_depois_pct,
         depois.bateria_raw           AS snap_depois_raw,
         depois.bateria_desatualizada AS snap_depois_desat,
         depois.status_comunicacao    AS snap_depois_sinal,
         depois.ultima_comunicacao::text AS snap_depois_ultima
    FROM bateria_trocas_eventos e
    LEFT JOIN LATERAL (
      SELECT d.bateria_percentual, d.bateria_raw, d.bateria_desatualizada, d.status_comunicacao, d.ultima_comunicacao
        FROM ipt_dados_bateria d
       WHERE d.selimp_id = e.modulo_selimp
         AND COALESCE(e.data_primeiro_agendamento, e.data_agendada, e.data_troca) IS NOT NULL
         AND d.data_exportacao < COALESCE(e.data_primeiro_agendamento, e.data_agendada, e.data_troca)
       ORDER BY d.data_exportacao DESC
       LIMIT 1
    ) antes ON TRUE
    LEFT JOIN LATERAL (
      SELECT d.bateria_percentual, d.bateria_raw, d.bateria_desatualizada, d.status_comunicacao, d.ultima_comunicacao
        FROM ipt_dados_bateria d
       WHERE d.selimp_id = e.modulo_selimp
         AND e.data_troca IS NOT NULL
         AND d.data_exportacao >= e.data_troca
       ORDER BY d.data_exportacao ASC
       LIMIT 1
    ) depois ON TRUE`;

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
      pool.query<TrocaEventoRow>(`${SELECT_TROCA_EVENTO} ORDER BY e.modulo_selimp, COALESCE(e.data_troca, e.data_agendada) DESC NULLS LAST, e.created_at DESC, e.id DESC`),
    ]);
    const records: Record<string, TrocaRecordDto> = {};
    const currentRows: Record<string, TrocaRow> = {};
    const history: Record<string, TrocaHistoryDto[]> = {};
    for (const r of res.rows) {
      records[r.modulo_selimp] = mapTroca(r);
      currentRows[r.modulo_selimp] = r;
    }
    for (const r of eventos.rows) {
      if (!history[r.modulo_selimp]) history[r.modulo_selimp] = [];
      history[r.modulo_selimp].push(mapTrocaHistory(r));
    }
    // Um módulo pode ter legado com vários reagendamentos append-only. Na API, expomos
    // apenas o agendamento aberto atual; quando a troca já foi concluída, o agendamento
    // aberto deixa de aparecer no histórico.
    for (const [selimp, items] of Object.entries(history)) {
      const rec = records[selimp];
      const concluidas = items.filter((h) => h.status === "concluida");
      if (rec?.status === "agendada") {
        const agendada = items.find((h) => h.status === "agendada") ?? currentToHistory(currentRows[selimp]);
        history[selimp] = agendada
          ? [{ ...agendada, dataAgendada: rec.dataAgendada, dataPrimeiroAgendamento: rec.dataPrimeiroAgendamento }, ...concluidas]
          : concluidas;
      } else {
        history[selimp] = concluidas;
      }
    }
    // Estado corrente: sucesso = derivado do evento concluído mais recente (history vem em ordem desc).
    for (const [selimp, rec] of Object.entries(records)) {
      if (rec.status !== "concluida") continue;
      const ultimaConcluida = history[selimp]?.find((h) => h.status === "concluida");
      rec.sucesso = ultimaConcluida ? ultimaConcluida.sucesso : undefined;
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
        const agendamentoAtual = await client.query<{ primeiro: string | null; criado_em: string | null }>(
          `SELECT
              COALESCE(
                (SELECT MIN(COALESCE(data_primeiro_agendamento, data_agendada))::text
                   FROM bateria_trocas_eventos
                  WHERE modulo_selimp = $1
                    AND status = 'agendada'),
                (SELECT COALESCE(data_primeiro_agendamento, data_agendada)::text
                   FROM bateria_trocas
                  WHERE modulo_selimp = $1
                    AND status = 'agendada'),
                $2::date::text
              ) AS primeiro,
              (SELECT MIN(created_at)::text
                 FROM bateria_trocas_eventos
                WHERE modulo_selimp = $1
                  AND status = 'agendada') AS criado_em`,
          [it.selimp, it.dataAgendada],
        );
        const primeiroAgendamento = agendamentoAtual.rows[0]?.primeiro ?? it.dataAgendada;
        const criadoEm = agendamentoAtual.rows[0]?.criado_em ?? null;
        await client.query(
          `INSERT INTO bateria_trocas (modulo_selimp, setor, status, data_agendada, data_primeiro_agendamento, updated_at)
           VALUES ($1, $2, 'agendada', $3::date, $4::date, NOW())
           ON CONFLICT (modulo_selimp) DO UPDATE SET
             setor = COALESCE(EXCLUDED.setor, bateria_trocas.setor),
             status = 'agendada',
             data_agendada = EXCLUDED.data_agendada,
             data_primeiro_agendamento = CASE
               WHEN bateria_trocas.status = 'agendada' THEN COALESCE(
                 bateria_trocas.data_primeiro_agendamento,
                 bateria_trocas.data_agendada,
                 EXCLUDED.data_primeiro_agendamento
               )
               ELSE EXCLUDED.data_primeiro_agendamento
             END,
             updated_at = NOW()`,
          [it.selimp, it.setor, it.dataAgendada, primeiroAgendamento]
        );
        await client.query(
          `DELETE FROM bateria_trocas_eventos
            WHERE modulo_selimp = $1
              AND status = 'agendada'`,
          [it.selimp],
        );
        await client.query(
          `INSERT INTO bateria_trocas_eventos (
             modulo_selimp, setor, status, tipo_troca, data_agendada,
             data_primeiro_agendamento, created_at
           )
           VALUES ($1, $2, 'agendada', $3, $4::date, $5::date, COALESCE($6::timestamptz, NOW()))`,
          [it.selimp, it.setor, it.tipoTroca, it.dataAgendada, primeiroAgendamento, criadoEm]
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
        const agendamento = await client.query<{
          data_agendada: string | null;
          data_primeiro_agendamento: string | null;
        }>(
          `SELECT
              COALESCE(bt.data_agendada::text, ev.data_agendada::text) AS data_agendada,
              COALESCE(
                bt.data_primeiro_agendamento::text,
                ev.data_primeiro_agendamento::text,
                ev.data_agendada::text,
                bt.data_agendada::text,
                $2::date::text
              ) AS data_primeiro_agendamento
             FROM (SELECT 1) base
             LEFT JOIN bateria_trocas bt
               ON bt.modulo_selimp = $1
              AND bt.status = 'agendada'
             LEFT JOIN LATERAL (
               SELECT data_agendada, data_primeiro_agendamento
                 FROM bateria_trocas_eventos
                WHERE modulo_selimp = $1
                  AND status = 'agendada'
                ORDER BY COALESCE(data_primeiro_agendamento, data_agendada) ASC NULLS LAST,
                         created_at ASC,
                         id ASC
                LIMIT 1
             ) ev ON TRUE`,
          [it.selimp, it.dataTroca],
        );
        const dataAgendada = agendamento.rows[0]?.data_agendada ?? null;
        const dataPrimeiroAgendamento = agendamento.rows[0]?.data_primeiro_agendamento ?? it.dataTroca;
        // Última comunicação automática: snapshot logo após a troca; senão o mais recente.
        if (!it.ultimaComunicacao && it.dataTroca) {
          const auto = await client.query<{ u: string | null }>(
            `SELECT COALESCE(
                (SELECT ultima_comunicacao::date::text FROM ipt_dados_bateria
                  WHERE selimp_id = $1 AND data_exportacao > $2::date AND ultima_comunicacao IS NOT NULL
                  ORDER BY data_exportacao ASC LIMIT 1),
                (SELECT ultima_comunicacao::date::text FROM ipt_dados_bateria
                  WHERE selimp_id = $1 AND ultima_comunicacao IS NOT NULL
                  ORDER BY data_exportacao DESC LIMIT 1)
              ) AS u`,
            [it.selimp, it.dataTroca],
          );
          it.ultimaComunicacao = auto.rows[0]?.u ?? null;
        }
        await client.query(
          `INSERT INTO bateria_trocas (
             modulo_selimp, setor, status, data_agendada, data_primeiro_agendamento,
             sucesso, percentual_entrada, data_troca, ultima_comunicacao, updated_at
           )
           VALUES ($1, $2, 'concluida', $3::date, $4::date, $5, $6, $7::date, $8::date, NOW())
           ON CONFLICT (modulo_selimp) DO UPDATE SET
             setor = COALESCE(EXCLUDED.setor, bateria_trocas.setor),
             status = 'concluida',
             data_agendada = COALESCE(bateria_trocas.data_agendada, EXCLUDED.data_agendada),
             data_primeiro_agendamento = COALESCE(
               bateria_trocas.data_primeiro_agendamento,
               EXCLUDED.data_primeiro_agendamento
             ),
             sucesso = EXCLUDED.sucesso,
             percentual_entrada = EXCLUDED.percentual_entrada,
             data_troca = EXCLUDED.data_troca,
             ultima_comunicacao = EXCLUDED.ultima_comunicacao,
             updated_at = NOW()`,
          [
            it.selimp,
            it.setor,
            dataAgendada,
            dataPrimeiroAgendamento,
            it.sucesso,
            it.percentualEntrada,
            it.dataTroca,
            it.ultimaComunicacao,
          ]
        );
        await client.query(
          `INSERT INTO bateria_trocas_eventos (
             modulo_selimp, setor, status, tipo_troca, data_agendada,
             data_primeiro_agendamento, sucesso, percentual_entrada,
             data_troca, ultima_comunicacao, bateria_antes_raw,
             bateria_antes_percentual, status_bateria_antes,
             bateria_depois_percentual, status_sinal_depois
           )
           VALUES ($1, $2, 'concluida', $3, $4::date, $5::date, $6, $7, $8::date, $9::date, $10, $11, $12, $13, $14)`,
          [
            it.selimp,
            it.setor,
            it.tipoTroca,
            dataAgendada,
            dataPrimeiroAgendamento,
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
        await client.query(
          `DELETE FROM bateria_trocas_eventos
            WHERE modulo_selimp = $1
              AND status = 'agendada'`,
          [it.selimp],
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
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM bateria_trocas WHERE modulo_selimp = $1 AND status = 'agendada'`, [selimp]);
      await client.query(`DELETE FROM bateria_trocas_eventos WHERE modulo_selimp = $1 AND status = 'agendada'`, [selimp]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return { ok: true };
  });

  // Remove um evento específico do histórico de trocas e recalcula o estado-corrente + qtd_trocas.
  fastify.delete<{ Params: { id: string } }>("/bateria/trocas/eventos/:id", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ detail: "id inválido" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const del = await client.query<{ modulo_selimp: string }>(
        `DELETE FROM bateria_trocas_eventos WHERE id = $1 RETURNING modulo_selimp`,
        [id],
      );
      const selimp = del.rows[0]?.modulo_selimp;
      if (selimp) {
        const lt = await client.query<{ setor: string | null; sucesso: boolean | null; data_troca: string | null; ultima_comunicacao: string | null }>(
          `SELECT setor, sucesso, data_troca::text AS data_troca, ultima_comunicacao::text AS ultima_comunicacao
             FROM bateria_trocas_eventos
            WHERE modulo_selimp = $1 AND status = 'concluida'
            ORDER BY data_troca DESC NULLS LAST, id DESC LIMIT 1`,
          [selimp],
        );
        if (lt.rows[0]) {
          await client.query(
            `INSERT INTO bateria_trocas (modulo_selimp, setor, status, sucesso, data_troca, ultima_comunicacao, updated_at)
             VALUES ($1,$2,'concluida',$3,$4::date,$5::date,NOW())
             ON CONFLICT (modulo_selimp) DO UPDATE SET
               setor = COALESCE(EXCLUDED.setor, bateria_trocas.setor), status = 'concluida', sucesso = EXCLUDED.sucesso,
               data_troca = EXCLUDED.data_troca, ultima_comunicacao = EXCLUDED.ultima_comunicacao, updated_at = NOW()`,
            [selimp, lt.rows[0].setor, lt.rows[0].sucesso, lt.rows[0].data_troca, lt.rows[0].ultima_comunicacao],
          );
        } else {
          await client.query(`DELETE FROM bateria_trocas WHERE modulo_selimp = $1 AND status = 'concluida'`, [selimp]);
        }
        await client.query(
          `UPDATE modulo_selimp SET qtd_trocas = (SELECT COUNT(*) FROM bateria_trocas_eventos WHERE modulo_selimp = $1 AND status = 'concluida'), updated_at = NOW() WHERE modulo_selimp = $1`,
          [selimp],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
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

  // ===== Manutenção do MÓDULO (histórico) =====

  interface ModuloManutencaoRow {
    id: number;
    modulo_selimp: string;
    setor: string | null;
    execucao: string | null;
    motivo: string | null;
    data_retirada: string | null;
    data_reinstalacao: string | null;
    data_ordenado: string | null;
    data_manutencao: string | null;
    sinal_recuperado: boolean;
    oficial: boolean;
    contestado: boolean;
    dias_contestados: number | null;
    documento_url: string | null;
    documento_titulo: string | null;
    documentos: unknown;
    status: string | null;
    created_at: string;
  }

  interface ManutencaoArquivoDto {
    url: string;
    titulo: string;
    path?: string;
    contentType?: string;
  }

  function cleanArquivo(value: unknown): ManutencaoArquivoDto | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const obj = value as Record<string, unknown>;
    const url = String(obj.url ?? "").trim();
    if (!url) return null;
    return {
      url,
      titulo: String(obj.titulo ?? obj.nome ?? "Documento anexado").trim() || "Documento anexado",
      path: String(obj.path ?? "").trim() || undefined,
      contentType: String(obj.contentType ?? "").trim() || undefined,
    };
  }

  function cleanArquivos(value: unknown): ManutencaoArquivoDto[] {
    if (!Array.isArray(value)) return [];
    return value.map(cleanArquivo).filter((x): x is ManutencaoArquivoDto => Boolean(x));
  }

  function documentosFromRow(r: Pick<ModuloManutencaoRow, "documentos" | "documento_url" | "documento_titulo">): ManutencaoArquivoDto[] {
    const docs = cleanArquivos(r.documentos);
    if (docs.length > 0) return docs;
    if (r.documento_url) return [{ url: r.documento_url, titulo: r.documento_titulo || "Documento anexado" }];
    return [];
  }

  type ManutencaoStatus =
    | "EM_ANALISE" | "PENDENTE" | "RETIRANDO" | "ATIVA" | "REINSTALANDO" | "REALIZADA" | "SINAL_RECUPERADO";
  const MANUT_STATUSES: ManutencaoStatus[] = [
    "EM_ANALISE", "PENDENTE", "RETIRANDO", "ATIVA", "REINSTALANDO", "REALIZADA", "SINAL_RECUPERADO",
  ];
  const cleanStatus = (v: unknown): ManutencaoStatus | null => {
    const s = String(v ?? "").trim().toUpperCase();
    if (s === "RETIRADO") return "RETIRANDO"; // alias do nome antigo
    return MANUT_STATUSES.includes(s as ManutencaoStatus) ? (s as ManutencaoStatus) : null;
  };

  function deriveStatus(r: ModuloManutencaoRow): ManutencaoStatus {
    const explicit = cleanStatus(r.status);
    if (explicit) return explicit;
    if (r.data_manutencao) return "REALIZADA";
    if (r.sinal_recuperado) return "SINAL_RECUPERADO";
    if (r.data_reinstalacao) return "REINSTALANDO";
    if (r.data_retirada) return "ATIVA";
    if (r.data_ordenado) return "RETIRANDO";
    return "PENDENTE";
  }

  /** Contestação só quando há datas coerentes com a etapa ou pipeline completo (ordenado → retirada → reinstalação). */
  function isContestationEligibleRow(r: ModuloManutencaoRow): boolean {
    const status = deriveStatus(r);
    if (r.data_ordenado && r.data_retirada && r.data_reinstalacao) return true;
    if (status === "PENDENTE" || status === "EM_ANALISE") return false;
    if (status === "RETIRANDO") return Boolean(r.data_ordenado);
    if (status === "ATIVA" || status === "REINSTALANDO") return Boolean(r.data_ordenado && r.data_retirada);
    return false;
  }

  function mapManutencaoEvento(r: ModuloManutencaoRow) {
    return {
      id: r.id,
      selimp: r.modulo_selimp,
      setor: r.setor ?? undefined,
      execucao: r.execucao ?? undefined,
      motivo: r.motivo ?? undefined,
      dataOrdenado: r.data_ordenado ?? undefined,
      dataRetirada: r.data_retirada ?? undefined,
      dataReinstalacao: r.data_reinstalacao ?? undefined,
      dataManutencao: r.data_manutencao ?? undefined,
      sinalRecuperado: r.sinal_recuperado,
      oficial: r.oficial,
      contestado: r.contestado,
      diasContestados: r.dias_contestados ?? undefined,
      documentoUrl: r.documento_url ?? undefined,
      documentoTitulo: r.documento_titulo ?? undefined,
      documentos: documentosFromRow(r),
      // diasFrequencia e contestacaoDias (lista de dias de despacho na janela) são injetados pelo GET via batch.
      diasFrequencia: 0,
      contestacaoDias: [] as { data: string; contestado: boolean; printUrl?: string; printTitulo?: string; printPath?: string }[],
      status: deriveStatus(r),
      createdAt: r.created_at,
    };
  }

  const SELECT_MANUT_MODULO = `
    SELECT id, modulo_selimp, setor, execucao, motivo,
           data_retirada::text     AS data_retirada,
           data_reinstalacao::text AS data_reinstalacao,
           data_ordenado::text     AS data_ordenado,
           data_manutencao::text   AS data_manutencao,
           sinal_recuperado, oficial, contestado, dias_contestados, documento_url, documento_titulo, documentos, status,
           created_at::text AS created_at
      FROM modulo_manutencoes`;

  // Dias de frequência do setor na janela [data_ordenado, reinstalação|hoje]:
  // setores fixos usam dias_semana (token dom..sab); escalonados usam datas explícitas (cronograma_datas).
  const WEEKDAY_TOKENS = `(ARRAY['dom','seg','ter','qua','qui','sex','sab'])`;
  const FREQ_DAY_COND = `(
    (cs.dias_semana IS NOT NULL AND ${WEEKDAY_TOKENS}[EXTRACT(DOW FROM gd.d)::int + 1] = ANY(cs.dias_semana))
    OR EXISTS (SELECT 1 FROM cronograma_datas cd WHERE cd.setor = sm.setor AND cd.data = gd.d::date)
  )`;
  // Lista os dias de frequência na janela, marcando se cada dia foi contestado.
  const SELECT_CONTESTACAO_DIAS = `
    SELECT DISTINCT mm.id, gd.d::date::text AS dia,
           mc.print_url IS NOT NULL AS contestado,
           mc.print_url,
           mc.print_titulo,
           mc.print_path
      FROM modulo_manutencoes mm
      JOIN setores_modulos sm ON sm.selimp_codigo = mm.modulo_selimp
      LEFT JOIN cronograma_setores cs ON cs.setor = sm.setor
      CROSS JOIN LATERAL generate_series(
        mm.data_ordenado::timestamp,
        COALESCE(mm.data_reinstalacao, CURRENT_DATE)::timestamp,
        interval '1 day'
      ) AS gd(d)
      LEFT JOIN manutencao_contestacoes mc ON mc.modulo_selimp = mm.modulo_selimp AND mc.data = gd.d::date
     WHERE mm.data_ordenado IS NOT NULL AND ${FREQ_DAY_COND}
     ORDER BY mm.id, dia`;

  fastify.get("/modulo/manutencoes", async () => {
    const [res, diasRes] = await Promise.all([
      pool.query<ModuloManutencaoRow>(
        `${SELECT_MANUT_MODULO} ORDER BY modulo_selimp,
          COALESCE(data_manutencao, data_ordenado, created_at::date) DESC, created_at DESC, id DESC`
      ),
      pool.query<{ id: number; dia: string; contestado: boolean; print_url: string | null; print_titulo: string | null; print_path: string | null }>(SELECT_CONTESTACAO_DIAS),
    ]);
    const diasById = new Map<number, { data: string; contestado: boolean; printUrl?: string; printTitulo?: string; printPath?: string }[]>();
    for (const d of diasRes.rows) {
      const arr = diasById.get(d.id) ?? [];
      arr.push({
        data: d.dia,
        contestado: d.contestado,
        printUrl: d.print_url ?? undefined,
        printTitulo: d.print_titulo ?? undefined,
        printPath: d.print_path ?? undefined,
      });
      diasById.set(d.id, arr);
    }
    const history: Record<string, ReturnType<typeof mapManutencaoEvento>[]> = {};
    const records: Record<string, ReturnType<typeof mapManutencaoEvento>> = {};
    for (const r of res.rows) {
      const ev = mapManutencaoEvento(r);
      ev.contestacaoDias = diasById.get(r.id) ?? [];
      if (!isContestationEligibleRow(r)) {
        ev.contestacaoDias = [];
      }
      ev.diasFrequencia = ev.contestacaoDias.length;
      if (!history[ev.selimp]) history[ev.selimp] = [];
      history[ev.selimp].push(ev);
      // primeiro da lista (mais recente) define o estado corrente do módulo
      if (!records[ev.selimp]) records[ev.selimp] = ev;
    }
    return { records, history };
  });

  fastify.post<{
    Body: {
      items?: {
        selimp?: string;
        setor?: string;
        execucao?: string;
        motivo?: string;
        dataRetirada?: string;
        dataReinstalacao?: string;
        dataOrdenado?: string;
        dataManutencao?: string;
        sinalRecuperado?: boolean;
        oficial?: boolean;
        status?: string;
      }[];
    };
  }>("/modulo/manutencoes", async (request, reply) => {
    const items = (Array.isArray(request.body?.items) ? request.body.items : [])
      .map((it) => ({
        selimp: cleanSelimp(it?.selimp),
        setor: String(it?.setor ?? "").trim() || null,
        execucao: String(it?.execucao ?? "").trim() || null,
        motivo: String(it?.motivo ?? "").trim() || null,
        dataRetirada: isIsoDate(it?.dataRetirada) ? it.dataRetirada : null,
        dataReinstalacao: isIsoDate(it?.dataReinstalacao) ? it.dataReinstalacao : null,
        dataOrdenado: isIsoDate(it?.dataOrdenado) ? it.dataOrdenado : null,
        dataManutencao: isIsoDate(it?.dataManutencao) ? it.dataManutencao : null,
        sinalRecuperado: Boolean(it?.sinalRecuperado),
        oficial: it?.oficial === undefined ? true : Boolean(it.oficial),
        status: cleanStatus(it?.status),
      }))
      .filter((it) => it.selimp);
    if (items.length === 0) {
      return reply.code(400).send({ detail: "items deve conter ao menos um { selimp }" });
    }

    const inserted: ReturnType<typeof mapManutencaoEvento>[] = [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const it of items) {
        const res = await client.query<ModuloManutencaoRow>(
          `INSERT INTO modulo_manutencoes
             (modulo_selimp, setor, execucao, motivo, data_retirada, data_reinstalacao, data_ordenado, data_manutencao, sinal_recuperado, oficial, status)
           VALUES ($1, $2, $3, $4, $5::date, $6::date, $7::date, $8::date, $9, $10, $11)
           RETURNING id, modulo_selimp, setor, execucao, motivo,
             data_retirada::text AS data_retirada, data_reinstalacao::text AS data_reinstalacao,
             data_ordenado::text AS data_ordenado, data_manutencao::text AS data_manutencao,
             sinal_recuperado, oficial, contestado, dias_contestados, documento_url, documento_titulo, documentos, status, created_at::text AS created_at`,
          [it.selimp, it.setor, it.execucao, it.motivo, it.dataRetirada, it.dataReinstalacao, it.dataOrdenado, it.dataManutencao, it.sinalRecuperado, it.oficial, it.status]
        );
        if (res.rows[0]) inserted.push(mapManutencaoEvento(res.rows[0]));
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return { ok: true, registradas: inserted.length, eventos: inserted };
  });

  fastify.put<{
    Params: { id: string };
    Body: {
      setor?: string;
      execucao?: string;
      motivo?: string;
      dataRetirada?: string | null;
      dataReinstalacao?: string | null;
      dataOrdenado?: string | null;
      dataManutencao?: string | null;
      sinalRecuperado?: boolean;
      oficial?: boolean;
      contestado?: boolean;
      documentoUrl?: string | null;
      documentoTitulo?: string | null;
      documentos?: ManutencaoArquivoDto[];
      status?: string;
    };
  }>("/modulo/manutencoes/:id", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ detail: "id inválido" });
    const b = request.body ?? {};
    const res = await pool.query<ModuloManutencaoRow>(
      `UPDATE modulo_manutencoes SET
         setor = COALESCE($2, setor),
         execucao = COALESCE($3, execucao),
         motivo = COALESCE($4, motivo),
         data_retirada = CASE WHEN $5 = 'KEEP' THEN data_retirada ELSE NULLIF($5,'')::date END,
         data_reinstalacao = CASE WHEN $6 = 'KEEP' THEN data_reinstalacao ELSE NULLIF($6,'')::date END,
         data_ordenado = CASE WHEN $7 = 'KEEP' THEN data_ordenado ELSE NULLIF($7,'')::date END,
         data_manutencao = CASE WHEN $8 = 'KEEP' THEN data_manutencao ELSE NULLIF($8,'')::date END,
         sinal_recuperado = COALESCE($9, sinal_recuperado),
         oficial = COALESCE($10, oficial),
         contestado = COALESCE($12, contestado),
         documento_url = CASE WHEN $13 = 'KEEP' THEN documento_url ELSE NULLIF($13,'') END,
         documento_titulo = CASE WHEN $14 = 'KEEP' THEN documento_titulo ELSE NULLIF($14,'') END,
         documentos = CASE WHEN $15 = 'KEEP' THEN documentos ELSE $15::jsonb END,
         status = COALESCE($11, status),
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, modulo_selimp, setor, execucao, motivo,
         data_retirada::text AS data_retirada, data_reinstalacao::text AS data_reinstalacao,
         data_ordenado::text AS data_ordenado, data_manutencao::text AS data_manutencao,
         sinal_recuperado, oficial, contestado, dias_contestados, documento_url, documento_titulo, documentos, status, created_at::text AS created_at`,
      [
        id,
        b.setor != null ? String(b.setor).trim() : null,
        b.execucao != null ? String(b.execucao).trim() : null,
        b.motivo != null ? String(b.motivo).trim() : null,
        b.dataRetirada === undefined ? "KEEP" : isIsoDate(b.dataRetirada) ? b.dataRetirada : "",
        b.dataReinstalacao === undefined ? "KEEP" : isIsoDate(b.dataReinstalacao) ? b.dataReinstalacao : "",
        b.dataOrdenado === undefined ? "KEEP" : isIsoDate(b.dataOrdenado) ? b.dataOrdenado : "",
        b.dataManutencao === undefined ? "KEEP" : isIsoDate(b.dataManutencao) ? b.dataManutencao : "",
        typeof b.sinalRecuperado === "boolean" ? b.sinalRecuperado : null,
        typeof b.oficial === "boolean" ? b.oficial : null,
        cleanStatus(b.status),
        typeof b.contestado === "boolean" ? b.contestado : null,
        b.documentoUrl === undefined ? "KEEP" : (b.documentoUrl ?? ""),
        b.documentoTitulo === undefined ? "KEEP" : (b.documentoTitulo ?? ""),
        b.documentos === undefined ? "KEEP" : JSON.stringify(cleanArquivos(b.documentos)),
      ]
    );
    const row = res.rows[0];
    if (!row) return reply.code(404).send({ detail: "registro não encontrado" });

    // Dias de frequência na janela [data_ordenado, reinstalação|hoje] + status de contestação por dia.
    let contestacaoDias: { data: string; contestado: boolean; printUrl?: string; printTitulo?: string; printPath?: string }[] = [];
    if (row.data_ordenado && isContestationEligibleRow(row)) {
      const fr = await pool.query<{ dia: string; contestado: boolean; print_url: string | null; print_titulo: string | null; print_path: string | null }>(
        `SELECT DISTINCT gd.d::date::text AS dia,
                mc.print_url IS NOT NULL AS contestado,
                mc.print_url,
                mc.print_titulo,
                mc.print_path
           FROM setores_modulos sm
           LEFT JOIN cronograma_setores cs ON cs.setor = sm.setor
           CROSS JOIN LATERAL generate_series($2::timestamp, COALESCE($3::date, CURRENT_DATE)::timestamp, interval '1 day') AS gd(d)
           LEFT JOIN manutencao_contestacoes mc ON mc.modulo_selimp = $1 AND mc.data = gd.d::date
          WHERE sm.selimp_codigo = $1 AND ${FREQ_DAY_COND}
          ORDER BY dia`,
        [row.modulo_selimp, row.data_ordenado, row.data_reinstalacao],
      );
      contestacaoDias = fr.rows.map((r) => ({
        data: r.dia,
        contestado: r.contestado,
        printUrl: r.print_url ?? undefined,
        printTitulo: r.print_titulo ?? undefined,
        printPath: r.print_path ?? undefined,
      }));
    }
    // Congela a qtd. de dias contestados ao finalizar a manutenção.
    const eff = deriveStatus(row);
    const finalizado = eff === "REALIZADA" || eff === "SINAL_RECUPERADO" || !!row.data_reinstalacao;
    const diasContestados = finalizado ? contestacaoDias.filter((d) => d.contestado).length : null;
    if (diasContestados !== row.dias_contestados) {
      await pool.query(`UPDATE modulo_manutencoes SET dias_contestados = $2 WHERE id = $1`, [id, diasContestados]);
      row.dias_contestados = diasContestados;
    }

    const evento = mapManutencaoEvento(row);
    evento.contestacaoDias = contestacaoDias;
    evento.diasFrequencia = contestacaoDias.length;
    return { ok: true, evento };
  });

  // Contesta/descontesta um dia específico de despacho de um módulo em manutenção.
  fastify.post<{ Body: { selimp?: string; data?: string; contestado?: boolean; printUrl?: string | null; printTitulo?: string | null; printPath?: string | null } }>(
    "/modulo/contestacao",
    async (request, reply) => {
      const selimp = cleanSelimp(request.body?.selimp);
      const data = isIsoDate(request.body?.data) ? request.body!.data : null;
      if (!selimp || !data) return reply.code(400).send({ detail: "selimp e data (yyyy-MM-dd) são obrigatórios" });
      const contestado = request.body?.contestado !== false; // default true
      if (contestado) {
        const printUrl = String(request.body?.printUrl ?? "").trim();
        const printTitulo = String(request.body?.printTitulo ?? "").trim() || "Print da contestação";
        const printPath = String(request.body?.printPath ?? "").trim() || null;
        if (!printUrl) return reply.code(400).send({ detail: "O print da contestação é obrigatório." });
        await pool.query(
          `INSERT INTO manutencao_contestacoes (modulo_selimp, data, print_url, print_titulo, print_path)
           VALUES ($1, $2::date, $3, $4, $5)
           ON CONFLICT (modulo_selimp, data) DO UPDATE SET
             print_url = EXCLUDED.print_url,
             print_titulo = EXCLUDED.print_titulo,
             print_path = EXCLUDED.print_path`,
          [selimp, data, printUrl, printTitulo, printPath],
        );
      } else {
        await pool.query(`DELETE FROM manutencao_contestacoes WHERE modulo_selimp = $1 AND data = $2::date`, [selimp, data]);
      }
      return { ok: true };
    },
  );

  fastify.delete<{ Params: { id: string } }>("/modulo/manutencoes/:id", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ detail: "id inválido" });
    await pool.query(`DELETE FROM modulo_manutencoes WHERE id = $1`, [id]);
    return { ok: true };
  });

  // ===== Setores (gestão de atribuição de módulos) =====
  // Listagem do cadastro setor↔módulo; a edição é só de atribuição (SELIMP/DDMX + datas).

  fastify.get("/setores", async () => {
    const res = await pool.query(
      `SELECT id, setor, subprefeitura, servico, frequencia, dias_execucao,
              km_prod::float8 AS km_prod,
              selimp_codigo, selimp_instalacao::text AS selimp_instalacao,
              ddmx_codigo, ddmx_instalacao::text AS ddmx_instalacao
         FROM setores_modulos
        ORDER BY servico NULLS LAST, subprefeitura NULLS LAST, setor`
    );
    return { setores: res.rows };
  });

  fastify.put<{
    Params: { id: string };
    Body: {
      selimpCodigo?: string | null;
      selimpInstalacao?: string | null;
      ddmxCodigo?: string | null;
      ddmxInstalacao?: string | null;
    };
  }>("/setores/:id", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ detail: "id inválido" });
    const b = request.body ?? {};
    // undefined → mantém ("KEEP"); "" → limpa (NULL); valor → grava. Datas validadas com isIsoDate.
    const textParam = (v: string | null | undefined) =>
      v === undefined ? "KEEP" : v === null ? "" : String(v).trim();
    const dateParam = (v: string | null | undefined) =>
      v === undefined ? "KEEP" : isIsoDate(v) ? v : "";

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query(
        `UPDATE setores_modulos SET
           selimp_codigo    = CASE WHEN $2 = 'KEEP' THEN selimp_codigo    ELSE NULLIF($2,'')        END,
           selimp_instalacao = CASE WHEN $3 = 'KEEP' THEN selimp_instalacao ELSE NULLIF($3,'')::date END,
           ddmx_codigo      = CASE WHEN $4 = 'KEEP' THEN ddmx_codigo      ELSE NULLIF($4,'')        END,
           ddmx_instalacao  = CASE WHEN $5 = 'KEEP' THEN ddmx_instalacao  ELSE NULLIF($5,'')::date  END,
           updated_at = NOW()
         WHERE id = $1
         RETURNING id, setor, subprefeitura, servico, frequencia, dias_execucao,
                   km_prod::float8 AS km_prod,
                   selimp_codigo, selimp_instalacao::text AS selimp_instalacao,
                   ddmx_codigo, ddmx_instalacao::text AS ddmx_instalacao`,
        [
          id,
          textParam(b.selimpCodigo),
          dateParam(b.selimpInstalacao),
          textParam(b.ddmxCodigo),
          dateParam(b.ddmxInstalacao),
        ]
      );
      if (!res.rows[0]) {
        await client.query("ROLLBACK").catch(() => {});
        return reply.code(404).send({ detail: "setor não encontrado" });
      }
      // Reconstrói o snapshot por módulo para refletir a (re)atribuição no dashboard.
      await refreshModuloSelimp(client);
      await client.query("COMMIT");
      invalidatePrefix("ipt_modulos_bateria");
      invalidatePrefix("ipt_preview");
      return { ok: true, setor: res.rows[0] };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });
};
