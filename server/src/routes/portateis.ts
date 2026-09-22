import { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";

const SUBS = ["CV", "JT", "MG", "ST"] as const;

export interface PortatilAtribuicaoDto {
  subprefeitura: string | null;
  servico: string | null;
  origem: "historico" | "manual";
}

interface LatestRow {
  nome: string;
  data_exportacao: string;
  comunicacao: string;
  bateria_raw: string | null;
  bateria_percentual: string | null;
  bateria_desatualizada: boolean | null;
  ultima_comunicacao: Date | null;
}

interface HistoricoRow extends LatestRow {}

const SUCESSO_MIN_PCT = 60;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_RE.test(value);
}

function sucessoDaLeitura(percentual: number | null, desatualizada: boolean, temLeitura: boolean): boolean | null {
  if (!temLeitura) return null;
  if (desatualizada || percentual == null) return false;
  return percentual >= SUCESSO_MIN_PCT;
}

interface TrocaRow {
  nome: string;
  status: string;
  data_agendada: string | null;
  data_primeiro_agendamento: string | null;
  percentual_entrada: string | number | null;
  data_troca: string | null;
  ultima_comunicacao: string | null;
}

interface TrocaEventoRow extends TrocaRow {
  id: number;
  tipo_troca: string | null;
  bateria_antes_percentual: string | number | null;
  status_bateria_antes: string | null;
  snap_depois_pct: string | number | null;
  snap_depois_desat: boolean | null;
  tem_leitura_seguinte: boolean | null;
}

interface TrocaDto {
  nome: string;
  status: "agendada" | "concluida";
  dataAgendada: string | null;
  dataPrimeiroAgendamento: string | null;
  sucesso: boolean | null;
  percentualEntrada: number | null;
  dataTroca: string | null;
  ultimaComunicacao: string | null;
}

interface TrocaHistoricoDto extends TrocaDto {
  id: string;
  tipoTroca: string | null;
  statusBateriaAntes: string | null;
}

function mapTroca(row: TrocaRow, sucesso: boolean | null = null): TrocaDto {
  return {
    nome: row.nome,
    status: row.status === "concluida" ? "concluida" : "agendada",
    dataAgendada: row.data_agendada,
    dataPrimeiroAgendamento: row.data_primeiro_agendamento,
    sucesso,
    percentualEntrada: asPercentual(row.percentual_entrada == null ? null : String(row.percentual_entrada)),
    dataTroca: row.data_troca,
    ultimaComunicacao: row.ultima_comunicacao,
  };
}

function mapTrocaEvento(row: TrocaEventoRow): TrocaHistoricoDto {
  const temLeitura = Boolean(row.tem_leitura_seguinte);
  const sucesso = row.status === "concluida"
    ? sucessoDaLeitura(asPercentual(row.snap_depois_pct == null ? null : String(row.snap_depois_pct)), Boolean(row.snap_depois_desat), temLeitura)
    : null;
  return {
    ...mapTroca(row, sucesso),
    id: String(row.id),
    tipoTroca: row.tipo_troca,
    statusBateriaAntes: row.status_bateria_antes,
  };
}

interface VinculoRow {
  nome: string;
  subprefeitura: string | null;
  servico: string | null;
  origem: string | null;
}

function asText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function asPercentual(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapSnapshot(row: LatestRow) {
  return {
    dataExportacao: row.data_exportacao,
    comunicacao: row.comunicacao === "ON" ? "ON" as const : "OFF" as const,
    bateriaPercentual: asPercentual(row.bateria_percentual),
    bateriaDesatualizada: Boolean(row.bateria_desatualizada),
    ultimaComunicacao: row.ultima_comunicacao ? new Date(row.ultima_comunicacao).toISOString() : null,
  };
}

function mapAtribuicao(row: VinculoRow): PortatilAtribuicaoDto | null {
  const subprefeitura = asText(row.subprefeitura);
  const servico = asText(row.servico);
  if (!subprefeitura && !servico) return null;
  return {
    subprefeitura,
    servico,
    origem: row.origem === "historico" ? "historico" : "manual",
  };
}

export const portateisRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/portateis/modulos", async () => {
    const [latest, historico, servicos] = await Promise.all([
      pool.query<LatestRow>(`
        SELECT DISTINCT ON (nome)
          nome,
          data_exportacao::text AS data_exportacao,
          CASE
            WHEN UPPER(TRIM(COALESCE(status_comunicacao, ''))) = 'ON' THEN 'ON'
            ELSE 'OFF'
          END AS comunicacao,
          bateria_raw,
          bateria_percentual::text AS bateria_percentual,
          COALESCE(bateria_desatualizada, FALSE) AS bateria_desatualizada,
          ultima_comunicacao
        FROM ipt_dados_bateria
        WHERE tipo_modulo = 'PORTATIL'
        ORDER BY nome, data_exportacao DESC, updated_at DESC, id DESC
      `),
      pool.query<HistoricoRow>(`
        SELECT nome, data_exportacao, comunicacao, bateria_raw, bateria_percentual, bateria_desatualizada, ultima_comunicacao
          FROM (
            SELECT
              nome,
              data_exportacao::text AS data_exportacao,
              CASE
                WHEN UPPER(TRIM(COALESCE(status_comunicacao, ''))) = 'ON' THEN 'ON'
                ELSE 'OFF'
              END AS comunicacao,
              bateria_raw,
              bateria_percentual::text AS bateria_percentual,
              COALESCE(bateria_desatualizada, FALSE) AS bateria_desatualizada,
              ultima_comunicacao,
              ROW_NUMBER() OVER (
                PARTITION BY nome
                ORDER BY data_exportacao DESC, updated_at DESC, id DESC
              ) AS rn
            FROM (
              SELECT DISTINCT ON (nome, data_exportacao)
                nome, data_exportacao, status_comunicacao, bateria_raw, bateria_percentual,
                bateria_desatualizada, ultima_comunicacao, updated_at, id
              FROM ipt_dados_bateria
              WHERE tipo_modulo = 'PORTATIL'
              ORDER BY nome, data_exportacao DESC, updated_at DESC, id DESC
            ) unico
          ) ranked
         WHERE rn <= 30
         ORDER BY nome, data_exportacao DESC
      `),
      pool.query<{ servico: string }>(`
        SELECT DISTINCT trim(tipo_servico) AS servico
          FROM ipt_report_linhas
         WHERE equipamentos ILIKE '%PORTAT%'
           AND trim(COALESCE(tipo_servico, '')) <> ''
         ORDER BY 1
      `),
    ]);

    const nomes = latest.rows.map((row) => row.nome);
    const atribuicaoByNome = new Map<string, PortatilAtribuicaoDto | null>();
    if (nomes.length > 0) {
      const links = await pool.query<VinculoRow>(
        `SELECT nome, subprefeitura, servico, origem
           FROM portatil_vinculos
          WHERE nome = ANY($1::text[])`,
        [nomes],
      );
      for (const row of links.rows) atribuicaoByNome.set(row.nome, mapAtribuicao(row));
    }

    const historicoByNome = new Map<string, ReturnType<typeof mapSnapshot>[]>();
    for (const row of historico.rows) {
      const pontos = historicoByNome.get(row.nome) ?? [];
      pontos.push(mapSnapshot(row));
      historicoByNome.set(row.nome, pontos);
    }

    let dataExportacao: string | null = null;
    const modulos = latest.rows.map((row) => {
      if (!dataExportacao || row.data_exportacao > dataExportacao) dataExportacao = row.data_exportacao;
      return {
        ...mapSnapshot(row),
        nome: row.nome,
        dataExportacao: row.data_exportacao,
        bateriaRaw: asText(row.bateria_raw),
        atribuicao: atribuicaoByNome.get(row.nome) ?? null,
        historico: historicoByNome.get(row.nome) ?? [],
      };
    });

    modulos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return {
      modulos,
      dataExportacao,
      servicos: servicos.rows.map((row) => row.servico),
    };
  });

  fastify.put<{ Body: { nome?: unknown; subprefeitura?: unknown; servico?: unknown } }>(
    "/portateis/vinculos",
    async (request, reply) => {
      const nome = String(request.body?.nome ?? "").trim();
      if (!nome) return reply.code(400).send({ detail: "Informe o nome do módulo." });

      const subprefeitura = String(request.body?.subprefeitura ?? "").trim().toUpperCase();
      const servico = String(request.body?.servico ?? "").trim();
      const vazio = !subprefeitura && !servico;
      if (!vazio && (!subprefeitura || !servico)) {
        return reply.code(400).send({ detail: "Informe a sub e o serviço, ou limpe os dois." });
      }
      if (subprefeitura && !SUBS.includes(subprefeitura as (typeof SUBS)[number])) {
        return reply.code(400).send({ detail: "Sub inválida. Use CV, JT, MG ou ST." });
      }

      const exists = await pool.query(
        `SELECT 1 FROM ipt_dados_bateria WHERE tipo_modulo = 'PORTATIL' AND nome = $1 LIMIT 1`,
        [nome],
      );
      if ((exists.rowCount ?? 0) === 0) {
        return reply.code(400).send({ detail: "Módulo portátil não encontrado." });
      }

      await pool.query(
        `INSERT INTO portatil_vinculos (nome, subprefeitura, servico, origem, updated_at)
         VALUES ($1, $2, $3, 'manual', NOW())
         ON CONFLICT (nome) DO UPDATE SET
           subprefeitura = EXCLUDED.subprefeitura,
           servico = EXCLUDED.servico,
           origem = 'manual',
           updated_at = NOW()`,
        [nome, vazio ? null : subprefeitura, vazio ? null : servico],
      );

      return {
        ok: true,
        nome,
        atribuicao: vazio
          ? null
          : { subprefeitura, servico, origem: "manual" as const },
      };
    },
  );

  fastify.get("/portateis/trocas", async () => {
    const [atuais, eventos] = await Promise.all([
      pool.query<TrocaRow>(`
        SELECT nome, status,
               data_agendada::text AS data_agendada,
               data_primeiro_agendamento::text AS data_primeiro_agendamento,
               percentual_entrada,
               data_troca::text AS data_troca,
               ultima_comunicacao::text AS ultima_comunicacao
          FROM portatil_bateria_trocas
         ORDER BY nome
      `),
      pool.query<TrocaEventoRow>(`
        SELECT e.id, e.nome, e.status, e.tipo_troca,
               e.data_agendada::text AS data_agendada,
               e.data_primeiro_agendamento::text AS data_primeiro_agendamento,
               e.percentual_entrada,
               e.data_troca::text AS data_troca,
               e.ultima_comunicacao::text AS ultima_comunicacao,
               e.bateria_antes_percentual,
               e.status_bateria_antes,
               depois.bateria_percentual AS snap_depois_pct,
               COALESCE(depois.bateria_desatualizada, FALSE) AS snap_depois_desat,
               (depois.nome IS NOT NULL) AS tem_leitura_seguinte
          FROM portatil_bateria_trocas_eventos e
          LEFT JOIN LATERAL (
            SELECT d.nome, d.bateria_percentual, d.bateria_desatualizada
              FROM ipt_dados_bateria d
             WHERE d.tipo_modulo = 'PORTATIL'
               AND d.nome = e.nome
               AND e.data_troca IS NOT NULL
               AND d.data_exportacao > e.data_troca
             ORDER BY d.data_exportacao ASC
             LIMIT 1
          ) depois ON TRUE
         ORDER BY e.nome, COALESCE(e.data_troca, e.data_agendada) DESC NULLS LAST, e.created_at DESC, e.id DESC
      `),
    ]);

    const records: Record<string, TrocaDto> = {};
    const history: Record<string, TrocaHistoricoDto[]> = {};
    for (const row of atuais.rows) records[row.nome] = mapTroca(row);
    for (const row of eventos.rows) {
      const items = history[row.nome] ?? [];
      items.push(mapTrocaEvento(row));
      history[row.nome] = items;
    }
    for (const [nome, items] of Object.entries(history)) {
      const rec = records[nome];
      const concluidas = items.filter((item) => item.status === "concluida");
      if (rec?.status === "agendada") {
        const agendada = items.find((item) => item.status === "agendada");
        history[nome] = agendada
          ? [{ ...agendada, dataAgendada: rec.dataAgendada ?? null, dataPrimeiroAgendamento: rec.dataPrimeiroAgendamento ?? null }, ...concluidas]
          : concluidas;
      } else {
        history[nome] = concluidas;
      }
      if (rec?.status === "concluida") {
        rec.sucesso = history[nome].find((item) => item.status === "concluida")?.sucesso ?? null;
      }
    }
    return { records, history };
  });

  fastify.post<{ Body: { items?: { nome?: unknown; dataAgendada?: unknown }[] } }>(
    "/portateis/trocas/agendar",
    async (request, reply) => {
      const items = (Array.isArray(request.body?.items) ? request.body.items : [])
        .map((item) => ({
          nome: String(item?.nome ?? "").trim(),
          dataAgendada: item?.dataAgendada,
        }))
        .filter((item) => item.nome && isIsoDate(item.dataAgendada));
      if (items.length === 0) {
        return reply.code(400).send({ detail: "Informe ao menos um { nome, dataAgendada }." });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const item of items) {
          const existe = await client.query(
            `SELECT 1 FROM ipt_dados_bateria WHERE tipo_modulo = 'PORTATIL' AND nome = $1 LIMIT 1`,
            [item.nome],
          );
          if ((existe.rowCount ?? 0) === 0) continue;
          const atual = await client.query<{ primeiro: string | null }>(
            `SELECT COALESCE(
                (SELECT MIN(COALESCE(data_primeiro_agendamento, data_agendada))::text
                   FROM portatil_bateria_trocas_eventos
                  WHERE nome = $1 AND status = 'agendada'),
                (SELECT COALESCE(data_primeiro_agendamento, data_agendada)::text
                   FROM portatil_bateria_trocas
                  WHERE nome = $1 AND status = 'agendada'),
                $2::date::text
              ) AS primeiro`,
            [item.nome, item.dataAgendada],
          );
          const primeiro = atual.rows[0]?.primeiro ?? item.dataAgendada;
          await client.query(
            `INSERT INTO portatil_bateria_trocas (nome, status, data_agendada, data_primeiro_agendamento, updated_at)
             VALUES ($1, 'agendada', $2::date, $3::date, NOW())
             ON CONFLICT (nome) DO UPDATE SET
               status = 'agendada',
               data_agendada = EXCLUDED.data_agendada,
               data_primeiro_agendamento = CASE
                 WHEN portatil_bateria_trocas.status = 'agendada' THEN COALESCE(
                   portatil_bateria_trocas.data_primeiro_agendamento,
                   portatil_bateria_trocas.data_agendada,
                   EXCLUDED.data_primeiro_agendamento
                 )
                 ELSE EXCLUDED.data_primeiro_agendamento
               END,
               sucesso = NULL,
               percentual_entrada = NULL,
               data_troca = NULL,
               ultima_comunicacao = NULL,
               updated_at = NOW()`,
            [item.nome, item.dataAgendada, primeiro],
          );
          await client.query(
            `DELETE FROM portatil_bateria_trocas_eventos WHERE nome = $1 AND status = 'agendada'`,
            [item.nome],
          );
          await client.query(
            `INSERT INTO portatil_bateria_trocas_eventos (nome, status, tipo_troca, data_agendada, data_primeiro_agendamento)
             VALUES ($1, 'agendada', 'Agendamento', $2::date, $3::date)`,
            [item.nome, item.dataAgendada, primeiro],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      return { ok: true, agendadas: items.length };
    },
  );

  fastify.post<{ Body: { items?: { nome?: unknown; dataTroca?: unknown }[] } }>(
    "/portateis/trocas/concluir",
    async (request, reply) => {
      const items = (Array.isArray(request.body?.items) ? request.body.items : [])
        .map((item) => ({ nome: String(item?.nome ?? "").trim(), dataTroca: item?.dataTroca }))
        .filter((item) => item.nome && isIsoDate(item.dataTroca));
      if (items.length === 0) {
        return reply.code(400).send({ detail: "Informe ao menos um { nome, dataTroca }." });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const item of items) {
          const antes = await client.query<{
            percentual: string | null;
            desatualizada: boolean | null;
            raw: string | null;
            ultima: string | null;
          }>(
            `SELECT bateria_percentual::text AS percentual,
                    bateria_desatualizada AS desatualizada,
                    bateria_raw AS raw,
                    ultima_comunicacao::date::text AS ultima
               FROM ipt_dados_bateria
              WHERE tipo_modulo = 'PORTATIL' AND nome = $1 AND data_exportacao <= $2::date
              ORDER BY data_exportacao DESC
              LIMIT 1`,
            [item.nome, item.dataTroca],
          );
          const leituraAntes = antes.rows[0];
          const agendamento = await client.query<{ data_agendada: string | null; primeiro: string | null }>(
            `SELECT data_agendada::text AS data_agendada,
                    COALESCE(data_primeiro_agendamento, data_agendada, $2::date)::text AS primeiro
               FROM portatil_bateria_trocas
              WHERE nome = $1 AND status = 'agendada'`,
            [item.nome, item.dataTroca],
          );
          const dataAgendada = agendamento.rows[0]?.data_agendada ?? null;
          const primeiro = agendamento.rows[0]?.primeiro ?? item.dataTroca;
          const percentualEntrada = asPercentual(leituraAntes?.percentual ?? null);
          await client.query(
            `INSERT INTO portatil_bateria_trocas (
               nome, status, data_agendada, data_primeiro_agendamento,
               sucesso, percentual_entrada, data_troca, ultima_comunicacao, updated_at
             )
             VALUES ($1, 'concluida', $2::date, $3::date, NULL, $4, $5::date, $6::date, NOW())
             ON CONFLICT (nome) DO UPDATE SET
               status = 'concluida',
               data_agendada = COALESCE(portatil_bateria_trocas.data_agendada, EXCLUDED.data_agendada),
               data_primeiro_agendamento = COALESCE(
                 portatil_bateria_trocas.data_primeiro_agendamento,
                 EXCLUDED.data_primeiro_agendamento
               ),
               sucesso = NULL,
               percentual_entrada = EXCLUDED.percentual_entrada,
               data_troca = EXCLUDED.data_troca,
               ultima_comunicacao = EXCLUDED.ultima_comunicacao,
               updated_at = NOW()`,
            [item.nome, dataAgendada, primeiro, percentualEntrada, item.dataTroca, leituraAntes?.ultima ?? null],
          );
          await client.query(
            `INSERT INTO portatil_bateria_trocas_eventos (
               nome, status, tipo_troca, data_agendada, data_primeiro_agendamento,
               percentual_entrada, data_troca, ultima_comunicacao,
               bateria_antes_raw, bateria_antes_percentual, status_bateria_antes
             )
             VALUES ($1, 'concluida', 'Conclusão', $2::date, $3::date, $4, $5::date, $6::date, $7, $8, $9)`,
            [
              item.nome,
              dataAgendada,
              primeiro,
              percentualEntrada,
              item.dataTroca,
              leituraAntes?.ultima ?? null,
              leituraAntes?.raw ?? null,
              percentualEntrada,
              leituraAntes?.desatualizada ? "DESATUALIZADA" : null,
            ],
          );
          await client.query(
            `DELETE FROM portatil_bateria_trocas_eventos WHERE nome = $1 AND status = 'agendada'`,
            [item.nome],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      return { ok: true, concluidas: items.length };
    },
  );

  fastify.delete<{ Params: { nome: string } }>("/portateis/trocas/:nome", async (request, reply) => {
    const nome = decodeURIComponent(String(request.params.nome ?? "")).trim();
    if (!nome) return reply.code(400).send({ detail: "Informe o nome do módulo." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM portatil_bateria_trocas WHERE nome = $1 AND status = 'agendada'`, [nome]);
      await client.query(`DELETE FROM portatil_bateria_trocas_eventos WHERE nome = $1 AND status = 'agendada'`, [nome]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return { ok: true };
  });
};
