import { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";
import { cacheKey, getOrSet, invalidatePrefix } from "../cache.js";
import { BFS_DEFESA_EXCLUSAO_SQL, sqlBfsFiscalNaoEhSelimp } from "../constants/bfs.js";
import { findSetorByCoords, parseCoordenada, findSetorByPlano } from "../services/setorLookup.js";
import { parseSetor, FREQUENCIAS, normalizarSetor } from "../constants/ipt.js";

const STATUS_DEFESA_VALID = new Set(["Analisar", "Irregular", "Contestar"]);

function normNumeroBfs(v: string | null | undefined): string {
  return (v ?? "").trim();
}

export const cncRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Querystring: {
      periodo_inicial?: string;
      periodo_final?: string;
      subprefeitura?: string;
      status?: string;
      tipo_servico?: string;
    };
  }>(
    "/cnc",
    async (request, reply) => {
      const { periodo_inicial, periodo_final, subprefeitura, status, tipo_servico } = request.query;
      let sql =
        "SELECT id, numero_bfs, data_fiscalizacao, data_vistoria, status, tipo_servico, regional, endereco, raw FROM bfs WHERE 1=1";
      const params: (string | number)[] = [];
      let i = 1;
      if (periodo_inicial) {
        sql += ` AND data_fiscalizacao >= $${i}::date`;
        params.push(periodo_inicial);
        i++;
      }
      if (periodo_final) {
        sql += ` AND data_fiscalizacao < ($${i}::date + interval '1 day')`;
        params.push(periodo_final);
        i++;
      }
      if (subprefeitura && subprefeitura !== "todas") {
        sql += ` AND regional = $${i}`;
        params.push(subprefeitura);
        i++;
      }
      if (status && status !== "todos") {
        if (status === "Sem Irregularidades") {
          sql += ` AND TRIM(COALESCE(status, '')) = 'Sem Irregularidades'`;
        } else if (status === "Com Irregularidades") {
          sql += ` AND TRIM(COALESCE(status, '')) <> 'Sem Irregularidades'`;
        } else {
          sql += ` AND status ILIKE $${i}`;
          params.push(`%${status}%`);
          i++;
        }
      }
      if (tipo_servico && tipo_servico !== "todos") {
        sql += ` AND tipo_servico ILIKE $${i}`;
        params.push(`%${tipo_servico}%`);
        i++;
      }
      sql += " ORDER BY data_fiscalizacao DESC";

      const key = cacheKey("cnc", {
        periodo_inicial,
        periodo_final,
        subprefeitura,
        status,
        tipo_servico,
      });
      const result = await getOrSet(key, async () => {
        const r = await pool.query(sql, params);
        const rows = r.rows.map((row) => ({
        id: String(row.id),
        bfs: row.numero_bfs,
        subprefeitura: row.regional,
        status: row.status,
        data_abertura: row.data_fiscalizacao ? new Date(row.data_fiscalizacao).toISOString() : null,
        data_vistoria: row.data_vistoria ? new Date(row.data_vistoria).toISOString() : null,
        endereco: row.endereco,
        tipo_servico: row.tipo_servico,
        fiscal: row.raw?.Fiscal || row.raw?.fiscal || null,
        sem_irregularidade: (row.status || "").trim() === "Sem Irregularidades",
      }));
        return { items: rows, total: rows.length };
      });
      return result;
    }
  );

  /**
   * BFSs escalonados para Defesa/Contestação:
   * - Apenas BFS "Com irregularidade" (não "Sem Irregularidades")
   * - Exclui os 4 serviços: entulho irregular, animais mortos, papeleiras, equipe pontos viciados
   * - Exclui BFS cujo fiscal (coluna Fiscal no raw) começa por "SELIMP -"
   * - Cruzamento com cncs (data_execucao, situacao_cnc, fiscal_contratada, etc)
   */
  fastify.get<{
    Querystring: {
      periodo_inicial?: string;
      periodo_final?: string;
      subprefeitura?: string;
      /** Filtro pela coluna situação CNC (ex.: Autuado). Use "todas" para não filtrar. */
      situacao_cnc?: string;
      /** @deprecated use situacao_cnc — mesmo efeito */
      status?: string;
      tipo_servico?: string;
    };
  }>(
    "/cnc/defesa",
    async (request, reply) => {
      const { periodo_inicial, periodo_final, subprefeitura, situacao_cnc, status, tipo_servico } = request.query;
      const situacaoFiltro = (situacao_cnc ?? status ?? "").trim() || "todas";
      const excludeSql = BFS_DEFESA_EXCLUSAO_SQL.map((_, i) => `b.tipo_servico NOT ILIKE $${i + 1}`).join(" AND ");
      const fiscalNaoSelimp = sqlBfsFiscalNaoEhSelimp("b");
      let sql = `
        SELECT b.id, b.numero_bfs, b.data_fiscalizacao, b.data_vistoria, b.status, b.tipo_servico, b.regional, b.endereco, b.raw,
          c.numero_cnc, c.situacao_cnc, c.data_execucao, c.data_sincronizacao, c.setor, c.fiscal_contratada, c.responsividade, c.coordenada
        FROM bfs b
        LEFT JOIN cncs c ON c.numero_bfs = b.numero_bfs
        WHERE TRIM(COALESCE(b.status, '')) <> 'Sem Irregularidades'
          AND (${excludeSql})
          AND ${fiscalNaoSelimp}
      `;
      const params: (string | number)[] = [...BFS_DEFESA_EXCLUSAO_SQL];
      let i = params.length + 1;
      if (periodo_inicial) {
        sql += ` AND b.data_fiscalizacao >= $${i}::date`;
        params.push(periodo_inicial);
        i++;
      }
      if (periodo_final) {
        sql += ` AND b.data_fiscalizacao < ($${i}::date + interval '1 day')`;
        params.push(periodo_final);
        i++;
      }
      if (subprefeitura && subprefeitura !== "todas") {
        sql += ` AND b.regional = $${i}`;
        params.push(subprefeitura);
        i++;
      }
      if (situacaoFiltro !== "todas" && situacaoFiltro !== "todos") {
        if (situacaoFiltro === "__sem_cnc__") {
          sql += ` AND c.numero_cnc IS NULL`;
        } else {
          sql += ` AND c.situacao_cnc ILIKE $${i}`;
          params.push(`%${situacaoFiltro}%`);
          i++;
        }
      }
      if (tipo_servico && tipo_servico !== "todos") {
        sql += ` AND b.tipo_servico ILIKE $${i}`;
        params.push(`%${tipo_servico}%`);
        i++;
      }
      sql += " ORDER BY b.data_fiscalizacao DESC";

      const key = cacheKey("cnc_defesa", {
        periodo_inicial,
        periodo_final,
        subprefeitura,
        situacao_cnc: situacaoFiltro,
        tipo_servico,
      });
      const result = await getOrSet(key, async () => {
        const r = await pool.query(sql, params);
        const byBfs = new Map<string, { item: Record<string, unknown>; cncs: unknown[] }>();
        for (const row of r.rows) {
          const bfsId = String(row.id);
          const cncEntry = row.numero_cnc
            ? { numero_cnc: row.numero_cnc, situacao_cnc: row.situacao_cnc, data_execucao: row.data_execucao ? new Date(row.data_execucao as Date).toISOString() : null, data_sincronizacao: row.data_sincronizacao ? new Date(row.data_sincronizacao as Date).toISOString() : null, setor: row.setor, fiscal_contratada: row.fiscal_contratada, responsividade: row.responsividade, coordenada: row.coordenada }
            : null;
          const existing = byBfs.get(bfsId);
          if (existing) {
            if (cncEntry && !existing.cncs.some((c: unknown) => (c as { numero_cnc?: string }).numero_cnc === cncEntry.numero_cnc)) {
              existing.cncs.push(cncEntry);
            }
            continue;
          }
          byBfs.set(bfsId, {
            item: {
              id: bfsId,
              bfs: row.numero_bfs,
              subprefeitura: row.regional,
              status: row.status,
              data_abertura: row.data_fiscalizacao ? new Date(row.data_fiscalizacao as Date).toISOString() : null,
              data_vistoria: row.data_vistoria ? new Date(row.data_vistoria as Date).toISOString() : null,
              endereco: row.endereco,
              tipo_servico: row.tipo_servico,
              fiscal: (row.raw as Record<string, unknown>)?.Fiscal ?? (row.raw as Record<string, unknown>)?.fiscal ?? null,
              sem_irregularidade: false,
            },
            cncs: cncEntry ? [cncEntry] : [],
          });
        }
        let rows = Array.from(byBfs.values()).map(({ item, cncs }) => {
          const primaryCnc = cncs[0] as { coordenada?: string } | undefined;
          const coord = primaryCnc?.coordenada;
          const parsed = parseCoordenada(coord);
          let setorResolvido: { setor: string; frequencia: string; cronograma: string } | null = null;
          if (parsed) {
            setorResolvido = findSetorByCoords(
              parsed.lat,
              parsed.lng,
              item.tipo_servico as string,
              item.subprefeitura as string
            );
          }
          return {
            ...item,
            cnc_detalhes: cncs,
            setor_resolvido: setorResolvido ? setorResolvido.setor : "Sem Setor",
            frequencia_resolvida: setorResolvido?.frequencia ?? null,
            cronograma_resolvido: setorResolvido?.cronograma ?? null,
          };
        });

        const numeros = [
          ...new Set(
            rows.map((r) => normNumeroBfs(String((r as { bfs?: string }).bfs ?? ""))).filter(Boolean)
          ),
        ];
        const overrideMap = new Map<string, { status_defesa: string; dados_contestacao: unknown }>();
        if (numeros.length > 0) {
          const ov = await pool.query(
            `SELECT numero_bfs, status_defesa, dados_contestacao FROM bfs_defesa_state WHERE numero_bfs = ANY($1::text[])`,
            [numeros]
          );
          for (const row of ov.rows) {
            overrideMap.set(normNumeroBfs(row.numero_bfs as string), {
              status_defesa: String(row.status_defesa ?? "Analisar"),
              dados_contestacao: row.dados_contestacao,
            });
          }
        }

        rows = rows.map((item) => {
          const n = normNumeroBfs(String((item as { bfs?: string }).bfs ?? ""));
          const o = n ? overrideMap.get(n) : undefined;
          return {
            ...item,
            defesa_trabalho: o
              ? {
                  status: o.status_defesa,
                  dados: o.dados_contestacao ?? null,
                }
              : null,
          };
        });

        return { items: rows, total: rows.length };
      });
      return result;
    }
  );

  /**
   * Preview de frequência e cronograma ao digitar um código de setor (índice + ipt_cronograma + nomenclatura).
   */
  fastify.get<{
    Querystring: { setor?: string; subprefeitura?: string; tipo_servico?: string };
  }>("/cnc/defesa/setor-preview", async (request, reply) => {
    const q = request.query;
    const setor = (q.setor ?? "").trim();
    if (!setor) return reply.code(400).send({ detail: "setor obrigatório" });
    const subprefeitura = (q.subprefeitura ?? "").trim();
    const tipo_servico = (q.tipo_servico ?? "").trim();

    const fromIndex = findSetorByPlano(setor, tipo_servico || undefined, subprefeitura || undefined);

    let cronograma = fromIndex?.cronograma?.trim() || null;
    let frequencia = fromIndex?.frequencia?.trim() || null;
    let source: "index" | "ipt_cronograma" | "nomenclatura" = fromIndex ? "index" : "nomenclatura";

    if (!cronograma) {
      const norm = normalizarSetor(setor);
      const r = await pool.query<{ d: string }>(
        `SELECT to_char(data_esperada, 'DD/MM/YYYY') AS d
         FROM ipt_cronograma
         WHERE TRIM(setor) = $1 OR TRIM(setor) = $2
         ORDER BY data_esperada`,
        [setor, norm]
      );
      const parts = r.rows.map((row) => row.d).filter(Boolean);
      if (parts.length > 0) {
        cronograma = parts.join("; ");
        source = "ipt_cronograma";
      }
    }

    if (!frequencia) {
      const parsed = parseSetor(setor);
      if (parsed) {
        const code = String(parsed.frequencia).padStart(4, "0").slice(-4);
        frequencia = FREQUENCIAS[code] ?? null;
      }
    }

    return {
      setor: setor,
      frequencia_resolvida: frequencia,
      cronograma_resolvido: cronograma,
      source,
    };
  });

  fastify.patch<{
    Params: { numero_bfs: string };
    Body: { status_defesa?: string; dados_contestacao?: unknown | null };
  }>("/cnc/defesa/bfs/:numero_bfs", async (request, reply) => {
    const rawParam = request.params.numero_bfs;
    const numero = normNumeroBfs(decodeURIComponent(rawParam ?? ""));
    if (!numero) return reply.code(400).send({ detail: "numero_bfs inválido" });

    const body = (request.body ?? {}) as Record<string, unknown>;
    const statusRaw = typeof body.status_defesa === "string" ? body.status_defesa.trim() : "Analisar";
    if (!STATUS_DEFESA_VALID.has(statusRaw)) {
      return reply.code(400).send({ detail: "status_defesa deve ser Analisar, Irregular ou Contestar" });
    }

    let dados: unknown = null;
    if (statusRaw === "Contestar") {
      if ("dados_contestacao" in body) {
        dados = body.dados_contestacao === undefined ? null : body.dados_contestacao;
      }
    } else if (statusRaw === "Irregular") {
      if ("dados_contestacao" in body) {
        const raw = body.dados_contestacao;
        if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
          const o = raw as Record<string, unknown>;
          const obs = typeof o.observacao_irregular === "string" ? o.observacao_irregular.trim() : "";
          dados = { observacao_irregular: obs };
        } else {
          dados = null;
        }
      }
    } else {
      dados = null;
    }

    await pool.query(
      `INSERT INTO bfs_defesa_state (numero_bfs, status_defesa, dados_contestacao, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (numero_bfs) DO UPDATE SET
         status_defesa = EXCLUDED.status_defesa,
         dados_contestacao = EXCLUDED.dados_contestacao,
         updated_at = NOW()`,
      [numero, statusRaw, dados]
    );

    invalidatePrefix("cnc_defesa");

    const r = await pool.query(
      `SELECT numero_bfs, status_defesa, dados_contestacao FROM bfs_defesa_state WHERE numero_bfs = $1`,
      [numero]
    );
    const row = r.rows[0];
    return {
      numero_bfs: row.numero_bfs,
      defesa_trabalho: {
        status: row.status_defesa,
        dados: row.dados_contestacao ?? null,
      },
    };
  });
};
