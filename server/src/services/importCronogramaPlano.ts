import { pool } from "../db.js";
import {
  parseCronogramaWorkbook,
  type CronogramaModelo,
  type CronogramaSetorParsed,
} from "./parseCronogramaPlano.js";

/** Divide um array em lotes de tamanho `size` (para inserts multi-row). */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface CronogramaImportFile {
  filename: string;
  buffer: Buffer;
}

export interface CronogramaImportReport {
  dry_run: boolean;
  modo_datas: "mesclar" | "substituir";
  por_arquivo: Array<{ arquivo: string; modelo: CronogramaModelo | null; setores: number }>;
  setores_arquivo: number; // total de setores na união dos arquivos
  novos: number;
  atualizados: number;
  datas_inseridas: number; // só no commit
  datas_removidas: number; // datas antigas apagadas no modo "substituir" (preview no dry-run)
  removidos: string[]; // setores efetivamente removidos (ou candidatos no dry-run)
  delecao_aplicada: boolean;
  avisos: string[];
}

/**
 * Importa e reconcilia o Cronograma do Plano de Trabalho a partir das planilhas
 * Escalonados/Fixos. Atualiza informações dos setores e remove setores que sumiram
 * da UNIÃO dos arquivos (com exclusão em cascata de datas e observações). A exclusão
 * só roda quando AMBOS os modelos (escalonado e fixo) estão presentes — guarda de segurança.
 *
 * Datas:
 *  - `replaceDatas: false` (padrão) → MESCLA/acumula (ON CONFLICT DO NOTHING): datas novas
 *    são adicionadas, antigas mantidas, nada duplica.
 *  - `replaceDatas: true` → SUBSTITUI: apaga as datas dos setores importados e grava só as
 *    da planilha (reflete exatamente o plano vigente).
 *
 * Com `dryRun: true` não grava nada: apenas retorna o relatório do que aconteceria.
 */
export async function reconcileCronograma(
  files: CronogramaImportFile[],
  opts: { dryRun: boolean; replaceDatas?: boolean },
): Promise<CronogramaImportReport> {
  const replaceDatas = opts.replaceDatas ?? false;
  const avisos: string[] = [];
  const porArquivo: CronogramaImportReport["por_arquivo"] = [];
  const modelosPresentes = new Set<CronogramaModelo>();

  // União dos setores dos arquivos (último arquivo vence as infos; datas mescladas).
  const uniao = new Map<string, CronogramaSetorParsed>();
  for (const f of files) {
    const parsed = parseCronogramaWorkbook(f.buffer, f.filename);
    avisos.push(...parsed.avisos);
    porArquivo.push({ arquivo: f.filename, modelo: parsed.modelo, setores: parsed.setores.length });
    if (parsed.modelo) modelosPresentes.add(parsed.modelo);
    for (const s of parsed.setores) {
      const existing = uniao.get(s.setor);
      if (!existing) {
        uniao.set(s.setor, { ...s, datas: [...s.datas] });
      } else {
        const datas = Array.from(new Set([...existing.datas, ...s.datas])).sort();
        uniao.set(s.setor, { ...existing, ...s, datas });
      }
    }
  }

  const delecaoAplicada = modelosPresentes.has("escalonado") && modelosPresentes.has("fixo");
  if (!delecaoAplicada) {
    avisos.push(
      "Exclusão de setores ausentes PULADA: envie as duas planilhas (Escalonados + Fixos) juntas para reconciliar e remover setores que sumiram.",
    );
  }

  const client = await pool.connect();
  try {
    if (!opts.dryRun) await client.query("BEGIN");

    const existentesRes = await client.query<{ setor: string }>(`SELECT setor FROM cronograma_setores`);
    const existentes = new Set(existentesRes.rows.map((r) => r.setor));

    let novos = 0;
    let atualizados = 0;
    for (const setor of uniao.keys()) {
      if (existentes.has(setor)) atualizados++;
      else novos++;
    }

    const removidosCandidatos = Array.from(existentes).filter((s) => !uniao.has(s)).sort();
    const removidos = delecaoAplicada ? removidosCandidatos : [];

    let datasInseridas = 0;
    let datasRemovidas = 0;

    // Preview do modo "substituir": quantas datas antigas seriam apagadas.
    if (opts.dryRun && replaceDatas) {
      const alvo = Array.from(uniao.keys());
      if (alvo.length) {
        const cnt = await client.query<{ c: number }>(
          `SELECT COUNT(*)::int AS c FROM cronograma_datas WHERE setor = ANY($1)`,
          [alvo],
        );
        datasRemovidas = Number(cnt.rows[0]?.c ?? 0);
      }
    }

    if (!opts.dryRun) {
      const setores = Array.from(uniao.values());

      // --- Upsert de setores em lote (multi-row) para evitar N+1 sobre a rede do Neon. ---
      const SETOR_COLS = 15;
      for (const chunk of chunkArray(setores, 200)) {
        const params: unknown[] = [];
        const rows: string[] = [];
        chunk.forEach((s, i) => {
          const b = i * SETOR_COLS;
          rows.push(
            `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},` +
              `$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13},$${b + 14},$${b + 15}::jsonb,NOW())`,
          );
          params.push(
            s.setor,
            s.modelo,
            s.servico,
            s.subprefeitura,
            s.subSigla,
            s.frequenciaTexto,
            s.frequenciaCodigo,
            s.turno,
            s.local,
            s.feira,
            s.diasSemana, // TEXT[] (node-pg converte array JS) ou null
            s.diaSemanaTexto,
            s.anoPlano,
            s.sourceFile,
            JSON.stringify(s.raw ?? {}),
          );
        });
        await client.query(
          `INSERT INTO cronograma_setores (
             setor, modelo, servico, subprefeitura, sub_sigla, frequencia_texto, frequencia_codigo,
             turno, local, feira, dias_semana, dia_semana_texto, ano_plano, source_file, raw, updated_at
           ) VALUES ${rows.join(",")}
           ON CONFLICT (setor) DO UPDATE SET
             modelo = EXCLUDED.modelo,
             servico = EXCLUDED.servico,
             subprefeitura = EXCLUDED.subprefeitura,
             sub_sigla = EXCLUDED.sub_sigla,
             frequencia_texto = EXCLUDED.frequencia_texto,
             frequencia_codigo = EXCLUDED.frequencia_codigo,
             turno = EXCLUDED.turno,
             local = EXCLUDED.local,
             feira = EXCLUDED.feira,
             dias_semana = EXCLUDED.dias_semana,
             dia_semana_texto = EXCLUDED.dia_semana_texto,
             ano_plano = EXCLUDED.ano_plano,
             source_file = EXCLUDED.source_file,
             raw = EXCLUDED.raw,
             updated_at = NOW()`,
          params,
        );
      }

      // --- Modo "substituir": apaga as datas dos setores importados antes de regravar. ---
      if (replaceDatas) {
        const alvo = setores.map((s) => s.setor);
        if (alvo.length) {
          const del = await client.query(`DELETE FROM cronograma_datas WHERE setor = ANY($1)`, [alvo]);
          datasRemovidas = del.rowCount ?? 0;
        }
      }

      // --- Insert de datas em lote (mescla/acumula: ON CONFLICT DO NOTHING). ---
      const datasTuplas: Array<{ setor: string; data: string; ano: number | null; source: string }> = [];
      for (const s of setores) {
        for (const data of s.datas) {
          datasTuplas.push({ setor: s.setor, data, ano: Number(data.slice(0, 4)) || null, source: s.sourceFile });
        }
      }
      const DATA_COLS = 4;
      for (const chunk of chunkArray(datasTuplas, 1000)) {
        const params: unknown[] = [];
        const rows: string[] = [];
        chunk.forEach((t, i) => {
          const b = i * DATA_COLS;
          rows.push(`($${b + 1},$${b + 2}::date,$${b + 3},$${b + 4})`);
          params.push(t.setor, t.data, t.ano, t.source);
        });
        const ins = await client.query(
          `INSERT INTO cronograma_datas (setor, data, ano, source_file)
           VALUES ${rows.join(",")}
           ON CONFLICT (setor, data) DO NOTHING`,
          params,
        );
        datasInseridas += ins.rowCount ?? 0;
      }

      // --- Exclusão em cascata dos setores ausentes (cronograma + observações). ---
      if (removidos.length > 0) {
        // cascade apaga cronograma_datas; observações não têm FK → apagar explicitamente.
        await client.query(`DELETE FROM cronograma_setores WHERE setor = ANY($1)`, [removidos]);
        await client.query(`DELETE FROM ipt_observacoes_globais WHERE TRIM(setor) = ANY($1)`, [removidos]);
        await client.query(`DELETE FROM ipt_observacoes_diarias WHERE TRIM(setor) = ANY($1)`, [removidos]);
      }

      await client.query("COMMIT");
    }

    return {
      dry_run: opts.dryRun,
      modo_datas: replaceDatas ? "substituir" : "mesclar",
      por_arquivo: porArquivo,
      setores_arquivo: uniao.size,
      novos,
      atualizados,
      datas_inseridas: datasInseridas,
      datas_removidas: datasRemovidas,
      removidos,
      delecao_aplicada: delecaoAplicada,
      avisos,
    };
  } catch (err) {
    if (!opts.dryRun) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
