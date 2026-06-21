"use client";

import type { CSSProperties, ReactNode } from "react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Battery,
  BatteryCharging,
  Bell,
  BellRing,
  CalendarCheck2,
  CalendarPlus,
  Check,
  CheckCircle2,
  CheckSquare,
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Eye,
  Filter,
  Gauge,
  Hash,
  History,
  Info,
  LayoutDashboard,
  MapPin,
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
  X,
  XCircle,
  Calendar,
  Plus,
  Trash2,
  RefreshCw,
  Pencil,
  PackageX,
  PackageCheck,
  Copy,
  Upload,
  FileText,
} from "lucide-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTree, faBroom } from "@fortawesome/free-solid-svg-icons";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import { MultiSelect } from "@/components/ui/multi-select";
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
import { toast } from "react-toastify";
import { apiService } from "@/lib/api";
import { formatIptDataInstalacaoBr, servicoLabel, mesCorrenteLabel } from "@/lib/ipt-utils";
import { SetoresTab } from "./setores-tab";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { uploadManutencaoDoc } from "@/lib/firebase-manutencao-docs";
import { cn } from "@/lib/utils";
import {
  useTrocaState,
  computeAlerta,
  type AlertaInfo,
  type TrocaHistoryRecord,
  type TrocaRecord,
} from "./troca-state";
import {
  useManutencaoState,
  historicoFromManutencao,
} from "./manutencao-state";
import {
  useModuloManutencaoState,
  MANUT_STATUS_LABEL,
  MANUT_STATUS_ORDER,
  type ManutencaoModuloStatus,
  type ModuloManutencaoEvento,
} from "./modulo-manutencao-state";

// --- Types ---

interface ModuleData {
  id: number;
  subprefeitura: string;
  setor: string;
  numeroSelimp: string;
  diasExecucao: string;
  setoresDias?: ModuleSetorDia[];
  produtividadeExecucao?: number | null;
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
  diasOffConsecutivos?: number;
  produtividade: number;
  contagemDesde?: string | null;
  bateriaPorDia?: BateriaDia[];
}

interface ExecucaoSelimpDia {
  data: string;
  percentual: number;
}

interface BateriaDia {
  data: string;
  percentual: number | null;
  desatualizada: boolean;
}

interface ModuleSetorDia {
  setor: string;
  dias: string;
  km?: number | null;
  praca?: string | null;
  execucao?: number | null;
  execucoes?: ExecucaoSelimpDia[];
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
  evolucaoProdutividade?: { data: string; produtividade: number }[];
  execucaoPorServicoSub?: { servico: string; sub: string; execucao: number }[];
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

/** Cor por subprefeitura (barras agrupadas de execução por serviço × sub). */
const SUB_CHART_COLORS: Record<string, string> = {
  CV: "#3b82f6",
  JT: "#f97316",
  MG: "#10b981",
  ST: "#a855f7",
};

/** Ordem fixa das subprefeituras nas barras agrupadas. */
const SUB_ORDER = ["CV", "JT", "MG", "ST"] as const;

const ITEMS_PER_PAGE = 50;

const DISPATCH_TYPES = [
  "Troca de Bateria",
  "Manutenção Geral",
  "Verificação",
  "Reinstalação",
  "Substituição",
];

// --- Utility Functions ---

function normalizeStatusKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function isMaintenanceSignalStatus(status: unknown): boolean {
  return normalizeStatusKey(status).includes("MANUTEN");
}

function getStatusBySubprefeitura(data: ModuleData[]) {
  const subsSet = new Set(data.map((m) => m.subprefeitura).filter(Boolean));
  const subs = Array.from(subsSet).sort();
  return subs.map((sub) => {
    const items = data.filter((m) => m.subprefeitura === sub);
    const total = items.length;
    const online = items.filter((m) => m.comunicacao === "ON").length;
    const offline = items.filter((m) => m.comunicacao === "OFF").length;
    const maintenance = items.filter((m) => isMaintenanceSignalStatus(m.statusSinalGeral)).length;
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
    { status: "Manutenção", count: data.filter((m) => isMaintenanceSignalStatus(m.statusSinalGeral)).length },
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

/** Cabeçalho clicável com toggle de ordenação (desc → asc → nenhum). */
function SortToggle({ label, dir, onClick }: { label: string; dir: "asc" | "desc" | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 transition-colors hover:text-foreground",
        dir ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
      )}
      title="Ordenar"
    >
      {label}
      {dir === "desc" ? (
        <ArrowDown className="h-3.5 w-3.5" />
      ) : dir === "asc" ? (
        <ArrowUp className="h-3.5 w-3.5" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
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

/** Tooltip discreto fixo no viewport; suporta quebras de linha com \n. */
function InfoTooltip({ text, children }: { text: string; children?: ReactNode }) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; placement: "top" | "bottom" } | null>(null);

  const show = useCallback(() => {
    const el = triggerRef.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    const tooltipHalfWidth = 130;
    const left = Math.min(window.innerWidth - tooltipHalfWidth - 12, Math.max(tooltipHalfWidth + 12, rect.left + rect.width / 2));
    const placement = rect.top > 96 ? "top" : "bottom";
    const top = placement === "top" ? rect.top - 8 : rect.bottom + 8;
    setPosition({ left, top, placement });
  }, []);

  const hide = useCallback(() => setPosition(null), []);

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex items-center"
      onMouseEnter={show}
      onMouseMove={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children ?? (
        <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground/70 transition-colors hover:text-foreground" />
      )}
      {position && typeof document !== "undefined"
        ? createPortal(
            <span
              role="tooltip"
              className="pointer-events-none fixed z-[9999] w-max max-w-[260px] -translate-x-1/2 whitespace-pre-line rounded-xl border border-border/70 bg-popover px-3 py-2 text-left text-xs font-normal leading-snug text-popover-foreground shadow-2xl ring-1 ring-black/5"
              style={{
                left: position.left,
                top: position.top,
                transform: position.placement === "top" ? "translate(-50%, -100%)" : "translate(-50%, 0)",
              }}
            >
              {text}
            </span>,
            document.body,
          )
        : null}
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

function trocasPeriodLabel(period: string): string {
  if (period === "7d") return "Últimos 7 dias";
  if (period === "90d") return "Últimos 90 dias";
  if (period === "all") return "Todo o período";
  return "Últimos 30 dias";
}

function xlsxNumber(value: number | null | undefined, decimals = 1): number | string {
  if (value == null || !Number.isFinite(Number(value))) return "";
  return Number(Number(value).toFixed(decimals));
}

function compareNumberDesc(a: number | null | undefined, b: number | null | undefined): number {
  const av = a == null || !Number.isFinite(Number(a)) ? null : Number(a);
  const bv = b == null || !Number.isFinite(Number(b)) ? null : Number(b);
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  return bv - av;
}

function exportTrocasBateriaXlsx(
  modules: ModuleData[],
  options: {
    records: Record<string, TrocaRecord>;
    history: Record<string, TrocaHistoryRecord[]>;
    manutRecords: Record<string, ModuloManutencaoEvento>;
    period: string;
  },
) {
  const workbook = XLSX.utils.book_new();
  const periodLabel = trocasPeriodLabel(options.period);

  const moduleHeaders = [
    "Subprefeitura",
    "Setor",
    "SELIMP",
    "Serviços",
    "Dias de execução",
    "Setores/Dias",
    "Comunicação",
    "Status de sinal",
    "Status da bateria",
    "Bateria atual (%)",
    "Bateria atual (raw)",
    "Última comunicação",
    "Qtd. cargas SELIMP",
    "Trocas registradas no painel",
    `Trocas concluídas (${periodLabel})`,
    `Trocas com sucesso (${periodLabel})`,
    `Trocas sem sucesso (${periodLabel})`,
    `Agendadas (${periodLabel})`,
    `Duração Bat. (${periodLabel})`,
    "Execução média SELIMP 60d (%)",
    "Execução média SELIMP 30d (%)",
    "Produtividade bateria (%)",
    "Dias ON",
    "Dias OFF",
    "Dias OFF consecutivos",
    "Motivo atual",
    "Manutenção atual",
    "Data ordenado manutenção",
    "Data manutenção realizada",
    "Motivo manutenção",
    "Data instalação",
  ];

  const moduleRows = modules.map((m) => {
    const history = trocaHistoryOf(m, options.records[m.numeroSelimp], options.history[m.numeroSelimp]);
    const concluidasPeriodo = history.filter((h) => h.status === "concluida" && trocaInPeriod(h, options.period));
    const agendadasPeriodo = history.filter((h) => h.status === "agendada" && trocaInPeriod(h, options.period));
    const manut = options.manutRecords[m.numeroSelimp];
    const duracao = average(duracoesBateriaAtualizada(m, history, options.period));
    return [
      m.subprefeitura,
      m.setor,
      m.numeroSelimp,
      siglasOf(m).join(" / "),
      m.diasExecucao,
      setoresDiasOf(m).map((sd) => `${sd.setor}: ${sd.dias || "-"}`).join(" | "),
      m.comunicacao,
      m.statusSinalGeral,
      m.statusBateria,
      xlsxNumber(normalizePercentValue(m.bateriaPercentual), 0),
      m.bateria,
      m.ultimaComunicacao,
      m.quantidadeTrocas,
      history.length,
      concluidasPeriodo.length,
      concluidasPeriodo.filter((h) => h.sucesso !== false).length,
      concluidasPeriodo.filter((h) => h.sucesso === false).length,
      agendadasPeriodo.length,
      duracao ?? "",
      xlsxNumber(mediaExecucaoSelimp(m, 60), 1),
      xlsxNumber(mediaExecucaoSelimp(m, 30), 1),
      xlsxNumber(m.produtividade, 0),
      m.diasOn,
      m.diasOff,
      m.diasOffConsecutivos ?? "",
      motivoFromModule(m),
      manut ? MANUT_STATUS_LABEL[manut.status] : "",
      manut?.dataOrdenado ? fmtIsoBr(manut.dataOrdenado) : "",
      manut?.dataManutencao ? fmtIsoBr(manut.dataManutencao) : "",
      manut?.motivo ?? "",
      formatIptDataInstalacaoBr(m.dataInstalacao) || "",
    ];
  });

  const moduleSheet = XLSX.utils.aoa_to_sheet([moduleHeaders, ...moduleRows]);
  moduleSheet["!cols"] = [
    12, 26, 16, 12, 18, 44, 12, 16, 18, 14, 16, 22, 14, 20, 20, 20, 20, 16, 18, 20, 18, 18, 10, 10, 18, 16, 18, 22, 22, 28, 18,
  ].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, moduleSheet, "Módulos");

  const moduleSet = new Set(modules.map((m) => m.numeroSelimp));
  const trocaHeaders = [
    "SELIMP",
    "Setor",
    "Tipo",
    "Status",
    "Data agendada",
    "Data troca",
    "Dentro do período selecionado",
    "Sucesso",
    "Percentual entrada (%)",
    "Bateria antes (%)",
    "Bateria depois (%)",
    "Status bateria antes",
    "Status bateria depois",
    "Últ. comunicação antes",
    "Últ. comunicação depois",
    "Criado em",
  ];
  const trocaRows = modules.flatMap((m) => {
    const history = trocaHistoryOf(m, options.records[m.numeroSelimp], options.history[m.numeroSelimp]);
    return history
      .filter((h) => moduleSet.has(h.selimp))
      .map((h) => [
        h.selimp,
        h.setor ?? m.setor,
        h.tipoTroca ?? "",
        trocaStatusLabel(h),
        h.dataAgendada ? fmtIsoBr(h.dataAgendada) : "",
        h.dataTroca ? fmtIsoBr(h.dataTroca) : "",
        trocaInPeriod(h, options.period) ? "Sim" : "Não",
        h.status === "concluida" ? h.sucesso === false ? "Não" : "Sim" : "",
        xlsxNumber(normalizePercentValue(h.percentualEntrada), 0),
        xlsxNumber(normalizePercentValue(h.bateriaAntesPercentual), 0),
        xlsxNumber(normalizePercentValue(h.bateriaDepoisPercentual ?? h.percentualEntrada), 0),
        h.statusBateriaAntes ?? "",
        h.statusBateriaDepois ?? "",
        fmtDisplayDate(h.ultimaComunicacaoAntes || h.ultimaComunicacao),
        fmtDisplayDate(h.ultimaComunicacaoDepois),
        h.createdAt ? isoBrDateTime(h.createdAt) : "",
      ]);
  });
  const trocaSheet = XLSX.utils.aoa_to_sheet([trocaHeaders, ...trocaRows]);
  trocaSheet["!cols"] = [16, 26, 18, 26, 14, 14, 24, 10, 18, 16, 17, 20, 20, 22, 22, 20].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, trocaSheet, "Trocas");

  const metaSheet = XLSX.utils.aoa_to_sheet([
    ["Relatório", "Trocas de Bateria - Módulos SELIMP"],
    ["Período selecionado", periodLabel],
    ["Módulos exportados", modules.length],
    ["Eventos de troca exportados", trocaRows.length],
    ["Execução média SELIMP", "Últimos 60 e 30 dias, percentual somente"],
    ["Exportado em", new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })],
  ]);
  metaSheet["!cols"] = [{ wch: 28 }, { wch: 48 }];
  XLSX.utils.book_append_sheet(workbook, metaSheet, "Metadados");

  XLSX.writeFile(workbook, `trocas_bateria_modulos_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// --- Page Component ---

/** Motivo da troca derivado do status atual da bateria (mock até backend). */
function motivoFromModule(m: ModuleData): string {
  switch (m.statusBateria) {
    case "DESATUALIZADA":
      return "Corretiva";
    case "CRÍTICA":
    case "BAIXA":
      return "Preventiva";
    case "REGULAR":
      return "Desnecessária";
    default:
      return "Manutenção";
  }
}

const MOTIVO_OPTIONS = ["Manutenção", "Corretiva", "Preventiva", "Desnecessária"];

const STATUS_BAT_OPTIONS = ["ALTA", "REGULAR", "BAIXA", "CRÍTICA", "DESATUALIZADA"];

/** Ranking de qualidade da bateria (maior = melhor) para ordenação. */
const STATUS_BAT_RANK: Record<string, number> = {
  ALTA: 4,
  REGULAR: 3,
  BAIXA: 2,
  CRÍTICA: 1,
  DESATUALIZADA: 0,
};

/** Data de hoje em yyyy-MM-dd (horário local). */
function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** yyyy-MM-dd → dd/MM/yyyy. */
function fmtIsoBr(iso?: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function fmtDisplayDate(value?: string): string {
  if (!value) return "—";
  const normalized = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? fmtIsoBr(normalized) : value;
}

function parseDateOnly(value?: string): Date | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const br = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function daysBetweenDates(start: Date, end: Date): number {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(0, Math.round((endUtc - startUtc) / 86400000));
}

function average(values: number[]): number | null {
  return values.length > 0 ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function periodStartDate(period: string, now = new Date()): Date | null {
  if (period === "all") return null;
  const match = /^(\d+)d$/.exec(period);
  const days = match ? Number(match[1]) : 30;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - days);
  return start;
}

function isDateInPeriod(value: string | undefined, period: string, now = new Date()): boolean {
  const d = parseDateOnly(value);
  if (!d) return false;
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d > end) return false;
  const start = periodStartDate(period, now);
  return !start || d >= start;
}

function normalizePercentValue(value?: number | null): number | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  return n > 0 && n <= 1 ? n * 100 : n;
}

function batteryLabel(raw?: string, percent?: number | null): string {
  const clean = String(raw ?? "").trim();
  if (clean) return clean;
  return percent != null && Number.isFinite(Number(percent)) ? `${Number(percent)}%` : "—";
}

/** Normaliza um percentual de bateria para o rótulo "XX%".
 * Aceita escala 0–100 (82 → "82%") ou decimal 0–1 (0.82 → "82%"); cai para o raw quando não há percentual. */
function pctBatteryLabel(percent?: number | null, raw?: string): string {
  if (percent != null && Number.isFinite(Number(percent))) {
    const n = Number(percent);
    const v = n > 0 && n <= 1 ? Math.round(n * 100) : Math.round(n);
    return `${v}%`;
  }
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  const num = parseFloat(s.replace(",", "."));
  if (!Number.isNaN(num)) {
    const v = num > 0 && num <= 1 ? Math.round(num * 100) : Math.round(num);
    return `${v}%`;
  }
  return s;
}

/** Deriva o status da bateria a partir do percentual (mesmos limiares do backend:
 * >70 ALTA · >30 REGULAR · >15 BAIXA · senão CRÍTICA). */
function statusBateriaFromPct(percent?: number | null): string | null {
  if (percent == null || !Number.isFinite(Number(percent))) return null;
  const n = Number(percent) > 0 && Number(percent) <= 1 ? Number(percent) * 100 : Number(percent);
  if (n > 70) return "ALTA";
  if (n > 30) return "REGULAR";
  if (n > 15) return "BAIXA";
  return "CRÍTICA";
}

function trocaStatusLabel(item: Pick<TrocaRecord, "status" | "sucesso">): string {
  if (item.status === "agendada") return "Agendada";
  // sucesso é automático e tem 3 estados: indefinido = ainda sem leitura pós-troca.
  if (item.sucesso == null) return "Aguardando avaliação";
  return item.sucesso ? "Concluída com sucesso" : "Concluída sem sucesso";
}

function trocaStatusBadgeClass(item: Pick<TrocaRecord, "status" | "sucesso">): string {
  if (item.status === "agendada") return "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400";
  if (item.sucesso == null) return "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300";
  return item.sucesso
    ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400"
    : "bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400";
}

function trocaHistoryOf(m: ModuleData, rec?: TrocaRecord, history: TrocaHistoryRecord[] = []): TrocaHistoryRecord[] {
  if (history.length > 0) return history;
  if (!rec) return [];
  return [
    {
      ...rec,
      id: `current-${m.numeroSelimp}`,
      selimp: m.numeroSelimp,
      setor: rec.setor ?? m.setor,
      tipoTroca: rec.status === "agendada" ? "Agendamento" : motivoFromModule(m),
      bateriaDepoisPercentual: rec.percentualEntrada,
    },
  ];
}

function trocaDate(h: TrocaHistoryRecord): string | undefined {
  return h.status === "agendada" ? h.dataAgendada : h.dataTroca;
}

function trocaInPeriod(h: TrocaHistoryRecord, period: string): boolean {
  return isDateInPeriod(trocaDate(h), period);
}

function manutEventDate(ev: ModuloManutencaoEvento): string | undefined {
  return ev.dataManutencao ?? ev.dataReinstalacao ?? ev.dataRetirada ?? ev.dataOrdenado ?? ev.createdAt?.slice(0, 10);
}

function manutInPeriod(date: string | undefined, period: string): boolean {
  return isDateInPeriod(date, period);
}

function bateriaAtualizada(m: ModuleData): boolean {
  return m.statusSinalGeral === "COM SINAL" && m.statusBateria !== "DESATUALIZADA";
}

function duracoesBateriaAtualizada(m: ModuleData, history: TrocaHistoryRecord[], period: string): number[] {
  const concluidas = history
    .filter((h) => h.status === "concluida" && h.dataTroca)
    .sort((a, b) => String(a.dataTroca).localeCompare(String(b.dataTroca)));

  const out: number[] = [];
  for (let i = 0; i < concluidas.length; i += 1) {
    const startEvent = concluidas[i];
    if (startEvent.sucesso === false) continue;
    const start = parseDateOnly(startEvent.dataTroca);
    if (!start) continue;

    const nextEvent = concluidas[i + 1];
    const end = nextEvent ? parseDateOnly(nextEvent.dataTroca) : bateriaAtualizada(m) ? new Date() : null;
    if (!end) continue;
    const endKey = nextEvent ? nextEvent.dataTroca : isoToday();
    if (!isDateInPeriod(endKey, period)) continue;

    const diff = daysBetweenDates(start, end);
    if (diff > 0) out.push(diff);
  }
  return out;
}

function execucaoSelimpHistoryOf(m: ModuleData, limit = 10, days = 30): ExecucaoSelimpDia[] {
  const byDate = new Map<string, { sum: number; count: number }>();
  for (const sd of setoresDiasOf(m)) {
    for (const item of sd.execucoes ?? []) {
      if (!item.data || !Number.isFinite(item.percentual)) continue;
      if (!isDateInPeriod(item.data, `${days}d`)) continue;
      const cur = byDate.get(item.data) ?? { sum: 0, count: 0 };
      cur.sum += item.percentual;
      cur.count += 1;
      byDate.set(item.data, cur);
    }
  }
  return Array.from(byDate.entries())
    .map(([data, v]) => ({ data, percentual: Math.round((v.sum / v.count) * 10) / 10 }))
    .sort((a, b) => b.data.localeCompare(a.data))
    .slice(0, limit);
}

function mediaExecucaoSelimp(m: ModuleData, days = 30): number | null {
  const vals = execucaoSelimpHistoryOf(m, 999, days)
    .map((item) => item.percentual)
    .filter((value) => Number.isFinite(value));
  if (vals.length > 0) return Math.round((vals.reduce((sum, value) => sum + value, 0) / vals.length) * 10) / 10;
  return days >= 60 && m.produtividadeExecucao != null ? Math.round(m.produtividadeExecucao * 10) / 10 : null;
}

/** Leitura de bateria do módulo numa data exata (yyyy-MM-dd); null quando não houver leitura. */
function bateriaDoDia(m: ModuleData, data: string): BateriaDia | null {
  const dia = data.slice(0, 10);
  return (m.bateriaPorDia ?? []).find((b) => b.data.slice(0, 10) === dia) ?? null;
}

/** Cor do texto do percentual de bateria por faixa (cinza quando desatualizada). */
function bateriaDiaColor(b: BateriaDia): string {
  if (b.desatualizada) return "text-zinc-500 dark:text-zinc-400";
  const p = b.percentual ?? 0;
  if (p > 70) return "text-emerald-600 dark:text-emerald-400";
  if (p > 30) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

const STATUS_BAT_BADGE: Record<string, string> = {
  ALTA: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
  REGULAR: "bg-orange-500/15 text-orange-600 border-orange-500/30 dark:text-orange-400",
  BAIXA: "bg-blue-500/15 text-blue-600 border-blue-500/30 dark:text-blue-400",
  CRÍTICA: "bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400",
};
function statusBatBadge(status: string): string {
  return STATUS_BAT_BADGE[status] ?? "bg-zinc-500/15 text-zinc-600 border-zinc-500/30 dark:text-zinc-300";
}

/** Prévia do resultado da troca a partir do status atual (desatualizada → tende a sem sucesso).
 * A classificação final é automática (snapshot pós-troca); isto é só uma indicação visual. */
function sucessoPreviewChip(m: ModuleData) {
  const semSucesso = m.statusBateria === "DESATUALIZADA";
  return (
    <Badge
      className={
        semSucesso
          ? "bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400"
          : "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400"
      }
    >
      {semSucesso ? "Prévia: sem sucesso" : "Prévia: com sucesso"}
    </Badge>
  );
}

/** Badge por status de manutenção do MÓDULO (Pendente → Ativa → Realizada). */
const STATUS_MODULO_MANUT_BADGE: Record<ManutencaoModuloStatus, string> = {
  EM_ANALISE: "bg-violet-500/15 text-violet-600 border-violet-500/30 dark:text-violet-400",
  PENDENTE: "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400",
  RETIRANDO: "bg-rose-500/15 text-rose-600 border-rose-500/30 dark:text-rose-400",
  ATIVA: "bg-sky-500/15 text-sky-600 border-sky-500/30 dark:text-sky-400",
  REINSTALANDO: "bg-indigo-500/15 text-indigo-600 border-indigo-500/30 dark:text-indigo-400",
  REALIZADA: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
  SINAL_RECUPERADO: "bg-green-800/20 text-green-800 border-green-800/40 dark:bg-green-900/30 dark:text-green-400",
};

const MANUT_OPEN_STATUSES = new Set<ManutencaoModuloStatus>([
  "EM_ANALISE", "PENDENTE", "RETIRANDO", "ATIVA", "REINSTALANDO",
]);

const MANUT_OVERVIEW_STATUSES = new Set<ManutencaoModuloStatus>([
  "PENDENTE", "RETIRANDO", "ATIVA", "REINSTALANDO",
]);

function isOpenManutStatus(status: ManutencaoModuloStatus | null): status is ManutencaoModuloStatus {
  return status != null && MANUT_OPEN_STATUSES.has(status);
}

function isInMaintenanceOverview(status: ManutencaoModuloStatus | null): boolean {
  return status != null && MANUT_OVERVIEW_STATUSES.has(status);
}

/** Contestação só quando há datas coerentes com a etapa ou pipeline completo (ordenado → retirada → reinstalação). */
function isContestationEligible(
  e: Pick<ManutEntry, "status" | "dataOrdenado" | "dataRetirada" | "dataReinstalacao">,
): boolean {
  const { status, dataOrdenado, dataRetirada, dataReinstalacao } = e;
  if (dataOrdenado && dataRetirada && dataReinstalacao) return true;
  if (status === "PENDENTE" || status === "EM_ANALISE") return false;
  if (status === "RETIRANDO") return Boolean(dataOrdenado);
  if (status === "ATIVA" || status === "REINSTALANDO") return Boolean(dataOrdenado && dataRetirada);
  return false;
}

function trocaBlockedStatusLabel(status: ManutencaoModuloStatus): string {
  return status === "EM_ANALISE" ? "Análise Manutenção" : "Manutenção Pend.";
}

/** yyyy-MM-dd → dd/MM/yyyy (— quando vazio). */
function isoBr(iso?: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

/** Timestamp ISO → dd/MM/yyyy HH:mm (— quando vazio). */
function isoBrDateTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return isoBr(iso.slice(0, 10));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function manutEventoAlertDate(ev: ModuloManutencaoEvento): string {
  return isoBr(ev.createdAt?.slice(0, 10) || ev.dataManutencao || ev.dataOrdenado);
}

function manutEventoDescricao(ev: ModuloManutencaoEvento): string {
  const ref = ev.dataManutencao || ev.dataOrdenado;
  const suffix = ref ? ` (${isoBr(ref)})` : "";
  if (ev.status === "EM_ANALISE") return `Análise de manutenção${suffix}`;
  if (ev.status === "PENDENTE") return `Manutenção pendente${suffix}`;
  if (ev.status === "ATIVA") return `Manutenção ordenada${suffix}`;
  if (ev.status === "SINAL_RECUPERADO") return `Sinal recuperado${suffix}`;
  return `Manutenção registrada${suffix}`;
}

/** Uma linha do histórico de manutenção (1 por evento, ou 1 sintética p/ módulo enviado pela aba Trocas). */
interface ManutEntry {
  key: string;
  eventId: number | null;
  selimp: string;
  setor: string;
  sub: string;
  module: ModuleData | null;
  status: ManutencaoModuloStatus;
  dataOrdenado?: string;
  dataRetirada?: string;
  dataReinstalacao?: string;
  dataManutencao?: string;
  sinalRecuperado: boolean;
  oficial: boolean;
  contestado: boolean;
  diasFrequencia: number;
  diasContestados?: number;
  contestacaoDias: { data: string; contestado: boolean }[];
  documentoUrl?: string;
  documentoTitulo?: string;
  motivo?: string;
  createdAt?: string;
  quantidadeTrocas: number;
  ultimaComunicacao: string;
}

function manutEntryDate(
  e: Pick<ManutEntry, "dataManutencao" | "dataReinstalacao" | "dataRetirada" | "dataOrdenado" | "createdAt">,
): string | undefined {
  return e.dataManutencao ?? e.dataReinstalacao ?? e.dataRetirada ?? e.dataOrdenado ?? e.createdAt?.slice(0, 10);
}

const SETOR_RE = /^(?:CV|JT|MG|ST)(\d)(\d{4})([A-Z]{2})/;

/** Turno a partir do código do setor (1=Manhã, 2=Tarde, 3=Noite). */
function turnoFromSetor(setor: string): { digito: string; label: string } | null {
  const m = String(setor ?? "").trim().replace(/\s+/g, "").toUpperCase().match(SETOR_RE);
  if (!m) return null;
  const d = m[1];
  const label = d === "1" ? "Manhã" : d === "2" ? "Tarde" : d === "3" ? "Noite" : "—";
  return { digito: d, label };
}

function turnoBadge(label: string): string {
  switch (label) {
    case "Manhã":
      return "bg-sky-500/15 text-sky-600 border-sky-500/30 dark:text-sky-400";
    case "Tarde":
      return "bg-orange-500/15 text-orange-600 border-orange-500/30 dark:text-orange-400";
    case "Noite":
      return "bg-indigo-500/15 text-indigo-600 border-indigo-500/30 dark:text-indigo-400";
    default:
      return "bg-zinc-500/15 text-zinc-600 border-zinc-500/30 dark:text-zinc-300";
  }
}

/** Sigla do serviço a partir do código do setor (VP, VJ, VL, ...). */
function siglaFromSetor(setor: string): string | null {
  const m = String(setor ?? "").trim().replace(/\s+/g, "").toUpperCase().match(SETOR_RE);
  return m ? m[3] : null;
}

function siglaBadge(sigla: string): string {
  switch (sigla) {
    case "VP":
      return "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400";
    case "VJ":
      return "bg-violet-500/15 text-violet-600 border-violet-500/30 dark:text-violet-400";
    case "VL":
      return "bg-fuchsia-500/15 text-fuchsia-600 border-fuchsia-500/30 dark:text-fuchsia-400";
    default:
      return "bg-zinc-500/15 text-zinc-600 border-zinc-500/30 dark:text-zinc-300";
  }
}

/** Lista de setores do módulo (usa setoresDias se houver, senão split do setor). */
function setoresOf(m: ModuleData): string[] {
  if (m.setoresDias && m.setoresDias.length > 0) return m.setoresDias.map((s) => s.setor).filter(Boolean);
  return (m.setor || "").split("/").map((s) => s.trim()).filter(Boolean);
}

/** Turnos distintos do módulo (na ordem dos setores). */
function turnosOf(m: ModuleData): { digito: string; label: string }[] {
  const seen = new Set<string>();
  const out: { digito: string; label: string }[] = [];
  for (const s of setoresOf(m)) {
    const t = turnoFromSetor(s);
    if (t && !seen.has(t.label)) {
      seen.add(t.label);
      out.push(t);
    }
  }
  return out;
}

/** Siglas de serviço distintas do módulo. */
function siglasOf(m: ModuleData): string[] {
  const seen = new Set<string>();
  for (const s of setoresOf(m)) {
    const sig = siglaFromSetor(s);
    if (sig) seen.add(sig);
  }
  return Array.from(seen);
}

/** Lista de pares setor↔dias, com fallback para o campo agregado antigo. */
function setoresDiasOf(m: ModuleData): ModuleSetorDia[] {
  if (m.setoresDias && m.setoresDias.length > 0) return m.setoresDias;
  const setores = (m.setor || "").split("/").map((s) => s.trim()).filter(Boolean);
  if (setores.length === 0) return [];
  // Sem pareamento estruturado: replica o blob de dias para cada setor.
  return setores.map((setor) => ({ setor, dias: m.diasExecucao || "" }));
}

export default function BateriaDashboardPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [subFilter, setSubFilter] = useState<string[]>([]);
  const [signalFilter, setSignalFilter] = useState("all");
  const [batteryFilter, setBatteryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [dispatchDialogOpen, setDispatchDialogOpen] = useState(false);
  const [newDispatch, setNewDispatch] = useState({ module: "", type: "", description: "" });
  const [detailModule, setDetailModule] = useState<ModuleData | null>(null);
  const [chartsReady, setChartsReady] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  // Filtros da aba "Trocas de Bateria"
  const [trocasPeriod, setTrocasPeriod] = useState("30d");
  const [trocasSearch, setTrocasSearch] = useState("");
  const [trocasSubFilter, setTrocasSubFilter] = useState<string[]>([]);
  const [trocasDaysFilter, setTrocasDaysFilter] = useState<string[]>([]);
  const [trocasMotivoFilter, setTrocasMotivoFilter] = useState<string[]>([]);
  const [trocasAgendadaFilter, setTrocasAgendadaFilter] = useState("all"); // all | sim | nao
  const [trocasBateriaFilter, setTrocasBateriaFilter] = useState<string[]>([]); // status da bateria
  const [trocasSort, setTrocasSort] = useState("default"); // ordenação da listagem

  // Filtros da aba "Manutenções"
  const [manutPeriod, setManutPeriod] = useState("30d");
  const [manutSearch, setManutSearch] = useState("");
  const [manutSubFilter, setManutSubFilter] = useState<string[]>([]);
  const [manutStatusFilter, setManutStatusFilter] = useState("all"); // all | EM_ANALISE | PENDENTE | RETIRANDO | ATIVA | REINSTALANDO | REALIZADA (+ SINAL_RECUPERADO)
  const [manutOficialFilter, setManutOficialFilter] = useState("all"); // all | oficial | nao
  const [histModule, setHistModule] = useState<ModuleData | null>(null);
  // Modal de contestação por dia (despachos perdidos na manutenção) + estado de upload do documento.
  const [contestModule, setContestModule] = useState<ManutEntry | null>(null);
  const [contestUploading, setContestUploading] = useState(false);
  const [contestDocDelete, setContestDocDelete] = useState<{ eventId: number; selimp: string; titulo: string } | null>(null);
  const [contestRemovingDoc, setContestRemovingDoc] = useState(false);
  const [manutEventDelete, setManutEventDelete] = useState<{ selimp: string; id: number; setor: string; status: string } | null>(null);

  // Paginação das listagens de Trocas e Manutenções
  const [trocasPage, setTrocasPage] = useState(1);
  const [manutPage, setManutPage] = useState(1);

  // Modal de registrar/editar manutenção do módulo (module=null → seletor no topo; editEventId → edição)
  const [manutModal, setManutModal] = useState<{ open: boolean; module: ModuleData | null; editEventId: number | null }>(
    { open: false, module: null, editEventId: null },
  );
  const [manutForm, setManutForm] = useState({
    selimp: "",
    // status base do dropdown; SINAL_RECUPERADO vem do toggle em REALIZADA.
    status: "REALIZADA" as "EM_ANALISE" | "PENDENTE" | "RETIRANDO" | "ATIVA" | "REINSTALANDO" | "REALIZADA",
    motivo: "",
    dataOrdenado: "",
    dataRetirada: "",
    dataReinstalacao: "",
    dataManutencao: "",
    sinalRecuperado: false,
    oficial: true,
  });
  const [manutPickerSearch, setManutPickerSearch] = useState("");

  // Estado mock (localStorage) de agendamentos/conclusões de troca
  const troca = useTrocaState();
  // Estado mock (localStorage) de manutenções (data / "não houve")
  const manut = useManutencaoState();
  // Histórico de manutenção do MÓDULO (persistido no servidor)
  const moduloManut = useModuloManutencaoState();

  /** Módulo foi enviado à manutenção pela aba Trocas (solicitação / status global). */
  const isEnviadoManutencao = useCallback(
    (m: ModuleData) =>
      Boolean(manut.overrides[m.numeroSelimp]?.solicitada) ||
      isMaintenanceSignalStatus(m.statusSinalGeral),
    [manut.overrides],
  );

  /** Status corrente de manutenção do módulo (evento mais recente, ou Pendente sintético). */
  const manutStatusForModule = useCallback(
    (m: ModuleData): ManutencaoModuloStatus | null =>
      moduloManut.records[m.numeroSelimp]?.status ?? (isEnviadoManutencao(m) ? "PENDENTE" : null),
    [moduloManut.records, isEnviadoManutencao],
  );

  // Seleção múltipla (padrão Despachos)
  const [selMode, setSelMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastIdx, setLastIdx] = useState<number | null>(null);
  const [expandedTrocaSelimp, setExpandedTrocaSelimp] = useState<string | null>(null);

  // Modais da aba Trocas
  const [alertModule, setAlertModule] = useState<ModuleData | null>(null);
  const [agendarModule, setAgendarModule] = useState<ModuleData | null>(null);
  const [agendarDate, setAgendarDate] = useState("");
  // Modal de ações do agendamento (avulso): concluir ou reagendar.
  const [agendadoModule, setAgendadoModule] = useState<ModuleData | null>(null);
  const [agendadoDate, setAgendadoDate] = useState("");
  const [agendadoReagendarOpen, setAgendadoReagendarOpen] = useState(false);
  const [concluirModule, setConcluirModule] = useState<ModuleData | null>(null);
  // Conclusão: a data da troca; bateria/status/sucesso são automáticos. "Desnecessária" é toggle manual.
  const [concluirDate, setConcluirDate] = useState("");
  const [concluirDesnecessaria, setConcluirDesnecessaria] = useState(false);
  const [bulkAgendarOpen, setBulkAgendarOpen] = useState(false);
  const [bulkAgendarDate, setBulkAgendarDate] = useState("");
  const [bulkAgendarMode, setBulkAgendarMode] = useState<"agendar" | "reagendar">("agendar");
  const [bulkCancelarTrocaOpen, setBulkCancelarTrocaOpen] = useState(false);
  const [bulkConcluirOpen, setBulkConcluirOpen] = useState(false);
  const [bulkConcluirDate, setBulkConcluirDate] = useState("");
  const [bulkConcluirDesnecessaria, setBulkConcluirDesnecessaria] = useState(false);
  // Exclusão de um evento do histórico de trocas (com confirmação).
  const [trocaEventoDelete, setTrocaEventoDelete] = useState<{ selimp: string; id: number; setor: string; data: string } | null>(null);
  const [bulkManutOpen, setBulkManutOpen] = useState(false);
  const [bulkManutMotivo, setBulkManutMotivo] = useState("");
  const { resolvedTheme } = useTheme();

  useEffect(() => { setChartsReady(true); }, []);

  useEffect(() => {
    if (selMode) setExpandedTrocaSelimp(null);
  }, [selMode]);

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

  // Manutenção ativa do módulo entra no status global da visão geral.
  const modules = useMemo(() => {
    const raw = data?.modules ?? [];
    return raw.map((m) => {
      const statusModulo = moduloManut.records[m.numeroSelimp]?.status ?? null;
      if (statusModulo !== "ATIVA") return m;
      if (isMaintenanceSignalStatus(m.statusSinalGeral)) return m;
      return { ...m, statusSinalGeral: "MANUTENCAO" };
    });
  }, [data, moduloManut.records]);
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
    if (subFilter.length > 0) result = result.filter((m) => subFilter.includes(m.subprefeitura));

    if (signalFilter === "com-sinal") result = result.filter((m) => m.statusSinalGeral === "COM SINAL");
    else if (signalFilter === "sem-sinal") result = result.filter((m) => m.statusSinalGeral === "SEM SINAL");
    else if (signalFilter === "manutencao") {
      result = result.filter((m) => isMaintenanceSignalStatus(m.statusSinalGeral));
    }

    if (batteryFilter === "critico") result = result.filter((m) => m.bateriaPercentual <= 20);
    else if (batteryFilter === "baixo") result = result.filter((m) => m.bateriaPercentual > 20 && m.bateriaPercentual < 50);
    else if (batteryFilter === "operacional") result = result.filter((m) => m.bateriaPercentual >= 50 && m.bateriaPercentual <= 80);
    else if (batteryFilter === "cheia") result = result.filter((m) => m.bateriaPercentual > 80);

    if (statusFilter === "baixa") {
      result = result.filter((m) => m.produtividade < 20);
    } else if (statusFilter === "atencao") {
      result = result.filter((m) => m.produtividade >= 20 && m.produtividade < 40);
    } else if (statusFilter === "alerta") {
      result = result.filter((m) => m.produtividade >= 40 && m.produtividade < 60);
    } else if (statusFilter === "alta") {
      result = result.filter((m) => m.produtividade >= 60);
    }

    if (batteryFilter !== "all" || statusFilter !== "all") {
      const sorted = [...result];
      sorted.sort((a, b) => {
        const primary = statusFilter !== "all"
          ? compareNumberDesc(a.produtividade, b.produtividade)
          : compareNumberDesc(a.bateriaPercentual, b.bateriaPercentual);
        if (primary !== 0) return primary;
        const secondary = statusFilter !== "all"
          ? compareNumberDesc(a.bateriaPercentual, b.bateriaPercentual)
          : compareNumberDesc(a.produtividade, b.produtividade);
        if (secondary !== 0) return secondary;
        return a.numeroSelimp.localeCompare(b.numeroSelimp, "pt-BR");
      });
      return sorted;
    }

    return result;
  }, [modules, searchTerm, subFilter, signalFilter, batteryFilter, statusFilter]);

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
    let maintenance = 0;
    let online = 0;
    let offline = 0;

    for (const m of modules) {
      const inMaint = isInMaintenanceOverview(manutStatusForModule(m));
      if (inMaint) {
        maintenance += 1;
        continue;
      }
      if (m.comunicacao === "ON") online += 1;
      else if (m.comunicacao === "OFF") offline += 1;
    }

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
  }, [modules, manutStatusForModule]);

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

  // ===== Aba "Performance" — métricas reais =====

  /** Série temporal de produtividade das baterias (% ON por data). */
  const evolucaoData = useMemo(() => {
    const raw = data?.evolucaoProdutividade ?? [];
    return raw.map((p) => {
      const [, mm, dd] = p.data.split("-");
      return { ...p, label: dd && mm ? `${dd}/${mm}` : p.data };
    });
  }, [data]);

  /** Rótulo do período de apuração (mês corrente). */
  const mesLabel = useMemo(() => mesCorrenteLabel(), []);

  /** Produtividade de bateria média do período (mês corrente) = média da série de evolução (só SELIMP). */
  const mediaPeriodoBateria = useMemo(() => {
    if (evolucaoData.length === 0) return null;
    const soma = evolucaoData.reduce((acc, p) => acc + p.produtividade, 0);
    return Math.round(soma / evolucaoData.length);
  }, [evolucaoData]);

  /** Subs presentes nos dados de execução (ordem fixa CV/JT/MG/ST). */
  const execSubs = useMemo(() => {
    const present = new Set((data?.execucaoPorServicoSub ?? []).map((e) => e.sub));
    return SUB_ORDER.filter((s) => present.has(s));
  }, [data]);

  /** Execução SELIMP no mês por tipo de serviço × sub (barras agrupadas). */
  const execServicoSubChartData = useMemo(() => {
    const rows = data?.execucaoPorServicoSub ?? [];
    const byServico = new Map<string, Record<string, number | string>>();
    for (const e of rows) {
      const label = servicoLabel(e.servico);
      const cur = byServico.get(label) ?? { servico: label };
      cur[e.sub] = Math.round(e.execucao * 10) / 10;
      byServico.set(label, cur);
    }
    // Ordem: Praças, Sarjetas, Sarjetas e Calçadas (depois alfabética)
    const ordem = ["Praças", "Sarjetas", "Sarjetas e Calçadas"];
    return Array.from(byServico.values()).sort(
      (a, b) => ordem.indexOf(String(a.servico)) - ordem.indexOf(String(b.servico)),
    );
  }, [data]);

  /** Média geral de execução no mês (média das células serviço×sub com dado). */
  const avgExecucao = useMemo(() => {
    const vals = (data?.execucaoPorServicoSub ?? []).map((e) => e.execucao).filter((v) => Number.isFinite(v));
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  }, [data]);

  /** Ranking das piores baterias: menor produtividade, mais trocas, menor duração.
   * Obs.: a bateria conta a partir da última troca — refinaremos quando houver controle de baterias. */
  const pioresBaterias = useMemo(() => {
    return [...modules]
      .sort(
        (a, b) =>
          a.produtividade - b.produtividade ||
          b.quantidadeTrocas - a.quantidadeTrocas ||
          a.diasOn - b.diasOn,
      )
      .slice(0, 7);
  }, [modules]);

  /** Ranking dos piores setores: média entre produtividade de bateria e de execução. */
  const pioresSetores = useMemo(() => {
    const rows: {
      setor: string;
      subprefeitura: string;
      numeroSelimp: string;
      bateria: number;
      execucao: number | null;
      score: number;
    }[] = [];
    for (const m of modules) {
      const sds = m.setoresDias && m.setoresDias.length > 0
        ? m.setoresDias
        : setoresOf(m).map((s) => ({ setor: s, dias: "", execucao: null as number | null }));
      for (const sd of sds) {
        const exec = sd.execucao ?? null;
        const score = exec != null ? (m.produtividade + exec) / 2 : m.produtividade;
        rows.push({
          setor: sd.setor,
          subprefeitura: m.subprefeitura,
          numeroSelimp: m.numeroSelimp,
          bateria: m.produtividade,
          execucao: exec,
          score: Math.round(score * 10) / 10,
        });
      }
    }
    return rows.sort((a, b) => a.score - b.score).slice(0, 7);
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

  /** Indicadores de trocas registradas no painel (agendamentos/conclusões reais). */
  const trocasStats = useMemo(() => {
    const concluidas: Array<{ item: TrocaHistoryRecord; module: ModuleData }> = [];
    const agendadas: TrocaHistoryRecord[] = [];
    for (const m of modules) {
      const history = trocaHistoryOf(m, troca.records[m.numeroSelimp], troca.history[m.numeroSelimp]);
      for (const h of history) {
        if (!trocaInPeriod(h, trocasPeriod)) continue;
        if (h.status === "concluida") concluidas.push({ item: h, module: m });
        else agendadas.push(h);
      }
    }
    const comSucesso = concluidas.filter(({ item }) => item.sucesso !== false).length;
    const semSucesso = concluidas.filter(({ item }) => item.sucesso === false).length;
    let corretivas = 0;
    let preventivas = 0;
    let desnecessarias = 0;
    const bateriaVals: number[] = [];
    const fallbackModules = new Map<string, ModuleData>();
    for (const { item, module: m } of concluidas) {
      // Desnecessária só conta quando marcada explicitamente (toggle) — não é mais automática.
      const explicitTipo = normalizeStatusKey(item.tipoTroca ?? "");
      const motivo = explicitTipo || normalizeStatusKey(motivoFromModule(m));
      if (explicitTipo.includes("DESNECESS")) desnecessarias += 1;
      else if (motivo.includes("CORRETIVA")) corretivas += 1;
      else if (motivo.includes("PREVENTIVA")) preventivas += 1;

      const pct = normalizePercentValue(item.bateriaDepoisPercentual ?? item.percentualEntrada);
      if (pct != null) bateriaVals.push(pct);
      else fallbackModules.set(m.numeroSelimp, m);
    }
    if (bateriaVals.length === 0) {
      for (const m of fallbackModules.values()) {
        const pct = normalizePercentValue(m.bateriaPercentual);
        if (pct != null) bateriaVals.push(pct);
      }
    }
    const totalAvaliadas = comSucesso + semSucesso;
    const acertividade = totalAvaliadas > 0 ? Math.round((comSucesso / totalAvaliadas) * 100) : 0;
    const mediaBateria = bateriaVals.length > 0 ? Math.round(bateriaVals.reduce((s, n) => s + n, 0) / bateriaVals.length) : 0;
    return {
      total: concluidas.length,
      agendadas: agendadas.length,
      corretivas,
      preventivas,
      desnecessarias,
      comSucesso,
      semSucesso,
      acertividade,
      mediaBateria,
    };
  }, [modules, troca.history, troca.records, trocasPeriod]);

  /** Ranking dos setores com maior quantidade de trocas. */
  const trocasRanking = useMemo(() => {
    const map = new Map<
      string,
      { setor: string; subprefeitura: string; totalTrocas: number; manutencoes: number; duracoes: number[] }
    >();
    for (const m of modules) {
      const history = trocaHistoryOf(m, troca.records[m.numeroSelimp], troca.history[m.numeroSelimp]);
      const concluidasPeriodo = history.filter((h) => h.status === "concluida" && trocaInPeriod(h, trocasPeriod));
      if (concluidasPeriodo.length === 0) continue;
      const key = m.setor || "—";
      const cur =
        map.get(key) ?? {
          setor: m.setor,
          subprefeitura: m.subprefeitura,
          totalTrocas: 0,
          manutencoes: 0,
          duracoes: [],
        };
      cur.totalTrocas += concluidasPeriodo.length;
      cur.manutencoes += 1;
      cur.duracoes.push(...duracoesBateriaAtualizada(m, history, trocasPeriod));
      map.set(key, cur);
    }
    return Array.from(map.values())
      .map((r) => ({ ...r, mediaDuracao: average(r.duracoes) }))
      .sort((a, b) => b.totalTrocas - a.totalTrocas)
      .slice(0, 7);
  }, [modules, troca.history, troca.records, trocasPeriod]);

  /** Opções de "Dias de execução" (união distinta dos dias por setor). */
  const uniqueDays = useMemo(() => {
    const set = new Set<string>();
    for (const m of modules) {
      for (const sd of setoresDiasOf(m)) {
        if (sd.dias && sd.dias.trim()) set.add(sd.dias.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [modules]);

  /** Listagem geral de setores (filtro + busca próprios da aba Trocas). */
  const trocasModules = useMemo(() => {
    let result = modules;
    if (trocasSubFilter.length > 0) result = result.filter((m) => trocasSubFilter.includes(m.subprefeitura));
    if (trocasSearch) {
      const term = trocasSearch.toLowerCase();
      result = result.filter(
        (m) =>
          m.setor.toLowerCase().includes(term) ||
          m.numeroSelimp.toLowerCase().includes(term) ||
          m.subprefeitura.toLowerCase().includes(term),
      );
    }
    if (trocasDaysFilter.length > 0) {
      result = result.filter((m) =>
        setoresDiasOf(m).some((sd) => trocasDaysFilter.includes(sd.dias.trim())),
      );
    }
    if (trocasMotivoFilter.length > 0) {
      const wantManut = trocasMotivoFilter.includes("Manutenção");
      const outros = trocasMotivoFilter.filter((x) => x !== "Manutenção");
      result = result.filter((m) => {
        // "Manutenção" → módulos com manutenção Em análise, Pendente ou Ativa.
        if (wantManut) {
          const st = manutStatusForModule(m);
          if (isOpenManutStatus(st)) return true;
        }
        return outros.includes(motivoFromModule(m));
      });
    }
    if (trocasAgendadaFilter !== "all") {
      result = result.filter((m) => {
        const rec = troca.records[m.numeroSelimp];
        const agendada = rec?.status === "agendada";
        return trocasAgendadaFilter === "sim" ? agendada : !agendada;
      });
    }
    if (trocasBateriaFilter.length > 0) {
      result = result.filter((m) => trocasBateriaFilter.includes(m.statusBateria));
    }

    // Ordenação (não muta a fonte): cópia antes de sort.
    if (trocasSort !== "default") {
      const rank = (m: ModuleData) => STATUS_BAT_RANK[m.statusBateria] ?? -1;
      // Data da última troca concluída (estado corrente; senão o evento concluído mais recente).
      const ultimaTroca = (m: ModuleData): string => {
        const rec = troca.records[m.numeroSelimp];
        if (rec?.status === "concluida" && rec.dataTroca) return rec.dataTroca;
        const concl = (troca.history[m.numeroSelimp] ?? []).find((h) => h.status === "concluida" && h.dataTroca);
        return concl?.dataTroca ?? "";
      };
      const exec = (m: ModuleData): number | null => mediaExecucaoSelimp(m);
      // Qtd. de cargas = trocas registradas no painel (inclui manuais) — mesmo valor exibido na coluna.
      const cargas = (m: ModuleData): number =>
        trocaHistoryOf(m, troca.records[m.numeroSelimp], troca.history[m.numeroSelimp]).length;
      result = [...result].sort((a, b) => {
        switch (trocasSort) {
          case "cargas-desc":
            return cargas(b) - cargas(a);
          case "cargas-asc":
            return cargas(a) - cargas(b);
          case "bateria-desc":
            return rank(b) - rank(a) || b.bateriaPercentual - a.bateriaPercentual;
          case "bateria-asc":
            return rank(a) - rank(b) || a.bateriaPercentual - b.bateriaPercentual;
          case "ultima-troca":
            // Mais recente → mais antiga; sem troca vai para o fim.
            return ultimaTroca(b).localeCompare(ultimaTroca(a));
          case "ultima-troca-asc": {
            // Mais antiga → mais recente; sem troca vai para o fim.
            const da = ultimaTroca(a);
            const db = ultimaTroca(b);
            if (!da && !db) return 0;
            if (!da) return 1;
            if (!db) return -1;
            return da.localeCompare(db);
          }
          case "exec-desc":
            return (exec(b) ?? -1) - (exec(a) ?? -1);
          case "exec-asc":
            return (exec(a) ?? 101) - (exec(b) ?? 101);
          default:
            return 0;
        }
      });
    }
    return result;
  }, [
    modules,
    trocasSubFilter,
    trocasSearch,
    trocasDaysFilter,
    trocasMotivoFilter,
    trocasAgendadaFilter,
    trocasBateriaFilter,
    trocasSort,
    troca.records,
    troca.history,
    manutStatusForModule,
  ]);

  // Paginação da listagem de Trocas (idx global preservado para seleção em lote).
  const totalTrocasPages = Math.max(1, Math.ceil(trocasModules.length / ITEMS_PER_PAGE));
  const paginatedTrocas = useMemo(
    () => trocasModules.slice((trocasPage - 1) * ITEMS_PER_PAGE, trocasPage * ITEMS_PER_PAGE),
    [trocasModules, trocasPage],
  );
  useEffect(() => {
    if (trocasPage > totalTrocasPages) setTrocasPage(1);
  }, [totalTrocasPages, trocasPage]);

  // ===== Seleção múltipla =====
  function toggleSelMode() {
    setSelMode((v) => {
      if (v) {
        setSelected(new Set());
        setLastIdx(null);
      }
      return !v;
    });
  }

  function handleRowSelect(selimp: string, index: number, e: React.MouseEvent) {
    const isShift = e.shiftKey;
    setSelected((prev) => {
      const next = new Set(prev);
      if (isShift && lastIdx != null) {
        const [a, b] = [Math.min(lastIdx, index), Math.max(lastIdx, index)];
        for (let i = a; i <= b; i++) next.add(trocasModules[i].numeroSelimp);
      } else if (next.has(selimp)) {
        next.delete(selimp);
      } else {
        next.add(selimp);
      }
      return next;
    });
    if (!isShift) setLastIdx(index);
  }

  const selectedModules = useMemo(
    () => trocasModules.filter((m) => selected.has(m.numeroSelimp)),
    [trocasModules, selected],
  );
  const selectedOpenManutModules = useMemo(
    () => selectedModules.filter((m) => isOpenManutStatus(manutStatusForModule(m))),
    [selectedModules, manutStatusForModule],
  );
  const selectedAgendadas = useMemo(
    () => selectedModules.filter((m) => troca.records[m.numeroSelimp]?.status === "agendada"),
    [selectedModules, troca.records],
  );
  const selectedOnlyOpenManut = selectedModules.length > 0 && selectedOpenManutModules.length === selectedModules.length;
  /** Todos os selecionados já estão agendados → ação de troca vira "Concluir". */
  const selectedAllAgendadas =
    selectedModules.length > 0 &&
    selectedAgendadas.length === selectedModules.length;

  // ===== Ordenação por coluna (Trocas) =====
  // O dropdown só guarda a recência de troca; as colunas usam o mesmo estado trocasSort.
  const trocaRecencia =
    trocasSort === "ultima-troca" || trocasSort === "ultima-troca-asc" ? trocasSort : "default";
  const colSortDir = (col: "bateria" | "exec" | "cargas"): "asc" | "desc" | null =>
    trocasSort === `${col}-desc` ? "desc" : trocasSort === `${col}-asc` ? "asc" : null;
  const cycleColSort = (col: "bateria" | "exec" | "cargas") =>
    setTrocasSort((prev) =>
      prev === `${col}-desc` ? `${col}-asc` : prev === `${col}-asc` ? "default" : `${col}-desc`,
    );

  // ===== Handlers de agendamento / conclusão =====
  function openConcluir(m: ModuleData) {
    setConcluirDate(isoToday());
    setConcluirDesnecessaria(false);
    setConcluirModule(m);
  }

  function openAgendado(m: ModuleData) {
    const rec = troca.records[m.numeroSelimp];
    setAgendadoDate(rec?.dataAgendada ?? isoToday());
    setAgendadoReagendarOpen(false);
    setAgendadoModule(m);
  }

  function confirmAgendar() {
    if (!agendarModule || !agendarDate) return;
    troca.agendar({
      selimp: agendarModule.numeroSelimp,
      setor: agendarModule.setor,
      dataAgendada: agendarDate,
      tipoTroca: motivoFromModule(agendarModule),
    });
    setAgendarModule(null);
  }

  /** Reagenda (avulso) o módulo já agendado para uma nova data (upsert no backend). */
  function confirmReagendar() {
    if (!agendadoModule || !agendadoDate) return;
    troca.agendar({
      selimp: agendadoModule.numeroSelimp,
      setor: agendadoModule.setor,
      dataAgendada: agendadoDate,
      tipoTroca: motivoFromModule(agendadoModule),
    });
    setAgendadoReagendarOpen(false);
    setAgendadoModule(null);
  }

  function confirmCancelarTroca() {
    if (!agendadoModule) return;
    troca.remover(agendadoModule.numeroSelimp);
    setAgendadoReagendarOpen(false);
    setAgendadoModule(null);
  }

  function confirmBulkCancelarTroca() {
    if (selectedAgendadas.length === 0) return;
    for (const m of selectedAgendadas) troca.remover(m.numeroSelimp);
    setBulkCancelarTrocaOpen(false);
    toggleSelMode();
  }

  function confirmConcluir() {
    if (!concluirModule || !concluirDate) return;
    troca.concluir({
      selimp: concluirModule.numeroSelimp,
      setor: concluirModule.setor,
      dataTroca: concluirDate,
      // Bateria/sinal/última comunicação e o sucesso são determinados automaticamente (snapshots).
      // "Desnecessária" é manual (toggle); senão o tipo (corretiva/preventiva) é automático.
      tipoTroca: concluirDesnecessaria ? "Desnecessária" : undefined,
      ultimaComunicacao: "",
      bateriaAntes: concluirModule.bateria,
      bateriaAntesPercentual: concluirModule.bateriaPercentual,
      statusBateriaAntes: concluirModule.statusBateria,
    });
    setConcluirModule(null);
  }

  function confirmBulkAgendar() {
    if (!bulkAgendarDate || selectedModules.length === 0) return;
    troca.agendar(
      selectedModules.map((m) => ({
        selimp: m.numeroSelimp,
        setor: m.setor,
        dataAgendada: bulkAgendarDate,
        tipoTroca: motivoFromModule(m),
      })),
    );
    setBulkAgendarOpen(false);
    toggleSelMode();
  }

  function openBulkConcluir() {
    setBulkConcluirDate(isoToday());
    setBulkConcluirDesnecessaria(false);
    setBulkConcluirOpen(true);
  }

  function confirmBulkManut() {
    if (selectedModules.length === 0) return;
    const motivo = bulkManutMotivo.trim();
    void moduloManut.registrar(
      selectedModules.map((m) => ({
        selimp: m.numeroSelimp,
        setor: setoresOf(m).join(" / ") || undefined,
        execucao: m.diasExecucao || setoresDiasOf(m).map((s) => s.dias).filter(Boolean).join(" / ") || undefined,
        motivo: motivo || undefined,
        status: "EM_ANALISE",
      })),
    );
    setBulkManutMotivo("");
    setBulkManutOpen(false);
    toggleSelMode();
  }

  function confirmBulkRemoveManut() {
    if (!selectedOnlyOpenManut) return;
    for (const m of selectedModules) {
      const ev = moduloManut.records[m.numeroSelimp];
      if (ev && isOpenManutStatus(ev.status)) {
        void moduloManut.remover(ev.id, ev.selimp);
      }
      if (isEnviadoManutencao(m)) manut.cancelarSolicitacao(m.numeroSelimp);
    }
    toggleSelMode();
  }

  function confirmBulkConcluir() {
    if (!bulkConcluirDate || selectedModules.length === 0) return;
    troca.concluir(
      selectedModules.map((m) => ({
        selimp: m.numeroSelimp,
        setor: m.setor,
        dataTroca: bulkConcluirDate,
        // Bateria/sinal/última comunicação e o sucesso são automáticos (snapshots).
        tipoTroca: bulkConcluirDesnecessaria ? "Desnecessária" : undefined,
        ultimaComunicacao: "",
        bateriaAntes: m.bateria,
        bateriaAntesPercentual: m.bateriaPercentual,
        statusBateriaAntes: m.statusBateria,
      })),
    );
    setBulkConcluirOpen(false);
    toggleSelMode();
  }

  // ===== Aba "Manutenções" (esqueleto + mock) =====
  const modulesBySelimp = useMemo(() => {
    const map = new Map<string, ModuleData>();
    for (const m of modules) map.set(m.numeroSelimp, m);
    return map;
  }, [modules]);

  /** Lista de registros (1 por evento) + módulos enviados pela aba Trocas como Pendente. */
  const manutEntries = useMemo(() => {
    const entries: ManutEntry[] = [];
    // 1) eventos do histórico (1 linha cada)
    for (const [selimp, events] of Object.entries(moduloManut.history)) {
      const mod = modulesBySelimp.get(selimp) ?? null;
      for (const ev of events) {
        const eligible = isContestationEligible({
          status: ev.status,
          dataOrdenado: ev.dataOrdenado,
          dataRetirada: ev.dataRetirada,
          dataReinstalacao: ev.dataReinstalacao,
        });
        entries.push({
          key: `ev-${ev.id}`,
          eventId: ev.id,
          selimp,
          setor: mod?.setor ?? ev.setor ?? selimp,
          sub: mod?.subprefeitura ?? "",
          module: mod,
          status: ev.status,
          dataOrdenado: ev.dataOrdenado,
          dataRetirada: ev.dataRetirada,
          dataReinstalacao: ev.dataReinstalacao,
          dataManutencao: ev.dataManutencao,
          sinalRecuperado: ev.sinalRecuperado,
          oficial: ev.oficial,
          contestado: ev.contestado,
          diasFrequencia: eligible ? ev.diasFrequencia : 0,
          diasContestados: ev.diasContestados,
          contestacaoDias: eligible ? (ev.contestacaoDias ?? []) : [],
          documentoUrl: ev.documentoUrl,
          documentoTitulo: ev.documentoTitulo,
          motivo: ev.motivo,
          createdAt: ev.createdAt,
          quantidadeTrocas: mod?.quantidadeTrocas ?? 0,
          ultimaComunicacao: mod?.ultimaComunicacao ?? "",
        });
      }
    }
    // 2) módulos enviados à manutenção pela aba Trocas, ainda sem evento → Pendente
    const comEvento = new Set(Object.keys(moduloManut.history));
    for (const m of modules) {
      if (comEvento.has(m.numeroSelimp)) continue;
      if (!isEnviadoManutencao(m)) continue;
      entries.push({
        key: `pend-${m.numeroSelimp}`,
        eventId: null,
        selimp: m.numeroSelimp,
        setor: m.setor,
        sub: m.subprefeitura,
        module: m,
        status: "PENDENTE",
        dataOrdenado: manut.overrides[m.numeroSelimp]?.dataSolicitacao,
        sinalRecuperado: false,
        oficial: true,
        contestado: false,
        diasFrequencia: 0,
        contestacaoDias: [],
        quantidadeTrocas: m.quantidadeTrocas,
        ultimaComunicacao: m.ultimaComunicacao,
      });
    }
    // Filtros
    const term = manutSearch.trim().toLowerCase();
    let result = entries.filter((e) => manutInPeriod(manutEntryDate(e), manutPeriod));
    if (manutSubFilter.length > 0) result = result.filter((e) => manutSubFilter.includes(e.sub));
    if (manutOficialFilter === "oficial") result = result.filter((e) => e.oficial);
    else if (manutOficialFilter === "nao") result = result.filter((e) => !e.oficial);
    if (manutStatusFilter !== "all") {
      result =
        manutStatusFilter === "REALIZADA"
          ? result.filter((e) => e.status === "REALIZADA" || e.status === "SINAL_RECUPERADO")
          : result.filter((e) => e.status === manutStatusFilter);
    }
    if (term)
      result = result.filter(
        (e) =>
          e.setor.toLowerCase().includes(term) ||
          e.selimp.toLowerCase().includes(term) ||
          e.sub.toLowerCase().includes(term),
      );
    // Ordena por status; dentro do status, pendentes de contestação primeiro; depois por data desc.
    const pendenteContestacao = (e: ManutEntry) =>
      isContestationEligible(e) && isOpenManutStatus(e.status) && e.contestacaoDias.some((d) => !d.contestado);
    return [...result].sort((a, b) => {
      const oa = MANUT_STATUS_ORDER[a.status];
      const ob = MANUT_STATUS_ORDER[b.status];
      if (oa !== ob) return oa - ob;
      const pa = pendenteContestacao(a) ? 0 : 1;
      const pb = pendenteContestacao(b) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const da = a.createdAt ?? a.dataManutencao ?? a.dataOrdenado ?? "";
      const db = b.createdAt ?? b.dataManutencao ?? b.dataOrdenado ?? "";
      return db.localeCompare(da);
    });
  }, [modules, modulesBySelimp, moduloManut.history, manut.overrides, isEnviadoManutencao, manutSubFilter, manutSearch, manutStatusFilter, manutOficialFilter, manutPeriod]);

  const totalManutPages = Math.max(1, Math.ceil(manutEntries.length / ITEMS_PER_PAGE));
  const paginatedManut = useMemo(
    () => manutEntries.slice((manutPage - 1) * ITEMS_PER_PAGE, manutPage * ITEMS_PER_PAGE),
    [manutEntries, manutPage],
  );
  useEffect(() => {
    if (manutPage > totalManutPages) setManutPage(1);
  }, [totalManutPages, manutPage]);
  useEffect(() => {
    setManutPage(1);
  }, [manutPeriod]);

  /** Alertas do módulo (troca registrada + histórico de manutenção reais). */
  const alertaOf = useCallback(
    (m: ModuleData) => {
      const historicoModulo = (moduloManut.history[m.numeroSelimp] ?? []).map((ev) => ({
        data: manutEventoAlertDate(ev),
        descricao: manutEventoDescricao(ev),
      }));
      return computeAlerta(
        m,
        troca.records[m.numeroSelimp],
        [...historicoModulo, ...historicoFromManutencao(manut.overrides[m.numeroSelimp])],
        troca.history[m.numeroSelimp] ?? [],
      );
    },
    [manut.overrides, moduloManut.history, troca.records, troca.history],
  );

  const manutStats = useMemo(() => {
    const counts: Record<ManutencaoModuloStatus, number> = { EM_ANALISE: 0, PENDENTE: 0, RETIRANDO: 0, ATIVA: 0, REINSTALANDO: 0, REALIZADA: 0, SINAL_RECUPERADO: 0 };
    let total = 0;
    for (const events of Object.values(moduloManut.history)) {
      for (const ev of events) {
        if (!manutInPeriod(manutEventDate(ev), manutPeriod)) continue;
        counts[ev.status] += 1;
        total += 1;
      }
    }
    const comEvento = new Set(Object.keys(moduloManut.history));
    for (const m of modules) {
      if (!comEvento.has(m.numeroSelimp) && isEnviadoManutencao(m)) {
        const date = manut.overrides[m.numeroSelimp]?.dataSolicitacao;
        if (!manutInPeriod(date, manutPeriod)) continue;
        counts.PENDENTE += 1;
        total += 1;
      }
    }
    return { total, ...counts, realizadasTotal: counts.REALIZADA + counts.SINAL_RECUPERADO };
  }, [moduloManut.history, modules, isEnviadoManutencao, manutPeriod, manut.overrides]);

  const manutChartData = useMemo(() => {
    const map = new Map<string, number>();
    for (const [selimp, events] of Object.entries(moduloManut.history)) {
      const sub = modulesBySelimp.get(selimp)?.subprefeitura;
      if (!sub) continue;
      const inPeriod = events.filter((ev) => manutInPeriod(manutEventDate(ev), manutPeriod)).length;
      if (inPeriod === 0) continue;
      map.set(sub, (map.get(sub) ?? 0) + inPeriod);
    }
    return Array.from(map.entries())
      .map(([subprefeitura, manutencoes]) => ({ subprefeitura, manutencoes }))
      .sort((a, b) => b.manutencoes - a.manutencoes);
  }, [moduloManut.history, modulesBySelimp, manutPeriod]);

  /** Abre o modal de registrar manutenção (module=null → seletor no topo). */
  /** Abre o modal. opts.event → edição (persiste update); opts.status → status inicial. */
  const openManutModal = useCallback(
    (module: ModuleData | null, opts?: { selimp?: string; status?: ManutencaoModuloStatus; event?: ModuloManutencaoEvento }) => {
      const ev = opts?.event;
      const base = ev
        ? ev.status === "SINAL_RECUPERADO" ? "REALIZADA" : ev.status
        : opts?.status === "SINAL_RECUPERADO" ? "REALIZADA" : opts?.status ?? "REALIZADA";
      // Datas: ao editar mantém as do registro; em novas interações já vêm com a data de hoje.
      const today = isoToday();
      setManutForm({
        selimp: ev?.selimp ?? module?.numeroSelimp ?? opts?.selimp ?? "",
        status: base as "EM_ANALISE" | "PENDENTE" | "RETIRANDO" | "ATIVA" | "REINSTALANDO" | "REALIZADA",
        motivo: ev?.motivo ?? "",
        dataOrdenado: ev ? ev.dataOrdenado ?? "" : today,
        dataRetirada: ev ? ev.dataRetirada ?? "" : today,
        dataReinstalacao: ev ? ev.dataReinstalacao ?? "" : today,
        dataManutencao: ev ? ev.dataManutencao ?? "" : today,
        sinalRecuperado: ev ? ev.status === "SINAL_RECUPERADO" : false,
        oficial: ev ? ev.oficial : true,
      });
      setManutPickerSearch("");
      setManutModal({ open: true, module, editEventId: ev?.id ?? null });
    },
    [],
  );

  const submitManut = useCallback(() => {
    const selimp = manutForm.selimp.trim();
    if (!selimp) return;
    const mod = manutModal.module ?? modulesBySelimp.get(selimp) ?? null;
    const base = manutForm.status;
    const finalStatus: ManutencaoModuloStatus =
      base === "REALIZADA" && manutForm.sinalRecuperado ? "SINAL_RECUPERADO" : base;
    // Datas cumulativas: Retirando (ordenado) → Ativo (+retirada) → Reinstalando (+reinstalação) → Realizado.
    const hasOrdenado = base === "RETIRANDO" || base === "ATIVA" || base === "REINSTALANDO" || base === "REALIZADA";
    const hasRetirada = base === "ATIVA" || base === "REINSTALANDO" || base === "REALIZADA";
    const hasReinstalacao = (base === "REINSTALANDO" || base === "REALIZADA") && !manutForm.sinalRecuperado;
    const dataOrdenado = hasOrdenado ? manutForm.dataOrdenado || "" : "";
    const dataRetirada = hasRetirada ? manutForm.dataRetirada || "" : "";
    const dataReinstalacao = hasReinstalacao ? manutForm.dataReinstalacao || "" : "";
    const sinalRecuperado = base === "REALIZADA" ? manutForm.sinalRecuperado : false;
    const oficial = manutForm.oficial;
    const motivo = manutForm.motivo.trim();

    if (manutModal.editEventId != null) {
      // Edição: envia valores explícitos (strings vazias limpam as datas); motivo/oficial persistem.
      void moduloManut.atualizar(manutModal.editEventId, selimp, {
        motivo,
        dataOrdenado,
        dataRetirada,
        dataReinstalacao,
        sinalRecuperado,
        oficial,
        status: finalStatus,
      });
    } else {
      const setores = mod ? setoresOf(mod).join(" / ") : undefined;
      const execucao = mod
        ? mod.diasExecucao || setoresDiasOf(mod).map((s) => s.dias).filter(Boolean).join(" / ")
        : undefined;
      void moduloManut.registrar({
        selimp,
        setor: setores || undefined,
        execucao: execucao || undefined,
        motivo: motivo || undefined,
        dataOrdenado: dataOrdenado || undefined,
        dataRetirada: dataRetirada || undefined,
        dataReinstalacao: dataReinstalacao || undefined,
        sinalRecuperado,
        oficial,
        status: finalStatus,
      });
    }
    setManutModal({ open: false, module: null, editEventId: null });
  }, [manutForm, manutModal.module, manutModal.editEventId, modulesBySelimp, moduloManut]);

  /** Contesta/descontesta um dia de despacho específico (com toast). */
  const contestarDia = useCallback(
    (selimp: string, dia: string, contestado: boolean) => {
      void moduloManut.contestarDia(selimp, dia, contestado);
      if (contestado) toast.success(`Dia ${fmtIsoBr(dia)} contestado.`);
      else toast.info(`Contestação de ${fmtIsoBr(dia)} cancelada.`);
    },
    [moduloManut],
  );

  /** Mensagem padrão de contestação (copiável) a partir dos dados da manutenção. */
  const mensagemContestacao = useCallback((e: ManutEntry | null, dia?: string): string => {
    if (!e) return "";
    const ordenado = e.dataOrdenado ? fmtIsoBr(e.dataOrdenado) : "—";
    const diaTxt = dia ? ` referente ao despacho de ${fmtIsoBr(dia)}` : "";
    return `Setor ${e.setor} (SELIMP ${e.selimp}) em processo de manutenção${diaTxt}, conforme comunicado à SELIMP via e-mail no dia ${ordenado}. Solicitamos a desconsideração do percentual zerado, pois o serviço não pôde ser executado.`;
  }, []);

  /** Upload do documento (PDF) que atesta a manutenção → Firebase Storage + salva a URL. */
  const handleUploadDocumento = useCallback(
    async (e: ManutEntry, file: File) => {
      if (e.eventId == null) return;
      if (file.type && file.type !== "application/pdf") {
        toast.error("Envie um arquivo PDF.");
        return;
      }
      setContestUploading(true);
      try {
        const url = await uploadManutencaoDoc(e.selimp, file);
        const titulo = file.name.trim() || "documento.pdf";
        await moduloManut.atualizar(e.eventId, e.selimp, { documentoUrl: url, documentoTitulo: titulo });
        setContestModule((prev) =>
          prev && prev.eventId === e.eventId ? { ...prev, documentoUrl: url, documentoTitulo: titulo } : prev,
        );
        toast.success("Documento anexado.");
      } catch (err) {
        console.error("Erro ao anexar documento", err);
        toast.error("Falha ao anexar o documento.");
      } finally {
        setContestUploading(false);
      }
    },
    [moduloManut],
  );

  /** Remove o PDF anexado à contestação (URL + título no servidor). */
  const handleRemoveDocumento = useCallback(
    async (e: ManutEntry) => {
      if (e.eventId == null) return;
      setContestRemovingDoc(true);
      try {
        await moduloManut.atualizar(e.eventId, e.selimp, { documentoUrl: null, documentoTitulo: null });
        setContestModule((prev) =>
          prev && prev.eventId === e.eventId
            ? { ...prev, documentoUrl: undefined, documentoTitulo: undefined }
            : prev,
        );
        toast.success("Documento removido.");
      } catch (err) {
        console.error("Erro ao remover documento", err);
        toast.error("Falha ao remover o documento.");
      } finally {
        setContestRemovingDoc(false);
        setContestDocDelete(null);
      }
    },
    [moduloManut],
  );

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
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
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
                <TabsTrigger value="setores" className="data-[state=active]:bg-emerald-500 data-[state=active]:text-white text-muted-foreground">
                  <MapPin className="mr-2 h-4 w-4" /> Setores
                </TabsTrigger>
              </TabsList>
              {(activeTab === "trocas" || activeTab === "maintenance") && (
                <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/50 px-3 py-1.5">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <Select
                    value={activeTab === "trocas" ? trocasPeriod : manutPeriod}
                    onValueChange={activeTab === "trocas" ? setTrocasPeriod : setManutPeriod}
                  >
                    <SelectTrigger className="h-8 w-[150px] border-border/60 bg-background/60">
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
              )}
            </div>

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
                    <p className="mt-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">Em manutenção</p>
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
                      Trocas registradas no painel · {trocasStats.agendadas} agendada(s) em aberto.
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
                          <TableHead className="text-center">Duração Bat.</TableHead>
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
                            <TableCell className="text-center tabular-nums text-sky-600 dark:text-sky-400">{r.mediaDuracao != null ? `${r.mediaDuracao}d` : "—"}</TableCell>
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
                <CardHeader className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-foreground">
                        <Table2 className="h-5 w-5 text-emerald-500" /> Listagem Geral de Setores
                      </CardTitle>
                      <CardDescription>Base para seleção e agendamento de trocas de bateria</CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {selMode && selected.size > 0 && (
                        <>
                          {selectedAgendadas.length > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 gap-1.5 border-red-500/50 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                              onClick={() => setBulkCancelarTrocaOpen(true)}
                            >
                              <XCircle className="h-4 w-4" /> Cancelar Troca ({selectedAgendadas.length})
                            </Button>
                          )}
                          {/* Troca: "Concluir" + "Reagendar" substituem "Agendar" quando todos já estão agendados */}
                          {selectedAllAgendadas ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-9 gap-1.5 border-sky-500/50 text-sky-600 hover:bg-sky-500/10 dark:text-sky-400"
                                disabled={selectedOpenManutModules.length > 0}
                                onClick={openBulkConcluir}
                              >
                                <CalendarCheck2 className="h-4 w-4" /> Concluir ({selected.size})
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-9 gap-1.5 border-amber-500/50 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
                                disabled={selectedOpenManutModules.length > 0}
                                onClick={() => { setBulkAgendarMode("reagendar"); setBulkAgendarDate(isoToday()); setBulkAgendarOpen(true); }}
                              >
                                <RefreshCw className="h-4 w-4" /> Reagendar ({selected.size})
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              className="h-9 gap-1.5 bg-emerald-600 font-semibold text-white hover:bg-emerald-700"
                              disabled={selectedOpenManutModules.length > 0}
                              onClick={() => { setBulkAgendarMode("agendar"); setBulkAgendarDate(isoToday()); setBulkAgendarOpen(true); }}
                            >
                              <CalendarPlus className="h-4 w-4" /> Agendar ({selected.size})
                            </Button>
                          )}
                          {/* Manutenção: "Remover Manutenção" substitui "Análise" quando todos estão em manutenção */}
                          {selectedOnlyOpenManut ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 gap-1.5 border-red-500/50 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                              onClick={confirmBulkRemoveManut}
                            >
                              <Trash2 className="h-4 w-4" /> Remover Manutenção ({selected.size})
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 gap-1.5 border-zinc-500/50 text-zinc-600 hover:bg-zinc-500/10 dark:text-zinc-300"
                              onClick={() => { setBulkManutMotivo(""); setBulkManutOpen(true); }}
                            >
                              <Wrench className="h-4 w-4" /> Análise ({selected.size})
                            </Button>
                          )}
                        </>
                      )}
                      {!selMode && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 gap-1.5"
                          disabled={trocasModules.length === 0}
                          onClick={() =>
                            exportTrocasBateriaXlsx(trocasModules, {
                              records: troca.records,
                              history: troca.history,
                              manutRecords: moduloManut.records,
                              period: trocasPeriod,
                            })
                          }
                        >
                          <Download className="h-4 w-4" /> Exportar Excel
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className={cn(
                          "h-9 gap-1.5",
                          selMode && "border-emerald-500/50 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400",
                        )}
                        onClick={toggleSelMode}
                      >
                        {selMode ? <X className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}
                        {selMode ? "Cancelar" : "Selecionar"}
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-[200px]">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Buscar setor, SELIMP..."
                        className="h-9 pl-9"
                        value={trocasSearch}
                        onChange={(e) => setTrocasSearch(e.target.value)}
                      />
                    </div>
                    <MultiSelect
                      compact
                      className="w-[120px]"
                      placeholder="Sub"
                      emptyLabel="Todas subs"
                      options={uniqueSubs.map((s) => ({ value: s, label: s }))}
                      value={trocasSubFilter}
                      onChange={setTrocasSubFilter}
                    />
                    <MultiSelect
                      compact
                      className="w-[204px]"
                      placeholder="Dias de execução"
                      options={uniqueDays.map((d) => ({ value: d, label: d }))}
                      value={trocasDaysFilter}
                      onChange={setTrocasDaysFilter}
                    />
                    <MultiSelect
                      compact
                      className="w-[160px]"
                      placeholder="Motivo da Troca"
                      options={MOTIVO_OPTIONS.map((m) => ({ value: m, label: m }))}
                      value={trocasMotivoFilter}
                      onChange={setTrocasMotivoFilter}
                    />
                    <MultiSelect
                      compact
                      className="w-[170px]"
                      placeholder="Status da Bateria"
                      options={STATUS_BAT_OPTIONS.map((s) => ({ value: s, label: s }))}
                      value={trocasBateriaFilter}
                      onChange={setTrocasBateriaFilter}
                    />
                    <Select value={trocasAgendadaFilter} onValueChange={setTrocasAgendadaFilter}>
                      <SelectTrigger className="h-9 w-[170px]">
                        <CalendarCheck2 className="mr-1 h-4 w-4 text-muted-foreground" />
                        <SelectValue placeholder="Trocas agendadas" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Trocas agendadas: Todas</SelectItem>
                        <SelectItem value="sim">Com troca programada</SelectItem>
                        <SelectItem value="nao">Sem troca programada</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={trocaRecencia} onValueChange={setTrocasSort}>
                      <SelectTrigger className="h-9 w-[200px]">
                        <ArrowUpDown className="mr-1 h-4 w-4 text-muted-foreground" />
                        <SelectValue placeholder="Trocas por data" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Trocas: ordem padrão</SelectItem>
                        <SelectItem value="ultima-troca">Trocas recentes → antigas</SelectItem>
                        <SelectItem value="ultima-troca-asc">Trocas antigas → recentes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-hidden rounded-xl bg-muted/15 shadow-sm ring-1 ring-zinc-200/80 dark:ring-zinc-700/60">
                    <Table className="[&_tbody_tr]:border-b [&_tbody_tr]:border-border/30 [&_thead_tr]:border-b [&_thead_tr]:border-border/30">
                      <TableHeader>
                        <TableRow className="bg-muted/25 hover:bg-muted/25">
                          <TableHead className="w-8 text-center" />
                          <TableHead className="text-center">Sub</TableHead>
                          <TableHead>Setor</TableHead>
                          <TableHead>SELIMP</TableHead>
                          <TableHead>Dias de execução</TableHead>
                          <TableHead>Última Comunicação</TableHead>
                          <TableHead>
                            <SortToggle label="Bateria" dir={colSortDir("bateria")} onClick={() => cycleColSort("bateria")} />
                          </TableHead>
                          <TableHead className="text-center">
                            <SortToggle label="Execução" dir={colSortDir("exec")} onClick={() => cycleColSort("exec")} />
                          </TableHead>
                          <TableHead>Sinal</TableHead>
                          <TableHead>Status da Bateria</TableHead>
                          <TableHead className="text-center">
                            <SortToggle label="Qtd. Cargas" dir={colSortDir("cargas")} onClick={() => cycleColSort("cargas")} />
                          </TableHead>
                          <TableHead className="text-center">Troca</TableHead>
                          <TableHead className="text-center">Alertas</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedTrocas.map((m, i) => {
                          const idx = (trocasPage - 1) * ITEMS_PER_PAGE + i;
                          const rec = troca.records[m.numeroSelimp];
                          const manutStatus = manutStatusForModule(m);
                          const manutStatusOpen = isOpenManutStatus(manutStatus) ? manutStatus : null;
                          const history = trocaHistoryOf(m, rec, troca.history[m.numeroSelimp]);
                          const historyConcluidas = history.filter((h) => h.status === "concluida").length;
                          const historySemData = Math.max(0, (m.quantidadeTrocas || 0) - historyConcluidas);
                          const execucaoHistory = execucaoSelimpHistoryOf(m);
                          const execucaoMedia = mediaExecucaoSelimp(m);
                          // Nº de vezes que o módulo foi efetivamente à manutenção (eventos REALIZADA).
                          const vezesEmManutencao = (moduloManut.history[m.numeroSelimp] ?? []).filter((e) => e.status === "REALIZADA").length;
                          // Troca concluída mais recente (history vem em ordem decrescente por data): só nela
                          // usamos a bateria/sinal atual do módulo como "estado depois".
                          const latestConcluidaId = history.find((h) => h.status === "concluida")?.id;
                          const alerta = alertaOf(m);
                          const sel = selected.has(m.numeroSelimp);
                          const isExpanded = expandedTrocaSelimp === m.numeroSelimp;
                          return (
                            <Fragment key={m.id}>
                            <TableRow
                              key={m.id}
                              role="button"
                              tabIndex={0}
                              className={cn(
                                "border-border/30 hover:bg-muted/20",
                                selMode && sel && "bg-emerald-500/10",
                                !selMode && isExpanded && "bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/30",
                              )}
                              onClick={selMode ? (e) => handleRowSelect(m.numeroSelimp, idx, e) : () => setExpandedTrocaSelimp((v) => (v === m.numeroSelimp ? null : m.numeroSelimp))}
                              onKeyDown={(e) => {
                                if (e.key !== "Enter" && e.key !== " ") return;
                                e.preventDefault();
                                if (selMode) return;
                                setExpandedTrocaSelimp((v) => (v === m.numeroSelimp ? null : m.numeroSelimp));
                              }}
                              style={{ cursor: "pointer", userSelect: selMode ? "none" : undefined }}
                            >
                              {selMode && (
                                <TableCell className="text-center align-middle">
                                  <span
                                    className={cn(
                                      "inline-flex h-4 w-4 items-center justify-center rounded border transition-colors",
                                      sel ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-400 dark:border-zinc-600",
                                    )}
                                  >
                                    {sel && <Check className="h-3 w-3" />}
                                  </span>
                                </TableCell>
                              )}
                              {!selMode && (
                                <TableCell className="w-8 text-center align-middle">
                                  {isExpanded ? (
                                    <ChevronDown className="mx-auto h-4 w-4 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="mx-auto h-4 w-4 text-muted-foreground" />
                                  )}
                                </TableCell>
                              )}
                              <TableCell className="text-center font-medium align-middle">{m.subprefeitura}</TableCell>
                              <TableCell className="align-middle"><SetorCell value={m.setor} /></TableCell>
                              <TableCell className="align-middle">{m.numeroSelimp}</TableCell>
                              <TableCell className="align-middle">
                                <div className="space-y-1 text-xs leading-snug">
                                  {setoresDiasOf(m).map((sd, i) => (
                                    <div key={i} className="flex flex-col">
                                      <span className="font-mono text-[10px] text-muted-foreground">{sd.setor}</span>
                                      <span className="text-foreground">{sd.dias || "—"}</span>
                                    </div>
                                  ))}
                                  {setoresDiasOf(m).length === 0 && <span className="text-muted-foreground">—</span>}
                                </div>
                              </TableCell>
                              <TableCell className="align-middle text-xs text-muted-foreground tabular-nums">
                                {m.ultimaComunicacao || "—"}
                              </TableCell>
                              <TableCell className="align-middle">{m.bateriaPercentual}%</TableCell>
                              <TableCell className="text-center font-medium tabular-nums align-middle">
                                {execucaoMedia != null ? `${execucaoMedia}%` : "—"}
                              </TableCell>
                              <TableCell className="align-middle">
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
                              <TableCell className="align-middle">
                                <div className="flex items-center gap-1.5">
                                  <InfoTooltip text={m.comunicacao === "ON" ? "Bateria atualizada (comunicação ON)" : "Bateria desatualizada (comunicação OFF)"}>
                                    {m.comunicacao === "ON" ? (
                                      <Wifi className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                    ) : (
                                      <WifiOff className="h-3.5 w-3.5 shrink-0 text-red-500" />
                                    )}
                                  </InfoTooltip>
                                  <Badge className={statusBatBadge(m.statusBateria)}>{m.statusBateria}</Badge>
                                </div>
                              </TableCell>
                              <TableCell className="text-center font-medium tabular-nums align-middle">{history.length}</TableCell>
                              <TableCell className="text-center align-middle" onClick={(e) => e.stopPropagation()}>
                                {manutStatusOpen ? (
                                  <Badge className={cn("border", STATUS_MODULO_MANUT_BADGE[manutStatusOpen])}>
                                    {trocaBlockedStatusLabel(manutStatusOpen)}
                                  </Badge>
                                ) : rec?.status === "agendada" ? (
                                  <Button
                                    size="sm"
                                    disabled={selMode}
                                    className="h-7 gap-1 bg-amber-500 text-white hover:bg-amber-600"
                                    onClick={() => openAgendado(m)}
                                  >
                                    <Clock className="h-3.5 w-3.5" /> Agendado · {fmtIsoBr(rec.dataAgendada)}
                                  </Button>
                                ) : (
                                  // Default (sem troca em aberto, incluindo concluídas/sem sucesso): permite agendar.
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={selMode}
                                    className="h-7 gap-1 border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                                    onClick={() => { setAgendarModule(m); setAgendarDate(isoToday()); }}
                                  >
                                    <CalendarPlus className="h-3.5 w-3.5" /> Agendar
                                  </Button>
                                )}
                              </TableCell>
                              <TableCell className="text-center align-middle" onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  disabled={!alerta.hasAlert || selMode}
                                  onClick={() => setAlertModule(m)}
                                  aria-label={
                                    alerta.level === "problema"
                                      ? "Módulo problemático"
                                      : alerta.level === "observacao"
                                        ? "Módulo em observação"
                                        : "Sem alerta"
                                  }
                                  title={
                                    alerta.level === "problema"
                                      ? "Problemático"
                                      : alerta.level === "observacao"
                                        ? "Em observação"
                                        : "Sem alerta"
                                  }
                                  className={cn(
                                    "inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
                                    alerta.level === "problema"
                                      ? "border-red-500/50 bg-red-500/15 text-red-600 hover:bg-red-500/25 dark:text-red-400"
                                      : alerta.level === "observacao"
                                        ? "border-amber-500/50 bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 dark:text-amber-400"
                                        : "cursor-default border-border/50 bg-muted/40 text-muted-foreground/40",
                                  )}
                                >
                                  {alerta.level === "problema" ? (
                                    <BellRing className="h-4 w-4" />
                                  ) : alerta.level === "observacao" ? (
                                    <AlertTriangle className="h-4 w-4" />
                                  ) : (
                                    <Bell className="h-4 w-4" />
                                  )}
                                </button>
                              </TableCell>
                            </TableRow>
                            {!selMode && isExpanded && (
                              <TableRow className="border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/5">
                                <TableCell colSpan={13} className="p-0 align-middle">
                                  <div className="space-y-4 px-4 py-4">
                                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                                      <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                                        <span className="block text-xs text-muted-foreground">Trocas registradas</span>
                                        <span className="mt-1 block text-xl font-bold tabular-nums text-foreground">{history.length}</span>
                                      </div>
                                      <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                                        <span className="block text-xs text-muted-foreground">Status da bateria</span>
                                        <span className="mt-1 block"><Badge className={statusBatBadge(m.statusBateria)}>{m.statusBateria || "—"}</Badge></span>
                                      </div>
                                      <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                                        <span className="block text-xs text-muted-foreground">Bateria atual</span>
                                        <span className="mt-1 block font-semibold text-foreground">{batteryLabel(m.bateria, m.bateriaPercentual)}</span>
                                      </div>
                                      <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                                        <span className="block text-xs text-muted-foreground">Última comunicação atual</span>
                                        <span className="mt-1 block text-xs font-medium tabular-nums text-foreground">{m.ultimaComunicacao || "—"}</span>
                                      </div>
                                      <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                                        <span className="flex items-center gap-1 text-xs text-muted-foreground"><Wrench className="h-3.5 w-3.5 text-zinc-500" /> Vezes em manutenção</span>
                                        <span className="mt-1 block text-xl font-bold tabular-nums text-foreground">{vezesEmManutencao}</span>
                                      </div>
                                    </div>

                                    <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-2">
                                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                          <Percent className="h-4 w-4 text-sky-500" />
                                          <span className="text-sm font-semibold text-foreground">Execução SELIMP</span>
                                        </div>
                                        <Badge className="border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300">
                                          Média 30d: {execucaoMedia != null ? `${execucaoMedia}%` : "—"}
                                        </Badge>
                                      </div>
                                      {execucaoHistory.length > 0 ? (
                                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-10">
                                          {execucaoHistory.map((item, idx) => {
                                            const bat = bateriaDoDia(m, item.data);
                                            return (
                                            <div key={`${item.data}-${idx}`} className="rounded-lg border border-border/50 bg-muted/20 px-2 py-2">
                                              <div className="flex items-center justify-between gap-1">
                                                <span className="text-[11px] font-medium tabular-nums text-muted-foreground">{fmtIsoBr(item.data).slice(0, 5)}</span>
                                                <span className="text-xs font-bold tabular-nums text-foreground">{item.percentual}%</span>
                                              </div>
                                              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                                                <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(0, Math.min(100, item.percentual))}%` }} />
                                              </div>
                                              <div className="mt-1.5 flex items-center gap-1">
                                                <Battery className={cn("h-3 w-3 shrink-0", bat ? bateriaDiaColor(bat) : "text-muted-foreground/50")} />
                                                <span className={cn("text-[11px] font-semibold tabular-nums", bat ? bateriaDiaColor(bat) : "text-muted-foreground")}>
                                                  {bat ? (bat.desatualizada ? "Desat." : bat.percentual != null ? `${Math.round(bat.percentual)}%` : "—") : "—"}
                                                </span>
                                              </div>
                                            </div>
                                            );
                                          })}
                                        </div>
                                      ) : (
                                        <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                                          Sem percentuais SELIMP encerrados nos últimos 30 dias para os setores deste módulo.
                                        </p>
                                      )}
                                    </div>

                                    <div className="rounded-xl border border-border/60 bg-background/60 p-3">
                                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                          <History className="h-4 w-4 text-emerald-500" />
                                          <span className="text-sm font-semibold text-foreground">Histórico de trocas</span>
                                        </div>
                                        {historySemData > 0 && (
                                          <Badge className="border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300">
                                            {historySemData} sem data detalhada
                                          </Badge>
                                        )}
                                      </div>

                                      {history.length === 0 ? (
                                        <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                                          Nenhuma troca registrada no painel. O contador SELIMP indica {m.quantidadeTrocas} carga(s), mas a importação atual não traz as datas individuais.
                                        </p>
                                      ) : (
                                        <div className="space-y-2">
                                          {history.map((h) => {
                                            const isLatestConcluida = h.status === "concluida" && h.id === latestConcluidaId;
                                            // "Depois" real = snapshot logo após a troca; sem snapshot ainda, usa o estado
                                            // atual do módulo apenas na troca mais recente.
                                            const bateriaDepoisLabel =
                                              h.bateriaDepoisPercentual != null || h.bateriaDepois || h.percentualEntrada != null
                                                ? pctBatteryLabel(h.bateriaDepoisPercentual ?? h.percentualEntrada, h.bateriaDepois)
                                                : isLatestConcluida
                                                  ? pctBatteryLabel(m.bateriaPercentual, m.bateria)
                                                  : "—";
                                            const statusAntesLabel =
                                              h.statusBateriaAntes || statusBateriaFromPct(h.bateriaAntesPercentual) || "—";
                                            const statusDepoisLabel =
                                              h.statusBateriaDepois ||
                                              statusBateriaFromPct(h.bateriaDepoisPercentual) ||
                                              (isLatestConcluida ? m.statusBateria : "") ||
                                              "—";
                                            const ultimaAntesLabel = fmtDisplayDate(h.ultimaComunicacaoAntes || h.ultimaComunicacao);
                                            const ultimaDepoisLabel = h.ultimaComunicacaoDepois
                                              ? fmtDisplayDate(h.ultimaComunicacaoDepois)
                                              : isLatestConcluida
                                                ? (m.ultimaComunicacao || "—")
                                                : "—";
                                            return (
                                            <div key={h.id} className="rounded-lg border border-border/50 bg-muted/20 p-3">
                                              <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="flex flex-wrap items-center gap-2">
                                                  <Badge className={trocaStatusBadgeClass(h)}>{trocaStatusLabel(h)}</Badge>
                                                  <span className="text-xs font-medium text-muted-foreground">{h.tipoTroca || motivoFromModule(m)}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                  <span className="text-xs font-semibold tabular-nums text-foreground">
                                                    {h.status === "agendada" ? fmtDisplayDate(h.dataAgendada) : fmtDisplayDate(h.dataTroca)}
                                                  </span>
                                                  {/^\d+$/.test(h.id) && (
                                                    <button
                                                      type="button"
                                                      title="Excluir troca do histórico"
                                                      onClick={() =>
                                                        setTrocaEventoDelete({
                                                          selimp: m.numeroSelimp,
                                                          id: Number(h.id),
                                                          setor: m.setor,
                                                          data: h.status === "agendada" ? (h.dataAgendada ?? "") : (h.dataTroca ?? ""),
                                                        })
                                                      }
                                                      className="text-muted-foreground transition-colors hover:text-red-500"
                                                    >
                                                      <Trash2 className="h-3.5 w-3.5" />
                                                    </button>
                                                  )}
                                                </div>
                                              </div>
                                              <div className="mt-3 grid grid-cols-2 gap-2 text-xs lg:grid-cols-6">
                                                <div className="rounded-md bg-background/70 p-2">
                                                  <span className="block text-muted-foreground">Bateria antes</span>
                                                  <span className="font-medium text-foreground">{pctBatteryLabel(h.bateriaAntesPercentual, h.bateriaAntes)}</span>
                                                </div>
                                                <div className="rounded-md bg-background/70 p-2">
                                                  <span className="block text-muted-foreground">Bateria depois</span>
                                                  <span className="font-medium text-foreground">{bateriaDepoisLabel}</span>
                                                </div>
                                                <div className="rounded-md bg-background/70 p-2">
                                                  <span className="block text-muted-foreground">Status antes</span>
                                                  <span className="font-medium text-foreground">{statusAntesLabel}</span>
                                                </div>
                                                <div className="rounded-md bg-background/70 p-2">
                                                  <span className="block text-muted-foreground">Status depois</span>
                                                  <span className="font-medium text-foreground">{statusDepoisLabel}</span>
                                                </div>
                                                <div className="rounded-md bg-background/70 p-2">
                                                  <span className="block text-muted-foreground">Últ. com. antes</span>
                                                  <span className="font-medium tabular-nums text-foreground">{ultimaAntesLabel}</span>
                                                </div>
                                                <div className="rounded-md bg-background/70 p-2">
                                                  <span className="block text-muted-foreground">Últ. com. depois</span>
                                                  <span className="font-medium tabular-nums text-foreground">{ultimaDepoisLabel}</span>
                                                </div>
                                              </div>
                                            </div>
                                            );
                                          })}
                                        </div>
                                      )}

                                      {historySemData > 0 && history.length > 0 && (
                                        <p className="mt-3 text-xs text-muted-foreground">
                                          O contador SELIMP aponta mais troca(s) do que as registradas no painel. Essas trocas antigas não possuem data/bateria antes e depois na importação atual.
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                            </Fragment>
                          );
                        })}
                        {trocasModules.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={13} className="py-10 text-center text-sm text-muted-foreground">Nenhum setor encontrado.</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Página {trocasPage} de {totalTrocasPages} ({trocasModules.length} setores) — agende pela coluna “Troca”; “Selecionar” para ações em lote.
                    </span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setTrocasPage((p) => Math.max(1, p - 1))} disabled={trocasPage === 1}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setTrocasPage((p) => Math.min(totalTrocasPages, p + 1))} disabled={trocasPage === totalTrocasPages}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ===== MANUTENÇÕES TAB ===== */}
            <TabsContent value="maintenance" className="space-y-6">
              {/* Hero cinza degradê: total + subcards */}
              <div className="relative overflow-hidden rounded-2xl border border-zinc-400/40 bg-linear-to-br from-zinc-600/95 via-slate-700 to-zinc-950 px-6 py-8 shadow-xl shadow-zinc-950/30 ring-1 ring-white/15 sm:px-8">
                <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-slate-400/15 blur-3xl dark:bg-zinc-500/25" aria-hidden />
                <div className="relative flex flex-col gap-8 xl:flex-row xl:items-stretch xl:justify-between xl:gap-10">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-zinc-100/95">
                      <Wrench className="size-9 shrink-0 text-white opacity-95" aria-hidden />
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-white/85">Manutenções</p>
                        <h2 className="text-lg font-semibold text-white">Total de manutenções no período</h2>
                      </div>
                    </div>
                    <p className="mt-6 text-center text-[clamp(3rem,8vw,4.25rem)] font-bold tabular-nums leading-none tracking-tight text-white drop-shadow-sm sm:text-left">
                      {manutStats.total}
                    </p>
                    <p className="mt-3 text-xs text-zinc-200/85">
                      {trocasPeriodLabel(manutPeriod)} — registros de manutenção do módulo
                    </p>
                  </div>
                  <div className="grid flex-1 min-w-[220px] grid-cols-2 gap-4 sm:grid-cols-3 xl:max-w-3xl">
                    <div className="flex flex-col justify-between rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-white/80">1. Em análise</p>
                        <Eye className="size-6 shrink-0 text-violet-200/95" aria-hidden />
                      </div>
                      <p className="mt-4 font-mono text-3xl font-bold tabular-nums text-white">{manutStats.EM_ANALISE}</p>
                    </div>
                    <div className="flex flex-col justify-between rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-white/80">2. Pendentes</p>
                        <AlertTriangle className="size-6 shrink-0 text-amber-200/95" aria-hidden />
                      </div>
                      <p className="mt-4 font-mono text-3xl font-bold tabular-nums text-white">{manutStats.PENDENTE}</p>
                    </div>
                    <div className="flex flex-col justify-between rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-white/80">3. Retirando</p>
                        <PackageX className="size-6 shrink-0 text-rose-200/95" aria-hidden />
                      </div>
                      <p className="mt-4 font-mono text-3xl font-bold tabular-nums text-white">{manutStats.RETIRANDO}</p>
                    </div>
                    <div className="flex flex-col justify-between rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-white/80">4. Ativas</p>
                        <Clock className="size-6 shrink-0 text-sky-200/95" aria-hidden />
                      </div>
                      <p className="mt-4 font-mono text-3xl font-bold tabular-nums text-white">{manutStats.ATIVA}</p>
                    </div>
                    <div className="flex flex-col justify-between rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-white/80">5. Reinstalando</p>
                        <PackageCheck className="size-6 shrink-0 text-indigo-200/95" aria-hidden />
                      </div>
                      <p className="mt-4 font-mono text-3xl font-bold tabular-nums text-white">{manutStats.REINSTALANDO}</p>
                    </div>
                    <div className="flex flex-col justify-between rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-white/80">6. Realizadas</p>
                        <CheckCircle2 className="size-6 shrink-0 text-emerald-200/95" aria-hidden />
                      </div>
                      <p className="mt-4 font-mono text-3xl font-bold tabular-nums text-white">{manutStats.realizadasTotal}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Resumo compacto: manutenções por subprefeitura */}
              <Card className="border-border/50 bg-card/80 shadow-sm backdrop-blur-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm text-foreground">
                    <Wrench className="h-4 w-4 text-zinc-500" /> Manutenções por Subprefeitura
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {manutChartData.length === 0 ? (
                    <p className="py-3 text-center text-xs text-muted-foreground">Nenhuma manutenção registrada.</p>
                  ) : (
                    <div className="space-y-2">
                      {manutChartData.map(({ subprefeitura, manutencoes }) => {
                        const max = manutChartData[0]?.manutencoes ?? 1;
                        const pct = max > 0 ? Math.round((manutencoes / max) * 100) : 0;
                        return (
                          <div key={subprefeitura} className="flex items-center gap-3">
                            <span className="w-10 shrink-0 text-xs font-medium text-muted-foreground">{subprefeitura}</span>
                            <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted/40">
                              <div
                                className="h-full rounded-sm bg-zinc-500/80 dark:bg-zinc-400/70"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="w-6 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
                              {manutencoes}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Listagem de manutenções */}
              <Card className="border-border/50 bg-card/80 shadow-sm backdrop-blur-sm">
                <CardHeader className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-foreground">
                        <Table2 className="h-5 w-5 text-zinc-500" /> Listagem de Manutenções
                      </CardTitle>
                      <CardDescription>Manutenção do módulo (retirada → SELIMP → reinstalação)</CardDescription>
                    </div>
                    <Button
                      size="sm"
                      className="h-9 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={() => openManutModal(null)}
                    >
                      <Plus className="h-4 w-4" /> Registrar manutenção
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-[220px]">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Buscar setor, SELIMP..."
                        className="h-9 pl-9"
                        value={manutSearch}
                        onChange={(e) => setManutSearch(e.target.value)}
                      />
                    </div>
                    <Select value={manutStatusFilter} onValueChange={setManutStatusFilter}>
                      <SelectTrigger className="h-9 w-[150px]">
                        <Wrench className="mr-1 h-4 w-4 text-muted-foreground" />
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos status</SelectItem>
                        <SelectItem value="EM_ANALISE">1. Em análise</SelectItem>
                        <SelectItem value="PENDENTE">2. Pendente</SelectItem>
                        <SelectItem value="RETIRANDO">3. Retirando</SelectItem>
                        <SelectItem value="ATIVA">4. Ativo</SelectItem>
                        <SelectItem value="REINSTALANDO">5. Reinstalando</SelectItem>
                        <SelectItem value="REALIZADA">6. Realizado</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={manutOficialFilter} onValueChange={setManutOficialFilter}>
                      <SelectTrigger className="h-9 w-[150px]">
                        <ShieldCheck className="mr-1 h-4 w-4 text-muted-foreground" />
                        <SelectValue placeholder="Oficial" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas</SelectItem>
                        <SelectItem value="oficial">Oficiais</SelectItem>
                        <SelectItem value="nao">Não oficiais</SelectItem>
                      </SelectContent>
                    </Select>
                    <MultiSelect
                      compact
                      className="w-[130px]"
                      placeholder="Sub"
                      emptyLabel="Todas subs"
                      options={uniqueSubs.map((s) => ({ value: s, label: s }))}
                      value={manutSubFilter}
                      onChange={setManutSubFilter}
                    />
                  </div>
                  {!manutSearch.trim() && (
                    <p className="text-xs text-muted-foreground">
                      Histórico de manutenções (1. Em análise → 2. Pendente → 3. Retirando → 4. Ativo → 5. Reinstalando → 6. Realizado). Módulos enviados à manutenção pela aba Trocas entram como Pendente.
                    </p>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="overflow-hidden rounded-xl bg-muted/15 shadow-sm ring-1 ring-zinc-200/80 dark:ring-zinc-700/60">
                    <Table className="[&_tbody_tr]:border-b [&_tbody_tr]:border-border/30 [&_thead_tr]:border-b [&_thead_tr]:border-border/30">
                      <TableHeader>
                        <TableRow className="bg-muted/25 hover:bg-muted/25">
                          <TableHead className="text-center">Sub</TableHead>
                          <TableHead>Setor</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>SELIMP</TableHead>
                          <TableHead>Execução</TableHead>
                          <TableHead>Última Comunicação</TableHead>
                          <TableHead>Manutenção</TableHead>
                          <TableHead>Motivo</TableHead>
                          <TableHead className="text-center">Qtd. Trocas</TableHead>
                          <TableHead className="text-center">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedManut.map((e) => {
                          const mod = e.module;
                          const dias = mod ? setoresDiasOf(mod) : [];
                          return (
                            <TableRow key={e.key} className="border-border/30 hover:bg-muted/20">
                              <TableCell className="text-center font-medium align-top">{e.sub || "—"}</TableCell>
                              <TableCell className="align-top"><SetorCell value={e.setor} /></TableCell>
                              <TableCell className="align-top">
                                <div className="flex flex-col items-start gap-1">
                                  <Badge className={STATUS_MODULO_MANUT_BADGE[e.status]}>{MANUT_STATUS_LABEL[e.status]}</Badge>
                                  {!e.oficial && (
                                    <Badge className="bg-zinc-500/15 text-zinc-600 border-zinc-500/30 text-[10px] dark:text-zinc-300">N/ OFICIAL</Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="align-top">{e.selimp}</TableCell>
                              <TableCell className="align-top">
                                <div className="space-y-1 text-xs leading-snug">
                                  {dias.map((sd, i) => (
                                    <div key={i} className="flex flex-col">
                                      <span className="font-mono text-[10px] text-muted-foreground">{sd.setor}</span>
                                      <span className="text-foreground">{sd.dias || "—"}</span>
                                    </div>
                                  ))}
                                  {dias.length === 0 && <span className="text-muted-foreground">—</span>}
                                </div>
                              </TableCell>
                              <TableCell className="align-top text-xs text-muted-foreground tabular-nums">
                                {e.ultimaComunicacao || "—"}
                              </TableCell>
                              <TableCell className="align-top text-xs tabular-nums">
                                <div className="space-y-0.5">
                                  <div><span className="text-muted-foreground">Ordenado:</span> {isoBr(e.dataOrdenado)}</div>
                                  <div><span className="text-muted-foreground">Retirada:</span> {isoBr(e.dataRetirada)}</div>
                                  <div>
                                    <span className="text-muted-foreground">Reinstalação:</span>{" "}
                                    {e.dataReinstalacao
                                      ? isoBr(e.dataReinstalacao)
                                      : e.sinalRecuperado
                                        ? <span className="font-medium text-green-700 dark:text-green-400">Sinal recuperado</span>
                                        : "—"}
                                  </div>
                                  {e.createdAt && (
                                    <div className="text-[10px] text-muted-foreground/80">registrado {isoBrDateTime(e.createdAt)}</div>
                                  )}
                                  {e.documentoUrl && (
                                    <a
                                      href={e.documentoUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-[11px] font-medium text-sky-600 hover:underline dark:text-sky-400"
                                      title={e.documentoTitulo || "Documento de manutenção"}
                                    >
                                      <FileText className="h-3 w-3 shrink-0" />
                                      <span className="truncate">{e.documentoTitulo || "Documento anexado"}</span>
                                    </a>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="align-top max-w-[180px] text-xs text-foreground">
                                {e.motivo || <span className="text-muted-foreground">—</span>}
                              </TableCell>
                              <TableCell className="text-center font-medium tabular-nums align-top">{e.quantidadeTrocas}</TableCell>
                              <TableCell className="align-top">
                                <div className="flex flex-col items-center gap-1.5">
                                  <div className="flex items-center justify-center gap-1.5">
                                    {isOpenManutStatus(e.status) && (
                                      <Button
                                        size="sm"
                                        className="h-7 gap-1 bg-emerald-600/90 text-white hover:bg-emerald-700"
                                        onClick={() =>
                                          e.eventId != null
                                            ? openManutModal(mod, {
                                                event: {
                                                  id: e.eventId,
                                                  selimp: e.selimp,
                                                  status: e.status,
                                                  motivo: e.motivo,
                                                  dataOrdenado: e.dataOrdenado,
                                                  dataRetirada: e.dataRetirada,
                                                  dataReinstalacao: e.dataReinstalacao,
                                                  dataManutencao: e.dataManutencao,
                                                  sinalRecuperado: e.sinalRecuperado,
                                                  oficial: e.oficial,
                                                  contestado: e.contestado,
                                                  diasContestados: e.diasContestados,
                                                  diasFrequencia: e.diasFrequencia,
                                                  contestacaoDias: e.contestacaoDias,
                                                  documentoUrl: e.documentoUrl,
                                                  documentoTitulo: e.documentoTitulo,
                                                  createdAt: e.createdAt,
                                                },
                                              })
                                            : openManutModal(mod, { selimp: e.selimp, status: "PENDENTE" })
                                        }
                                      >
                                        <RefreshCw className="h-3.5 w-3.5" /> Atualizar
                                      </Button>
                                    )}
                                    {mod && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 gap-1 border-zinc-400/50 text-zinc-600 hover:bg-zinc-500/10 dark:text-zinc-300"
                                        onClick={() => setHistModule(mod)}
                                      >
                                        <History className="h-3.5 w-3.5" /> Histórico
                                      </Button>
                                    )}
                                  </div>
                                  {/* Contestação por dia (despachos perdidos na manutenção: ordenado → reinstalação) */}
                                  {(() => {
                                    if (!isContestationEligible(e)) return null;
                                    const pendentes = e.contestacaoDias.filter((d) => !d.contestado).length;
                                    const contestados = e.contestacaoDias.filter((d) => d.contestado).length;
                                    if (isOpenManutStatus(e.status) && e.diasFrequencia > 0 && e.eventId != null) {
                                      return (
                                        <Button
                                          size="sm"
                                          className={cn(
                                            "h-7 gap-1 text-white",
                                            pendentes > 0 ? "bg-amber-500 hover:bg-amber-600" : "bg-emerald-600 hover:bg-emerald-700",
                                          )}
                                          onClick={() => setContestModule(e)}
                                        >
                                          <ShieldAlert className="h-3.5 w-3.5" />
                                          {pendentes > 0 ? `Contestar (${pendentes})` : `Contestado (${contestados})`}
                                        </Button>
                                      );
                                    }
                                    const total = e.diasContestados ?? contestados;
                                    return total > 0 ? (
                                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                                        <ShieldCheck className="h-3 w-3 shrink-0" /> {total} dia(s) contestado(s)
                                      </span>
                                    ) : null;
                                  })()}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {manutEntries.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                              {manutSearch.trim()
                                ? "Nenhum registro encontrado para a busca."
                                : "Nenhuma manutenção registrada. Use “Registrar manutenção”."}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Página {manutPage} de {totalManutPages} ({manutEntries.length} registros) — histórico persistido no servidor.
                    </span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setManutPage((p) => Math.max(1, p - 1))} disabled={manutPage === 1}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setManutPage((p) => Math.min(totalManutPages, p + 1))} disabled={manutPage === totalManutPages}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ===== MODULES TAB ===== */}
            <TabsContent value="modules" className="space-y-6">
              {/* ===== KPIs + gráficos de performance (dados reais) ===== */}
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                {/* Produtividade das Baterias: média + ON/OFF + evolução temporal */}
                <Card className="border-border/50 bg-card/80 shadow-sm backdrop-blur-sm xl:col-span-2">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-foreground">
                      <BatteryCharging className="h-5 w-5 text-emerald-500" /> Produtividade das Baterias
                    </CardTitle>
                    <CardDescription>% de dias ON dos módulos SELIMP · evolução em {mesLabel}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-4 grid grid-cols-3 gap-3">
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Média do período</p>
                        <p className="mt-1 text-3xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                          {mediaPeriodoBateria != null ? `${mediaPeriodoBateria}%` : "—"}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">{mesLabel}</p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-muted/15 p-3">
                        <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          <Wifi className="h-3.5 w-3.5 text-emerald-500" /> ON
                        </p>
                        <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">{stats.online}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">atual</p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-muted/15 p-3">
                        <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          <WifiOff className="h-3.5 w-3.5 text-red-500" /> OFF
                        </p>
                        <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">{stats.offline}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">atual</p>
                      </div>
                    </div>
                    <div className="h-[200px] w-full">
                      {evolucaoData.length > 1 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={evolucaoData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                            <XAxis dataKey="label" tick={axisTick} tickLine={false} tickMargin={8} axisLine={{ stroke: axisLineStroke }} />
                            <YAxis tick={axisTick} tickLine={false} tickMargin={6} axisLine={{ stroke: axisLineStroke }} domain={[0, 100]} />
                            <Tooltip content={<GlassTooltip />} cursor={{ stroke: axisLineStroke }} />
                            <Line type="monotone" dataKey="produtividade" name="Produtividade %" stroke={CHART_COLORS.success} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
                          Série temporal indisponível — é necessário histórico de várias datas de importação.
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Produtividade dos Setores: execução SELIMP por tipo de serviço × sub (mês corrente) */}
                <Card className="border-border/50 bg-card/80 shadow-sm backdrop-blur-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-foreground">
                      <Percent className="h-5 w-5 text-sky-500" /> Produtividade dos Setores
                    </CardTitle>
                    <CardDescription>% de execução SELIMP por serviço e sub · {mesLabel}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Execução Média</p>
                      <p className="mt-1 text-3xl font-bold tabular-nums text-sky-600 dark:text-sky-400">
                        {avgExecucao != null ? `${avgExecucao}%` : "—"}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{mesLabel}</p>
                    </div>
                    <div className="h-[180px] w-full">
                      {execServicoSubChartData.length > 0 && execSubs.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={execServicoSubChartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                            <XAxis dataKey="servico" tick={axisTick} tickLine={false} tickMargin={8} axisLine={{ stroke: axisLineStroke }} />
                            <YAxis tick={axisTick} tickLine={false} tickMargin={6} axisLine={{ stroke: axisLineStroke }} domain={[0, 100]} />
                            <Tooltip content={<GlassTooltip />} cursor={{ fill: "transparent" }} />
                            <Legend {...legendProps} />
                            {execSubs.map((sub) => (
                              <Bar key={sub} dataKey={sub} name={sub} fill={SUB_CHART_COLORS[sub]} radius={[4, 4, 0, 0]} activeBar={false} />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
                          Sem dados de execução cruzados no mês.
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* ===== Rankings: piores baterias | piores setores ===== */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card className="border-border/50 bg-card/80 shadow-sm backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-foreground">
                      <Battery className="h-5 w-5 text-red-500" /> Piores Baterias
                    </CardTitle>
                    <CardDescription>Menor produtividade · mais trocas · menor duração · {mesLabel}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/25 hover:bg-muted/25">
                          <TableHead className="w-8">#</TableHead>
                          <TableHead>Setor</TableHead>
                          <TableHead>SELIMP</TableHead>
                          <TableHead className="text-center">Prod.</TableHead>
                          <TableHead className="text-center">Trocas</TableHead>
                          <TableHead className="text-center">Dias ON</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pioresBaterias.map((m, i) => (
                          <TableRow key={m.id} className="border-border/30 hover:bg-muted/20">
                            <TableCell className="font-bold tabular-nums text-muted-foreground">{i + 1}</TableCell>
                            <TableCell><SetorCell value={m.setor} /></TableCell>
                            <TableCell className="text-xs">{m.numeroSelimp}</TableCell>
                            <TableCell className={cn("text-center font-bold tabular-nums", getProductivityColor(m.produtividade))}>{m.produtividade}%</TableCell>
                            <TableCell className="text-center tabular-nums text-muted-foreground">{m.quantidadeTrocas}</TableCell>
                            <TableCell className="text-center tabular-nums text-emerald-600 dark:text-emerald-400">{m.diasOn}</TableCell>
                          </TableRow>
                        ))}
                        {pioresBaterias.length === 0 && (
                          <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Sem dados.</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card className="border-border/50 bg-card/80 shadow-sm backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-foreground">
                      <TrendingUp className="h-5 w-5 text-amber-500" /> Piores Setores
                    </CardTitle>
                    <CardDescription>Média entre produtividade de bateria e execução · {mesLabel}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/25 hover:bg-muted/25">
                          <TableHead className="w-8">#</TableHead>
                          <TableHead>Setor</TableHead>
                          <TableHead className="text-center">Bateria</TableHead>
                          <TableHead className="text-center">Execução</TableHead>
                          <TableHead className="text-center">Média</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pioresSetores.map((s, i) => (
                          <TableRow key={`${s.numeroSelimp}-${s.setor}-${i}`} className="border-border/30 hover:bg-muted/20">
                            <TableCell className="font-bold tabular-nums text-muted-foreground">{i + 1}</TableCell>
                            <TableCell className="font-mono text-xs">{s.setor}</TableCell>
                            <TableCell className={cn("text-center font-medium tabular-nums", getProductivityColor(s.bateria))}>{s.bateria}%</TableCell>
                            <TableCell className="text-center tabular-nums text-muted-foreground">{s.execucao != null ? `${s.execucao}%` : "—"}</TableCell>
                            <TableCell className={cn("text-center font-bold tabular-nums", getProductivityColor(s.score))}>{s.score}%</TableCell>
                          </TableRow>
                        ))}
                        {pioresSetores.length === 0 && (
                          <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">Sem dados.</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>

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
                  <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="space-y-1">
                      <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5" /> Subprefeitura
                      </p>
                      <MultiSelect
                        className="w-full"
                        placeholder="Sub"
                        emptyLabel="Todas subs"
                        options={uniqueSubs.map((s) => ({ value: s, label: s }))}
                        value={subFilter}
                        onChange={(v) => { setSubFilter(v); setCurrentPage(1); }}
                      />
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
                          <SelectItem value="critico">Crítico (&lt;= 20%)</SelectItem>
                          <SelectItem value="baixo">Baixo (21% - 49%)</SelectItem>
                          <SelectItem value="operacional">Operacional (50% - 80%)</SelectItem>
                          <SelectItem value="cheia">Cheia (&gt; 80%)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        <ShieldAlert className="h-3.5 w-3.5" /> Produtividade da Bateria
                      </p>
                      <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}>
                        <SelectTrigger className="w-full">
                          <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos</SelectItem>
                          <SelectItem value="baixa">Baixa (&lt; 20%)</SelectItem>
                          <SelectItem value="atencao">Atenção (20% - 39%)</SelectItem>
                          <SelectItem value="alerta">Alerta (40% - 59%)</SelectItem>
                          <SelectItem value="alta">Alta (60%+)</SelectItem>
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
                          <TableHead>Turno</TableHead>
                          <TableHead>
                            <span className="inline-flex items-center gap-1">
                              <Hash className="h-3.5 w-3.5" /> SELIMP
                            </span>
                          </TableHead>
                          <TableHead>Dias de Execução</TableHead>
                          <TableHead>
                            <span className="inline-flex items-center gap-1">
                              <Battery className="h-3.5 w-3.5" /> Bateria
                            </span>
                          </TableHead>
                          <TableHead>
                            <span className="inline-flex items-center gap-1">
                              <Percent className="h-3.5 w-3.5" /> Exec. SELIMP
                            </span>
                          </TableHead>
                          <TableHead>
                            <span className="inline-flex items-center gap-1">
                              <Activity className="h-3.5 w-3.5" /> Sinal
                            </span>
                          </TableHead>
                          <TableHead>Status da Bateria</TableHead>
                          <TableHead className="text-center">ON / OFF</TableHead>
                          <TableHead>Produtiv.</TableHead>
                          <TableHead className="text-center" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedModules.map((m) => {
                          const turnos = turnosOf(m);
                          return (
                          <TableRow key={m.id} className="border-border/30 hover:bg-muted/20">
                            <TableCell className="text-center font-medium align-top">{m.subprefeitura}</TableCell>
                            <TableCell className="align-top"><SetorCell value={m.setor} /></TableCell>
                            <TableCell className="align-top">
                              <div className="flex flex-col gap-1">
                                {turnos.length > 0 ? (
                                  turnos.map((t) => (
                                    <Badge key={t.label} className={cn("w-fit", turnoBadge(t.label))}>{t.label}</Badge>
                                  ))
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="align-top">{m.numeroSelimp}</TableCell>
                            <TableCell className="align-top">
                              <div className="space-y-1 text-xs leading-snug">
                                {setoresDiasOf(m).map((sd, i) => (
                                  <div key={i} className="flex flex-col">
                                    <span className="font-mono text-[10px] text-muted-foreground">{sd.setor}</span>
                                    <span className="text-foreground">{sd.dias || "—"}</span>
                                  </div>
                                ))}
                                {setoresDiasOf(m).length === 0 && <span className="text-muted-foreground">—</span>}
                              </div>
                            </TableCell>
                            <TableCell className="align-top">{m.bateriaPercentual}%</TableCell>
                            <TableCell className="align-top tabular-nums">
                              {m.produtividadeExecucao != null ? `${m.produtividadeExecucao}%` : "—"}
                            </TableCell>
                            <TableCell className="align-top">
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
                            <TableCell className="align-top">
                              <div className="flex items-center gap-1.5">
                                <InfoTooltip text={m.comunicacao === "ON" ? "Comunicação: ON" : "Comunicação: OFF"}>
                                  {m.comunicacao === "ON" ? (
                                    <Wifi className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                  ) : (
                                    <WifiOff className="h-3.5 w-3.5 shrink-0 text-red-500" />
                                  )}
                                </InfoTooltip>
                                <Badge className={statusBatBadge(m.statusBateria)}>{m.statusBateria}</Badge>
                              </div>
                            </TableCell>
                            <TableCell className="text-center font-medium align-top tabular-nums">
                              <span className="text-emerald-600 dark:text-emerald-400">{m.diasOn}</span>
                              <span className="text-muted-foreground"> / </span>
                              <span className="text-red-600 dark:text-red-400">{m.diasOff}</span>
                            </TableCell>
                            <TableCell className={cn("font-medium align-top", getProductivityColor(m.produtividade))}>{m.produtividade}%</TableCell>
                            <TableCell className="text-center align-top">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label="Ver detalhes"
                                onClick={() => setDetailModule(m)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                          );
                        })}
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

            {/* ===== SETORES TAB ===== */}
            <TabsContent value="setores" className="space-y-6">
              <SetoresTab />
            </TabsContent>
          </Tabs>
        </div>

        {/* ===== Modal de Alertas ===== */}
        <Dialog open={!!alertModule} onOpenChange={(o) => !o && setAlertModule(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                {alertModule && alertaOf(alertModule).level === "observacao" ? (
                  <>
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    Módulo em observação — {alertModule?.numeroSelimp}
                  </>
                ) : (
                  <>
                    <BellRing className="h-5 w-5 text-red-500" />
                    Módulo problemático — {alertModule?.numeroSelimp}
                  </>
                )}
              </DialogTitle>
              <DialogDescription>{alertModule?.setor}</DialogDescription>
            </DialogHeader>
            {alertModule && (() => {
              const a: AlertaInfo = alertaOf(alertModule);
              return (
                <div className="space-y-3">
                  {/* Mensagem: por que o módulo está sinalizado */}
                  {a.reasons.length > 0 && (
                    <div className={cn(
                      "rounded-lg border p-3",
                      a.level === "problema"
                        ? "border-red-500/40 bg-red-500/10"
                        : "border-amber-500/40 bg-amber-500/10",
                    )}>
                      <div className={cn(
                        "mb-1.5 flex items-center gap-2 text-sm font-semibold",
                        a.level === "problema" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400",
                      )}>
                        {a.level === "problema" ? <BellRing className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                        {a.level === "problema" ? "Classificado como problemático porque:" : "Em observação porque:"}
                      </div>
                      <ul className="space-y-1">
                        {a.reasons.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs">
                            <span className={cn(
                              "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                              r.severity === "problema" ? "bg-red-500" : "bg-amber-500",
                            )} />
                            <span className="text-foreground">{r.text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Barra: trocas com sucesso (verde) × sem sucesso (vermelho) */}
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <span className="flex items-center gap-1.5"><Repeat className="h-4 w-4" /> Trocas de bateria</span>
                      <span className="tabular-nums">{a.trocasComSucesso + a.trocasSemSucesso} total</span>
                    </div>
                    {a.trocasComSucesso + a.trocasSemSucesso > 0 ? (
                      <>
                        <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                          <div className="bg-emerald-500" style={{ width: `${(a.trocasComSucesso / (a.trocasComSucesso + a.trocasSemSucesso)) * 100}%` }} />
                          <div className="bg-red-500" style={{ width: `${(a.trocasSemSucesso / (a.trocasComSucesso + a.trocasSemSucesso)) * 100}%` }} />
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-xs">
                          <span className="font-medium text-emerald-600 dark:text-emerald-400">{a.trocasComSucesso} com sucesso</span>
                          <span className="font-medium text-red-600 dark:text-red-400">{a.trocasSemSucesso} sem sucesso</span>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">Nenhuma troca registrada para este módulo.</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className={cn(
                      "rounded-lg border p-3",
                      a.produtividade < 40 ? "border-red-500/30 bg-red-500/10" : "border-border/50 bg-muted/30",
                    )}>
                      <div className={cn("flex items-center gap-2", a.produtividade < 40 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                        <ShieldAlert className="h-4 w-4" />
                        <span className="text-xs font-semibold uppercase tracking-wide">Prod. bateria</span>
                      </div>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{a.produtividade}%</p>
                    </div>
                    <div className={cn(
                      "rounded-lg border p-3",
                      a.produtividadeExecucao != null && a.produtividadeExecucao < 60 ? "border-amber-500/30 bg-amber-500/10" : "border-border/50 bg-muted/30",
                    )}>
                      <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400">
                        <Percent className="h-4 w-4" />
                        <span className="text-xs font-semibold uppercase tracking-wide">Execução 30d</span>
                      </div>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                        {a.produtividadeExecucao != null ? `${a.produtividadeExecucao}%` : "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-3">
                      <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
                        <WifiOff className="h-4 w-4" />
                        <span className="text-xs font-semibold uppercase tracking-wide">Dias offline</span>
                      </div>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{a.diasOffline}</p>
                    </div>
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                      <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                        <Clock className="h-4 w-4" />
                        <span className="text-xs font-semibold uppercase tracking-wide">Offline consecutivos</span>
                      </div>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{a.diasOfflineConsecutivos}</p>
                    </div>
                  </div>
                  {alertModule?.contagemDesde && (
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      Bateria, dias ON/OFF e produtividade contados desde {fmtIsoBr(alertModule.contagemDesde)} (instalação ou última troca).
                    </p>
                  )}
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div className="mb-2 flex items-center gap-2 text-foreground">
                      <History className="h-4 w-4 text-sky-500" />
                      <span className="text-sm font-semibold">Histórico de manutenções</span>
                    </div>
                    {a.historicoManutencoes.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nenhuma manutenção registrada.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {a.historicoManutencoes.map((h, i) => (
                          <li key={i} className="flex items-center gap-2 text-sm">
                            <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="font-mono text-xs tabular-nums text-muted-foreground">{h.data}</span>
                            <span className="text-foreground">{h.descricao}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })()}
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setAlertModule(null)}>Fechar</Button>
              {alertModule && (() => {
                const st = manutStatusForModule(alertModule);
                if (manut.overrides[alertModule.numeroSelimp]?.solicitada) {
                  return (
                    <Button
                      variant="outline"
                      className="gap-1.5 border-amber-500/50 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
                      onClick={() => { manut.cancelarSolicitacao(alertModule.numeroSelimp); }}
                    >
                      <Wrench className="h-4 w-4" /> Manutenção pendente — desfazer
                    </Button>
                  );
                }
                if (isOpenManutStatus(st)) {
                  return (
                    <Button
                      variant="outline"
                      className="gap-1.5 border-sky-500/50 text-sky-600 hover:bg-sky-500/10 dark:text-sky-400"
                      onClick={() => { const m = alertModule; setAlertModule(null); setHistModule(m); }}
                    >
                      <Wrench className="h-4 w-4" /> Em manutenção ({MANUT_STATUS_LABEL[st]})
                    </Button>
                  );
                }
                return (
                  <Button
                    className="gap-1.5 bg-zinc-700 text-white hover:bg-zinc-800 dark:bg-zinc-600 dark:hover:bg-zinc-700"
                    onClick={() => { const m = alertModule; setAlertModule(null); openManutModal(m, { status: "EM_ANALISE" }); }}
                  >
                    <Wrench className="h-4 w-4" /> Adicionar à análise
                  </Button>
                );
              })()}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== Modal de Agendamento ===== */}
        <Dialog open={!!agendarModule} onOpenChange={(o) => !o && setAgendarModule(null)}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <CalendarPlus className="h-5 w-5 text-emerald-500" />
                Agendar troca de bateria
              </DialogTitle>
              <DialogDescription>Defina a data de agendamento da troca.</DialogDescription>
            </DialogHeader>
            {agendarModule && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-muted p-3">
                    <span className="block text-xs text-muted-foreground">Setor</span>
                    <span className="font-medium">{agendarModule.setor}</span>
                  </div>
                  <div className="rounded-lg bg-muted p-3">
                    <span className="block text-xs text-muted-foreground">Módulo SELIMP</span>
                    <span className="font-medium">{agendarModule.numeroSelimp}</span>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Data Agendamento</label>
                  <DatePicker value={agendarDate} onChange={setAgendarDate} />
                </div>
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setAgendarModule(null)}>Cancelar</Button>
              <Button className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={!agendarDate} onClick={confirmAgendar}>
                Agendar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== Modal de Ações do Agendamento (avulso): Concluir ou Reagendar ===== */}
        <Dialog
          open={!!agendadoModule}
          onOpenChange={(o) => {
            if (o) return;
            setAgendadoReagendarOpen(false);
            setAgendadoModule(null);
          }}
        >
          <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl overflow-hidden">
            <DialogHeader className="min-w-0 pr-6">
              <DialogTitle className="flex min-w-0 items-center gap-2 text-base">
                <Clock className="h-5 w-5 shrink-0 text-amber-500" />
                <span className="min-w-0 truncate">Troca agendada</span>
              </DialogTitle>
              <DialogDescription className="min-w-0 break-words">
                {agendadoModule?.setor} · {agendadoModule?.numeroSelimp}
              </DialogDescription>
            </DialogHeader>
            {agendadoModule && (
              <div className="min-w-0 space-y-4">
                <div className="min-w-0 break-words rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm">
                  Agendada para <strong className="tabular-nums">{fmtIsoBr(troca.records[agendadoModule.numeroSelimp]?.dataAgendada)}</strong>. Conclua, reagende ou cancele esta troca.
                </div>
                {agendadoReagendarOpen && (
                  <div className="min-w-0">
                    <label className="mb-1.5 block text-sm font-medium text-foreground">Nova data de agendamento</label>
                    <DatePicker value={agendadoDate} onChange={setAgendadoDate} />
                  </div>
                )}
              </div>
            )}
            <DialogFooter className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:space-x-0">
              <Button
                variant="outline"
                className="w-full min-w-0 justify-center whitespace-nowrap border-red-500/50 px-3 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                onClick={confirmCancelarTroca}
              >
                <XCircle className="mr-1.5 h-4 w-4 shrink-0" /> <span className="truncate">Cancelar troca</span>
              </Button>
              <Button
                variant="outline"
                className="w-full min-w-0 justify-center whitespace-nowrap border-amber-500/50 px-3 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
                disabled={agendadoReagendarOpen && !agendadoDate}
                onClick={() => {
                  if (!agendadoReagendarOpen) {
                    setAgendadoReagendarOpen(true);
                    return;
                  }
                  confirmReagendar();
                }}
              >
                <RefreshCw className="mr-1.5 h-4 w-4 shrink-0" /> <span className="truncate">{agendadoReagendarOpen ? "Salvar reagendamento" : "Reagendar"}</span>
              </Button>
              <Button
                className="w-full min-w-0 justify-center whitespace-nowrap bg-sky-600 px-3 text-white hover:bg-sky-700"
                onClick={() => { const m = agendadoModule; setAgendadoReagendarOpen(false); setAgendadoModule(null); if (m) openConcluir(m); }}
              >
                <CalendarCheck2 className="mr-1.5 h-4 w-4 shrink-0" /> <span className="truncate">Concluir troca</span>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== Modal de Conclusão ===== */}
        <Dialog open={!!concluirModule} onOpenChange={(o) => !o && setConcluirModule(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <CalendarCheck2 className="h-5 w-5 text-sky-500" />
                Concluir troca de bateria
              </DialogTitle>
              <DialogDescription>
                {concluirModule?.setor} · {concluirModule?.numeroSelimp}
              </DialogDescription>
            </DialogHeader>
            {concluirModule && (
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Data da troca</label>
                  <DatePicker value={concluirDate} onChange={setConcluirDate} />
                </div>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Status atual</span>
                    <Badge className={statusBatBadge(concluirModule.statusBateria)}>{concluirModule.statusBateria || "—"}</Badge>
                    <span className="text-xs font-medium tabular-nums text-foreground">{batteryLabel(concluirModule.bateria, concluirModule.bateriaPercentual)}</span>
                  </div>
                  {sucessoPreviewChip(concluirModule)}
                </div>
                <label className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
                  <span className="text-xs text-foreground">
                    Troca desnecessária
                    <span className="block text-[11px] text-muted-foreground">Marque se a troca não era necessária. Com/sem sucesso continua automático.</span>
                  </span>
                  <Switch checked={concluirDesnecessaria} onCheckedChange={setConcluirDesnecessaria} />
                </label>
                <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Bateria, status, última comunicação e o resultado (com/sem sucesso) são determinados
                  automaticamente pelas planilhas de bateria. Trocas que continuarem desatualizadas após a
                  troca são classificadas como <strong>sem sucesso</strong>.
                </p>
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setConcluirModule(null)}>Cancelar</Button>
              <Button className="bg-sky-600 text-white hover:bg-sky-700" disabled={!concluirDate} onClick={confirmConcluir}>
                Registrar conclusão
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== Confirmação de cancelamento de trocas em lote ===== */}
        <Dialog open={bulkCancelarTrocaOpen} onOpenChange={setBulkCancelarTrocaOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                Cancelar trocas agendadas
              </DialogTitle>
              <DialogDescription>
                Esta ação remove o agendamento de troca dos módulos selecionados.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                {selectedAgendadas.length} troca(s) agendada(s) serão canceladas.
              </div>
              <div className="max-h-44 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-2">
                <ul className="space-y-1 text-sm">
                  {selectedAgendadas.map((m) => (
                    <li key={m.numeroSelimp} className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-xs">{m.setor}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{m.numeroSelimp}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setBulkCancelarTrocaOpen(false)}>Voltar</Button>
              <Button
                className="bg-red-600 text-white hover:bg-red-700"
                disabled={selectedAgendadas.length === 0}
                onClick={confirmBulkCancelarTroca}
              >
                <XCircle className="mr-1.5 h-4 w-4" /> Cancelar {selectedAgendadas.length}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== Modal de Agendamento em lote ===== */}
        <Dialog open={bulkAgendarOpen} onOpenChange={setBulkAgendarOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                {bulkAgendarMode === "reagendar" ? <RefreshCw className="h-5 w-5 text-amber-500" /> : <CalendarPlus className="h-5 w-5 text-emerald-500" />}
                {bulkAgendarMode === "reagendar" ? "Reagendar troca" : "Agendar troca"} — {selectedModules.length} setor(es)
              </DialogTitle>
              <DialogDescription>
                {bulkAgendarMode === "reagendar"
                  ? "Todos os setores selecionados serão reagendados para a nova data."
                  : "Todos os setores selecionados serão agendados para a mesma data."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-2">
                <ul className="space-y-1 text-sm">
                  {selectedModules.map((m) => (
                    <li key={m.numeroSelimp} className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-xs">{m.setor}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{m.numeroSelimp}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  {bulkAgendarMode === "reagendar" ? "Nova data de agendamento" : "Data Agendamento"}
                </label>
                <DatePicker value={bulkAgendarDate} onChange={setBulkAgendarDate} />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setBulkAgendarOpen(false)}>Cancelar</Button>
              <Button
                className={bulkAgendarMode === "reagendar" ? "bg-amber-600 text-white hover:bg-amber-700" : "bg-emerald-600 text-white hover:bg-emerald-700"}
                disabled={!bulkAgendarDate}
                onClick={confirmBulkAgendar}
              >
                {bulkAgendarMode === "reagendar" ? "Reagendar" : "Agendar"} {selectedModules.length}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== Modal de Manutenção em lote ===== */}
        <Dialog open={bulkManutOpen} onOpenChange={setBulkManutOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Wrench className="h-5 w-5 text-zinc-500" />
                Adicionar à Análise de manutenção — {selectedModules.length} setor(es)
              </DialogTitle>
              <DialogDescription>
                Os módulos selecionados serão enviados para Manutenções como Em análise.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-2">
                <ul className="space-y-1 text-sm">
                  {selectedModules.map((m) => (
                    <li key={m.numeroSelimp} className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-xs">{m.setor}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{m.numeroSelimp}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Motivo da manutenção</label>
                <Textarea
                  rows={3}
                  placeholder="Ex.: muitas trocas de bateria sem atualização de sinal."
                  value={bulkManutMotivo}
                  onChange={(e) => setBulkManutMotivo(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setBulkManutOpen(false)}>Cancelar</Button>
              <Button
                className="bg-zinc-700 text-white hover:bg-zinc-800 dark:bg-zinc-600 dark:hover:bg-zinc-700"
                onClick={confirmBulkManut}
              >
                <Wrench className="mr-1.5 h-4 w-4" /> Adicionar {selectedModules.length}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== Modal de Conclusão em lote ===== */}
        <Dialog open={bulkConcluirOpen} onOpenChange={setBulkConcluirOpen}>
          <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <CalendarCheck2 className="h-5 w-5 text-sky-500" />
                Concluir trocas — {selectedModules.length} setor(es)
              </DialogTitle>
              <DialogDescription>
                Uma data para todos. Bateria, status e o resultado (com/sem sucesso) são automáticos.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Data da troca</label>
                <DatePicker value={bulkConcluirDate} onChange={setBulkConcluirDate} />
              </div>
              <label className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
                <span className="text-xs text-foreground">
                  Trocas desnecessárias
                  <span className="block text-[11px] text-muted-foreground">Marca todas como desnecessárias. Com/sem sucesso continua automático.</span>
                </span>
                <Switch checked={bulkConcluirDesnecessaria} onCheckedChange={setBulkConcluirDesnecessaria} />
              </label>
              <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border/60 bg-muted/15 p-2">
                {selectedModules.map((m) => (
                  <div key={m.numeroSelimp} className="flex items-center justify-between gap-2 rounded-md bg-background/70 px-2.5 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs text-foreground">{m.setor}</p>
                      <p className="text-xs text-muted-foreground">{m.numeroSelimp}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge className={statusBatBadge(m.statusBateria)}>{m.statusBateria || "—"}</Badge>
                      {sucessoPreviewChip(m)}
                    </div>
                  </div>
                ))}
              </div>
              <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                A prévia usa o status atual; o resultado final fica como <strong>Aguardando</strong> até a próxima
                leitura de bateria após a troca.
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setBulkConcluirOpen(false)}>Cancelar</Button>
              <Button className="bg-sky-600 text-white hover:bg-sky-700" disabled={!bulkConcluirDate} onClick={confirmBulkConcluir}>
                Concluir {selectedModules.length}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== Confirmação: excluir registro de manutenção ===== */}
        <Dialog open={!!manutEventDelete} onOpenChange={(o) => !o && setManutEventDelete(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Trash2 className="h-5 w-5 text-red-500" /> Excluir manutenção
              </DialogTitle>
              <DialogDescription>
                Esta ação remove permanentemente o registro {manutEventDelete?.status} do setor {manutEventDelete?.setor} (SELIMP {manutEventDelete?.selimp}). Não pode ser desfeita.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setManutEventDelete(null)}>Cancelar</Button>
              <Button
                className="gap-1.5 bg-red-600 text-white hover:bg-red-700"
                onClick={() => {
                  if (manutEventDelete) {
                    void moduloManut.remover(manutEventDelete.id, manutEventDelete.selimp);
                    toast.success("Manutenção removida.");
                  }
                  setManutEventDelete(null);
                }}
              >
                <Trash2 className="h-4 w-4" /> Excluir
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== Confirmação: excluir evento do histórico de trocas ===== */}
        <Dialog open={!!trocaEventoDelete} onOpenChange={(o) => !o && setTrocaEventoDelete(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Trash2 className="h-5 w-5 text-red-500" /> Excluir troca do histórico
              </DialogTitle>
              <DialogDescription>
                Esta ação remove permanentemente a troca de {fmtIsoBr(trocaEventoDelete?.data)} do setor {trocaEventoDelete?.setor}. Não pode ser desfeita.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setTrocaEventoDelete(null)}>Cancelar</Button>
              <Button
                className="gap-1.5 bg-red-600 text-white hover:bg-red-700"
                onClick={() => {
                  if (trocaEventoDelete) {
                    troca.removerEvento(trocaEventoDelete.selimp, trocaEventoDelete.id);
                    toast.success("Troca removida do histórico.");
                  }
                  setTrocaEventoDelete(null);
                }}
              >
                <Trash2 className="h-4 w-4" /> Excluir
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== Modal de Contestação por dia ===== */}
        <Dialog open={!!contestModule} onOpenChange={(o) => !o && setContestModule(null)}>
          <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {contestModule && (() => {
              const e = manutEntries.find((x) => x.eventId === contestModule.eventId) ?? contestModule;
              const msg = mensagemContestacao(e);
              return (
                <>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                      <ShieldAlert className="h-5 w-5 text-amber-500" /> Contestação de despachos — {e.selimp}
                    </DialogTitle>
                    <DialogDescription>{e.setor} · em manutenção desde {fmtIsoBr(e.dataOrdenado)}</DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4">
                    {/* Mensagem copiável */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Mensagem de contestação</label>
                      <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs leading-relaxed text-foreground">{msg}</div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => { void navigator.clipboard.writeText(msg); toast.success("Mensagem copiada."); }}
                      >
                        <Copy className="h-3.5 w-3.5" /> Copiar mensagem
                      </Button>
                    </div>

                    {/* Documento (PDF, global por módulo) */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Documento de manutenção (PDF)</label>
                      {e.documentoUrl && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                          <span className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                            <FileText className="h-4 w-4 shrink-0" />
                            <span className="truncate" title={e.documentoTitulo || "Documento anexado"}>
                              {e.documentoTitulo || "Documento anexado"}
                            </span>
                          </span>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <a
                              href={e.documentoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              download={e.documentoTitulo || undefined}
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-background/60 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
                              title={e.documentoTitulo ? `Baixar ${e.documentoTitulo}` : "Baixar documento"}
                            >
                              <Download className="h-3.5 w-3.5" />
                              {e.documentoTitulo ? `Baixar · ${e.documentoTitulo}` : "Baixar"}
                            </a>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 border-red-400/50 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                              disabled={contestUploading || contestRemovingDoc}
                              onClick={() =>
                                setContestDocDelete({
                                  eventId: e.eventId!,
                                  selimp: e.selimp,
                                  titulo: e.documentoTitulo || "Documento anexado",
                                })
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Excluir
                            </Button>
                          </div>
                        </div>
                      )}
                      <label
                        onDragOver={(ev) => ev.preventDefault()}
                        onDrop={(ev) => { ev.preventDefault(); const f = ev.dataTransfer.files?.[0]; if (f) void handleUploadDocumento(e, f); }}
                        className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border/70 bg-muted/15 px-4 py-5 text-center text-xs text-muted-foreground transition-colors hover:bg-muted/30"
                      >
                        <Upload className="h-5 w-5" />
                        {contestUploading ? "Enviando..." : e.documentoUrl ? "Solte um novo PDF para substituir, ou clique" : "Solte o PDF aqui ou clique para anexar"}
                        <input
                          type="file"
                          accept="application/pdf"
                          className="hidden"
                          disabled={contestUploading}
                          onChange={(ev) => { const f = ev.target.files?.[0]; if (f) void handleUploadDocumento(e, f); ev.target.value = ""; }}
                        />
                      </label>
                    </div>

                    {/* Timeline por dia de despacho */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Dias de despacho na janela ({e.contestacaoDias.length})</label>
                      <div className="max-h-[34vh] space-y-1.5 overflow-y-auto pr-1">
                        {e.contestacaoDias.length === 0 && (
                          <p className="py-3 text-center text-xs text-muted-foreground">Sem dias de despacho na janela.</p>
                        )}
                        {e.contestacaoDias.map((d) => (
                          <div key={d.data} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/15 px-3 py-2">
                            <span className="flex items-center gap-2 text-xs">
                              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="font-medium tabular-nums text-foreground">{fmtIsoBr(d.data)}</span>
                              {d.contestado ? (
                                <Badge className="border-emerald-500/30 bg-emerald-500/15 text-[10px] text-emerald-600 dark:text-emerald-400">Contestado</Badge>
                              ) : (
                                <Badge className="border-amber-500/30 bg-amber-500/15 text-[10px] text-amber-700 dark:text-amber-300">Pendente</Badge>
                              )}
                            </span>
                            <Button
                              size="sm"
                              variant={d.contestado ? "outline" : "default"}
                              className={cn("h-7 gap-1", d.contestado ? "" : "bg-amber-500 text-white hover:bg-amber-600")}
                              onClick={() => contestarDia(e.selimp, d.data, !d.contestado)}
                            >
                              {d.contestado ? "Cancelar" : <><ShieldAlert className="h-3.5 w-3.5" /> Contestar</>}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <DialogFooter>
                    <Button variant="ghost" onClick={() => setContestModule(null)}>Fechar</Button>
                  </DialogFooter>
                </>
              );
            })()}
          </DialogContent>
        </Dialog>

        {/* ===== Confirmação: excluir documento da contestação ===== */}
        <Dialog open={!!contestDocDelete} onOpenChange={(o) => !o && !contestRemovingDoc && setContestDocDelete(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Trash2 className="h-5 w-5 text-red-500" /> Excluir documento
              </DialogTitle>
              <DialogDescription>
                Remover o anexo <span className="font-medium text-foreground">{contestDocDelete?.titulo}</span> desta manutenção? O arquivo deixará de aparecer na contestação.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="ghost" disabled={contestRemovingDoc} onClick={() => setContestDocDelete(null)}>
                Cancelar
              </Button>
              <Button
                className="gap-1.5 bg-red-600 text-white hover:bg-red-700"
                disabled={contestRemovingDoc}
                onClick={() => {
                  if (!contestDocDelete || !contestModule) return;
                  const entry =
                    manutEntries.find((x) => x.eventId === contestDocDelete.eventId) ?? contestModule;
                  void handleRemoveDocumento(entry);
                }}
              >
                <Trash2 className="h-4 w-4" /> {contestRemovingDoc ? "Excluindo..." : "Excluir documento"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== Modal de Histórico consolidado do módulo ===== */}
        <Dialog open={!!histModule} onOpenChange={(o) => !o && setHistModule(null)}>
          <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <History className="h-5 w-5 text-zinc-500" />
                Histórico consolidado — {histModule?.numeroSelimp}
              </DialogTitle>
              <DialogDescription>{histModule?.setor}</DialogDescription>
            </DialogHeader>
            {histModule && (() => {
              const m = histModule;
              const rec = troca.records[m.numeroSelimp];
              const trocasAposUltimaComunicacao =
                rec?.status === "concluida" && rec.dataTroca && rec.ultimaComunicacao && rec.dataTroca > rec.ultimaComunicacao ? 1 : 0;
              // Estado de manutenção corrente (evento mais recente) → datas e dias em manutenção.
              const manutRec = moduloManut.records[m.numeroSelimp];
              const startIso = manutRec?.dataRetirada || manutRec?.dataOrdenado;
              const realizadaIso = manutRec?.dataReinstalacao || manutRec?.dataManutencao;
              const fechado = manutRec?.status === "REALIZADA" || manutRec?.status === "SINAL_RECUPERADO";
              const endIso = realizadaIso || (fechado ? undefined : isoToday());
              const diasEmManutencao =
                startIso && endIso
                  ? Math.max(0, Math.round((Date.parse(endIso) - Date.parse(startIso)) / 86400000))
                  : "—";
              const items: { label: string; value: number | string; icon: typeof Wrench; color: string }[] = [
                { label: "Manutenções", value: (moduloManut.history[m.numeroSelimp] ?? []).length, icon: Wrench, color: "text-zinc-600 dark:text-zinc-300" },
                { label: "Trocas de bateria", value: m.quantidadeTrocas, icon: Repeat, color: "text-emerald-600 dark:text-emerald-400" },
                { label: "Trocas após últ. comunicação", value: trocasAposUltimaComunicacao, icon: BatteryCharging, color: "text-sky-600 dark:text-sky-400" },
                { label: "Produtividade bateria", value: `${m.produtividade}%`, icon: Battery, color: "text-emerald-600 dark:text-emerald-400" },
                { label: "Dias ON", value: m.diasOn, icon: Wifi, color: "text-emerald-600 dark:text-emerald-400" },
                { label: "Dias OFF", value: m.diasOff, icon: WifiOff, color: "text-red-600 dark:text-red-400" },
                { label: "Dias em manutenção", value: diasEmManutencao, icon: Clock, color: "text-amber-600 dark:text-amber-400" },
              ];
              return (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    {items.map((it) => {
                      const Icon = it.icon;
                      return (
                        <div key={it.label} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                          <div className={cn("flex items-center gap-2", it.color)}>
                            <Icon className="h-4 w-4" />
                            <span className="text-xs font-semibold uppercase tracking-wide">{it.label}</span>
                          </div>
                          <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{it.value}</p>
                        </div>
                      );
                    })}
                  </div>
                  {/* Datas e situação do ciclo de manutenção corrente */}
                  {manutRec && (
                    <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <Badge className={STATUS_MODULO_MANUT_BADGE[manutRec.status]}>{MANUT_STATUS_LABEL[manutRec.status]}</Badge>
                        {!manutRec.oficial && (
                          <Badge className="bg-zinc-500/15 text-zinc-600 border-zinc-500/30 text-[10px] dark:text-zinc-300">N/ OFICIAL</Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs tabular-nums">
                        <div><span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Ordenado</span>{isoBr(manutRec.dataOrdenado)}</div>
                        <div><span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Retirada</span>{isoBr(manutRec.dataRetirada)}</div>
                        <div>
                          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Reinstalação</span>
                          {manutRec.dataReinstalacao
                            ? isoBr(manutRec.dataReinstalacao)
                            : manutRec.sinalRecuperado
                              ? <span className="text-green-700 dark:text-green-400">Sinal recup.</span>
                              : "—"}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Timeline de contestação por dia (accordion) */}
            {histModule && (() => {
              const rec = moduloManut.records[histModule.numeroSelimp];
              const eligible = rec
                ? isContestationEligible({
                    status: rec.status,
                    dataOrdenado: rec.dataOrdenado,
                    dataRetirada: rec.dataRetirada,
                    dataReinstalacao: rec.dataReinstalacao,
                  })
                : false;
              const dias = eligible ? (rec?.contestacaoDias ?? []) : [];
              if (dias.length === 0) return null;
              const contestados = dias.filter((d) => d.contestado).length;
              return (
                <Accordion type="single" collapsible className="mt-3">
                  <AccordionItem value="contest" className="rounded-lg border border-border/60 bg-muted/15 px-3">
                    <AccordionTrigger className="text-xs font-semibold hover:no-underline">
                      <span className="flex items-center gap-2">
                        <ShieldAlert className="h-4 w-4 text-amber-500" /> Contestações ({contestados}/{dias.length} dias)
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <ol className="relative ml-1 space-y-2 border-l border-border/60 pl-4 pt-1">
                        {dias.map((d) => (
                          <li key={d.data} className="relative">
                            <span
                              className={cn(
                                "absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-background",
                                d.contestado ? "bg-emerald-500" : "bg-amber-500",
                              )}
                            />
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="font-medium tabular-nums text-foreground">{fmtIsoBr(d.data)}</span>
                              <span className={cn("font-semibold", d.contestado ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-300")}>
                                {d.contestado ? "Contestado" : "Pendente"}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ol>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              );
            })()}

            {/* Lista de manutenções do módulo (editar / excluir aqui) */}
            {histModule && (() => {
              const eventos = moduloManut.history[histModule.numeroSelimp] ?? [];
              return (
                <div className="mt-2">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Manutenções registradas ({eventos.length})
                  </p>
                  {eventos.length === 0 ? (
                    <p className="py-3 text-center text-xs text-muted-foreground">Nenhuma manutenção registrada.</p>
                  ) : (
                    <div className="max-h-[38vh] space-y-2 overflow-y-auto pr-1">
                      {eventos.map((ev) => (
                        <div key={ev.id} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge className={STATUS_MODULO_MANUT_BADGE[ev.status]}>{MANUT_STATUS_LABEL[ev.status]}</Badge>
                              {!ev.oficial && (
                                <Badge className="bg-zinc-500/15 text-zinc-600 border-zinc-500/30 text-[10px] dark:text-zinc-300">N/ OFICIAL</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => { const mod = histModule; setHistModule(null); openManutModal(mod, { event: ev }); }}
                                className="text-muted-foreground transition-colors hover:text-sky-500"
                                title="Editar"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setManutEventDelete({
                                    selimp: ev.selimp,
                                    id: ev.id,
                                    setor: histModule.setor,
                                    status: MANUT_STATUS_LABEL[ev.status],
                                  })
                                }
                                className="text-muted-foreground transition-colors hover:text-red-500"
                                title="Excluir"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                          <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1 text-xs">
                            <div><span className="text-muted-foreground">Ordenado:</span> {isoBr(ev.dataOrdenado)}</div>
                            <div><span className="text-muted-foreground">Retirada:</span> {isoBr(ev.dataRetirada)}</div>
                            <div>
                              <span className="text-muted-foreground">Reinstalação:</span>{" "}
                              {ev.dataReinstalacao
                                ? isoBr(ev.dataReinstalacao)
                                : ev.sinalRecuperado
                                  ? <span className="text-green-700 dark:text-green-400">Sinal recuperado</span>
                                  : "—"}
                            </div>
                          </div>
                          {ev.motivo && <p className="mt-1 text-xs text-foreground"><span className="text-muted-foreground">Motivo:</span> {ev.motivo}</p>}
                          {ev.documentoUrl && (
                            <a
                              href={ev.documentoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
                            >
                              <FileText className="h-3 w-3 shrink-0" />
                              <span className="truncate">{ev.documentoTitulo || "Documento anexado"}</span>
                            </a>
                          )}
                          {ev.createdAt && <p className="mt-1 text-[10px] text-muted-foreground/80">registrado {isoBrDateTime(ev.createdAt)}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
            <DialogFooter className="gap-2">
              {histModule && (
                <Button
                  className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={() => { const m = histModule; setHistModule(null); openManutModal(m); }}
                >
                  <Plus className="h-4 w-4" /> Registrar manutenção
                </Button>
              )}
              <Button variant="ghost" onClick={() => setHistModule(null)}>Fechar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== Modal de Registrar manutenção do módulo ===== */}
        <Dialog open={manutModal.open} onOpenChange={(o) => !o && setManutModal({ open: false, module: null, editEventId: null })}>
          <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Wrench className="h-5 w-5 text-emerald-500" />
                {manutModal.editEventId != null ? "Editar manutenção do módulo" : "Registrar manutenção do módulo"}
              </DialogTitle>
              <DialogDescription>
                Ciclo de manutenção do módulo (retirada → SELIMP → reinstalação).
              </DialogDescription>
            </DialogHeader>
            {(() => {
              const mod = manutModal.module ?? modulesBySelimp.get(manutForm.selimp.trim()) ?? null;
              return (
                <div className="space-y-4">
                  {/* Seletor de módulo (apenas quando aberto pelo topo) */}
                  {!manutModal.module ? (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Módulo (SELIMP)</label>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          placeholder="Buscar por SELIMP ou setor..."
                          className="pl-9"
                          value={manutPickerSearch}
                          onChange={(e) => setManutPickerSearch(e.target.value)}
                        />
                      </div>
                      {manutPickerSearch.trim() && !mod && (
                        <div className="max-h-40 overflow-y-auto rounded-md border border-border/60">
                          {modules
                            .filter((mm) => {
                              const t = manutPickerSearch.trim().toLowerCase();
                              return mm.numeroSelimp.toLowerCase().includes(t) || mm.setor.toLowerCase().includes(t);
                            })
                            .slice(0, 30)
                            .map((mm) => (
                              <button
                                key={mm.id}
                                type="button"
                                onClick={() => { setManutForm((f) => ({ ...f, selimp: mm.numeroSelimp })); setManutPickerSearch(""); }}
                                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-muted/40"
                              >
                                <span className="font-medium text-foreground">{mm.numeroSelimp}</span>
                                <span className="font-mono text-[10px] text-muted-foreground">{mm.setor}</span>
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {/* Dados do módulo (auto) */}
                  {mod ? (
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground">{mod.numeroSelimp}</span>
                        <span className="text-muted-foreground">{mod.subprefeitura}</span>
                      </div>
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">{setoresOf(mod).join(" / ") || "—"}</p>
                      <p className="mt-1"><span className="text-muted-foreground">Execução:</span> {mod.diasExecucao || "—"}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Selecione um módulo para continuar.</p>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Status</label>
                    <Select
                      value={manutForm.status}
                      onValueChange={(v) =>
                        setManutForm((f) => ({
                          ...f,
                          status: v as "EM_ANALISE" | "PENDENTE" | "RETIRANDO" | "ATIVA" | "REINSTALANDO" | "REALIZADA",
                          sinalRecuperado: v === "REALIZADA" ? f.sinalRecuperado : false,
                        }))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EM_ANALISE">1. Em análise</SelectItem>
                        <SelectItem value="PENDENTE">2. Pendente</SelectItem>
                        <SelectItem value="RETIRANDO">3. Retirando</SelectItem>
                        <SelectItem value="ATIVA">4. Ativo</SelectItem>
                        <SelectItem value="REINSTALANDO">5. Reinstalando</SelectItem>
                        <SelectItem value="REALIZADA">6. Realizado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Manutenção oficial x não oficial — persiste mesmo trocando o status */}
                  <label className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
                    <span className="text-xs text-foreground">
                      Manutenção oficial
                      <span className="block text-[11px] text-muted-foreground">
                        {manutForm.oficial ? "Registro oficial." : "Não oficial — receberá o selo “N/ OFICIAL”."}
                      </span>
                    </span>
                    <Switch
                      checked={manutForm.oficial}
                      onCheckedChange={(v) => setManutForm((f) => ({ ...f, oficial: v }))}
                    />
                  </label>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Motivo da manutenção</label>
                    <Textarea
                      rows={2}
                      placeholder="Ex.: muitas trocas de bateria sem comunicação / percentual."
                      value={manutForm.motivo}
                      onChange={(e) => setManutForm((f) => ({ ...f, motivo: e.target.value }))}
                    />
                  </div>

                  {manutForm.status !== "EM_ANALISE" && manutForm.status !== "PENDENTE" && (
                    <div className="grid grid-cols-3 gap-3">
                      {/* Ordenado p/ manutenção (e-mail à SELIMP): a partir de Retirando */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Ordenado p/ Manutenção</label>
                        <DatePicker
                          value={manutForm.dataOrdenado}
                          onChange={(v) => setManutForm((f) => ({ ...f, dataOrdenado: v }))}
                        />
                      </div>
                      {/* Data de retirada do módulo: a partir de Ativo */}
                      {(manutForm.status === "ATIVA" || manutForm.status === "REINSTALANDO" || manutForm.status === "REALIZADA") && (
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-muted-foreground">Data de Retirada</label>
                          <DatePicker
                            value={manutForm.dataRetirada}
                            onChange={(v) => setManutForm((f) => ({ ...f, dataRetirada: v }))}
                          />
                        </div>
                      )}
                      {/* Data de reinstalação: a partir de Reinstalando */}
                      {(manutForm.status === "REINSTALANDO" || manutForm.status === "REALIZADA") && (
                        <div className="space-y-1.5">
                          <label className={cn("text-xs font-medium", manutForm.sinalRecuperado ? "text-muted-foreground/50" : "text-muted-foreground")}>
                            Data de Reinstalação
                          </label>
                          <DatePicker
                            value={manutForm.sinalRecuperado ? "" : manutForm.dataReinstalacao}
                            disabled={manutForm.sinalRecuperado}
                            onChange={(v) => setManutForm((f) => ({ ...f, dataReinstalacao: v }))}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {manutForm.status === "REALIZADA" && (
                    <label className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
                      <span className="text-xs text-foreground">
                        Sinal recuperado no deslocamento
                        <span className="block text-[11px] text-muted-foreground">Sem reinstalação física — apenas restaurou o sinal.</span>
                      </span>
                      <Switch
                        checked={manutForm.sinalRecuperado}
                        onCheckedChange={(v) => setManutForm((f) => ({ ...f, sinalRecuperado: v, dataReinstalacao: v ? "" : f.dataReinstalacao }))}
                      />
                    </label>
                  )}
                </div>
              );
            })()}
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setManutModal({ open: false, module: null, editEventId: null })}>Cancelar</Button>
              <Button
                className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={!manutForm.selimp.trim()}
                onClick={submitManut}
              >
                <Plus className="h-4 w-4" /> {manutModal.editEventId != null ? "Salvar" : "Registrar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Detail Dialog */}
        <Dialog open={!!detailModule} onOpenChange={() => setDetailModule(null)}>
          <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
            {detailModule && (() => {
              const sds = detailModule.setoresDias ?? [];
              const sigs = siglasOf(detailModule);
              const turns = turnosOf(detailModule);
              const kmVals = sds.map((s) => s.km).filter((v): v is number => v != null);
              const kmTotal = kmVals.reduce((a, b) => a + b, 0);
              const pracas = sds.filter((s) => siglaFromSetor(s.setor) === "VP" && s.praca);
              return (
                <>
                  <DialogHeader>
                    <DialogTitle className="flex flex-wrap items-center gap-2">
                      <Hash className="h-5 w-5 text-emerald-500" />
                      Detalhes do Módulo
                      {sigs.map((sig) => (
                        <Badge key={sig} className={siglaBadge(sig)}>{sig}</Badge>
                      ))}
                    </DialogTitle>
                    <DialogDescription>{detailModule.numeroSelimp} · {detailModule.setor}</DialogDescription>
                  </DialogHeader>

                  {/* Bloco principal de KPIs */}
                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                    <div className="rounded-lg bg-muted p-3"><span className="block text-xs text-muted-foreground">Subprefeitura</span><span className="font-medium">{detailModule.subprefeitura}</span></div>
                    <div className="rounded-lg bg-muted p-3">
                      <span className="block text-xs text-muted-foreground">Turno</span>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {turns.length > 0 ? turns.map((t) => (
                          <Badge key={t.label} className={turnoBadge(t.label)}>{t.label}</Badge>
                        )) : <span className="font-medium">—</span>}
                      </div>
                    </div>
                    <div className="rounded-lg bg-muted p-3"><span className="block text-xs text-muted-foreground">KM do setor</span><span className="font-medium tabular-nums">{kmTotal > 0 ? `${kmTotal.toFixed(2)} km` : "—"}</span></div>
                    <div className="rounded-lg bg-muted p-3"><span className="block text-xs text-muted-foreground">Comunicação</span><Badge className={detailModule.comunicacao === "ON" ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400" : "bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400"}>{detailModule.comunicacao}</Badge></div>
                    <div className="rounded-lg bg-muted p-3"><span className="block text-xs text-muted-foreground">Bateria</span><span className="font-medium">{detailModule.bateria || `${detailModule.bateriaPercentual}%`}</span></div>
                    <div className="rounded-lg bg-muted p-3"><span className="block text-xs text-muted-foreground">Status da Bateria</span><Badge className={statusBatBadge(detailModule.statusBateria)}>{detailModule.statusBateria}</Badge></div>
                    <div className="rounded-lg bg-muted p-3"><span className="block text-xs text-muted-foreground">Sinal</span><span className="font-medium">{detailModule.statusSinalGeral}</span></div>
                    <div className="rounded-lg bg-muted p-3"><span className="block text-xs text-muted-foreground">Última Comunicação</span><span className="font-medium text-xs">{detailModule.ultimaComunicacao || "—"}</span></div>
                    <div className="rounded-lg bg-muted p-3"><span className="block text-xs text-muted-foreground">Qtd. Trocas</span><span className="font-medium tabular-nums">{detailModule.quantidadeTrocas}</span></div>
                    <div className="rounded-lg bg-muted p-3"><span className="block text-xs text-muted-foreground">Dias ON</span><span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">{detailModule.diasOn}</span></div>
                    <div className="rounded-lg bg-muted p-3"><span className="block text-xs text-muted-foreground">Dias OFF</span><span className="font-medium tabular-nums text-red-600 dark:text-red-400">{detailModule.diasOff}</span></div>
                    <div className="rounded-lg bg-muted p-3"><span className="block text-xs text-muted-foreground">Instalação</span><span className="font-medium text-xs">{formatIptDataInstalacaoBr(detailModule.dataInstalacao) || "—"}</span></div>
                  </div>

                  {/* Produtividades */}
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                      <span className="block text-xs text-muted-foreground">Produtividade Bateria</span>
                      <span className={cn("text-2xl font-bold tabular-nums", getProductivityColor(detailModule.produtividade))}>{detailModule.produtividade}%</span>
                    </div>
                    <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
                      <span className="block text-xs text-muted-foreground">Produtividade Execução</span>
                      <span className="text-2xl font-bold tabular-nums text-sky-600 dark:text-sky-400">
                        {detailModule.produtividadeExecucao != null ? `${detailModule.produtividadeExecucao}%` : "—"}
                      </span>
                    </div>
                  </div>

                  {/* Detalhe por setor (dias / km / execução) */}
                  <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div className="mb-2 flex items-center gap-2 text-foreground">
                      <LayoutDashboard className="h-4 w-4 text-emerald-500" />
                      <span className="text-sm font-semibold">Setores do módulo</span>
                    </div>
                    <div className="space-y-2">
                      {sds.length > 0 ? sds.map((sd, i) => {
                        const sig = siglaFromSetor(sd.setor);
                        const t = turnoFromSetor(sd.setor);
                        return (
                          <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background/60 px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs">{sd.setor}</span>
                              {sig && <Badge className={siglaBadge(sig)}>{sig}</Badge>}
                              {t && <Badge className={turnoBadge(t.label)}>{t.label}</Badge>}
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                              <span>{sd.dias || "—"}</span>
                              {sd.km != null && <span className="tabular-nums">{sd.km.toFixed(2)} km</span>}
                              {sd.execucao != null && <span className="tabular-nums text-sky-600 dark:text-sky-400">Exec. {sd.execucao}%</span>}
                            </div>
                          </div>
                        );
                      }) : (
                        <p className="text-xs text-muted-foreground">{detailModule.diasExecucao || "—"}</p>
                      )}
                    </div>
                  </div>

                  {/* Praças (Varrição de Praças) */}
                  {pracas.length > 0 && (
                    <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                      <div className="mb-2 flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                        <FontAwesomeIcon icon={faTree} className="h-4 w-4" />
                        <span className="text-sm font-semibold">Praças (VP)</span>
                      </div>
                      <ul className="space-y-1">
                        {pracas.map((p, i) => (
                          <li key={i} className="flex items-center gap-2 text-sm">
                            <span className="font-mono text-[11px] text-muted-foreground">{p.setor}</span>
                            <span className="text-foreground">{p.praca}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              );
            })()}
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
