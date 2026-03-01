"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { format, endOfMonth, startOfMonth, subDays } from "date-fns";
import { Activity, BarChart2, Calendar, Check, ChevronDown, ChevronRight, Cpu, Info, Package, Truck, X } from "lucide-react";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiService, type IptPreviewResponse } from "@/lib/api";
import { getSortKey, getSubFromPlano } from "@/lib/ipt-utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";

const pct = (value?: number | null) => (value == null ? "--" : `${value.toFixed(1)}%`);
const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const normalizeText = (value?: string) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Sigla SUB: primeiros 2 caracteres do plano (CV, JT, MG, ST). Fallback para nome da subprefeitura. */
const getSubTag = (subprefeitura?: string, plano?: string) => {
  const subFromPlano = getSubFromPlano(plano);
  if (subFromPlano) {
    const sigla = subFromPlano;
    if (sigla === "CV") return { sigla: "CV", className: "border-lime-500/60 bg-lime-500/10 text-lime-700 dark:text-lime-400" };
    if (sigla === "JT") return { sigla: "JT", className: "border-blue-800/60 bg-blue-700/10 text-blue-800 dark:text-blue-300" };
    if (sigla === "MG") return { sigla: "MG", className: "border-cyan-500/60 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" };
    if (sigla === "ST") return { sigla: "ST", className: "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300" };
  }
  const normalized = normalizeText(subprefeitura);
  const compact = normalized.replace(/[^a-z]/g, "");

  if (compact === "cv") {
    return { sigla: "CV", className: "border-lime-500/60 bg-lime-500/10 text-lime-700 dark:text-lime-400" };
  }
  if (compact === "jt") {
    return { sigla: "JT", className: "border-blue-800/60 bg-blue-700/10 text-blue-800 dark:text-blue-300" };
  }
  if (compact === "mg") {
    return { sigla: "MG", className: "border-cyan-500/60 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" };
  }
  if (compact === "st") {
    return { sigla: "ST", className: "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300" };
  }

  if (
    normalized.includes("casa verde") ||
    normalized.includes("limao") ||
    normalized.includes("cachoeirinha")
  ) {
    return { sigla: "CV", className: "border-lime-500/60 bg-lime-500/10 text-lime-700 dark:text-lime-400" };
  }
  if (normalized.includes("jacana") || normalized.includes("tremembe")) {
    return { sigla: "JT", className: "border-blue-800/60 bg-blue-700/10 text-blue-800 dark:text-blue-300" };
  }
  if (normalized.includes("vila maria") || normalized.includes("guilherme")) {
    return { sigla: "MG", className: "border-cyan-500/60 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" };
  }
  if (normalized.includes("santana") || normalized.includes("tucuruvi")) {
    return { sigla: "ST", className: "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300" };
  }

  return { sigla: "--", className: "border-muted-foreground/30 bg-muted/30 text-muted-foreground" };
};

const getSelimpBadgeClass = (value?: number | null) => {
  if (value == null) return "border-muted-foreground/30 bg-muted/30 text-muted-foreground";
  if (value >= 90) return "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (value >= 60) return "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-300";
};

/** Cor da barra de percentual: verde >=90%, amarelo 60-89%, vermelho <60% */
const getPercentualBarFill = (value?: number | null) => {
  if (value == null) return "bg-muted-foreground/30";
  if (value >= 90) return "bg-emerald-500";
  if (value >= 60) return "bg-amber-500";
  return "bg-red-500";
};

const getPercentualTextClass = (value?: number | null) => {
  if (value == null) return "text-muted-foreground";
  if (value >= 90) return "text-emerald-700 dark:text-emerald-300";
  if (value >= 60) return "text-amber-700 dark:text-amber-300";
  return "text-red-700 dark:text-red-300";
};

const PercentualBar = ({ value, compact }: { value?: number | null; compact?: boolean }) => {
  const pctNum = value != null && !Number.isNaN(value) ? clamp(value, 0, 100) : 0;
  const fillClass = getPercentualBarFill(value);
  const hasValue = value != null && !Number.isNaN(value);
  return (
    <div className={`flex items-center gap-2 ${compact ? "min-w-[80px]" : "min-w-[100px]"}`}>
      <div className="flex-1 h-2 rounded-full bg-muted/50 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${fillClass}`}
          style={{ width: hasValue ? `${pctNum}%` : "0" }}
        />
      </div>
      <span className={`font-semibold tabular-nums shrink-0 ${getPercentualTextClass(value)}`}>{pct(value)}</span>
    </div>
  );
};

const getOrigemBadgeClass = (origem: "ambos" | "somente_selimp" | "somente_nosso") => {
  if (origem === "somente_selimp") return "border-blue-500/60 bg-blue-500/10 text-blue-700 dark:text-blue-300";
  if (origem === "somente_nosso") return "border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-300";
  return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
};

const toNum = (value?: number | null) => (value == null || Number.isNaN(value) ? null : value);
const hasPercentual = (value?: number | null) => {
  const num = toNum(value);
  return num != null && num > 0;
};
const isZeroOrMissing = (value?: number | null) => {
  const num = toNum(value);
  return num == null || num <= 0;
};
const getDivergenceMagnitude = (selimp?: number | null, nosso?: number | null) => {
  const s = toNum(selimp) ?? 0;
  const n = toNum(nosso) ?? 0;
  return Math.abs(s - n);
};

type SortDirection = "asc" | "desc";

/** Ordena por SUB + serviço (VP, VJ, GO...) + mapa (4 últimos dígitos). Ignora turno e frequência. */
function compareByPlanoStructure(
  a: { plano?: string },
  b: { plano?: string },
  column: "plano" | "sub" | "servico",
  direction: SortDirection
): number {
  const ka = getSortKey(a.plano ?? "");
  const kb = getSortKey(b.plano ?? "");
  let cmp = 0;
  if (column === "servico") {
    cmp = ka.servico.localeCompare(kb.servico) || ka.sub.localeCompare(kb.sub) || ka.mapa.localeCompare(kb.mapa);
  } else {
    cmp = ka.sub.localeCompare(kb.sub) || ka.servico.localeCompare(kb.servico) || ka.mapa.localeCompare(kb.mapa);
  }
  return direction === "asc" ? cmp : -cmp;
}

type TableColumnKey = "plano" | "sub" | "servico" | "selimp" | "nossa" | "origem";
const SUB_SIGLAS = ["CV", "JT", "MG", "ST"] as const;
const ORIGEM_VALUES = ["ambos", "somente_selimp", "somente_nosso"] as const;
type OrigemValue = (typeof ORIGEM_VALUES)[number];
const MIN_COL_WIDTH = 72;
const MAX_COL_WIDTH = 520;

type TableScope = "dia_anterior" | "periodo" | "todos";

export default function IPTPage() {
  const [tableScope, setTableScope] = useState<TableScope>("dia_anterior");
  const [tablePeriodRange, setTablePeriodRange] = useState<{ inicio: Date; fim: Date } | null>(() => ({
    inicio: startOfMonth(new Date()),
    fim: endOfMonth(new Date()),
  }));
  const [loading, setLoading] = useState(true);
  const [iptPreview, setIptPreview] = useState<IptPreviewResponse | null>(null);
  const [iptCard, setIptCard] = useState<{ valor?: number; pontuacao?: number }>({});
  const [subprefeituraFilter, setSubprefeituraFilter] = useState("all");
  const [divergenciaFilter, setDivergenciaFilter] = useState<"all" | "somente" | "sem">("all");
  const [highlightDivergencias, setHighlightDivergencias] = useState(false);
  const [origemFilter, setOrigemFilter] = useState<"all" | "ambos" | "somente_selimp" | "somente_nosso">("all");
  const [zeroFilter, setZeroFilter] = useState<"all" | "zerados" | "nao_zerados">("all");
  const [tableExpanded, setTableExpanded] = useState(true);
  const [headerMenuOpen, setHeaderMenuOpen] = useState<TableColumnKey | null>(null);
  const [subSiglaFilter, setSubSiglaFilter] = useState<Array<(typeof SUB_SIGLAS)[number]>>([
    "CV",
    "JT",
    "MG",
    "ST",
  ]);
  const [serviceFilterValues, setServiceFilterValues] = useState<string[]>([]);
  const [serviceFilterInitialized, setServiceFilterInitialized] = useState(false);
  const [origemFilterValues, setOrigemFilterValues] = useState<OrigemValue[]>([...ORIGEM_VALUES]);
  const [tableSort, setTableSort] = useState<{ column: TableColumnKey; direction: SortDirection }>({
    column: "plano",
    direction: "asc",
  });
  const [expandedPlano, setExpandedPlano] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<TableColumnKey, number>>({
    plano: 170,
    sub: 90,
    servico: 350,
    selimp: 130,
    nossa: 120,
    origem: 130,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      let periodoInicial: string | undefined;
      let periodoFinal: string | undefined;
      let mostrarTodos = false;

      if (tableScope === "todos") {
        mostrarTodos = true;
        periodoInicial = format(startOfMonth(new Date()), "yyyy-MM-dd");
        periodoFinal = format(new Date(), "yyyy-MM-dd");
      } else if (tableScope === "periodo" && tablePeriodRange) {
        periodoInicial = format(tablePeriodRange.inicio, "yyyy-MM-dd");
        periodoFinal = format(tablePeriodRange.fim, "yyyy-MM-dd");
      } else {
        const ontem = subDays(new Date(), 1);
        periodoInicial = format(ontem, "yyyy-MM-dd");
        periodoFinal = format(ontem, "yyyy-MM-dd");
      }

      const [preview, kpis] = await Promise.all([
        tableScope === "dia_anterior"
          ? apiService.getIptPreview(undefined, undefined, false).catch(() => null)
          : apiService.getIptPreview(periodoInicial, periodoFinal, mostrarTodos).catch(() => null),
        apiService.getKPIs(periodoInicial, periodoFinal).catch(() => null),
      ]);
      setIptPreview(preview);
      setIptCard({
        valor: kpis?.indicadores?.ipt?.valor,
        pontuacao: kpis?.indicadores?.ipt?.pontuacao,
      });
    } finally {
      setLoading(false);
    }
  }, [tableScope, tablePeriodRange]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-filter-anchor='true']")) {
        setHeaderMenuOpen(null);
      }
    };
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHeaderMenuOpen(null);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEsc);
    };
  }, []);

  const subprefeituraOptions = useMemo(() => {
    const values = (iptPreview?.subprefeituras ?? []).map((item) => item.subprefeitura).filter(Boolean);
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [iptPreview]);

  const sourceRows = useMemo(
    () =>
      (iptPreview?.itens ?? iptPreview?.comparativo?.itens ?? []) as Array<{
        plano: string;
        subprefeitura: string;
        tipo_servico: string;
        percentual_selimp: number | null;
        percentual_nosso: number | null;
        origem: "ambos" | "somente_selimp" | "somente_nosso";
        equipamentos?: string[];
        frequencia?: string | null;
        proxima_programacao?: string | null;
        cronograma_preview?: string[];
        detalhes_diarios?: Array<{
          data: string;
          esperado: boolean;
          percentual_selimp: number | null;
          percentual_nosso: number | null;
          despachos_selimp: number;
          despachos_nosso: number;
          data_estimada?: boolean;
        }>;
      }>,
    [iptPreview]
  );

  const serviceOptions = useMemo(() => {
    const values = sourceRows.map((item) => item.tipo_servico).filter(Boolean);
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [sourceRows]);

  useEffect(() => {
    if (!serviceFilterInitialized && serviceOptions.length > 0) {
      setServiceFilterValues(serviceOptions);
      setServiceFilterInitialized(true);
    }
  }, [serviceFilterInitialized, serviceOptions]);

  const planoAtivoMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const row of iptPreview?.mesclados ?? []) {
      const key = row.plano?.trim();
      if (!key) continue;
      const previous = map.get(key);
      // Se em algum registro o plano aparece ativo, consideramos ativo.
      map.set(key, Boolean(previous) || Boolean(row.plano_ativo));
    }
    return map;
  }, [iptPreview]);

  const filteredComparativo = useMemo(() => {
    const rows = sourceRows;
    const filtered = rows.filter((row) => {
      if (subprefeituraFilter !== "all" && row.subprefeitura !== subprefeituraFilter) return false;
      if (origemFilter !== "all" && row.origem !== origemFilter) return false;
      if (origemFilterValues.length > 0 && !origemFilterValues.includes(row.origem)) return false;
      if (serviceFilterValues.length > 0 && !serviceFilterValues.includes(row.tipo_servico)) return false;
      const subSigla = getSubTag(row.subprefeitura, row.plano).sigla;
      if (
        subSiglaFilter.length < SUB_SIGLAS.length &&
        !subSiglaFilter.includes(subSigla as (typeof SUB_SIGLAS)[number])
      ) {
        return false;
      }
      const zeradoAmbos = isZeroOrMissing(row.percentual_selimp) && isZeroOrMissing(row.percentual_nosso);
      if (zeroFilter === "zerados" && !zeradoAmbos) return false;
      if (zeroFilter === "nao_zerados" && zeradoAmbos) return false;
      const divergence = getDivergenceMagnitude(row.percentual_selimp, row.percentual_nosso);
      const diverge = divergence >= 5;
      if (divergenciaFilter === "somente" && !diverge) return false;
      if (divergenciaFilter === "sem" && diverge) return false;
      return true;
    });

    return [...filtered].sort((a, b) => {
      const dir = tableSort.direction;
      const byDirection = (base: number) => (dir === "asc" ? base : -base);
      let sortBase = 0;
      if (tableSort.column === "plano" || tableSort.column === "sub" || tableSort.column === "servico") {
        sortBase = compareByPlanoStructure(a, b, tableSort.column, dir);
      } else if (tableSort.column === "selimp") {
        sortBase = (toNum(a.percentual_selimp) ?? -1) - (toNum(b.percentual_selimp) ?? -1);
      } else if (tableSort.column === "nossa") {
        sortBase = (toNum(a.percentual_nosso) ?? -1) - (toNum(b.percentual_nosso) ?? -1);
      } else {
        sortBase = a.origem.localeCompare(b.origem, "pt-BR");
      }
      if (sortBase !== 0) return sortBase;

      const aDiv = getDivergenceMagnitude(a.percentual_selimp, a.percentual_nosso);
      const bDiv = getDivergenceMagnitude(b.percentual_selimp, b.percentual_nosso);
      if (aDiv !== bDiv) return bDiv - aDiv;
      return compareByPlanoStructure(a, b, "plano", "asc");
    });
  }, [
    sourceRows,
    origemFilter,
    origemFilterValues,
    divergenciaFilter,
    subprefeituraFilter,
    tableSort,
    zeroFilter,
    subSiglaFilter,
    serviceFilterValues,
  ]);

  const comparativoInsights = useMemo(() => {
    const rows = iptPreview?.comparativo?.itens ?? [];
    let selimpSemNossoCom = 0;
    let selimpComNossoSem = 0;
    let ambosZerados = 0;
    let ambosZeradosAtivos = 0;
    let ambosZeradosInativos = 0;

    for (const row of rows) {
      const temSelimp = hasPercentual(row.percentual_selimp);
      const temNosso = hasPercentual(row.percentual_nosso);
      const zeradoAmbos = !temSelimp && !temNosso;
      if (zeradoAmbos) {
        ambosZerados += 1;
        const planoAtivo = planoAtivoMap.get((row.plano || "").trim());
        if (planoAtivo === true) ambosZeradosAtivos += 1;
        else ambosZeradosInativos += 1;
      }
      if (!temSelimp && temNosso) selimpSemNossoCom += 1;
      if (temSelimp && !temNosso) selimpComNossoSem += 1;
    }

    return {
      selimpSemNossoCom,
      selimpComNossoSem,
      ambosZerados,
      ambosZeradosAtivos,
      ambosZeradosInativos,
    };
  }, [iptPreview, planoAtivoMap]);

  const origemDistribution = useMemo(() => {
    const total = iptPreview?.comparativo?.total_linhas ?? 0;
    if (!total) return { ambos: 0, somenteSelimp: 0, somenteNosso: 0 };
    return {
      ambos: ((total - (iptPreview?.comparativo?.somente_selimp ?? 0) - (iptPreview?.comparativo?.somente_nosso ?? 0)) / total) * 100,
      somenteSelimp: ((iptPreview?.comparativo?.somente_selimp ?? 0) / total) * 100,
      somenteNosso: ((iptPreview?.comparativo?.somente_nosso ?? 0) / total) * 100,
    };
  }, [iptPreview]);

  const topSubprefeituras = useMemo(() => {
    const list = [...(iptPreview?.subprefeituras ?? [])];
    list.sort((a, b) => (b.media_execucao ?? -1) - (a.media_execucao ?? -1));
    return list.slice(0, 10);
  }, [iptPreview]);

  const topServicos = useMemo(() => {
    const list = [...(iptPreview?.servicos ?? [])];
    list.sort((a, b) => (b.media_execucao ?? -1) - (a.media_execucao ?? -1));
    return list.slice(0, 10);
  }, [iptPreview]);

  const adjustColumnWidth = (column: TableColumnKey, delta: number) => {
    setColumnWidths((prev) => ({
      ...prev,
      [column]: clamp(prev[column] + delta, MIN_COL_WIDTH, MAX_COL_WIDTH),
    }));
  };

  const setSort = (column: TableColumnKey, direction: SortDirection) => {
    setTableSort({ column, direction });
    setHeaderMenuOpen(null);
  };

  const toggleSubSigla = (sigla: (typeof SUB_SIGLAS)[number]) => {
    setSubSiglaFilter((prev) => {
      if (prev.includes(sigla)) return prev.filter((item) => item !== sigla);
      return [...prev, sigla];
    });
  };

  const toggleServiceFilter = (servico: string) => {
    setServiceFilterValues((prev) => {
      if (prev.includes(servico)) return prev.filter((item) => item !== servico);
      return [...prev, servico];
    });
  };

  const toggleOrigemFilterValue = (origem: OrigemValue) => {
    setOrigemFilterValues((prev) => {
      if (prev.includes(origem)) return prev.filter((item) => item !== origem);
      return [...prev, origem];
    });
  };

  const getSortLabel = (column: TableColumnKey) => {
    if (tableSort.column !== column) return "↕";
    return tableSort.direction === "asc" ? "↑" : "↓";
  };

  const clearAllTableFilters = () => {
    setDivergenciaFilter("all");
    setHighlightDivergencias(true);
    setOrigemFilter("all");
    setZeroFilter("all");
    setSubprefeituraFilter("all");
    setSubSiglaFilter([...SUB_SIGLAS]);
    setServiceFilterValues(serviceOptions);
    setOrigemFilterValues([...ORIGEM_VALUES]);
    setHeaderMenuOpen(null);
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-emerald-400/20 via-teal-400/10 to-cyan-400/15 p-8 shadow-[0_0_45px_-20px_rgba(16,185,129,0.75)]">
          <div className="pointer-events-none absolute -top-16 right-10 h-44 w-44 rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 left-10 h-44 w-44 rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="relative">
            <h1 className="text-4xl font-bold tracking-tight bg-linear-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent pb-2">
              IPT
            </h1>
            <p className="text-muted-foreground mt-2 text-lg max-w-3xl">
              Análise macro e conferência SELIMP x base interna, com exclusão de módulos/planos inativos.
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-card/70 backdrop-blur p-4 shadow-lg">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 items-end">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Subprefeitura</p>
              <select
                value={subprefeituraFilter}
                onChange={(e) => setSubprefeituraFilter(e.target.value)}
                className="h-10 rounded-xl bg-background/90 px-3 text-sm w-full shadow-inner ring-1 ring-white/10 focus:ring-2 focus:ring-emerald-500/60 outline-none"
              >
                <option value="all">Todas</option>
                {subprefeituraOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={loadData}
              className="h-10 rounded-xl px-4 text-sm font-medium text-white bg-linear-to-r from-emerald-500 to-teal-500 hover:opacity-90 transition-all shadow-[0_8px_20px_-10px_rgba(16,185,129,0.9)] inline-flex items-center justify-center gap-2"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <polyline points="21 3 21 9 15 9" />
              </svg>
              Atualizar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card className="xl:col-span-1 border-0 shadow-[0_20px_50px_-30px_rgba(16,185,129,0.7)] bg-linear-to-br from-emerald-500/15 via-card to-card">
            <CardHeader>
              <CardTitle className="text-base">IPT (calculo automatico)</CardTitle>
              <CardDescription>Percentual medio mensal por plano (report SELIMP) e pontuacao do ADC.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl bg-background/70 p-4 shadow-sm transition-all hover:shadow-md">
                <p className="text-xs text-muted-foreground">IPT (%)</p>
                <p className="text-3xl font-bold text-emerald-600">{iptCard.valor != null ? `${iptCard.valor.toFixed(1)}%` : "--"}</p>
                <div className="mt-3 h-2 rounded-full bg-emerald-200/40 dark:bg-emerald-900/20">
                  <div
                    className="h-2 rounded-full bg-linear-to-r from-emerald-500 to-teal-500 transition-all"
                    style={{ width: `${clamp(iptCard.valor ?? 0)}%` }}
                  />
                </div>
              </div>
              <div className="rounded-xl bg-background/70 p-4 shadow-sm transition-all hover:shadow-md">
                <p className="text-xs text-muted-foreground">Pontuacao IPT</p>
                <p className="text-3xl font-bold text-teal-600">{iptCard.pontuacao ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-2">Faixa de pontuacao conforme parametros do ADC.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="xl:col-span-2 border-0 shadow-[0_20px_50px_-30px_rgba(16,185,129,0.6)]">
            <CardHeader>
              <CardTitle className="text-base">Medicoes Automaticas (importacoes)</CardTitle>
              <CardDescription>Indicadores operacionais gerados automaticamente da base consolidada.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="rounded-xl bg-card/70 p-3 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg">
                <p className="text-xs text-muted-foreground">Planos (SELIMP)</p>
                <p className="text-xl font-bold">{iptPreview?.resumo.total_planos ?? 0}</p>
              </div>
              <div className="rounded-xl bg-emerald-500/10 p-3 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg">
                <p className="text-xs text-muted-foreground">Planos Ativos</p>
                <p className="text-xl font-bold text-emerald-600">{iptPreview?.resumo.total_planos_ativos ?? 0}</p>
              </div>
              <div className="rounded-xl bg-cyan-500/10 p-3 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg">
                <p className="text-xs text-muted-foreground">Execucao Media Ativa</p>
                <p className="text-xl font-bold">{pct(iptPreview?.resumo.media_execucao_planos_ativos)}</p>
                <div className="mt-2 h-1.5 rounded-full bg-cyan-200/40 dark:bg-cyan-900/20">
                  <div
                    className="h-1.5 rounded-full bg-cyan-500"
                    style={{ width: `${clamp(iptPreview?.resumo.media_execucao_planos_ativos ?? 0)}%` }}
                  />
                </div>
              </div>
              <div className="rounded-xl bg-emerald-500/10 p-3 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg">
                <p className="text-xs text-muted-foreground">Modulos Ativos</p>
                <p className="text-xl font-bold text-emerald-600">{iptPreview?.resumo.total_modulos_ativos ?? 0}</p>
              </div>
              <div className="rounded-xl bg-rose-500/10 p-3 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg">
                <p className="text-xs text-muted-foreground">Modulos Inativos</p>
                <p className="text-xl font-bold text-rose-600">{iptPreview?.resumo.total_modulos_inativos ?? 0}</p>
              </div>
              <div className="rounded-xl bg-amber-500/10 p-3 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg">
                <p className="text-xs text-muted-foreground">Sem Status</p>
                <p className="text-xl font-bold text-amber-600">{iptPreview?.resumo.sem_status_bateria ?? 0}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <CardTitle className="text-base">Top Subprefeituras (ativos)</CardTitle>
              <CardDescription>Barras por volume e desempenho medio para leitura rapida.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {topSubprefeituras.map((item) => (
                <div key={item.subprefeitura} className="rounded-xl bg-background/60 p-2.5 shadow-sm transition-all hover:shadow-md">
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{item.subprefeitura || "Nao informado"}</span>
                    <span className="text-muted-foreground">{item.quantidade_planos} planos</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted/50">
                    <div
                      className="h-2 rounded-full bg-linear-to-r from-emerald-500 to-teal-500"
                      style={{ width: `${clamp(item.media_execucao ?? 0)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Execucao media: {pct(item.media_execucao)}</p>
                </div>
              ))}
              {!loading && topSubprefeituras.length === 0 && (
                <p className="text-sm text-muted-foreground">Sem dados para o período.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg">
            <CardHeader>
              <CardTitle className="text-base">Top Serviços (ativos)</CardTitle>
              <CardDescription>Distribuição por tipo de serviço com barras e realce visual.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {topServicos.map((item) => (
                <div key={item.tipo_servico} className="rounded-xl bg-background/60 p-2.5 shadow-sm transition-all hover:shadow-md">
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{item.tipo_servico || "Não informado"}</span>
                    <span className="text-muted-foreground">{item.quantidade_planos} planos</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted/50">
                    <div
                      className="h-2 rounded-full bg-linear-to-r from-emerald-500 to-cyan-500"
                      style={{ width: `${clamp(item.media_execucao ?? 0)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Execucao media: {pct(item.media_execucao)}</p>
                </div>
              ))}
              {!loading && topServicos.length === 0 && (
                <p className="text-sm text-muted-foreground">Sem dados para o período.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle>Comparativo SELIMP x DDMX</CardTitle>
            <CardDescription>
              Conferência por plano para validar divergência percentual e cobertura entre planilhas.
              Delta (Δ) representa a diferença em pontos percentuais: SELIMP - DDMX.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl p-3 bg-background/70 shadow-sm">
                <p className="text-xs text-muted-foreground">Linhas comparativas</p>
                <p className="text-xl font-bold">{iptPreview?.comparativo?.total_linhas ?? 0}</p>
              </div>
              <div className="rounded-xl p-3 bg-amber-500/10 shadow-sm">
                <p className="text-xs text-muted-foreground">Divergências (|Δ| &gt;= 5 p.p.)</p>
                <p className="text-xl font-bold text-amber-600">{iptPreview?.comparativo?.divergencias ?? 0}</p>
                <div className="mt-2 h-1.5 rounded-full bg-amber-200/50 dark:bg-amber-900/20">
                  <div
                    className="h-1.5 rounded-full bg-amber-500"
                    style={{
                      width: `${clamp(
                        ((iptPreview?.comparativo?.divergencias ?? 0) / Math.max(1, iptPreview?.comparativo?.total_linhas ?? 1)) * 100
                      )}%`,
                    }}
                  />
                </div>
              </div>
              <div className="rounded-xl p-3 bg-cyan-500/10 shadow-sm">
                <p className="text-xs text-muted-foreground">Só SELIMP</p>
                <p className="text-xl font-bold text-cyan-600">{iptPreview?.comparativo?.somente_selimp ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">{origemDistribution.somenteSelimp.toFixed(1)}%</p>
              </div>
              <div className="rounded-xl p-3 bg-fuchsia-500/10 shadow-sm">
                <p className="text-xs text-muted-foreground">Só DDMX</p>
                <p className="text-xl font-bold text-fuchsia-600">{iptPreview?.comparativo?.somente_nosso ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">{origemDistribution.somenteNosso.toFixed(1)}%</p>
              </div>
              <div className="rounded-xl p-3 bg-blue-500/10 shadow-sm">
                <p className="text-xs text-muted-foreground">Sem % SELIMP e com % DDMX</p>
                <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{comparativoInsights.selimpSemNossoCom}</p>
              </div>
              <div className="rounded-xl p-3 bg-rose-500/10 shadow-sm">
                <p className="text-xs text-muted-foreground">Com % SELIMP e sem % DDMX</p>
                <p className="text-xl font-bold text-rose-700 dark:text-rose-300">{comparativoInsights.selimpComNossoSem}</p>
              </div>
              <div className="rounded-xl p-3 bg-stone-500/10 shadow-sm">
                <p className="text-xs text-muted-foreground">Zerados em ambas</p>
                <p className="text-xl font-bold text-stone-700 dark:text-stone-300">{comparativoInsights.ambosZerados}</p>
              </div>
              <div className="rounded-xl p-3 bg-emerald-500/10 shadow-sm">
                <p className="text-xs text-muted-foreground">Zerados e ativos</p>
                <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{comparativoInsights.ambosZeradosAtivos}</p>
              </div>
              <div className="rounded-xl p-3 bg-slate-500/10 shadow-sm">
                <p className="text-xs text-muted-foreground">Zerados e inativos</p>
                <p className="text-xl font-bold text-slate-700 dark:text-slate-300">{comparativoInsights.ambosZeradosInativos}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <select
                value={divergenciaFilter}
                onChange={(e) => setDivergenciaFilter(e.target.value as "all" | "somente" | "sem")}
                className="h-9 rounded-xl bg-background/80 px-3 text-sm shadow-inner ring-1 ring-white/10 outline-none"
              >
                <option value="all">Divergência: todos</option>
                <option value="somente">Divergência: só destacados (|Δ| &gt;= 5)</option>
                <option value="sem">Divergência: sem destacados</option>
              </select>
              <label className="flex items-center gap-2 text-sm rounded-xl bg-background/70 px-3 py-2 shadow-sm">
                <input
                  type="checkbox"
                  checked={highlightDivergencias}
                  onChange={(e) => setHighlightDivergencias(e.target.checked)}
                />
                Destacar divergentes
              </label>
              <button
                type="button"
                onClick={() => setTableExpanded((prev) => !prev)}
                className="h-9 rounded-xl px-3 text-sm bg-background/70 shadow-sm hover:shadow-md transition-all"
              >
                {tableExpanded ? "Encolher tabela" : "Mostrar tabela"}
              </button>
              <select
                value={zeroFilter}
                onChange={(e) => setZeroFilter(e.target.value as "all" | "zerados" | "nao_zerados")}
                className="h-9 rounded-xl bg-background/80 px-3 text-sm shadow-inner ring-1 ring-white/10 outline-none"
              >
                <option value="all">Todos percentuais</option>
                <option value="zerados">Apenas zerados</option>
                <option value="nao_zerados">Sem zerados</option>
              </select>

              <div className="flex items-center gap-2 rounded-xl bg-emerald-500/20 px-3 py-2 ring-2 ring-emerald-500/40 shadow-md">
                <Calendar className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <div className="flex items-center gap-1.5 flex-wrap">
                  <input
                    type="date"
                    value={
                      tableScope === "periodo" && tablePeriodRange
                        ? format(tablePeriodRange.inicio, "yyyy-MM-dd")
                        : tableScope === "todos"
                        ? format(startOfMonth(new Date()), "yyyy-MM-dd")
                        : format(subDays(new Date(), 1), "yyyy-MM-dd")
                    }
                    max={format(new Date(), "yyyy-MM-dd")}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      const d = new Date(v);
                      setTableScope("periodo");
                      setTablePeriodRange((prev) => ({
                        inicio: d,
                        fim: prev?.fim && prev.fim >= d ? prev.fim : d,
                      }));
                    }}
                    className="h-8 rounded-lg bg-background/90 px-2 text-sm font-medium ring-1 ring-emerald-500/50 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                  <span className="text-muted-foreground text-xs">até</span>
                  <input
                    type="date"
                    value={
                      tableScope === "periodo" && tablePeriodRange
                        ? format(tablePeriodRange.fim, "yyyy-MM-dd")
                        : tableScope === "todos"
                        ? format(new Date(), "yyyy-MM-dd")
                        : format(subDays(new Date(), 1), "yyyy-MM-dd")
                    }
                    max={format(new Date(), "yyyy-MM-dd")}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      const d = new Date(v);
                      setTableScope("periodo");
                      setTablePeriodRange((prev) => ({
                        inicio: prev?.inicio && prev.inicio <= d ? prev.inicio : d,
                        fim: d,
                      }));
                    }}
                    className="h-8 rounded-lg bg-background/90 px-2 text-sm font-medium ring-1 ring-emerald-500/50 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    {tableScope === "dia_anterior" && "Dia anterior"}
                    {tableScope === "periodo" && "Período"}
                    {tableScope === "todos" && "Todos"}
                  </span>
                </div>
              </div>

              {tableScope !== "dia_anterior" && (
                <button
                  type="button"
                  onClick={() => {
                    setTableScope("dia_anterior");
                    setTablePeriodRange(null);
                  }}
                  className="h-9 rounded-xl px-3 text-sm bg-amber-500/15 text-amber-700 dark:text-amber-300 shadow-sm hover:shadow-md hover:bg-amber-500/20 transition-all"
                  title="Voltar ao dia anterior"
                >
                  Dia anterior
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setTableScope("todos");
                  setTablePeriodRange(null);
                }}
                className="h-9 rounded-xl px-3 text-sm bg-slate-500/15 text-slate-700 dark:text-slate-300 shadow-sm hover:shadow-md hover:bg-slate-500/20 transition-all"
                title="Mostrar todos os setores (visão abrangente)"
              >
                <X className="h-4 w-4 inline mr-1 -mt-0.5" />
                Apagar período
              </button>

              <button
                type="button"
                onClick={clearAllTableFilters}
                className="h-9 rounded-xl px-3 text-sm bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 shadow-sm hover:shadow-md hover:bg-emerald-500/20 transition-all"
              >
                Limpar todos os filtros
              </button>
            </div>

            {tableExpanded && (
              <div className="rounded-2xl bg-background/60 shadow-inner transition-all">
                <table className="w-full text-sm table-fixed">
                  <colgroup>
                    <col style={{ width: 36 }} />
                    <col style={{ width: columnWidths.plano }} />
                    <col style={{ width: columnWidths.sub }} />
                    <col style={{ width: columnWidths.servico }} />
                    <col style={{ width: columnWidths.selimp }} />
                    <col style={{ width: columnWidths.nossa }} />
                    <col style={{ width: columnWidths.origem }} />
                  </colgroup>
                  <thead className="bg-muted/50 border-b-2 border-emerald-500/30">
                    <tr>
                      <th className="text-left px-1 py-3.5 align-top w-[36px]">&nbsp;</th>
                      <th className="text-left px-2 py-3.5 align-top">
                        <div className="relative" data-filter-anchor="true">
                          <button
                            type="button"
                            onClick={() => setHeaderMenuOpen((prev) => (prev === "plano" ? null : "plano"))}
                            className="w-full rounded-xl bg-background/80 px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-background hover:shadow-lg"
                          >
                            <span className="inline-flex items-center gap-1">📌 Plano {getSortLabel("plano")}</span>
                          </button>
                          {headerMenuOpen === "plano" && (
                            <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-44 rounded-xl bg-popover/95 p-2 shadow-[0_16px_45px_-20px_rgba(0,0,0,0.6)] backdrop-blur transition-all">
                              <p className="text-[10px] font-semibold text-muted-foreground mb-1">Ordenação</p>
                              <button onClick={() => setSort("plano", "asc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted/60">
                                Crescente
                              </button>
                              <button onClick={() => setSort("plano", "desc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted/60">
                                Decrescente
                              </button>
                              <p className="text-[10px] font-semibold text-muted-foreground mt-2 mb-1">Largura</p>
                              <div className="flex items-center gap-1">
                                <button onClick={() => adjustColumnWidth("plano", -16)} className="rounded px-2 py-1 text-xs bg-muted/60 hover:bg-muted">-</button>
                                <button onClick={() => adjustColumnWidth("plano", 16)} className="rounded px-2 py-1 text-xs bg-muted/60 hover:bg-muted">+</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </th>
                      <th className="text-left px-2 py-3.5 align-top">
                        <div className="relative" data-filter-anchor="true">
                          <button
                            type="button"
                            onClick={() => setHeaderMenuOpen((prev) => (prev === "sub" ? null : "sub"))}
                            className="w-full rounded-xl bg-background/80 px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-background hover:shadow-lg"
                          >
                            <span className="inline-flex items-center gap-1">🏙 Sub. {getSortLabel("sub")}</span>
                          </button>
                          {headerMenuOpen === "sub" && (
                            <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-52 rounded-xl bg-popover/95 p-2 shadow-[0_16px_45px_-20px_rgba(0,0,0,0.6)] backdrop-blur transition-all">
                              <p className="text-[10px] font-semibold text-muted-foreground mb-1">Ordenação</p>
                              <button onClick={() => setSort("sub", "asc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted/60">
                                Crescente
                              </button>
                              <button onClick={() => setSort("sub", "desc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted/60">
                                Decrescente
                              </button>
                              <p className="text-[10px] font-semibold text-muted-foreground mt-2 mb-1">Filtrar siglas</p>
                              {SUB_SIGLAS.map((sigla) => (
                                <label key={sigla} className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50">
                                  <input
                                    type="checkbox"
                                    checked={subSiglaFilter.includes(sigla)}
                                    onChange={() => toggleSubSigla(sigla)}
                                  />
                                  {sigla}
                                </label>
                              ))}
                              <div className="mt-1 flex gap-1">
                                <button
                                  onClick={() => setSubSiglaFilter([...SUB_SIGLAS])}
                                  className="rounded px-2 py-1 text-[11px] bg-muted/60 hover:bg-muted"
                                >
                                  Todas
                                </button>
                                <button
                                  onClick={() => setSubSiglaFilter([])}
                                  className="rounded px-2 py-1 text-[11px] bg-muted/60 hover:bg-muted"
                                >
                                  Limpar
                                </button>
                              </div>
                              <p className="text-[10px] font-semibold text-muted-foreground mt-2 mb-1">Largura</p>
                              <div className="flex items-center gap-1">
                                <button onClick={() => adjustColumnWidth("sub", -12)} className="rounded px-2 py-1 text-xs bg-muted/60 hover:bg-muted">-</button>
                                <button onClick={() => adjustColumnWidth("sub", 12)} className="rounded px-2 py-1 text-xs bg-muted/60 hover:bg-muted">+</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </th>
                      <th className="text-left px-2 py-3.5 align-top">
                        <div className="relative" data-filter-anchor="true">
                          <button
                            type="button"
                            onClick={() => setHeaderMenuOpen((prev) => (prev === "servico" ? null : "servico"))}
                            className="w-full rounded-xl bg-background/80 px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-background hover:shadow-lg"
                          >
                            <span className="inline-flex items-center gap-1">🛠 Serviço {getSortLabel("servico")}</span>
                          </button>
                          {headerMenuOpen === "servico" && (
                            <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-72 rounded-xl bg-popover/95 p-2 shadow-[0_16px_45px_-20px_rgba(0,0,0,0.6)] backdrop-blur transition-all">
                              <p className="text-[10px] font-semibold text-muted-foreground mb-1">Ordenação</p>
                              <button onClick={() => setSort("servico", "asc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted/60">
                                Crescente
                              </button>
                              <button onClick={() => setSort("servico", "desc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted/60">
                                Decrescente
                              </button>
                              <p className="text-[10px] font-semibold text-muted-foreground mt-2 mb-1">Filtrar serviços</p>
                              <div className="max-h-40 overflow-y-auto space-y-0.5 pr-1">
                                {serviceOptions.map((servico) => (
                                  <label key={servico} className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50 transition-colors">
                                    <input
                                      type="checkbox"
                                      checked={serviceFilterValues.includes(servico)}
                                      onChange={() => toggleServiceFilter(servico)}
                                    />
                                    <span className="truncate">{servico}</span>
                                  </label>
                                ))}
                              </div>
                              <div className="mt-1 flex gap-1">
                                <button
                                  onClick={() => setServiceFilterValues(serviceOptions)}
                                  className="rounded px-2 py-1 text-[11px] bg-muted/60 hover:bg-muted transition-colors"
                                >
                                  Todos
                                </button>
                                <button
                                  onClick={() => setServiceFilterValues([])}
                                  className="rounded px-2 py-1 text-[11px] bg-muted/60 hover:bg-muted transition-colors"
                                >
                                  Limpar
                                </button>
                              </div>
                              <p className="text-[10px] font-semibold text-muted-foreground mt-2 mb-1">Largura</p>
                              <div className="flex items-center gap-1">
                                <button onClick={() => adjustColumnWidth("servico", -20)} className="rounded px-2 py-1 text-xs bg-muted/60 hover:bg-muted">-</button>
                                <button onClick={() => adjustColumnWidth("servico", 20)} className="rounded px-2 py-1 text-xs bg-muted/60 hover:bg-muted">+</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </th>
                      <th className="text-left px-2 py-3.5 align-top">
                        <div className="relative" data-filter-anchor="true">
                          <button
                            type="button"
                            onClick={() => setHeaderMenuOpen((prev) => (prev === "selimp" ? null : "selimp"))}
                            className="w-full rounded-xl bg-background/80 px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-background hover:shadow-lg"
                          >
                            <span className="inline-flex items-center gap-1">📈 SELIMP {getSortLabel("selimp")}</span>
                          </button>
                          {headerMenuOpen === "selimp" && (
                            <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-44 rounded-xl bg-popover/95 p-2 shadow-[0_16px_45px_-20px_rgba(0,0,0,0.6)] backdrop-blur transition-all">
                              <p className="text-[10px] font-semibold text-muted-foreground mb-1">Ordenação</p>
                              <button onClick={() => setSort("selimp", "asc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted/60">
                                Crescente
                              </button>
                              <button onClick={() => setSort("selimp", "desc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted/60">
                                Decrescente
                              </button>
                              <p className="text-[10px] font-semibold text-muted-foreground mt-2 mb-1">Largura</p>
                              <div className="flex items-center gap-1">
                                <button onClick={() => adjustColumnWidth("selimp", -12)} className="rounded px-2 py-1 text-xs bg-muted/60 hover:bg-muted">-</button>
                                <button onClick={() => adjustColumnWidth("selimp", 12)} className="rounded px-2 py-1 text-xs bg-muted/60 hover:bg-muted">+</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </th>
                      <th className="text-left px-2 py-3.5 align-top">
                        <div className="relative" data-filter-anchor="true">
                          <button
                            type="button"
                            onClick={() => setHeaderMenuOpen((prev) => (prev === "nossa" ? null : "nossa"))}
                            className="w-full rounded-xl bg-background/80 px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-background hover:shadow-lg"
                          >
                            <span className="inline-flex items-center gap-1">📊 DDMX {getSortLabel("nossa")}</span>
                          </button>
                          {headerMenuOpen === "nossa" && (
                            <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-44 rounded-xl bg-popover/95 p-2 shadow-[0_16px_45px_-20px_rgba(0,0,0,0.6)] backdrop-blur transition-all">
                              <p className="text-[10px] font-semibold text-muted-foreground mb-1">Ordenação</p>
                              <button onClick={() => setSort("nossa", "asc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted/60">
                                Crescente
                              </button>
                              <button onClick={() => setSort("nossa", "desc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted/60">
                                Decrescente
                              </button>
                              <p className="text-[10px] font-semibold text-muted-foreground mt-2 mb-1">Largura</p>
                              <div className="flex items-center gap-1">
                                <button onClick={() => adjustColumnWidth("nossa", -12)} className="rounded px-2 py-1 text-xs bg-muted/60 hover:bg-muted">-</button>
                                <button onClick={() => adjustColumnWidth("nossa", 12)} className="rounded px-2 py-1 text-xs bg-muted/60 hover:bg-muted">+</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </th>
                      <th className="text-left px-2 py-3.5 align-top">
                        <div className="relative" data-filter-anchor="true">
                          <button
                            type="button"
                            onClick={() => setHeaderMenuOpen((prev) => (prev === "origem" ? null : "origem"))}
                            className="w-full rounded-xl bg-background/80 px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-background hover:shadow-lg"
                          >
                            <span className="inline-flex items-center gap-1">🔎 Origem {getSortLabel("origem")}</span>
                          </button>
                          {headerMenuOpen === "origem" && (
                            <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-56 rounded-xl bg-popover/95 p-2 shadow-[0_16px_45px_-20px_rgba(0,0,0,0.6)] backdrop-blur transition-all">
                              <p className="text-[10px] font-semibold text-muted-foreground mb-1">Ordenação</p>
                              <button onClick={() => setSort("origem", "asc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted/60">
                                Crescente
                              </button>
                              <button onClick={() => setSort("origem", "desc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted/60">
                                Decrescente
                              </button>
                              <p className="text-[10px] font-semibold text-muted-foreground mt-2 mb-1">Filtrar origens</p>
                              {ORIGEM_VALUES.map((origem) => (
                                <label key={origem} className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50 transition-colors">
                                  <input
                                    type="checkbox"
                                    checked={origemFilterValues.includes(origem)}
                                    onChange={() => toggleOrigemFilterValue(origem)}
                                  />
                                  {origem === "ambos" ? "Ambos" : origem === "somente_selimp" ? "Só SELIMP" : "Só Nossa"}
                                </label>
                              ))}
                              <div className="mt-1 flex gap-1">
                                <button
                                  onClick={() => setOrigemFilterValues([...ORIGEM_VALUES])}
                                  className="rounded px-2 py-1 text-[11px] bg-muted/60 hover:bg-muted transition-colors"
                                >
                                  Todas
                                </button>
                                <button
                                  onClick={() => setOrigemFilterValues([])}
                                  className="rounded px-2 py-1 text-[11px] bg-muted/60 hover:bg-muted transition-colors"
                                >
                                  Limpar
                                </button>
                              </div>
                              <p className="text-[10px] font-semibold text-muted-foreground mt-2 mb-1">Largura</p>
                              <div className="flex items-center gap-1">
                                <button onClick={() => adjustColumnWidth("origem", -12)} className="rounded px-2 py-1 text-xs bg-muted/60 hover:bg-muted">-</button>
                                <button onClick={() => adjustColumnWidth("origem", 12)} className="rounded px-2 py-1 text-xs bg-muted/60 hover:bg-muted">+</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </th>
                    </tr>
                  </thead>
                <tbody>
                  {filteredComparativo.map((row, index) => {
                    const diverge = getDivergenceMagnitude(row.percentual_selimp, row.percentual_nosso) >= 5;
                    const subTag = getSubTag(row.subprefeitura, row.plano);
                    const rowKey = `${row.plano}-${row.origem}`;
                    const isExpanded = expandedPlano === row.plano;
                    const hasDetails = true;
                    const hasAnyDetails =
                      (row.equipamentos && row.equipamentos.length > 0) ||
                      row.frequencia ||
                      row.proxima_programacao ||
                      (row.detalhes_diarios && row.detalhes_diarios.length > 0);
                    return (
                      <Fragment key={rowKey}>
                        <tr
                          key={rowKey}
                          role="button"
                          tabIndex={0}
                          onClick={() => hasDetails && setExpandedPlano((p) => (p === row.plano ? null : row.plano))}
                          onKeyDown={(e) => {
                            if ((e.key === "Enter" || e.key === " ") && hasDetails) {
                              e.preventDefault();
                              setExpandedPlano((p) => (p === row.plano ? null : row.plano));
                            }
                          }}
                          className={`cursor-pointer border-y border-border/40 transition-colors hover:bg-emerald-500/10 ${
                            isExpanded
                              ? "bg-emerald-500/20 ring-1 ring-inset ring-emerald-500/40"
                              : highlightDivergencias && diverge
                              ? "bg-amber-500/10"
                              : index % 2 === 0
                              ? "bg-background/35"
                              : "bg-background/10"
                          } ${!hasDetails ? "cursor-default" : ""}`}
                        >
                          <td className="px-3 py-2 w-8 align-middle">
                            {hasDetails ? (
                              isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )
                            ) : (
                              <span className="w-4 inline-block" />
                            )}
                          </td>
                          <td className="px-3 py-2 font-medium">{row.plano || "-"}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-semibold ${subTag.className}`}>
                              {subTag.sigla}
                            </span>
                          </td>
                          <td className="px-3 py-2 wrap-break-word whitespace-normal leading-snug">
                            {row.tipo_servico || "-"}
                          </td>
                          <td className="px-3 py-2">
                            <PercentualBar value={row.percentual_selimp} compact />
                          </td>
                          <td className="px-3 py-2">
                            <PercentualBar value={row.percentual_nosso} compact />
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${getOrigemBadgeClass(
                                row.origem
                              )}`}
                            >
                              {row.origem === "ambos"
                                ? "Ambos"
                                : row.origem === "somente_selimp"
                                ? "Só SELIMP"
                                : "Só DDMX"}
                            </span>
                          </td>
                        </tr>
                        {isExpanded && hasDetails && (
                          <tr key={`${rowKey}-detail`}>
                            <td colSpan={7} className="bg-emerald-500/5 px-4 py-4 align-top border-b border-emerald-500/20">
                              <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 text-sm">
                                {!hasAnyDetails && (
                                  <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-4 text-amber-800 dark:text-amber-200">
                                    Nenhum despacho registrado no período.
                                  </div>
                                )}
                                {row.equipamentos && row.equipamentos.length > 0 && (
                                  <div className="rounded-xl bg-cyan-500/10 border border-cyan-500/30 p-3 shadow-sm">
                                    <p className="text-xs font-semibold text-cyan-700 dark:text-cyan-300 mb-2 flex items-center gap-1.5">
                                      <Cpu className="h-4 w-4" />
                                      Equipamentos (Placa/Lutocar)
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {row.equipamentos.map((eq) => (
                                        <span
                                          key={eq}
                                          className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 font-mono text-xs font-medium text-cyan-800 dark:text-cyan-200"
                                        >
                                          {eq}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {row.frequencia && (
                                  <div className="rounded-xl bg-blue-500/10 border border-blue-500/30 p-3 shadow-sm relative group">
                                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1 flex items-center gap-1.5">
                                      <Calendar className="h-4 w-4" />
                                      Frequência
                                      {row.cronograma_preview && row.cronograma_preview.length > 0 && (
                                        <span className="inline-flex items-center rounded-full bg-blue-500/20 px-1.5 cursor-help">
                                          <Info className="h-3.5 w-3.5" />
                                        </span>
                                      )}
                                    </p>
                                    <p className="font-medium text-blue-900 dark:text-blue-100">{row.frequencia}</p>
                                    {row.cronograma_preview && row.cronograma_preview.length > 0 && (
                                      <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block w-64 rounded-xl bg-popover border shadow-xl p-3 text-xs">
                                        <p className="font-semibold text-muted-foreground mb-1.5">Prévia cronograma (5 datas)</p>
                                        <div className="flex flex-wrap gap-1">
                                          {row.cronograma_preview.map((d, i) => (
                                            <span key={`${row.plano}-cron-${i}-${d}`} className="rounded bg-blue-500/20 px-2 py-0.5 font-mono">
                                              {d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2/$1")}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {row.proxima_programacao && (
                                  <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/40 p-3 shadow-sm relative group">
                                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 mb-1 flex items-center gap-1.5">
                                      <Activity className="h-4 w-4" />
                                      Próxima programação
                                      {row.cronograma_preview && row.cronograma_preview.length > 0 && (
                                        <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-1.5 cursor-help">
                                          <Info className="h-3.5 w-3.5" />
                                        </span>
                                      )}
                                    </p>
                                    <p className="font-semibold text-emerald-900 dark:text-emerald-100 text-base">
                                      {row.proxima_programacao.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2/$1")}
                                    </p>
                                    {row.cronograma_preview && row.cronograma_preview.length > 0 && (
                                      <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block w-64 rounded-xl bg-popover border shadow-xl p-3 text-xs">
                                        <p className="font-semibold text-muted-foreground mb-1.5">Prévia cronograma (5 datas)</p>
                                        <div className="flex flex-wrap gap-1">
                                          {row.cronograma_preview.map((d, i) => (
                                            <span key={`${row.plano}-cron-${i}-${d}`} className="rounded bg-emerald-500/20 px-2 py-0.5 font-mono">
                                              {d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2/$1")}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {row.detalhes_diarios && row.detalhes_diarios.length > 0 && (
                                  <>
                                    <div className="rounded-xl bg-teal-500/10 border border-teal-500/30 p-3 shadow-sm lg:col-span-2 xl:col-span-3">
                                      <p className="text-xs font-semibold text-teal-700 dark:text-teal-300 mb-2 flex items-center gap-1.5">
                                        <Activity className="h-4 w-4" />
                                        Percentual por dia (SELIMP)
                                      </p>
                                      <div className="h-24 w-full mb-3">
                                        <ResponsiveContainer width="100%" height="100%">
                                          <LineChart
                                            data={[...row.detalhes_diarios].reverse().map((d) => ({
                                              data: d.data.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2"),
                                              pct: d.percentual_selimp ?? 0,
                                            }))}
                                            margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
                                          >
                                            <XAxis dataKey="data" tick={{ fontSize: 10 }} />
                                            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={28} />
                                            <RechartsTooltip formatter={(v: number) => [`${v.toFixed(1)}%`, "% SELIMP"]} />
                                            <Line type="monotone" dataKey="pct" stroke="#14b8a6" strokeWidth={2} dot={{ r: 3 }} />
                                          </LineChart>
                                        </ResponsiveContainer>
                                      </div>
                                    </div>
                                    <div className="rounded-xl bg-slate-500/10 border border-slate-500/30 p-3 shadow-sm lg:col-span-2 xl:col-span-3">
                                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
                                        <BarChart2 className="h-4 w-4" />
                                        Despachos e percentuais
                                      </p>
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-xs">
                                          <thead>
                                            <tr className="border-b border-slate-500/30">
                                              <th className="text-left py-2 px-2">
                                                <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Data</span>
                                              </th>
                                              <th className="text-left py-2 px-2">
                                                <span className="flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Esperado</span>
                                              </th>
                                              <th className="text-left py-2 px-2">% SELIMP</th>
                                              <th className="text-left py-2 px-2">% DDMX</th>
                                              <th className="text-left py-2 px-2">
                                                <span className="flex items-center gap-1"><Truck className="h-3.5 w-3.5" /> D. Selimp</span>
                                              </th>
                                              <th className="text-left py-2 px-2">
                                                <span className="flex items-center gap-1"><Package className="h-3.5 w-3.5" /> D. DDMX</span>
                                              </th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {row.detalhes_diarios.map((d) => {
                                              const pctSel = toNum(d.percentual_selimp);
                                              const rowBg =
                                                pctSel != null && pctSel >= 90
                                                  ? "bg-emerald-500/5"
                                                  : pctSel != null && pctSel >= 60
                                                  ? "bg-amber-500/5"
                                                  : pctSel != null && pctSel > 0
                                                  ? "bg-red-500/5"
                                                  : "bg-transparent";
                                              return (
                                                <tr key={d.data} className={`border-b border-slate-500/20 ${rowBg}`}>
                                                  <td className="py-2 px-2 font-mono font-medium">
                                                    <span className="flex items-center gap-1.5">
                                                      <Calendar className="h-3.5 w-3.5 text-slate-500" />
                                                      {d.data.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2/$1")}
                                                    </span>
                                                  </td>
                                                  <td className="py-2 px-2">
                                                    {d.esperado ? (
                                                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">
                                                        <Check className="h-3.5 w-3.5" /> Sim
                                                      </span>
                                                    ) : (
                                                      <span className="text-muted-foreground">—</span>
                                                    )}
                                                  </td>
                                                  <td className="py-2 px-2">
                                                    <PercentualBar value={d.percentual_selimp} compact />
                                                  </td>
                                                  <td className="py-2 px-2">
                                                    <PercentualBar value={d.percentual_nosso} compact />
                                                  </td>
                                                  <td className="py-2 px-2">
                                                    <span className="inline-flex items-center gap-1 font-medium">
                                                      <Truck className="h-3.5 w-3.5 text-blue-600" />
                                                      {d.despachos_selimp}
                                                    </span>
                                                  </td>
                                                  <td className="py-2 px-2">
                                                    <span className="inline-flex items-center gap-1 font-medium">
                                                      <Package className="h-3.5 w-3.5 text-violet-600" />
                                                      {d.despachos_nosso}
                                                    </span>
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {!loading && filteredComparativo.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                        Sem dados para os filtros selecionados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </MainLayout>
  );
}
