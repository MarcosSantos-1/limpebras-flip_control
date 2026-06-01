/**
 * Regenera web/lib/data/clausulas-penalidades.json a partir de docs/VALORES MULTAS.xlsx
 * Uso (na pasta web): npm run extract-clausulas
 */
import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const xlsxPath = path.join(root, "docs", "VALORES MULTAS.xlsx");
const outPath = path.join(__dirname, "..", "lib", "data", "clausulas-penalidades.json");

if (!fs.existsSync(xlsxPath)) {
  console.error("Arquivo não encontrado:", xlsxPath);
  process.exit(1);
}

const wb = XLSX.readFile(xlsxPath);
const sh = wb.Sheets["R$ PENALIDADES"];
if (!sh) {
  console.error('Aba "R$ PENALIDADES" não encontrada.');
  process.exit(1);
}

const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: "" });
const out = [];
for (let i = 2; i < rows.length; i++) {
  const r = rows[i];
  if (!r || !r[0]) continue;
  const item = String(r[0]).trim();
  const descricao = String(r[1] || "").trim();
  const grau = r[2] === "" ? null : Number(r[2]);
  const incidencia = String(r[3] || "").trim();
  let valor = r[4];
  if (typeof valor === "string") valor = parseFloat(valor.replace(/\./g, "").replace(",", ".")) || 0;
  if (typeof valor !== "number" || !isFinite(valor)) valor = 0;
  valor = Math.round(valor * 100) / 100;
  if (!item || !descricao) continue;
  const searchText = [item, descricao, incidencia].join(" ").toLowerCase();
  out.push({ item, descricao, grau, incidencia, valor, searchText });
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  JSON.stringify(
    { source: "docs/VALORES MULTAS.xlsx", sheet: "R$ PENALIDADES", clausulas: out },
    null,
    2
  ),
  "utf8"
);
console.log("OK:", out.length, "cláusulas →", outPath);
