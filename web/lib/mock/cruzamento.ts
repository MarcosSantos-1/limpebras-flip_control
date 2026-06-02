/**
 * Mock da página "Cruzamento Inteligente" (retrospectivo / diagnóstico).
 *
 * Agrega `gerarDetalhes()` por setor no período e produz: diagnóstico, ranking
 * (ordenado por gap = previstos − executados), heatmap calendário e quebras por
 * serviço/subprefeitura. Tudo derivado das mesmas shapes reais.
 */
import {
  SETORES,
  gerarDetalhes,
  type DetalheDiario,
  type SetorBase,
} from "./ipt-shared";

export interface CruzamentoFiltros {
  from: Date;
  to: Date;
  subprefeitura: string; // "all" | código
  tipoServico: string; // "all" | nome
  apenasComPrevisao: boolean;
}

export type StatusSetor = "nunca" | "critico" | "irregular" | "ok";

export interface RankingRow {
  rank: number;
  setorId: string;
  setor: string;
  subprefeitura: string;
  tipo_servico: string;
  frequencia: string;
  diasPrevistos: number;
  diasExecutados: number;
  gap: number;
  percentualMedio: number | null;
  zerados: number;
  divergencias: number;
  status: StatusSetor;
  detalhes: DetalheDiario[];
}

export interface CruzamentoDiagnostico {
  totalSetores: number;
  nuncaExecutados: number;
  criticos: number;
  coberturaDespachos: number; // %
  despachosZerados: number;
  divergencias: number;
}

export type EstadoCelula = "exec" | "parcial" | "falha" | "nao_previsto";

export interface HeatmapLinha {
  setorId: string;
  setor: string;
  subprefeitura: string;
  celulas: Array<{ data: string; estado: EstadoCelula; percentual: number | null }>;
}

export interface HeatmapData {
  dias: string[];
  linhas: HeatmapLinha[];
}

export interface AggServico {
  tipo_servico: string;
  previstos: number;
  executados: number;
  cobertura: number;
}

export interface AggSub {
  subprefeitura: string;
  previstos: number;
  executados: number;
  falhas: number;
}

export interface CruzamentoData {
  diagnostico: CruzamentoDiagnostico;
  ranking: RankingRow[];
  heatmap: HeatmapData;
  porServico: AggServico[];
  porSubprefeitura: AggSub[];
}

function statusDoSetor(
  diasPrevistos: number,
  diasExecutados: number,
  percentualMedio: number | null
): StatusSetor {
  if (diasPrevistos > 0 && diasExecutados === 0) return "nunca";
  const taxa = diasPrevistos > 0 ? diasExecutados / diasPrevistos : 1;
  if (taxa < 0.4 || (percentualMedio != null && percentualMedio < 45)) return "critico";
  if (taxa < 0.8) return "irregular";
  return "ok";
}

function setorPassaFiltro(s: SetorBase, f: CruzamentoFiltros): boolean {
  if (f.subprefeitura !== "all" && s.subprefeitura !== f.subprefeitura) return false;
  if (f.tipoServico !== "all" && s.tipo_servico !== f.tipoServico) return false;
  return true;
}

export function getCruzamentoMock(f: CruzamentoFiltros): CruzamentoData {
  const setores = SETORES.filter((s) => setorPassaFiltro(s, f));

  const ranking: RankingRow[] = [];
  const porServicoMap = new Map<string, AggServico>();
  const porSubMap = new Map<string, AggSub>();
  const heatmapLinhas: HeatmapLinha[] = [];
  let diasUnicos: string[] = [];

  let totalPrevistos = 0;
  let totalExecutados = 0;
  let totalZerados = 0;
  let totalDivergencias = 0;

  for (const s of setores) {
    const detalhes = gerarDetalhes(s, f.from, f.to);
    if (diasUnicos.length === 0) diasUnicos = detalhes.map((d) => d.data);

    const previstos = detalhes.filter((d) => d.esperado);
    const diasPrevistos = previstos.length;
    const diasExecutados = previstos.filter((d) => d.despachos_selimp > 0).length;
    const zerados = detalhes.filter(
      (d) => d.despachos_selimp > 0 && d.percentual_selimp === 0
    ).length;
    const divergencias = detalhes.filter(
      (d) =>
        d.percentual_selimp != null &&
        d.percentual_nosso != null &&
        Math.abs(d.percentual_selimp - d.percentual_nosso) > 12
    ).length;
    const execComPercent = previstos.filter(
      (d) => d.despachos_selimp > 0 && d.percentual_selimp != null
    );
    const percentualMedio =
      execComPercent.length > 0
        ? Math.round(
            execComPercent.reduce((acc, d) => acc + (d.percentual_selimp ?? 0), 0) /
              execComPercent.length
          )
        : null;

    if (f.apenasComPrevisao && diasPrevistos === 0) continue;

    const status = statusDoSetor(diasPrevistos, diasExecutados, percentualMedio);

    ranking.push({
      rank: 0,
      setorId: s.id,
      setor: s.setor,
      subprefeitura: s.subprefeitura,
      tipo_servico: s.tipo_servico,
      frequencia: s.frequencia,
      diasPrevistos,
      diasExecutados,
      gap: diasPrevistos - diasExecutados,
      percentualMedio,
      zerados,
      divergencias,
      status,
      detalhes,
    });

    // Agregados
    totalPrevistos += diasPrevistos;
    totalExecutados += diasExecutados;
    totalZerados += zerados;
    totalDivergencias += divergencias;

    const ps =
      porServicoMap.get(s.tipo_servico) ??
      { tipo_servico: s.tipo_servico, previstos: 0, executados: 0, cobertura: 0 };
    ps.previstos += diasPrevistos;
    ps.executados += diasExecutados;
    porServicoMap.set(s.tipo_servico, ps);

    const pSub =
      porSubMap.get(s.subprefeitura) ??
      { subprefeitura: s.subprefeitura, previstos: 0, executados: 0, falhas: 0 };
    pSub.previstos += diasPrevistos;
    pSub.executados += diasExecutados;
    pSub.falhas += diasPrevistos - diasExecutados;
    porSubMap.set(s.subprefeitura, pSub);

    // Heatmap (limitado depois)
    heatmapLinhas.push({
      setorId: s.id,
      setor: s.setor,
      subprefeitura: s.subprefeitura,
      celulas: detalhes.map((d) => {
        let estado: EstadoCelula;
        if (!d.esperado) estado = "nao_previsto";
        else if (d.despachos_selimp === 0) estado = "falha";
        else if (d.percentual_selimp != null && d.percentual_selimp < 50) estado = "parcial";
        else estado = "exec";
        return { data: d.data, estado, percentual: d.percentual_selimp };
      }),
    });
  }

  // Ranking por gap desc, depois por % médio asc (pior primeiro).
  ranking.sort((a, b) => {
    if (b.gap !== a.gap) return b.gap - a.gap;
    return (a.percentualMedio ?? 999) - (b.percentualMedio ?? 999);
  });
  ranking.forEach((r, i) => (r.rank = i + 1));

  const porServico = [...porServicoMap.values()]
    .map((p) => ({ ...p, cobertura: p.previstos > 0 ? Math.round((p.executados / p.previstos) * 100) : 0 }))
    .sort((a, b) => b.previstos - a.previstos);

  const porSubprefeitura = [...porSubMap.values()].sort((a, b) => b.falhas - a.falhas);

  const diagnostico: CruzamentoDiagnostico = {
    totalSetores: ranking.length,
    nuncaExecutados: ranking.filter((r) => r.status === "nunca").length,
    criticos: ranking.filter((r) => r.status === "critico").length,
    coberturaDespachos:
      totalPrevistos > 0 ? Math.round((totalExecutados / totalPrevistos) * 100) : 0,
    despachosZerados: totalZerados,
    divergencias: totalDivergencias,
  };

  // Heatmap: ordena pelas piores linhas (mesma ordem do ranking) e mostra as primeiras.
  const ordem = new Map(ranking.map((r, i) => [r.setorId, i]));
  heatmapLinhas.sort((a, b) => (ordem.get(a.setorId) ?? 0) - (ordem.get(b.setorId) ?? 0));

  return {
    diagnostico,
    ranking,
    heatmap: { dias: diasUnicos, linhas: heatmapLinhas },
    porServico,
    porSubprefeitura,
  };
}

/** Rótulo curto de uma data ISO (yyyy-MM-dd) → dd/MM. */
export function formatDiaCurto(dataStr: string): string {
  const [, m, d] = dataStr.split("-");
  return `${d}/${m}`;
}
