export const TIPOS_ESCALONADOS = [
  "CATABAGULHO",
  "VARRIACAO_COLETA",
  "MUTIRAO",
  "LAVAGEM",
  "BUEIRO",
  "VARRIACAO",
  "VARRIACAO_PRACAS",
  "MONUMENTOS",
  "OUTROS",
]

export const TIPOS_DEMANDANTES = [
  "ENTULHO",
  "ANIMAL_MORTO",
  "PAPELEIRAS",
]

export const STATUS_PROCEDENTES = ["Executado", "Finalizado", "Confirmada Execução"]

export const SUBPREFEITURAS = [
  { code: "CV", label: "Casa Verde / Cachoeirinha" },
  { code: "JT", label: "Jaçanã / Tremembé" },
  { code: "ST", label: "Santana / Tucuruvi" },
  { code: "MG", label: "Vila Maria / Vila Guilherme" },
]

export type SubprefeituraCode = (typeof SUBPREFEITURAS)[number]["code"]

