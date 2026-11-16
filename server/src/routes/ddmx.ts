import type { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";
import { normalizarSetor } from "../constants/ipt.js";
import { carregarDespachosDdmx, resumoPorServicoDdmx, serieDiariaDdmx } from "../services/ddmx-diario.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function addDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function hojeBrt(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
}

type TrocaRow = {
  id: number;
  ddmx_codigo: string;
  setor: string | null;
  status: string;
  data_agendada: string | null;
  data_troca: string | null;
  sucesso: boolean | null;
  bateria_antes: string | null;
  junto_climp: boolean | null;
  observacao: string | null;
  created_at: string;
};

function mapTroca(r: TrocaRow) {
  return {
    id: r.id,
    ddmxCodigo: r.ddmx_codigo,
    setor: r.setor,
    status: r.status as "agendada" | "concluida",
    dataAgendada: r.data_agendada,
    dataTroca: r.data_troca,
    sucesso: r.sucesso,
    bateriaAntes: r.bateria_antes != null ? Number(r.bateria_antes) : null,
    juntoClimp: Boolean(r.junto_climp),
    observacao: r.observacao,
    createdAt: r.created_at,
  };
}

export const ddmxRoutes: FastifyPluginAsync = async (fastify) => {
  /** Série diária de execução só com DDMX (snapshots por serviço / dashboard). */
  fastify.get<{ Querystring: { inicio?: string; fim?: string; servico?: string } }>(
    "/ipt/ddmx/serie",
    async (request, reply) => {
      const inicio = String(request.query.inicio ?? "").trim();
      const fim = String(request.query.fim ?? "").trim();
      if (!ISO_DATE.test(inicio) || !ISO_DATE.test(fim) || inicio > fim) {
        return reply.code(400).send({ detail: "inicio e fim obrigatórios (YYYY-MM-DD)." });
      }
      const servico = String(request.query.servico ?? "").trim() || undefined;
      const despachos = await carregarDespachosDdmx(inicio, fim);
      return {
        periodo: { inicio, fim },
        servico: servico ?? null,
        serie: serieDiariaDdmx(despachos, servico),
        servicos: resumoPorServicoDdmx(despachos),
      };
    },
  );

  /** Módulos DDMX (setores_modulos.ddmx_codigo) + última bateria lida no DDMX + trocas. */
  fastify.get("/bateria/ddmx/modulos", async () => {
    const fim = hojeBrt();
    const inicio = addDias(fim, -14);
    const [mods, trocas, despachos] = await Promise.all([
      pool.query<{ setor: string; subprefeitura: string | null; servico: string | null; ddmx_codigo: string; ddmx_instalacao: string | null; selimp_codigo: string | null }>(
        `SELECT setor, subprefeitura, servico, TRIM(ddmx_codigo) AS ddmx_codigo,
                ddmx_instalacao::text AS ddmx_instalacao, selimp_codigo
           FROM setores_modulos
          WHERE NULLIF(TRIM(ddmx_codigo), '') IS NOT NULL
          ORDER BY ddmx_codigo, setor`,
      ),
      pool.query<TrocaRow>(
        `SELECT id, ddmx_codigo, setor, status, data_agendada::text, data_troca::text, sucesso,
                bateria_antes, junto_climp, observacao, created_at::text
           FROM ddmx_bateria_trocas
          ORDER BY COALESCE(data_troca, data_agendada) DESC NULLS LAST, id DESC`,
      ),
      carregarDespachosDdmx(inicio, fim),
    ]);

    // Última leitura DDMX por plano.
    const ultimaPorPlano = new Map<string, (typeof despachos)[number]>();
    for (const d of despachos) {
      const cur = ultimaPorPlano.get(d.plano);
      if (!cur || d.data > cur.data) ultimaPorPlano.set(d.plano, d);
    }

    const historico = new Map<string, ReturnType<typeof mapTroca>[]>();
    for (const t of trocas.rows) {
      const arr = historico.get(t.ddmx_codigo) ?? [];
      arr.push(mapTroca(t));
      historico.set(t.ddmx_codigo, arr);
    }

    const modulos = new Map<string, {
      ddmxCodigo: string;
      instalacao: string | null;
      selimpCodigo: string | null;
      subprefeitura: string | null;
      setores: string[];
      servicos: string[];
    }>();
    for (const m of mods.rows) {
      const cur = modulos.get(m.ddmx_codigo) ?? {
        ddmxCodigo: m.ddmx_codigo,
        instalacao: m.ddmx_instalacao,
        selimpCodigo: m.selimp_codigo,
        subprefeitura: m.subprefeitura,
        setores: [],
        servicos: [],
      };
      cur.setores.push(m.setor);
      if (m.servico && !cur.servicos.includes(m.servico)) cur.servicos.push(m.servico);
      modulos.set(m.ddmx_codigo, cur);
    }

    return {
      atualizadoAte: fim,
      modulos: [...modulos.values()].map((m) => {
        let leitura: (typeof despachos)[number] | null = null;
        for (const s of m.setores) {
          const l = ultimaPorPlano.get(normalizarSetor(s));
          if (l && (!leitura || l.data > leitura.data)) leitura = l;
        }
        const hist = historico.get(m.ddmxCodigo) ?? [];
        return {
          ...m,
          ultimaLeitura: leitura
            ? {
                data: leitura.data,
                plano: leitura.plano,
                bateria: leitura.bateriaPercentual,
                desatualizada: leitura.bateriaDesatualizada,
                percentualExecucao: leitura.percentual,
              }
            : null,
          agendamento: hist.find((h) => h.status === "agendada") ?? null,
          ultimaTroca: hist.find((h) => h.status === "concluida") ?? null,
          historico: hist,
        };
      }),
    };
  });

  fastify.post<{
    Body: {
      items?: {
        ddmxCodigo?: string;
        setor?: string;
        status?: string;
        dataAgendada?: string;
        dataTroca?: string;
        sucesso?: boolean;
        bateriaAntes?: number | null;
        juntoClimp?: boolean;
        observacao?: string;
      }[];
    };
  }>("/bateria/ddmx/trocas", async (request, reply) => {
    const items = (Array.isArray(request.body?.items) ? request.body.items : [])
      .map((it) => {
        const status = it?.status === "agendada" ? "agendada" : "concluida";
        const bat = it?.bateriaAntes != null && Number.isFinite(Number(it.bateriaAntes))
          ? Math.min(100, Math.max(0, Number(it.bateriaAntes)))
          : null;
        return {
          ddmxCodigo: String(it?.ddmxCodigo ?? "").trim(),
          setor: String(it?.setor ?? "").trim() || null,
          status,
          dataAgendada: ISO_DATE.test(String(it?.dataAgendada ?? "")) ? String(it!.dataAgendada) : null,
          dataTroca: ISO_DATE.test(String(it?.dataTroca ?? "")) ? String(it!.dataTroca) : null,
          sucesso: status === "concluida" ? it?.sucesso !== false : null,
          bateriaAntes: bat,
          juntoClimp: Boolean(it?.juntoClimp),
          observacao: String(it?.observacao ?? "").trim() || null,
        };
      })
      .filter((it) => it.ddmxCodigo && (it.status === "agendada" ? it.dataAgendada : it.dataTroca));
    if (!items.length) {
      return reply.code(400).send({ detail: "items: { ddmxCodigo, status, dataAgendada|dataTroca (yyyy-MM-dd) }" });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const it of items) {
        // Um agendamento aberto por módulo: novo agendamento ou conclusão o substitui.
        const prev = await client.query<{ data_agendada: string | null }>(
          `DELETE FROM ddmx_bateria_trocas WHERE ddmx_codigo = $1 AND status = 'agendada'
           RETURNING data_agendada::text`,
          [it.ddmxCodigo],
        );
        const dataAgendada = it.dataAgendada ?? prev.rows[0]?.data_agendada ?? null;
        await client.query(
          `INSERT INTO ddmx_bateria_trocas
             (ddmx_codigo, setor, status, data_agendada, data_troca, sucesso, bateria_antes, junto_climp, observacao)
           VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8,$9)`,
          [it.ddmxCodigo, it.setor, it.status, dataAgendada, it.status === "concluida" ? it.dataTroca : null,
            it.sucesso, it.bateriaAntes, it.juntoClimp, it.observacao],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return { ok: true, total: items.length };
  });

  fastify.delete<{ Params: { id: string } }>("/bateria/ddmx/trocas/:id", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ detail: "id inválido" });
    await pool.query("DELETE FROM ddmx_bateria_trocas WHERE id = $1", [id]);
    return { ok: true };
  });
};
