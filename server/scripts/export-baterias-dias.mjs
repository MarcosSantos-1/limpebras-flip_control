/**
 * Exporta os snapshots de bateria de dias específicos (ipt_dados_bateria) de volta
 * para planilhas .xlsx — para recuperar arquivos apagados localmente.
 *
 * Uso:
 *   node scripts/export-baterias-dias.mjs 2026-06-13 2026-06-14
 *   (sem argumentos usa 2026-06-13 e 2026-06-14)
 *
 * Saída: <Downloads>/Status de Bateria <yyyy-MM-dd>.xlsx (um por dia).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import * as XLSX from "xlsx";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dias = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const DIAS = dias.length ? dias : ["2026-06-13", "2026-06-14"];
const OUT_DIR = path.join(os.homedir(), "Downloads");

function readEnvDatabaseUrl() {
  const envPath = path.join(__dirname, "../.env");
  const line = fs.readFileSync(envPath, "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL não encontrado em server/.env");
  return line.slice("DATABASE_URL=".length).trim();
}

function fmtDateTimeBr(d) {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

async function main() {
  const pool = new Pool({ connectionString: readEnvDatabaseUrl(), ssl: { rejectUnauthorized: false } });
  try {
    for (const dia of DIAS) {
      const { rows } = await pool.query(
        `SELECT data_exportacao::text AS data_exportacao, nome, subprefeitura, setor,
                COALESCE(selimp_id, '') AS selimp, dias_execucao, status_comunicacao,
                bateria_raw, ultima_comunicacao
           FROM ipt_dados_bateria
          WHERE data_exportacao = $1
          ORDER BY subprefeitura NULLS LAST, setor NULLS LAST, nome`,
        [dia],
      );

      if (rows.length === 0) {
        console.log(`⚠ ${dia}: nenhuma linha encontrada — pulando.`);
        continue;
      }

      const aoa = [
        ["Data Exportacao", "Nome", "Subprefeitura", "Setor", "SELIMP", "Dias de Execucao", "Status Comunicacao", "Bateria", "Ultima Comunicacao"],
        ...rows.map((r) => [
          r.data_exportacao ?? "",
          r.nome ?? "",
          r.subprefeitura ?? "",
          r.setor ?? "",
          r.selimp ?? "",
          r.dias_execucao ?? "",
          r.status_comunicacao ?? "",
          r.bateria_raw ?? "",
          fmtDateTimeBr(r.ultima_comunicacao),
        ]),
      ];

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Bateria");
      const outPath = path.join(OUT_DIR, `Status de Bateria ${dia}.xlsx`);
      XLSX.writeFile(wb, outPath);
      console.log(`✓ ${dia}: ${rows.length} linhas → ${outPath}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Erro:", err.message);
  process.exit(1);
});
