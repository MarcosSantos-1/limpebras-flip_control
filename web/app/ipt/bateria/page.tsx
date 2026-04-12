"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Battery,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Eye,
  FileText,
  Filter,
  Hash,
  LayoutDashboard,
  MapPin,
  MoreHorizontal,
  Plus,
  Search,
  ShieldAlert,
  Table2,
  TrendingUp,
  Wifi,
  WifiOff,
  Calendar,
} from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
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

interface Dispatch {
  id: string;
  date: string;
  time: string;
  module: string;
  setor: string;
  type: string;
  description: string;
  status: "pending" | "completed" | "in-progress";
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
  primary: "#10b981",
};

const ITEMS_PER_PAGE = 15;

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
    return { subprefeitura: sub, total, online, offline: total - online };
  });
}

function getBatteryDistribution(data: ModuleData[]) {
  const labels: Record<string, string> = {
    CHEIA: "Cheia",
    OPERACIONAL: "Operacional",
    BAIXA: "Baixa",
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
    { range: "90-100%", count: data.filter((m) => m.produtividade >= 90).length },
    { range: "70-89%", count: data.filter((m) => m.produtividade >= 70 && m.produtividade < 90).length },
    { range: "50-69%", count: data.filter((m) => m.produtividade >= 50 && m.produtividade < 70).length },
    { range: "< 50%", count: data.filter((m) => m.produtividade < 50).length },
  ];
}

function getCriticalModules(data: ModuleData[]) {
  return data.filter(
    (m) => m.comunicacao === "OFF" || m.statusBateria === "DESATUALIZADA" || m.produtividade < 50
  );
}

function getProductivityColor(value: number) {
  if (value >= 90) return "text-emerald-500";
  if (value >= 70) return "text-green-500";
  if (value >= 50) return "text-yellow-500";
  return "text-red-500";
}

function getAlertType(m: ModuleData): { type: string; icon: typeof WifiOff; color: string; message: string } {
  if (m.comunicacao === "OFF") return { type: "offline", icon: WifiOff, color: "text-red-500", message: "Módulo sem comunicação" };
  if (m.statusBateria === "DESATUALIZADA") return { type: "battery", icon: Battery, color: "text-yellow-500", message: "Bateria desatualizada" };
  return { type: "productivity", icon: AlertTriangle, color: "text-red-500", message: "Produtividade crítica" };
}

/** Badge por subprefeitura na aba Alertas: CV verde, MG ciano, JT azul escuro, ST amarelo */
function getSubprefBadgeClass(sub: string): string {
  const s = sub.trim().toUpperCase();
  switch (s) {
    case "CV":
      return "border-emerald-500/40 bg-emerald-500/12 text-emerald-800 dark:text-emerald-300";
    case "MG":
      return "border-cyan-500/40 bg-cyan-500/12 text-cyan-900 dark:text-cyan-300";
    case "JT":
      return "border-blue-900/45 bg-blue-950/25 text-blue-950 dark:border-blue-600 dark:bg-blue-950/50 dark:text-blue-200";
    case "ST":
      return "border-amber-400/50 bg-amber-400/15 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200";
    default:
      return "border-border/60 bg-muted/40 text-muted-foreground";
  }
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
  return (props: PieLabelRenderProps) => {
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
  };
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
  const [alertSearch, setAlertSearch] = useState("");
  const [subFilter, setSubFilter] = useState("all");
  const [communicationFilter, setCommunicationFilter] = useState("all");
  const [signalFilter, setSignalFilter] = useState("all");
  const [batteryFilter, setBatteryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [dispatchDialogOpen, setDispatchDialogOpen] = useState(false);
  const [newDispatch, setNewDispatch] = useState({ module: "", type: "", description: "" });
  const [detailModule, setDetailModule] = useState<ModuleData | null>(null);
  const [chartsReady, setChartsReady] = useState(false);
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

  const filteredAlerts = useMemo(() => {
    if (!alertSearch) return criticalModules;
    const term = alertSearch.toLowerCase();
    return criticalModules.filter(
      (m) =>
        m.setor.toLowerCase().includes(term) ||
        m.numeroSelimp.toLowerCase().includes(term) ||
        m.subprefeitura.toLowerCase().includes(term)
    );
  }, [criticalModules, alertSearch]);

  const PROD_COLORS = [CHART_COLORS.success, CHART_COLORS.primary, CHART_COLORS.warning, CHART_COLORS.error];
  const BATTERY_COLORS = [CHART_COLORS.success, CHART_COLORS.info, CHART_COLORS.warning, CHART_COLORS.error];
  const SIGNAL_COLORS = [CHART_COLORS.success, CHART_COLORS.error, CHART_COLORS.warning];

  const uniqueSubs = useMemo(() => {
    const set = new Set(modules.map((m) => m.subprefeitura).filter(Boolean));
    return Array.from(set).sort();
  }, [modules]);

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
                  <h1 className="text-xl font-bold text-foreground">Monitoramento de Módulos</h1>
                  <p className="text-xs text-muted-foreground">Dashboard de Análise de Bateria e Sinal</p>
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
              <TabsTrigger value="modules" className="data-[state=active]:bg-emerald-500 data-[state=active]:text-white text-muted-foreground">
                <Table2 className="mr-2 h-4 w-4" /> Módulos
              </TabsTrigger>
              <TabsTrigger value="alerts" className="data-[state=active]:bg-emerald-500 data-[state=active]:text-white text-muted-foreground">
                <AlertTriangle className="mr-2 h-4 w-4" /> Alertas
                {criticalModules.length > 0 && (
                  <span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">
                    {criticalModules.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="dispatch" className="data-[state=active]:bg-emerald-500 data-[state=active]:text-white text-muted-foreground">
                <FileText className="mr-2 h-4 w-4" /> Despachos
              </TabsTrigger>
            </TabsList>

            {/* ===== OVERVIEW TAB ===== */}
            <TabsContent value="overview" className="space-y-6">
              {/* KPI Cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {[
                  { title: "Total de Módulos", value: stats.total, desc: "Dispositivos monitorados", icon: Activity, color: "text-foreground" },
                  { title: "Online", value: stats.online, desc: `${stats.total > 0 ? Math.round((stats.online / stats.total) * 100) : 0}% operacionais`, icon: Wifi, color: "text-emerald-500" },
                  { title: "Offline", value: stats.offline, desc: "Sem comunicação", icon: WifiOff, color: "text-red-500" },
                  { title: "Produtividade Média", value: `${stats.avgProductivity}%`, desc: "Dias ON / Total", icon: TrendingUp, color: "text-emerald-600 dark:text-emerald-400" },
                  { title: "Alertas Críticos", value: stats.criticalAlerts, desc: "Requerem atenção", icon: AlertTriangle, color: "text-red-500" },
                  { title: "Bateria Baixa", value: stats.lowBattery, desc: "Necessitam troca", icon: Battery, color: "text-yellow-500" },
                ].map((kpi) => (
                  <Card key={kpi.title} className="border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.title}</CardTitle>
                      <kpi.icon className={cn("h-4 w-4", kpi.color)} />
                    </CardHeader>
                    <CardContent>
                      <div className={cn("text-2xl font-bold", kpi.color)}>{kpi.value}</div>
                      <p className="text-xs text-muted-foreground">{kpi.desc}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Charts */}
              {chartsReady && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Status por Subprefeitura */}
                  <Card className="col-span-2 border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-foreground">Status por Subprefeitura</CardTitle>
                      <CardDescription>Online vs Offline por região</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={subChartData} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
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
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  {/* Distribuição de Produtividade */}
                  <Card className="col-span-2 border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-foreground">Distribuição de Produtividade</CardTitle>
                      <CardDescription>Faixas de produtividade dos módulos</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={prodChartData} layout="vertical" margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
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
                    </CardContent>
                  </Card>

                  {/* Status de Bateria (Donut) */}
                  <Card className="col-span-2 overflow-visible border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-foreground">Status de Bateria</CardTitle>
                      <CardDescription>Distribuição do status atual</CardDescription>
                    </CardHeader>
                    <CardContent className="overflow-visible">
                      <div className="h-[320px] w-full overflow-visible [&_.recharts-surface]:overflow-visible">
                        <ResponsiveContainer width="100%" height="100%">
                        <PieChart margin={{ top: 28, right: 112, bottom: 28, left: 112 }}>
                          <Pie
                            data={batteryChartData}
                            dataKey="count"
                            nameKey="status"
                            cx="50%"
                            cy="50%"
                            innerRadius={56}
                            outerRadius={92}
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
                            {...legendProps}
                            formatter={(value) => <span style={{ color: axisTickColor }}>{String(value)}</span>}
                          />
                        </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Status de Sinal (Donut) */}
                  <Card className="col-span-2 overflow-visible border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-foreground">Status de Sinal</CardTitle>
                      <CardDescription>Distribuição de comunicação</CardDescription>
                    </CardHeader>
                    <CardContent className="overflow-visible">
                      <div className="h-[320px] w-full overflow-visible [&_.recharts-surface]:overflow-visible">
                        <ResponsiveContainer width="100%" height="100%">
                        <PieChart margin={{ top: 28, right: 112, bottom: 28, left: 112 }}>
                          <Pie
                            data={signalChartData}
                            dataKey="count"
                            nameKey="status"
                            cx="50%"
                            cy="50%"
                            innerRadius={56}
                            outerRadius={92}
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
                            {...legendProps}
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

            {/* ===== MODULES TAB ===== */}
            <TabsContent value="modules">
              <Card className="border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
                <CardHeader>
                  <div className="flex justify-between">
                    <div>
                      <CardTitle className="text-foreground">Módulos</CardTitle>
                      <CardDescription>Lista completa de dispositivos monitorados</CardDescription>
                    </div>
                    <Button variant="outline" onClick={() => exportCSV(filteredModules)}>
                      <Download className="mr-2 h-4 w-4" /> Exportar CSV
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
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
                                m.statusBateria === "CHEIA"
                                  ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400"
                                  : m.statusBateria === "OPERACIONAL"
                                  ? "bg-blue-500/15 text-blue-600 border-blue-500/30 dark:text-blue-400"
                                  : m.statusBateria === "BAIXA"
                                  ? "bg-yellow-500/15 text-yellow-600 border-yellow-500/30 dark:text-yellow-400"
                                  : "bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400"
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

            {/* ===== ALERTS TAB ===== */}
            <TabsContent value="alerts">
              <Card className="border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
                <CardHeader>
                  <div className="flex justify-between">
                    <CardTitle className="flex items-center gap-2 text-foreground">
                      <AlertTriangle className="h-5 w-5 text-red-500" />
                      Alertas Críticos
                    </CardTitle>
                    <Badge className="bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400">{criticalModules.length} alertas</Badge>
                  </div>
                  <div className="relative mt-3">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Buscar setor, módulo, subprefeitura..."
                      className="pl-9"
                      value={alertSearch}
                      onChange={(e) => setAlertSearch(e.target.value)}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[500px]">
                    <div className="space-y-3 pr-4">
                      {filteredAlerts.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                          <CheckCircle2 className="h-12 w-12 mb-4 text-emerald-500" />
                          <p className="text-lg font-medium">{alertSearch ? "Nenhum resultado encontrado" : "Nenhum alerta crítico"}</p>
                          <p className="text-sm">{alertSearch ? "Tente outro termo de busca." : "Todos os módulos estão operando normalmente."}</p>
                        </div>
                      )}
                      {filteredAlerts.map((m) => {
                        const alert = getAlertType(m);
                        const AlertIcon = alert.icon;
                        return (
                          <div key={m.id} className="flex items-start gap-4 rounded-lg border border-border bg-muted/30 p-4 hover:bg-muted/50 transition-colors">
                            <div className="rounded-full p-2 bg-muted">
                              <AlertIcon className={cn("h-4 w-4", alert.color)} />
                            </div>
                            <div className="flex-1 space-y-1">
                              <div className="flex justify-between">
                                <p className="font-medium text-foreground">{m.setor}</p>
                                <Badge variant="outline" className={cn("text-xs font-medium", getSubprefBadgeClass(m.subprefeitura))}>
                                  {m.subprefeitura}
                                </Badge>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className={cn("text-sm", alert.color)}>{alert.message}</p>
                                {alert.type === "productivity" && (
                                  <Badge
                                    variant="outline"
                                    className="border-sky-500/45 bg-sky-500/10 text-[11px] font-semibold text-sky-900 shadow-sm dark:border-sky-400/35 dark:bg-sky-950/50 dark:text-sky-100"
                                  >
                                    — Data de instalação: {formatIptDataInstalacaoBr(m.dataInstalacao) || "—"}
                                  </Badge>
                                )}
                              </div>
                              <div className="flex gap-4 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {m.ultimaComunicacao || "Sem dados"}</span>
                                <span>Produtividade: {m.produtividade}%</span>
                              </div>
                              <div className="flex gap-2 text-xs text-muted-foreground pt-2">
                                <span>SELIMP: {m.numeroSelimp}</span>
                                <span>Bateria: {m.bateriaPercentual}%</span>
                                {m.diasOff > 0 && <span>{m.diasOff} dias offline</span>}
                              </div>
                            </div>
                            <Button variant="ghost" size="icon" onClick={() => setDetailModule(m)}>
                              <ArrowRight className="h-4 w-4" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ===== DISPATCH TAB ===== */}
            <TabsContent value="dispatch">
              <Card className="border-border/50 bg-card/80 backdrop-blur-sm shadow-sm">
                <CardHeader>
                  <div className="flex justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-foreground">
                        <FileText className="h-5 w-5 text-emerald-500" />
                        Despachos Diários
                      </CardTitle>
                      <CardDescription>Registro de ações e manutenções</CardDescription>
                    </div>
                    <Button className="bg-emerald-500 text-white hover:bg-emerald-600" onClick={() => setDispatchDialogOpen(true)}>
                      <Plus className="mr-2 h-4 w-4" /> Novo Despacho
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {dispatches.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                        <FileText className="h-12 w-12 mb-4 opacity-50" />
                        <p className="text-lg font-medium">Nenhum despacho registrado</p>
                        <p className="text-sm">Clique em &quot;Novo Despacho&quot; para criar.</p>
                      </div>
                    )}
                    {dispatches.map((d) => {
                      const statusConfig = {
                        pending: { badge: "Pendente", badgeClass: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30 dark:text-yellow-400", icon: AlertCircle, iconColor: "text-yellow-500" },
                        "in-progress": { badge: "Em Andamento", badgeClass: "bg-blue-500/15 text-blue-600 border-blue-500/30 dark:text-blue-400", icon: Clock, iconColor: "text-blue-500" },
                        completed: { badge: "Concluído", badgeClass: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400", icon: CheckCircle2, iconColor: "text-emerald-500" },
                      }[d.status];
                      const StatusIcon = statusConfig.icon;
                      return (
                        <div key={d.id} className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-4 hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-4">
                            <div className={cn("rounded-full p-2 bg-muted", statusConfig.iconColor)}>
                              <StatusIcon className="h-4 w-4" />
                            </div>
                            <div>
                              <div className="flex gap-2">
                                <p className="font-medium text-foreground">{d.type}</p>
                                <Badge className={statusConfig.badgeClass}>{statusConfig.badge}</Badge>
                              </div>
                              <p className="text-sm text-muted-foreground">{d.module} - {d.setor}</p>
                              {d.description && <p className="text-xs text-muted-foreground mt-1">{d.description}</p>}
                            </div>
                          </div>
                          <div className="text-right text-xs text-muted-foreground">
                            <div className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {d.date}</div>
                            <div className="flex items-center gap-1"><Clock className="h-3 w-3" /> {d.time}</div>
                          </div>
                        </div>
                      );
                    })}
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
