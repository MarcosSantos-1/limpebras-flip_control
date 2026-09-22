const SERVICO_CURTO: Array<[RegExp, string]> = [
  [/mutir/i, "Mutirão"],
  [/lavagem especial/i, "Lavagem especial"],
  [/p[oó]s feiras/i, "Lavagem pós-feira"],
  [/volumosos|entulho|cata-bagulho/i, "Cata-bagulho"],
  [/bueiro|bocas de lobo/i, "Bueiros"],
  [/feiras-livres com compactador/i, "Compactador de feiras"],
  [/varri[cç][aã]o com compactador/i, "Compactador de varrição"],
  [/varri[cç][aã]o de feiras/i, "Varrição de feiras"],
  [/varri[cç][aã]o mecanizada/i, "Varrição mecanizada"],
  [/n[uú]cleos habitacionais/i, "Núcleos habitacionais"],
  [/situa[cç][aã]o de rua/i, "Asseio"],
  [/monumentos/i, "Monumentos"],
  [/sarjetas e cal[cç]adas/i, "Sarjetas e calçadas"],
];

/** Portáteis de feira: varrição, lavagem e coleta no mesmo módulo. Leitura diária. */
export const SERVICO_FEIRA = "FEIRA";

export function isServicoFeira(servico?: string | null): boolean {
  return String(servico ?? "").trim().toUpperCase() === SERVICO_FEIRA;
}

export const SUBS = [
  { sigla: "CV", label: "Casa Verde / Limão / Cachoeirinha" },
  { sigla: "JT", label: "Jaçanã / Tremembé" },
  { sigla: "MG", label: "Vila Maria / Vila Guilherme" },
  { sigla: "ST", label: "Santana / Tucuruvi" },
] as const;

export function subLabel(sigla?: string | null): string {
  const key = String(sigla ?? "").trim().toUpperCase();
  return SUBS.find((sub) => sub.sigla === key)?.label ?? (key || "—");
}

export function servicoCurto(servico?: string | null): string {
  const text = String(servico ?? "").trim();
  if (!text) return "—";
  const found = SERVICO_CURTO.find(([pattern]) => pattern.test(text));
  return found ? found[1] : text;
}
