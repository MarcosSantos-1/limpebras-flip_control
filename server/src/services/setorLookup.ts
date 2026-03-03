/**
 * Lookup de setor por coordenadas (lat/lng), tipo de serviço e subprefeitura.
 * Usa índice gerado por scripts/build-setor-index.mjs a partir de web/lib/data.json.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { regionalToSigla } from "../constants/regionais.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface SetorMatch {
  setor: string;
  frequencia: string;
  cronograma: string;
  service?: string;
}

interface IndexEntry {
  lat: number;
  lng: number;
  setor: string;
  sub: string;
  service: string;
  frequencia: string;
  cronograma: string;
}

let indexCache: IndexEntry[] | null = null;

/**
 * Mapeia tipo_servico (BFS/CNC) para service keys do data.json.
 * Ordem: mais específico primeiro.
 */
const TIPO_SERVICO_TO_KEYS: Array<{ pattern: RegExp | string; keys: string[] }> = [
  { pattern: /varri[cç]ao\s+manual|varrição manual/i, keys: ["VJ_VL"] },
  { pattern: /varri[cç]ao\s+mecanizada|varrição mecanizada/i, keys: ["VJ_VL"] },
  { pattern: /varri[cç]ao/i, keys: ["VJ_VL"] },
  { pattern: /mutir[aã]o|mutirão/i, keys: ["MT_ESC"] },
  { pattern: /lavagem/i, keys: ["LE", "LF", "BL"] },
  { pattern: /bueiro|desobstru[cç]ao/i, keys: ["LE", "LF"] },
  { pattern: /cata-bagulho|volumoso|entulho/i, keys: ["GO"] },
  { pattern: /ecoponto/i, keys: ["NH"] },
  { pattern: /pev|ponto de entrega/i, keys: ["PV", "VP"] },
  { pattern: /zeladoria/i, keys: ["MT_ESC"] },
];

function getServiceKeysForTipoServico(tipoServico: string | undefined): string[] {
  if (!tipoServico?.trim()) return ["MT_ESC", "VJ_VL", "GO", "BL", "LE", "LF", "NH", "VP", "PV"];
  const t = tipoServico.trim();
  for (const { pattern, keys } of TIPO_SERVICO_TO_KEYS) {
    if (typeof pattern === "string" ? t.toLowerCase().includes(pattern) : pattern.test(t)) {
      return keys;
    }
  }
  return ["MT_ESC", "VJ_VL", "GO", "BL"];
}

function loadIndex(): IndexEntry[] {
  if (indexCache) return indexCache;
  const indexPath =
    process.env.SETOR_INDEX_PATH ||
    path.join(__dirname, "../../data/setor-index.json");
  try {
    const raw = fs.readFileSync(indexPath, "utf-8");
    indexCache = JSON.parse(raw) as IndexEntry[];
    return indexCache;
  } catch {
    indexCache = [];
    return [];
  }
}

function distSq(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dlat = lat1 - lat2;
  const dlng = lng1 - lng2;
  return dlat * dlat + dlng * dlng;
}

/**
 * Encontra o setor mais próximo das coordenadas, filtrando por subprefeitura e tipo de serviço.
 */
export function findSetorByCoords(
  lat: number,
  lng: number,
  tipoServico: string | undefined,
  subprefeitura: string | undefined
): SetorMatch | null {
  const index = loadIndex();
  if (index.length === 0) return null;

  const subSigla = regionalToSigla(subprefeitura);
  const serviceKeys = getServiceKeysForTipoServico(tipoServico);

  let best: IndexEntry | null = null;
  let bestDist = Infinity;

  for (const entry of index) {
    if (subSigla && entry.sub !== subSigla) continue;
    if (!serviceKeys.includes(entry.service)) continue;

    const d = distSq(lat, lng, entry.lat, entry.lng);
    if (d < bestDist) {
      bestDist = d;
      best = entry;
    }
  }

  if (!best) return null;
  return {
    setor: best.setor,
    frequencia: best.frequencia,
    cronograma: best.cronograma,
    service: best.service,
  };
}

/**
 * Parseia coordenada no formato "lat,lng" (ex: "-23.514,-46.663").
 */
export function parseCoordenada(coordenada: string | undefined): { lat: number; lng: number } | null {
  if (!coordenada?.trim()) return null;
  const parts = coordenada.trim().split(/[,;\s]+/).map((p) => parseFloat(p.trim()));
  if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return { lat: parts[0], lng: parts[1] };
  }
  return null;
}
