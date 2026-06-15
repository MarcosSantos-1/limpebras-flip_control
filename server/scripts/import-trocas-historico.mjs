/**
 * Importa o histórico de trocas de bateria (docs/ipt/TROCAS_DE_MODULOS.xlsx, já
 * transformado em docs/ipt/trocas_historico_transformado.csv) para o Neon.
 *
 * O CSV vem com cada linha já resolvida para o SELIMP correto (modulo_selimp),
 * usando o crosswalk setor→selimp do próprio banco (setores_modulos). As 7 linhas
 * ambíguas (praças CV em 2 módulos) ficam de fora — ver trocas_historico_ambiguas.csv.
 *
 * Grava em:
 *   - bateria_trocas_eventos : 1 evento por troca (status 'concluida')
 *   - bateria_trocas         : estado corrente = troca mais recente por módulo
 *   - modulo_selimp.qtd_trocas: nº de eventos importados por módulo
 *
 * Uso:
 *   node scripts/import-trocas-historico.mjs            # dry-run (não grava)
 *   node scripts/import-trocas-historico.mjs --execute  # grava no Neon
 *
 * Trava de segurança: aborta se bateria_trocas_eventos já tiver linhas.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXECUTE = process.argv.includes("--execute");
const CSV = path.join(__dirname, "../../docs/ipt/trocas_historico_transformado.csv");

function readEnvDatabaseUrl() {
  const envPath = path.join(__dirname, "../.env");
  const line = fs.readFileSync(envPath, "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL não encontrado em server/.env");
  return line.slice("DATABASE_URL=".length).trim();
}

function parseCsv(file) {
  const text = fs.readFileSync(file, "utf8").replace(/\r/g, "");
  const lines = text.split("\n").filter((l) => l.length);
  const header = lines[0].split(",");
  return lines.slice(1).map((l) => {
    const cells = l.split(",");
    const row = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

const orNull = (v) => (v === "" || v == null ? null : v);
const toBool = (v) => String(v).trim().toLowerCase() === "true";
const toNum = (v) => (orNull(v) == null ? null : Number(v));

async function main() {
  const rows = parseCsv(CSV);
  console.log(`CSV: ${rows.length} eventos lidos de ${path.relative(process.cwd(), CSV)}`);

  const pool = new Pool({ connectionString: readEnvDatabaseUrl(), ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    const { rows: ex } = await client.query("SELECT count(*)::int n FROM bateria_trocas_eventos");
    if (ex[0].n > 0) {
      console.error(`\n⛔ ABORTADO: bateria_trocas_eventos já tem ${ex[0].n} linhas. Limpe antes de reimportar.`);
      process.exit(1);
    }

    // Estado corrente = evento mais recente por módulo (data_troca, depois ordem de origem)
    const latest = new Map();
    for (const r of rows) {
      const cur = latest.get(r.modulo_selimp);
      const key = (x) => `${x.data_troca}|${String(x.source_row).padStart(6, "0")}`;
      if (!cur || key(r) > key(cur)) latest.set(r.modulo_selimp, r);
    }
    // qtd_trocas por módulo
    const qtd = new Map();
    for (const r of rows) qtd.set(r.modulo_selimp, (qtd.get(r.modulo_selimp) ?? 0) + 1);

    console.log(`→ ${rows.length} eventos | ${latest.size} módulos (estado corrente) | qtd_trocas em ${qtd.size} módulos`);
    console.log(`Modo: ${EXECUTE ? "EXECUTE (grava)" : "DRY-RUN (não grava)"}`);
    if (!EXECUTE) {
      console.log("\nAmostra dos 3 primeiros eventos:");
      rows.slice(0, 3).forEach((r) => console.log("  ", JSON.stringify(r)));
      return;
    }

    await client.query("BEGIN");

    // 1) eventos (append-only) — em lotes
    const CHUNK = 200;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const vals = [];
      const params = [];
      chunk.forEach((r, j) => {
        const b = j * 8;
        vals.push(`($${b + 1},$${b + 2},'concluida',$${b + 3},$${b + 4},$${b + 5}::date,$${b + 6}::date,$${b + 7},$${b + 8})`);
        params.push(
          r.modulo_selimp,
          orNull(r.setor),
          orNull(r.tipo_troca),
          toBool(r.sucesso),
          orNull(r.data_troca),
          orNull(r.ultima_comunicacao),
          orNull(r.bateria_antes_raw),
          toNum(r.bateria_antes_percentual)
        );
      });
      await client.query(
        `INSERT INTO bateria_trocas_eventos
           (modulo_selimp, setor, status, tipo_troca, sucesso, data_troca, ultima_comunicacao, bateria_antes_raw, bateria_antes_percentual)
         VALUES ${vals.join(",")}`,
        params
      );
      inserted += chunk.length;
    }
    console.log(`  ✓ bateria_trocas_eventos: ${inserted} inseridos`);

    // 2) estado corrente
    let up = 0;
    for (const r of latest.values()) {
      await client.query(
        `INSERT INTO bateria_trocas (modulo_selimp, setor, status, sucesso, data_troca, ultima_comunicacao, updated_at)
         VALUES ($1,$2,'concluida',$3,$4::date,$5::date,NOW())
         ON CONFLICT (modulo_selimp) DO UPDATE SET
           setor = COALESCE(EXCLUDED.setor, bateria_trocas.setor),
           status = 'concluida', sucesso = EXCLUDED.sucesso,
           data_troca = EXCLUDED.data_troca, ultima_comunicacao = EXCLUDED.ultima_comunicacao,
           updated_at = NOW()`,
        [r.modulo_selimp, orNull(r.setor), toBool(r.sucesso), orNull(r.data_troca), orNull(r.ultima_comunicacao)]
      );
      up++;
    }
    console.log(`  ✓ bateria_trocas (estado corrente): ${up} módulos`);

    // 3) qtd_trocas
    let qn = 0;
    for (const [sel, n] of qtd) {
      const res = await client.query(`UPDATE modulo_selimp SET qtd_trocas = $2, updated_at = NOW() WHERE modulo_selimp = $1`, [sel, n]);
      qn += res.rowCount ?? 0;
    }
    console.log(`  ✓ modulo_selimp.qtd_trocas atualizado: ${qn} módulos`);

    await client.query("COMMIT");
    console.log("\n✅ Import concluído (commit).");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("\n⛔ ROLLBACK:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
