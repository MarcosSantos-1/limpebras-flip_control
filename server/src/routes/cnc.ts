import { FastifyPluginAsync } from "fastify";
import { pool } from "../db.js";
import { cacheKey, getOrSet } from "../cache.js";
import { BFS_DEFESA_EXCLUSAO_SQL } from "../constants/bfs.js";
import { findSetorByCoords, parseCoordenada } from "../services/setorLookup.js";

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
   * - Cruzamento com cncs (data_execucao, situacao_cnc, fiscal_contratada, etc)
   */
  fastify.get<{
    Querystring: {
      periodo_inicial?: string;
      periodo_final?: string;
      subprefeitura?: string;
      status?: string;
      tipo_servico?: string;
    };
  }>(
    "/cnc/defesa",
    async (request, reply) => {
      const { periodo_inicial, periodo_final, subprefeitura, status, tipo_servico } = request.query;
      const excludeSql = BFS_DEFESA_EXCLUSAO_SQL.map((_, i) => `b.tipo_servico NOT ILIKE $${i + 1}`).join(" AND ");
      let sql = `
        SELECT b.id, b.numero_bfs, b.data_fiscalizacao, b.data_vistoria, b.status, b.tipo_servico, b.regional, b.endereco, b.raw,
          c.numero_cnc, c.situacao_cnc, c.data_execucao, c.data_sincronizacao, c.setor, c.fiscal_contratada, c.responsividade, c.coordenada
        FROM bfs b
        LEFT JOIN cncs c ON c.numero_bfs = b.numero_bfs
        WHERE TRIM(COALESCE(b.status, '')) <> 'Sem Irregularidades'
          AND (${excludeSql})
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
      if (status && status !== "todos") {
        sql += ` AND c.situacao_cnc ILIKE $${i}`;
        params.push(`%${status}%`);
        i++;
      }
      if (tipo_servico && tipo_servico !== "todos") {
        sql += ` AND b.tipo_servico ILIKE $${i}`;
        params.push(`%${tipo_servico}%`);
        i++;
      }
      sql += " ORDER BY b.data_fiscalizacao DESC";

      const key = cacheKey("cnc_defesa", { periodo_inicial, periodo_final, subprefeitura, status, tipo_servico });
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
        const rows = Array.from(byBfs.values()).map(({ item, cncs }) => {
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
        return { items: rows, total: rows.length };
      });
      return result;
    }
  );
};
