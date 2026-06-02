/**
 * Mock base tipado para as páginas "Cruzamento Inteligente" e "Despachos SELIMP".
 *
 * IMPORTANTE: tudo aqui é dado-fake DETERMINÍSTICO, gerado por um PRNG seedado
 * pelo par (setor, dia). As shapes seguem `IptPreviewResponse` (de `@/lib/api`),
 * então a troca para dados reais (getIptPreview / importação de cronograma) deve
 * ser feita substituindo `gerarDetalhes()` e `SETORES` por fontes reais — o resto
 * (cruzamento.ts / despachos.ts / páginas) consome só estes tipos.
 */
import {
  differenceInCalendarDays,
  eachDayOfInterval,
  format,
  getDay,
  startOfDay,
} from "date-fns";
import type { IptPreviewResponse } from "@/lib/api";

/** Elemento de `detalhes_diarios` exatamente como o backend devolve hoje. */
export type DetalheDiario = NonNullable<
  IptPreviewResponse["itens"]
>[number]["detalhes_diarios"][number];

/** Perfil de confiabilidade de execução de um setor (define a "história" do mock). */
export type PerfilSetor = "nunca" | "critico" | "irregular" | "regular" | "sempre";

export interface SetorBase {
  id: string;
  /** Código curto da subprefeitura (CV / MG / JT / ST) — consistente com o app. */
  subprefeitura: string;
  /** Nome legível do setor (ex.: "CV / Setor 03 — Cajazeiras X"). */
  setor: string;
  tipo_servico: string;
  /** Texto de frequência (ex.: "Seg a Sáb", "3x/semana", "Quinzenal"). */
  frequencia: string;
  /** Dias da semana previstos (0=Dom … 6=Sáb). */
  diasSemana: number[];
  /** Quando true, só executa em semanas alternadas (quinzenal). */
  quinzenal?: boolean;
  perfil: PerfilSetor;
}

export const SUBPREFEITURAS = ["CV", "MG", "JT", "ST"] as const;

/** Nome legível por subprefeitura (apenas rótulo de apoio). */
export const SUBPREFEITURA_NOME: Record<string, string> = {
  CV: "Cajazeiras / Valéria",
  MG: "Mata Escura / Subúrbio",
  JT: "Itapuã / Centro",
  ST: "Cidade Baixa / Liberdade",
};

interface ServicoDef {
  nome: string;
  abrev: string;
  freq: string;
  dias: number[];
  quinzenal?: boolean;
  /** quantos setores gerar por subprefeitura */
  porSub: number;
}

/** Catálogo de serviços — foco nos de alto volume de despacho (varrição etc.). */
const SERVICOS: ServicoDef[] = [
  { nome: "Varrição Diária", abrev: "VD", freq: "Seg a Sáb", dias: [1, 2, 3, 4, 5, 6], porSub: 4 },
  { nome: "Varrição de Praças", abrev: "VP", freq: "3x/semana", dias: [1, 3, 5], porSub: 3 },
  { nome: "Varrição Manual", abrev: "VM", freq: "Seg a Sex", dias: [1, 2, 3, 4, 5], porSub: 3 },
  { nome: "Capina e Raspagem", abrev: "CR", freq: "2x/semana", dias: [2, 5], porSub: 2 },
  { nome: "Pintura de Meio-Fio", abrev: "PM", freq: "Semanal", dias: [3], porSub: 1 },
  { nome: "Coleta de Entulho", abrev: "CE", freq: "2x/semana", dias: [1, 4], porSub: 2 },
  { nome: "Poda de Árvore", abrev: "PA", freq: "Quinzenal", dias: [2], quinzenal: true, porSub: 1 },
];

const BAIRROS: Record<string, string[]> = {
  CV: ["Cajazeiras X", "Águas Claras", "Fazenda Grande", "Valéria", "Boca da Mata"],
  MG: ["Mata Escura", "Tancredo Neves", "Pernambués", "Sussuarana", "Cabula"],
  JT: ["Itapuã", "Centro", "Barra", "Rio Vermelho", "Stiep"],
  ST: ["Liberdade", "Cidade Baixa", "Comércio", "Calçada", "Roma"],
};

/* ------------------------------------------------------------------ */
/* PRNG determinístico (mulberry32) seedado por string                 */
/* ------------------------------------------------------------------ */

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngFor(...parts: (string | number)[]): () => number {
  return mulberry32(hashStr(parts.join("|")));
}

function perfilFromHash(id: string): PerfilSetor {
  const bucket = hashStr(id) % 100;
  if (bucket < 12) return "nunca";
  if (bucket < 30) return "critico";
  if (bucket < 60) return "irregular";
  if (bucket < 85) return "regular";
  return "sempre";
}

/* ------------------------------------------------------------------ */
/* Catálogo de setores                                                 */
/* ------------------------------------------------------------------ */

function construirSetores(): SetorBase[] {
  const out: SetorBase[] = [];
  for (const sub of SUBPREFEITURAS) {
    const bairros = BAIRROS[sub];
    for (const serv of SERVICOS) {
      for (let i = 1; i <= serv.porSub; i++) {
        const id = `${sub}-${serv.abrev}-${String(i).padStart(2, "0")}`;
        const bairro = bairros[(serv.abrev.charCodeAt(0) + i) % bairros.length];
        out.push({
          id,
          subprefeitura: sub,
          setor: `${sub} / Setor ${String((SERVICOS.indexOf(serv) + 1) * 10 + i).padStart(2, "0")} — ${bairro}`,
          tipo_servico: serv.nome,
          frequencia: serv.freq,
          diasSemana: serv.dias,
          quinzenal: serv.quinzenal,
          perfil: perfilFromHash(id),
        });
      }
    }
  }
  return out;
}

export const SETORES: SetorBase[] = construirSetores();

export const TIPOS_SERVICO: string[] = SERVICOS.map((s) => s.nome);

export function getSetorById(id: string): SetorBase | undefined {
  return SETORES.find((s) => s.id === id);
}

/* ------------------------------------------------------------------ */
/* Janela do plano                                                     */
/* ------------------------------------------------------------------ */

/** "O plano começa de fato em maio" — abril é descartado (troca de plano). */
export function getPlanoInicio(ref: Date = new Date()): Date {
  return startOfDay(new Date(ref.getFullYear(), 4, 1)); // maio = mês 4
}

export function isEsperado(setor: SetorBase, date: Date, planoInicio: Date): boolean {
  if (!setor.diasSemana.includes(getDay(date))) return false;
  if (setor.quinzenal) {
    const semana = Math.floor(differenceInCalendarDays(date, planoInicio) / 7);
    if (semana % 2 !== 0) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Geração de detalhes diários (coração do mock)                       */
/* ------------------------------------------------------------------ */

const PROB_DESPACHO: Record<PerfilSetor, number> = {
  nunca: 0,
  critico: 0.18,
  irregular: 0.55,
  regular: 0.9,
  sempre: 0.985,
};

const cacheDetalhe = new Map<string, DetalheDiario>();

/** Gera (e memoiza) o detalhe de UM dia para UM setor — estável p/ qualquer janela. */
function gerarDetalheDia(setor: SetorBase, date: Date, planoInicio: Date): DetalheDiario {
  const dataStr = format(date, "yyyy-MM-dd");
  const cacheKey = `${setor.id}|${dataStr}`;
  const cached = cacheDetalhe.get(cacheKey);
  if (cached) return cached;

  const r = rngFor(setor.id, dataStr);
  const esperado = isEsperado(setor, date, planoInicio);

  let despachosSelimp = 0;
  let percentualSelimp: number | null = null;

  if (esperado) {
    const prob = PROB_DESPACHO[setor.perfil];
    if (r() < prob) {
      // Despachado — pode ser zerado (despachou mas 0% de execução).
      const zerado = r() < 0.06;
      despachosSelimp = 1 + Math.floor(r() * 7);
      if (zerado) {
        percentualSelimp = 0;
      } else {
        const base = setor.perfil === "irregular" ? 35 : 60;
        percentualSelimp = Math.round(base + r() * (100 - base));
      }
    }
  } else if (r() < 0.04) {
    // Despachado FORA do previsto (erro de operação) — relevante p/ a tela de Despachos.
    despachosSelimp = 1 + Math.floor(r() * 3);
    percentualSelimp = Math.round(50 + r() * 50);
  }

  // Nossa medição diverge levemente da SELIMP.
  let percentualNosso: number | null = null;
  let despachosNosso = despachosSelimp;
  if (percentualSelimp != null) {
    const delta = Math.round((r() - 0.5) * 18);
    percentualNosso = Math.min(100, Math.max(0, percentualSelimp + delta));
    if (r() < 0.08) despachosNosso = Math.max(0, despachosSelimp + (r() < 0.5 ? -1 : 1));
  }

  const detalhe: DetalheDiario = {
    data: dataStr,
    esperado,
    percentual_selimp: percentualSelimp,
    percentual_nosso: percentualNosso,
    despachos_selimp: despachosSelimp,
    despachos_nosso: despachosNosso,
    data_estimada: false,
  };
  cacheDetalhe.set(cacheKey, detalhe);
  return detalhe;
}

/** Detalhes diários de um setor no intervalo [from, to] (inclusive). */
export function gerarDetalhes(setor: SetorBase, from: Date, to: Date): DetalheDiario[] {
  const planoInicio = getPlanoInicio(to);
  const inicio = startOfDay(from < planoInicio ? planoInicio : from);
  const fim = startOfDay(to);
  if (fim < inicio) return [];
  return eachDayOfInterval({ start: inicio, end: fim }).map((d) =>
    gerarDetalheDia(setor, d, planoInicio)
  );
}

/** Detalhe de um único dia (atalho para a tela de Despachos). */
export function gerarDetalheDoDia(setor: SetorBase, dia: Date): DetalheDiario {
  return gerarDetalheDia(setor, startOfDay(dia), getPlanoInicio(dia));
}

/* ------------------------------------------------------------------ */
/* Helpers de apresentação compartilhados                              */
/* ------------------------------------------------------------------ */

/** Classe de cor por subprefeitura (alinhada ao padrão da página Bateria). */
export function subprefBadgeClass(sub: string): string {
  switch (sub.trim().toUpperCase()) {
    case "CV":
      return "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300";
    case "MG":
      return "border-cyan-500/40 bg-cyan-500/12 text-cyan-700 dark:text-cyan-300";
    case "JT":
      return "border-blue-700/45 bg-blue-700/12 text-blue-800 dark:border-blue-600 dark:text-blue-200";
    case "ST":
      return "border-amber-400/50 bg-amber-400/15 text-amber-700 dark:text-amber-200";
    default:
      return "border-border/60 bg-muted/40 text-muted-foreground";
  }
}

/** Próxima data prevista (>= a partir de `ref`) formatada dd/MM — para a coluna "próxima programação". */
export function proximaProgramacao(setor: SetorBase, ref: Date): string | null {
  const planoInicio = getPlanoInicio(ref);
  for (let i = 1; i <= 21; i++) {
    const d = startOfDay(new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + i));
    if (isEsperado(setor, d, planoInicio)) return format(d, "dd/MM");
  }
  return null;
}
