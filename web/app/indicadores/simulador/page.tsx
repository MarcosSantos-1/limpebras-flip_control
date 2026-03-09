"use client";

import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Calculator, Info } from "lucide-react";
import Link from "next/link";
import { VALOR_MENSAL_CONTRATO, descontoADC } from "@/lib/adc-utils";

const DOMICILIOS_TOTAL = 511_093;
const DOMICILIOS_POR_SUB: Record<string, number> = {
  CV: 130_030,
  JT: 112_924,
  MG: 120_170,
  ST: 147_924,
};
const SUBS = ["CV", "JT", "MG", "ST"] as const;

function pontuacaoIRD(valor: number): number {
  if (valor <= 1) return 20;
  if (valor <= 2) return 15;
  if (valor <= 5) return 10;
  if (valor <= 10) return 5;
  return 0;
}

function pontuacaoIA(percentual: number): number {
  if (percentual >= 90) return 20;
  if (percentual >= 80) return 16;
  if (percentual >= 70) return 12;
  if (percentual >= 60) return 8;
  if (percentual >= 50) return 4;
  return 0;
}

function pontuacaoIF(percentual: number): number {
  const valor = percentual * 10; // 0-100 -> 0-1000
  if (valor >= 900) return 20;
  if (valor >= 800) return 18;
  if (valor >= 700) return 16;
  if (valor >= 600) return 14;
  if (valor >= 500) return 12;
  if (valor >= 400) return 10;
  if (valor >= 300) return 8;
  if (valor >= 200) return 6;
  if (valor >= 100) return 4;
  return 0;
}

function pontuacaoIPT(pfPercentual: number): number {
  if (pfPercentual >= 90) return 40;
  if (pfPercentual >= 80) return 38;
  if (pfPercentual >= 70) return 36;
  if (pfPercentual >= 60) return 32;
  if (pfPercentual >= 50) return 28;
  if (pfPercentual >= 40) return 24;
  if (pfPercentual >= 30) return 20;
  if (pfPercentual >= 20) return 16;
  if (pfPercentual >= 10) return 12;
  return 0;
}

export default function SimuladorADCPage() {
  // IRD
  const [irdPorSub, setIrdPorSub] = useState<Record<string, string>>({
    CV: "0",
    JT: "0",
    MG: "0",
    ST: "0",
  });

  // IA
  const [iaNoPrazo, setIaNoPrazo] = useState("0");
  const [iaForaPrazo, setIaForaPrazo] = useState("0");

  // IF
  const [ifPorSub, setIfPorSub] = useState<Record<string, { sem: string; total: string }>>({
    CV: { sem: "0", total: "0" },
    JT: { sem: "0", total: "0" },
    MG: { sem: "0", total: "0" },
    ST: { sem: "0", total: "0" },
  });

  // IPT (algoritmo SELIMP)
  const [iptP, setIptP] = useState("905");
  const [iptR, setIptR] = useState("1");
  const [iptF, setIptF] = useState("1");
  const [iptA, setIptA] = useState("905");
  const [iptZ, setIptZ] = useState("263");
  const [iptQb, setIptQb] = useState("87.79");
  const [iptSigma, setIptSigma] = useState("24.09");

  const irdResult = useMemo(() => {
    const total = SUBS.reduce((s, sub) => s + (Number(irdPorSub[sub]) || 0), 0);
    const valor = DOMICILIOS_TOTAL > 0 ? (total / DOMICILIOS_TOTAL) * 1000 : 0;
    return { total, valor, pontuacao: pontuacaoIRD(valor) };
  }, [irdPorSub]);

  const iaResult = useMemo(() => {
    const no = Number(iaNoPrazo) || 0;
    const fora = Number(iaForaPrazo) || 0;
    const total = no + fora;
    const percentual = total > 0 ? (no / total) * 100 : 0;
    return { no, fora, total, percentual, pontuacao: pontuacaoIA(percentual) };
  }, [iaNoPrazo, iaForaPrazo]);

  const ifResult = useMemo(() => {
    const pcts: number[] = [];
    for (const sub of SUBS) {
      const d = ifPorSub[sub];
      const sem = Number(d?.sem) || 0;
      const total = Number(d?.total) || 0;
      pcts.push(total > 0 ? (sem / total) * 100 : 0);
    }
    const media = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0;
    return { pcts, media, pontuacao: pontuacaoIF(media) };
  }, [ifPorSub]);

  const iptResult = useMemo(() => {
    const P = Number(iptP) || 0;
    const R = Number(iptR) || 1;
    const F = Number(iptF) || 1;
    const A = Number(iptA) || 0;
    const Z = Number(iptZ) || 0;
    const N = A - Z;
    const Qb = (Number(iptQb) || 0) / 100;
    const sigma = (Number(iptSigma) || 0) / 100;

    if (A <= 0) return null;

    const C = P > 0 && R > 0 && F > 0 ? P * (R / F) : A;
    const cobertura = C > 0 ? Math.min(A / C, 1) : 1;
    const qualidadeAjustada = Math.min(Qb + Math.min(sigma, 0.08), 1);
    const PF = 0.7 * qualidadeAjustada + 0.3 * cobertura;
    const pfPercentual = Math.min(100, Math.max(0, PF * 100));
    return {
      P, R, F, A, Z, N, C, cobertura, qualidadeAjustada,
      pfPercentual,
      pontuacao: pontuacaoIPT(pfPercentual),
    };
  }, [iptP, iptR, iptF, iptA, iptZ, iptQb, iptSigma]);

  const adcTotal = useMemo(() => {
    const ird = irdResult.pontuacao;
    const ia = iaResult.pontuacao;
    const iff = ifResult.pontuacao;
    const ipt = iptResult?.pontuacao ?? 0;
    return ird + ia + iff + ipt;
  }, [irdResult.pontuacao, iaResult.pontuacao, ifResult.pontuacao, iptResult?.pontuacao]);

  const descontoInfo = useMemo(() => descontoADC(adcTotal), [adcTotal]);
  const glosaSimulada = useMemo(
    () => (VALOR_MENSAL_CONTRATO * (100 - descontoInfo.percentual)) / 100,
    [descontoInfo.percentual]
  );

  return (
    <MainLayout>
      <div className="space-y-8">
        <div className="relative overflow-hidden rounded-2xl bg-linear-to-r from-red-600/10 via-rose-500/10 to-rose-200/20 dark:from-red-900/20 dark:via-rose-900/10 dark:to-rose-800/5 p-8 shadow-sm">
          <div className="absolute top-0 right-0 -mt-8 -mr-8 w-48 h-48 bg-rose-400/20 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-red-500/10 rounded-full blur-2xl" />
          <div className="relative">
            <h1 className="text-4xl font-bold tracking-tight bg-linear-to-r from-red-600 to-rose-300 bg-clip-text text-transparent pb-2">
              Simulador ADC
            </h1>
            <p className="text-muted-foreground mt-2 text-lg max-w-2xl">
              Simule o ADC completo ajustando IRD, IA, IF e IPT. Use para validar resultados ou estimar o valor aproximado.
            </p>
            <Link
              href="/indicadores"
              className="inline-flex items-center gap-2 mt-4 text-sm text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 transition-colors font-medium"
            >
              ← Voltar aos Indicadores
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* IRD */}
          <Card className="border-0 shadow-md bg-emerald-50/60 dark:bg-emerald-950/30">
            <CardHeader>
              <CardTitle className="text-lg text-emerald-800 dark:text-emerald-200">IRD – Reclamações Procedentes</CardTitle>
              <CardDescription>IRD = (reclamações procedentes / domicílios) × 1000. Por subprefeitura.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {SUBS.map((sub) => (
                  <div key={sub} className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">{sub} (domicílios: {DOMICILIOS_POR_SUB[sub]?.toLocaleString("pt-BR")})</label>
                    <Input
                      type="number"
                      min={0}
                      value={irdPorSub[sub]}
                      onChange={(e) => setIrdPorSub((prev) => ({ ...prev, [sub]: e.target.value }))}
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
              <div className="pt-3 mt-3 bg-emerald-100/30 dark:bg-emerald-900/20 rounded-lg px-3 py-2">
                <div className="flex justify-between text-sm">
                  <span>Valor IRD:</span>
                  <strong className="font-mono">{irdResult.valor.toFixed(3)}</strong>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span>Pontuação:</span>
                  <strong className="text-emerald-600 dark:text-emerald-400">{irdResult.pontuacao} pts</strong>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* IA */}
          <Card className="border-0 shadow-md bg-blue-50/60 dark:bg-blue-950/30">
            <CardHeader>
              <CardTitle className="text-lg text-blue-800 dark:text-blue-200">IA – Indicador de Atendimento</CardTitle>
              <CardDescription>IA = (no prazo / total) × 100. Responsividade_Execução = SIM (no prazo) ou NÃO (fora).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">No prazo (SIM)</label>
                  <Input type="number" min={0} value={iaNoPrazo} onChange={(e) => setIaNoPrazo(e.target.value)} placeholder="0" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Fora do prazo (NÃO)</label>
                  <Input type="number" min={0} value={iaForaPrazo} onChange={(e) => setIaForaPrazo(e.target.value)} placeholder="0" />
                </div>
              </div>
              <div className="pt-3 mt-3 bg-blue-100/30 dark:bg-blue-900/20 rounded-lg px-3 py-2">
                <div className="flex justify-between text-sm">
                  <span>Percentual:</span>
                  <strong className="font-mono">{iaResult.percentual.toFixed(1)}%</strong>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span>Pontuação:</span>
                  <strong className="text-blue-600 dark:text-blue-400">{iaResult.pontuacao} pts</strong>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* IF */}
          <Card className="border-0 shadow-md bg-amber-50/60 dark:bg-amber-950/30">
            <CardHeader>
              <CardTitle className="text-lg text-amber-800 dark:text-amber-200">IF – Indicador de Fiscalização</CardTitle>
              <CardDescription>IF = média dos 4 subs. Cada sub: (sem irregularidades / total) × 100.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {SUBS.map((sub) => (
                <div key={sub} className="grid grid-cols-3 gap-2 items-end">
                  <span className="text-sm font-medium text-muted-foreground">{sub}</span>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Sem irregularidade</label>
                    <Input
                      type="number"
                      min={0}
                      value={ifPorSub[sub]?.sem ?? "0"}
                      onChange={(e) =>
                        setIfPorSub((prev) => ({
                          ...prev,
                          [sub]: { ...(prev[sub] ?? { sem: "0", total: "0" }), sem: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Total</label>
                    <Input
                      type="number"
                      min={0}
                      value={ifPorSub[sub]?.total ?? "0"}
                      onChange={(e) =>
                        setIfPorSub((prev) => ({
                          ...prev,
                          [sub]: { ...(prev[sub] ?? { sem: "0", total: "0" }), total: e.target.value },
                        }))
                      }
                    />
                  </div>
                </div>
              ))}
              <div className="pt-3 mt-3 bg-amber-100/30 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                <div className="flex justify-between text-sm">
                  <span>Média IF:</span>
                  <strong className="font-mono">{ifResult.media.toFixed(1)}%</strong>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span>Pontuação:</span>
                  <strong className="text-amber-600 dark:text-amber-400">{ifResult.pontuacao} pts</strong>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* IPT */}
          <Card className="border-0 shadow-md bg-violet-50/60 dark:bg-violet-950/30">
            <CardHeader>
              <CardTitle className="text-lg text-violet-800 dark:text-violet-200">IPT – Algoritmo SELIMP</CardTitle>
              <CardDescription>
                PF = 0.7 × min(Q̄ + min(σ, 0.08), 1) + 0.3 × min(A/C, 1). Ajuste P, R, F quando tiver os dados.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">P (ordens planejadas)</label>
                  <Input type="number" min={0} value={iptP} onChange={(e) => setIptP(e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">R (rastreadores)</label>
                  <Input type="number" min={0} value={iptR} onChange={(e) => setIptR(e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">F (frota total)</label>
                  <Input type="number" min={0} value={iptF} onChange={(e) => setIptF(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">A (ordens atribuídas)</label>
                  <Input type="number" min={0} value={iptA} onChange={(e) => setIptA(e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Z (ordens zeradas)</label>
                  <Input type="number" min={0} value={iptZ} onChange={(e) => setIptZ(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Q̄ qualidade bruta (%)</label>
                  <Input type="number" min={0} max={100} step={0.01} value={iptQb} onChange={(e) => setIptQb(e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">σ desvio padrão (%)</label>
                  <Input type="number" min={0} max={100} step={0.01} value={iptSigma} onChange={(e) => setIptSigma(e.target.value)} />
                </div>
              </div>
              {iptResult && (
                <div className="pt-3 mt-3 bg-violet-100/30 dark:bg-violet-900/20 rounded-lg px-3 py-2 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>C (capacidade):</span>
                    <span className="font-mono">{iptResult.C.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Cobertura:</span>
                    <span className="font-mono">{(iptResult.cobertura * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Qual. ajustada:</span>
                    <span className="font-mono">{(iptResult.qualidadeAjustada * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold">
                    <span>PF (IPT):</span>
                    <span className="font-mono text-violet-600 dark:text-violet-400">{iptResult.pfPercentual.toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Pontuação IPT:</span>
                    <strong className="text-violet-600 dark:text-violet-400">{iptResult.pontuacao} pts</strong>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Resumo ADC */}
        <Card className="border-0 shadow-lg bg-linear-to-br from-red-50/80 via-rose-50/60 to-rose-100/40 dark:from-red-950/30 dark:via-rose-950/20 dark:to-rose-900/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-rose-800 dark:text-rose-200">
              <Calculator className="h-5 w-5 text-rose-500" />
              Resultado ADC Total
            </CardTitle>
            <CardDescription>IRD + IA + IF + IPT (máx 100 pts)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="p-4 rounded-xl bg-emerald-100/50 dark:bg-emerald-900/20">
                <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">IRD</div>
                <div className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{irdResult.pontuacao} pts</div>
              </div>
              <div className="p-4 rounded-xl bg-blue-100/50 dark:bg-blue-900/20">
                <div className="text-xs text-blue-600 dark:text-blue-400 font-medium">IA</div>
                <div className="text-xl font-bold text-blue-700 dark:text-blue-300">{iaResult.pontuacao} pts</div>
              </div>
              <div className="p-4 rounded-xl bg-amber-100/50 dark:bg-amber-900/20">
                <div className="text-xs text-amber-600 dark:text-amber-400 font-medium">IF</div>
                <div className="text-xl font-bold text-amber-700 dark:text-amber-300">{ifResult.pontuacao} pts</div>
              </div>
              <div className="p-4 rounded-xl bg-violet-100/50 dark:bg-violet-900/20">
                <div className="text-xs text-violet-600 dark:text-violet-400 font-medium">IPT</div>
                <div className="text-xl font-bold text-violet-700 dark:text-violet-300">{iptResult?.pontuacao ?? 0} pts</div>
              </div>
              <div className="p-4 rounded-xl bg-rose-100/70 dark:bg-rose-900/30 shadow-sm">
                <div className="text-xs text-rose-600 dark:text-rose-400 font-semibold">ADC Total</div>
                <div className="text-2xl font-bold text-rose-700 dark:text-rose-300">{adcTotal.toFixed(1)} pts</div>
              </div>
            </div>
            <div className="p-4 rounded-xl bg-white/50 dark:bg-white/5 flex items-start gap-3">
              <Info className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-foreground">{descontoInfo.percentual.toFixed(1)}% do valor mensal</p>
                <p className="text-sm text-muted-foreground">{descontoInfo.texto}</p>
              </div>
            </div>
            <div className="p-4 rounded-xl bg-rose-100/50 dark:bg-rose-900/20">
              <div className="text-xs text-rose-600 dark:text-rose-400 font-semibold uppercase tracking-wider mb-1">Glosa simulada (R$)</div>
              <div className="text-2xl font-bold text-rose-700 dark:text-rose-300">
                {glosaSimulada.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Base: valor mensal do contrato × desconto aplicado</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
