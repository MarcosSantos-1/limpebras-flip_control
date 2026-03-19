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

    const overridesRes = await pool.query("SELECT n_acic, defesa, sem_recurso, valor FROM acic_overrides");
    const overridesMap = new Map<string, { defesa: boolean; sem_recurso: boolean; valor: number | null }>();
    for (const o of overridesRes.rows) {
      overridesMap.set(String(o.n_acic), {
        defesa: Boolean(o.defesa),
        sem_recurso: Boolean(o.sem_recurso),
        valor: o.valor != null ? Number(o.valor) : null,
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
      };
    });

    return { items, total: items.length };
  });

  fastify.patch<{
    Params: { n_acic: string };
    Body: { defesa?: boolean; sem_recurso?: boolean; valor?: number | null };
  }>("/acic/overrides/:n_acic", async (request, reply) => {
    const { n_acic } = request.params;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const nAcic = String(n_acic ?? "").trim();
    if (!nAcic) return reply.code(400).send({ detail: "n_acic obrigatório" });

    const existing = await pool.query("SELECT defesa, sem_recurso, valor FROM acic_overrides WHERE n_acic = $1", [nAcic]);
    const old = existing.rows[0];
    const newDefesa = "defesa" in body ? Boolean(body.defesa) : (old?.defesa ?? false);
    const newSemRecurso = "sem_recurso" in body ? Boolean(body.sem_recurso) : (old?.sem_recurso ?? false);
    const finalValor =
      "valor" in body ? (body.valor != null ? Number(body.valor) : null) : (old?.valor != null ? Number(old.valor) : null);

    await pool.query(
      `INSERT INTO acic_overrides (n_acic, defesa, sem_recurso, valor, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (n_acic) DO UPDATE SET
         defesa = $2,
         sem_recurso = $3,
         valor = $4,
         updated_at = NOW()`,
      [nAcic, newDefesa, newSemRecurso, finalValor]
    );

    const r = await pool.query("SELECT n_acic, defesa, sem_recurso, valor FROM acic_overrides WHERE n_acic = $1", [nAcic]);
    const row = r.rows[0];
    return {
      n_acic: row.n_acic,
      defesa: Boolean(row.defesa),
      sem_recurso: Boolean(row.sem_recurso),
      valor: row.valor != null ? Number(row.valor) : null,
    };
  });

  fastify.get<{ Params: { id: string } }>("/acic/:id", async (request, reply) => {
    const r = await pool.query("SELECT * FROM acic WHERE id = $1", [request.params.id]);
    if (r.rows.length === 0) return reply.code(404).send({ detail: "ACIC não encontrado" });
    const row = r.rows[0];
    return { id: String(row.id), ...row.raw };
  });
};
