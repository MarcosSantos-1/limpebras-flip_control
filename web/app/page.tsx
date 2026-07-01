"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type SAC, type CNC } from "@/lib/api";
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
import Lottie from "lottie-react";
import loadingAnimation from "@/public/Loading.json";
import { SACsChart } from "@/components/sacs-chart";
import { SACsBySubChart, type SACsBySubDatum } from "@/components/sacs-by-sub-chart";
import { CNCsBySubChart, type CNCsBySubDatum } from "@/components/cncs-by-sub-chart";
import { SACsTopServicesChart, type SACsTopServiceDatum } from "@/components/sacs-top-services-chart";
import { CNCsTopServicesChart, type CNCsTopServiceDatum } from "@/components/cncs-top-services-chart";
import { SACsOverdueBySubChart, type SACOverdueBySubDatum } from "@/components/sacs-overdue-by-sub-chart";
import { SUBPREFEITURAS } from "@/constants/sacs";
import { useDashboardData } from "@/lib/use-dashboard-data";
import { LayoutDashboard } from "lucide-react";
import { UploadReminderToast } from "@/components/upload-reminder-toast";
import { useAuth } from "@/lib/auth";
import { AdcOverrideModal } from "@/components/adc-override-modal";
import { ManualIndicatorBadge } from "@/components/manual-indicator-badge";

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

function groupByDate(
  items: object[],
  dateField: string,
  periodStart: Date,
  periodEnd: Date
): { date: string; count: number }[] {
  const startBoundary = normalizeDateForComparison(startOfDay(periodStart));
  const endBoundary = normalizeDateForComparison(endOfDay(periodEnd));

  if (startBoundary > endBoundary) return [];

  const dates = eachDayOfInterval({ start: periodStart, end: periodEnd });
  const dateMap = new Map<string, number>();
  dates.forEach((date) => {
    const key = format(normalizeDateForComparison(startOfDay(date)), "yyyy-MM-dd");
    dateMap.set(key, 0);
  });

  items.forEach((item) => {
    try {
      const rawDate = (item as Record<string, unknown>)[dateField];
      if (!rawDate) return;
      const itemDate = normalizeDateForComparison(new Date(String(rawDate)));
      if (isNaN(itemDate.getTime())) return;
      if (itemDate < startBoundary || itemDate > endBoundary) return;
      const dateKey = format(itemDate, "yyyy-MM-dd");
      if (dateMap.has(dateKey)) dateMap.set(dateKey, (dateMap.get(dateKey) || 0) + 1);
    } catch {
      // ignorar datas inválidas
    }
  });

  return Array.from(dateMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function computeSacsBySub(items: SAC[]): SACsBySubDatum[] {
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
}

function computeSacsOverdueBySub(items: SAC[]): SACOverdueBySubDatum[] {
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
}

function computeTopServices(items: SAC[]): SACsTopServiceDatum[] {
  const counter = new Map<string, number>();
  items.forEach((sac) => {
    const key = (sac.tipo_servico || "").trim();
    if (!key) return;
    counter.set(key, (counter.get(key) || 0) + 1);
  });
  return Array.from(counter.entries()).map(([tipoServico, quantidade]) => ({ tipoServico, quantidade }));
}

function computeTopSacLocations(items: SAC[]) {
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
    if (tipo) bucket.tipos.set(tipo, (bucket.tipos.get(tipo) || 0) + 1);
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
        if (includeTipo && tipos.length > 0) tipoMaisFrequente = tipos[0].tipoServico;
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
}

function computeCncsBySub(items: CNC[], periodStart: Date, periodEnd: Date): CNCsBySubDatum[] {
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
      if (isNaN(abertura.getTime()) || abertura < startBoundary || abertura > endBoundary) return;
      const normalized = normalizeSubprefeitura(cnc.subprefeitura) || "";
      const code = SUBPREF_LOOKUP[normalized] || SUBPREF_LOOKUP[cnc.subprefeitura?.toUpperCase() || ""];
      if (!code || !baseMap[code]) return;
      baseMap[code].quantidade += 1;
      if (cnc.sem_irregularidade === true) baseMap[code].semIrregularidade += 1;
      else baseMap[code].comIrregularidade += 1;
    } catch {
      // ignorar
    }
  });

  return SUBPREFEITURAS.map((sub) => baseMap[sub.code]);
}

function computeTopBfsServices(items: CNC[], periodStart: Date, periodEnd: Date): CNCsTopServiceDatum[] {
  const startBoundary = normalizeDateForComparison(startOfDay(periodStart));
  const endBoundary = normalizeDateForComparison(endOfDay(periodEnd));
  const counter = new Map<string, number>();

  items.forEach((cnc) => {
    try {
      const abertura = normalizeDateForComparison(new Date(cnc.data_abertura));
      if (isNaN(abertura.getTime()) || abertura < startBoundary || abertura > endBoundary) return;
      const key = (cnc.tipo_servico || "").trim();
      if (!key) return;
      counter.set(key, (counter.get(key) || 0) + 1);
    } catch {
      // ignorar
    }
  });

  return Array.from(counter.entries()).map(([tipoServico, quantidade]) => ({ tipoServico, quantidade }));
}

function DashboardContent() {
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [adcOverrideOpen, setAdcOverrideOpen] = useState(false);

  const periodStart = startOfMonth(selectedMonth);
  const periodEnd = endOfMonth(selectedMonth);
  const dataInicio = format(periodStart, "yyyy-MM-dd");
  const dataFim = format(periodEnd, "yyyy-MM-dd");

  const { kpisData, sacsData, cncsData, isLoading, mutate } = useDashboardData(dataInicio, dataFim);

  const adcManual = Boolean(kpisData?.adc_override?.ativo);
  const adcManualObservacao = kpisData?.adc_override?.observacao ?? "";

  const indicators = useMemo(() => {
    if (!kpisData) return null;
    const irdPontos = Math.min(kpisData.indicadores?.ird?.pontuacao || 0, 20);
    const iaPontos = Math.min(kpisData.indicadores?.ia?.pontuacao || 0, 20);
    const ifPontos = Math.min(kpisData.indicadores?.if?.pontuacao || 0, 20);
    const iptPontos = kpisData.indicadores?.ipt?.pontuacao || 0;
    const iptValor = kpisData.indicadores?.ipt?.valor ?? null;
    const totalADC =
      kpisData.adc_override?.ativo && kpisData.adc_override.adc_total != null
        ? kpisData.adc_override.adc_total
        : irdPontos + iaPontos + ifPontos + iptPontos;
    const percentualADC = (totalADC / 100) * 100;
    return {
      data: {
        IRD: { valor: kpisData.indicadores?.ird?.valor || 0, pontuacao: irdPontos },
        IA: { valor: kpisData.indicadores?.ia?.valor || 0, pontuacao: iaPontos },
        IF: { valor: kpisData.indicadores?.if?.valor || 0, pontuacao: ifPontos },
        IPT: {
          valor: iptValor != null && !Number.isNaN(iptValor) ? iptValor : undefined,
          pontuacao: iptPontos != null && !Number.isNaN(iptPontos) ? iptPontos : undefined,
        },
        ADC: { total: totalADC, percentual: percentualADC },
      },
      sacs_hoje: kpisData.sacs_hoje || 0,
      cncs_urgentes: kpisData.cncs_urgentes || 0,
    };
  }, [kpisData]);

  const iptSemDados = Boolean(kpisData?.ipt_sem_dados);

  const sacItems = (sacsData?.items || []) as SAC[];
  const cncItems = (cncsData?.items || []) as CNC[];

  const sacsHistory = useMemo(
    () => groupByDate(sacItems, "data_criacao", periodStart, periodEnd),
    [sacItems, periodStart, periodEnd]
  );
  const sacsBySub = useMemo(() => computeSacsBySub(sacItems), [sacItems]);
  const sacsOverdueBySub = useMemo(() => computeSacsOverdueBySub(sacItems), [sacItems]);
  const sacsTopServices = useMemo(() => computeTopServices(sacItems), [sacItems]);
  const topLocations = useMemo(() => computeTopSacLocations(sacItems), [sacItems]);
  const cncsBySub = useMemo(
    () => computeCncsBySub(cncItems, periodStart, periodEnd),
    [cncItems, periodStart, periodEnd]
  );
  const cncsTopServices = useMemo(
    () => computeTopBfsServices(cncItems, periodStart, periodEnd),
    [cncItems, periodStart, periodEnd]
  );

  const today = new Date();
  const disableNextMonth = isSameMonth(selectedMonth, startOfMonth(today));
  const monthLabel = formatMonthLabel(selectedMonth);
  const monthNameExtenso = (() => {
    const raw = format(selectedMonth, "MMMM", { locale: ptBR });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  })();
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

  return (
    <>
      <AdcOverrideModal
        open={adcOverrideOpen}
        onOpenChange={setAdcOverrideOpen}
        initialMes={selectedMonth}
        onSuccess={() => void mutate()}
      />
      <UploadReminderToast />
      <div className="space-y-8">
        {isLoading && (
          <div className="fixed inset-0 z-90 bg-background/90 backdrop-blur-sm flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-card/95 px-8 py-6 shadow-2xl shadow-zinc-900/20">
              <div className="h-48 w-48">
                <Lottie animationData={loadingAnimation} loop autoplay />
              </div>
              <p className="text-sm font-semibold text-muted-foreground">Carregando dashboard...</p>
            </div>
          </div>
        )}

        <div className="relative overflow-hidden rounded-2xl bg-card p-8 shadow-xl shadow-zinc-900/12 dark:bg-linear-to-br dark:from-cyan-950/50 dark:via-zinc-900/60 dark:to-zinc-950 dark:shadow-2xl dark:shadow-black/40">
          <div className="pointer-events-none absolute -right-6 -top-10 h-44 w-44 rounded-full bg-linear-to-br from-primary/25 to-indigo-500/20 blur-3xl dark:from-cyan-500/20 dark:to-indigo-600/10" />
          <div className="pointer-events-none absolute -bottom-12 -left-8 h-36 w-36 rounded-full bg-linear-to-tr from-cyan-400/20 to-transparent blur-2xl dark:from-cyan-600/15 dark:to-transparent" />
          
          {/* Decorative shapes */}
          <div className="pointer-events-none absolute right-20 top-4 opacity-20 dark:opacity-10">
            <svg width="60" height="60" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg" className="animate-[spin_20s_linear_infinite]">
              <rect x="10" y="10" width="40" height="40" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" className="text-primary"/>
              <circle cx="30" cy="30" r="10" stroke="currentColor" strokeWidth="2" className="text-indigo-500"/>
            </svg>
          </div>
          <div className="pointer-events-none absolute left-1/3 bottom-4 opacity-15 dark:opacity-5">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="animate-pulse">
              <polygon points="20,5 35,35 5,35" stroke="currentColor" strokeWidth="2" className="text-cyan-500" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]" />

          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
            <div className="min-w-0 flex-1">
              <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:bg-linear-to-r dark:from-primary dark:to-indigo-400 dark:bg-clip-text dark:text-transparent">
                Dashboard 
              </h1>
              <p className="mt-3 max-w-2xl text-lg text-slate-600 dark:text-muted-foreground">
                Visão geral dos indicadores de desempenho.
              </p>
            </div>
            <div className="flex shrink-0 items-center justify-start gap-3 sm:justify-end sm:gap-4 md:gap-5">
            <span
                className="select-none text-xl pr-8 font-bold tracking-tight sm:text-2xl md:text-3xl bg-linear-to-br from-sky-500 via-cyan-500 to-emerald-500 bg-clip-text text-transparent dark:from-sky-400 dark:via-cyan-400 dark:to-emerald-400"
                aria-hidden
              >
                {monthNameExtenso && (
                  <>
                    {monthNameExtenso.charAt(0).toUpperCase() + monthNameExtenso.slice(1)}
                    {" de "}
                    {selectedMonth.getFullYear()}
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={() => setAdcOverrideOpen(true)}
                className="relative flex h-22 w-22 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-primary/15 via-indigo-500/12 to-cyan-500/15 shadow-md shadow-slate-900/10 transition-all hover:scale-[1.03] hover:shadow-lg dark:from-primary/25 dark:via-indigo-500/20 dark:to-cyan-950/40 dark:shadow-lg dark:shadow-black/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                title="Configurar ADC do mês (automático ou manual)"
                aria-label="Configurar ADC do mês"
              >
                <LayoutDashboard className="h-11 w-11 text-primary dark:text-primary" strokeWidth={1.5} />
                {adcManual && (
                  <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white shadow">
                    M
                  </span>
                )}
              </button>

            </div>
          </div>
        </div>

        {/* KPIs - Grid 2x2 + ADC à direita */}
        {isLoading ? (
          <div className="text-center py-8">Carregando KPIs...</div>
        ) : indicators ? (
          <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Grid 2x2 dos indicadores */}
            <div className="grid grid-cols-2 gap-3 md:col-span-2">
              <Link href="/sacs" className="block">
              <Card
                className="group relative overflow-hidden rounded-xl border border-blue-400/20 bg-linear-to-br from-blue-700 via-indigo-600 to-cyan-600 bg-[length:200%_200%] animate-[gradient_6s_ease_infinite] min-h-[160px] flex flex-col justify-between p-4 text-white shadow-lg shadow-blue-500/25 transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl cursor-pointer dark:from-blue-900 dark:via-blue-800 dark:to-blue-950 dark:border-blue-900/50 dark:text-card-foreground dark:shadow-md dark:hover:shadow-[0_0_20px_rgba(37,99,235,0.3)]"
              >
                {/* Laser sweep constante em loop (deslocado) */}
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_35%,rgba(255,255,255,0.18)_50%,transparent_65%)] bg-[length:200%_100%] animate-[shimmer_4s_linear_infinite]" />
                {/* Textura técnica de fundo */}
                <div className="pointer-events-none absolute inset-0 opacity-[0.06] bg-[linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] bg-[size:16px_16px] [mask-image:radial-gradient(ellipse_at_center,white,transparent)]" />
                
                <CardHeader className="p-0 pb-2 relative z-10">
                  <CardTitle className="text-sm font-medium text-white/95 dark:text-blue-300">IA - ÍNDICADOR DE ATENDIMENTO</CardTitle>
                </CardHeader>
                <CardContent className="p-0 relative z-10">
                  {adcManual ? (
                    <ManualIndicatorBadge observacao={adcManualObservacao} iconClassName="text-white/90" />
                  ) : (
                    <>
                  <div className="mb-1 text-lg font-semibold text-white/85 dark:text-blue-200/80">
                    {indicators.data?.IA?.pontuacao || 0} Pontos
                  </div>
                  <div className="text-4xl tracking-tight font-bold text-white drop-shadow-md">
                    {indicators.data?.IA?.valor?.toFixed(1) || "0"}%
                  </div>
                    </>
                  )}
                </CardContent>
              </Card>
              </Link>

              <Link href="/sacs" className="block">
              <Card
                className="group relative overflow-hidden rounded-xl border border-emerald-400/20 bg-linear-to-br from-emerald-700 via-teal-600 to-emerald-500 bg-[length:200%_200%] animate-[gradient_7s_ease_infinite] min-h-[160px] flex flex-col justify-between p-4 text-white shadow-lg shadow-emerald-500/25 transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl cursor-pointer dark:from-emerald-900 dark:via-emerald-800 dark:to-emerald-950 dark:border-emerald-900/50 dark:text-card-foreground dark:shadow-md dark:hover:shadow-[0_0_20px_rgba(16,185,129,0.3)]"
              >
                {/* Laser sweep constante em loop (deslocado + delay de 1s) */}
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_35%,rgba(255,255,255,0.18)_50%,transparent_65%)] bg-[length:200%_100%] animate-[shimmer_4s_linear_1s_infinite]" />
                {/* Textura técnica de fundo */}
                <div className="pointer-events-none absolute inset-0 opacity-[0.06] bg-[linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] bg-[size:16px_16px] [mask-image:radial-gradient(ellipse_at_center,white,transparent)]" />

                <CardHeader className="p-0 pb-2 relative z-10">
                  <CardTitle className="text-sm font-medium text-white/95 dark:text-emerald-300">IRD - ÍNDICADOR DE RECLAMAÇÕES POR DOMICÍLIO</CardTitle>
                </CardHeader>
                <CardContent className="p-0 relative z-10">
                  {adcManual ? (
                    <ManualIndicatorBadge observacao={adcManualObservacao} iconClassName="text-white/90" />
                  ) : (
                    <>
                  <div className="mb-1 text-lg font-semibold text-white/85 dark:text-emerald-200/80">
                    {indicators.data?.IRD?.pontuacao || 0} Pontos
                  </div>
                  <div className="text-4xl tracking-tight font-bold text-white drop-shadow-md">
                    {indicators.data?.IRD?.valor?.toFixed(2) || "0"}
                  </div>
                    </>
                  )}
                </CardContent>
              </Card>
              </Link>

              <Link href="/bfs" className="block">
              <Card
                className="group relative overflow-hidden rounded-xl border border-amber-400/20 bg-linear-to-br from-amber-600 via-orange-500 to-rose-500 bg-[length:200%_200%] animate-[gradient_8s_ease_infinite] min-h-[160px] flex flex-col justify-between p-4 text-white shadow-lg shadow-amber-500/25 transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl cursor-pointer dark:from-amber-900 dark:via-amber-800 dark:to-amber-950 dark:border-amber-900/50 dark:text-card-foreground dark:shadow-md dark:hover:shadow-[0_0_20px_rgba(245,158,11,0.3)]"
              >
                {/* Laser sweep constante em loop (deslocado + delay de 2s) */}
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_35%,rgba(255,255,255,0.18)_50%,transparent_65%)] bg-[length:200%_100%] animate-[shimmer_4s_linear_2s_infinite]" />
                {/* Textura técnica de fundo */}
                <div className="pointer-events-none absolute inset-0 opacity-[0.06] bg-[linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] bg-[size:16px_16px] [mask-image:radial-gradient(ellipse_at_center,white,transparent)]" />

                <CardHeader className="p-0 pb-2 relative z-10">
                  <CardTitle className="text-sm font-medium text-white/95 dark:text-amber-300">IF - ÍNDICADOR DE FISCALIZAÇÃO</CardTitle>
                </CardHeader>
                <CardContent className="p-0 relative z-10">
                  {adcManual ? (
                    <ManualIndicatorBadge observacao={adcManualObservacao} iconClassName="text-white/90" />
                  ) : (
                    <>
                  <div className="mb-1 text-lg font-semibold text-white/85 dark:text-amber-200/80">
                    {indicators.data?.IF?.pontuacao || 0} Pontos
                  </div>
                  <div className="text-4xl tracking-tight font-bold text-white drop-shadow-md">
                    {indicators.data?.IF?.valor?.toFixed(1) || "0"}%
                  </div>
                    </>
                  )}
                </CardContent>
              </Card>
              </Link>

              <Link href="/ipt" className="block">
              <Card 
                className="group relative overflow-hidden rounded-xl border border-purple-400/20 bg-linear-to-br from-violet-700 via-purple-600 to-fuchsia-600 bg-[length:200%_200%] animate-[gradient_6.5s_ease_infinite] min-h-[160px] flex flex-col justify-between p-4 text-white shadow-lg shadow-purple-500/25 transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl cursor-pointer dark:from-violet-900 dark:via-purple-800 dark:to-purple-950 dark:border-purple-900/50 dark:text-card-foreground dark:shadow-md dark:hover:shadow-[0_0_20px_rgba(168,85,247,0.3)]"
              >
                {/* Laser sweep constante em loop (deslocado + delay de 3s) */}
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_35%,rgba(255,255,255,0.18)_50%,transparent_65%)] bg-[length:200%_100%] animate-[shimmer_4s_linear_3s_infinite]" />
                {/* Textura técnica de fundo */}
                <div className="pointer-events-none absolute inset-0 opacity-[0.06] bg-[linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] bg-[size:16px_16px] [mask-image:radial-gradient(ellipse_at_center,white,transparent)]" />

                <CardHeader className="p-0 pb-2 relative z-10">
                  <CardTitle className="text-sm font-medium text-white/95 dark:text-purple-300">IPT - INDICADOR PLANO DE TRABALHO</CardTitle>
                </CardHeader>
                <CardContent className="p-0 relative z-10">
                  {adcManual ? (
                    <ManualIndicatorBadge observacao={adcManualObservacao} iconClassName="text-white/90" />
                  ) : (
                    <>
                  <div className="mb-1 text-lg font-semibold text-white/85 dark:text-purple-200/80">
                    {(iptSemDados ? 0 : indicators.data?.IPT?.pontuacao) ?? 0} Pontos
                    {iptSemDados && (
                      <span className="text-xs text-white/70 dark:text-purple-300/70 block mt-1 leading-tight"> (Clique para importar planilha Reports)</span>
                    )}
                  </div>
                  <div className="text-4xl tracking-tight font-bold text-white drop-shadow-md">
                    {iptSemDados
                      ? "0%"
                      : indicators.data?.IPT?.valor != null && !Number.isNaN(indicators.data.IPT.valor)
                        ? `${indicators.data.IPT.valor.toFixed(1)}%`
                        : "--"}
                  </div>
                    </>
                  )}
                </CardContent>
              </Card>
              </Link>
            </div>

            {/* ADC — anel com gradiente forte (sem glow neon) */}
            <div className="flex items-center justify-center">
              <Link
                href="/indicadores/explicacao"
                className="group relative transition-all hover:scale-[1.02] focus-visible:outline-none"
                title="Clique para ver a explicação detalhada dos indicadores"
              >
                <ADCRingChart
                  total={indicators.data?.ADC?.total || 0}
                  percentual={indicators.data?.ADC?.percentual || 0}
                />
              </Link>
            </div>
          </div>

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
          <Card className="border-0 bg-linear-to-br from-background to-muted/25 shadow-xl shadow-zinc-900/10">
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
                  data: topLocations.bairrosEscalonados,
                },
                {
                  title: "Bairros com mais SACs Demandantes",
                  subtitle: "Top 50 por bairro + subprefeitura",
                  data: topLocations.bairrosDemandantes,
                },
                {
                  title: "Logradouros com mais SACs Escalonados",
                  subtitle: "Top 50 de vias com maior volume e composição por tipo",
                  data: topLocations.logradourosEscalonados,
                },
                {
                  title: "Logradouros com mais SACs Demandantes",
                  subtitle: "Top 50 de vias com maior volume",
                  data: topLocations.logradourosDemandantes,
                },
              ].map((group) => (
                <details
                  key={group.title}
                  className="group/ranking rounded-xl bg-card/85 px-4 py-3 shadow-md shadow-zinc-900/10 transition-all open:shadow-xl hover:shadow-lg dark:bg-card/70 dark:shadow-none dark:hover:shadow-[0_0_24px_rgba(56,189,248,0.16)]"
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
                          className="group/item rounded-lg bg-background/95 p-3 shadow-md shadow-zinc-900/8 transition-all open:shadow-lg hover:shadow-lg dark:bg-background/90 dark:shadow-sm dark:hover:shadow-[0_0_14px_rgba(99,102,241,0.12)]"
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
    </>
  );
}

export default function DashboardPage() {
  const { isIptRestrictedUser, isCcoUser } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isCcoUser) {
      router.replace("/ipt");
    } else if (isIptRestrictedUser) {
      router.replace("/ipt/bateria");
    }
  }, [isCcoUser, isIptRestrictedUser, router]);

  if (isCcoUser || isIptRestrictedUser) return null;

  return (
    <MainLayout>
      <DashboardContent />
    </MainLayout>
  );
}
