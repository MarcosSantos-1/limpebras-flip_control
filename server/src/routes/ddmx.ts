import type { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";
import { getOrSet, invalidatePrefix } from "../cache.js";
import { normalizarSetor } from "../constants/ipt.js";
import { carregarDespachosDdmx, resumoPorServicoDdmx, serieDiariaDdmx, type DdmxDespacho } from "../services/ddmx-diario.js";
import {
  avaliarTrocaDdmx,
  leiturasDiariasModulo,
  motivoTrocaDdmx,
  semDiaEmAndamento,
  statusBateriaDdmx,
  type LeituraDdmx,
} from "../services/ddmx-trocas.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Janela padrão de leituras DDMX para a aba de trocas (bateria atual, execução 30d e sucesso). */
const JANELA_DIAS = 45;
/** Trocas mais antigas que isso não puxam leituras extras para avaliar sucesso. */
const JANELA_MAX_DIAS = 120;
const CACHE_PREFIX = "ddmx_trocas";

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
  tipo_troca: string | null;
  data_agendada: string | null;
  data_primeiro_agendamento: string | null;
  data_troca: string | null;
  sucesso: boolean | null;
  bateria_antes: string | null;
  bateria_antes_raw: string | null;
  status_bateria_antes: string | null;
  junto_climp: boolean | null;
  selimp_vinculo: string | null;
  observacao: string | null;
  created_at: string;
};

const SELECT_TROCAS = `SELECT id, ddmx_codigo, setor, status, tipo_troca, data_agendada::text, data_primeiro_agendamento::text,
         data_troca::text, sucesso, bateria_antes, bateria_antes_raw, status_bateria_antes, junto_climp,
         selimp_vinculo, observacao, created_at::text
    FROM ddmx_bateria_trocas`;

function leituraDe(d: DdmxDespacho): LeituraDdmx {
  return {
    data: d.data,
    plano: d.plano,
    bateria: d.bateriaPercentual,
    bateriaRaw: d.bateriaRaw,
    desatualizada: d.bateriaDesatualizada,
    ultimaComunicacao: d.ultimaComunicacao,
    percentualExecucao: d.percentual,
  };
}

function mapTroca(r: TrocaRow, leiturasAsc: LeituraDdmx[]) {
  const concluida = r.status === "concluida";
  const avaliacao = concluida ? avaliarTrocaDdmx(r.data_troca, leiturasAsc, r.sucesso) : { sucesso: null, depois: null };
  return {
    id: r.id,
    ddmxCodigo: r.ddmx_codigo,
    setor: r.setor,
    status: r.status as "agendada" | "concluida",
    tipoTroca: r.tipo_troca,
    dataAgendada: r.data_agendada,
    dataPrimeiroAgendamento: r.data_primeiro_agendamento,
    dataTroca: r.data_troca,
    /** Automático (leitura pós-troca); null = aguardando. */
    sucesso: avaliacao.sucesso,
    sucessoManual: r.sucesso != null,
    bateriaAntes: r.bateria_antes != null ? Number(r.bateria_antes) : null,
    bateriaAntesRaw: r.bateria_antes_raw,
    statusBateriaAntes: r.status_bateria_antes,
    bateriaDepois: avaliacao.depois?.bateria ?? null,
    bateriaDepoisRaw: avaliacao.depois?.bateriaRaw ?? null,
    statusBateriaDepois: avaliacao.depois ? statusBateriaDdmx(avaliacao.depois) : null,
    dataLeituraDepois: avaliacao.depois?.data ?? null,
    ultimaComunicacaoDepois: avaliacao.depois?.ultimaComunicacao ?? null,
    juntoClimp: Boolean(r.junto_climp),
    selimpVinculo: r.selimp_vinculo,
    observacao: r.observacao,
    createdAt: r.created_at,
  };
}

type SetorModuloRow = {
  setor: string;
  subprefeitura: string | null;
  servico: string | null;
  dias_execucao: string | null;
  ddmx_codigo: string;
  ddmx_instalacao: string | null;
  selimp_codigo: string | null;
};

async function carregarSetoresDdmx(): Promise<SetorModuloRow[]> {
  const r = await pool.query<SetorModuloRow>(
    `SELECT setor, subprefeitura, servico, dias_execucao, TRIM(ddmx_codigo) AS ddmx_codigo,
            ddmx_instalacao::text AS ddmx_instalacao, NULLIF(TRIM(selimp_codigo), '') AS selimp_codigo
       FROM setores_modulos
      WHERE NULLIF(TRIM(ddmx_codigo), '') IS NOT NULL
      ORDER BY ddmx_codigo, setor`,
  );
  return r.rows;
}

/** Leituras DDMX por plano (asc), restritas às rotas informadas. */
function leiturasPorPlano(despachos: DdmxDespacho[]): Map<string, LeituraDdmx[]> {
  const map = new Map<string, LeituraDdmx[]>();
  for (const d of despachos) {
    const arr = map.get(d.plano) ?? [];
    arr.push(leituraDe(d));
    map.set(d.plano, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.data.localeCompare(b.data));
  return map;
}

async function montarModulos() {
  const fim = hojeBrt();
  const [setores, trocas] = await Promise.all([
    carregarSetoresDdmx(),
    pool.query<TrocaRow>(`${SELECT_TROCAS} ORDER BY COALESCE(data_troca, data_agendada) DESC NULLS LAST, id DESC`),
  ]);
  // Janela cobre 45 dias ou a troca concluída mais antiga ainda recente (para avaliar o sucesso).
  let inicio = addDias(fim, -JANELA_DIAS);
  const limite = addDias(fim, -JANELA_MAX_DIAS);
  for (const t of trocas.rows) {
    if (t.status === "concluida" && t.data_troca && t.data_troca < inicio && t.data_troca >= limite) inicio = t.data_troca;
  }
  const planos = [...new Set(setores.map((s) => normalizarSetor(s.setor)).filter(Boolean))];
  const despachos = await carregarDespachosDdmx(inicio, fim, planos);
  const porPlano = leiturasPorPlano(despachos);

  const trocasPorModulo = new Map<string, TrocaRow[]>();
  for (const t of trocas.rows) {
    const arr = trocasPorModulo.get(t.ddmx_codigo) ?? [];
    arr.push(t);
    trocasPorModulo.set(t.ddmx_codigo, arr);
  }

  type Modulo = {
    ddmxCodigo: string;
    instalacao: string | null;
    subprefeitura: string | null;
    setores: string[];
    setoresDias: Array<{ setor: string; dias: string; servico: string | null }>;
    selimpCodigos: string[];
    servicos: string[];
  };
  const modulos = new Map<string, Modulo>();
  for (const s of setores) {
    const cur: Modulo = modulos.get(s.ddmx_codigo) ?? {
      ddmxCodigo: s.ddmx_codigo,
      instalacao: s.ddmx_instalacao,
      subprefeitura: s.subprefeitura,
      setores: [],
      setoresDias: [],
      selimpCodigos: [],
      servicos: [],
    };
    cur.setores.push(s.setor);
    cur.setoresDias.push({ setor: s.setor, dias: s.dias_execucao ?? "", servico: s.servico });
    if (s.selimp_codigo && !cur.selimpCodigos.includes(s.selimp_codigo)) cur.selimpCodigos.push(s.selimp_codigo);
    if (s.servico && !cur.servicos.includes(s.servico)) cur.servicos.push(s.servico);
    if (!cur.instalacao && s.ddmx_instalacao) cur.instalacao = s.ddmx_instalacao;
    modulos.set(s.ddmx_codigo, cur);
  }

  const inicio30 = addDias(fim, -30);
  return {
    atualizadoAte: fim,
    janelaInicio: inicio,
    modulos: [...modulos.values()].map((m) => {
      const leituras = m.setores.flatMap((s) => porPlano.get(normalizarSetor(s)) ?? []);
      const diarias = semDiaEmAndamento(leiturasDiariasModulo(leituras), fim);
      const atual = diarias[diarias.length - 1] ?? null;
      const status = statusBateriaDdmx(atual);
      const ultimos30 = diarias.filter((l) => l.data >= inicio30);
      const execs = ultimos30.map((l) => l.percentualExecucao).filter((v): v is number => v != null);
      const historico = (trocasPorModulo.get(m.ddmxCodigo) ?? []).map((t) => mapTroca(t, diarias));
      const concluidas = historico.filter((h) => h.status === "concluida");
      return {
        ...m,
        leitura: atual,
        statusBateria: status,
        motivoSugerido: motivoTrocaDdmx(status),
        execucaoMedia30: execs.length ? Math.round(execs.reduce((a, b) => a + b, 0) / execs.length) : null,
        diasComLeitura30: ultimos30.length,
        diasDesatualizados30: ultimos30.filter((l) => l.desatualizada).length,
        execucoes: ultimos30.map((l) => ({
          data: l.data,
          percentual: l.percentualExecucao,
          bateria: l.bateria,
          bateriaRaw: l.bateriaRaw,
          desatualizada: l.desatualizada,
        })),
        agendamento: historico.find((h) => h.status === "agendada") ?? null,
        ultimaTroca: concluidas[0] ?? null,
        historico,
      };
    }),
  };
}

type TrocaInput = {
  ddmxCodigo?: string;
  setor?: string | null;
  status?: string;
  tipoTroca?: string | null;
  dataAgendada?: string;
  dataTroca?: string;
  bateriaAntes?: number | null;
  bateriaAntesRaw?: string | null;
  statusBateriaAntes?: string | null;
  juntoClimp?: boolean;
  selimpVinculo?: string | null;
  observacao?: string | null;
};

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

  /** Módulos DDMX + leitura atual, execução 30d e histórico de trocas (sucesso automático). */
  fastify.get("/bateria/ddmx/modulos", async () => getOrSet(`${CACHE_PREFIX}:modulos`, montarModulos, 120_000));

  /**
   * Agenda ou conclui trocas DDMX. Um agendamento aberto por módulo: novo
   * agendamento (reagendar) o substitui; conclusão o fecha.
   */
  fastify.post<{ Body: { items?: TrocaInput[] } }>("/bateria/ddmx/trocas", async (request, reply) => {
    const items = (Array.isArray(request.body?.items) ? request.body.items : [])
      .map((it) => {
        const status = it?.status === "agendada" ? "agendada" : "concluida";
        const bat =
          it?.bateriaAntes != null && Number.isFinite(Number(it.bateriaAntes))
            ? Math.min(100, Math.max(0, Number(it.bateriaAntes)))
            : null;
        const txt = (v: unknown) => String(v ?? "").trim() || null;
        return {
          ddmxCodigo: String(it?.ddmxCodigo ?? "").trim(),
          setor: txt(it?.setor),
          status,
          tipoTroca: txt(it?.tipoTroca),
          dataAgendada: ISO_DATE.test(String(it?.dataAgendada ?? "")) ? String(it!.dataAgendada) : null,
          dataTroca: ISO_DATE.test(String(it?.dataTroca ?? "")) ? String(it!.dataTroca) : null,
          bateriaAntes: bat,
          bateriaAntesRaw: txt(it?.bateriaAntesRaw),
          statusBateriaAntes: txt(it?.statusBateriaAntes),
          juntoClimp: Boolean(it?.juntoClimp),
          selimpVinculo: txt(it?.selimpVinculo),
          observacao: txt(it?.observacao),
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
        const prev = await client.query<{
          data_agendada: string | null;
          data_primeiro_agendamento: string | null;
          selimp_vinculo: string | null;
          junto_climp: boolean | null;
          tipo_troca: string | null;
        }>(
          `DELETE FROM ddmx_bateria_trocas WHERE ddmx_codigo = $1 AND status = 'agendada'
           RETURNING data_agendada::text, data_primeiro_agendamento::text, selimp_vinculo, junto_climp, tipo_troca`,
          [it.ddmxCodigo],
        );
        const p = prev.rows[0];
        const dataAgendada = it.status === "agendada" ? it.dataAgendada : p?.data_agendada ?? null;
        const primeiro = p?.data_primeiro_agendamento ?? p?.data_agendada ?? dataAgendada;
        await client.query(
          `INSERT INTO ddmx_bateria_trocas
             (ddmx_codigo, setor, status, tipo_troca, data_agendada, data_primeiro_agendamento, data_troca,
              bateria_antes, bateria_antes_raw, status_bateria_antes, junto_climp, selimp_vinculo, observacao)
           VALUES ($1,$2,$3,$4,$5::date,$6::date,$7::date,$8,$9,$10,$11,$12,$13)`,
          [
            it.ddmxCodigo,
            it.setor,
            it.status,
            it.tipoTroca ?? p?.tipo_troca ?? null,
            dataAgendada,
            primeiro,
            it.status === "concluida" ? it.dataTroca : null,
            it.bateriaAntes,
            it.bateriaAntesRaw,
            it.statusBateriaAntes,
            it.juntoClimp || Boolean(p?.junto_climp),
            it.selimpVinculo ?? p?.selimp_vinculo ?? null,
            it.observacao,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    invalidatePrefix(CACHE_PREFIX);
    return { ok: true, total: items.length };
  });

  /** Cancela o agendamento aberto dos módulos informados. */
  fastify.post<{ Body: { codigos?: string[] } }>("/bateria/ddmx/agendamentos/cancelar", async (request, reply) => {
    const codigos = (Array.isArray(request.body?.codigos) ? request.body.codigos : [])
      .map((c) => String(c ?? "").trim())
      .filter(Boolean);
    if (!codigos.length) return reply.code(400).send({ detail: "codigos obrigatório" });
    const r = await pool.query(
      "DELETE FROM ddmx_bateria_trocas WHERE status = 'agendada' AND ddmx_codigo = ANY($1::text[])",
      [codigos],
    );
    invalidatePrefix(CACHE_PREFIX);
    return { ok: true, removidos: r.rowCount ?? 0 };
  });

  fastify.delete<{ Params: { id: string } }>("/bateria/ddmx/trocas/:id", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ detail: "id inválido" });
    await pool.query("DELETE FROM ddmx_bateria_trocas WHERE id = $1", [id]);
    invalidatePrefix(CACHE_PREFIX);
    return { ok: true };
  });

  /**
   * Trocas concluídas (CLIMP e DDMX) por setor/dia — marcação nos despachos
   * do IPT Geral. Resultado: sucesso | sem_sucesso | aguardando.
   */
  fastify.get<{ Querystring: { inicio?: string; fim?: string } }>("/ipt/trocas-por-dia", async (request, reply) => {
    const inicio = String(request.query.inicio ?? "").trim();
    const fim = String(request.query.fim ?? "").trim();
    if (!ISO_DATE.test(inicio) || !ISO_DATE.test(fim) || inicio > fim) {
      return reply.code(400).send({ detail: "inicio e fim obrigatórios (YYYY-MM-DD)." });
    }
    return getOrSet(`${CACHE_PREFIX}:por_dia:${inicio}:${fim}`, async () => {
      const [setores, climp, ddmx] = await Promise.all([
        carregarSetoresDdmx(),
        pool.query<{ modulo_selimp: string; setor: string | null; data_troca: string; sucesso: boolean | null; tipo_troca: string | null }>(
          `SELECT modulo_selimp, setor, data_troca::text, sucesso, tipo_troca
             FROM bateria_trocas_eventos
            WHERE status = 'concluida' AND data_troca BETWEEN $1::date AND $2::date`,
          [inicio, fim],
        ),
        pool.query<TrocaRow>(
          `${SELECT_TROCAS} WHERE status = 'concluida' AND data_troca BETWEEN $1::date AND $2::date`,
          [inicio, fim],
        ),
      ]);
      const setoresPorSelimp = new Map<string, string[]>();
      const setoresPorDdmx = new Map<string, string[]>();
      for (const s of setores) {
        const plano = normalizarSetor(s.setor);
        if (!plano) continue;
        if (s.selimp_codigo) setoresPorSelimp.set(s.selimp_codigo, [...(setoresPorSelimp.get(s.selimp_codigo) ?? []), plano]);
        setoresPorDdmx.set(s.ddmx_codigo, [...(setoresPorDdmx.get(s.ddmx_codigo) ?? []), plano]);
      }

      type Item = { plano: string; data: string; origem: "climp" | "ddmx"; modulo: string; resultado: "sucesso" | "sem_sucesso" | "aguardando"; tipo: string | null };
      const itens: Item[] = [];
      const resultado = (s: boolean | null): Item["resultado"] => (s == null ? "aguardando" : s ? "sucesso" : "sem_sucesso");

      for (const t of climp.rows) {
        const planos = new Set<string>(setoresPorSelimp.get(t.modulo_selimp) ?? []);
        for (const parte of String(t.setor ?? "").split("/")) {
          const p = normalizarSetor(parte.trim());
          if (p) planos.add(p);
        }
        for (const plano of planos) {
          itens.push({ plano, data: t.data_troca, origem: "climp", modulo: t.modulo_selimp, resultado: resultado(t.sucesso), tipo: t.tipo_troca });
        }
      }

      if (ddmx.rows.length) {
        const planosDdmx = [...new Set(ddmx.rows.flatMap((t) => setoresPorDdmx.get(t.ddmx_codigo) ?? []))];
        const despachos = await carregarDespachosDdmx(inicio, addDias(fim, 10), planosDdmx);
        const porPlano = leiturasPorPlano(despachos);
        for (const t of ddmx.rows) {
          const planos = setoresPorDdmx.get(t.ddmx_codigo) ?? [];
          const diarias = semDiaEmAndamento(leiturasDiariasModulo(planos.flatMap((p) => porPlano.get(p) ?? [])), hojeBrt());
          const av = avaliarTrocaDdmx(t.data_troca, diarias, t.sucesso);
          for (const plano of planos) {
            itens.push({ plano, data: t.data_troca!, origem: "ddmx", modulo: t.ddmx_codigo, resultado: resultado(av.sucesso), tipo: t.tipo_troca });
          }
        }
      }
      return { periodo: { inicio, fim }, itens };
    }, 120_000);
  });
};

/** Invalida o cache das trocas DDMX quando a CLIMP muda (marcação no IPT Geral). */
export function invalidarCacheTrocasDdmx() {
  invalidatePrefix(CACHE_PREFIX);
}
