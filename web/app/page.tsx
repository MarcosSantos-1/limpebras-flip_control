"use client";

import { useState, useEffect, useCallback } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiService, type SAC, type CNC } from "@/lib/api";
import {
  format,
  startOfMonth,
  endOfMonth,
  addMonths,
  subMonths,
  eachDayOfInterval,
  startOfDay,
  endOfDay,
  isSameMonth,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { ADCRingChart } from "@/components/adc-ring-chart";
import { IndicatorTooltip } from "@/components/indicator-tooltip";
import { IPTModal } from "@/components/ipt-modal";
import Lottie from "lottie-react";
import loadingAnimation from "@/public/Loading.json";
import { SACsChart } from "@/components/sacs-chart";
import { SACsBySubChart, type SACsBySubDatum } from "@/components/sacs-by-sub-chart";
import { CNCsBySubChart, type CNCsBySubDatum } from "@/components/cncs-by-sub-chart";
import { SACsTopServicesChart, type SACsTopServiceDatum } from "@/components/sacs-top-services-chart";
import {
  TIPOS_DEMANDANTES,
  TIPOS_ESCALONADOS,
  STATUS_PROCEDENTES,
  SUBPREFEITURAS,
} from "@/constants/sacs";

const SUBPREF_LOOKUP = SUBPREFEITURAS.reduce<Record<string, string>>((acc, sub) => {
  acc[sub.code.toUpperCase()] = sub.code;
  acc[sub.label.replace(/[^A-Za-z]/g, "").toUpperCase()] = sub.code;
  return acc;
}, {});

const formatMonthLabel = (date: Date) => {
  const label = format(date, "MMMM yyyy", { locale: ptBR });
  return label.charAt(0).toUpperCase() + label.slice(1);
};

const normalizeSubprefeitura = (value?: string | null) => {
  if (!value) return null;
  return value.replace(/[^A-Za-z]/g, "").toUpperCase();
};

const normalizeDateForComparison = (date: Date) => {
  return new Date(date.getTime() + date.getTimezoneOffset() * 60_000);
};

export default function DashboardPage() {
  const [indicators, setIndicators] = useState<any>(null);
  const [sacsHistory, setSacsHistory] = useState<{ date: string; count: number }[]>([]);
  const [sacsBySub, setSacsBySub] = useState<SACsBySubDatum[]>([]);
  const [cncsBySub, setCncsBySub] = useState<CNCsBySubDatum[]>([]);
  const [sacsTopServices, setSacsTopServices] = useState<SACsTopServiceDatum[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [loading, setLoading] = useState(true);
  const [iptModalOpen, setIptModalOpen] = useState(false);

  const today = new Date();
  const disableNextMonth = isSameMonth(selectedMonth, startOfMonth(today));
  const monthLabel = formatMonthLabel(selectedMonth);
  const isCurrentMonth = disableNextMonth;

  const handlePrevMonth = () => {
    setSelectedMonth((prev) => subMonths(prev, 1));
  };

  const handleNextMonth = () => {
    if (disableNextMonth) return;
    setSelectedMonth((prev) => addMonths(prev, 1));
  };

  // Função auxiliar para agrupar dados por data
  const groupByDate = (
    items: any[],
    dateField: string,
    periodStart: Date,
    periodEnd: Date
  ): { date: string; count: number }[] => {
    const startBoundary = normalizeDateForComparison(startOfDay(periodStart));
    const endBoundary = normalizeDateForComparison(endOfDay(periodEnd));

    if (startBoundary > endBoundary) {
      return [];
    }

    const dates = eachDayOfInterval({ start: periodStart, end: periodEnd });
    const dateMap = new Map<string, number>();
    dates.forEach((date) => {
      const key = format(normalizeDateForComparison(startOfDay(date)), "yyyy-MM-dd");
      dateMap.set(key, 0);
    });

    items.forEach((item) => {
      try {
        const rawDate = item[dateField];
        if (!rawDate) return;
        const itemDate = normalizeDateForComparison(new Date(rawDate));
        if (isNaN(itemDate.getTime())) {
          return;
        }
        if (itemDate < startBoundary || itemDate > endBoundary) {
          return;
        }
        const dateKey = format(itemDate, "yyyy-MM-dd");
        if (dateMap.has(dateKey)) {
          dateMap.set(dateKey, (dateMap.get(dateKey) || 0) + 1);
        }
      } catch (e) {
        // Ignorar datas inválidas
      }
    });

    return Array.from(dateMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  };

  const computeSacsBySub = (items: SAC[]): SACsBySubDatum[] => {
    const baseMap = SUBPREFEITURAS.reduce<Record<string, SACsBySubDatum>>((acc, sub) => {
      acc[sub.code] = {
        subprefeitura: sub.code,
        label: sub.label,
        demandantes: 0,
        escalonados: 0,
      };
      return acc;
    }, {});

    items.forEach((sac) => {
      const bucket = baseMap[sac.subprefeitura as string];
      if (!bucket) return;

      if (!STATUS_PROCEDENTES.includes(sac.status)) {
        return;
      }

      if (TIPOS_DEMANDANTES.includes(sac.tipo_servico)) {
        bucket.demandantes += 1;
      } else if (TIPOS_ESCALONADOS.includes(sac.tipo_servico)) {
        bucket.escalonados += 1;
      }
    });

    return SUBPREFEITURAS.map((sub) => baseMap[sub.code]);
  };

  const computeCncsBySub = (items: CNC[], periodStart: Date, periodEnd: Date): CNCsBySubDatum[] => {
    const baseMap = SUBPREFEITURAS.reduce<Record<string, CNCsBySubDatum>>((acc, sub) => {
      acc[sub.code] = {
        subprefeitura: sub.code,
        label: sub.label,
        quantidade: 0,
      };
      return acc;
    }, {});

    const startBoundary = normalizeDateForComparison(startOfDay(periodStart));
    const endBoundary = normalizeDateForComparison(endOfDay(periodEnd));

    items.forEach((cnc) => {
      try {
        const abertura = normalizeDateForComparison(new Date(cnc.data_abertura));
        if (isNaN(abertura.getTime()) || abertura < startBoundary || abertura > endBoundary) {
          return;
        }
        const normalized = normalizeSubprefeitura(cnc.subprefeitura) || "";
        const code = SUBPREF_LOOKUP[normalized] || SUBPREF_LOOKUP[cnc.subprefeitura?.toUpperCase() || ""];
        if (!code || !baseMap[code]) {
          return;
        }
        baseMap[code].quantidade += 1;
      } catch {
        // Ignorar linhas inválidas
      }
    });

    return SUBPREFEITURAS.map((sub) => baseMap[sub.code]);
  };

  const computeTopServices = (items: SAC[]): SACsTopServiceDatum[] => {
    const counter = new Map<string, number>();
    items.forEach((sac) => {
      const key = (sac.tipo_servico || "").trim();
      if (!key) return;
      counter.set(key, (counter.get(key) || 0) + 1);
    });
    return Array.from(counter.entries()).map(([tipoServico, quantidade]) => ({ tipoServico, quantidade }));
  };

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const periodStart = startOfMonth(selectedMonth);
      const periodEnd = endOfMonth(selectedMonth);
      const dataInicio = format(periodStart, "yyyy-MM-dd");
      const dataFim = format(periodEnd, "yyyy-MM-dd");

      const [kpisData, sacsData, cncsData] = await Promise.all([
        apiService.getKPIs(dataInicio, dataFim).catch(() => null),
        apiService
          .getSACs({
            periodo_inicial: dataInicio,
            periodo_final: dataFim,
            full: true,
            limit: 10000,
          })
          .catch(() => ({ items: [] })),
        apiService
          .getCNCs({
            page: 1,
            page_size: 1000,
          })
          .catch(() => ({ items: [] })),
        ]);

        if (kpisData) {
          const irdPontos = Math.min(kpisData.indicadores?.ird?.pontuacao || 0, 20);
          const iaPontos = Math.min(kpisData.indicadores?.ia?.pontuacao || 0, 20);
          const ifPontos = Math.min(kpisData.indicadores?.if?.pontuacao || 0, 20);
          const iptPontos = kpisData.indicadores?.ipt?.pontuacao || 0;
          const iptValor = kpisData.indicadores?.ipt?.valor || null;
          
          const totalADC = irdPontos + iaPontos + ifPontos + iptPontos;
          const percentualADC = (totalADC / 100) * 100;

          setIndicators({
            data: {
              IRD: {
                valor: kpisData.indicadores?.ird?.valor || 0,
                pontuacao: irdPontos,
              },
              IA: {
                valor: kpisData.indicadores?.ia?.valor || 0,
                pontuacao: iaPontos,
              },
              IF: {
                valor: kpisData.indicadores?.if?.valor || 0,
                pontuacao: ifPontos,
              },
              IPT: {
                valor: iptValor !== null ? iptValor : undefined,
                pontuacao: iptPontos > 0 ? iptPontos : undefined,
              },
              ADC: {
                total: totalADC,
                percentual: percentualADC,
              },
            },
            sacs_hoje: kpisData.sacs_hoje || 0,
            cncs_urgentes: kpisData.cncs_urgentes || 0,
          });
        }

      const sacItems = (sacsData?.items || []) as SAC[];
      setSacsHistory(groupByDate(sacItems, "data_criacao", periodStart, periodEnd));
      setSacsBySub(computeSacsBySub(sacItems));
      setSacsTopServices(computeTopServices(sacItems));

      const cncItems = (cncsData?.items || []) as CNC[];
      setCncsBySub(computeCncsBySub(cncItems, periodStart, periodEnd));
      } catch (error) {
        console.error("Error fetching dashboard data:", error);
      } finally {
        setLoading(false);
      }
  }, [selectedMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <MainLayout>
      <div className="space-y-8">
        {loading && (
          <div className="fixed inset-0 z-90 bg-background/90 backdrop-blur-sm flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card/90 px-8 py-6 shadow-xl">
              <div className="h-48 w-48">
                <Lottie animationData={loadingAnimation} loop autoplay />
              </div>
              <p className="text-sm font-semibold text-muted-foreground">Carregando dashboard...</p>
            </div>
          </div>
        )}

        <div className="relative overflow-hidden rounded-xl bg-linear-to-r from-cyan-600/10 via-zinc-600/5 to-transparent p-8 border border-cyan-200/50 dark:border-cyan-800/50">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-cyan-600/10 rounded-full blur-3xl"></div>
          <div className="relative">
            <h1 className="text-4xl font-bold tracking-tight bg-linear-to-r from-primary to-indigo-600 bg-clip-text text-transparent pb-2">Dashboard</h1>
            <p className="text-muted-foreground mt-2 text-lg max-w-2xl">
              Visão geral dos indicadores de desempenho.
            </p>
          </div>
        </div>

        {/* KPIs - Grid 2x2 + ADC à direita */}
        {loading ? (
          <div className="text-center py-8">Carregando KPIs...</div>
        ) : indicators ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Grid 2x2 dos indicadores */}
            <div className="grid grid-cols-2 gap-3 md:col-span-2">
              <Card className="p-4 hover:scale-[1.02] transition-all duration-200 cursor-default border-l-4 border-l-blue-500">
                <CardHeader className="p-0 pb-4">
                  <IndicatorTooltip 
                    tipo="IA" 
                    valor={indicators.data?.IA?.valor}
                    pontuacao={indicators.data?.IA?.pontuacao}
                  >
                    <CardTitle className="text-sm font-medium text-blue-600 dark:text-blue-400">IA</CardTitle>
                  </IndicatorTooltip>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="text-lg font-semibold text-muted-foreground mb-1">
                    {indicators.data?.IA?.pontuacao || 0} Pontos
                  </div>
                  <div className="text-3xl font-bold bg-linear-to-r from-blue-600 to-blue-400 bg-clip-text text-transparent">
                    {indicators.data?.IA?.valor?.toFixed(1) || "0"}%
                  </div>
                </CardContent>
              </Card>

              <Card className="p-4 hover:scale-[1.02] transition-all duration-200 cursor-default border-l-4 border-l-emerald-500">
                <CardHeader className="p-0 pb-4">
                  <IndicatorTooltip 
                    tipo="IRD" 
                    valor={indicators.data?.IRD?.valor}
                    pontuacao={indicators.data?.IRD?.pontuacao}
                  >
                    <CardTitle className="text-sm font-medium text-emerald-600 dark:text-emerald-400">IRD</CardTitle>
                  </IndicatorTooltip>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="text-lg font-semibold text-muted-foreground mb-1">
                    {indicators.data?.IRD?.pontuacao || 0} Pontos
                  </div>
                  <div className="text-3xl font-bold bg-linear-to-r from-emerald-600 to-emerald-400 bg-clip-text text-transparent">
                    {indicators.data?.IRD?.valor?.toFixed(2) || "0"}
                  </div>
                </CardContent>
              </Card>

              <Card className="p-4 hover:scale-[1.02] transition-all duration-200 cursor-default border-l-4 border-l-amber-500">
                <CardHeader className="p-0 pb-4">
                  <IndicatorTooltip 
                    tipo="IF" 
                    valor={indicators.data?.IF?.valor}
                    pontuacao={indicators.data?.IF?.pontuacao}
                  >
                    <CardTitle className="text-sm font-medium text-amber-600 dark:text-amber-400">IF</CardTitle>
                  </IndicatorTooltip>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="text-lg font-semibold text-muted-foreground mb-1">
                    {indicators.data?.IF?.pontuacao || 0} Pontos
                  </div>
                  <div className="text-3xl font-bold bg-linear-to-r from-amber-600 to-amber-400 bg-clip-text text-transparent">
                    {indicators.data?.IF?.valor?.toFixed(1) || "0"}%
                  </div>
                </CardContent>
              </Card>

              <Card 
                className="p-4 cursor-pointer hover:scale-[1.02] transition-all duration-200 border-l-4 border-l-purple-500"
                onClick={() => setIptModalOpen(true)}
              >
                <CardHeader className="p-0 pb-4">
                  <IndicatorTooltip 
                    tipo="IPT" 
                    valor={indicators.data?.IPT?.valor || 87.5}
                    pontuacao={indicators.data?.IPT?.pontuacao || 35}
                  >
                    <CardTitle className="text-sm font-medium text-purple-600 dark:text-purple-400">IPT</CardTitle>
                  </IndicatorTooltip>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="text-lg font-semibold text-muted-foreground mb-1">
                    {indicators.data?.IPT?.pontuacao ?? 0} Pontos
                    {!indicators.data?.IPT?.valor && (
                      <span className="text-xs text-muted-foreground/70"> (Clique para atualizar)</span>
                    )}
                  </div>
                  <div className="text-3xl font-bold bg-linear-to-r from-purple-600 to-purple-400 bg-clip-text text-transparent">
                    {indicators.data?.IPT?.valor?.toFixed(1) ?? "--"}%
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* ADC à direita - ring estilizado com design neon */}
            <div className="flex items-center justify-center">
              <ADCRingChart 
                total={indicators.data?.ADC?.total || 0}
                percentual={indicators.data?.ADC?.percentual || 0}
              />
            </div>
          </div>
        ) : (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <p className="text-yellow-800 dark:text-yellow-200">
              Não foi possível carregar os KPIs. Verifique se o backend está rodando.
            </p>
          </div>
        )}

        {/* Gráficos operacionais */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SACsChart
            data={sacsHistory}
            monthLabel={monthLabel}
            onPrevMonth={handlePrevMonth}
            onNextMonth={handleNextMonth}
            disableNextMonth={disableNextMonth}
            todayCount={isCurrentMonth ? indicators?.sacs_hoje : undefined}
          />
          <SACsBySubChart
            data={sacsBySub}
            monthLabel={monthLabel}
            onPrevMonth={handlePrevMonth}
            onNextMonth={handleNextMonth}
            disableNextMonth={disableNextMonth}
          />
              </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-1">
            <CNCsBySubChart
              data={cncsBySub}
              monthLabel={monthLabel}
              onPrevMonth={handlePrevMonth}
              onNextMonth={handleNextMonth}
              disableNextMonth={disableNextMonth}
            />
          </div>
          <div className="md:col-span-2">
            <SACsTopServicesChart
              data={sacsTopServices}
              monthLabel={monthLabel}
              onPrevMonth={handlePrevMonth}
              onNextMonth={handleNextMonth}
              disableNextMonth={disableNextMonth}
            />
          </div>
        </div>

        <IPTModal
          open={iptModalOpen}
          onOpenChange={setIptModalOpen}
          onSuccess={() => {
            // Recarregar dados após salvar IPT
            setLoading(true);
            loadData();
          }}
          currentValue={indicators?.data?.IPT?.valor}
          currentPontuacao={indicators?.data?.IPT?.pontuacao}
        />
      </div>
    </MainLayout>
  );
}
