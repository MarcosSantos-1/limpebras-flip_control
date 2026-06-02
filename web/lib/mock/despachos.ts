/**
 * Mock da página "Despachos SELIMP" (operacional / diário).
 *
 * Recorta UM dia e cruza planejado (esperado pela frequência) × despachado
 * (despachos_selimp). Também monta a tendência dos últimos 14 dias por cobertura.
 */
import { format, startOfDay, subDays } from "date-fns";
import {
  SETORES,
  gerarDetalheDoDia,
  gerarDetalhes,
  proximaProgramacao,
  type SetorBase,
} from "./ipt-shared";

export interface DespachosFiltros {
  dia: Date;
  subprefeitura: string; // "all" | código
  tipoServico: string; // "all" | nome
}

export type StatusDia =
  | "conforme"
  | "nao_despachado"
  | "fora_plano"
  | "zerado"
  | "nao_previsto";

export interface DespachoLinha {
  setorId: string;
  setor: string;
  subprefeitura: string;
  tipo_servico: string;
  frequencia: string;
  esperado: boolean;
  despachosSelimp: number;
  despachosNosso: number;
  percentual: number | null;
  status: StatusDia;
  proximaProgramacao: string | null;
}

export interface DespachosKpis {
  previstos: number;
  despachados: number;
  naoDespachados: number;
  foraPlano: number;
  zerados: number;
  cobertura: number; // %
}

export interface TendenciaDia {
  data: string; // dd/MM
  previstos: number;
  despachados: number;
  cobertura: number; // %
}

export interface DespachosData {
  kpis: DespachosKpis;
  linhas: DespachoLinha[];
  tendencia14d: TendenciaDia[];
}

function setorPassaFiltro(s: SetorBase, f: DespachosFiltros): boolean {
  if (f.subprefeitura !== "all" && s.subprefeitura !== f.subprefeitura) return false;
  if (f.tipoServico !== "all" && s.tipo_servico !== f.tipoServico) return false;
  return true;
}

function statusDoDia(esperado: boolean, despachos: number, percentual: number | null): StatusDia {
  if (esperado && despachos === 0) return "nao_despachado";
  if (!esperado && despachos > 0) return "fora_plano";
  if (despachos > 0 && percentual === 0) return "zerado";
  if (esperado && despachos > 0) return "conforme";
  return "nao_previsto";
}

export function getDespachosMock(f: DespachosFiltros): DespachosData {
  const setores = SETORES.filter((s) => setorPassaFiltro(s, f));
  const dia = startOfDay(f.dia);

  const linhas: DespachoLinha[] = setores.map((s) => {
    const det = gerarDetalheDoDia(s, dia);
    return {
      setorId: s.id,
      setor: s.setor,
      subprefeitura: s.subprefeitura,
      tipo_servico: s.tipo_servico,
      frequencia: s.frequencia,
      esperado: det.esperado,
      despachosSelimp: det.despachos_selimp,
      despachosNosso: det.despachos_nosso,
      percentual: det.percentual_selimp,
      status: statusDoDia(det.esperado, det.despachos_selimp, det.percentual_selimp),
      proximaProgramacao: proximaProgramacao(s, dia),
    };
  });

  const previstos = linhas.filter((l) => l.esperado).length;
  const despachados = linhas.filter((l) => l.esperado && l.despachosSelimp > 0).length;
  const naoDespachados = linhas.filter((l) => l.status === "nao_despachado").length;
  const foraPlano = linhas.filter((l) => l.status === "fora_plano").length;
  const zerados = linhas.filter((l) => l.status === "zerado").length;

  const kpis: DespachosKpis = {
    previstos,
    despachados,
    naoDespachados,
    foraPlano,
    zerados,
    cobertura: previstos > 0 ? Math.round((despachados / previstos) * 100) : 0,
  };

  // Tendência dos últimos 14 dias (cobertura diária agregada).
  const tendencia14d: TendenciaDia[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = startOfDay(subDays(dia, i));
    let prev = 0;
    let desp = 0;
    for (const s of setores) {
      const det = gerarDetalhes(s, d, d)[0];
      if (!det) continue;
      if (det.esperado) {
        prev += 1;
        if (det.despachos_selimp > 0) desp += 1;
      }
    }
    tendencia14d.push({
      data: format(d, "dd/MM"),
      previstos: prev,
      despachados: desp,
      cobertura: prev > 0 ? Math.round((desp / prev) * 100) : 0,
    });
  }

  // Ordena: falhas primeiro (mais acionável), depois fora do plano, depois o resto.
  const ordemStatus: Record<StatusDia, number> = {
    nao_despachado: 0,
    fora_plano: 1,
    zerado: 2,
    conforme: 3,
    nao_previsto: 4,
  };
  linhas.sort((a, b) => ordemStatus[a.status] - ordemStatus[b.status]);

  return { kpis, linhas, tendencia14d };
}
