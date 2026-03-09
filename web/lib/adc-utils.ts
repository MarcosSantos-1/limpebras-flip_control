/** Valor mensal do contrato (R$) - base para cálculo da glosa. Fonte: GLOSA.xlsx */
export const VALOR_MENSAL_CONTRATO = 14_573_274.23;

export function descontoADC(total: number): { percentual: number; texto: string } {
  if (total >= 90) return { percentual: 100, texto: "100% do valor mensal" };
  if (total >= 70) {
    const pct = Math.max(95, 100 - (90 - total) * 0.2);
    return { percentual: pct, texto: "Redução 0,20% por ponto abaixo de 90 (até 95%)" };
  }
  if (total >= 50) {
    const pct = Math.max(90, 95 - (70 - total) * 0.25);
    return { percentual: pct, texto: "Redução 0,25% por ponto abaixo de 70 (até 90%)" };
  }
  if (total >= 30) {
    const pct = Math.max(80, 90 - (50 - total) * 0.5);
    return { percentual: pct, texto: "Redução 0,5% por ponto abaixo de 50 (até 80%)" };
  }
  return { percentual: 70, texto: "70% do valor – possibilidade de abertura de processo de rescisão" };
}

export function glosaSimuladaFromTotal(adcTotal: number): number {
  const info = descontoADC(adcTotal);
  return (VALOR_MENSAL_CONTRATO * (100 - info.percentual)) / 100;
}
