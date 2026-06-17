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

/**
 * Sucesso automático da troca a partir do snapshot logo APÓS a data da troca:
 * - false quando a bateria continua desatualizada (não recuperou o status);
 * - true quando recuperou;
 * - undefined quando ainda não há leitura posterior à troca ("Aguardando avaliação").
 */
function sucessoFromDepois(r: TrocaEventoRow): boolean | undefined {
  const hasDepois = r.snap_depois_raw != null || r.snap_depois_pct != null;
  if (!hasDepois) return undefined;
  const desat = Boolean(r.snap_depois_desat) || /desatualizada/i.test(String(r.snap_depois_raw ?? ""));
  return !desat;
}

/** Tem sinal = comunicação ON e bateria não desatualizada. */
function temSinal(sinal: string | null, raw: string | null, desat: boolean | null): boolean {
  const on = String(sinal ?? "").trim().toUpperCase() === "ON";
  const desatualizada = Boolean(desat) || (raw != null && /desatualizada/i.test(raw));
  return on && !desatualizada;
}

/**
 * Classifica automaticamente o tipo da troca a partir dos snapshots reais
 * (planilhas de bateria) antes e depois da troca:
 * - CORRETIVA: estava sem sinal/desatualizado antes e voltou a computar depois.
 * - PREVENTIVA: tinha sinal mas bateria baixa antes e a bateria subiu depois.
 * - DESNECESSÁRIA: bateria ficou menor que antes, ou tinha sinal e ficou sem sinal.
 * Retorna undefined quando ainda não há snapshot posterior para decidir.
 */
function classifyTipoTroca(
  antesPct: number | null,
  antesSinal: string | null,
  antesRaw: string | null,
  antesDesat: boolean | null,
  depoisPct: number | null,
  depoisSinal: string | null,
  depoisRaw: string | null,
  depoisDesat: boolean | null,
): string | undefined {
  // Sem nenhum dado "depois" não dá para classificar ainda.
  if (depoisPct == null && (depoisSinal == null || depoisSinal === "")) return undefined;
  const sinalAntes = temSinal(antesSinal, antesRaw, antesDesat);
  const sinalDepois = temSinal(depoisSinal, depoisRaw, depoisDesat);
  const baixaAntes = antesPct != null && antesPct <= 30;
  const aumentou = antesPct != null && depoisPct != null && depoisPct > antesPct;
  const diminuiu = antesPct != null && depoisPct != null && depoisPct < antesPct;

  if (!sinalAntes && sinalDepois) return "CORRETIVA";
  if (diminuiu || (sinalAntes && !sinalDepois)) return "DESNECESSÁRIA";
  if (sinalAntes && baixaAntes && aumentou) return "PREVENTIVA";
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
  return {
    ...mapTroca(r),
    id: String(r.id),
    sucesso: sucessoAuto,
    tipoTroca: tipoAuto ?? r.tipo_troca ?? undefined,
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
    data_ordenado: string | null;
    data_manutencao: string | null;
    sinal_recuperado: boolean;
    status: string | null;
    created_at: string;
  }

  type ManutencaoStatus = "EM_ANALISE" | "PENDENTE" | "ATIVA" | "REALIZADA" | "SINAL_RECUPERADO";
  const MANUT_STATUSES: ManutencaoStatus[] = ["EM_ANALISE", "PENDENTE", "ATIVA", "REALIZADA", "SINAL_RECUPERADO"];
  const cleanStatus = (v: unknown): ManutencaoStatus | null =>
    MANUT_STATUSES.includes(String(v ?? "").trim().toUpperCase() as ManutencaoStatus)
      ? (String(v).trim().toUpperCase() as ManutencaoStatus)
      : null;

  function deriveStatus(r: ModuloManutencaoRow): ManutencaoStatus {
    const explicit = cleanStatus(r.status);
    if (explicit) return explicit;
    if (r.data_manutencao) return "REALIZADA";
    if (r.sinal_recuperado) return "SINAL_RECUPERADO";
    if (r.data_ordenado) return "ATIVA";
    return "PENDENTE";
  }

  function mapManutencaoEvento(r: ModuloManutencaoRow) {
    return {
      id: r.id,
      selimp: r.modulo_selimp,
      setor: r.setor ?? undefined,
      execucao: r.execucao ?? undefined,
      motivo: r.motivo ?? undefined,
      dataOrdenado: r.data_ordenado ?? undefined,
      dataManutencao: r.data_manutencao ?? undefined,
      sinalRecuperado: r.sinal_recuperado,
      status: deriveStatus(r),
      createdAt: r.created_at,
    };
  }

  const SELECT_MANUT_MODULO = `
    SELECT id, modulo_selimp, setor, execucao, motivo,
           data_ordenado::text  AS data_ordenado,
           data_manutencao::text AS data_manutencao,
           sinal_recuperado, status,
           created_at::text AS created_at
      FROM modulo_manutencoes`;

  fastify.get("/modulo/manutencoes", async () => {
    const res = await pool.query<ModuloManutencaoRow>(
      `${SELECT_MANUT_MODULO} ORDER BY modulo_selimp,
        COALESCE(data_manutencao, data_ordenado, created_at::date) DESC, created_at DESC, id DESC`
    );
    const history: Record<string, ReturnType<typeof mapManutencaoEvento>[]> = {};
    const records: Record<string, ReturnType<typeof mapManutencaoEvento>> = {};
    for (const r of res.rows) {
      const ev = mapManutencaoEvento(r);
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
        dataOrdenado?: string;
        dataManutencao?: string;
        sinalRecuperado?: boolean;
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
        dataOrdenado: isIsoDate(it?.dataOrdenado) ? it.dataOrdenado : null,
        dataManutencao: isIsoDate(it?.dataManutencao) ? it.dataManutencao : null,
        sinalRecuperado: Boolean(it?.sinalRecuperado),
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
             (modulo_selimp, setor, execucao, motivo, data_ordenado, data_manutencao, sinal_recuperado, status)
           VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8)
           RETURNING id, modulo_selimp, setor, execucao, motivo,
             data_ordenado::text AS data_ordenado, data_manutencao::text AS data_manutencao,
             sinal_recuperado, status, created_at::text AS created_at`,
          [it.selimp, it.setor, it.execucao, it.motivo, it.dataOrdenado, it.dataManutencao, it.sinalRecuperado, it.status]
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
      dataOrdenado?: string | null;
      dataManutencao?: string | null;
      sinalRecuperado?: boolean;
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
         data_ordenado = CASE WHEN $5 = 'KEEP' THEN data_ordenado ELSE NULLIF($5,'')::date END,
         data_manutencao = CASE WHEN $6 = 'KEEP' THEN data_manutencao ELSE NULLIF($6,'')::date END,
         sinal_recuperado = COALESCE($7, sinal_recuperado),
         status = COALESCE($8, status),
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, modulo_selimp, setor, execucao, motivo,
         data_ordenado::text AS data_ordenado, data_manutencao::text AS data_manutencao,
         sinal_recuperado, status, created_at::text AS created_at`,
      [
        id,
        b.setor != null ? String(b.setor).trim() : null,
        b.execucao != null ? String(b.execucao).trim() : null,
        b.motivo != null ? String(b.motivo).trim() : null,
        b.dataOrdenado === undefined ? "KEEP" : isIsoDate(b.dataOrdenado) ? b.dataOrdenado : "",
        b.dataManutencao === undefined ? "KEEP" : isIsoDate(b.dataManutencao) ? b.dataManutencao : "",
        typeof b.sinalRecuperado === "boolean" ? b.sinalRecuperado : null,
        cleanStatus(b.status),
      ]
    );
    if (!res.rows[0]) return reply.code(404).send({ detail: "registro não encontrado" });
    return { ok: true, evento: mapManutencaoEvento(res.rows[0]) };
  });

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
