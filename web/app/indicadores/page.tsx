"use client";

import { useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiService } from "@/lib/api";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { Input } from "@/components/ui/input";

export default function IndicadoresPage() {
  const [calculando, setCalculando] = useState(false);
  const [resultado, setResultado] = useState<any>(null);
  const [periodoInicial, setPeriodoInicial] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [periodoFinal, setPeriodoFinal] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));

  const calcularADC = async () => {
    try {
      setCalculando(true);
      setResultado(null);
      console.log("Calculando ADC para período:", periodoInicial, "->", periodoFinal);
      const data = await apiService.calcularADC(periodoInicial, periodoFinal);
      console.log("Resultado ADC:", data);
      console.log("IPT no resultado:", data?.ipt);
      setResultado(data);
    } catch (error: any) {
      console.error("Erro ao calcular ADC:", error);
      setResultado({ error: error.message });
    } finally {
      setCalculando(false);
    }
  };

  return (
    <MainLayout>
      <div className="space-y-8">
        <div className="relative overflow-hidden rounded-xl bg-linear-to-r from-emerald-600/10 via-emerald-600/5 to-transparent p-8 border border-emerald-200/50 dark:border-emerald-800/50">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-emerald-600/10 rounded-full blur-3xl"></div>
          <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h1 className="text-4xl font-bold tracking-tight bg-linear-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent pb-2">Indicadores</h1>
              <p className="text-muted-foreground mt-2 text-lg max-w-2xl">
                Cálculo e visualização dos indicadores ADC (Avaliação de Desempenho da Contratada).
              </p>
            </div>
            <a
              href="/indicadores/explicacao"
              className="px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 text-sm font-medium flex items-center gap-2 whitespace-nowrap"
            >
              <span>📊</span>
              Ver Explicação Detalhada
            </a>
          </div>
        </div>

        <Card className="hover:shadow-md transition-shadow duration-200 border-l-4 border-l-emerald-500">
          <CardHeader>
            <CardTitle>Calcular ADC</CardTitle>
            <CardDescription>
              Calcule o ADC completo para um período específico
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-4 items-end">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Período Inicial</label>
                <Input
                  type="date"
                  value={periodoInicial}
                  onChange={(e) => setPeriodoInicial(e.target.value)}
                  className="bg-background"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Período Final</label>
                <Input
                  type="date"
                  value={periodoFinal}
                  onChange={(e) => setPeriodoFinal(e.target.value)}
                  className="bg-background"
                />
              </div>
              <div>
                <button
                  onClick={calcularADC}
                  disabled={calculando}
                  className="w-full px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-medium shadow-sm hover:shadow active:scale-[0.98]"
                >
                  {calculando ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Calculando...
                    </span>
                  ) : "Calcular ADC"}
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {resultado && (
          <Card className="animate-in fade-in slide-in-from-bottom-4 duration-500 border-none shadow-lg bg-background/50 backdrop-blur-sm">
            <CardContent className="p-6">
              {resultado.error ? (
              <div className="p-4 bg-red-50/50 dark:bg-red-900/10 border border-red-200/50 dark:border-red-800/30 rounded-lg flex items-center gap-3 text-red-600 dark:text-red-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-alert-triangle"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                <span className="font-medium">{resultado.error}</span>
              </div>
            ) : (
              <div className="space-y-8">
                <div className="flex items-center gap-3 pb-4 border-b border-border">
                  <h3 className="text-xl font-bold text-foreground">Resultado do ADC</h3>
                  <span className="px-3 py-1 rounded-full bg-emerald-100/50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold border border-emerald-200 dark:border-emerald-800/50">
                    FINALIZADO
                  </span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                  <div className="bg-card p-5 rounded-xl border border-border hover:border-emerald-500/30 transition-colors shadow-sm group">
                    <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2">IRD</div>
                    <div className="text-3xl font-bold text-foreground group-hover:scale-105 transition-transform origin-left">{resultado.ird?.valor?.toFixed(3)}</div>
                    <div className="text-sm text-muted-foreground mt-1 font-medium">{resultado.ird?.pontuacao} pontos</div>
                  </div>
                  
                  <div className="bg-card p-5 rounded-xl border border-border hover:border-blue-500/30 transition-colors shadow-sm group">
                    <div className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-2">IA</div>
                    <div className="text-3xl font-bold text-foreground group-hover:scale-105 transition-transform origin-left">{resultado.ia?.valor?.toFixed(1)}%</div>
                    <div className="text-sm text-muted-foreground mt-1 font-medium">{resultado.ia?.pontuacao} pontos</div>
                  </div>
                  
                  <div className="bg-card p-5 rounded-xl border border-border hover:border-amber-500/30 transition-colors shadow-sm group">
                    <div className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-2">IF</div>
                    <div className="text-3xl font-bold text-foreground group-hover:scale-105 transition-transform origin-left">{resultado.if?.valor?.toFixed(1)}%</div>
                    <div className="text-sm text-muted-foreground mt-1 font-medium">{resultado.if?.pontuacao} pontos</div>
                  </div>
                  
                  <div className={`bg-card p-5 rounded-xl border transition-colors shadow-sm group ${!resultado.ipt ? 'border-yellow-500/50 bg-yellow-50/10' : 'border-border hover:border-purple-500/30'}`}>
                    <div className="text-xs font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider mb-2">IPT</div>
                    <div className="text-3xl font-bold text-foreground group-hover:scale-105 transition-transform origin-left">
                      {resultado.ipt?.valor?.toFixed(1) ?? '--'}%
                    </div>
                    <div className="text-sm text-muted-foreground mt-1 font-medium">
                      {resultado.ipt?.pontuacao ?? resultado.ipt_pontuacao ?? 0} pontos
                      {!resultado.ipt && <span className="text-xs text-yellow-600 dark:text-yellow-400 ml-1 font-bold">(não informado)</span>}
                    </div>
                  </div>
                  
                  <div className="bg-linear-to-br from-emerald-500/10 to-teal-500/10 p-5 rounded-xl border-2 border-emerald-500/20 hover:border-emerald-500/40 transition-colors shadow-sm relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-500/10 rounded-bl-full -mr-8 -mt-8"></div>
                    <div className="text-xs font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider mb-2">ADC Total</div>
                    <div className="text-4xl font-bold text-emerald-700 dark:text-emerald-300 group-hover:scale-105 transition-transform origin-left">{resultado.pontuacao_total?.toFixed(1)}</div>
                    <div className="text-sm text-emerald-600/80 dark:text-emerald-400/80 mt-1 font-medium">
                      {resultado.percentual_contrato?.toFixed(1)}% do contrato
                    </div>
                  </div>
                </div>
                
                <div className="grid gap-4">
                  {resultado.desconto > 0 && (
                    <div className="p-4 bg-yellow-50/50 dark:bg-yellow-900/10 border border-yellow-200/50 dark:border-yellow-800/30 rounded-lg flex items-start gap-3">
                      <span className="text-2xl">⚠️</span>
                      <div>
                        <p className="text-yellow-800 dark:text-yellow-200 font-bold mb-1">
                          Desconto aplicado: {resultado.desconto.toFixed(2)}%
                        </p>
                        <p className="text-sm text-yellow-700 dark:text-yellow-300">
                          Percentual do valor contratual a receber: <strong>{resultado.percentual_contrato?.toFixed(2)}%</strong>
                        </p>
                      </div>
                    </div>
                  )}
                  
                  {resultado.desconto === 0 && resultado.pontuacao_total >= 90 && (
                    <div className="p-4 bg-green-50/50 dark:bg-green-900/10 border border-green-200/50 dark:border-green-800/30 rounded-lg flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-xl">🏆</div>
                      <div>
                        <p className="text-green-800 dark:text-green-200 font-bold">
                          Excelente Desempenho!
                        </p>
                        <p className="text-sm text-green-700 dark:text-green-300">
                          Sem desconto - 100% do valor mensal previsto será pago.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}
