/**
 * Domicílios por regional (IBGE) para cálculo e visualização do IRD.
 * Fonte: usuário / contrato.
 */
export const DOMICILIOS_POR_REGIONAL: Record<string, number> = {
  CV: 130_030, // Casa Verde / Limão / Cachoeirinha
  JT: 112_924, // Jaçanã / Tremembé
  MG: 120_170, // Vila Maria / Vila Guilherme
  ST: 147_924, // Santana / Tucuruvi
};

export const SUB_SIGLAS = ["CV", "JT", "MG", "ST"] as const;

/** Nomes que mapeiam para cada sigla (para normalizar regional do BFS/SACs). */
const REGIONAL_TO_SIGLA: Array<{ keys: string[]; sigla: string }> = [
  { keys: ["casa verde", "cachoeirinha", "limao", "limão"], sigla: "CV" },
  { keys: ["jaçanã", "jacana", "tremembé", "tremembe"], sigla: "JT" },
  { keys: ["vila maria", "vila guilherme"], sigla: "MG" },
  { keys: ["santana", "tucuruvi"], sigla: "ST" },
];

/** Normaliza regional (BFS ou SACs) para sigla CV, JT, MG, ST. */
export function regionalToSigla(regional: string | undefined | null): string | null {
  if (!regional || !String(regional).trim()) return null;
  const normalized = String(regional)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, " ");
  const words = normalized.split(/\s+/).filter(Boolean);
  for (const { keys, sigla } of REGIONAL_TO_SIGLA) {
    for (const k of keys) {
      if (normalized.includes(k) || words.some((w) => k.includes(w) || w.includes(k))) {
        return sigla;
      }
    }
  }
  // Fallback: sigla direta (CV, JT, MG, ST)
  const upper = String(regional).trim().toUpperCase();
  if (SUB_SIGLAS.includes(upper as (typeof SUB_SIGLAS)[number])) return upper;
  return null;
}
