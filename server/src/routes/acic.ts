import { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";

/** Converte data FLIP (dd/MM/yyyy ou dd/MM/yyyy HH:mm:ss) para yyyy-MM-dd */
function flipDateToYyyyMmDd(s: string | null | undefined): string | null {
  if (!s || typeof s !== "string") return null;
  const t = s.trim();
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function getNAcic(raw: Record<string, unknown>): string | null {
  const v = raw.N_ACIC ?? raw.n_acic;
  return v != null ? String(v).trim() : null;
}

type OverrideRow = {
  defesa: boolean;
  sem_recurso: boolean;
  valor: number | null;
  entendimento_defesa_previa: string | null;
  motivo_penalidade: string | null;
  multa_clausula_texto: string | null;
  multa_valor_estimativa: boolean;
  valor_estimativa: number | null;
};

export const acicRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Querystring: { periodo_inicial?: string; periodo_final?: string };
  }>("/acic", async (request, reply) => {
    const { periodo_inicial, periodo_final } = request.query;
    let r = await pool.query("SELECT id, raw, source_file, created_at FROM acic ORDER BY created_at DESC LIMIT 1000");
    let rows = r.rows;

    if (periodo_inicial || periodo_final) {
      rows = rows.filter((row) => {
        const raw = (row.raw ?? {}) as Record<string, string>;
        const dataStr =
          raw.Data_ACIC ?? raw.data_acic ?? raw.Data_Fiscalizacao ?? raw.data_fiscalizacao ?? raw.Data_Sincronizacao ?? raw.data_sincronizacao ?? "";
        const yyyyMmDd = flipDateToYyyyMmDd(dataStr);
        if (!yyyyMmDd) return true;
        if (periodo_inicial && yyyyMmDd < periodo_inicial) return false;
        if (periodo_final && yyyyMmDd > periodo_final) return false;
        return true;
      });
    }

    const seenNAcic = new Set<string>();
    const deduped: typeof rows = [];
    for (const row of rows) {
      const raw = (row.raw ?? {}) as Record<string, unknown>;
      const n = getNAcic(raw);
      if (n) {
        if (seenNAcic.has(n)) continue;
        seenNAcic.add(n);
      }
      deduped.push(row);
    }
    rows = deduped;

    const overridesRes = await pool.query(
      "SELECT n_acic, defesa, sem_recurso, valor, entendimento_defesa_previa, motivo_penalidade, multa_clausula_texto, multa_valor_estimativa, valor_estimativa FROM acic_overrides"
    );
    const overridesMap = new Map<string, OverrideRow>();
    for (const o of overridesRes.rows) {
      overridesMap.set(String(o.n_acic), {
        defesa: Boolean(o.defesa),
        sem_recurso: Boolean(o.sem_recurso),
        valor: o.valor != null ? Number(o.valor) : null,
        entendimento_defesa_previa:
          o.entendimento_defesa_previa != null ? String(o.entendimento_defesa_previa) : null,
        motivo_penalidade: o.motivo_penalidade != null ? String(o.motivo_penalidade) : null,
        multa_clausula_texto: o.multa_clausula_texto != null ? String(o.multa_clausula_texto) : null,
        multa_valor_estimativa: Boolean(o.multa_valor_estimativa),
        valor_estimativa: o.valor_estimativa != null ? Number(o.valor_estimativa) : null,
      });
    }

    const items = rows.map((row) => {
      const raw = (row.raw ?? {}) as Record<string, unknown>;
      const nAcic = getNAcic(raw);
      const over = nAcic ? overridesMap.get(nAcic) : null;
      return {
        id: String(row.id),
        ...row.raw,
        source_file: row.source_file,
        _defesa: over?.defesa ?? false,
        _sem_recurso: over?.sem_recurso ?? false,
        _valor_override: over?.valor ?? null,
        _valor_estimativa_override: over?.valor_estimativa ?? null,
        _entendimento_defesa_previa: over?.entendimento_defesa_previa ?? null,
        _motivo_penalidade: over?.motivo_penalidade ?? null,
        _multa_clausula_texto: over?.multa_clausula_texto ?? null,
        _multa_valor_estimativa: over?.multa_valor_estimativa ?? false,
      };
    });

    return { items, total: items.length };
  });

  fastify.patch<{
    Params: { n_acic: string };
    Body: {
      defesa?: boolean;
      sem_recurso?: boolean;
      valor?: number | null;
      valor_estimativa?: number | null;
      entendimento_defesa_previa?: string | null;
      motivo_penalidade?: string | null;
      multa_clausula_texto?: string | null;
      multa_valor_estimativa?: boolean;
    };
  }>("/acic/overrides/:n_acic", async (request, reply) => {
    const { n_acic } = request.params;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const nAcic = String(n_acic ?? "").trim();
    if (!nAcic) return reply.code(400).send({ detail: "n_acic obrigatório" });

    const existing = await pool.query(
      "SELECT defesa, sem_recurso, valor, entendimento_defesa_previa, motivo_penalidade, multa_clausula_texto, multa_valor_estimativa, valor_estimativa FROM acic_overrides WHERE n_acic = $1",
      [nAcic]
    );
    const old = existing.rows[0];
    const newDefesa = "defesa" in body ? Boolean(body.defesa) : (old?.defesa ?? false);
    const newSemRecurso = "sem_recurso" in body ? Boolean(body.sem_recurso) : (old?.sem_recurso ?? false);
    const finalValor =
      "valor" in body ? (body.valor != null ? Number(body.valor) : null) : (old?.valor != null ? Number(old.valor) : null);
    const finalValorEstimativa =
      "valor_estimativa" in body
        ? body.valor_estimativa != null
          ? Number(body.valor_estimativa)
          : null
        : old?.valor_estimativa != null
          ? Number(old.valor_estimativa)
          : null;
    const finalEntendimento =
      "entendimento_defesa_previa" in body
        ? body.entendimento_defesa_previa == null || String(body.entendimento_defesa_previa).trim() === ""
          ? null
          : String(body.entendimento_defesa_previa)
        : old?.entendimento_defesa_previa != null
          ? String(old.entendimento_defesa_previa)
          : null;
    const finalMotivo =
      "motivo_penalidade" in body
        ? body.motivo_penalidade == null || String(body.motivo_penalidade).trim() === ""
          ? null
          : String(body.motivo_penalidade)
        : old?.motivo_penalidade != null
          ? String(old.motivo_penalidade)
          : null;
    const finalClausula =
      "multa_clausula_texto" in body
        ? body.multa_clausula_texto == null || String(body.multa_clausula_texto).trim() === ""
          ? null
          : String(body.multa_clausula_texto)
        : old?.multa_clausula_texto != null
          ? String(old.multa_clausula_texto)
          : null;
    const finalEstimativa =
      "multa_valor_estimativa" in body ? Boolean(body.multa_valor_estimativa) : Boolean(old?.multa_valor_estimativa ?? false);

    await pool.query(
      `INSERT INTO acic_overrides (n_acic, defesa, sem_recurso, valor, entendimento_defesa_previa, motivo_penalidade, multa_clausula_texto, multa_valor_estimativa, valor_estimativa, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (n_acic) DO UPDATE SET
         defesa = $2,
         sem_recurso = $3,
         valor = $4,
         entendimento_defesa_previa = $5,
         motivo_penalidade = $6,
         multa_clausula_texto = $7,
         multa_valor_estimativa = $8,
         valor_estimativa = $9,
         updated_at = NOW()`,
      [
        nAcic,
        newDefesa,
        newSemRecurso,
        finalValor,
        finalEntendimento,
        finalMotivo,
        finalClausula,
        finalEstimativa,
        finalValorEstimativa,
      ]
    );

    const r = await pool.query(
      "SELECT n_acic, defesa, sem_recurso, valor, entendimento_defesa_previa, motivo_penalidade, multa_clausula_texto, multa_valor_estimativa, valor_estimativa FROM acic_overrides WHERE n_acic = $1",
      [nAcic]
    );
    const row = r.rows[0];
    return {
      n_acic: row.n_acic,
      defesa: Boolean(row.defesa),
      sem_recurso: Boolean(row.sem_recurso),
      valor: row.valor != null ? Number(row.valor) : null,
      valor_estimativa: row.valor_estimativa != null ? Number(row.valor_estimativa) : null,
      entendimento_defesa_previa:
        row.entendimento_defesa_previa != null ? String(row.entendimento_defesa_previa) : null,
      motivo_penalidade: row.motivo_penalidade != null ? String(row.motivo_penalidade) : null,
      multa_clausula_texto: row.multa_clausula_texto != null ? String(row.multa_clausula_texto) : null,
      multa_valor_estimativa: Boolean(row.multa_valor_estimativa),
    };
  });

  fastify.get<{ Params: { id: string } }>("/acic/:id", async (request, reply) => {
    const r = await pool.query("SELECT * FROM acic WHERE id = $1", [request.params.id]);
    if (r.rows.length === 0) return reply.code(404).send({ detail: "ACIC não encontrado" });
    const row = r.rows[0];
    return { id: String(row.id), ...row.raw };
  });
};
