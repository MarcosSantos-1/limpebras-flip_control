"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { format, endOfMonth, startOfMonth, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Activity, AlertTriangle, BarChart2, Battery, BatteryWarning, Calendar, Check, ChevronDown, ChevronRight, ChevronUp, Cpu, Info, Package, PanelBottomClose, PanelBottomOpen, Plus, RotateCcw, Sparkles, TrendingUp, Truck, X } from "lucide-react";
import { MainLayout } from "@/components/layout/main-layout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiService, type IptPreviewResponse } from "@/lib/api";
import { useIptData } from "@/lib/use-ipt-data";
import { getSortKey, getSubFromPlano } from "@/lib/ipt-utils";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
} from "chart.js";

const IptBar = dynamic(() => import("react-chartjs-2").then((mod) => mod.Bar), { ssr: false });

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

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

const getOrigemBadgeClass = (origem: "ambos" | "somente_selimp" | "somente_nosso" | "sem_despacho") => {
  if (origem === "sem_despacho") return "border-muted-foreground/40 bg-muted/40 text-muted-foreground";
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
const ORIGEM_VALUES = ["ambos", "somente_selimp", "somente_nosso", "sem_despacho"] as const;
type OrigemValue = (typeof ORIGEM_VALUES)[number];
const MIN_COL_WIDTH = 72;
const MAX_COL_WIDTH = 520;
type TableScope = "dia_anterior" | "periodo" | "todos";

export default function IPTPage() {
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [tableScope, setTableScope] = useState<TableScope>("dia_anterior");
  const [tablePeriodRange, setTablePeriodRange] = useState<{ inicio: Date; fim: Date } | null>(null);
  const [subprefeituraFilter, setSubprefeituraFilter] = useState("all");
  const [baseDadosCardFilter, setBaseDadosCardFilter] = useState<"inativos" | "obs_global" | "obs_diaria" | null>(null);
  const [origemFilter, setOrigemFilter] = useState<"all" | "ambos" | "somente_selimp" | "somente_nosso" | "sem_despacho">("all");
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
  const [modalBateriaOpen, setModalBateriaOpen] = useState(false);
  const [modalCruzamentoOpen, setModalCruzamentoOpen] = useState(false);
  const [iptFormulaTooltip, setIptFormulaTooltip] = useState(false);
  const [diagnosticoOpen, setDiagnosticoOpen] = useState(false);
  const [diagnosticoData, setDiagnosticoData] = useState<{
    contagem_por_tipo?: Array<{ file_type: string; total: number; ultimo: string | null }>;
    ddmx_amostra?: Array<Record<string, unknown>>;
    selimp_amostra?: Array<Record<string, unknown>>;
  } | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<TableColumnKey, number>>({
    plano: 170,
    sub: 90,
    servico: 350,
    selimp: 130,
    nossa: 120,
    origem: 130,
  });
  const [modalObsGlobalOpen, setModalObsGlobalOpen] = useState(false);
  const [modalObsGlobalSetor, setModalObsGlobalSetor] = useState<string | null>(null);
  const [modalObsGlobalTitulo, setModalObsGlobalTitulo] = useState("");
  const [modalObsGlobalDescricao, setModalObsGlobalDescricao] = useState("");
  const [modalObsDiariaOpen, setModalObsDiariaOpen] = useState(false);
  const [modalObsDiariaSetor, setModalObsDiariaSetor] = useState<string | null>(null);
  const [modalObsDiariaData, setModalObsDiariaData] = useState<string | null>(null);
  const [modalObsDiariaTitulo, setModalObsDiariaTitulo] = useState("");
  const [modalObsDiariaDescricao, setModalObsDiariaDescricao] = useState("");
  const [obsGlobalFilter, setObsGlobalFilter] = useState<"all" | "com" | "sem">("all");
  const [obsDiariaFilter, setObsDiariaFilter] = useState<"all" | "com" | "sem">("all");
  const [bateriaAlertaFilter, setBateriaAlertaFilter] = useState<"all" | "com" | "sem">("all");

  const { previewCards: iptPreviewCards, previewTable: iptPreviewTable, observacoes, kpis: kpisData, isLoading: loading, mutate: loadData } = useIptData(
    selectedMonth,
    tableScope,
    tablePeriodRange,
    subprefeituraFilter
  );

  const iptCard = useMemo(
    () => ({
      valor: kpisData?.indicadores?.ipt?.valor,
      pontuacao: kpisData?.indicadores?.ipt?.pontuacao,
    }),
    [kpisData]
  );

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
    const values = [
      ...(iptPreviewCards?.subprefeituras ?? []),
      ...(iptPreviewTable?.subprefeituras ?? []),
    ].map((item) => item.subprefeitura).filter(Boolean);
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [iptPreviewTable]);

  const sourceRows = useMemo(
    () =>
      (iptPreviewTable?.itens ?? iptPreviewTable?.comparativo?.itens ?? []) as Array<{
        plano: string;
        subprefeitura: string;
        tipo_servico: string;
        percentual_selimp: number | null;
        percentual_nosso: number | null;
        origem: "ambos" | "somente_selimp" | "somente_nosso";
        despachos_selimp?: number;
        equipamentos?: string[];
        bateria_por_equipamento?: Record<string, { status_bateria: string; bateria?: string }>;
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
    [iptPreviewTable]
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
    for (const row of iptPreviewTable?.mesclados ?? []) {
      const key = row.plano?.trim();
      if (!key) continue;
      const previous = map.get(key);
      // Se em algum registro o plano aparece ativo, consideramos ativo.
      map.set(key, Boolean(previous) || Boolean(row.plano_ativo));
    }
    return map;
  }, [iptPreviewTable]);

  const filteredComparativo = useMemo(() => {
    const rows = sourceRows;
    const filtered = rows.filter((row) => {
      if (subprefeituraFilter !== "all" && row.subprefeitura !== subprefeituraFilter) return false;
      const origemEfetiva = row.percentual_selimp == null && row.percentual_nosso == null ? "sem_despacho" : row.origem;
      if (origemFilter !== "all" && origemEfetiva !== origemFilter) return false;
      if (origemFilterValues.length > 0 && !origemFilterValues.includes(origemEfetiva as OrigemValue)) return false;
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
      if (baseDadosCardFilter === "inativos") {
        const inativoSelimp = (row.percentual_selimp == null || row.percentual_selimp === 0) && (row.despachos_selimp ?? 0) === 0;
        if (!inativoSelimp) return false;
      }
      if (baseDadosCardFilter === "obs_global") {
        if (!observacoes.globais[row.plano]) return false;
      }
      if (baseDadosCardFilter === "obs_diaria") {
        if (!observacoes.diarias[row.plano] || Object.keys(observacoes.diarias[row.plano]).length === 0) return false;
      }
      const temObsGlobal = Boolean(observacoes.globais[row.plano]);
      if (obsGlobalFilter === "com" && !temObsGlobal) return false;
      if (obsGlobalFilter === "sem" && temObsGlobal) return false;
      const temObsDiaria = Boolean(observacoes.diarias[row.plano] && Object.keys(observacoes.diarias[row.plano]).length > 0);
      if (obsDiariaFilter === "com" && !temObsDiaria) return false;
      if (obsDiariaFilter === "sem" && temObsDiaria) return false;
      const temBateriaAlerta = Boolean(
        row.bateria_por_equipamento &&
        Object.values(row.bateria_por_equipamento).some((b) => /critico|baixo|descarregad|alerta|medio|aten/i.test(b.status_bateria))
      );
      if (bateriaAlertaFilter === "com" && !temBateriaAlerta) return false;
      if (bateriaAlertaFilter === "sem" && temBateriaAlerta) return false;
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
        const aOrig = (a.percentual_selimp == null && a.percentual_nosso == null ? "sem_despacho" : a.origem) as string;
        const bOrig = (b.percentual_selimp == null && b.percentual_nosso == null ? "sem_despacho" : b.origem) as string;
        sortBase = aOrig.localeCompare(bOrig, "pt-BR");
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
    baseDadosCardFilter,
    subprefeituraFilter,
    tableSort,
    zeroFilter,
    subSiglaFilter,
    serviceFilterValues,
    observacoes.globais,
    observacoes.diarias,
    obsGlobalFilter,
    obsDiariaFilter,
    bateriaAlertaFilter,
  ]);

  const comparativoInsights = useMemo(() => {
    const rows = iptPreviewTable?.comparativo?.itens ?? [];
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
  }, [iptPreviewTable, planoAtivoMap]);

  const origemDistribution = useMemo(() => {
    const total = iptPreviewTable?.comparativo?.total_linhas ?? 0;
    if (!total) return { ambos: 0, somenteSelimp: 0, somenteNosso: 0 };
    return {
      ambos: ((total - (iptPreviewTable?.comparativo?.somente_selimp ?? 0) - (iptPreviewTable?.comparativo?.somente_nosso ?? 0)) / total) * 100,
      somenteSelimp: ((iptPreviewTable?.comparativo?.somente_selimp ?? 0) / total) * 100,
      somenteNosso: ((iptPreviewTable?.comparativo?.somente_nosso ?? 0) / total) * 100,
    };
  }, [iptPreviewTable]);

  const topSubprefeituras = useMemo(() => {
    const list = [...(iptPreviewCards?.subprefeituras ?? [])];
    list.sort((a, b) => (b.media_execucao ?? -1) - (a.media_execucao ?? -1));
    return list;
  }, [iptPreviewCards]);

  const topServicos = useMemo(() => {
    const list = [...(iptPreviewCards?.servicos ?? [])];
    list.sort((a, b) => (b.media_execucao ?? -1) - (a.media_execucao ?? -1));
    return list;
  }, [iptPreviewCards]);

  /** Itens do comparativo no escopo do mês (cards) - para métricas do card Subprefeituras */
  const cardsComparativoItens = useMemo(
    () => (iptPreviewCards?.comparativo?.itens ?? []) as Array<{
      subprefeitura: string;
      percentual_selimp: number | null;
      percentual_nosso: number | null;
    }>,
    [iptPreviewCards]
  );

  /** Percentual de execução por plano (nosso primeiro, selimp fallback) */
  const getPercentualExecucao = (row: { percentual_nosso?: number | null; percentual_selimp?: number | null }) => {
    const v = row.percentual_nosso ?? row.percentual_selimp ?? null;
    return v != null && !Number.isNaN(v) ? v : null;
  };

  /** Média de execução sem zerados e com zerados (global e por sub) - para o card Subprefeituras */
  const subprefeituraInsights = useMemo(() => {
    const bySub = new Map<
      string,
      { comZerados: number[]; semZerados: number[]; totalPlanos: number; zerados: number }
    >();
    for (const row of cardsComparativoItens) {
      const sub = row.subprefeitura || "Não informado";
      if (!bySub.has(sub)) {
        bySub.set(sub, { comZerados: [], semZerados: [], totalPlanos: 0, zerados: 0 });
      }
      const entry = bySub.get(sub)!;
      const pct = getPercentualExecucao(row);
      entry.totalPlanos += 1;
      if (pct != null) {
        entry.comZerados.push(pct);
        if (pct > 0) entry.semZerados.push(pct);
        else entry.zerados += 1;
      }
    }
    const result: Array<{
      subprefeitura: string;
      mediaComZerados: number | null;
      mediaSemZerados: number | null;
      totalPlanos: number;
      zerados: number;
    }> = [];
    bySub.forEach((val, sub) => {
      const mediaCom =
        val.comZerados.length > 0
          ? val.comZerados.reduce((a, b) => a + b, 0) / val.comZerados.length
          : null;
      const mediaSem =
        val.semZerados.length > 0
          ? val.semZerados.reduce((a, b) => a + b, 0) / val.semZerados.length
          : null;
      result.push({
        subprefeitura: sub,
        mediaComZerados: mediaCom,
        mediaSemZerados: mediaSem,
        totalPlanos: val.totalPlanos,
        zerados: val.zerados,
      });
    });
    return result.sort((a, b) => (b.mediaSemZerados ?? -1) - (a.mediaSemZerados ?? -1));
  }, [cardsComparativoItens]);

  /** Médias globais (considerando filtro de subprefeitura já aplicado no backend) */
  const globalInsights = useMemo(() => {
    const comZerados: number[] = [];
    const semZerados: number[] = [];
    for (const row of cardsComparativoItens) {
      const pct = getPercentualExecucao(row);
      if (pct != null) {
        comZerados.push(pct);
        if (pct > 0) semZerados.push(pct);
      }
    }
    return {
      mediaComZerados:
        comZerados.length > 0 ? comZerados.reduce((a, b) => a + b, 0) / comZerados.length : null,
      mediaSemZerados:
        semZerados.length > 0 ? semZerados.reduce((a, b) => a + b, 0) / semZerados.length : null,
      totalPlanos: cardsComparativoItens.length,
      zerados: comZerados.filter((x) => x <= 0).length,
    };
  }, [cardsComparativoItens]);

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
    setBaseDadosCardFilter(null);
    setOrigemFilter("all");
    setZeroFilter("all");
    setSubprefeituraFilter("all");
    setSubSiglaFilter([...SUB_SIGLAS]);
    setServiceFilterValues(serviceOptions);
    setOrigemFilterValues([...ORIGEM_VALUES]);
    setObsGlobalFilter("all");
    setObsDiariaFilter("all");
    setBateriaAlertaFilter("all");
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
              Análise macro e conferência SELIMP x base interna.
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-card/70 backdrop-blur p-4 shadow-lg">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3 items-end">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Mês de referência</p>
              <input
                type="month"
                value={format(selectedMonth, "yyyy-MM")}
                max={format(new Date(), "yyyy-MM")}
                onChange={(e) => {
                  if (!e.target.value) return;
                  const [year, month] = e.target.value.split("-");
                  setSelectedMonth(startOfMonth(new Date(Number(year), Number(month) - 1, 1)));
                }}
                className="h-10 rounded-xl bg-background/90 px-3 text-sm w-full shadow-inner ring-1 ring-white/10 focus:ring-2 focus:ring-emerald-500/60 outline-none"
              />
            </div>
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
              className="h-10 rounded-xl px-4 text-sm font-medium text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:opacity-90 transition-all shadow-[0_8px_20px_-10px_rgba(16,185,129,0.9)] inline-flex items-center justify-center gap-2"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <polyline points="21 3 21 9 15 9" />
              </svg>
              Atualizar
            </button>
            <button
              type="button"
              onClick={async () => {
                setDiagnosticoOpen(true);
                try {
                  const data = await apiService.getIptDiagnostico();
                  setDiagnosticoData(data);
                } catch {
                  setDiagnosticoData(null);
                }
              }}
              className="h-10 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:text-foreground border border-border hover:bg-muted/50 transition-all inline-flex items-center gap-2"
              title="Diagnóstico das importações DDMX/SELIMP"
            >
              <Cpu className="h-4 w-4" />
              Diagnóstico
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card className="xl:col-span-1 border-0 shadow-[0_20px_50px_-30px_rgba(16,185,129,0.7)] bg-linear-to-br from-emerald-500/15 via-card to-card">
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">IPT (Cálculo Automático)</CardTitle>
                <div
                  className="relative"
                  onMouseEnter={() => setIptFormulaTooltip(true)}
                  onMouseLeave={() => setIptFormulaTooltip(false)}
                >
                  <Info className="h-4 w-4 text-zinc-400 hover:text-emerald-500 cursor-help transition-colors shrink-0" />
                  {iptFormulaTooltip && (
                    <div className="absolute left-0 top-6 z-50 w-[min(95vw,96rem)] max-w-[96rem] rounded-lg bg-zinc-900 dark:bg-zinc-800 p-4 text-xs text-white shadow-xl border border-zinc-700">
                      <div className="font-bold mb-2 text-sm text-emerald-400">IPT – Algoritmo SELIMP</div>
                      <div className="mb-3 p-2 bg-zinc-800 dark:bg-zinc-900 rounded border border-zinc-700">
                        <div className="text-zinc-400 text-xs mb-1">Fórmula completa:</div>
                        <div className="font-mono text-xs text-emerald-300 leading-relaxed">
                          PF = 0.7 × min(Q̄ + min(σ, 0.08), 1) + 0.3 × min(A/C, 1)
                          <br />
                          <span className="text-zinc-400">onde C = P×R/F , Q̄ = (1/N)×ΣQᵢ , N = A−Z</span>
                        </div>
                      </div>
                      <div className="text-zinc-400 text-xs">70% Qualidade + 30% Cobertura. Fonte: planilha SELIMP.</div>
                    </div>
                  )}
                </div>
              </div>
              <CardDescription>Percentual Médio e Pontuação do ADC.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl bg-background/70 p-4 shadow-sm transition-all hover:shadow-md">
                <p className="text-xs text-muted-foreground">IPT (%)</p>
                <p className="text-3xl font-bold text-emerald-600">{iptCard.valor != null ? `${iptCard.valor.toFixed(1)}%` : "--"}</p>
                <div className="mt-3 h-2 rounded-full bg-emerald-200/40 dark:bg-emerald-900/20">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all"
                    style={{ width: `${clamp(iptCard.valor ?? 0)}%` }}
                  />
                </div>
              </div>
              <div className="rounded-xl bg-background/70 p-4 shadow-sm transition-all hover:shadow-md">
                <p className="text-xs text-muted-foreground">Pontuação IPT</p>
                <p className="text-3xl font-bold text-teal-600">{iptCard.pontuacao ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-2">Faixa de pontuação conforme parâmetros do ADC.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="xl:col-span-2 border-0 shadow-[0_20px_50px_-30px_rgba(16,185,129,0.6)]">
            <CardHeader>
              <CardTitle className="text-base">Medições Automáticas</CardTitle>
              <CardDescription>Indicadores operacionais gerados automaticamente da base consolidada.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex flex-col gap-3">
                <div className="rounded-xl bg-indigo-500/10 p-3 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg">
                  <p className="text-xs text-muted-foreground">Planos Despachados (SELIMP)</p>
                  <p className="text-xl pt-2 font-bold">{iptPreviewCards?.resumo.total_planos_despachados ?? iptPreviewCards?.resumo.total_planos ?? 0}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Planos encerrados na planilha</p>
                </div>
                <div className="rounded-xl bg-cyan-500/10 p-3 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg">
                  <p className="text-xs text-muted-foreground">Percentual Médio (DDMX)</p>
                  <p className="text-xl font-bold text-cyan-600">{pct(iptPreviewCards?.resumo.percentual_medio_ddmx)}</p>
                  <div className="mt-2 h-1.5 rounded-full bg-cyan-200/40 dark:bg-cyan-900/20">
                    <div
                      className="h-1.5 rounded-full bg-cyan-500 transition-all"
                      style={{ width: `${clamp(iptPreviewCards?.resumo.percentual_medio_ddmx ?? 0)}%` }}
                    />
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalBateriaOpen(true)}
                className="min-h-[140px] rounded-xl bg-violet-500/10 p-4 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg hover:bg-violet-500/20 border border-violet-500/20 hover:border-violet-500/40 text-left group flex flex-col justify-center"
              >
                <div className="flex items-center gap-2">
                  <Battery className="h-6 w-6 text-violet-600 dark:text-violet-400 group-hover:scale-110 transition-transform" />
                  <span className="text-base font-semibold text-violet-700 dark:text-violet-300">Análise de Bateria</span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">Clique para abrir. Status da bateria por setor nos detalhes expandidos.</p>
              </button>
              <button
                type="button"
                onClick={() => setModalCruzamentoOpen(true)}
                className="min-h-[140px] rounded-xl bg-indigo-500/10 p-4 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg hover:bg-indigo-500/20 border border-indigo-500/20 hover:border-indigo-500/40 text-left group flex flex-col justify-center"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="h-6 w-6 text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform" />
                  <span className="text-base font-semibold text-indigo-700 dark:text-indigo-300">Cruzamento Inteligente</span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">Clique para abrir. Espaço para mais cards e informações do modal.</p>
              </button>
            </CardContent>
          </Card>

          <Dialog open={modalBateriaOpen} onOpenChange={setModalBateriaOpen}>
            <DialogContent className="max-w-[94vw] w-full max-h-[92vh] overflow-y-auto p-8 animate-in fade-in zoom-in-95 duration-300">
              <DialogHeader className="pb-6">
                <DialogTitle className="text-2xl flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded-full bg-violet-500" />
                  Análise de Bateria
                </DialogTitle>
                <DialogDescription className="text-base">
                  Guia para implementação — lembrete de especificação
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-6 text-sm">
                <p className="text-muted-foreground italic">
                  Problema real: &quot;Estamos perdendo IPT por causa de bateria? Quais baterias?&quot; — mensurar e melhorar gestão de carga, eficiência e estratégias em relação às baterias dos módulos.
                </p>
                <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-5 space-y-4">
                  <h4 className="font-semibold text-violet-700 dark:text-violet-300">Gráficos a implementar</h4>
                  <ul className="space-y-2 text-muted-foreground">
                    <li className="flex gap-2">
                      <span className="text-violet-500">📈</span>
                      <span><strong>Evolução de bateria média por módulo</strong> — linha temporal</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-violet-500">📊</span>
                      <span><strong>Percentual de módulos com bateria crítica</strong> (&lt;20%)</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-violet-500">📋</span>
                      <span><strong>Ranking de módulos</strong> com mais dias com bateria baixa</span>
                    </li>
                  </ul>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={modalCruzamentoOpen} onOpenChange={setModalCruzamentoOpen}>
            <DialogContent className="max-w-[94vw] w-full max-h-[92vh] overflow-y-auto p-8 animate-in fade-in zoom-in-95 duration-300">
              <DialogHeader className="pb-6">
                <DialogTitle className="text-2xl flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded-full bg-indigo-500" />
                  Cruzamento Inteligente
                </DialogTitle>
                <DialogDescription className="text-base">
                  Guia para implementação — lembrete de especificação
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-6 text-sm">
                <p className="text-muted-foreground italic">
                  Objetivo: provar de forma técnica se o problema é operacional ou se existe também uma falha na relação de dados da SELIMP/ DDMX — ex.: módulo com bateria &lt;30% tem IPT médio 70%, módulo &gt;80% bateria tem IPT médio 95%.
                </p>
                <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-5 space-y-4">
                  <h4 className="font-semibold text-indigo-700 dark:text-indigo-300">Tabela a implementar</h4>
                  <div className="font-mono text-xs bg-background/80 dark:bg-background/40 rounded-lg p-4 overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="py-2 pr-4">Serviço</th>
                          <th className="py-2 pr-4">% IPT</th>
                          <th className="py-2 pr-4">% Bateria média</th>
                          <th className="py-2">Correlação simples</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-border/50">
                          <td className="py-2 pr-4">Varrição</td>
                          <td className="py-2 pr-4">70%</td>
                          <td className="py-2 pr-4">&lt;30%</td>
                          <td className="py-2">—</td>
                        </tr>
                        <tr className="border-b border-border/50">
                          <td className="py-2 pr-4">Varrição</td>
                          <td className="py-2 pr-4">95%</td>
                          <td className="py-2 pr-4">&gt;80%</td>
                          <td className="py-2">—</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={diagnosticoOpen} onOpenChange={setDiagnosticoOpen}>
            <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Diagnóstico das importações IPT</DialogTitle>
                <DialogDescription>
                  Contagens e amostra dos dados DDMX e SELIMP no banco. Use para verificar se as importações estão refletindo.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                {diagnosticoData?.contagem_por_tipo && (
                  <div>
                    <p className="text-sm font-medium mb-2">Contagem por tipo</p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {diagnosticoData.contagem_por_tipo.map((r) => (
                        <div key={r.file_type} className="flex justify-between rounded bg-muted/50 px-3 py-2">
                          <span className="font-mono">{r.file_type}</span>
                          <span className="tabular-nums">{r.total} reg.</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {diagnosticoData?.ddmx_amostra && diagnosticoData.ddmx_amostra.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">DDMX (amostra) — rota, data_referencia, pct</p>
                    <pre className="text-xs bg-muted/30 p-3 rounded overflow-x-auto max-h-40">{JSON.stringify(diagnosticoData.ddmx_amostra, null, 2)}</pre>
                  </div>
                )}
                {diagnosticoData?.selimp_amostra && diagnosticoData.selimp_amostra.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">SELIMP (amostra) — plano, data_referencia, pct, status</p>
                    <pre className="text-xs bg-muted/30 p-3 rounded overflow-x-auto max-h-40">{JSON.stringify(diagnosticoData.selimp_amostra, null, 2)}</pre>
                  </div>
                )}
                {diagnosticoData && (!diagnosticoData.ddmx_amostra?.length && !diagnosticoData.selimp_amostra?.length) && (
                  <p className="text-sm text-amber-600">Sem dados DDMX ou SELIMP no banco. Verifique as importações na página de Upload.</p>
                )}
                {!diagnosticoData && diagnosticoOpen && <p className="text-sm text-muted-foreground">Carregando…</p>}
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={modalObsGlobalOpen} onOpenChange={(open) => { setModalObsGlobalOpen(open); if (!open) setModalObsGlobalSetor(null); }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Observação global</DialogTitle>
                <DialogDescription>Marca o setor com um aviso que aparece em todos os despachos. Ex.: setores incorretos na SELIMP.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Setor</label>
                  <p className="font-mono text-sm py-1">{modalObsGlobalSetor ?? "—"}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Título</label>
                  <input
                    value={modalObsGlobalTitulo}
                    onChange={(e) => setModalObsGlobalTitulo(e.target.value)}
                    placeholder="Ex.: Setor incorreto na SELIMP"
                    className="w-full mt-1 h-9 rounded-lg border bg-background px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Descrição (opcional)</label>
                  <textarea
                    value={modalObsGlobalDescricao}
                    onChange={(e) => setModalObsGlobalDescricao(e.target.value)}
                    placeholder="Detalhes da observação..."
                    rows={3}
                    className="w-full mt-1 rounded-lg border bg-background px-3 py-2 text-sm resize-none"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setModalObsGlobalOpen(false)} className="px-3 py-1.5 rounded-lg border text-sm">Cancelar</button>
                  <button
                    onClick={async () => {
                      if (!modalObsGlobalSetor || !modalObsGlobalTitulo.trim()) return;
                      await apiService.createIptObservacaoGlobal(modalObsGlobalSetor, modalObsGlobalTitulo.trim(), modalObsGlobalDescricao.trim() || undefined);
                      setModalObsGlobalOpen(false);
                      loadData();
                    }}
                    disabled={!modalObsGlobalTitulo.trim()}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-50"
                  >
                    OK
                  </button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={modalObsDiariaOpen} onOpenChange={(open) => { setModalObsDiariaOpen(open); if (!open) { setModalObsDiariaSetor(null); setModalObsDiariaData(null); } }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Observação diária</DialogTitle>
                <DialogDescription>Justificativa para o dia específico. Ex.: falha na liberação, manutenção, acidente.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Setor / Data</label>
                  <p className="font-mono text-sm py-1">{modalObsDiariaSetor ?? "—"} · {modalObsDiariaData ? modalObsDiariaData.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2/$1") : "—"}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Título</label>
                  <input
                    value={modalObsDiariaTitulo}
                    onChange={(e) => setModalObsDiariaTitulo(e.target.value)}
                    placeholder="Ex.: Falha na liberação"
                    className="w-full mt-1 h-9 rounded-lg border bg-background px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Descrição (opcional)</label>
                  <textarea
                    value={modalObsDiariaDescricao}
                    onChange={(e) => setModalObsDiariaDescricao(e.target.value)}
                    placeholder="Detalhes..."
                    rows={3}
                    className="w-full mt-1 rounded-lg border bg-background px-3 py-2 text-sm resize-none"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setModalObsDiariaOpen(false)} className="px-3 py-1.5 rounded-lg border text-sm">Cancelar</button>
                  <button
                    onClick={async () => {
                      if (!modalObsDiariaSetor || !modalObsDiariaData || !modalObsDiariaTitulo.trim()) return;
                      await apiService.createIptObservacaoDiaria(modalObsDiariaSetor, modalObsDiariaData, modalObsDiariaTitulo.trim(), modalObsDiariaDescricao.trim() || undefined);
                      setModalObsDiariaOpen(false);
                      loadData();
                    }}
                    disabled={!modalObsDiariaTitulo.trim()}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-50"
                  >
                    OK
                  </button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Subprefeituras (ativos)</CardTitle>
                  <CardDescription>Execução média por subprefeitura no mês selecionado.</CardDescription>
                </div>
                <span className="text-xs font-medium text-muted-foreground bg-muted/50 px-2 py-1 rounded-full">
                  {topSubprefeituras.length} subprefeituras
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {topSubprefeituras.map((item) => (
                  <div
                    key={item.subprefeitura}
                    className="group rounded-xl bg-background/60 p-3 shadow-sm transition-all hover:shadow-md hover:bg-emerald-500/5 hover:ring-1 hover:ring-emerald-500/20 cursor-default"
                    title={`${item.subprefeitura || "Não informado"}: ${pct(item.media_execucao)} de execução média | ${item.quantidade_planos} planos`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-sm group-hover:text-emerald-700 dark:group-hover:text-emerald-300">
                        {item.subprefeitura || "Não informado"}
                      </span>
                      <span className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400 shrink-0">
                        {pct(item.media_execucao)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-3 rounded-full bg-muted/50 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500"
                          style={{ width: `${clamp(item.media_execucao ?? 0)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 w-16 text-right">
                        {item.quantidade_planos} planos
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {!loading && topSubprefeituras.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">Sem dados para o período.</p>
              )}

              {/* Insights e gráficos dinâmicos */}
              {topSubprefeituras.length > 0 && (
                <div className="mt-8 pt-8 border-t border-border space-y-8">
                  {/* Métricas globais */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="rounded-xl bg-emerald-500/10 dark:bg-emerald-500/15 p-4 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg border border-emerald-500/20 hover:border-emerald-500/40">
                      <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 mb-2 uppercase tracking-wider">
                        Média exec. (sem zerados)
                      </p>
                      <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
                        {globalInsights.mediaSemZerados != null
                          ? `${globalInsights.mediaSemZerados.toFixed(1)}%`
                          : "--"}
                      </p>
                    </div>
                    <div className="rounded-xl bg-teal-500/10 dark:bg-teal-500/15 p-4 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg border border-teal-500/20 hover:border-teal-500/40">
                      <p className="text-xs font-medium text-teal-700 dark:text-teal-400 mb-2 uppercase tracking-wider">
                        Média exec. (com zerados)
                      </p>
                      <p className="text-2xl font-bold text-teal-700 dark:text-teal-300 tabular-nums">
                        {globalInsights.mediaComZerados != null
                          ? `${globalInsights.mediaComZerados.toFixed(1)}%`
                          : "--"}
                      </p>
                    </div>
                    <div className="rounded-xl bg-amber-500/10 dark:bg-amber-500/15 p-4 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg border border-amber-500/20 hover:border-amber-500/40">
                      <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-2 uppercase tracking-wider">
                        Planos zerados
                      </p>
                      <p className="text-2xl font-bold text-amber-700 dark:text-amber-300 tabular-nums">
                        {globalInsights.zerados}
                      </p>
                    </div>
                    <div className="rounded-xl bg-slate-500/10 dark:bg-slate-500/15 p-4 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg border border-slate-500/20 hover:border-slate-500/40">
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-400 mb-2 uppercase tracking-wider">
                        Total planos
                      </p>
                      <p className="text-2xl font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                        {globalInsights.totalPlanos}
                      </p>
                    </div>
                  </div>

                  {/* Gráfico barras: média sem zerados vs com zerados por sub */}
                  {subprefeituraInsights.length > 0 && (
                    <div className="rounded-xl bg-background/60 p-5 shadow-sm border border-border space-y-4">
                      <p className="text-sm font-semibold text-foreground">Execução média por subprefeitura</p>
                      <div className="h-64 min-h-[200px]">
                        <IptBar
                          data={{
                            labels: subprefeituraInsights.map((s) =>
                              s.subprefeitura.length > 12 ? s.subprefeitura.slice(0, 11) + "…" : s.subprefeitura
                            ),
                            datasets: [
                              {
                                label: "Média sem zerados (%)",
                                data: subprefeituraInsights.map((s) => s.mediaSemZerados ?? 0),
                                backgroundColor: "rgba(16, 185, 129, 0.6)",
                                borderColor: "rgb(16, 185, 129)",
                                borderWidth: 1,
                                borderRadius: 4,
                              },
                              {
                                label: "Média com zerados (%)",
                                data: subprefeituraInsights.map((s) => s.mediaComZerados ?? 0),
                                backgroundColor: "rgba(20, 184, 166, 0.6)",
                                borderColor: "rgb(20, 184, 166)",
                                borderWidth: 1,
                                borderRadius: 4,
                              },
                            ],
                          }}
                          options={
                            {
                              responsive: true,
                              maintainAspectRatio: false,
                              plugins: {
                                legend: { position: "top" as const },
                                tooltip: {
                                  callbacks: {
                                    label: (ctx) => `${ctx.dataset.label}: ${(ctx.parsed.y as number).toFixed(1)}%`,
                                  },
                                },
                              },
                              scales: {
                                x: {
                                  grid: { display: false },
                                  ticks: { maxRotation: 45, minRotation: 35, font: { size: 10 } },
                                },
                                y: {
                                  min: 0,
                                  max: 100,
                                  ticks: { callback: (v) => `${v}%` },
                                },
                              },
                            } as ChartOptions<"bar">
                          }
                        />
                      </div>
                    </div>
                  )}

                  {/* Gráfico de planos zerados por sub */}
                  {subprefeituraInsights.some((s) => s.zerados > 0) && (
                    <div className="rounded-xl bg-background/60 p-5 shadow-sm border border-border space-y-4">
                      <p className="text-sm font-semibold text-foreground">Planos com execução zerada por sub</p>
                      <div className="h-52 min-h-[160px]">
                        <IptBar
                          data={{
                            labels: subprefeituraInsights.map((s) =>
                              s.subprefeitura.length > 12 ? s.subprefeitura.slice(0, 11) + "…" : s.subprefeitura
                            ),
                            datasets: [
                              {
                                label: "Planos zerados",
                                data: subprefeituraInsights.map((s) => s.zerados),
                                backgroundColor: "rgba(245, 158, 11, 0.6)",
                                borderColor: "rgb(245, 158, 11)",
                                borderWidth: 1,
                                borderRadius: 4,
                              },
                            ],
                          }}
                          options={
                            {
                              responsive: true,
                              maintainAspectRatio: false,
                              plugins: {
                                legend: { display: false },
                                tooltip: {
                                  callbacks: {
                                    label: (ctx) => `Zerados: ${ctx.parsed.y}`,
                                  },
                                },
                              },
                              scales: {
                                x: {
                                  grid: { display: false },
                                  ticks: { maxRotation: 45, minRotation: 35, font: { size: 10 } },
                                },
                                y: { beginAtZero: true, ticks: { stepSize: 1 } },
                              },
                            } as ChartOptions<"bar">
                          }
                        />
                      </div>
                    </div>
                  )}

                  {/* Comparativo visual: diferença média sem vs com zerados */}
                  {globalInsights.mediaSemZerados != null && globalInsights.mediaComZerados != null && (
                    <div className="flex items-center gap-4 p-5 rounded-xl bg-emerald-500/5 dark:bg-emerald-500/10 shadow-sm border border-emerald-500/20 hover:border-emerald-500/30 transition-all">
                      <div className="shrink-0 flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/20">
                        <TrendingUp className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div className="space-y-1 min-w-0">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">
                          Diferença entre média sem zerados e com zerados
                        </p>
                        <p className="text-xl font-bold text-foreground tabular-nums">
                          {(globalInsights.mediaSemZerados - globalInsights.mediaComZerados).toFixed(1)} pts
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Zerados reduzem a média geral em{" "}
                          <span className="font-semibold text-amber-600 dark:text-amber-400">
                            {globalInsights.mediaSemZerados > 0
                              ? (
                                  ((globalInsights.mediaSemZerados - globalInsights.mediaComZerados) /
                                    globalInsights.mediaSemZerados) *
                                  100
                                ).toFixed(1)
                              : 0}
                            %
                          </span>
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Serviços (ativos)</CardTitle>
                  <CardDescription>Todos os serviços com execução média no mês selecionado.</CardDescription>
                </div>
                <span className="text-xs font-medium text-muted-foreground bg-muted/50 px-2 py-1 rounded-full">
                  {topServicos.length} serviços
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {topServicos.map((item) => (
                  <div
                    key={item.tipo_servico}
                    className="group rounded-xl bg-background/60 p-3 shadow-sm transition-all hover:shadow-md hover:bg-cyan-500/5 hover:ring-1 hover:ring-cyan-500/20 cursor-default"
                    title={`${item.tipo_servico || "Não informado"}: ${pct(item.media_execucao)} de execução média | ${item.quantidade_planos} planos`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-sm group-hover:text-cyan-700 dark:group-hover:text-cyan-300">
                        {item.tipo_servico || "Não informado"}
                      </span>
                      <span className="text-lg font-bold tabular-nums text-cyan-600 dark:text-cyan-400 shrink-0">
                        {pct(item.media_execucao)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-3 rounded-full bg-muted/50 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all duration-500"
                          style={{ width: `${clamp(item.media_execucao ?? 0)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 w-16 text-right">
                        {item.quantidade_planos} planos
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {!loading && topServicos.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">Sem dados para o período.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle>Base de dados</CardTitle>
            <CardDescription>
              Conferência por plano para validar divergência percentual e cobertura entre planilhas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <button
                type="button"
                onClick={() => setBaseDadosCardFilter(null)}
                className={`rounded-xl p-4 shadow-lg transition-all text-left text-white ${
                  !baseDadosCardFilter ? "bg-emerald-600 hover:bg-emerald-500" : "bg-emerald-500 hover:bg-emerald-400"
                }`}
              >
                <p className="text-xs font-bold opacity-90 flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5" />
                  Total despachos (SELIMP)
                </p>
                <p className="text-2xl font-bold mt-1">{iptPreviewTable?.resumo?.total_despachos_selimp ?? 0}</p>
                <p className="text-xs font-medium opacity-80 mt-1">No período</p>
              </button>
              <button
                type="button"
                onClick={() => setBaseDadosCardFilter((prev) => (prev === "inativos" ? null : "inativos"))}
                className={`rounded-xl p-4 shadow-lg transition-all text-left flex flex-col text-white ${
                  baseDadosCardFilter === "inativos" ? "bg-slate-700" : "bg-slate-600 hover:bg-slate-500"
                }`}
              >
                <p className="text-xs font-bold opacity-90 flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5" />
                  Inativos na SELIMP
                </p>
                <p className="text-2xl font-bold mt-1">
                  {sourceRows.filter((r) => (r.percentual_selimp == null || r.percentual_selimp === 0) && (r.despachos_selimp ?? 0) === 0).length}
                </p>
                <p className="text-xs font-medium opacity-80 mt-1">Clique para filtrar</p>
              </button>
              <button
                type="button"
                onClick={() => setBaseDadosCardFilter((prev) => (prev === "obs_global" ? null : "obs_global"))}
                className={`rounded-xl p-4 shadow-lg transition-all text-left flex flex-col text-white ${
                  baseDadosCardFilter === "obs_global" ? "bg-red-600" : "bg-red-500 hover:bg-red-600"
                }`}
              >
                <p className="text-xs font-bold opacity-90 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Com observação global
                </p>
                <p className="text-2xl font-bold mt-1">{Object.keys(observacoes.globais).length}</p>
                <p className="text-xs font-medium opacity-80 mt-1">Clique para filtrar</p>
              </button>
              <button
                type="button"
                onClick={() => setBaseDadosCardFilter((prev) => (prev === "obs_diaria" ? null : "obs_diaria"))}
                className={`rounded-xl p-4 shadow-lg transition-all text-left flex flex-col text-white ${
                  baseDadosCardFilter === "obs_diaria" ? "bg-amber-600" : "bg-amber-500 hover:bg-amber-600"
                }`}
              >
                <p className="text-xs font-bold opacity-90 flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Com observação diária
                </p>
                <p className="text-2xl font-bold mt-1">
                  {Object.keys(observacoes.diarias).filter((s) => Object.keys(observacoes.diarias[s] || {}).length > 0).length}
                </p>
                <p className="text-xs font-medium opacity-80 mt-1">Clique para filtrar</p>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setTableExpanded((prev) => !prev)}
                className="h-10 px-4 rounded-lg text-sm font-bold bg-slate-600 text-white shadow-lg hover:bg-slate-500 transition-all inline-flex items-center gap-2"
              >
                {tableExpanded ? <PanelBottomClose className="h-4 w-4" /> : <PanelBottomOpen className="h-4 w-4" />}
                {tableExpanded ? "Encolher tabela" : "Mostrar tabela"}
              </button>
              <Select value={zeroFilter} onValueChange={(v) => setZeroFilter(v as "all" | "zerados" | "nao_zerados")}>
                <SelectTrigger className="h-10 w-auto min-w-[140px] rounded-lg border-0 bg-blue-600 text-white font-bold shadow-lg hover:bg-blue-500 [&>svg]:text-white">
                  <BarChart2 className="h-4 w-4 shrink-0 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-slate-600" style={{ backgroundColor: "#1e293b", color: "#f8fafc" }}>
                  <SelectItem value="all" className="focus:bg-slate-600 focus:text-white">Todos percentuais</SelectItem>
                  <SelectItem value="zerados" className="focus:bg-slate-600 focus:text-white">Apenas zerados</SelectItem>
                  <SelectItem value="nao_zerados" className="focus:bg-slate-600 focus:text-white">Sem zerados</SelectItem>
                </SelectContent>
              </Select>
              <Select value={obsGlobalFilter} onValueChange={(v) => setObsGlobalFilter(v as "all" | "com" | "sem")}>
                <SelectTrigger className="h-10 w-auto min-w-[160px] rounded-lg border-0 bg-red-600 text-white font-bold shadow-lg hover:bg-red-500 [&>svg]:text-white">
                  <AlertTriangle className="h-4 w-4 shrink-0 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-slate-600" style={{ backgroundColor: "#1e293b", color: "#f8fafc" }}>
                  <SelectItem value="all" className="focus:bg-slate-600 focus:text-white">Obs. global: todos</SelectItem>
                  <SelectItem value="com" className="focus:bg-slate-600 focus:text-white">Com obs. global</SelectItem>
                  <SelectItem value="sem" className="focus:bg-slate-600 focus:text-white">Sem obs. global</SelectItem>
                </SelectContent>
              </Select>
              <Select value={obsDiariaFilter} onValueChange={(v) => setObsDiariaFilter(v as "all" | "com" | "sem")}>
                <SelectTrigger className="h-10 w-auto min-w-[160px] rounded-lg border-0 bg-amber-500 text-white font-bold shadow-lg hover:bg-amber-400 [&>svg]:text-white">
                  <Calendar className="h-4 w-4 shrink-0 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-slate-600" style={{ backgroundColor: "#1e293b", color: "#f8fafc" }}>
                  <SelectItem value="all" className="focus:bg-slate-600 focus:text-white">Obs. diária: todos</SelectItem>
                  <SelectItem value="com" className="focus:bg-slate-600 focus:text-white">Com obs. diária</SelectItem>
                  <SelectItem value="sem" className="focus:bg-slate-600 focus:text-white">Sem obs. diária</SelectItem>
                </SelectContent>
              </Select>
              <Select value={bateriaAlertaFilter} onValueChange={(v) => setBateriaAlertaFilter(v as "all" | "com" | "sem")}>
                <SelectTrigger className="h-10 w-auto min-w-[140px] rounded-lg border-0 bg-amber-600 text-white font-bold shadow-lg hover:bg-amber-500 [&>svg]:text-white">
                  <Battery className="h-4 w-4 shrink-0 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-slate-600" style={{ backgroundColor: "#1e293b", color: "#f8fafc" }}>
                  <SelectItem value="all" className="focus:bg-slate-600 focus:text-white">Bateria: todos</SelectItem>
                  <SelectItem value="com" className="focus:bg-slate-600 focus:text-white">Com alerta</SelectItem>
                  <SelectItem value="sem" className="focus:bg-slate-600 focus:text-white">Sem alerta</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 shadow-lg text-white">
                <Calendar className="h-4 w-4 shrink-0" />
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
                      const [y, m, day] = v.split("-").map(Number);
                      const date = new Date(y, m - 1, day);
                      setTableScope("periodo");
                      setTablePeriodRange((prev) => ({
                        inicio: date,
                        fim: prev?.fim && prev.fim >= date ? prev.fim : date,
                      }));
                    }}
                    className="h-8 rounded-lg bg-white/95 px-2 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-white outline-none"
                  />
                  <span className="text-emerald-100 text-xs font-bold">até</span>
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
                      const [y, m, day] = v.split("-").map(Number);
                      const date = new Date(y, m - 1, day);
                      setTableScope("periodo");
                      setTablePeriodRange((prev) => ({
                        inicio: prev?.inicio && prev.inicio <= date ? prev.inicio : date,
                        fim: date,
                      }));
                    }}
                    className="h-8 rounded-lg bg-white/95 px-2 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-white outline-none"
                  />
                  <span className="text-xs font-bold text-white">
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
                  className="h-10 px-4 rounded-lg text-sm font-bold bg-amber-500 text-white shadow-lg hover:bg-amber-400 transition-all"
                  title="Voltar ao dia anterior"
                >
                  <Calendar className="h-4 w-4 inline mr-1.5 -mt-0.5" />
                  Dia anterior
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setTableScope("todos");
                  setTablePeriodRange(null);
                }}
                className="h-10 px-4 rounded-lg text-sm font-bold bg-slate-600 text-white shadow-lg hover:bg-slate-500 transition-all"
                title="Mostrar todos os setores (visão abrangente)"
              >
                <X className="h-4 w-4 inline mr-1.5 -mt-0.5" />
                Apagar período
              </button>

              <button
                type="button"
                onClick={clearAllTableFilters}
                className="h-10 px-4 rounded-lg text-sm font-bold bg-emerald-600 text-white shadow-lg hover:bg-emerald-500 transition-all inline-flex items-center gap-2"
              >
                <RotateCcw className="h-4 w-4" />
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
                            <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-44 rounded-xl p-2 shadow-[0_16px_45px_-20px_rgba(0,0,0,0.6)] transition-all border border-slate-600" style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>
                              <p className="text-[10px] font-semibold text-slate-400 mb-1">Ordenação</p>
                              <button onClick={() => setSort("plano", "asc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-600">
                                Crescente
                              </button>
                              <button onClick={() => setSort("plano", "desc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-600">
                                Decrescente
                              </button>
                              <p className="text-[10px] font-semibold text-slate-400 mt-2 mb-1">Largura</p>
                              <div className="flex items-center gap-1">
                                <button onClick={() => adjustColumnWidth("plano", -16)} className="rounded px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500">-</button>
                                <button onClick={() => adjustColumnWidth("plano", 16)} className="rounded px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500">+</button>
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
                            <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-52 rounded-xl p-2 shadow-[0_16px_45px_-20px_rgba(0,0,0,0.6)] transition-all border border-slate-600" style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>
                              <p className="text-[10px] font-semibold text-slate-400 mb-1">Ordenação</p>
                              <button onClick={() => setSort("sub", "asc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-600">
                                Crescente
                              </button>
                              <button onClick={() => setSort("sub", "desc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-600">
                                Decrescente
                              </button>
                              <p className="text-[10px] font-semibold text-slate-400 mt-2 mb-1">Filtrar siglas</p>
                              {SUB_SIGLAS.map((sigla) => (
                                <label key={sigla} className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-slate-600 cursor-pointer">
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
                                  className="rounded px-2 py-1 text-[11px] bg-slate-600 hover:bg-slate-500"
                                >
                                  Todas
                                </button>
                                <button
                                  onClick={() => setSubSiglaFilter([])}
                                  className="rounded px-2 py-1 text-[11px] bg-slate-600 hover:bg-slate-500"
                                >
                                  Limpar
                                </button>
                              </div>
                              <p className="text-[10px] font-semibold text-slate-400 mt-2 mb-1">Largura</p>
                              <div className="flex items-center gap-1">
                                <button onClick={() => adjustColumnWidth("sub", -12)} className="rounded px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500">-</button>
                                <button onClick={() => adjustColumnWidth("sub", 12)} className="rounded px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500">+</button>
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
                            <div className="absolute left-0 top-[calc(100%+8px)] z-30 min-w-[460px] rounded-xl p-2 shadow-[0_16px_45px_-20px_rgba(0,0,0,0.6)] transition-all border border-slate-600" style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>
                              <p className="text-[10px] font-semibold text-slate-400 mb-1">Ordenação</p>
                              <button onClick={() => setSort("servico", "asc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-600">
                                Crescente
                              </button>
                              <button onClick={() => setSort("servico", "desc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-600">
                                Decrescente
                              </button>
                              <p className="text-[10px] font-semibold text-slate-400 mt-2 mb-1">Filtrar serviços</p>
                              <div className="max-h-40 overflow-y-auto space-y-0.5 pr-1">
                                {serviceOptions.map((servico) => (
                                  <label key={servico} className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-slate-600 transition-colors cursor-pointer">
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
                                  className="rounded px-2 py-1 text-[11px] text-white bg-slate-600 hover:bg-slate-500 transition-colors"
                                >
                                  Todos
                                </button>
                                <button
                                  onClick={() => setServiceFilterValues([])}
                                  className="rounded px-2 py-1 text-[11px] text-white bg-slate-600 hover:bg-slate-500 transition-colors"
                                >
                                  Limpar
                                </button>
                              </div>
                              <p className="text-[10px] font-semibold text-slate-400 mt-2 mb-1">Largura</p>
                              <div className="flex items-center gap-1">
                                <button onClick={() => adjustColumnWidth("servico", -20)} className="rounded px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500">-</button>
                                <button onClick={() => adjustColumnWidth("servico", 20)} className="rounded px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500">+</button>
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
                            <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-44 rounded-xl p-2 shadow-[0_16px_45px_-20px_rgba(0,0,0,0.6)] transition-all border border-slate-600" style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>
                              <p className="text-[10px] font-semibold text-slate-400 mb-1">Ordenação</p>
                              <button onClick={() => setSort("selimp", "asc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-600">
                                Crescente
                              </button>
                              <button onClick={() => setSort("selimp", "desc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-600">
                                Decrescente
                              </button>
                              <p className="text-[10px] font-semibold text-slate-400 mt-2 mb-1">Largura</p>
                              <div className="flex items-center gap-1">
                                <button onClick={() => adjustColumnWidth("selimp", -12)} className="rounded px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500">-</button>
                                <button onClick={() => adjustColumnWidth("selimp", 12)} className="rounded px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500">+</button>
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
                            <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-44 rounded-xl p-2 shadow-[0_16px_45px_-20px_rgba(0,0,0,0.6)] transition-all border border-slate-600" style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>
                              <p className="text-[10px] font-semibold text-slate-400 mb-1">Ordenação</p>
                              <button onClick={() => setSort("nossa", "asc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-600">
                                Crescente
                              </button>
                              <button onClick={() => setSort("nossa", "desc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-600">
                                Decrescente
                              </button>
                              <p className="text-[10px] font-semibold text-slate-400 mt-2 mb-1">Largura</p>
                              <div className="flex items-center gap-1">
                                <button onClick={() => adjustColumnWidth("nossa", -12)} className="rounded px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500">-</button>
                                <button onClick={() => adjustColumnWidth("nossa", 12)} className="rounded px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500">+</button>
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
                            <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-56 rounded-xl p-2 shadow-[0_16px_45px_-20px_rgba(0,0,0,0.6)] transition-all border border-slate-600" style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>
                              <p className="text-[10px] font-semibold text-slate-400 mb-1">Ordenação</p>
                              <button onClick={() => setSort("origem", "asc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-600">
                                Crescente
                              </button>
                              <button onClick={() => setSort("origem", "desc")} className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-600">
                                Decrescente
                              </button>
                              <p className="text-[10px] font-semibold text-slate-400 mt-2 mb-1">Filtrar origens</p>
                              {ORIGEM_VALUES.map((origem) => (
                                <label key={origem} className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-slate-600 transition-colors cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={origemFilterValues.includes(origem)}
                                    onChange={() => toggleOrigemFilterValue(origem)}
                                  />
                                  {origem === "ambos" ? "Ambos" : origem === "somente_selimp" ? "Só SELIMP" : origem === "somente_nosso" ? "Só DDMX" : "(--) sem despacho"}
                                </label>
                              ))}
                              <div className="mt-1 flex gap-1">
                                <button
                                  onClick={() => setOrigemFilterValues([...ORIGEM_VALUES])}
                                  className="rounded px-2 py-1 text-[11px] text-white bg-slate-600 hover:bg-slate-500 transition-colors"
                                >
                                  Todas
                                </button>
                                <button
                                  onClick={() => setOrigemFilterValues([])}
                                  className="rounded px-2 py-1 text-[11px] text-white bg-slate-600 hover:bg-slate-500 transition-colors"
                                >
                                  Limpar
                                </button>
                              </div>
                              <p className="text-[10px] font-semibold text-slate-400 mt-2 mb-1">Largura</p>
                              <div className="flex items-center gap-1">
                                <button onClick={() => adjustColumnWidth("origem", -12)} className="rounded px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500">-</button>
                                <button onClick={() => adjustColumnWidth("origem", 12)} className="rounded px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500">+</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </th>
                    </tr>
                  </thead>
                <tbody>
                  {filteredComparativo.map((row, index) => {
                    const subTag = getSubTag(row.subprefeitura, row.plano);
                    const rowKey = `${row.plano}-${row.origem}`;
                    const isExpanded = expandedPlano === row.plano;
                    const temObsGlobal = Boolean(observacoes.globais[row.plano]);
                    const temInatividadeLonga =
                      row.bateria_por_equipamento &&
                      Object.values(row.bateria_por_equipamento).some((b) => {
                        const ext = b as Record<string, unknown>;
                        const dias = ext.dias;
                        const diasNum = typeof dias === "string" ? parseInt(dias.replace(/\D/g, ""), 10) : typeof dias === "number" ? dias : 0;
                        return !Number.isNaN(diasNum) && diasNum >= 7;
                      });
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
                          <td className="px-3 py-2 font-medium">
                            <span
                              className={`inline-flex items-center gap-1.5 ${
                                temObsGlobal
                                  ? "text-red-600 dark:text-red-400 font-semibold"
                                  : temInatividadeLonga
                                  ? "text-amber-600 dark:text-amber-400"
                                  : ""
                              }`}
                            >
                              {row.plano || "-"}
                              {temObsGlobal && (
                                <span
                                  title={observacoes.globais[row.plano].titulo}
                                  className="inline-flex text-red-500 shrink-0"
                                >
                                  <AlertTriangle className="h-4 w-4" />
                                </span>
                              )}
                              {!temObsGlobal && temInatividadeLonga && (
                                <span
                                  title="Módulo(s) com inatividade há muito tempo (7+ dias sem comunicação)"
                                  className="inline-flex text-amber-500 shrink-0"
                                >
                                  <Battery className="h-4 w-4" />
                                </span>
                              )}
                            </span>
                          </td>
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
                            {(() => {
                              const origemEfetiva = row.percentual_selimp == null && row.percentual_nosso == null ? "sem_despacho" : row.origem;
                              return (
                                <span
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${getOrigemBadgeClass(origemEfetiva)}`}
                                >
                                  {origemEfetiva === "sem_despacho"
                                    ? "--"
                                    : origemEfetiva === "ambos"
                                    ? "Ambos"
                                    : origemEfetiva === "somente_selimp"
                                    ? "Só SELIMP"
                                    : "Só DDMX"}
                                </span>
                              );
                            })()}
                          </td>
                        </tr>
                        {isExpanded && hasDetails && (
                          <tr key={`${rowKey}-detail`}>
                            <td colSpan={7} className="bg-emerald-500/5 px-4 py-4 align-top border-b border-emerald-500/20">
                              <div className="space-y-4 text-sm">
                                {!hasAnyDetails && (
                                  <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-4 text-amber-800 dark:text-amber-200">
                                    Nenhum despacho registrado no período.
                                  </div>
                                )}
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                {row.equipamentos && row.equipamentos.length > 0 && (
                                  <div className="rounded-xl bg-cyan-500/10 border border-cyan-500/30 p-3 shadow-sm">
                                    <p className="text-xs font-semibold text-cyan-700 dark:text-cyan-300 mb-2 flex items-center gap-1.5">
                                      <Cpu className="h-4 w-4" />
                                      Equipamentos (Placa/Lutocar)
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {row.equipamentos.map((eq) => {
                                        const bat = row.bateria_por_equipamento?.[eq];
                                        return (
                                          <span
                                            key={eq}
                                            className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 font-mono text-xs font-medium text-cyan-800 dark:text-cyan-200 inline-flex items-center gap-1.5"
                                            title={
                                              bat
                                                ? [
                                                    `Bateria: ${bat.status_bateria}${bat.bateria ? ` (${bat.bateria})` : ""}`,
                                                    (() => {
                                                      const ext = bat as Record<string, unknown>;
                                                      const d = ext.data_ultima_comunicacao;
                                                      return d && `Última comunicação: ${String(d).replace(/^(\d{4})-(\d{2})-(\d{2}).*/, "$3/$2/$1")}`;
                                                    })(),
                                                    (() => {
                                                      const ext = bat as Record<string, unknown>;
                                                      const d = ext.dias;
                                                      return d && `Dias: ${d}`;
                                                    })(),
                                                  ]
                                                      .filter(Boolean)
                                                      .join(" · ")
                                                : undefined
                                            }
                                          >
                                            {eq}
                                            {bat && (
                                              <span className="inline-flex items-center gap-0.5 text-[10px] opacity-90">
                                                <Battery className="h-3 w-3" />
                                                {bat.bateria || bat.status_bateria}
                                              </span>
                                            )}
                                          </span>
                                        );
                                      })}
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
                                      <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block w-64 rounded-xl border border-slate-600 shadow-xl p-3 text-xs" style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>
                                        <p className="font-semibold text-slate-400 mb-1.5">Prévia cronograma (5 datas)</p>
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
                                {(row.bateria_por_equipamento && Object.keys(row.bateria_por_equipamento).length > 0) && (
                                  <div className="rounded-xl bg-violet-500/10 border border-violet-500/30 p-3 shadow-sm">
                                    <p className="text-xs font-semibold text-violet-700 dark:text-violet-300 mb-2 flex items-center gap-1.5">
                                      <Battery className="h-4 w-4" />
                                      Status da bateria
                                    </p>
                                    <div className="space-y-1.5">
                                      {Object.entries(row.bateria_por_equipamento).map(([codigo, info]) => (
                                        <div
                                          key={codigo}
                                          className="flex justify-between items-center gap-2 text-xs py-1 px-2 rounded-lg bg-violet-500/10"
                                          title={
                                            (() => {
                                              const ext = info as Record<string, unknown>;
                                              const d = ext.data_ultima_comunicacao;
                                              return d ? `Última comunicação: ${String(d).replace(/^(\d{4})-(\d{2})-(\d{2}).*/, "$3/$2/$1")}` : undefined;
                                            })()
                                          }
                                        >
                                          <span className="font-mono font-medium text-violet-800 dark:text-violet-200">{codigo}</span>
                                          <span className={`font-semibold ${
                                            /critico|baixo|descarregad/i.test(info.status_bateria) ? "text-red-600 dark:text-red-400" :
                                            /alerta|medio|aten/i.test(info.status_bateria) ? "text-amber-600 dark:text-amber-400" :
                                            "text-emerald-600 dark:text-emerald-400"
                                          }`}>
                                            {info.bateria ?? info.status_bateria}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
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
                                      <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block w-64 rounded-xl border border-slate-600 shadow-xl p-3 text-xs" style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}>
                                        <p className="font-semibold text-slate-400 mb-1.5">Prévia cronograma (5 datas)</p>
                                        <div className="flex flex-wrap gap-1">
                                          {row.cronograma_preview.map((d, i) => (
                                            <span key={`${row.plano}-cron-emerald-${i}-${d}`} className="rounded bg-emerald-500/20 px-2 py-0.5 font-mono">
                                              {d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2/$1")}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    </div>
                                )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  {observacoes.globais[row.plano] ? (
                                    <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3 shadow-sm flex-1 min-w-0">
                                      <p className="text-xs font-semibold text-red-700 dark:text-red-300 mb-1 flex items-center gap-1.5">
                                        <AlertTriangle className="h-4 w-4" />
                                        Observação global: {observacoes.globais[row.plano].titulo}
                                      </p>
                                      {observacoes.globais[row.plano].descricao && (
                                        <p className="text-xs text-red-800/80 dark:text-red-200/80 mb-2">{observacoes.globais[row.plano].descricao}</p>
                                      )}
                                      <button
                                        type="button"
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          if (!confirm("Cancelar esta observação global? A data será registrada.")) return;
                                          await apiService.cancelarIptObservacaoGlobal(observacoes.globais[row.plano].id);
                                          loadData();
                                        }}
                                        className="text-xs px-2 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-700 dark:text-red-300 font-medium"
                                      >
                                        Cancelar observação
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setModalObsGlobalSetor(row.plano);
                                        setModalObsGlobalTitulo("");
                                        setModalObsGlobalDescricao("");
                                        setModalObsGlobalOpen(true);
                                      }}
                                      className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/15 border border-amber-500/40 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 transition-colors"
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                      Adicionar observação global
                                    </button>
                                  )}
                                </div>
                                {row.detalhes_diarios && row.detalhes_diarios.length > 0 && (
                                  <>
                                    <div className="rounded-xl bg-slate-500/10 border border-slate-500/30 p-3 shadow-sm">
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
                                              <th className="text-left py-2 px-2 w-20">Obs</th>
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
                                                  <td className="py-2 px-2">
                                                    <span className="inline-flex items-center gap-1 flex-wrap">
                                                      {observacoes.globais[row.plano] && (
                                                        <span
                                                          title={observacoes.globais[row.plano].titulo}
                                                          className="inline-flex text-red-500"
                                                        >
                                                          <AlertTriangle className="h-4 w-4" />
                                                        </span>
                                                      )}
                                                      {observacoes.diarias[row.plano]?.[d.data.replace(/T.*/, "")] && (
                                                        <span
                                                          title={observacoes.diarias[row.plano][d.data.replace(/T.*/, "")].titulo}
                                                          className="inline-flex text-amber-500"
                                                        >
                                                          <AlertTriangle className="h-4 w-4" />
                                                        </span>
                                                      )}
                                                      {d.esperado &&
                                                        (d.despachos_selimp === 0 && d.despachos_nosso === 0) &&
                                                        row.bateria_por_equipamento &&
                                                        Object.values(row.bateria_por_equipamento).some(
                                                          (b) => /critico|baixo|descarregad|alerta|medio|aten/i.test(b.status_bateria)
                                                        ) && (
                                                          <span
                                                            title="Bateria baixa e setor não realizado neste dia"
                                                            className="inline-flex text-amber-400"
                                                          >
                                                            <BatteryWarning className="h-4 w-4" />
                                                          </span>
                                                        )}
                                                      <button
                                                        type="button"
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          setModalObsDiariaSetor(row.plano);
                                                          setModalObsDiariaData(d.data.replace(/T.*/, ""));
                                                          setModalObsDiariaTitulo("");
                                                          setModalObsDiariaDescricao("");
                                                          setModalObsDiariaOpen(true);
                                                        }}
                                                        className="inline-flex p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                                                        title="Adicionar observação diária"
                                                      >
                                                        <Plus className="h-3.5 w-3.5" />
                                                      </button>
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
