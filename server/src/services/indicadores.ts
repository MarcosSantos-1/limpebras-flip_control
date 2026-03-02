import { config } from "../config.js";

/** Resultado de um indicador: valor bruto, percentual quando aplicável, e pontuação. */
export interface IndicadorResult {
  valor: number;
  percentual?: number;
  pontuacao: number;
  detalhe?: string;
}

/** IA: (solicitações atendidas no prazo / total solicitações demandantes) × 1000 */
export function pontuacaoIA(solicitacoesNoPrazo: number, totalSolicitacoes: number): IndicadorResult {
  const valor = totalSolicitacoes > 0 ? (solicitacoesNoPrazo / totalSolicitacoes) * 1000 : 0;
  const percentual = valor / 10;
  let pontuacao = 0;
  if (valor >= 900) pontuacao = 20;
  else if (valor >= 800) pontuacao = 16;
  else if (valor >= 700) pontuacao = 12;
  else if (valor >= 600) pontuacao = 8;
  else if (valor >= 500) pontuacao = 4;
  return { valor, percentual, pontuacao };
}

/** IRD = (reclamações procedentes / domicílios) × 1000. Quanto menor, melhor. */
export function pontuacaoIRD(reclamacoesProcedentes: number): IndicadorResult {
  const valor = config.domicilios > 0 ? (reclamacoesProcedentes / config.domicilios) * 1000 : 0;
  let pontuacao = 0;
  if (valor <= 1) pontuacao = 20;
  else if (valor <= 2) pontuacao = 15;
  else if (valor <= 5) pontuacao = 10;
  else if (valor <= 10) pontuacao = 5;
  return { valor, pontuacao };
}

/** IF = (BFS sem irregularidade / total BFS Não Demandantes) × 1000. Quanto maior, melhor. */
export function pontuacaoIF(semIrregularidade: number, total: number): IndicadorResult {
  const valor = total > 0 ? (semIrregularidade / total) * 1000 : 0;
  const percentual = valor / 10;
  let pontuacao = 0;
  if (valor >= 900) pontuacao = 20;
  else if (valor >= 800) pontuacao = 18;
  else if (valor >= 700) pontuacao = 16;
  else if (valor >= 600) pontuacao = 14;
  else if (valor >= 500) pontuacao = 12;
  else if (valor >= 400) pontuacao = 10;
  else if (valor >= 300) pontuacao = 8;
  else if (valor >= 200) pontuacao = 6;
  else if (valor >= 100) pontuacao = 4;
  return { valor, percentual, pontuacao };
}

/** IF a partir do percentual médio (ex: 67 para 67%). Usado quando IF é média das subs. */
export function pontuacaoIFFromPercentual(percentual: number): IndicadorResult {
  const p = Math.min(100, Math.max(0, percentual));
  return pontuacaoIF(p, 100); // 67% -> (67, 100) -> valor 670, percentual 67
}

/** IPT: entrada manual por enquanto. percentual 0–100. */
export function pontuacaoIPT(percentual: number): IndicadorResult {
  let pontuacao = 0;
  if (percentual >= 90) pontuacao = 40;
  else if (percentual >= 80) pontuacao = 38;
  else if (percentual >= 70) pontuacao = 36;
  else if (percentual >= 60) pontuacao = 32;
  else if (percentual >= 50) pontuacao = 28;
  else if (percentual >= 40) pontuacao = 24;
  else if (percentual >= 30) pontuacao = 20;
  else if (percentual >= 20) pontuacao = 16;
  else if (percentual >= 10) pontuacao = 12;
  return { valor: percentual, percentual, pontuacao };
}

/** ADC = IRD + IA + IF + IPT (máx 100). Desconto por faixa (texto). */
export function descontoADC(pontuacaoTotal: number): { percentualRecebimento: number; texto: string } {
  if (pontuacaoTotal >= 90) return { percentualRecebimento: 100, texto: "100% do valor mensal" };
  if (pontuacaoTotal >= 70) {
    const pct = Math.max(95, 100 - (90 - pontuacaoTotal) * 0.2);
    return { percentualRecebimento: pct, texto: "Redução 0,20% por ponto abaixo de 90 (até 95%)" };
  }
  if (pontuacaoTotal >= 50) {
    const pct = Math.max(90, 95 - (70 - pontuacaoTotal) * 0.25);
    return { percentualRecebimento: pct, texto: "Redução 0,25% por ponto abaixo de 70 (até 90%)" };
  }
  if (pontuacaoTotal >= 30) {
    const pct = Math.max(80, 90 - (50 - pontuacaoTotal) * 0.5);
    return { percentualRecebimento: pct, texto: "Redução 0,5% por ponto abaixo de 50 (até 80%)" };
  }
  return { percentualRecebimento: 70, texto: "70% do valor – possibilidade de abertura de processo de rescisão" };
}
