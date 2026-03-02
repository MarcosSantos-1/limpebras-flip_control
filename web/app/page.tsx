"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { CNCsTopServicesChart, type CNCsTopServiceDatum } from "@/components/cncs-top-services-chart";
import { SACsOverdueBySubChart, type SACOverdueBySubDatum } from "@/components/sacs-overdue-by-sub-chart";
import { SUBPREFEITURAS } from "@/constants/sacs";

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

interface SACLocationRankingDatum {
  nome: string;
  quantidade: number;
  tipoMaisFrequente?: string;
  tipos: { tipoServico: string; quantidade: number }[];
}

const sanitizeAddressPart = (value?: string | null) => {
  return (value || "")
    .replace(/\s+/g, " ")
    .replace(/[;|]+/g, " ")
    .trim();
};

const LOGRADOURO_PREFIX_REGEX =
  /^(RUA|R\.|AVENIDA|AV\.|ALAMEDA|TRAVESSA|TV\.?|ESTRADA|RODOVIA|PRAÇA|PRACA|LARGO|VIELA|PASSAGEM)\b/i;

const isLikelyLogradouro = (part: string) => LOGRADOURO_PREFIX_REGEX.test(part.trim());

const extractLogradouro = (address?: string | null) => {
  const raw = sanitizeAddressPart(address);
  if (!raw) return null;
  const firstChunk = raw.split("-")[0]?.split(",")[0]?.trim() || "";
  if (!firstChunk) return null;
  return firstChunk.replace(/\s+\d+.*$/, "").trim() || null;
};

const extractBairro = (address?: string | null) => {
  const raw = sanitizeAddressPart(address);
  if (!raw) return null;

  const chunks = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const normalizeChunk = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();

  const isInvalidBairroChunk = (value: string) => {
    const normalized = normalizeChunk(value);
    if (!normalized) return true;
    if (/\bCEP\b/i.test(normalized) || /\d{5}-?\d{3}/.test(value)) return true;
    if (normalized === "BRASIL" || normalized === "BRAZIL") return true;
    if (normalized === "SAO PAULO") return true;
    if (/^[A-Z]{2}$/.test(normalized)) return true;
    if (isLikelyLogradouro(value)) return true;
    return false;
  };

  // Endereço padrão: rua, numero, bairro, cep, cidade, estado, país.
  const thirdChunk = chunks[2];
  if (thirdChunk && !isInvalidBairroChunk(thirdChunk)) {
    return thirdChunk.replace(/^BAIRRO[:\s-]*/i, "").trim();
  }

  for (let idx = chunks.length - 1; idx >= 0; idx -= 1) {
    const part = chunks[idx];
    if (!part || isInvalidBairroChunk(part)) continue;
    return part.replace(/^BAIRRO[:\s-]*/i, "").trim();
  }

  return null;
};

export default function DashboardPage() {
  const [indicators, setIndicators] = useState<any>(null);
  const [sacsHistory, setSacsHistory] = useState<{ date: string; count: number }[]>([]);
  const [sacsBySub, setSacsBySub] = useState<SACsBySubDatum[]>([]);
  const [sacsOverdueBySub, setSacsOverdueBySub] = useState<SACOverdueBySubDatum[]>([]);
  const [cncsBySub, setCncsBySub] = useState<CNCsBySubDatum[]>([]);
  const [sacsTopServices, setSacsTopServices] = useState<SACsTopServiceDatum[]>([]);
  const [cncsTopServices, setCncsTopServices] = useState<CNCsTopServiceDatum[]>([]);
  const [topBairrosEscalonados, setTopBairrosEscalonados] = useState<SACLocationRankingDatum[]>([]);
  const [topBairrosDemandantes, setTopBairrosDemandantes] = useState<SACLocationRankingDatum[]>([]);
  const [topLogradourosEscalonados, setTopLogradourosEscalonados] = useState<SACLocationRankingDatum[]>([]);
  const [topLogradourosDemandantes, setTopLogradourosDemandantes] = useState<SACLocationRankingDatum[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [loading, setLoading] = useState(true);
  const [iptModalOpen, setIptModalOpen] = useState(false);
  const [iptSemDados, setIptSemDados] = useState(false);
  const router = useRouter();

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

  const handleMonthInputChange = (value: string) => {
    if (!value) return;
    const [year, month] = value.split("-");
    const y = Number(year);
    const m = Number(month);
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return;
    setSelectedMonth(startOfMonth(new Date(y, m - 1, 1)));
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
      const normalized = normalizeSubprefeitura(sac.subprefeitura) || "";
      const code = SUBPREF_LOOKUP[normalized] || SUBPREF_LOOKUP[sac.subprefeitura?.toUpperCase() || ""];
      if (!code || !baseMap[code]) return;

      const classificacao = (sac.classificacao_servico || "").trim();
      const foraEscopo = (sac.finalizado_fora_de_escopo || "").trim().toUpperCase();
      const procedente = (sac.procedente_por_status || "").trim().toUpperCase();

      const isDemandanteIA = classificacao === "Solicitação" && foraEscopo === "NÃO";
      const isEscalonadoIRD =
        classificacao === "Reclamação" && foraEscopo === "NÃO" && procedente === "PROCEDE";

      if (isDemandanteIA) baseMap[code].demandantes += 1;
      if (isEscalonadoIRD) baseMap[code].escalonados += 1;
    });

    return SUBPREFEITURAS.map((sub) => baseMap[sub.code]);
  };

  const computeSacsOverdueBySub = (items: SAC[]): SACOverdueBySubDatum[] => {
    const map = SUBPREFEITURAS.reduce<Record<string, SACOverdueBySubDatum>>((acc, sub) => {
      acc[sub.code] = { label: sub.label, foraPrazo: 0, totalDemandantes: 0 };
      return acc;
    }, {});

    items.forEach((sac) => {
      const normalized = normalizeSubprefeitura(sac.subprefeitura) || "";
      const code = SUBPREF_LOOKUP[normalized] || SUBPREF_LOOKUP[sac.subprefeitura?.toUpperCase() || ""];
      if (!code || !map[code]) return;

      const classificacao = (sac.classificacao_servico || "").trim();
      const foraEscopo = (sac.finalizado_fora_de_escopo || "").trim().toUpperCase();
      const responsividade = (sac.responsividade_execucao || "").trim().toUpperCase();
      const isIA = classificacao === "Solicitação" && foraEscopo === "NÃO";
      if (!isIA) return;

      map[code].totalDemandantes += 1;
      if (responsividade === "NÃO") map[code].foraPrazo += 1;
    });

    return SUBPREFEITURAS.map((sub) => map[sub.code]);
  };

  const computeCncsBySub = (items: CNC[], periodStart: Date, periodEnd: Date): CNCsBySubDatum[] => {
    const baseMap = SUBPREFEITURAS.reduce<Record<string, CNCsBySubDatum>>((acc, sub) => {
      acc[sub.code] = {
        subprefeitura: sub.code,
        label: sub.label,
        quantidade: 0,
        semIrregularidade: 0,
        comIrregularidade: 0,
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
        if (cnc.sem_irregularidade === true) {
          baseMap[code].semIrregularidade += 1;
        } else {
          baseMap[code].comIrregularidade += 1;
        }
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

  const computeTopSacLocations = (items: SAC[]) => {
    type Bucket = { quantidade: number; tipos: Map<string, number> };

    const bairrosEscalonados = new Map<string, Bucket>();
    const bairrosDemandantes = new Map<string, Bucket>();
    const logradourosEscalonados = new Map<string, Bucket>();
    const logradourosDemandantes = new Map<string, Bucket>();

    const upsertBucket = (map: Map<string, Bucket>, key: string, tipoServico?: string | null) => {
      if (!key) return;
      const bucket = map.get(key) || { quantidade: 0, tipos: new Map<string, number>() };
      bucket.quantidade += 1;
      const tipo = (tipoServico || "").trim();
      if (tipo) {
        bucket.tipos.set(tipo, (bucket.tipos.get(tipo) || 0) + 1);
      }
      map.set(key, bucket);
    };

    items.forEach((sac) => {
      const classificacao = (sac.classificacao_servico || "").trim();
      const foraEscopo = (sac.finalizado_fora_de_escopo || "").trim().toUpperCase();
      const procedente = (sac.procedente_por_status || "").trim().toUpperCase();
      const isDemandanteIA = classificacao === "Solicitação" && foraEscopo === "NÃO";
      const isEscalonadoIRD = classificacao === "Reclamação" && foraEscopo === "NÃO" && procedente === "PROCEDE";
      if (!isDemandanteIA && !isEscalonadoIRD) return;

      const normalized = normalizeSubprefeitura(sac.subprefeitura) || "";
      const subCode = SUBPREF_LOOKUP[normalized] || SUBPREF_LOOKUP[sac.subprefeitura?.toUpperCase() || ""];
      const bairro = extractBairro(sac.endereco_text);
      const logradouro = extractLogradouro(sac.endereco_text);
      const tipoServico = sac.tipo_servico;

      if (isEscalonadoIRD) {
        if (bairro && subCode) upsertBucket(bairrosEscalonados, `${bairro} (${subCode})`, tipoServico);
        if (logradouro) upsertBucket(logradourosEscalonados, logradouro, tipoServico);
      }

      if (isDemandanteIA) {
        if (bairro && subCode) upsertBucket(bairrosDemandantes, `${bairro} (${subCode})`, tipoServico);
        if (logradouro) upsertBucket(logradourosDemandantes, logradouro, tipoServico);
      }
    });

    const toRanking = (map: Map<string, Bucket>, includeTipo: boolean): SACLocationRankingDatum[] => {
      return Array.from(map.entries())
        .map(([nome, bucket]) => {
          const tipos = Array.from(bucket.tipos.entries())
            .map(([tipoServico, quantidade]) => ({ tipoServico, quantidade }))
            .sort((a, b) => b.quantidade - a.quantidade)
            .slice(0, 8);
          let tipoMaisFrequente: string | undefined;
          if (includeTipo && tipos.length > 0) {
            tipoMaisFrequente = tipos[0].tipoServico;
          }
          return { nome, quantidade: bucket.quantidade, tipoMaisFrequente, tipos };
        })
        .filter((item) => item.quantidade >= 3)
        .sort((a, b) => b.quantidade - a.quantidade)
        .slice(0, 50);
    };

    return {
      bairrosEscalonados: toRanking(bairrosEscalonados, true),
      bairrosDemandantes: toRanking(bairrosDemandantes, false),
      logradourosEscalonados: toRanking(logradourosEscalonados, true),
      logradourosDemandantes: toRanking(logradourosDemandantes, false),
    };
  };

  const computeTopBfsServices = (items: CNC[], periodStart: Date, periodEnd: Date): CNCsTopServiceDatum[] => {
    const startBoundary = normalizeDateForComparison(startOfDay(periodStart));
    const endBoundary = normalizeDateForComparison(endOfDay(periodEnd));
    const counter = new Map<string, number>();

    items.forEach((cnc) => {
      try {
        const abertura = normalizeDateForComparison(new Date(cnc.data_abertura));
        if (isNaN(abertura.getTime()) || abertura < startBoundary || abertura > endBoundary) {
          return;
        }
        const key = (cnc.tipo_servico || "").trim();
        if (!key) return;
        counter.set(key, (counter.get(key) || 0) + 1);
      } catch {
        // Ignorar linhas inválidas
      }
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
          const iptValor = kpisData.indicadores?.ipt?.valor ?? null;
          setIptSemDados(Boolean(kpisData.ipt_sem_dados));
          
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
                valor: iptValor != null && !Number.isNaN(iptValor) ? iptValor : undefined,
                pontuacao: iptPontos != null && !Number.isNaN(iptPontos) ? iptPontos : undefined,
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
      setSacsOverdueBySub(computeSacsOverdueBySub(sacItems));
      setSacsTopServices(computeTopServices(sacItems));
      const topLocations = computeTopSacLocations(sacItems);
      setTopBairrosEscalonados(topLocations.bairrosEscalonados);
      setTopBairrosDemandantes(topLocations.bairrosDemandantes);
      setTopLogradourosEscalonados(topLocations.logradourosEscalonados);
      setTopLogradourosDemandantes(topLocations.logradourosDemandantes);

      const cncItems = (cncsData?.items || []) as CNC[];
      setCncsBySub(computeCncsBySub(cncItems, periodStart, periodEnd));
      setCncsTopServices(computeTopBfsServices(cncItems, periodStart, periodEnd));
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
          <>
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
                className={`p-4 transition-all duration-200 border-l-4 border-l-purple-500 ${iptSemDados ? "cursor-pointer hover:scale-[1.02]" : "cursor-pointer hover:scale-[1.02]"}`}
                onClick={() => (iptSemDados ? setIptModalOpen(true) : router.push("/ipt"))}
              >
                <CardHeader className="p-0 pb-4">
                  <IndicatorTooltip 
                    tipo="IPT" 
                    valor={indicators.data?.IPT?.valor ?? undefined}
                    pontuacao={indicators.data?.IPT?.pontuacao ?? undefined}
                  >
                    <CardTitle className="text-sm font-medium text-purple-600 dark:text-purple-400">IPT</CardTitle>
                  </IndicatorTooltip>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="text-lg font-semibold text-muted-foreground mb-1">
                    {(iptSemDados ? 0 : indicators.data?.IPT?.pontuacao) ?? 0} Pontos
                    {iptSemDados && (
                      <span className="text-xs text-muted-foreground/70"> (Clique para informar manualmente)</span>
                    )}
                    {!iptSemDados && indicators.data?.IPT?.valor != null && (
                      <span className="text-xs text-muted-foreground/70"> (Clique para ver página IPT)</span>
                    )}
                  </div>
                  <div className="text-3xl font-bold bg-linear-to-r from-purple-600 to-purple-400 bg-clip-text text-transparent">
                    {iptSemDados
                      ? "0%"
                      : indicators.data?.IPT?.valor != null && !Number.isNaN(indicators.data.IPT.valor)
                        ? `${indicators.data.IPT.valor.toFixed(1)}%`
                        : "--"}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* ADC à direita - ring estilizado com design neon */}
            <div className="flex items-center justify-center">
              <Link
                href="/indicadores/explicacao"
                className="group relative rounded-xl p-2 transition-all hover:scale-[1.02] hover:shadow-[0_0_24px_rgba(99,102,241,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                title="Clique para ver a explicação detalhada dos indicadores"
              >
                <ADCRingChart
                  total={indicators.data?.ADC?.total || 0}
                  percentual={indicators.data?.ADC?.percentual || 0}
                />
                <span className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-3 py-1 text-xs text-popover-foreground opacity-0 shadow-md ring-1 ring-border transition-opacity group-hover:opacity-100">
                  Clique para ver detalhes dos indicadores
                </span>
              </Link>
            </div>
          </div>

          <IPTModal
            open={iptModalOpen}
            onOpenChange={setIptModalOpen}
            onSuccess={loadData}
            currentValue={indicators?.data?.IPT?.valor ?? undefined}
            currentPontuacao={indicators?.data?.IPT?.pontuacao ?? undefined}
            initialMes={format(selectedMonth, "yyyy-MM")}
          />
          </>
        ) : (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <p className="text-yellow-800 dark:text-yellow-200">
              Não foi possível carregar os KPIs. Verifique se o backend está rodando.
            </p>
          </div>
        )}

        {/* Gráficos operacionais - grid 2x2 */}
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
          <SACsOverdueBySubChart
            data={sacsOverdueBySub}
            monthLabel={monthLabel}
            onPrevMonth={handlePrevMonth}
            onNextMonth={handleNextMonth}
            disableNextMonth={disableNextMonth}
          />
          <CNCsBySubChart
            data={cncsBySub}
            monthLabel={monthLabel}
            onPrevMonth={handlePrevMonth}
            onNextMonth={handleNextMonth}
            disableNextMonth={disableNextMonth}
          />
        </div>

        <div className="grid grid-cols-1 gap-4">
          <SACsTopServicesChart
            data={sacsTopServices}
            monthLabel={monthLabel}
            onPrevMonth={handlePrevMonth}
            onNextMonth={handleNextMonth}
            disableNextMonth={disableNextMonth}
          />
        </div>

        <div className="grid grid-cols-1 gap-4">
          <CNCsTopServicesChart
            data={cncsTopServices}
            monthLabel={monthLabel}
            onPrevMonth={handlePrevMonth}
            onNextMonth={handleNextMonth}
            disableNextMonth={disableNextMonth}
          />
        </div>

        <div className="grid grid-cols-1 gap-4">
          <Card className="border-0 shadow-xl bg-linear-to-br from-background to-muted/20">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-xl">Rankings Avançados de SAC</CardTitle>
                  <CardDescription>
                    Expanda cada ranking para detalhar bairros/logradouros e tipos de serviço com maior volume.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="dashboard-month-rankings" className="text-xs text-muted-foreground">
                    Mês dos rankings
                  </label>
                  <input
                    id="dashboard-month-rankings"
                    type="month"
                    value={format(selectedMonth, "yyyy-MM")}
                    max={format(today, "yyyy-MM")}
                    onChange={(e) => handleMonthInputChange(e.target.value)}
                    className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                {
                  title: "Bairros com mais SACs Escalonados",
                  subtitle: "Top 50 por bairro + subprefeitura (com detalhamento por tipo)",
                  data: topBairrosEscalonados,
                },
                {
                  title: "Bairros com mais SACs Demandantes",
                  subtitle: "Top 50 por bairro + subprefeitura",
                  data: topBairrosDemandantes,
                },
                {
                  title: "Logradouros com mais SACs Escalonados",
                  subtitle: "Top 50 de vias com maior volume e composição por tipo",
                  data: topLogradourosEscalonados,
                },
                {
                  title: "Logradouros com mais SACs Demandantes",
                  subtitle: "Top 50 de vias com maior volume",
                  data: topLogradourosDemandantes,
                },
              ].map((group) => (
                <details
                  key={group.title}
                  className="group/ranking rounded-xl bg-card/70 shadow-md ring-1 ring-primary/10 px-4 py-3 open:shadow-lg transition-all hover:shadow-[0_0_24px_rgba(56,189,248,0.16)] hover:ring-primary/30"
                >
                  <summary className="cursor-pointer list-none select-none">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-foreground">{group.title}</p>
                        <p className="text-xs text-muted-foreground">{group.subtitle}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs rounded-full bg-primary/10 text-primary px-2 py-1">
                          {group.data.length} itens
                        </span>
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform group-open/ranking:rotate-90">
                          ▶
                        </span>
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">Clique para expandir/ocultar</p>
                  </summary>

                  <div className="mt-3 space-y-2">
                    {group.data.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Sem dados suficientes no período.</p>
                    ) : (
                      group.data.map((item, index) => (
                        <details
                          key={item.nome}
                          className="group/item rounded-lg bg-background/90 p-3 shadow-sm ring-1 ring-border/40 open:shadow-md hover:shadow-[0_0_14px_rgba(99,102,241,0.12)]"
                        >
                          <summary className="cursor-pointer list-none">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {index + 1}. {item.nome}
                                </p>
                                {item.tipoMaisFrequente && (
                                  <p className="text-xs text-muted-foreground truncate">
                                    Tipo mais frequente: {item.tipoMaisFrequente}
                                  </p>
                                )}
                              </div>
                              <div className="text-right">
                                <p className="text-lg font-semibold">{item.quantidade}</p>
                                <p className="text-[11px] text-muted-foreground">solicitações</p>
                              </div>
                            </div>
                            <div className="mt-1 flex items-center justify-end">
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-500 transition-transform group-open/item:rotate-90">
                                ▶
                              </span>
                            </div>
                          </summary>

                          <div className="mt-3 pt-3 border-t border-border/50">
                            <p className="text-xs font-semibold text-muted-foreground mb-2">
                              Solicitações por tipo de serviço
                            </p>
                            {item.tipos.length === 0 ? (
                              <p className="text-xs text-muted-foreground">Sem detalhamento de tipo neste item.</p>
                            ) : (
                              <div className="space-y-2">
                                {item.tipos.map((tipo) => (
                                  <div key={`${item.nome}-${tipo.tipoServico}`} className="space-y-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-xs text-foreground truncate">{tipo.tipoServico}</p>
                                      <p className="text-xs font-medium text-muted-foreground">{tipo.quantidade}</p>
                                    </div>
                                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                      <div
                                        className="h-full rounded-full bg-linear-to-r from-cyan-500 to-indigo-500"
                                        style={{
                                          width: `${Math.max(6, (tipo.quantidade / item.quantidade) * 100)}%`,
                                        }}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </details>
                      ))
                    )}
                  </div>
                </details>
              ))}
            </CardContent>
          </Card>
        </div>

      </div>
    </MainLayout>
  );
}
