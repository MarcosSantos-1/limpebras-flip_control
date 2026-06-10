"use client";

import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Battery,
  BatteryCharging,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Filter,
  Gauge,
  Hash,
  Info,
  LayoutDashboard,
  MapPin,
  MoreHorizontal,
  Percent,
  Repeat,
  Search,
  ShieldAlert,
  ShieldCheck,
  Table2,
  TrendingUp,
  Trophy,
  Wrench,
  Wifi,
  WifiOff,
  XCircle,
  Calendar,
} from "lucide-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTree, faBroom } from "@fortawesome/free-solid-svg-icons";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import Lottie from "lottie-react";
import loadingAnimation from "@/public/Loading.json";
import { MainLayout } from "@/components/layout/main-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTheme } from "next-themes";
import { apiService } from "@/lib/api";
import { formatIptDataInstalacaoBr } from "@/lib/ipt-utils";
import { cn } from "@/lib/utils";

// --- Types ---

interface ModuleData {
  id: number;
  subprefeitura: string;
  setor: string;
  numeroSelimp: string;
  diasExecucao: string;
  comunicacao: "ON" | "OFF";
  bateria: string;
  bateriaPercentual: number;
  ultimaComunicacao: string;
  statusSinalGeral: string;
  statusBateria: string;
  dataInstalacao: string;
  quantidadeTrocas: number;
  diasOn: number;
  diasOff: number;
  produtividade: number;
}

interface ApiResponse {
  modules: ModuleData[];
  stats: {
    total: number;
    online: number;
    offline: number;
    avgProductivity: number;
    criticalAlerts: number;
    lowBattery: number;
  };
  lastUpdate: string | null;
}

// --- Constants ---

const CHART_COLORS = {
  success: "#22c55e",
  warning: "#eab308",
  error: "#ef4444",
  info: "#3b82f6",
  orange: "#f97316",
  primary: "#10b981",
  maintenance: "#64748b",
  outdated: "#a1a1aa",
};

const ITEMS_PER_PAGE = 50;

const DISPATCH_TYPES = [
  "Troca de Bateria",
  "Manutenção Geral",
  "Verificação",
  "Reinstalação",
  "Substituição",
];

// --- Utility Functions ---

function getStatusBySubprefeitura(data: ModuleData[]) {
  const subsSet = new Set(data.map((m) => m.subprefeitura).filter(Boolean));
  const subs = Array.from(subsSet).sort();
  return subs.map((sub) => {
    const items = data.filter((m) => m.subprefeitura === sub);
    const total = items.length;
    const online = items.filter((m) => m.comunicacao === "ON").length;
    const offline = items.filter((m) => m.comunicacao === "OFF").length;
    const maintenance = items.filter(
      (m) => m.statusSinalGeral === "MANUTENÇÃO" || m.statusSinalGeral === "MANUTENCAO"
    ).length;
    return { subprefeitura: sub, total, online, offline, maintenance };
  });
}

function summarizeModuleServicoSplit(modules: ModuleData[]): {
  moduloPracas: number;
  moduloManual: number;
  doubleTagged: boolean;
} {
  let moduloPracas = 0;
  let moduloManual = 0;
  for (const m of modules) {
    const tokens = m.setor.split("/").map((p) => p.trim()).filter(Boolean);
    const hasVp = tokens.some((t) => t.includes("VP"));
    const hasManual = tokens.some((t) => t.includes("VJ") || t.includes("VL"));
    if (hasVp) moduloPracas += 1;
    if (hasManual) moduloManual += 1;
  }
  return {
    moduloPracas,
    moduloManual,
    doubleTagged: moduloPracas + moduloManual > modules.length,
  };
}

function getBatteryDistribution(data: ModuleData[]) {
  const labels: Record<string, string> = {
    ALTA: "Alta",
    REGULAR: "Regular",
    BAIXA: "Baixa",
    CRÍTICA: "Crítica",
    DESATUALIZADA: "Desatualizada",
  };
  return Object.entries(labels).map(([key, label]) => ({
    status: label,
    count: data.filter((m) => m.statusBateria === key).length,
  }));
}

function getSignalDistribution(data: ModuleData[]) {
  return [
    { status: "Com Sinal", count: data.filter((m) => m.statusSinalGeral === "COM SINAL").length },
    { status: "Sem Sinal", count: data.filter((m) => m.statusSinalGeral === "SEM SINAL").length },
    { status: "Manutenção", count: data.filter((m) => m.statusSinalGeral === "MANUTENÇÃO" || m.statusSinalGeral === "MANUTENCAO").length },
  ];
}

function getProductivityDistribution(data: ModuleData[]) {
  return [
    { range: "Alta (70-100%)", count: data.filter((m) => m.produtividade >= 70).length },
    { range: "Média (30-69%)", count: data.filter((m) => m.produtividade >= 30 && m.produtividade < 70).length },
    { range: "Baixa (0-29%)", count: data.filter((m) => m.produtividade < 30).length },
  ];
}

function getCriticalModules(data: ModuleData[]) {
  return data.filter(
    (m) =>
      m.comunicacao === "OFF" ||
      m.statusBateria === "DESATUALIZADA" ||
      m.statusBateria === "CRÍTICA" ||
      m.produtividade < 50
  );
}

function getProductivityColor(value: number) {
  if (value >= 90) return "text-emerald-500";
  if (value >= 70) return "text-green-500";
  if (value >= 50) return "text-yellow-500";
  return "text-red-500";
}

function SetorCell({ value }: { value: string }) {
  const parts = value.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) {
    return <span className="max-w-[220px] font-mono text-xs leading-snug sm:text-sm">{value}</span>;
  }
  return (
    <div className="max-w-[220px] font-mono text-xs leading-snug sm:text-sm">
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 ? <br /> : null}
          {part}
        </span>
      ))}
    </div>
  );
}

/** Tooltip discreto via CSS (group-hover); suporta quebras de linha com \n */
function InfoTooltip({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <span className="group/tt relative inline-flex items-center">
      {children ?? (
        <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground/70 transition-colors hover:text-foreground" />
      )}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-max max-w-[260px] -translate-x-1/2 whitespace-pre-line rounded-xl border border-border/70 bg-popover px-3 py-2 text-left text-xs font-normal leading-snug text-popover-foreground shadow-xl group-hover/tt:block"
      >
        {text}
      </span>
    </span>
  );
}

type TooltipPayloadItem = {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
};

function GlassTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className={cn(
        "min-w-32 rounded-2xl border px-3 py-2.5 text-xs shadow-xl",
        "border-white/40 bg-white/65 backdrop-blur-xl backdrop-saturate-150",
        "dark:border-white/10 dark:bg-zinc-900/55 dark:backdrop-blur-xl",
        "ring-1 ring-black/5 dark:ring-white/10",
      )}
    >
      {label != null && String(label) !== "" && (
        <p className="mb-2 border-b border-black/5 pb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground dark:border-white/10">
          {label}
        </p>
      )}
      <ul className="space-y-1.5">
        {payload.map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full shadow-sm ring-1 ring-black/10 dark:ring-white/20"
              style={{ backgroundColor: p.color ?? "hsl(var(--muted))" }}
            />
            <span className="text-foreground">
              <span className="text-muted-foreground">{p.name}</span>
              {": "}
              <strong className="font-semibold tabular-nums">{p.value}</strong>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type PieLabelRenderProps = {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  name?: string;
  value?: number;
  fill?: string;
};

/** Rótulo fora do anel, maior, na cor do segmento (sem linha guia) */
function renderOutsidePieLabel(isDark: boolean) {
  function OutsidePieLabel(props: PieLabelRenderProps) {
    const { cx, cy, midAngle, outerRadius, name, value, fill } = props;
    if (value == null || value === 0) return null;
    const RADIAN = Math.PI / 180;
    const pad = 22;
    const radius = outerRadius + pad;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    const cos = Math.cos(-midAngle * RADIAN);
    const textAnchor: "start" | "end" | "middle" =
      Math.abs(cos) < 0.15 ? "middle" : cos > 0 ? "start" : "end";
    const strokeColor = isDark ? "rgba(24,24,27,0.92)" : "rgba(255,255,255,0.92)";
    return (
      <text
        x={x}
        y={y}
        fill={fill}
        textAnchor={textAnchor}
        dominantBaseline="central"
        className="pointer-events-none select-none font-semibold"
        style={{
          fontSize: 15,
          paintOrder: "stroke fill",
          stroke: strokeColor,
          strokeWidth: isDark ? 2.5 : 3,
        }}
      >
        {`${name}: ${value}`}
      </text>
    );
  }
  OutsidePieLabel.displayName = "OutsidePieLabel";
  return OutsidePieLabel;
}

function exportCSV(data: ModuleData[]) {
  const headers = ["Sub", "Setor", "SELIMP", "Dias Exec.", "Comunicação", "Bateria", "Últ. Comunicação", "Sinal", "Status Bat.", "Dias ON", "Dias OFF", "Produtividade", "Data instalação"];
  const rows = data.map((m) => [
    m.subprefeitura, m.setor, m.numeroSelimp, m.diasExecucao,
    m.comunicacao, m.bateria, m.ultimaComunicacao,
    m.statusSinalGeral, m.statusBateria,
    m.diasOn, m.diasOff, `${m.produtividade}%`,
    formatIptDataInstalacaoBr(m.dataInstalacao) || "—",
  ]);
  const csvContent = [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n");
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `modulos_bateria_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

// --- Page Component ---

export default function BateriaDashboardPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [subFilter, setSubFilter] = useState("all");
  const [communicationFilter, setCommunicationFilter] = useState("all");
  const [signalFilter, setSignalFilter] = useState("all");
  const [batteryFilter, setBatteryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [dispatchDialogOpen, setDispatchDialogOpen] = useState(false);
  const [newDispatch, setNewDispatch] = useState({ module: "", type: "", description: "" });
  const [detailModule, setDetailModule] = useState<ModuleData | null>(null);
  const [chartsReady, setChartsReady] = useState(false);
  // Filtros da aba "Trocas de Bateria"
  const [trocasPeriod, setTrocasPeriod] = useState("30d");
  const [trocasSearch, setTrocasSearch] = useState("");
  const [trocasSubFilter, setTrocasSubFilter] = useState("all");
  const { resolvedTheme } = useTheme();

  useEffect(() => { setChartsReady(true); }, []);

  const isChartDark = resolvedTheme === "dark";
  const axisTickColor = isChartDark ? "#e4e4e7" : "#52525b";
  const axisLineStroke = isChartDark ? "rgba(228, 228, 231, 0.22)" : "rgba(82, 82, 91, 0.35)";
  const axisTick = useMemo(() => ({ fill: axisTickColor, fontSize: 12 }), [axisTickColor]);
  const legendProps = useMemo(
    () =>
      ({
        wrapperStyle: { paddingTop: 12, color: axisTickColor } satisfies CSSProperties,
      }),
    [axisTickColor]
  );
  const pieLegendProps = useMemo(
    () =>
      ({
        verticalAlign: "bottom" as const,
        align: "center" as const,
        layout: "horizontal" as const,
        wrapperStyle: {
          width: "100%",
          paddingTop: 32,
          paddingBottom: 6,
          marginTop: 28,
          left: 0,
          bottom: 2,
          color: axisTickColor,
        } satisfies CSSProperties,
      }),
    [axisTickColor]
  );
  const pieOutsideLabel = useMemo(() => renderOutsidePieLabel(isChartDark), [isChartDark]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const result = await apiService.getIptModulosBateria();
      setData(result as ApiResponse);
    } catch {
      console.error("Erro ao carregar dados de módulos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const modules = data?.modules ?? [];
  const stats = data?.stats ?? { total: 0, online: 0, offline: 0, avgProductivity: 0, criticalAlerts: 0, lowBattery: 0 };

  const filteredModules = useMemo(() => {
    let result = modules;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (m) =>
          m.setor.toLowerCase().includes(term) ||
          m.numeroSelimp.toLowerCase().includes(term) ||
          m.subprefeitura.toLowerCase().includes(term)
      );
    }
    if (subFilter !== "all") result = result.filter((m) => m.subprefeitura === subFilter);

    if (communicationFilter === "online") result = result.filter((m) => m.comunicacao === "ON");
    else if (communicationFilter === "offline") result = result.filter((m) => m.comunicacao === "OFF");

    if (signalFilter === "com-sinal") result = result.filter((m) => m.statusSinalGeral === "COM SINAL");
    else if (signalFilter === "sem-sinal") result = result.filter((m) => m.statusSinalGeral === "SEM SINAL");
    else if (signalFilter === "manutencao") {
      result = result.filter(
        (m) => m.statusSinalGeral === "MANUTENÇÃO" || m.statusSinalGeral === "MANUTENCAO"
      );
    }

    if (batteryFilter === "critico") result = result.filter((m) => m.bateriaPercentual < 20);
    else if (batteryFilter === "baixo") result = result.filter((m) => m.bateriaPercentual >= 20 && m.bateriaPercentual < 50);
    else if (batteryFilter === "operacional") result = result.filter((m) => m.bateriaPercentual >= 50 && m.bateriaPercentual <= 80);
    else if (batteryFilter === "cheia") result = result.filter((m) => m.bateriaPercentual > 80);

    if (statusFilter === "baixo") {
      result = result.filter((m) => m.produtividade < 20);
    } else if (statusFilter === "atencao") {
      result = result.filter((m) => m.produtividade >= 20 && m.produtividade < 40);
    } else if (statusFilter === "alerta") {
      result = result.filter((m) => m.produtividade >= 40 && m.produtividade <= 60);
    } else if (statusFilter === "alta") {
      result = result.filter((m) => m.produtividade > 60);
    }

    return result;
  }, [modules, searchTerm, subFilter, communicationFilter, signalFilter, batteryFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredModules.length / ITEMS_PER_PAGE));
  const paginatedModules = filteredModules.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const subChartData = useMemo(() => getStatusBySubprefeitura(modules), [modules]);
  const prodChartData = useMemo(() => getProductivityDistribution(modules), [modules]);
  const batteryChartData = useMemo(() => getBatteryDistribution(modules), [modules]);
  const signalChartData = useMemo(() => getSignalDistribution(modules), [modules]);
  const criticalModules = useMemo(() => getCriticalModules(modules), [modules]);

  const servicoSplit = useMemo(() => summarizeModuleServicoSplit(modules), [modules]);

  const commMaintenanceStats = useMemo(() => {
    const total = modules.length;
    const online = modules.filter((m) => m.comunicacao === "ON").length;
    const offline = modules.filter((m) => m.comunicacao === "OFF").length;
    const maintenance = modules.filter(
      (m) => m.statusSinalGeral === "MANUTENÇÃO" || m.statusSinalGeral === "MANUTENCAO",
    ).length;
    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
    return {
      total,
      online,
      offline,
      maintenance,
      pctOnline: pct(online),
      pctOffline: pct(offline),
      pctMaint: pct(maintenance),
    };
  }, [modules]);

  const maintenanceChartColor = isChartDark ? "#94a3b8" : CHART_COLORS.maintenance;

  // Alta (verde) · Média (amarelo) · Baixa (vermelho)
  const PROD_COLORS = [CHART_COLORS.success, CHART_COLORS.warning, CHART_COLORS.error];
  // ALTA verde · REGULAR laranja · BAIXA azul · CRÍTICA vermelho · DESATUALIZADA cinza (visível no dark)
  const BATTERY_COLORS = [
    CHART_COLORS.success,
    CHART_COLORS.orange,
    CHART_COLORS.info,
    CHART_COLORS.error,
    CHART_COLORS.outdated,
  ];
  const SIGNAL_COLORS = useMemo(
    () => [CHART_COLORS.success, CHART_COLORS.error, maintenanceChartColor],
    [maintenanceChartColor]
  );

  const uniqueSubs = useMemo(() => {
    const set = new Set(modules.map((m) => m.subprefeitura).filter(Boolean));
    return Array.from(set).sort();
  }, [modules]);

  // ===== Aba "Trocas de Bateria" (esqueleto — mockups + dados presentes) =====

  /** Diagnóstico de baterias em operação (dados reais derivados do status atual). */
  const batteryDiagnostic = useMemo(() => {
    const countBat = (s: string) => modules.filter((m) => m.statusBateria === s).length;
    const comSinal = modules.filter((m) => m.statusSinalGeral === "COM SINAL").length;
    const semSinal = modules.filter((m) => m.statusSinalGeral === "SEM SINAL").length;
    return {
      comSinal,
      semSinal,
      alta: countBat("ALTA"),
      regular: countBat("REGULAR"),
      baixa: countBat("BAIXA"),
      critica: countBat("CRÍTICA"),
      desatualizada: countBat("DESATUALIZADA"),
    };
  }, [modules]);

  /** Indicadores de trocas (mock derivado da distribuição atual de status). */
  const trocasStats = useMemo(() => {
    const corretivas = modules.filter((m) => m.statusBateria === "DESATUALIZADA").length;
    const preventivas = modules.filter(
      (m) => m.statusBateria === "CRÍTICA" || m.statusBateria === "BAIXA",
    ).length;
    const desnecessarias = modules.filter((m) => m.statusBateria === "REGULAR").length;
    const total = corretivas + preventivas + desnecessarias;
    const comSucesso = modules.filter(
      (m) => m.comunicacao === "ON" && (m.statusBateria === "ALTA" || m.statusBateria === "REGULAR"),
    ).length;
    const semSucesso = modules.filter((m) => m.statusBateria === "DESATUALIZADA").length;
    const baseSucesso = comSucesso + semSucesso;
    const acertividade = baseSucesso > 0 ? Math.round((comSucesso / baseSucesso) * 100) : 0;
    const mediaBateria =
      modules.length > 0
        ? Math.round(modules.reduce((s, m) => s + (m.bateriaPercentual || 0), 0) / modules.length)
        : 0;
    return { total, corretivas, preventivas, desnecessarias, comSucesso, semSucesso, acertividade, mediaBateria };
  }, [modules]);

  /** Ranking dos setores com maior quantidade de trocas. */
  const trocasRanking = useMemo(() => {
    const map = new Map<
      string,
      { setor: string; subprefeitura: string; totalTrocas: number; manutencoes: number; somaDuracao: number; n: number }
    >();
    for (const m of modules) {
      const key = m.setor || "—";
      const cur =
        map.get(key) ?? {
          setor: m.setor,
          subprefeitura: m.subprefeitura,
          totalTrocas: 0,
          manutencoes: 0,
          somaDuracao: 0,
          n: 0,
        };
      cur.totalTrocas += m.quantidadeTrocas || 0;
      cur.manutencoes += (m.quantidadeTrocas || 0) > 0 ? 1 : 0;
      cur.somaDuracao += m.diasOn || 0;
      cur.n += 1;
      map.set(key, cur);
    }
    return Array.from(map.values())
      .map((r) => ({ ...r, mediaDuracao: r.n ? Math.round(r.somaDuracao / r.n) : 0 }))
      .sort((a, b) => b.totalTrocas - a.totalTrocas)
      .slice(0, 7);
  }, [modules]);

  /** Listagem geral de setores (filtro + busca próprios da aba Trocas). */
  const trocasModules = useMemo(() => {
    let result = modules;
    if (trocasSubFilter !== "all") result = result.filter((m) => m.subprefeitura === trocasSubFilter);
    if (trocasSearch) {
      const term = trocasSearch.toLowerCase();
      result = result.filter(
        (m) =>
          m.setor.toLowerCase().includes(term) ||
          m.numeroSelimp.toLowerCase().includes(term) ||
          m.subprefeitura.toLowerCase().includes(term),
      );
    }
    return result.slice(0, 60);
  }, [modules, trocasSubFilter, trocasSearch]);

  if (loading) {
    return (
      <MainLayout>
        <div className="flex h-[60vh] items-center justify-center">
          <Lottie animationData={loadingAnimation} className="h-32 w-32" loop />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-md">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-4">
              <Link
                href="/ipt"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-zinc-200 hover:text-foreground dark:hover:bg-zinc-800"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div className="flex items-center gap-3">
                <Activity className="h-6 w-6 text-emerald-500" />
                <div>
                  <h1 className="text-xl font-bold text-foreground">Monitoramento de Módulos SELIMP</h1>
                  <p className="text-xs text-muted-foreground">Dashboard de Análise completa de módulos SELIMP, Bateria e Sinal</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>Atualizado: {data?.lastUpdate ?? "Sem importação"}</span>
            </div>
          </div>
        </div>

        {/* Main */}
        <div className="px-6 py-6">
          <Tabs defaultValue="overview" className="space-y-6">
            <TabsList className="bg-muted/50 border border-border">
              <TabsTrigger value="overview" className="data-[state=active]:bg-emerald-500 data-[state=active]:text-white text-muted-foreground">
                <LayoutDashboard className="mr-2 h-4 w-4" /> Visão Geral
              </TabsTrigger>
              <TabsTrigger value="trocas" className="data-[state=active]:bg-emerald-500 data-[state=active]:text-white text-muted-foreground">
                <Repeat className="mr-2 h-4 w-4" /> Trocas de Bateria
              </TabsTrigger>
              <TabsTrigger value="maintenance" className="data-[state=active]:bg-emerald-500 data-[state=active]:text-white text-muted-foreground">
                <Wrench className="mr-2 h-4 w-4" /> Manutenções
              </TabsTrigger>
              <TabsTrigger value="modules" className="data-[state=active]:bg-emerald-500 data-[state=active]:text-white text-muted-foreground">
                <Gauge className="mr-2 h-4 w-4" /> Performance
              </TabsTrigger>
            </TabsList>

            {/* ===== OVERVIEW TAB ===== */}
            <TabsContent value="overview" className="space-y-6">
              {/* Hero Total + tipo de serviço */}
              <div className="relative overflow-hidden rounded-2xl border border-violet-400/40 bg-linear-to-br from-violet-600/95 via-purple-700 to-indigo-950 px-6 py-8 shadow-xl shadow-indigo-950/30 ring-1 ring-white/15 sm:px-8">
                <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-fuchsia-400/15 blur-3xl dark:bg-violet-500/25" aria-hidden />
                <div className="relative flex flex-col gap-8 xl:flex-row xl:items-stretch xl:justify-between xl:gap-10">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-violet-100/95">
                      <Activity className="size-9 shrink-0 text-white opacity-95" aria-hidden />
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-white/85">Painel SELIMP</p>
                        <h2 className="text-lg font-semibold text-white">Total de módulos monitorados</h2>
                      </div>
                    </div>
                    <p className="mt-6 text-center text-[clamp(3rem,8vw,4.25rem)] font-bold tabular-nums leading-none tracking-tight text-white drop-shadow-sm sm:text-left">
                      {stats.total}
                    </p>

                    {servicoSplit.doubleTagged ? (
                      <p className="mt-2 text-xs text-violet-200/95">
                        A soma varrição praça + manual pode exceder o total quando há setores VP e VJ/VL no mesmo módulo — cada tipo é somado só para módulos com o respectivo código.
                      </p>
                    ) : null}
                  </div>
                  <div className="grid flex-1 min-w-[220px] grid-cols-1 gap-4 sm:grid-cols-2 xl:max-w-xl">
                    <div className="flex flex-col justify-between rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-white/80">Varrição de praças</p>
                        </div>
                        <FontAwesomeIcon icon={faTree} className="size-9 shrink-0 text-emerald-200/95" aria-hidden />
                      </div>
                      <p className="mt-4 font-mono text-3xl font-bold tabular-nums text-white sm:text-4xl">{servicoSplit.moduloPracas}</p>
                    </div>
                    <div className="flex flex-col justify-between rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-white/80">Varrição manual</p>
                          <p className="mt-0.5 text-xs text-violet-100/85">
                          </p>
                        </div>
                        <FontAwesomeIcon icon={faBroom} className="size-9 shrink-0 text-amber-100/95" aria-hidden />
                      </div>
                      <p className="mt-4 font-mono text-3xl font-bold tabular-nums text-white sm:text-4xl">{servicoSplit.moduloManual}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Online / Offline / Manutenção */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card className="relative overflow-hidden rounded-xl border-0 bg-linear-to-br from-emerald-600 to-emerald-900 text-white shadow-xl shadow-emerald-900/25 dark:bg-linear-to-br dark:from-emerald-700 dark:to-emerald-950 dark:shadow-emerald-950/35">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-semibold text-white/95">Online</CardTitle>
                    <Wifi className="size-5 shrink-0 text-white/80" />
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-mono text-4xl font-bold tracking-tight text-white tabular-nums">{commMaintenanceStats.online}</span>
                      <span className="font-mono text-2xl font-bold tabular-nums text-white/85">{`(${commMaintenanceStats.pctOnline}%)`}</span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-white/90">Comunicação ativa</p>
                  </CardContent>
                </Card>

                <Card className="relative overflow-hidden border-red-900/55 bg-linear-to-br from-red-700/92 via-red-800 to-rose-950 text-white shadow-xl shadow-red-950/45 dark:border-red-950/55">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-semibold text-white">Offline</CardTitle>
                    <WifiOff className="size-5 shrink-0 text-white/90" />
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-mono text-4xl font-bold tabular-nums text-white">{commMaintenanceStats.offline}</span>
                      <span className="font-mono text-2xl font-bold tabular-nums text-red-100/95">({commMaintenanceStats.pctOffline}%)</span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-red-50/95">Sem comunicação</p>
                  </CardContent>
                </Card>

                <Card className="relative overflow-hidden border border-zinc-400/50 bg-linear-to-br from-zinc-200 via-zinc-300/85 to-slate-400/90 shadow-lg dark:border-zinc-600 dark:from-zinc-800 dark:via-zinc-900 dark:to-slate-950">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-semibold text-zinc-800 dark:text-zinc-50">Manutenção</CardTitle>
                    <Wrench className="size-5 shrink-0 text-zinc-700 dark:text-zinc-300" />
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-mono text-4xl font-bold tracking-tight text-zinc-900 tabular-nums dark:text-white">{commMaintenanceStats.maintenance}</span>
                      <span className="font-mono text-2xl font-bold tabular-nums text-zinc-700 dark:text-zinc-300">({commMaintenanceStats.pctMaint}%)</span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">Manutenção ativa ou pendente</p>
                  </CardContent>
                </Card>
              </div>

              {/* Charts */}
              {chartsReady && (
                <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 lg:grid-cols-4">
                  {/* Status de Sinal (Donut) — primeiro */}
                  <Card className="col-span-2 flex h-full min-h-[28rem] flex-col overflow-visible border-border/50 bg-card/80 backdrop-blur-sm shadow-sm lg:min-h-[28rem]">
                    <CardHeader className="shrink-0 space-y-1 pb-2 pt-6">
                      <CardTitle className="text-foreground">Status de Sinal</CardTitle>
                      <CardDescription className="pb-10">Distribuição de comunicação</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col items-center justify-center overflow-visible px-4 pb-10 pt-4">
                      <div className="h-[308px] w-full max-w-full overflow-visible px-1 [&_.recharts-surface]:overflow-visible [&_.recharts-legend-wrapper]:mt-10! [&_.recharts-legend-wrapper]:pt-10!">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart margin={{ top: 18, right: 120, bottom: 102, left: 120 }}>
                            <Pie
                              data={signalChartData}
                              dataKey="count"
                              nameKey="status"
                              cx="50%"
                              cy="42%"
                              innerRadius={65}
                              outerRadius={106}
                              paddingAngle={3}
                              labelLine={false}
                              label={pieOutsideLabel}
                            >
                              {signalChartData.map((_, idx) => (
                                <Cell key={idx} fill={SIGNAL_COLORS[idx]} />
                              ))}
                            </Pie>
                            <Tooltip content={<GlassTooltip />} cursor={false} />
                            <Legend
                              {...pieLegendProps}
                              formatter={(value) => <span style={{ color: axisTickColor }}>{String(value)}</span>}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Status por Subprefeitura — segundo */}
                  <Card className="col-span-2 flex h-full min-h-[32rem] flex-col border-border/50 bg-card/80 backdrop-blur-sm shadow-sm lg:min-h-[34rem]">
                    <CardHeader className="shrink-0 space-y-1 pb-2 pt-6">
                      <CardTitle className="text-foreground">Status por Subprefeitura</CardTitle>
                      <CardDescription>Online e offline por comunicação; manutenção por status de sinal</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col items-center justify-center px-4 pb-8 pt-4">
                      <div className="h-[360px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={subChartData} margin={{ top: 12, right: 12, left: 8, bottom: 8 }}>
                          <XAxis
                            dataKey="subprefeitura"
                            tick={axisTick}
                            tickLine={false}
                            tickMargin={10}
                            axisLine={{ stroke: axisLineStroke }}
                          />
                          <YAxis
                            tick={axisTick}
                            tickLine={false}
                            tickMargin={8}
                            axisLine={{ stroke: axisLineStroke }}
                          />
                          <Tooltip content={<GlassTooltip />} cursor={{ fill: "transparent" }} />
                          <Legend
                            {...legendProps}
                            formatter={(value) => <span style={{ color: axisTickColor }}>{String(value)}</span>}
                          />
                          <Bar dataKey="online" name="Online" fill={CHART_COLORS.success} radius={[4, 4, 0, 0]} activeBar={false} />
                          <Bar dataKey="offline" name="Offline" fill={CHART_COLORS.error} radius={[4, 4, 0, 0]} activeBar={false} />
                          <Bar dataKey="maintenance" name="Manutenção" fill={maintenanceChartColor} radius={[4, 4, 0, 0]} activeBar={false} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    </CardContent>
                  </Card>

                  {/* Distribuição de Produtividade */}
                  <Card className="col-span-2 flex h-full min-h-[32rem] flex-col border-border/50 bg-card/80 backdrop-blur-sm shadow-sm lg:min-h-[34rem]">
                    <CardHeader className="shrink-0 space-y-1 pb-2 pt-6">
                      <CardTitle className="text-foreground">Distribuição de Produtividade das Baterias</CardTitle>
                      <CardDescription>Faixas de produtividade dos módulos</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col items-center justify-center px-4 pb-8 pt-4">
                      <div className="h-[360px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={prodChartData} layout="vertical" margin={{ top: 12, right: 16, left: 8, bottom: 8 }}>
                          <XAxis
                            type="number"
                            tick={axisTick}
                            tickLine={false}
                            tickMargin={8}
                            axisLine={{ stroke: axisLineStroke }}
                          />
                          <YAxis
                            dataKey="range"
                            type="category"
                            width={88}
                            tick={axisTick}
                            tickLine={false}
                            tickMargin={6}
                            axisLine={{ stroke: axisLineStroke }}
                          />
                          <Tooltip content={<GlassTooltip />} cursor={{ fill: "transparent" }} />
                          <Bar dataKey="count" name="Módulos" radius={[0, 4, 4, 0]} activeBar={false}>
                            {prodChartData.map((_, idx) => (
                              <Cell key={idx} fill={PROD_COLORS[idx]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    </CardContent>
                  </Card>

                  {/* Status de Bateria (Donut) */}
                  <Card className="col-span-2 flex h-full min-h-[32rem] flex-col overflow-visible border-border/50 bg-card/80 backdrop-blur-sm shadow-sm lg:min-h-[34rem]">
                    <CardHeader className="shrink-0 space-y-1 pb-2 pt-6">
                      <CardTitle className="text-foreground">Status de Bateria</CardTitle>
                      <CardDescription>Distribuição do status atual</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col items-center justify-center overflow-visible px-4 pb-10 pt-4">
                      <div className="h-[300px] w-full max-w-full overflow-visible px-1 [&_.recharts-surface]:overflow-visible [&_.recharts-legend-wrapper]:mt-10! [&_.recharts-legend-wrapper]:pt-10!">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart margin={{ top: 18, right: 120, bottom: 102, left: 120 }}>
                            <Pie
                              data={batteryChartData}
                              dataKey="count"
                              nameKey="status"
                              cx="50%"
                              cy="42%"
                              innerRadius={65}
                              outerRadius={106}
                              paddingAngle={3}
                              labelLine={false}
                              label={pieOutsideLabel}
                            >
                              {batteryChartData.map((_, idx) => (
                                <Cell key={idx} fill={BATTERY_COLORS[idx]} />
                              ))}
                            </Pie>
                            <Tooltip content={<GlassTooltip />} cursor={false} />
                            <Legend
                              {...pieLegendProps}
                              formatter={(value) => <span style={{ color: axisTickColor }}>{String(value)}</span>}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </TabsContent>

            {/* ===== TROCAS DE BATERIA TAB ===== */}
            <TabsContent value="trocas" className="space-y-6">
              {/* Filtro superior discreto */}
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/50 bg-card/50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <Select value={trocasPeriod} onValueChange={setTrocasPeriod}>
                    <SelectTrigger className="h-9 w-[150px] border-border/60 bg-background/60">
                      <SelectValue placeholder="Período" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7d">Últimos 7 dias</SelectItem>
                      <SelectItem value="30d">Últimos 30 dias</SelectItem>
                      <SelectItem value="90d">Últimos 90 dias</SelectItem>
                      <SelectItem value="all">Todo o período</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="relative min-w-[200px] flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Módulo SELIMP, setor..."
                    className="h-9 border-border/60 bg-background/60 pl-9"
                    value={trocasSearch}
                    onChange={(e) => setTrocasSearch(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <Select value={trocasSubFilter} onValueChange={setTrocasSubFilter}>
                    <SelectTrigger className="h-9 w-[150px] border-border/60 bg-background/60">
                      <SelectValue placeholder="Subprefeitura" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas subs</SelectItem>
                      {uniqueSubs.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Hero: total de trocas + 3 sub cards na borda direita */}
              <div className="relative overflow-hidden rounded-2xl border border-emerald-400/40 bg-linear-to-br from-emerald-600/95 via-teal-700 to-cyan-950 px-6 py-8 shadow-xl shadow-teal-950/30 ring-1 ring-white/15 sm:px-8">
                <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-teal-400/15 blur-3xl dark:bg-emerald-500/25" aria-hidden />
                <div className="relative flex flex-col gap-8 xl:flex-row xl:items-stretch xl:justify-between xl:gap-10">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-emerald-100/95">
                      <Repeat className="size-9 shrink-0 text-white opacity-95" aria-hidden />
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-white/85">Trocas de Bateria</p>
                        <h2 className="text-lg font-semibold text-white">Total de trocas realizadas</h2>
                      </div>
                    </div>
                    <p className="mt-6 text-center text-[clamp(3rem,8vw,4.25rem)] font-bold tabular-nums leading-none tracking-tight text-white drop-shadow-sm sm:text-left">
                      {trocasStats.total}
                    </p>
                    <p className="mt-3 text-xs text-emerald-100/85">
                      Dados preliminares (mockup) — a dinâmica de registro de trocas será conectada em seguida.
                    </p>
                  </div>
                  <div className="grid flex-1 min-w-[220px] grid-cols-1 gap-4 sm:grid-cols-3 xl:max-w-2xl">
                    <div className="flex flex-col justify-between rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-white/80">Preventivas</p>
                        <InfoTooltip text={"Baterias Críticas (1%-14%) ou\nBaixas (15%-29%)"}>
                          <ShieldCheck className="size-6 shrink-0 cursor-help text-sky-200/95" aria-hidden />
                        </InfoTooltip>
                      </div>
                      <p className="mt-4 font-mono text-3xl font-bold tabular-nums text-white">{trocasStats.preventivas}</p>
                    </div>
                    <div className="flex flex-col justify-between rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-white/80">Corretivas</p>
                        <InfoTooltip text={"Baterias Desatualizadas\n(Sem comunicação)"}>
                          <AlertTriangle className="size-6 shrink-0 cursor-help text-amber-200/95" aria-hidden />
                        </InfoTooltip>
                      </div>
                      <p className="mt-4 font-mono text-3xl font-bold tabular-nums text-white">{trocasStats.corretivas}</p>
                    </div>
                    <div className="flex flex-col justify-between rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-white/80">Desnecessárias</p>
                        <InfoTooltip text={"Trocas feitas em baterias que ainda\nestavam em bom estado de operação"}>
                          <XCircle className="size-6 shrink-0 cursor-help text-rose-200/95" aria-hidden />
                        </InfoTooltip>
                      </div>
                      <p className="mt-4 font-mono text-3xl font-bold tabular-nums text-white">{trocasStats.desnecessarias}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 4 cards de indicadores */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card className="relative overflow-hidden border-0 bg-linear-to-br from-emerald-600 to-emerald-900 text-white shadow-xl shadow-emerald-900/25">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-semibold text-white/95">Trocas com Sucesso</CardTitle>
                    <InfoTooltip text={"Que foram atualizadas o sinal e bateria\napós a troca"}>
                      <CheckCircle2 className="size-5 shrink-0 cursor-help text-white/85" />
                    </InfoTooltip>
                  </CardHeader>
                  <CardContent>
                    <div className="font-mono text-4xl font-bold tabular-nums text-white">{trocasStats.comSucesso}</div>
                    <p className="mt-2 text-sm font-medium text-white/90">Sinal e bateria restabelecidos</p>
                  </CardContent>
                </Card>

                <Card className="relative overflow-hidden border border-red-900/55 bg-linear-to-br from-red-700/92 via-red-800 to-rose-950 text-white shadow-xl shadow-red-950/45">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-semibold text-white">Trocas sem Sucesso</CardTitle>
                    <InfoTooltip text={"Que mesmo após a troca o sinal e bateria\npermaneceram desatualizados"}>
                      <XCircle className="size-5 shrink-0 cursor-help text-white/90" />
                    </InfoTooltip>
                  </CardHeader>
                  <CardContent>
                    <div className="font-mono text-4xl font-bold tabular-nums text-white">{trocasStats.semSucesso}</div>
                    <p className="mt-2 text-sm font-medium text-red-50/95">Permaneceram desatualizados</p>
                  </CardContent>
                </Card>

                <Card className="border-border/50 bg-card/80 shadow-sm backdrop-blur-sm">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Acertividade</CardTitle>
                    <InfoTooltip text={"Proporção de trocas com sucesso sobre o\ntotal de trocas com resultado conhecido"}>
                      <Percent className="size-5 shrink-0 cursor-help text-emerald-500" />
                    </InfoTooltip>
                  </CardHeader>
                  <CardContent>
                    <div className="text-4xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{trocasStats.acertividade}%</div>
                    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${trocasStats.acertividade}%` }} />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/50 bg-card/80 shadow-sm backdrop-blur-sm">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Média Bateria</CardTitle>
                    <InfoTooltip text={"Nível médio de carga das baterias\nem operação no período"}>
                      <BatteryCharging className="size-5 shrink-0 cursor-help text-sky-500" />
                    </InfoTooltip>
                  </CardHeader>
                  <CardContent>
                    <div className="text-4xl font-bold tabular-nums text-sky-600 dark:text-sky-400">{trocasStats.mediaBateria}%</div>
                    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${trocasStats.mediaBateria}%` }} />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Dois cards lado a lado: Ranking (esq) | Diagnóstico (dir) */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Ranking de Trocas */}
                <Card className="border-border/50 bg-card/80 shadow-sm backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-foreground">
                      <Trophy className="h-5 w-5 text-amber-500" /> Ranking de Trocas
                    </CardTitle>
                    <CardDescription>Setores com maior quantidade de trocas</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/25 hover:bg-muted/25">
                          <TableHead className="w-8">#</TableHead>
                          <TableHead>Sub</TableHead>
                          <TableHead>Setor</TableHead>
                          <TableHead className="text-center">Trocas</TableHead>
                          <TableHead className="text-center">Manut.</TableHead>
                          <TableHead className="text-center">Méd. dur.</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {trocasRanking.map((r, i) => (
                          <TableRow key={r.setor} className="border-border/30 hover:bg-muted/20">
                            <TableCell className="font-bold tabular-nums text-muted-foreground">{i + 1}</TableCell>
                            <TableCell className="font-medium">{r.subprefeitura}</TableCell>
                            <TableCell><SetorCell value={r.setor} /></TableCell>
                            <TableCell className="text-center font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{r.totalTrocas}</TableCell>
                            <TableCell className="text-center tabular-nums text-muted-foreground">{r.manutencoes}</TableCell>
                            <TableCell className="text-center tabular-nums text-sky-600 dark:text-sky-400">{r.mediaDuracao}d</TableCell>
                          </TableRow>
                        ))}
                        {trocasRanking.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">Sem dados de trocas.</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* Diagnóstico de Baterias em operação */}
                <Card className="border-border/50 bg-card/80 shadow-sm backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-foreground">
                      <Battery className="h-5 w-5 text-emerald-500" /> Diagnóstico de Baterias em operação
                    </CardTitle>
                    <CardDescription>Distribuição por sinal e nível de bateria</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1.5">
                      {[
                        { kind: "head-green", label: "COM SINAL", value: batteryDiagnostic.comSinal, note: "" },
                        { kind: "value", label: "B/ ALTA", value: batteryDiagnostic.alta, note: ">70%", text: "text-emerald-600 dark:text-emerald-400" },
                        { kind: "value", label: "B/ REGULAR", value: batteryDiagnostic.regular, note: ">30%", text: "text-orange-600 dark:text-orange-400" },
                        { kind: "value", label: "B/ BAIXA", value: batteryDiagnostic.baixa, note: ">15%", text: "text-blue-600 dark:text-blue-400" },
                        { kind: "value", label: "B/ CRÍTICA", value: batteryDiagnostic.critica, note: "<14%", text: "text-red-600 dark:text-red-500" },
                        { kind: "head-red", label: "SEM SINAL", value: batteryDiagnostic.semSinal, note: "" },
                        { kind: "value", label: "B/ DESATUALIZADA", value: batteryDiagnostic.desatualizada, note: "", text: "text-red-600 dark:text-red-500" },
                      ].map((row, i) => {
                        const isGreen = row.kind === "head-green";
                        const isRed = row.kind === "head-red";
                        const isHeader = isGreen || isRed;
                        const headBg = isGreen ? "bg-emerald-700" : "bg-red-600";
                        return (
                          <div key={i} className="flex items-center gap-2">
                            <div className="grid flex-1 grid-cols-[minmax(0,1fr)_72px] overflow-hidden rounded-md border border-border/60">
                              <div className={cn(
                                "px-3 py-2 text-xs font-semibold",
                                isHeader ? cn(headBg, "font-bold uppercase tracking-wide text-white") : "bg-muted/20 text-foreground",
                              )}>
                                {row.label}
                              </div>
                              <div className={cn(
                                "border-l px-3 py-2 text-right text-sm font-bold tabular-nums",
                                isHeader ? cn(headBg, "border-white/25 text-white") : cn("border-border/60", row.text),
                              )}>
                                {row.value}
                              </div>
                            </div>
                            <div className="w-10 shrink-0 text-[11px] font-semibold text-muted-foreground">{row.note}</div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Listagem Geral de setores */}
              <Card className="border-border/50 bg-card/80 shadow-sm backdrop-blur-sm">
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-foreground">
                        <Table2 className="h-5 w-5 text-emerald-500" /> Listagem Geral de Setores
                      </CardTitle>
                      <CardDescription>Base para seleção e agendamento de trocas (em construção)</CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative w-[220px]">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          placeholder="Buscar setor, SELIMP..."
                          className="h-9 pl-9"
                          value={trocasSearch}
                          onChange={(e) => setTrocasSearch(e.target.value)}
                        />
                      </div>
                      <Select value={trocasSubFilter} onValueChange={setTrocasSubFilter}>
                        <SelectTrigger className="h-9 w-[130px]">
                          <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
                          <SelectValue placeholder="Sub" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todas</SelectItem>
                          {uniqueSubs.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-hidden rounded-xl bg-muted/15 shadow-sm ring-1 ring-zinc-200/80 dark:ring-zinc-700/60">
                    <Table className="[&_tbody_tr]:border-b [&_tbody_tr]:border-border/30 [&_thead_tr]:border-b [&_thead_tr]:border-border/30">
                      <TableHeader>
                        <TableRow className="bg-muted/25 hover:bg-muted/25">
                          <TableHead className="text-center">Sub</TableHead>
                          <TableHead>Setor</TableHead>
                          <TableHead>SELIMP</TableHead>
                          <TableHead>Comunic.</TableHead>
                          <TableHead>Bateria</TableHead>
                          <TableHead>Status Bat.</TableHead>
                          <TableHead className="text-center">Trocas</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {trocasModules.map((m) => (
                          <TableRow key={m.id} className="border-border/30 hover:bg-muted/20">
                            <TableCell className="text-center font-medium align-top">{m.subprefeitura}</TableCell>
                            <TableCell className="align-top"><SetorCell value={m.setor} /></TableCell>
                            <TableCell>{m.numeroSelimp}</TableCell>
                            <TableCell>
                              <Badge className={m.comunicacao === "ON"
                                ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400"
                                : "bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400"
                              }>
                                {m.comunicacao}
                              </Badge>
                            </TableCell>
                            <TableCell>{m.bateriaPercentual}%</TableCell>
                            <TableCell>
                              <Badge className={
                                m.statusBateria === "ALTA"
                                  ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400"
                                  : m.statusBateria === "REGULAR"
                                  ? "bg-orange-500/15 text-orange-600 border-orange-500/30 dark:text-orange-400"
                                  : m.statusBateria === "BAIXA"
                                  ? "bg-blue-500/15 text-blue-600 border-blue-500/30 dark:text-blue-400"
                                  : m.statusBateria === "CRÍTICA"
                                  ? "bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400"
                                  : "bg-zinc-500/15 text-zinc-600 border-zinc-500/30 dark:text-zinc-300"
                              }>
                                {m.statusBateria}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center font-medium tabular-nums">{m.quantidadeTrocas}</TableCell>
                          </TableRow>
                        ))}
                        {trocasModules.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">Nenhum setor encontrado.</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Exibindo até 60 setores. Seleção múltipla, agendamento e filtros avançados de troca serão adicionados em seguida.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ===== MANUTENÇÕES TAB ===== */}
            <TabsContent value="maintenance">
              <Card className="border-border/50 bg-card/80 shadow-sm backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-foreground">
                    <Wrench className="h-5 w-5 text-emerald-500" /> Manutenções
                  </CardTitle>
                  <CardDescription>Registro e acompanhamento de manutenções dos módulos</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
                    <Wrench className="mb-4 h-12 w-12 opacity-40" />
                    <p className="text-lg font-medium">Página em construção</p>
                    <p className="mt-1 max-w-md text-sm">
                      A dinâmica de manutenções será definida em seguida. Por ora, este é o esqueleto da aba.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ===== MODULES TAB ===== */}
            <TabsContent value="modules">
              <Card className="border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
                <CardHeader>
                  <div className="flex justify-between">
                    <div>
                      <CardTitle className="text-foreground">Módulos e baterias</CardTitle>
                      <CardDescription>Lista completa de dispositivos monitorados — produtividade, alertas e baterias</CardDescription>
                    </div>
                    <Button variant="outline" onClick={() => exportCSV(filteredModules)}>
                      <Download className="mr-2 h-4 w-4" /> Exportar CSV
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {[
                      {
                        title: "Produtividade Média",
                        value: `${stats.avgProductivity}%`,
                        desc: "Dias ON / Total",
                        icon: TrendingUp,
                        color: "text-emerald-600 dark:text-emerald-400",
                      },
                      {
                        title: "Alertas Críticos",
                        value: stats.criticalAlerts,
                        desc: "Requerem atenção",
                        icon: AlertTriangle,
                        color: "text-red-500",
                      },
                      {
                        title: "Bateria Baixa",
                        value: stats.lowBattery,
                        desc: "Necessitam troca",
                        icon: Battery,
                        color: "text-yellow-500",
                      },
                    ].map((kpi) => (
                      <Card key={kpi.title} className="border-border/50 bg-muted/15 shadow-inner">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.title}</CardTitle>
                          <kpi.icon className={cn("size-4", kpi.color)} />
                        </CardHeader>
                        <CardContent>
                          <div className={cn("text-2xl font-bold tabular-nums", kpi.color)}>{kpi.value}</div>
                          <p className="text-xs text-muted-foreground">{kpi.desc}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  {/* Search */}
                  <div className="mb-4">
                    <div className="relative w-full max-w-[420px]">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Buscar setor, SELIMP..."
                        className="pl-9"
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                      />
                    </div>
                  </div>

                  {/* Filters */}
                  <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                    <div className="space-y-1">
                      <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5" /> Subprefeitura
                      </p>
                      <Select value={subFilter} onValueChange={(v) => { setSubFilter(v); setCurrentPage(1); }}>
                        <SelectTrigger className="w-full">
                          <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
                          <SelectValue placeholder="Sub" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todas</SelectItem>
                          {uniqueSubs.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        <Wifi className="h-3.5 w-3.5" /> Comunicação do módulo	
                      </p>
                      <Select value={communicationFilter} onValueChange={(v) => { setCommunicationFilter(v); setCurrentPage(1); }}>
                        <SelectTrigger className="w-full">
                          <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
                          <SelectValue placeholder="Comunicação" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todas</SelectItem>
                          <SelectItem value="online">Online</SelectItem>
                          <SelectItem value="offline">Offline</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        <Activity className="h-3.5 w-3.5" /> Sinal / Status do módulo
                      </p>
                      <Select value={signalFilter} onValueChange={(v) => { setSignalFilter(v); setCurrentPage(1); }}>
                        <SelectTrigger className="w-full">
                          <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
                          <SelectValue placeholder="Sinal" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todas</SelectItem>
                          <SelectItem value="com-sinal">Com sinal</SelectItem>
                          <SelectItem value="sem-sinal">Sem sinal</SelectItem>
                          <SelectItem value="manutencao">Manutenção</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        <Battery className="h-3.5 w-3.5" /> Status da Bateria
                      </p>
                      <Select value={batteryFilter} onValueChange={(v) => { setBatteryFilter(v); setCurrentPage(1); }}>
                        <SelectTrigger className="w-full">
                          <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
                          <SelectValue placeholder="Bateria" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todas</SelectItem>
                          <SelectItem value="critico">Crítico (&lt; 20%)</SelectItem>
                          <SelectItem value="baixo">Baixo (20% - 50%)</SelectItem>
                          <SelectItem value="operacional">Operacional (50% - 80%)</SelectItem>
                          <SelectItem value="cheia">Cheia (&gt; 80%)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        <ShieldAlert className="h-3.5 w-3.5" /> Produtividade Geral
                      </p>
                      <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}>
                        <SelectTrigger className="w-full">
                          <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos</SelectItem>
                          <SelectItem value="baixa">Baixa (&lt; 20%)</SelectItem>
                          <SelectItem value="atencao">Atenção (20% - 40%)</SelectItem>
                          <SelectItem value="alerta">Alerta (40% - 60%)</SelectItem>
                          <SelectItem value="alta">Alta (&gt; 60%)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Table */}
                  <div className="overflow-hidden rounded-xl bg-muted/15 shadow-sm ring-1 ring-zinc-200/80 dark:ring-zinc-700/60">
                    <Table className="[&_tbody_tr]:border-b [&_tbody_tr]:border-border/30 [&_thead_tr]:border-b [&_thead_tr]:border-border/30">
                      <TableHeader>
                        <TableRow className="bg-muted/25 hover:bg-muted/25">
                          <TableHead className="text-center">
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5" /> Sub
                            </span>
                          </TableHead>
                          <TableHead>
                            <span className="inline-flex items-center gap-1">
                              <LayoutDashboard className="h-3.5 w-3.5" /> Setor
                            </span>
                          </TableHead>
                          <TableHead>
                            <span className="inline-flex items-center gap-1">
                              <Hash className="h-3.5 w-3.5" /> SELIMP
                            </span>
                          </TableHead>
                          <TableHead>Dias Exec.</TableHead>
                          <TableHead>
                            <span className="inline-flex items-center gap-1">
                              <Wifi className="h-3.5 w-3.5" /> Comunic.
                            </span>
                          </TableHead>
                          <TableHead>
                            <span className="inline-flex items-center gap-1">
                              <Battery className="h-3.5 w-3.5" /> Bateria
                            </span>
                          </TableHead>
                          <TableHead>
                            <span className="inline-flex items-center gap-1">
                              <Activity className="h-3.5 w-3.5" /> Sinal
                            </span>
                          </TableHead>
                          <TableHead>Status Bat.</TableHead>
                          <TableHead>Dias ON</TableHead>
                          <TableHead>Dias OFF</TableHead>
                          <TableHead>Produtiv.</TableHead>
                          <TableHead>
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5" /> Instalação
                            </span>
                          </TableHead>
                          <TableHead>Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedModules.map((m) => (
                          <TableRow key={m.id} className="border-border/30 hover:bg-muted/20">
                            <TableCell className="text-center font-medium align-top">{m.subprefeitura}</TableCell>
                            <TableCell className="align-top"><SetorCell value={m.setor} /></TableCell>
                            <TableCell>{m.numeroSelimp}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{m.diasExecucao}</TableCell>
                            <TableCell>
                              <Badge className={m.comunicacao === "ON"
                                ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400"
                                : "bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400"
                              }>
                                {m.comunicacao}
                              </Badge>
                            </TableCell>
                            <TableCell>{m.bateriaPercentual}%</TableCell>
                            <TableCell>
                              <Badge className={
                                m.statusSinalGeral === "COM SINAL"
                                  ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400"
                                  : m.statusSinalGeral === "SEM SINAL"
                                  ? "bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400"
                                  : "bg-yellow-500/15 text-yellow-600 border-yellow-500/30 dark:text-yellow-400"
                              }>
                                {m.statusSinalGeral}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge className={
                                m.statusBateria === "ALTA"
                                  ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400"
                                  : m.statusBateria === "REGULAR"
                                  ? "bg-orange-500/15 text-orange-600 border-orange-500/30 dark:text-orange-400"
                                  : m.statusBateria === "BAIXA"
                                  ? "bg-blue-500/15 text-blue-600 border-blue-500/30 dark:text-blue-400"
                                  : m.statusBateria === "CRÍTICA"
                                  ? "bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400"
                                  : "bg-zinc-500/15 text-zinc-600 border-zinc-500/30 dark:text-zinc-300"
                              }>
                                {m.statusBateria}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-emerald-600 dark:text-emerald-400 font-medium">{m.diasOn}</TableCell>
                            <TableCell className="text-red-600 dark:text-red-400 font-medium">{m.diasOff}</TableCell>
                            <TableCell className={cn("font-medium", getProductivityColor(m.produtividade))}>{m.produtividade}%</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatIptDataInstalacaoBr(m.dataInstalacao) || "—"}
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                  <DropdownMenuItem onClick={() => setDetailModule(m)}>
                                    <Eye className="mr-2 h-4 w-4" /> Ver Detalhes
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setNewDispatch({ module: m.numeroSelimp, type: "", description: "" }); setDispatchDialogOpen(true); }}>
                                    <FileText className="mr-2 h-4 w-4" /> Gerar Despacho
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Pagination */}
                  <div className="flex items-center justify-between mt-4">
                    <span className="text-sm text-muted-foreground">
                      Página {currentPage} de {totalPages} ({filteredModules.length} módulos)
                    </span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Detail Dialog */}
        <Dialog open={!!detailModule} onOpenChange={() => setDetailModule(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Detalhes do Módulo</DialogTitle>
              <DialogDescription>{detailModule?.setor}</DialogDescription>
            </DialogHeader>
            {detailModule && (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-muted p-3"><span className="text-xs text-muted-foreground block">Subprefeitura</span><span className="font-medium">{detailModule.subprefeitura}</span></div>
                <div className="rounded-lg bg-muted p-3"><span className="text-xs text-muted-foreground block">SELIMP</span><span className="font-medium">{detailModule.numeroSelimp}</span></div>
                <div className="rounded-lg bg-muted p-3"><span className="text-xs text-muted-foreground block">Comunicação</span><Badge className={detailModule.comunicacao === "ON" ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" : "bg-red-500/15 text-red-600 border-red-500/30"}>{detailModule.comunicacao}</Badge></div>
                <div className="rounded-lg bg-muted p-3"><span className="text-xs text-muted-foreground block">Bateria</span><span className="font-medium">{detailModule.bateria}</span></div>
                <div className="rounded-lg bg-muted p-3"><span className="text-xs text-muted-foreground block">Status Sinal</span><span className="font-medium">{detailModule.statusSinalGeral}</span></div>
                <div className="rounded-lg bg-muted p-3"><span className="text-xs text-muted-foreground block">Status Bateria</span><span className="font-medium">{detailModule.statusBateria}</span></div>
                <div className="rounded-lg bg-muted p-3"><span className="text-xs text-muted-foreground block">Dias Execução</span><span className="font-medium">{detailModule.diasExecucao}</span></div>
                <div className="rounded-lg bg-muted p-3"><span className="text-xs text-muted-foreground block">Data Instalação</span><span className="font-medium">{formatIptDataInstalacaoBr(detailModule.dataInstalacao) || "—"}</span></div>
                <div className="rounded-lg bg-muted p-3"><span className="text-xs text-muted-foreground block">Última Comunicação</span><span className="font-medium text-xs">{detailModule.ultimaComunicacao}</span></div>
                <div className="rounded-lg bg-muted p-3"><span className="text-xs text-muted-foreground block">Qtd Trocas</span><span className="font-medium">{detailModule.quantidadeTrocas}</span></div>
                <div className="rounded-lg bg-muted p-3"><span className="text-xs text-muted-foreground block">Dias ON</span><span className="font-medium text-emerald-600 dark:text-emerald-400">{detailModule.diasOn}</span></div>
                <div className="rounded-lg bg-muted p-3"><span className="text-xs text-muted-foreground block">Dias OFF</span><span className="font-medium text-red-600 dark:text-red-400">{detailModule.diasOff}</span></div>
                <div className="col-span-2 rounded-lg bg-muted p-3"><span className="text-xs text-muted-foreground block">Produtividade</span><span className={cn("text-2xl font-bold", getProductivityColor(detailModule.produtividade))}>{detailModule.produtividade}%</span></div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* New Dispatch Dialog */}
        <Dialog open={dispatchDialogOpen} onOpenChange={setDispatchDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo Despacho</DialogTitle>
              <DialogDescription>
                Registrar nova ação de manutenção. O envio estará disponível em breve — use o formulário para pré-visualizar os campos.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <Select value={newDispatch.module} onValueChange={(v) => setNewDispatch((prev) => ({ ...prev, module: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar módulo" />
                </SelectTrigger>
                <SelectContent className="max-h-[200px]">
                  {criticalModules.length > 0 && criticalModules.slice(0, 10).map((m) => (
                    <SelectItem key={`c-${m.id}`} value={m.numeroSelimp}>
                      <span className="flex items-center gap-2"><AlertCircle className="h-3 w-3 text-red-500" />{m.numeroSelimp} - {m.setor}</span>
                    </SelectItem>
                  ))}
                  {modules.filter((m) => !criticalModules.find((c) => c.id === m.id)).slice(0, 20).map((m) => (
                    <SelectItem key={m.id} value={m.numeroSelimp}>{m.numeroSelimp} - {m.setor}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={newDispatch.type} onValueChange={(v) => setNewDispatch((prev) => ({ ...prev, type: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Tipo de serviço" />
                </SelectTrigger>
                <SelectContent>
                  {DISPATCH_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea
                placeholder="Descrição (opcional)"
                value={newDispatch.description}
                onChange={(e) => setNewDispatch((prev) => ({ ...prev, description: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDispatchDialogOpen(false)}>Cancelar</Button>
              <Button
                type="button"
                className="bg-emerald-500 text-white hover:bg-emerald-600"
                disabled
                title="Disponível em breve"
              >
                Criar Despacho
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
