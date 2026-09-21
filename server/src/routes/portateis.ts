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
    const [latest, servicos] = await Promise.all([
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

    let dataExportacao: string | null = null;
    const modulos = latest.rows.map((row) => {
      if (!dataExportacao || row.data_exportacao > dataExportacao) dataExportacao = row.data_exportacao;
      return {
        nome: row.nome,
        dataExportacao: row.data_exportacao,
        comunicacao: row.comunicacao === "ON" ? "ON" as const : "OFF" as const,
        bateriaRaw: asText(row.bateria_raw),
        bateriaPercentual: asPercentual(row.bateria_percentual),
        bateriaDesatualizada: Boolean(row.bateria_desatualizada),
        ultimaComunicacao: row.ultima_comunicacao ? new Date(row.ultima_comunicacao).toISOString() : null,
        atribuicao: atribuicaoByNome.get(row.nome) ?? null,
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
};
