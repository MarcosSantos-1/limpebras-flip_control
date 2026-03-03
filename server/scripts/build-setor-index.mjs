#!/usr/bin/env node
/**
 * Gera índice compacto de setores a partir de web/lib/data.json.
 * O índice contém apenas centroids + setor + sub + service + frequencia + cronograma.
 * Uso: node server/scripts/build-setor-index.mjs
 * Requer: NODE_OPTIONS=--max-old-space-size=4096 para arquivos >150MB
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const dataPath = path.join(rootDir, "web/lib/data.json");
const outPath = path.join(rootDir, "server/data/setor-index.json");

const SUB_NORMALIZE = {
  "casa verde": "CV",
  "cachoeirinha": "CV",
  "casa verde / cachoeirinha": "CV",
  "jaçanã": "JT",
  "tremembé": "JT",
  "jacana": "JT",
  "tremembe": "JT",
  "jaçanã / tremembé": "JT",
  "vila maria": "MG",
  "vila guilherme": "MG",
  "vila maria / vila guilherme": "MG",
  "santana": "ST",
  "tucuruvi": "ST",
  "santana / tucuruvi": "ST",
};

function subToSigla(sub) {
  if (!sub || typeof sub !== "string") return null;
  const k = sub.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s*\/\s*/g, " / ");
  for (const [key, sigla] of Object.entries(SUB_NORMALIZE)) {
    if (k.includes(key) || k.replace(/\s+/g, " ").includes(key)) return sigla;
  }
  return null;
}

console.log("Lendo", dataPath, "...");
const raw = fs.readFileSync(dataPath, "utf-8");
console.log("Parseando JSON...");
const data = JSON.parse(raw);
console.log("Construindo índice...");

const index = [];
const services = data?.services ?? {};
for (const [serviceKey, segments] of Object.entries(services)) {
  if (!Array.isArray(segments)) continue;
  for (const seg of segments) {
    const centroid = seg.centroid;
    if (!Array.isArray(centroid) || centroid.length < 2) continue;
    const sub = subToSigla(seg.subprefeitura);
    if (!sub) continue;
    index.push({
      lat: centroid[0],
      lng: centroid[1],
      setor: seg.setor ?? "",
      sub,
      service: serviceKey,
      frequencia: seg.frequencia ?? "",
      cronograma: seg.cronograma ?? "",
    });
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(index), "utf-8");
console.log("Índice salvo em", outPath, "|", index.length, "segmentos");
