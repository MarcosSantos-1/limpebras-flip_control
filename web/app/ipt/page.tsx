"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { format, startOfDay, startOfMonth, subDays } from "date-fns";
import type { DateRange } from "react-day-picker";
import { ptBR } from "date-fns/locale";
import {
  Activity,
  AlertTriangle,
  BarChart2,
  Battery,
  BatteryLow,
  BatteryWarning,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  CloudRain,
  Cpu,
  Download,
  Flag,
  Hammer,
  Info,
  MapPin,
  MessageSquare,
  Pencil,
  Percent,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Trash2,
  Truck,
  Wrench,
  X,
} from "lucide-react";
import Lottie from "lottie-react";
import loadingAnimation from "@/public/Loading.json";
import { Label } from "@/components/ui/label";
import { Button as UiButton } from "@/components/ui/button";
import { DateRangePicker, getEsteMesRange } from "@/components/ui/date-range-picker";
import { MainLayout } from "@/components/layout/main-layout";
import { EvolutionChartModal, type EvolutionSeriesPoint } from "@/components/evolution-chart-modal";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  apiService,
  type IptPreviewBateriaResumoSetor,
  type IptPreviewBateriaSetorDia,
  type IptPreviewBateriaDdmxDia,
  type IptPreviewModuloBateria,
} from "@/lib/api";
import { useIptData } from "@/lib/use-ipt-data";
import { ManualIndicatorBadge } from "@/components/manual-indicator-badge";
import { getSortKey, getSubFromPlano } from "@/lib/ipt-utils";
import { countIptBaseDadosExportRows, exportIptBaseDadosXlsx } from "@/lib/ipt-export-base-dados";
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

/** Destaque de média no cabeçalho da tabela (limiar por fonte: SELIMP 70%, DDMX 50%) */
const getMediaPeriodoClass = (value: number | null, threshold: number) => {
  if (value == null) return "text-muted-foreground";
  if (value > threshold) return "text-emerald-600 dark:text-emerald-400";
  if (value >= threshold * 0.65) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
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

const getBateriaColorClass = (hasData: boolean, hasDesatualizada: boolean, mediaPercentual: number | null) => {
  if (!hasData) return "bg-slate-500/15 text-muted-foreground";
  if (hasDesatualizada) return "bg-amber-500/15 text-amber-800 dark:text-amber-200";
  if ((mediaPercentual ?? 0) <= 15) return "bg-red-500/15 text-red-800 dark:text-red-200";
  if ((mediaPercentual ?? 0) <= 30) return "bg-yellow-500/15 text-yellow-800 dark:text-yellow-200";
  return "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200";
};

const formatDdmxBateriaPercentual = (value: number) =>
  value < 10 ? `${value.toFixed(1)}%` : `${value.toFixed(0)}%`;

const isVarricaoPlanoUi = (plano: string) => /(VP|VJ|VL)\d{4}/i.test(plano.replace(/\s+/g, ""));

const BateriaSelimpBadge = ({ bateriaDia }: { bateriaDia?: IptPreviewBateriaSetorDia | null }) => {
  const firstModulo = bateriaDia?.modulos[0];
  const hasDesatualizada = (bateriaDia?.desatualizadas ?? 0) > 0;
  const label = hasDesatualizada
    ? "Desatual."
    : bateriaDia?.media_percentual != null
    ? `${bateriaDia.media_percentual.toFixed(0)}%`
    : firstModulo?.bateria_raw || "--";
  const title = bateriaDia
    ? bateriaDia.modulos
        .map((modulo) =>
          `${modulo.numero_selimp}: ${modulo.bateria_raw || "--"}${
            modulo.bateria_desatualizada ? " (desatualizada)" : ""
          }`
        )
        .join(" · ")
    : "Sem dado de bateria para a data do despacho";
  const colorClass = !bateriaDia
    ? "bg-slate-500/15 text-muted-foreground"
    : hasDesatualizada
    ? "bg-amber-500/15 text-amber-800 dark:text-amber-200"
    : (bateriaDia.media_percentual ?? 0) <= 15
    ? "bg-red-500/15 text-red-800 dark:text-red-200"
    : (bateriaDia.media_percentual ?? 0) <= 30
    ? "bg-yellow-500/15 text-yellow-800 dark:text-yellow-200"
    : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold ${colorClass}`}
      title={title}
    >
      <Battery className="h-3.5 w-3.5 shrink-0" />
      {label}
    </span>
  );
};

const BateriaDdmxBadge = ({
  bateriaDia,
  applicable,
}: {
  bateriaDia?: IptPreviewBateriaDdmxDia | null;
  applicable: boolean;
}) => {
  if (!applicable) {
    return <span className="text-muted-foreground">--</span>;
  }
  const hasDesatualizada = (bateriaDia?.desatualizadas ?? 0) > 0;
  const label = hasDesatualizada
    ? "Desatual."
    : bateriaDia?.media_percentual != null
    ? formatDdmxBateriaPercentual(bateriaDia.media_percentual)
    : bateriaDia?.despachos[0]?.bateria_raw || "--";
  const title = bateriaDia
    ? bateriaDia.despachos
        .map((despacho) => {
          const pctLabel =
            despacho.bateria_percentual != null ? ` (${formatDdmxBateriaPercentual(despacho.bateria_percentual)})` : "";
          const status = despacho.bateria_desatualizada ? " — desatualizada" : "";
          return `${despacho.rota}: ${despacho.bateria_raw || "--"}${pctLabel}${status}`;
        })
        .join(" · ")
    : "Sem dado de bateria DDMX para a data do despacho";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold ${getBateriaColorClass(
        Boolean(bateriaDia),
        hasDesatualizada,
        bateriaDia?.media_percentual ?? null
      )}`}
      title={title}
    >
      <Battery className="h-3.5 w-3.5 shrink-0" />
      {label}
    </span>
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

const OBS_DIARIA_CATEGORIES = [
  {
    id: "bateria",
    label: "Bateria baixa",
    Icon: Battery,
    colorClass: "border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-500/20",
    activeClass: "border-violet-500 bg-violet-500/25 text-violet-700 dark:text-violet-200 ring-2 ring-violet-500/40",
    tableIconClass: "text-violet-500",
  },
  {
    id: "alerta_despacho",
    label: "Problema no despacho",
    Icon: AlertTriangle,
    colorClass: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20",
    activeClass: "border-amber-500 bg-amber-500/25 text-amber-700 dark:text-amber-200 ring-2 ring-amber-500/40",
    tableIconClass: "text-amber-500",
  },
  {
    id: "manutencao",
    label: "Manutenção / Veículo",
    Icon: Wrench,
    colorClass: "border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-300 hover:bg-orange-500/20",
    activeClass: "border-orange-500 bg-orange-500/25 text-orange-700 dark:text-orange-200 ring-2 ring-orange-500/40",
    tableIconClass: "text-orange-500",
  },
  {
    id: "demanda_sub",
    label: "Demanda subprefeito",
    Icon: Flag,
    colorClass: "border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20",
    activeClass: "border-blue-500 bg-blue-500/25 text-blue-700 dark:text-blue-200 ring-2 ring-blue-500/40",
    tableIconClass: "text-blue-500",
  },
  {
    id: "chuva",
    label: "Chuva / Intempérie",
    Icon: CloudRain,
    colorClass: "border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300 hover:bg-sky-500/20",
    activeClass: "border-sky-500 bg-sky-500/25 text-sky-700 dark:text-sky-200 ring-2 ring-sky-500/40",
    tableIconClass: "text-sky-500",
  },
  {
    id: "obra",
    label: "Obra / Interdição",
    Icon: Hammer,
    colorClass: "border-yellow-500/50 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-500/20",
    activeClass: "border-yellow-500 bg-yellow-500/25 text-yellow-700 dark:text-yellow-200 ring-2 ring-yellow-500/40",
    tableIconClass: "text-yellow-500",
  },
  {
    id: "outro",
    label: "Outro motivo",
    Icon: MessageSquare,
    colorClass: "border-slate-500/50 bg-slate-500/10 text-slate-700 dark:text-slate-300 hover:bg-slate-500/20",
    activeClass: "border-slate-500 bg-slate-500/25 text-slate-700 dark:text-slate-200 ring-2 ring-slate-500/40",
    tableIconClass: "text-slate-500",
  },
] as const;

const OBS_GLOBAL_CATEGORIES = [
  {
    id: "setor_incorreto",
    label: "Setor incorreto SELIMP",
    Icon: AlertTriangle,
    colorClass: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300 hover:bg-red-500/20",
    activeClass: "border-red-500 bg-red-500/25 text-red-700 dark:text-red-200 ring-2 ring-red-500/40",
    tableIconClass: "text-red-500",
    template: "Setor incorreto cadastrado na SELIMP. Há divergência entre os dados da SELIMP e a base interna.",
  },
  {
    id: "bateria_recorrente",
    label: "Bateria recorrente",
    Icon: BatteryWarning,
    colorClass: "border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-500/20",
    activeClass: "border-violet-500 bg-violet-500/25 text-violet-700 dark:text-violet-200 ring-2 ring-violet-500/40",
    tableIconClass: "text-violet-500",
    template: "Problema recorrente de bateria nos módulos deste setor. Impacto contínuo no IPT.",
  },
  {
    id: "nunca_pontuou",
    label: "Nunca Pontuou",
    Icon: Percent,
    colorClass: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300 hover:bg-red-500/20",
    activeClass: "border-red-500 bg-red-500/25 text-red-700 dark:text-red-200 ring-2 ring-red-500/40",
    tableIconClass: "text-red-500",
    template: "Setor nunca pontuou: percentual de execução zerado em todo o período avaliado.",
  },
  {
    id: "sem_bateria",
    label: "Sem bateria atrelada",
    Icon: BatteryLow,
    colorClass: "border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-300 hover:bg-orange-500/20",
    activeClass: "border-orange-500 bg-orange-500/25 text-orange-700 dark:text-orange-200 ring-2 ring-orange-500/40",
    tableIconClass: "text-orange-500",
    template: "Setor sem módulo de bateria atrelado. Não há acompanhamento de carga/comunicação.",
  },
  {
    id: "alteracao_pendente",
    label: "Alteração pendente",
    Icon: Clock,
    colorClass: "border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20",
    activeClass: "border-blue-500 bg-blue-500/25 text-blue-700 dark:text-blue-200 ring-2 ring-blue-500/40",
    tableIconClass: "text-blue-500",
    template: "Alteração pendente para este setor (cadastro, cronograma ou base). Aguardando atualização.",
  },
  {
    id: "endereco_errado",
    label: "Endereço / Setor errado",
    Icon: MapPin,
    colorClass: "border-pink-500/50 bg-pink-500/10 text-pink-700 dark:text-pink-300 hover:bg-pink-500/20",
    activeClass: "border-pink-500 bg-pink-500/25 text-pink-700 dark:text-pink-200 ring-2 ring-pink-500/40",
    tableIconClass: "text-pink-500",
    template: "Endereço ou delimitação de setor incorreto no cadastro. Requer ajuste na base de dados.",
  },
  {
    id: "outro",
    label: "Outro / Geral",
    Icon: MessageSquare,
    colorClass: "border-slate-500/50 bg-slate-500/10 text-slate-700 dark:text-slate-300 hover:bg-slate-500/20",
    activeClass: "border-slate-500 bg-slate-500/25 text-slate-700 dark:text-slate-200 ring-2 ring-slate-500/40",
    tableIconClass: "text-slate-500",
    template: "",
  },
] as const;

type ObsDiariaCategoria = (typeof OBS_DIARIA_CATEGORIES)[number]["id"];
type ObsGlobalCategoria = (typeof OBS_GLOBAL_CATEGORIES)[number]["id"];

const getObsDiariaCategory = (titulo: string) => {
  const t = (titulo ?? "").toLowerCase();
  if (t.includes("bateria")) return OBS_DIARIA_CATEGORIES.find((c) => c.id === "bateria")!;
  if (t.includes("despacho") || t.includes("alerta") || t.includes("problema no despacho")) return OBS_DIARIA_CATEGORIES.find((c) => c.id === "alerta_despacho")!;
  if (t.includes("manutenção") || t.includes("manutencao") || t.includes("veículo") || t.includes("veiculo") || t.includes("frota")) return OBS_DIARIA_CATEGORIES.find((c) => c.id === "manutencao")!;
  if (t.includes("subprefeito") || t.includes("subprefeitura") || t.includes("demanda sub")) return OBS_DIARIA_CATEGORIES.find((c) => c.id === "demanda_sub")!;
  if (t.includes("chuva") || t.includes("intempérie") || t.includes("intemperie") || t.includes("chuva")) return OBS_DIARIA_CATEGORIES.find((c) => c.id === "chuva")!;
  if (t.includes("obra") || t.includes("interdição") || t.includes("interdicao") || t.includes("bloqueio")) return OBS_DIARIA_CATEGORIES.find((c) => c.id === "obra")!;
  return OBS_DIARIA_CATEGORIES.find((c) => c.id === "outro")!;
};

const getObsGlobalCategory = (titulo: string) => {
  const t = (titulo ?? "").toLowerCase();
  if (t.includes("setor incorreto") || (t.includes("incorreto") && t.includes("selimp")) || t.startsWith("selimp")) return OBS_GLOBAL_CATEGORIES.find((c) => c.id === "setor_incorreto")!;
  if (t.includes("nunca") && (t.includes("pontu") || t.includes("zerado") || t.includes("zero"))) return OBS_GLOBAL_CATEGORIES.find((c) => c.id === "nunca_pontuou")!;
  if (t.includes("sem bateria") || t.includes("sem modulo") || t.includes("sem módulo") || (t.includes("bateria") && (t.includes("atrelad") || t.includes("ausen") || t.includes("sem ")))) return OBS_GLOBAL_CATEGORIES.find((c) => c.id === "sem_bateria")!;
  if (t.includes("bateria recorrente") || t.includes("bateria")) return OBS_GLOBAL_CATEGORIES.find((c) => c.id === "bateria_recorrente")!;
  if (t.includes("alteração pendente") || t.includes("alteracao pendente") || t.includes("pendente") || t.includes("aguardando") || t.includes("alteracao") || t.includes("alteração")) return OBS_GLOBAL_CATEGORIES.find((c) => c.id === "alteracao_pendente")!;
  // Compat: títulos antigos ("Veículo / Módulo inativo", "Demanda subprefeito") caem em categorias atuais
  if (t.includes("veículo") || t.includes("veiculo") || t.includes("módulo inativo") || t.includes("modulo inativo") || t.includes("inativo")) return OBS_GLOBAL_CATEGORIES.find((c) => c.id === "nunca_pontuou")!;
  if (t.includes("subprefeito") || t.includes("subprefeitura") || t.includes("demanda")) return OBS_GLOBAL_CATEGORIES.find((c) => c.id === "alteracao_pendente")!;
  if (t.includes("endereço") || t.includes("endereco") || t.includes("errado")) return OBS_GLOBAL_CATEGORIES.find((c) => c.id === "endereco_errado")!;
  return OBS_GLOBAL_CATEGORIES.find((c) => c.id === "outro")!;
};

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
type TableScope = "dia_anterior" | "periodo";

export default function IPTPage() {
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [tableScope, setTableScope] = useState<TableScope>("dia_anterior");
  const [tablePeriodRange, setTablePeriodRange] = useState<{ inicio: Date; fim: Date } | null>(null);
  const [subprefeituraFilter, setSubprefeituraFilter] = useState("all");
  const [baseDadosCardFilter, setBaseDadosCardFilter] = useState<"obs_global" | "obs_diaria" | null>(null);
  const [modalDownloadOpen, setModalDownloadOpen] = useState(false);
  const [origemFilter, setOrigemFilter] = useState<"all" | "ambos" | "somente_selimp" | "somente_nosso" | "sem_despacho">("all");
  const [zeroFilter, setZeroFilter] = useState<"all" | "zerados" | "nao_zerados">("all");
  const [tableSearchQuery, setTableSearchQuery] = useState("");
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
  const [modalCruzamentoOpen, setModalCruzamentoOpen] = useState(false);
  const [iptFormulaTooltip, setIptFormulaTooltip] = useState(false);
  const monthReferenciaInputRef = useRef<HTMLInputElement>(null);
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
  const [modalObsGlobalCategoria, setModalObsGlobalCategoria] = useState<ObsGlobalCategoria | "">("");
  const [modalObsDiariaOpen, setModalObsDiariaOpen] = useState(false);
  const [modalObsDiariaSetor, setModalObsDiariaSetor] = useState<string | null>(null);
  const [modalObsDiariaData, setModalObsDiariaData] = useState<string | null>(null);
  const [modalObsDiariaTitulo, setModalObsDiariaTitulo] = useState("");
  const [modalObsDiariaCategoria, setModalObsDiariaCategoria] = useState<ObsDiariaCategoria | "">("");
  /** Chaves de observações salvas na sessão corrente — usadas para animar ícones na tabela */
  const [recentlySavedKeys, setRecentlySavedKeys] = useState<Set<string>>(new Set());
  /** Menu ações da obs. diária: `plano::YYYY-MM-DD` — um menu aberto por vez */
  const [obsDiariaMenuKey, setObsDiariaMenuKey] = useState<string | null>(null);
  const [serviceEvolutionOpen, setServiceEvolutionOpen] = useState(false);
  const [serviceEvolutionTitle, setServiceEvolutionTitle] = useState("");
  const [serviceEvolutionPoints, setServiceEvolutionPoints] = useState<EvolutionSeriesPoint[]>([]);
  const [serviceEvolutionLoading, setServiceEvolutionLoading] = useState(false);
  const { previewCards: iptPreviewCards, previewTable: iptPreviewTable, observacoes, kpis: kpisData, isLoading: loading, mutate: loadData } = useIptData(
    selectedMonth,
    tableScope,
    tablePeriodRange,
    subprefeituraFilter
  );

  const iptCard = useMemo(
    () => {
      const cenarios = iptPreviewCards?.resumo.ipt_cenarios ?? kpisData?.indicadores?.ipt?.cenarios ?? null;
      return {
        valor: cenarios?.estimado.percentual ?? kpisData?.indicadores?.ipt?.valor,
        pontuacao: cenarios?.estimado.pontuacao ?? kpisData?.indicadores?.ipt?.pontuacao,
        cenarios,
      };
    },
    [iptPreviewCards, kpisData]
  );

  const adcOverride = kpisData?.adc_override;
  const adcManual = Boolean(adcOverride?.ativo);
  const adcManualObservacao = adcOverride?.observacao ?? "";
  const adcManualIptPontuacao =
    adcOverride?.modo === "por_indicador" && adcOverride.pontuacao_ipt != null
      ? adcOverride.pontuacao_ipt
      : null;

  const iptRiskTone = useMemo(() => {
    const risco = iptCard.cenarios?.diagnostico.risco;
    if (iptCard.cenarios?.diagnostico.cobertura_fonte === "presumida_100") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    if (risco === "alto") return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
    if (risco === "medio") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }, [iptCard.cenarios]);

  const handleServiceEvolutionClick = async (tipoServico: string) => {
    const label = tipoServico || "Não informado";
    const year = selectedMonth.getFullYear();
    const month = selectedMonth.getMonth() + 1;
    const lastDay = new Date(year, month, 0).getDate();
    const inicio = format(startOfMonth(selectedMonth), "yyyy-MM-dd");
    const fim = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    setServiceEvolutionTitle(label);
    setServiceEvolutionOpen(true);
    setServiceEvolutionLoading(true);
    setServiceEvolutionPoints([]);
    try {
      const response = await apiService.getIptServiceSnapshots(label, inicio, fim);
      setServiceEvolutionPoints(
        response.pontos.map((point) => ({
          date: point.periodo_final,
          value: point.percentual,
          secondaryValue: point.media_sem_zerados,
          dayValue: point.percentual_dia,
          count: point.total_despachos,
          dayCount: point.total_despachos_dia,
          plannedCount: point.despachos_previstos,
          plannedDayCount: point.despachos_previstos_dia,
          coverageValue: point.cobertura_despachos,
          dayCoverageValue: point.cobertura_despachos_dia,
          notDispatchedCount: point.despachos_nao_despachados,
          notDispatchedDayCount: point.despachos_nao_despachados_dia,
          zeroCount: point.despachos_zerados,
          dayZeroCount: point.despachos_zerados_dia,
          meta: `${point.quantidade_planos} planos | ${point.despachos_zerados} zerados acumulados`,
        }))
      );
    } catch {
      setServiceEvolutionPoints([]);
    } finally {
      setServiceEvolutionLoading(false);
    }
  };

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
  }, [iptPreviewCards?.subprefeituras, iptPreviewTable?.subprefeituras]);

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
        despachos_nosso?: number;
        despachos_previstos?: number;
        despachos_nao_despachados?: number;
        cobertura_despachos?: number | null;
        raw_selimp_sum?: number;
        raw_selimp_count?: number;
        equipamentos?: string[];
        modulos_bateria?: IptPreviewModuloBateria[];
        produtividade_bateria_media?: number | null;
        bateria_resumo_setor?: IptPreviewBateriaResumoSetor;
        bateria_por_equipamento?: Record<string, {
          status_bateria: string;
          bateria?: string;
          data_ultima_comunicacao?: string;
          dias?: string;
          dias_on?: number;
          dias_off?: number;
          produtividade_bateria?: number;
          status_sinal?: string;
          numero_selimp?: string;
        }>;
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
          bateria_setor_dia?: IptPreviewBateriaSetorDia | null;
          bateria_ddmx_dia?: IptPreviewBateriaDdmxDia | null;
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const normalizeSearch = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const filteredComparativo = useMemo(() => {
    const rows = sourceRows;
    const q = normalizeSearch(tableSearchQuery);
    const filtered = rows.filter((row) => {
      if (q) {
        const planoN = normalizeSearch(row.plano || "");
        const servN = normalizeSearch(row.tipo_servico || "");
        if (!planoN.includes(q) && !servN.includes(q)) return false;
      }
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
      if (baseDadosCardFilter === "obs_global") {
        if (!observacoes.globais[row.plano]) return false;
      }
      if (baseDadosCardFilter === "obs_diaria") {
        if (!observacoes.diarias[row.plano] || Object.keys(observacoes.diarias[row.plano]).length === 0) return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      const dir = tableSort.direction;
      const byDirection = (base: number) => (dir === "asc" ? base : -base);
      let sortBase = 0;
      if (tableSort.column === "plano" || tableSort.column === "sub" || tableSort.column === "servico") {
        // compareByPlanoStructure já aplica direção internamente
        sortBase = compareByPlanoStructure(a, b, tableSort.column, dir);
      } else if (tableSort.column === "selimp") {
        const va = toNum(a.percentual_selimp);
        const vb = toNum(b.percentual_selimp);
        // Nulos sempre no fim, independente da direção
        if (va == null && vb == null) sortBase = 0;
        else if (va == null) sortBase = 1;
        else if (vb == null) sortBase = -1;
        else sortBase = byDirection(va - vb);
      } else if (tableSort.column === "nossa") {
        const va = toNum(a.percentual_nosso);
        const vb = toNum(b.percentual_nosso);
        if (va == null && vb == null) sortBase = 0;
        else if (va == null) sortBase = 1;
        else if (vb == null) sortBase = -1;
        else sortBase = byDirection(va - vb);
      } else {
        const aOrig = (a.percentual_selimp == null && a.percentual_nosso == null ? "sem_despacho" : a.origem) as string;
        const bOrig = (b.percentual_selimp == null && b.percentual_nosso == null ? "sem_despacho" : b.origem) as string;
        sortBase = byDirection(aOrig.localeCompare(bOrig, "pt-BR"));
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
    tableSearchQuery,
  ]);

  const exportLineCount = useMemo(
    () => countIptBaseDadosExportRows(filteredComparativo),
    [filteredComparativo]
  );

  const exportSelimpSectorCount = useMemo(
    () =>
      filteredComparativo.filter(
        (row) =>
          (row.despachos_selimp ?? 0) > 0 ||
          row.detalhes_diarios?.some((detalhe) => detalhe.despachos_selimp > 0)
      ).length,
    [filteredComparativo]
  );

  /** Média ponderada por despacho no período/filtros da tabela (Base de dados) */
  const filteredTableMedias = useMemo(() => {
    let selimpSum = 0;
    let selimpCount = 0;
    let ddmxSum = 0;
    let ddmxCount = 0;
    for (const row of filteredComparativo) {
      selimpSum += row.raw_selimp_sum ?? 0;
      selimpCount += row.raw_selimp_count ?? 0;
      const despNosso = row.despachos_nosso ?? 0;
      if (row.percentual_nosso != null && despNosso > 0) {
        ddmxSum += row.percentual_nosso * despNosso;
        ddmxCount += despNosso;
      }
    }
    return {
      selimp: selimpCount > 0 ? selimpSum / selimpCount : null,
      ddmx: ddmxCount > 0 ? ddmxSum / ddmxCount : null,
    };
  }, [filteredComparativo]);

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

  const mediaServicosAtivos = useMemo(() => {
    const comZerados = topServicos
      .map((item) => item.media_execucao)
      .filter((value): value is number => value != null && Number.isFinite(value));
    const semZerados = topServicos
      .map((item) => item.media_sem_zerados)
      .filter((value): value is number => value != null && Number.isFinite(value));

    return {
      comZerados: comZerados.length
        ? comZerados.reduce((acc, value) => acc + value, 0) / comZerados.length
        : null,
      semZerados: semZerados.length
        ? semZerados.reduce((acc, value) => acc + value, 0) / semZerados.length
        : null,
      totalComZerados: comZerados.length,
      totalSemZerados: semZerados.length,
    };
  }, [topServicos]);

  /** Itens do comparativo no escopo do mês (cards) - para métricas do card Subprefeituras */
  const cardsComparativoItens = useMemo(
    () => (iptPreviewCards?.comparativo?.itens ?? []) as Array<{
      plano: string;
      subprefeitura: string;
      percentual_selimp: number | null;
      percentual_nosso: number | null;
      origem: "ambos" | "somente_selimp" | "somente_nosso";
      despachos_selimp?: number;
      raw_selimp_sum?: number;
      raw_selimp_count?: number;
      raw_selimp_nonzero_count?: number;
    }>,
    [iptPreviewCards]
  );

  /** Média de execução sem zerados e com zerados ponderada por despacho (SELIMP) */
  const subprefeituraInsights = useMemo(() => {
    const bySub = new Map<
      string,
      { despachoSum: number; despachoCount: number; despachoNonzeroCount: number; totalPlanos: number }
    >();
    for (const row of cardsComparativoItens) {
      const sub = row.subprefeitura || "Não informado";
      if (!bySub.has(sub)) {
        bySub.set(sub, { despachoSum: 0, despachoCount: 0, despachoNonzeroCount: 0, totalPlanos: 0 });
      }
      const entry = bySub.get(sub)!;
      entry.totalPlanos += 1;
      entry.despachoSum += row.raw_selimp_sum ?? 0;
      entry.despachoCount += row.raw_selimp_count ?? 0;
      entry.despachoNonzeroCount += row.raw_selimp_nonzero_count ?? (row.raw_selimp_count ?? 0);
    }
    const result: Array<{
      subprefeitura: string;
      mediaComZerados: number | null;
      mediaSemZerados: number | null;
      totalPlanos: number;
      zerados: number;
    }> = [];
    bySub.forEach((val, sub) => {
      result.push({
        subprefeitura: sub,
        mediaComZerados: val.despachoCount > 0 ? val.despachoSum / val.despachoCount : null,
        mediaSemZerados: val.despachoNonzeroCount > 0 ? val.despachoSum / val.despachoNonzeroCount : null,
        totalPlanos: val.totalPlanos,
        zerados: val.despachoCount - val.despachoNonzeroCount,
      });
    });
    return result.sort((a, b) => (b.mediaSemZerados ?? -1) - (a.mediaSemZerados ?? -1));
  }, [cardsComparativoItens]);

  /** Médias globais ponderadas por despacho (SELIMP) */
  const globalInsights = useMemo(() => {
    let totalSum = 0;
    let totalCount = 0;
    let totalNonzeroCount = 0;
    for (const row of cardsComparativoItens) {
      totalSum += row.raw_selimp_sum ?? 0;
      totalCount += row.raw_selimp_count ?? 0;
      totalNonzeroCount += row.raw_selimp_nonzero_count ?? (row.raw_selimp_count ?? 0);
    }
    return {
      mediaComZerados: totalCount > 0 ? totalSum / totalCount : null,
      mediaSemZerados: totalNonzeroCount > 0 ? totalSum / totalNonzeroCount : null,
      totalPlanos: cardsComparativoItens.length,
      zerados: totalCount - totalNonzeroCount,
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
    setTableSearchQuery("");
    setHeaderMenuOpen(null);
  };

  const openNativeMonthReferenciaPicker = () => {
    const el = monthReferenciaInputRef.current;
    if (!el) return;
    const withPicker = el as HTMLInputElement & { showPicker?: () => void };
    if (typeof withPicker.showPicker === "function") {
      try {
        withPicker.showPicker();
        return;
      } catch {
        // ignore
      }
    }
    el.focus();
    el.click();
  };

  const mesReferenciaLabel = useMemo(() => {
    const raw = format(selectedMonth, "MMMM yyyy", { locale: ptBR });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [selectedMonth]);

  const tableRangeCalendarValue = useMemo((): DateRange | undefined => {
    if (tableScope === "dia_anterior") {
      const y = startOfDay(subDays(new Date(), 1));
      return { from: y, to: y };
    }
    if (tableScope === "periodo" && tablePeriodRange) {
      return {
        from: startOfDay(tablePeriodRange.inicio),
        to: startOfDay(tablePeriodRange.fim),
      };
    }
    return undefined;
  }, [tableScope, tablePeriodRange]);

  const periodModeLabel = tableScope === "dia_anterior" ? "D-1" : "Período";

  const exportPeriodoLabel = useMemo(() => {
    if (tableScope === "dia_anterior") {
      return format(subDays(new Date(), 1), "yyyy-MM-dd");
    }
    if (tablePeriodRange) {
      const inicio = format(tablePeriodRange.inicio, "yyyy-MM-dd");
      const fim = format(tablePeriodRange.fim, "yyyy-MM-dd");
      return inicio === fim ? inicio : `${inicio}_a_${fim}`;
    }
    return "periodo";
  }, [tableScope, tablePeriodRange]);

  const handleConfirmDownload = () => {
    exportIptBaseDadosXlsx(filteredComparativo, observacoes, {
      periodoLabel: exportPeriodoLabel,
      mesReferencia: mesReferenciaLabel,
    });
    setModalDownloadOpen(false);
  };

  const handleTableRangeChange = (r: DateRange | undefined) => {
    if (!r?.from || !r?.to) {
      setTableScope("dia_anterior");
      setTablePeriodRange(null);
      return;
    }
    setTableScope("periodo");
    setTablePeriodRange({ inicio: r.from, fim: r.to });
  };

  const clampDateNotFuture = (d: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dd = new Date(d);
    dd.setHours(0, 0, 0, 0);
    return dd > today ? today : dd;
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {loading && (
          <div className="fixed inset-0 z-90 flex items-center justify-center bg-background/90 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-card/95 px-8 py-6 shadow-2xl shadow-zinc-900/20">
              <div className="h-48 w-48">
                <Lottie animationData={loadingAnimation} loop autoplay />
              </div>
              <p className="text-sm font-semibold text-muted-foreground">Carregando dados IPT...</p>
            </div>
          </div>
        )}

        <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-emerald-600 via-emerald-700 to-teal-800 p-8 shadow-xl shadow-emerald-900/35 dark:bg-linear-to-br dark:from-emerald-800 dark:via-emerald-900 dark:to-teal-950 dark:shadow-2xl dark:shadow-black/45">
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
            <div
              className="flex h-22 w-22 shrink-0 items-center justify-center rounded-2xl bg-teal-950 shadow-lg dark:bg-teal-950"
              aria-hidden
            >
              <Activity className="h-11 w-11 text-white" strokeWidth={1.5} />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-4xl font-bold tracking-tight text-white">IPT</h1>
              <p className="mt-3 max-w-3xl text-lg text-emerald-50">
                Análise macro e conferência SELIMP x base interna.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-card/70 backdrop-blur p-4 shadow-lg">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-end">
            <div className="space-y-1.5 min-w-0">
              <Label
                id="ipt-mes-referencia-lbl"
                className="text-xs text-muted-foreground cursor-pointer select-none"
                onClick={(e) => {
                  e.preventDefault();
                  openNativeMonthReferenciaPicker();
                }}
              >
                Mês de referência
              </Label>
              <div
                className="flex h-10 w-full cursor-pointer items-center rounded-xl bg-background/90 px-3 text-sm shadow-inner ring-1 ring-white/10 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                role="button"
                tabIndex={0}
                aria-labelledby="ipt-mes-referencia-lbl"
                onClick={(e) => {
                  e.preventDefault();
                  openNativeMonthReferenciaPicker();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openNativeMonthReferenciaPicker();
                  }
                }}
              >
                <span className="truncate text-foreground">{mesReferenciaLabel}</span>
                <input
                  ref={monthReferenciaInputRef}
                  id="ipt-mes-referencia"
                  type="month"
                  value={format(selectedMonth, "yyyy-MM")}
                  max={format(new Date(), "yyyy-MM")}
                  tabIndex={-1}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const [year, month] = e.target.value.split("-");
                    setSelectedMonth(startOfMonth(new Date(Number(year), Number(month) - 1, 1)));
                  }}
                  className="sr-only"
                />
              </div>
            </div>
            <div className="space-y-1.5 min-w-0">
              <Label className="text-xs text-muted-foreground">Subprefeitura</Label>
              <Select value={subprefeituraFilter} onValueChange={setSubprefeituraFilter}>
                <SelectTrigger className="h-10 w-full rounded-xl bg-background/90 shadow-inner ring-1 ring-white/10 focus:ring-2 focus:ring-emerald-500/60">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {subprefeituraOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card className="xl:col-span-1 border-0 shadow-[0_20px_50px_-30px_rgba(16,185,129,0.7)] bg-linear-to-br from-emerald-500/15 via-card to-card">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">IPT (Algoritmo SELIMP)</CardTitle>
                {adcManual && <ManualIndicatorBadge observacao={adcManualObservacao} variant="inline" />}
                <div
                  className="relative"
                  onMouseEnter={() => setIptFormulaTooltip(true)}
                  onMouseLeave={() => setIptFormulaTooltip(false)}
                >
                  <Info className="h-4 w-4 text-zinc-400 hover:text-emerald-500 cursor-help transition-colors shrink-0" />
                  {iptFormulaTooltip && (
                    <div className="absolute left-0 top-6 z-50 w-[min(95vw,28rem)] rounded-lg bg-zinc-900 dark:bg-zinc-800 p-4 text-xs text-white shadow-xl border border-zinc-700">
                      <div className="font-bold mb-2 text-sm text-emerald-400">Cenários IPT</div>
                      <div className="p-2 bg-zinc-800 dark:bg-zinc-900 rounded border border-zinc-700">
                        <div className="font-mono text-xs text-emerald-300 leading-relaxed">
                          IPT = 70% qualidade + 30% cobertura
                          <br />
                          <span className="text-zinc-400">sem P/R/F real, a cobertura fica presumida ou inferida pelo oficial</span>
                        </div>
                      </div>
                      <div className="text-zinc-400 text-xs mt-2">Fevereiro e março indicam cobertura perto de 100%; abril indica cobertura perto de 10%.</div>
                    </div>
                  )}
                </div>
              </div>
              <CardDescription>Separação entre qualidade executada e cobertura de rastreamento.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <>
              {adcManual && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 shadow-sm">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                          Registro manual ativo
                        </p>
                        {adcManualIptPontuacao != null && (
                          <span className="rounded-full bg-background/70 px-2 py-0.5 text-[11px] font-semibold text-foreground">
                            IPT registrado: {adcManualIptPontuacao.toFixed(2)} pts
                          </span>
                        )}
                      </div>
                      {adcManualObservacao.trim() && (
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                          {adcManualObservacao}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-xl bg-background/70 p-3.5 shadow-sm transition-all hover:shadow-md">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {iptCard.cenarios?.diagnostico.cobertura_fonte === "oficial_selimp"
                      ? "IPT oficial / cobertura inferida"
                      : "IPT com cobertura presumida em 100%"}
                  </p>
                  {iptCard.cenarios && (
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${iptRiskTone}`}>
                      {iptCard.cenarios.diagnostico.cobertura_fonte === "oficial_selimp"
                        ? `cob. ${iptCard.cenarios.diagnostico.cobertura_usada.toFixed(1)}%`
                        : "cobertura não auditada"}
                    </span>
                  )}
                </div>
                <p className="text-3xl font-bold text-emerald-600 mt-0.5">
                  {iptCard.valor != null ? `${iptCard.valor.toFixed(1)}%` : "--"}
                </p>
                <div className="mt-2.5 h-2 rounded-full bg-emerald-200/40 dark:bg-emerald-900/20">
                  <div
                    className="h-2 rounded-full bg-linear-to-r from-emerald-500 to-teal-500 transition-all"
                    style={{ width: `${clamp(iptCard.valor ?? 0)}%` }}
                  />
                </div>
                {/* marcadores de faixa */}
                <div className="relative mt-1 h-3">
                  {[80, 90].map((mark) => (
                    <div
                      key={mark}
                      className="absolute top-0 flex flex-col items-center"
                      style={{ left: `${mark}%`, transform: "translateX(-50%)" }}
                    >
                      <div className="w-px h-2 bg-muted-foreground/40" />
                      <span className="text-[9px] text-muted-foreground/60">{mark}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-red-500/10 p-3 shadow-sm">
                  <p className="text-xs text-muted-foreground">Stress cobertura 10%</p>
                  <p className="text-xl font-bold text-red-700 dark:text-red-300">{pct(iptCard.cenarios?.conservador.percentual)}</p>
                </div>
                <div className="rounded-xl bg-cyan-500/10 p-3 shadow-sm">
                  <p className="text-xs text-muted-foreground">Cobertura 100%</p>
                  <p className="text-xl font-bold text-cyan-700 dark:text-cyan-300">{pct(iptCard.cenarios?.otimista.percentual)}</p>
                </div>
              </div>

              <div className="rounded-xl bg-background/70 p-3.5 shadow-sm transition-all hover:shadow-md flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Pontuação IPT no cenário principal</p>
                  <p className="text-3xl font-bold text-teal-600 mt-0.5">{iptCard.pontuacao ?? 0}</p>
                </div>
                <Target className="h-8 w-8 text-teal-500/40" />
              </div>

              {iptCard.cenarios && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-muted-foreground">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="font-bold text-foreground">{iptCard.cenarios.diagnostico.qualidade_ajustada.toFixed(1)}%</p>
                      <p>qualidade PF</p>
                    </div>
                    <div>
                      <p className="font-bold text-foreground">{iptCard.cenarios.diagnostico.zeros_encerradas}</p>
                      <p>zeros encerr.</p>
                    </div>
                    <div>
                      <p className="font-bold text-foreground">{iptCard.cenarios.diagnostico.taxa_zeros_encerradas.toFixed(1)}%</p>
                      <p>taxa zero</p>
                    </div>
                  </div>
                </div>
              )}

              </>

            </CardContent>
          </Card>

          <Card className="xl:col-span-2 border-0 shadow-[0_20px_50px_-30px_rgba(16,185,129,0.6)]">
            <CardHeader>
              <CardTitle className="text-base">IPT - Realidade</CardTitle>
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
                  <p className="text-xs text-muted-foreground">Total despachos no mês</p>
                  <p className="text-xl pt-2 font-bold text-cyan-700 dark:text-cyan-300 tabular-nums">
                    {iptPreviewCards?.resumo.total_despachos_selimp ?? 0}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">SELIMP · período apurado</p>
                </div>
              </div>
              <div className="md:col-span-2 grid grid-cols-2 gap-4">
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
                    Despachos zerados
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
            </CardContent>
          </Card>

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


          {/* ── Modal: Observação Global ─────────────────────────── */}
          <Dialog open={modalObsGlobalOpen} onOpenChange={(open) => {
            setModalObsGlobalOpen(open);
            if (!open) { setModalObsGlobalSetor(null); setModalObsGlobalCategoria(""); }
          }}>
            <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
              {/* Header colorido */}
              <div className="bg-gradient-to-br from-red-600/90 via-red-700 to-rose-800 px-6 pt-6 pb-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20 shadow-inner">
                    <AlertTriangle className="h-5 w-5 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <DialogTitle className="text-white text-lg font-bold leading-tight">Observação global</DialogTitle>
                    <DialogDescription className="text-red-100/80 text-sm mt-0.5">
                      Marca o setor permanentemente com aviso em todos os despachos.
                    </DialogDescription>
                    {modalObsGlobalSetor && (
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-mono font-semibold text-white">
                        <MapPin className="h-3.5 w-3.5" />
                        {modalObsGlobalSetor}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-4 px-6 py-5">
                {/* Seleção de categoria */}
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 block">
                    Tipo de problema
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {OBS_GLOBAL_CATEGORIES.map((cat) => {
                      const Icon = cat.Icon;
                      const isSelected = modalObsGlobalCategoria === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => {
                            setModalObsGlobalCategoria(cat.id as ObsGlobalCategoria);
                            setModalObsGlobalTitulo(cat.label);
                            if (cat.template) setModalObsGlobalDescricao(cat.template);
                          }}
                          className={`flex items-center gap-2 rounded-xl border p-2.5 text-left text-xs font-semibold transition-all duration-150 ${isSelected ? cat.activeClass : cat.colorClass}`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="leading-tight">{cat.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Título */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Título <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={modalObsGlobalTitulo}
                    onChange={(e) => setModalObsGlobalTitulo(e.target.value)}
                    placeholder="Ex.: Setor incorreto na SELIMP"
                    className="w-full h-10 rounded-xl border-2  border-zinc-300 dark:border-zinc-700 shadow-xl shadow-zinc-300/10 dark:shadow-zinc-700/10  bg-background/80 px-3.5 text-sm transition-all focus:outline-none focus:border-red-500/60 focus:bg-background"
                  />
                </div>

                {/* Descrição */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Descrição detalhada <span className="text-muted-foreground/60">(opcional)</span>
                  </label>
                  <textarea
                    value={modalObsGlobalDescricao}
                    onChange={(e) => setModalObsGlobalDescricao(e.target.value)}
                    placeholder="Detalhes adicionais da observação..."
                    rows={3}
                    className="w-full rounded-xl border-2 border-zinc-300 dark:border-zinc-700 shadow-xl shadow-zinc-300/10 dark:shadow-zinc-700/10 bg-background/80 px-3.5 py-2.5 text-sm resize-none transition-all focus:outline-none focus:border-red-500/60 focus:bg-background"
                  />
                </div>

                {/* Ações */}
                <div className="flex items-center justify-between gap-3 pt-1">
                  <button
                    onClick={() => setModalObsGlobalOpen(false)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 shadow-xl shadow-zinc-300/10 dark:shadow-zinc-700/10 bg-background/80 text-sm font-medium hover:bg-muted/60 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancelar
                  </button>
                  <button
                    onClick={() => {
                      if (!modalObsGlobalSetor || !modalObsGlobalTitulo.trim()) return;
                      const key = `global::${modalObsGlobalSetor}`;
                      setModalObsGlobalOpen(false);
                      setRecentlySavedKeys((prev) => new Set([...prev, key]));
                      apiService
                        .createIptObservacaoGlobal(modalObsGlobalSetor, modalObsGlobalTitulo.trim(), modalObsGlobalDescricao.trim() || undefined)
                        .then(() => loadData());
                    }}
                    disabled={!modalObsGlobalTitulo.trim()}
                    className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 text-white text-sm font-semibold disabled:opacity-50 hover:opacity-90 transition-all shadow-lg shadow-red-500/30"
                  >
                    <Check className="h-4 w-4" />
                    Salvar observação global
                  </button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* ── Modal: Observação Diária ──────────────────────────── */}
          <Dialog open={modalObsDiariaOpen} onOpenChange={(open) => {
            setModalObsDiariaOpen(open);
            if (!open) { setModalObsDiariaSetor(null); setModalObsDiariaData(null); setModalObsDiariaCategoria(""); }
          }}>
            <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
              {/* Header colorido */}
              <div className="bg-gradient-to-br from-amber-500/90 via-amber-600 to-orange-700 px-6 pt-6 pb-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20 shadow-inner">
                    <Calendar className="h-5 w-5 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <DialogTitle className="text-white text-lg font-bold leading-tight">Observação diária</DialogTitle>
                    <DialogDescription className="text-amber-100/80 text-sm mt-0.5">
                      Justificativa para o dia específico — ex.: manutenção, chuva, demanda extra.
                    </DialogDescription>
                    {modalObsDiariaSetor && modalObsDiariaData && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-mono font-semibold text-white">
                          <MapPin className="h-3.5 w-3.5" />
                          {modalObsDiariaSetor}
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-mono font-semibold text-white">
                          <Calendar className="h-3.5 w-3.5" />
                          {modalObsDiariaData.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2/$1")}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-4 px-6 py-5">
                {/* Seleção de categoria */}
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 block">
                    Motivo da ocorrência
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {OBS_DIARIA_CATEGORIES.map((cat) => {
                      const Icon = cat.Icon;
                      const isSelected = modalObsDiariaCategoria === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => {
                            setModalObsDiariaCategoria(cat.id as ObsDiariaCategoria);
                            setModalObsDiariaTitulo(cat.label);
                          }}
                          className={`flex items-center gap-2 rounded-xl border p-2.5 text-left text-xs font-semibold transition-all duration-150 ${isSelected ? cat.activeClass : cat.colorClass}`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="leading-tight">{cat.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Título */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Título <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={modalObsDiariaTitulo}
                    onChange={(e) => setModalObsDiariaTitulo(e.target.value)}
                    placeholder="Ex.: Bateria baixa, Manutenção..."
                    className="w-full h-10 rounded-xl border-2  border-zinc-300 dark:border-zinc-700 shadow-xl shadow-zinc-300/10 dark:shadow-zinc-700/10 bg-background/80 px-3.5 text-sm transition-all focus:outline-none focus:border-amber-500/60 focus:bg-background"
                  />
                </div>

                {/* Ações */}
                <div className="flex items-center justify-between gap-3 pt-1">
                  <button
                    onClick={() => setModalObsDiariaOpen(false)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 shadow-xl shadow-zinc-300/10 dark:shadow-zinc-700/10 bg-background/80 text-sm font-medium hover:bg-muted/60 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancelar
                  </button>
                  <button
                    onClick={() => {
                      if (!modalObsDiariaSetor || !modalObsDiariaData || !modalObsDiariaTitulo.trim()) return;
                      const key = `diaria::${modalObsDiariaSetor}::${modalObsDiariaData}`;
                      setModalObsDiariaOpen(false);
                      setRecentlySavedKeys((prev) => new Set([...prev, key]));
                      apiService
                        .createIptObservacaoDiaria(modalObsDiariaSetor, modalObsDiariaData, modalObsDiariaTitulo.trim(), undefined)
                        .then(() => loadData());
                    }}
                    disabled={!modalObsDiariaTitulo.trim()}
                    className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-semibold disabled:opacity-50 hover:opacity-90 transition-all shadow-lg shadow-amber-500/30"
                  >
                    <Check className="h-4 w-4" />
                    Salvar observação
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
                  <CardTitle className="text-base">Subprefeituras (Percentual Real)</CardTitle>
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
                    title={`${item.subprefeitura || "Não informado"}: ${pct(item.media_execucao)} com zerados | ${pct(item.media_sem_zerados)} sem zerados | ${item.total_despachos ?? 0} despachos`}
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
                      <span className="text-xs text-muted-foreground shrink-0 min-w-[5.5rem] text-right whitespace-nowrap">
                        {item.total_despachos ?? 0} despachos
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
                  {/* Atalhos analíticos */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Link
                      href="/ipt/bateria"
                      className="min-h-[140px] rounded-xl bg-violet-500/10 p-4 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg hover:bg-violet-500/20 border border-violet-500/20 hover:border-violet-500/40 text-left group flex flex-col justify-center"
                    >
                      <div className="flex items-center gap-2">
                        <Battery className="h-6 w-6 text-violet-600 dark:text-violet-400 group-hover:scale-110 transition-transform" />
                        <span className="text-base font-semibold text-violet-700 dark:text-violet-300">Análise de Bateria</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">Dashboard completo de monitoramento de módulos, bateria e sinal.</p>
                    </Link>
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
                      <p className="text-sm font-semibold text-foreground">Despachos com execução zerada por sub</p>
                      <div className="h-52 min-h-[160px]">
                        <IptBar
                          data={{
                            labels: subprefeituraInsights.map((s) =>
                              s.subprefeitura.length > 12 ? s.subprefeitura.slice(0, 11) + "…" : s.subprefeitura
                            ),
                            datasets: [
                              {
                                label: "Despachos zerados",
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
                  <CardDescription>Execução acumulada, previstos e cobertura de despacho no mês selecionado.</CardDescription>
                </div>
                <span className="text-xs font-medium text-muted-foreground bg-muted/50 px-2 py-1 rounded-full">
                  {topServicos.length} serviços
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {topServicos.map((item) => (
                  <button
                    type="button"
                    key={item.tipo_servico}
                    onClick={() => handleServiceEvolutionClick(item.tipo_servico || "Não informado")}
                    className="group w-full rounded-xl bg-background/60 p-3 text-left shadow-sm transition-all hover:shadow-md hover:bg-cyan-500/5 hover:ring-1 hover:ring-cyan-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
                    title={`${item.total_despachos ?? 0}/${item.despachos_previstos ?? item.total_despachos ?? 0} despachos previstos no mes${item.cobertura_despachos != null ? ` - ${item.cobertura_despachos.toFixed(1)}% despachado` : ""}${item.despachos_zerados != null ? ` - ${item.despachos_zerados} com 0%` : ""}`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-sm group-hover:text-cyan-700 dark:group-hover:text-cyan-300 min-w-0">
                        {item.tipo_servico || "Não informado"}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className="text-lg font-bold tabular-nums text-cyan-600 dark:text-cyan-400 underline decoration-dotted decoration-cyan-600/50 underline-offset-2 cursor-help"
                          title="Com zerados: media acumulada do percentual SELIMP nos despachos encerrados ate a data (inclui execucao 0%). Nao despachados entram na cobertura abaixo."
                        >
                          {pct(item.media_execucao)}
                        </span>
                        <span className="text-xs font-semibold text-muted-foreground" aria-hidden>
                          /
                        </span>
                        <span
                          className="text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-400 underline decoration-dotted decoration-emerald-600/50 underline-offset-2 cursor-help"
                          title="Sem zerados: média acumulada apenas nos despachos SELIMP com percentual maior que 0%."
                        >
                          {pct(item.media_sem_zerados ?? null)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-3 rounded-full bg-muted/50 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all duration-500"
                          style={{ width: `${clamp(item.media_execucao ?? 0)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 min-w-[5.5rem] text-right whitespace-nowrap">
                        {item.total_despachos ?? 0}/{item.despachos_previstos ?? item.total_despachos ?? 0} prev.
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span>Despachado {pct(item.cobertura_despachos)}</span>
                      <span>{item.despachos_nao_despachados ?? 0} nao desp.</span>
                    </div>
                  </button>
                ))}
                {topServicos.length > 0 && (
                  <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 sm:grid-cols-2 dark:bg-cyan-500/10">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Média dos serviços c/ zeros
                      </p>
                      <p
                        className="mt-1 text-2xl font-bold tabular-nums text-cyan-700 dark:text-cyan-300"
                        title={`Média simples dos percentuais com zerados dos ${mediaServicosAtivos.totalComZerados} serviços exibidos.`}
                      >
                        {pct(mediaServicosAtivos.comZerados)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Média dos serviços s/ zeros
                      </p>
                      <p
                        className="mt-1 text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300"
                        title={`Média simples dos percentuais sem zerados dos ${mediaServicosAtivos.totalSemZerados} serviços exibidos.`}
                      >
                        {pct(mediaServicosAtivos.semZerados)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
              {!loading && topServicos.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">Sem dados para o período.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <EvolutionChartModal
          open={serviceEvolutionOpen}
          onOpenChange={setServiceEvolutionOpen}
          title={`Evolução do serviço - ${serviceEvolutionTitle}`}
          description="Percentual acumulado do Report SELIMP, com previstos, despachados e cobertura ate cada data."
          primaryLabel="% acumulado com zerados"
          secondaryLabel="% acumulado sem zerados"
          points={serviceEvolutionPoints}
          loading={serviceEvolutionLoading}
          showPointDetails
          emptyMessage="Ainda não há snapshots para este serviço no período."
        />

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
                <p className="text-2xl font-bold mt-1">{filteredComparativo.reduce((acc, r) => acc + (r.despachos_selimp ?? 0), 0)}</p>
                <p className="text-xs font-medium opacity-80 mt-1">Conforme filtros</p>
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
              <button
                type="button"
                onClick={() => setModalDownloadOpen(true)}
                className="rounded-xl p-4 shadow-lg transition-all text-left flex flex-col text-white bg-blue-600 hover:bg-blue-500"
              >
                <p className="text-xs font-bold opacity-90 flex items-center gap-1.5">
                  <Download className="h-3.5 w-3.5" />
                  Baixar visualização
                </p>
                <p className="text-2xl font-bold mt-1">{exportLineCount.toLocaleString("pt-BR")} Linhas</p>
                <p className="text-xs font-medium opacity-80 mt-1">
                  {exportSelimpSectorCount.toLocaleString("pt-BR")} setores com SELIMP
                </p>
              </button>
            </div>

            <Dialog open={modalDownloadOpen} onOpenChange={setModalDownloadOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Baixar base de dados?</DialogTitle>
                  <DialogDescription>
                    Sera gerado um arquivo Excel (.xlsx) somente com despachos SELIMP encerrados,
                    respeitando os filtros ativos da tabela.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
                  <p>
                    <span className="font-medium text-muted-foreground">Período:</span>{" "}
                    {tableScope === "dia_anterior"
                      ? `D-1 (${format(subDays(new Date(), 1), "dd/MM/yyyy")})`
                      : tablePeriodRange
                      ? `${format(tablePeriodRange.inicio, "dd/MM/yyyy")} — ${format(tablePeriodRange.fim, "dd/MM/yyyy")}`
                      : "—"}
                  </p>
                  <p>
                    <span className="font-medium text-muted-foreground">Mês referência:</span> {mesReferenciaLabel}
                  </p>
                  <p>
                    <span className="font-medium text-muted-foreground">Setores visualizados:</span>{" "}
                    <span className="font-semibold tabular-nums">
                      {filteredComparativo.length.toLocaleString("pt-BR")}
                    </span>
                  </p>
                  <p>
                    <span className="font-medium text-muted-foreground">Despachos SELIMP a exportar:</span>{" "}
                    <span className="font-semibold tabular-nums">{exportLineCount.toLocaleString("pt-BR")}</span>
                  </p>
                  <p>
                    <span className="font-medium text-muted-foreground">Setores com SELIMP:</span>{" "}
                    <span className="font-semibold tabular-nums">{exportSelimpSectorCount.toLocaleString("pt-BR")}</span>
                  </p>
                </div>
                {exportLineCount === 0 && (
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    Nao ha despachos SELIMP visiveis para exportar. Ajuste os filtros e tente novamente.
                  </p>
                )}
                <DialogFooter>
                  <UiButton type="button" variant="outline" onClick={() => setModalDownloadOpen(false)}>
                    Cancelar
                  </UiButton>
                  <UiButton
                    type="button"
                    className="bg-blue-600 text-white hover:bg-blue-500"
                    disabled={exportLineCount === 0}
                    onClick={handleConfirmDownload}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Baixar planilha
                  </UiButton>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <div className="flex flex-wrap items-center gap-3">
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
              <div className="flex max-w-full min-w-0 shrink-0 items-center gap-2 rounded-lg bg-emerald-600 px-2.5 py-1.5 shadow-lg text-white">
                <Calendar className="h-4 w-4 shrink-0" aria-hidden />
                <DateRangePicker
                  value={tableRangeCalendarValue}
                  onChange={handleTableRangeChange}
                  maxDate={new Date()}
                  modeLabel={periodModeLabel}
                  emptyLabel="D-1"
                  className="max-w-[min(100vw-8rem,22rem)]"
                  footer={(close) => (
                    <>
                      <UiButton
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => {
                          setTableScope("dia_anterior");
                          setTablePeriodRange(null);
                          close();
                        }}
                      >
                        Ontem (D-1)
                      </UiButton>
                      <UiButton
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => {
                          const cap = clampDateNotFuture(new Date());
                          const { from, to } = getEsteMesRange(new Date(), cap);
                          setTableScope("periodo");
                          setTablePeriodRange({ inicio: from, fim: to });
                          close();
                        }}
                      >
                        Este mês
                      </UiButton>
                    </>
                  )}
                />
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
                onClick={clearAllTableFilters}
                className="h-10 px-4 rounded-lg text-sm font-bold bg-emerald-600 text-white shadow-lg hover:bg-emerald-500 transition-all inline-flex items-center gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                Limpar todos os filtros
              </button>
            </div>

            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/80"
                aria-hidden
              />
              <input
                type="search"
                value={tableSearchQuery}
                onChange={(e) => setTableSearchQuery(e.target.value)}
                placeholder="Buscar por plano (setor) ou serviço…"
                className=" w-4xl rounded-xl border-2 border-zinc-200 dark:border-zinc-500 h-12 bg-background/80 py-2.5 pl-10 pr-3 text-sm shadow-md ring-1 ring-black/5 transition-[box-shadow,background-color] placeholder:text-muted-foreground/90 focus:bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/35 dark:bg-background/60 dark:ring-white/10"
                aria-label="Buscar plano ou serviço na tabela"
              />
            </div>

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
                            className="w-full rounded-xl bg-background/80 px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-background hover:shadow-lg flex items-center justify-between gap-2"
                            title="Média ponderada SELIMP no período apurado (conforme filtros)"
                          >
                            <span className="inline-flex items-center gap-1 min-w-0 truncate">📈 SELIMP {getSortLabel("selimp")}</span>
                            <span
                              className={`shrink-0 text-sm font-extrabold tabular-nums normal-case tracking-normal ${getMediaPeriodoClass(filteredTableMedias.selimp, 70)}`}
                            >
                              {filteredTableMedias.selimp != null ? `${filteredTableMedias.selimp.toFixed(1)}%` : "--"}
                            </span>
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
                            className="w-full rounded-xl bg-background/80 px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-background hover:shadow-lg flex items-center justify-between gap-2"
                            title="Média ponderada DDMX no período apurado (conforme filtros)"
                          >
                            <span className="inline-flex items-center gap-1 min-w-0 truncate">📊 DDMX {getSortLabel("nossa")}</span>
                            <span
                              className={`shrink-0 text-sm font-extrabold tabular-nums normal-case tracking-normal ${getMediaPeriodoClass(filteredTableMedias.ddmx, 50)}`}
                            >
                              {filteredTableMedias.ddmx != null ? `${filteredTableMedias.ddmx.toFixed(1)}%` : "--"}
                            </span>
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
                      (row.modulos_bateria && row.modulos_bateria.length > 0) ||
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
                            {(() => {
                              const obsGlobal = observacoes.globais[row.plano];
                              const globalCat = obsGlobal ? getObsGlobalCategory(obsGlobal.titulo) : null;
                              const GlobalIcon = globalCat?.Icon ?? AlertTriangle;
                              const isRecentGlobal = recentlySavedKeys.has(`global::${row.plano}`);
                              const temObsDiariaQualquer = Boolean(
                                observacoes.diarias[row.plano] &&
                                Object.keys(observacoes.diarias[row.plano]).length > 0
                              );
                              return (
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
                                      title={obsGlobal.titulo}
                                      className={`inline-flex shrink-0 ${globalCat?.tableIconClass ?? "text-red-500"} ${isRecentGlobal ? "animate-pulse drop-shadow-[0_0_5px_currentColor]" : ""}`}
                                    >
                                      <GlobalIcon className="h-4 w-4" />
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
                                  {temObsDiariaQualquer && (() => {
                                    const allKeys = Object.keys(observacoes.diarias[row.plano]);
                                    const anyRecent = allKeys.some((dk) => recentlySavedKeys.has(`diaria::${row.plano}::${dk}`));
                                    const firstObs = observacoes.diarias[row.plano][allKeys[0]];
                                    const dCat = firstObs ? getObsDiariaCategory(firstObs.titulo) : null;
                                    return (
                                      <span
                                        title={`${allKeys.length} obs. diária(s) — ex.: ${firstObs?.titulo ?? ""}`}
                                        className={`inline-flex shrink-0 ${dCat?.tableIconClass ?? "text-amber-500"} ${anyRecent ? "animate-pulse drop-shadow-[0_0_4px_currentColor]" : "opacity-70"}`}
                                      >
                                        {dCat ? <dCat.Icon className="h-3.5 w-3.5" /> : <Calendar className="h-3.5 w-3.5" />}
                                      </span>
                                    );
                                  })()}
                                </span>
                              );
                            })()}
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
                                {row.modulos_bateria && row.modulos_bateria.length > 0 && (
                                  <div className="rounded-xl bg-fuchsia-500/10 border border-fuchsia-500/30 p-3 shadow-sm">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                      <p className="text-xs font-semibold text-fuchsia-700 dark:text-fuchsia-300 flex items-center gap-1.5">
                                        <BatteryWarning className="h-4 w-4" />
                                        Produtividade bateria
                                      </p>
                                      {row.produtividade_bateria_media != null && (
                                        <span className={`text-xs font-bold ${getPercentualTextClass(row.produtividade_bateria_media)}`}>
                                          média {pct(row.produtividade_bateria_media)}
                                        </span>
                                      )}
                                    </div>
                                    <div className="space-y-1.5">
                                      {row.modulos_bateria.map((modulo) => (
                                        <div
                                          key={`${row.plano}-${modulo.numero_selimp}`}
                                          className="rounded-lg bg-background/70 px-2.5 py-2 text-xs ring-1 ring-fuchsia-500/15"
                                          title={[
                                            `Bateria: ${modulo.bateria || modulo.status_bateria || "--"}`,
                                            `Sinal: ${modulo.status_sinal || "--"}`,
                                            `Dias ON/OFF: ${modulo.dias_on}/${modulo.dias_off}`,
                                          ].join(" · ")}
                                        >
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="font-mono font-semibold text-fuchsia-800 dark:text-fuchsia-200">
                                              {modulo.numero_selimp}
                                            </span>
                                            <span className={`font-bold ${getPercentualTextClass(modulo.produtividade_bateria)}`}>
                                              {pct(modulo.produtividade_bateria)}
                                            </span>
                                          </div>
                                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted/60">
                                            <div
                                              className={`h-full rounded-full ${getPercentualBarFill(modulo.produtividade_bateria)}`}
                                              style={{ width: `${clamp(modulo.produtividade_bateria)}%` }}
                                            />
                                          </div>
                                          <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                                            <span>{modulo.status_bateria || "Sem status"}</span>
                                            <span>{modulo.status_sinal || modulo.comunicacao || "--"}</span>
                                          </div>
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
                                                <span className="flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Esperado?</span>
                                              </th>
                                              <th className="text-left py-2 px-2">% SELIMP</th>
                                              <th className="text-left py-2 px-2">
                                                <span className="flex items-center gap-1"><Battery className="h-3.5 w-3.5" /> Bat. SELIMP</span>
                                              </th>
                                              <th className="text-left py-2 px-2">% DDMX</th>
                                              <th className="text-left py-2 px-2">
                                                <span className="flex items-center gap-1"><Battery className="h-3.5 w-3.5" /> Bat. DDMX</span>
                                              </th>
                                              <th className="text-left py-2 px-2">
                                                <span className="flex items-center gap-1"><Truck className="h-3.5 w-3.5" /> Des. Selimp?</span>
                                              </th>
                                              <th className="text-left py-2 px-2">
                                                <span className="flex items-center gap-1"><Truck className="h-3.5 w-3.5" /> Des. DDMX?</span>
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
                                                    ) : d.despachos_selimp > 0 ? (
                                                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-800 dark:text-amber-200">
                                                        Inesperado
                                                      </span>
                                                    ) : (
                                                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/15 px-2 py-0.5 text-muted-foreground">
                                                        Não
                                                      </span>
                                                    )}
                                                  </td>
                                                  <td className="py-2 px-2">
                                                    <PercentualBar value={d.percentual_selimp} compact />
                                                  </td>
                                                  <td className="py-2 px-2">
                                                    <BateriaSelimpBadge bateriaDia={d.bateria_setor_dia} />
                                                  </td>
                                                  <td className="py-2 px-2">
                                                    <PercentualBar value={d.percentual_nosso} compact />
                                                  </td>
                                                  <td className="py-2 px-2">
                                                    <BateriaDdmxBadge
                                                      bateriaDia={d.bateria_ddmx_dia}
                                                      applicable={isVarricaoPlanoUi(row.plano)}
                                                    />
                                                  </td>
                                                  <td className="py-2 px-2">
                                                    {d.despachos_selimp > 0 ? (
                                                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-blue-800 dark:text-blue-200 font-medium">
                                                        <Truck className="h-3.5 w-3.5 shrink-0" />
                                                        Sim
                                                      </span>
                                                    ) : (
                                                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/15 px-2 py-0.5 text-muted-foreground font-medium">
                                                        <Truck className="h-3.5 w-3.5 shrink-0 opacity-60" />
                                                        Não
                                                      </span>
                                                    )}
                                                  </td>
                                                  <td className="py-2 px-2">
                                                    {d.despachos_nosso > 0 ? (
                                                      <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-violet-800 dark:text-violet-200 font-medium">
                                                        <Truck className="h-3.5 w-3.5 shrink-0" />
                                                        Sim
                                                      </span>
                                                    ) : (
                                                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/15 px-2 py-0.5 text-muted-foreground font-medium">
                                                        <Truck className="h-3.5 w-3.5 shrink-0 opacity-60" />
                                                        Não
                                                      </span>
                                                    )}
                                                  </td>
                                                  <td className="py-2 px-2">
                                                    {(() => {
                                                      const dateKey = d.data.replace(/T.*/, "");
                                                      const obsGlobal = observacoes.globais[row.plano];
                                                      const obsDiaria = observacoes.diarias[row.plano]?.[dateKey];
                                                      const recentGlobalKey = `global::${row.plano}`;
                                                      const recentDiariaKey = `diaria::${row.plano}::${dateKey}`;
                                                      const isRecentGlobal = recentlySavedKeys.has(recentGlobalKey);
                                                      const isRecentDiaria = recentlySavedKeys.has(recentDiariaKey);
                                                      const hasBateria = d.esperado && d.despachos_selimp === 0 && d.despachos_nosso === 0 && row.bateria_por_equipamento && Object.values(row.bateria_por_equipamento).some((b) => /critico|baixo|descarregad|alerta|medio|aten/i.test(b.status_bateria));
                                                      const diariaCategory = obsDiaria ? getObsDiariaCategory(obsDiaria.titulo) : null;
                                                      const globalCategory = obsGlobal ? getObsGlobalCategory(obsGlobal.titulo) : null;
                                                      const diariaActionKey = `${row.plano}::${dateKey}`;
                                                      return (
                                                        <span className="inline-flex items-center gap-1 flex-wrap">
                                                          {obsGlobal && (() => {
                                                            const GIcon = globalCategory?.Icon ?? AlertTriangle;
                                                            return (
                                                              <span
                                                                title={`[Global] ${obsGlobal.titulo}`}
                                                                className={`inline-flex ${globalCategory?.tableIconClass ?? "text-red-500"} ${isRecentGlobal ? "animate-pulse drop-shadow-[0_0_4px_currentColor]" : ""}`}
                                                              >
                                                                <GIcon className="h-4 w-4" />
                                                              </span>
                                                            );
                                                          })()}
                                                          {obsDiaria && (() => {
                                                            const DIcon = diariaCategory?.Icon ?? AlertTriangle;
                                                            return (
                                                              <Popover
                                                                open={obsDiariaMenuKey === diariaActionKey}
                                                                onOpenChange={(open) =>
                                                                  setObsDiariaMenuKey(open ? diariaActionKey : null)
                                                                }
                                                              >
                                                                <PopoverTrigger asChild>
                                                                  <button
                                                                    type="button"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    className={`inline-flex rounded-md p-0.5 outline-none transition-colors hover:bg-amber-500/20 focus-visible:ring-2 focus-visible:ring-amber-500/50 ${diariaCategory?.tableIconClass ?? "text-amber-500"} ${isRecentDiaria ? "animate-pulse drop-shadow-[0_0_4px_currentColor]" : ""}`}
                                                                    title={obsDiaria.titulo}
                                                                    aria-label={`Observação diária: ${obsDiaria.titulo}. Abrir menu`}
                                                                  >
                                                                    <DIcon className="h-4 w-4" />
                                                                  </button>
                                                                </PopoverTrigger>
                                                                <PopoverContent
                                                                  className="w-auto min-w-[9.5rem] p-1 z-[120]"
                                                                  align="start"
                                                                  side="bottom"
                                                                  onClick={(e) => e.stopPropagation()}
                                                                >
                                                                  <button
                                                                    type="button"
                                                                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted"
                                                                    onClick={(e) => {
                                                                      e.stopPropagation();
                                                                      setObsDiariaMenuKey(null);
                                                                      setModalObsDiariaSetor(row.plano);
                                                                      setModalObsDiariaData(dateKey);
                                                                      setModalObsDiariaTitulo(obsDiaria.titulo);
                                                                      setModalObsDiariaCategoria("");
                                                                      setModalObsDiariaOpen(true);
                                                                    }}
                                                                  >
                                                                    <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" />
                                                                    Editar
                                                                  </button>
                                                                  <button
                                                                    type="button"
                                                                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-red-600 hover:bg-red-500/10 dark:text-red-400"
                                                                    onClick={async (e) => {
                                                                      e.stopPropagation();
                                                                      setObsDiariaMenuKey(null);
                                                                      if (!confirm("Cancelar esta observação diária?")) return;
                                                                      await apiService.cancelarIptObservacaoDiaria(obsDiaria.id);
                                                                      loadData();
                                                                    }}
                                                                  >
                                                                    <Trash2 className="h-4 w-4 shrink-0" />
                                                                    Cancelar
                                                                  </button>
                                                                </PopoverContent>
                                                              </Popover>
                                                            );
                                                          })()}
                                                          {!obsDiaria && hasBateria && (
                                                            <span title="Bateria baixa e setor não realizado neste dia" className="inline-flex text-amber-400">
                                                              <BatteryWarning className="h-4 w-4" />
                                                            </span>
                                                          )}
                                                          {!obsDiaria && (
                                                            <button
                                                              type="button"
                                                              onClick={(e) => {
                                                                e.stopPropagation();
                                                                setModalObsDiariaSetor(row.plano);
                                                                setModalObsDiariaData(dateKey);
                                                                setModalObsDiariaTitulo("");
                                                                setModalObsDiariaCategoria("");
                                                                setModalObsDiariaOpen(true);
                                                              }}
                                                              className={`inline-flex items-center gap-0.5 p-1 rounded-lg text-muted-foreground/60 hover:bg-muted/60 hover:text-foreground transition-all ${isRecentDiaria ? "ring-2 ring-amber-400/60 animate-pulse" : ""}`}
                                                              title="Adicionar observação diária"
                                                            >
                                                              <Plus className="h-3.5 w-3.5" />
                                                            </button>
                                                          )}
                                                        </span>
                                                      );
                                                    })()}
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
          </CardContent>
        </Card>

      </div>
    </MainLayout>
  );
}
