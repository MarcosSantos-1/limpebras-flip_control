import type { FastifyPluginAsync } from "fastify";
import { loadGargaloDetalhe, loadGargalos } from "../services/ipt-gargalos-load.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function periodo(inicio: string | undefined, fim: string | undefined): { inicio: string; fim: string } | null {
  const a = (inicio ?? "").trim();
  const b = (fim ?? "").trim();
  if (!ISO_DATE.test(a) || !ISO_DATE.test(b) || a > b) return null;
  return { inicio: a, fim: b };
}

export const gargalosRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { inicio?: string; fim?: string } }>("/ipt/gargalos", async (request, reply) => {
    const p = periodo(request.query.inicio, request.query.fim);
    if (!p) return reply.code(400).send({ detail: "inicio e fim obrigatórios (YYYY-MM-DD)." });
    return loadGargalos(p.inicio, p.fim);
  });

  fastify.get<{ Params: { plano: string }; Querystring: { inicio?: string; fim?: string } }>(
    "/ipt/gargalos/:plano",
    async (request, reply) => {
      const p = periodo(request.query.inicio, request.query.fim);
      if (!p) return reply.code(400).send({ detail: "inicio e fim obrigatórios (YYYY-MM-DD)." });
      const plano = decodeURIComponent(request.params.plano ?? "").trim();
      if (!plano) return reply.code(400).send({ detail: "plano obrigatório." });
      return loadGargaloDetalhe(plano, p.inicio, p.fim);
    },
  );
};
