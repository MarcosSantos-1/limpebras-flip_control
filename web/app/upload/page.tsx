"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  BatteryFull,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  FileText,
  CalendarDays,
  LayoutDashboard,
  MapPin,
  Settings,
  ShieldAlert,
  Table2,
  Upload,
  Clock,
  File,
  Database,
  User,
  Hash,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { toast } from "react-toastify";
import { MainLayout } from "@/components/layout/main-layout";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/motion-primitives/accordion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/motion-ui/motion-dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TextShimmer } from "@/components/motion-primitives/text-shimmer";
import { TextMorph } from "@/components/motion-primitives/text-morph";
import { BorderTrailCard } from "@/components/motion-ui/border-trail-card";
import { apiService, type CronogramaImportReport } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const ACCORDION_VARIANTS = {
  expanded: { opacity: 1, y: 0 },
  collapsed: { opacity: 0, y: -6 },
};

type SessionKey = "flip" | "ddmx" | "selimp";
type UploadKey =
  | "flip"
  | "ddmx"
  | "ddmxVarricao"
  | "ddmxCompactadores"
  | "ddmxLight"
  | "iptReport"
  | "iptStatusBateria"
  | "iptHistoricoBateria"
  | "iptCronograma"
  | "iptSetoresModulos";
type StatusBateriaReferenceMode = "hoje" | "personalizado";

interface UploadApiError {
  response?: {
    data?: {
      detail?: string;
    };
  };
  message?: string;
}

interface UploadResult {
  processados?: number;
  total?: number;
  inseridos?: number;
  atualizados?: number;
  duplicados?: number;
  erros?: number;
  referencia_importada?: string;
  periodo_inicial?: string;
  periodo_final?: string;
  ordens_encerradas?: number;
  tipo_detectado?: string;
  tipo_detectado_label?: string;
  source_file?: string;
  /** Retornado pelo endpoint de histórico de bateria */
  datas_importadas?: string[];
  total_datas?: number;
  /** Só importação consolidada veículos — explica diferença linhas Excel vs inseridas */
  parse_stats?: {
    linhas_na_planilha?: number;
    linhas_importadas?: number;
    ignoradas_linha_vazia?: number;
    ignoradas_sem_setor?: number;
    ignoradas_sem_data?: number;
  };
  estimativa?: {
    com_data_selimp?: number;
    estimadas?: number;
    despachos_inesperados?: number;
    fora_periodo?: number;
    alta_confianca?: number;
    media_confianca?: number;
    baixa_confianca?: number;
  };
}

interface UploadState {
  status: "idle" | "uploading" | "success" | "error";
  result?: UploadResult;
  error?: string;
}

interface UploadHistoryEntry {
  tipo?: string;
  tipo_label?: string;
  source_file?: string | null;
  processados?: number;
  total?: number;
  inseridos?: number;
  atualizados?: number;
  referencia_importada?: string | null;
  ordens_encerradas?: number | null;
  periodo_inicial?: string | null;
  periodo_final?: string | null;
  imported_by?: string | null;
  username?: string | null;
  user_display_name?: string | null;
  created_at?: string | null;
}

interface LastUploadInfo {
  ultimo_import?: string | null;
  source_file?: string | null;
  total_registros?: number;
  total_encerradas?: number;
  ultima_referencia?: string | null;
  tipo_detectado?: string | null;
  tipo_detectado_label?: string | null;
  referencia_importada?: string | null;
  history?: UploadHistoryEntry[];
}

/** Última importação por tipo de planilha DDMX (vem solto no /upload/last-updates). */
interface DdmxTipoSnapshot {
  ultimo_import?: string | null;
  source_file?: string | null;
  total_registros?: number;
}

interface UploadOverviewResponse {
  iptReport?: LastUploadInfo;
  iptStatusBateria?: LastUploadInfo;
  iptCronograma?: LastUploadInfo;
  iptSetoresModulos?: LastUploadInfo;
  iptHistoricoOs?: DdmxTipoSnapshot;
  iptHistoricoOsVarricao?: DdmxTipoSnapshot;
  iptHistoricoOsCompactadores?: DdmxTipoSnapshot;
  ddmxVarricao?: DdmxTipoSnapshot;
  ddmxCompactadores?: DdmxTipoSnapshot;
  ddmxLight?: DdmxTipoSnapshot;
  sessions?: Record<SessionKey, LastUploadInfo>;
}

interface StatusBateriaReferenceOption {
  value: StatusBateriaReferenceMode;
  label: string;
  dataReferencia: string;
}

function getErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const apiError = error as UploadApiError;
    return apiError.response?.data?.detail || apiError.message || "Erro desconhecido";
  }
  return "Erro desconhecido";
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPtDate(dateKey: string): string {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString("pt-BR");
}

function formatDateTime(value?: string | null): string {
  if (!value) return "Sem importacao ainda";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Sem importacao ainda";
  return parsed.toLocaleString("pt-BR");
}

function buildStatusBateriaReferenceOptions(now = new Date()): StatusBateriaReferenceOption[] {
  const hojeKey = toDateKey(now);

  return [
    {
      value: "hoje",
      label: `Hoje (${formatPtDate(hojeKey)})`,
      dataReferencia: hojeKey,
    },
    {
      value: "personalizado",
      label: "Personalizado (escolher a data da exportação)",
      dataReferencia: "",
    },
  ];
}


function createInitialStates(): Record<UploadKey, UploadState> {
  return {
    flip: { status: "idle" },
    ddmx: { status: "idle" },
    ddmxVarricao: { status: "idle" },
    ddmxCompactadores: { status: "idle" },
    ddmxLight: { status: "idle" },
    iptReport: { status: "idle" },
    iptStatusBateria: { status: "idle" },
    iptHistoricoBateria: { status: "idle" },
    iptCronograma: { status: "idle" },
    iptSetoresModulos: { status: "idle" },
  };
}

type SessionAccent = "violet" | "sky" | "emerald" | "amber" | "slate";

const SESSION_ACCENTS: Record<SessionAccent, { bar: string; icon: string }> = {
  violet: {
    bar: "border-l-[3px] border-l-violet-500",
    icon: "bg-violet-100 text-violet-700 shadow-sm ring-1 ring-violet-200/80 dark:bg-violet-950/80 dark:text-violet-100 dark:ring-violet-400/35",
  },
  sky: {
    bar: "border-l-[3px] border-l-sky-500",
    icon: "bg-sky-100 text-sky-700 shadow-sm ring-1 ring-sky-200/80 dark:bg-sky-950/80 dark:text-sky-100 dark:ring-sky-400/35",
  },
  emerald: {
    bar: "border-l-[3px] border-l-emerald-500",
    icon: "bg-emerald-100 text-emerald-800 shadow-sm ring-1 ring-emerald-200/80 dark:bg-emerald-950/80 dark:text-emerald-100 dark:ring-emerald-400/35",
  },
  amber: {
    bar: "border-l-[3px] border-l-amber-500",
    icon: "bg-amber-100 text-amber-800 shadow-sm ring-1 ring-amber-200/80 dark:bg-amber-950/80 dark:text-amber-100 dark:ring-amber-400/35",
  },
  slate: {
    bar: "border-l-[3px] border-l-slate-500",
    icon: "bg-slate-100 text-slate-800 shadow-sm ring-1 ring-slate-200/80 dark:bg-slate-950/80 dark:text-slate-100 dark:ring-slate-400/35",
  },
};

function SessionAccordionItem({
  value,
  accent,
  icon: Icon,
  title,
  subtitle,
  contentClassName,
  children,
}: {
  value: string;
  accent: SessionAccent;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  const a = SESSION_ACCENTS[accent];
  return (
    <AccordionItem
      value={value}
      className={cn(
        "overflow-hidden rounded-2xl border px-5 shadow-sm transition-shadow hover:shadow-md",
        "border-slate-200/90 bg-white shadow-slate-900/[0.04]",
        "dark:border-border dark:bg-card dark:shadow-lg dark:shadow-black/40 dark:hover:shadow-xl",
        a.bar,
      )}
    >
      <AccordionTrigger className="flex w-full items-center justify-between gap-3 rounded-none py-5 text-left data-expanded:border-b data-expanded:border-slate-100 dark:data-expanded:border-border">
        <div className="flex items-start gap-3.5 text-left">
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", a.icon)}>
            <Icon className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1 pr-2">
            <div className="text-base font-semibold tracking-tight text-foreground">{title}</div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-expanded:rotate-180" />
      </AccordionTrigger>
      <AccordionContent className={cn("overflow-hidden pb-6 pt-1", contentClassName ?? "space-y-0")}>
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

type DropzoneTone = "neutral" | "violet" | "sky" | "fuchsia" | "emerald" | "amber";

const DROPZONE_SURFACE: Record<DropzoneTone, string> = {
  neutral:
    "border-slate-200/90 from-slate-50/90 to-white hover:border-slate-300/90 dark:border-dashed dark:border-border dark:from-muted/50 dark:to-card dark:hover:border-muted-foreground/40",
  violet:
    "border-violet-200/75 from-violet-50/55 to-white hover:border-violet-300/80 dark:border-dashed dark:border-violet-500/35 dark:from-violet-950/40 dark:to-card dark:hover:border-violet-400/45",
  sky:
    "border-sky-200/75 from-sky-50/50 to-white hover:border-sky-300/80 dark:border-dashed dark:border-sky-500/35 dark:from-sky-950/35 dark:to-card dark:hover:border-sky-400/45",
  fuchsia:
    "border-fuchsia-200/70 from-fuchsia-50/45 to-white hover:border-fuchsia-300/80 dark:border-dashed dark:border-fuchsia-500/35 dark:from-fuchsia-950/35 dark:to-card dark:hover:border-fuchsia-400/45",
  emerald:
    "border-emerald-200/75 from-emerald-50/45 to-white hover:border-emerald-300/80 dark:border-dashed dark:border-emerald-500/35 dark:from-emerald-950/35 dark:to-card dark:hover:border-emerald-400/45",
  amber:
    "border-amber-200/75 from-amber-50/50 to-white hover:border-amber-300/80 dark:border-dashed dark:border-amber-500/35 dark:from-amber-950/35 dark:to-card dark:hover:border-amber-400/45",
};

/** Pré-visualização (dry-run) da importação anual do cronograma + confirmação. */
function CronogramaPreview({
  report,
  loading,
  onConfirm,
  onCancel,
}: {
  report: CronogramaImportReport | null;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!report) return null;
  const isPreview = report.dry_run;
  const temRemovidos = report.removidos.length > 0;
  const substituir = report.modo_datas === "substituir";

  return (
    <div
      className={cn(
        "mt-6 rounded-2xl border p-5 text-sm shadow-sm",
        isPreview
          ? "border-sky-200/70 bg-gradient-to-br from-sky-50/90 via-white to-white dark:border-sky-800/50 dark:from-sky-950/40 dark:via-card dark:to-card"
          : "border-emerald-200/60 bg-gradient-to-br from-emerald-50/90 via-white to-white dark:border-emerald-800/50 dark:from-emerald-950/50 dark:via-card dark:to-card",
      )}
    >
      <div className="flex items-center gap-2.5 font-semibold text-foreground">
        <span
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg",
            isPreview
              ? "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300"
              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
          )}
        >
          {isPreview ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        </span>
        {isPreview ? "Pré-visualização — confira antes de gravar" : "Importação concluída"}
        <span
          className={cn(
            "ml-auto rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            substituir
              ? "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300"
              : "bg-slate-100 text-slate-700 dark:bg-muted dark:text-muted-foreground",
          )}
        >
          {substituir ? "Datas: substituir" : "Datas: mesclar"}
        </span>
      </div>

      <div className="mt-4 grid gap-2.5 text-xs leading-relaxed text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
        <div>Setores nos arquivos: <span className="font-semibold text-foreground">{report.setores_arquivo}</span></div>
        <div>Novos: <span className="font-semibold text-emerald-600 dark:text-emerald-400">{report.novos}</span></div>
        <div>Atualizados: <span className="font-semibold text-foreground">{report.atualizados}</span></div>
        <div>
          {isPreview ? "Serão removidos" : "Removidos"}:{" "}
          <span className={cn("font-semibold", temRemovidos ? "text-red-600 dark:text-red-400" : "text-foreground")}>
            {report.removidos.length}
          </span>
        </div>
        {!isPreview && (
          <div>Datas inseridas: <span className="font-semibold text-foreground">{report.datas_inseridas}</span></div>
        )}
        {substituir && (
          <div>
            {isPreview ? "Datas a substituir" : "Datas substituídas"}:{" "}
            <span className={cn("font-semibold", report.datas_removidas > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
              {report.datas_removidas}
            </span>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        {report.por_arquivo.map((a) => (
          <span key={a.arquivo} className="rounded-md bg-muted/60 px-2 py-1">
            {a.arquivo} · <span className="font-medium text-foreground/80">{a.modelo ?? "?"}</span> · {a.setores} setores
          </span>
        ))}
      </div>

      {temRemovidos && (
        <div className="mt-4 rounded-xl border border-red-200/70 bg-red-50/70 p-3 dark:border-red-900/50 dark:bg-red-950/30">
          <div className="text-xs font-semibold text-red-700 dark:text-red-300">
            {isPreview ? "Estes setores serão EXCLUÍDOS" : "Setores excluídos"} (cronograma + observações):
          </div>
          <div className="mt-2 max-h-32 overflow-y-auto font-mono text-[11px] leading-relaxed text-red-800 dark:text-red-200">
            {report.removidos.join(", ")}
          </div>
        </div>
      )}

      {report.avisos.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200/70 bg-amber-50/60 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
          <div className="text-xs font-semibold text-amber-700 dark:text-amber-300">Avisos</div>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
            {report.avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {isPreview && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button onClick={onConfirm} disabled={loading} className="gap-2">
            <CheckCircle2 className="h-4 w-4" />
            {loading ? "Gravando…" : "Confirmar importação"}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            Cancelar
          </Button>
          {temRemovidos && (
            <span className="text-[11px] text-red-600 dark:text-red-400">
              Atenção: {report.removidos.length} setor(es) serão removidos permanentemente.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryBox({ state }: { state: UploadState }) {
  if (state.status === "success" && state.result) {
    const chips: { icon: LucideIcon; label: string; value: string | number }[] = [
      { icon: Layers, label: "Processados", value: state.result.processados ?? 0 },
      { icon: Hash, label: "Total", value: state.result.total ?? 0 },
      { icon: Database, label: "Inseridos", value: state.result.inseridos ?? 0 },
      { icon: CheckCircle2, label: "Atualizados", value: state.result.atualizados ?? 0 },
    ];
    if (state.result.tipo_detectado_label) {
      chips.push({ icon: FileText, label: "Tipo", value: state.result.tipo_detectado_label });
    }
    if (state.result.referencia_importada) {
      chips.push({ icon: CalendarDays, label: "Ref.", value: state.result.referencia_importada });
    }
    if (state.result.ordens_encerradas !== undefined) {
      chips.push({ icon: CheckCircle2, label: "Encerrados", value: state.result.ordens_encerradas });
    }

    return (
      <div className="mt-3 rounded-xl border border-emerald-200/70 bg-emerald-50/50 px-3 py-2.5 dark:border-emerald-800/40 dark:bg-emerald-950/25">
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Upload concluído
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c.label}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-200/60 bg-white/80 px-2 py-1 text-[11px] text-muted-foreground dark:border-emerald-800/40 dark:bg-card/60"
              title={c.label}
            >
              <c.icon className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
              <span className="font-medium text-foreground/80">{c.label}:</span>
              <span className="font-semibold tabular-nums text-foreground">{c.value}</span>
            </span>
          ))}
        </div>
        {state.result.estimativa && (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-emerald-200/50 pt-2 dark:border-emerald-800/30">
            {[
              { label: "SELIMP", value: state.result.estimativa.com_data_selimp ?? 0 },
              { label: "Estimadas", value: state.result.estimativa.estimadas ?? 0 },
              { label: "Inesperados", value: state.result.estimativa.despachos_inesperados ?? 0 },
              { label: "Alta", value: state.result.estimativa.alta_confianca ?? 0 },
              { label: "Média", value: state.result.estimativa.media_confianca ?? 0 },
              { label: "Baixa", value: state.result.estimativa.baixa_confianca ?? 0 },
            ].map((item) => (
              <span
                key={item.label}
                className="rounded-md bg-emerald-100/70 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200"
              >
                {item.label} {item.value}
              </span>
            ))}
          </div>
        )}
        {state.result.datas_importadas && state.result.datas_importadas.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-emerald-200/50 pt-2 dark:border-emerald-800/30">
            <CalendarDays className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            <span className="text-[10px] font-medium text-muted-foreground">
              {state.result.total_datas ?? state.result.datas_importadas.length} datas
            </span>
            {state.result.datas_importadas.slice(0, 8).map((d) => (
              <span
                key={d}
                className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200"
              >
                {new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR")}
              </span>
            ))}
            {state.result.datas_importadas.length > 8 && (
              <span className="text-[10px] text-muted-foreground">
                +{state.result.datas_importadas.length - 8}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200/70 bg-red-50/60 px-3 py-2.5 text-sm dark:border-red-900/50 dark:bg-red-950/30">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
        <div className="min-w-0">
          <div className="font-semibold text-red-900 dark:text-red-300">Erro no upload</div>
          <div className="mt-0.5 text-xs leading-relaxed text-red-800/90 dark:text-red-200/90">{state.error}</div>
        </div>
      </div>
    );
  }

  return null;
}

function DdmxSnapFields({ snap }: { snap?: DdmxTipoSnapshot }) {
  const tem = Boolean(snap?.ultimo_import || snap?.source_file);
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
      <span className="inline-flex max-w-full items-center gap-1 truncate rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5">
        <File className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{tem ? snap?.source_file || "—" : "—"}</span>
      </span>
      <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5">
        <Clock className="h-3 w-3 text-muted-foreground" />
        <span className="font-medium">{tem ? formatDateTime(snap?.ultimo_import) : "Sem import"}</span>
      </span>
      <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5">
        <Database className="h-3 w-3 text-muted-foreground" />
        <span className="font-medium tabular-nums">{tem ? snap?.total_registros ?? 0 : "—"}</span>
      </span>
    </div>
  );
}

function DdmxPorTipoBlock({ overview }: { overview?: UploadOverviewResponse }) {
  const snapVeic = overview?.iptHistoricoOs;
  const snapComp = overview?.iptHistoricoOsCompactadores;
  const snapVarr = overview?.iptHistoricoOsVarricao;

  return (
    <div className="mt-3 rounded-xl border border-sky-200/60 bg-sky-50/40 px-3 py-2.5 dark:border-sky-800/40 dark:bg-sky-950/20">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Table2 className="h-4 w-4 text-sky-600 dark:text-sky-400" />
        Última importação por linha DDMX
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-card/70 px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
            Veículos
          </div>
          <DdmxSnapFields snap={snapVeic} />
          <div className="mt-2 flex items-center gap-1.5 border-t border-border/50 pt-2 text-xs font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Compactadores
          </div>
          <DdmxSnapFields snap={snapComp} />
        </div>
        <div className="rounded-lg border border-border/60 bg-card/70 px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
            Varrição
          </div>
          <DdmxSnapFields snap={snapVarr} />
        </div>
      </div>
    </div>
  );
}

function HistoryBlock({
  title,
  overview,
  expanded,
  onToggle,
  hint,
  historyLimit = 10,
}: {
  title: string;
  overview?: LastUploadInfo;
  expanded: boolean;
  onToggle: () => void;
  hint?: string;
  historyLimit?: number;
}) {
  const history = (overview?.history ?? []).slice(0, historyLimit);

  const meta: { icon: LucideIcon; label: string; value: string }[] = [
    { icon: Clock, label: "Atualização", value: formatDateTime(overview?.ultimo_import) },
    { icon: File, label: "Arquivo", value: overview?.source_file || "—" },
    { icon: Database, label: "Registros", value: String(overview?.total_registros ?? 0) },
  ];
  if (overview?.tipo_detectado_label) {
    meta.push({ icon: FileText, label: "Tipo", value: overview.tipo_detectado_label });
  }
  if (overview?.ultima_referencia || overview?.referencia_importada) {
    meta.push({
      icon: CalendarDays,
      label: "Referência",
      value: overview.ultima_referencia || overview.referencia_importada || "—",
    });
  }
  if (overview?.total_encerradas !== undefined) {
    meta.push({ icon: CheckCircle2, label: "Encerrados", value: String(overview.total_encerradas ?? 0) });
  }

  return (
    <div className="mt-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <LayoutDashboard className="h-4 w-4 shrink-0 text-muted-foreground" />
        {title}
      </div>
      {hint ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {meta.map((item) => (
          <span
            key={item.label}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-background/80 px-2 py-1 text-[11px] text-muted-foreground"
            title={`${item.label}: ${item.value}`}
          >
            <item.icon className="h-3 w-3 shrink-0" />
            <span className="font-medium text-foreground/70">{item.label}</span>
            <span className="truncate font-semibold text-foreground">{item.value}</span>
          </span>
        ))}
      </div>

      {history.length > 0 && (
        <div className="mt-2">
          <Button
            variant="ghost"
            type="button"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={onToggle}
          >
            {expanded ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
            {expanded ? "Ocultar histórico" : `Histórico (${Math.min(history.length, 10)})`}
          </Button>

          {expanded && (
            <ul className="mt-1.5 space-y-1 border-t border-border/50 pt-2">
              {history.slice(0, 10).map((entry, index) => (
                <li
                  key={`${entry.created_at}-${entry.source_file}-${index}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/50 bg-background/70 px-2 py-1.5 text-[11px]"
                >
                  <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                    <FileText className="h-3 w-3 text-muted-foreground" />
                    {entry.tipo_label || "Importação"}
                  </span>
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatDateTime(entry.created_at)}
                  </span>
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <User className="h-3 w-3" />
                    {entry.imported_by || entry.user_display_name || entry.username || "—"}
                  </span>
                  <span className="inline-flex items-center gap-1 tabular-nums text-muted-foreground">
                    <Hash className="h-3 w-3" />
                    {entry.processados ?? 0}
                  </span>
                  <span className="inline-flex min-w-0 max-w-full items-center gap-1 truncate text-muted-foreground">
                    <File className="h-3 w-3 shrink-0" />
                    <span className="truncate">{entry.source_file || "—"}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function UploadDropzone({
  inputId,
  accept,
  loading,
  helperText,
  onFilesSelected,
  tone = "neutral",
}: {
  inputId: string;
  accept: string;
  loading: boolean;
  helperText: string;
  onFilesSelected: (files: FileList | null) => void;
  tone?: DropzoneTone;
}) {
  const [dragActive, setDragActive] = useState(false);

  return (
    <BorderTrailCard
      loading={loading}
      className={cn(
        "rounded-2xl border-dashed bg-gradient-to-b p-8 text-center shadow-sm transition-all duration-200",
        DROPZONE_SURFACE[tone],
        dragActive
          ? "scale-[1.01] border-primary/40 shadow-md shadow-primary/10 ring-2 ring-primary/20 dark:border-primary/30"
          : "hover:shadow-md hover:shadow-slate-900/[0.04] dark:hover:shadow-black/40",
        loading && "pointer-events-none opacity-70",
      )}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        onFilesSelected(event.dataTransfer.files);
      }}
    >
      <input
        id={inputId}
        type="file"
        accept={accept}
        multiple={inputId === "iptCronograma"}
        className="hidden"
        onChange={(event) => onFilesSelected(event.target.files)}
        disabled={loading}
      />
      <label htmlFor={inputId} className="block cursor-pointer">
        <div
          className={cn(
            "mx-auto flex h-14 w-14 items-center justify-center rounded-2xl shadow-inner",
            "bg-white/90 ring-1 ring-slate-200/90 dark:bg-muted/60 dark:ring-border",
          )}
        >
          <FileSpreadsheet className="h-6 w-6 text-primary" />
        </div>
        <div className="mt-5 text-sm font-semibold tracking-tight text-foreground">
          {loading ? (
            <TextShimmer as="span" className="text-sm font-semibold" duration={1.6}>
              Processando arquivo…
            </TextShimmer>
          ) : (
            <TextMorph as="span" className="inline-flex">
              Clique ou arraste o arquivo aqui
            </TextMorph>
          )}
        </div>
        <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-slate-600 dark:text-muted-foreground">{helperText}</p>
        <p className="mt-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Formatos: <span className="font-semibold text-foreground/80">{accept.replace(/\./g, "").replace(/,/g, " · ")}</span>
        </p>
      </label>
    </BorderTrailCard>
  );
}

export default function UploadPage() {
  const { isIptRestrictedUser } = useAuth();
  const statusBateriaReferenceOptions = useMemo(() => buildStatusBateriaReferenceOptions(), []);
  const [states, setStates] = useState<Record<UploadKey, UploadState>>(createInitialStates());
  const [overview, setOverview] = useState<UploadOverviewResponse>({});
  const [statusBateriaRefIdx, setStatusBateriaRefIdx] = useState(0);
  const [customStatusBateriaData, setCustomStatusBateriaData] = useState("");
  const [cronogramaModalOpen, setCronogramaModalOpen] = useState(false);
  const [cronogramaFiles, setCronogramaFiles] = useState<File[]>([]);
  const [cronogramaReport, setCronogramaReport] = useState<CronogramaImportReport | null>(null);
  const [cronogramaReplaceDatas, setCronogramaReplaceDatas] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});

  const loadOverview = async () => {
    try {
      const data = await apiService.getUploadLastUpdates();
      setOverview((data || {}) as UploadOverviewResponse);
    } catch (error) {
      console.error("Erro ao carregar resumo de uploads:", error);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const setUploadState = (key: UploadKey, next: UploadState) => {
    setStates((prev) => ({ ...prev, [key]: next }));
  };

  const validateSessionFile = (session: SessionKey, file: File): string | null => {
    const lowerName = file.name.toLowerCase();
    if (session === "flip") {
      if (!lowerName.endsWith(".csv")) {
        return "A sessao FLIP aceita apenas CSV. Arquivos IPT/Report serao bloqueados aqui.";
      }
      return null;
    }
    if (session === "ddmx") {
      if (!lowerName.endsWith(".xlsx") && !lowerName.endsWith(".xls")) {
        return "A sessao DDMX aceita apenas planilhas XLSX.";
      }
      return null;
    }
    return null;
  };

  const handleSessionUpload = async (session: "flip" | "ddmx", files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    const validationError = validateSessionFile(session, file);
    if (validationError) {
      toast.error(validationError);
      setUploadState(session, { status: "error", error: validationError });
      return;
    }

    setUploadState(session, { status: "uploading" });
    try {
      const result = await apiService.uploadSessionFile(session, file);
      setUploadState(session, { status: "success", result });
      toast.success(`${result?.tipo_detectado_label || "Arquivo"} importado com sucesso.`);
      await loadOverview();
    } catch (error) {
      const message = getErrorMessage(error);
      setUploadState(session, { status: "error", error: message });
      toast.error(message);
    }
  };

  const handleDdmxUpload = async (
    target: "ddmxVarricao" | "ddmxCompactadores" | "ddmxLight",
    files: FileList | null
  ) => {
    const file = files?.[0];
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".xlsx") && !lowerName.endsWith(".xls")) {
      const msg = "Aceita apenas arquivos XLSX/XLS.";
      toast.error(msg);
      setUploadState(target, { status: "error", error: msg });
      return;
    }
    setUploadState(target, { status: "uploading" });
    try {
      const uploader =
        target === "ddmxVarricao"
          ? apiService.uploadDdmxVarricao
          : target === "ddmxCompactadores"
          ? apiService.uploadDdmxCompactadores
          : apiService.uploadDdmxLight;
      const result = await uploader(file);
      setUploadState(target, { status: "success", result });
      toast.success(`${result?.tipo_detectado_label || "Arquivo"} importado com sucesso.`);
      await loadOverview();
    } catch (error) {
      const message = getErrorMessage(error);
      setUploadState(target, { status: "error", error: message });
      toast.error(message);
    }
  };

  const handleTypedUpload = async (key: "iptReport" | "iptStatusBateria", files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      const message = "Esse campo aceita apenas arquivos XLSX.";
      setUploadState(key, { status: "error", error: message });
      toast.error(message);
      return;
    }

    setUploadState(key, { status: "uploading" });
    try {
      let result;
      if (key === "iptReport") {
        // A data agora vem da própria planilha (coluna "Data planejada").
        // O período é derivado automaticamente no backend — sem seleção manual.
        result = await apiService.uploadIptReportXlsx(file);
      } else {
        const selectedRef = statusBateriaReferenceOptions[statusBateriaRefIdx] ?? statusBateriaReferenceOptions[0];
        const dataReferencia =
          selectedRef.value === "personalizado"
            ? customStatusBateriaData
            : selectedRef.dataReferencia;
        if (!dataReferencia) {
          setUploadState(key, { status: "error", error: "Informe a data da exportação SELIMP." });
          toast.error("Informe a data da exportação SELIMP.");
          return;
        }
        result = await apiService.uploadIptStatusBateriaXlsx(file, dataReferencia);
      }

      setUploadState(key, { status: "success", result });
      toast.success(key === "iptStatusBateria" ? "Status de Bateria importado com sucesso." : "Upload concluido com sucesso.");
      await loadOverview();
    } catch (error) {
      const message = getErrorMessage(error);
      setUploadState(key, { status: "error", error: message });
      toast.error(message);
    }
  };

  /** Passo 1: seleciona as planilhas e roda o dry-run (pré-visualização sem gravar). */
  const handleCronogramaUpload = async (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;

    const invalidFile = list.find((file) => !file.name.toLowerCase().endsWith(".xlsx"));
    if (invalidFile) {
      const message = "Cronograma aceita apenas arquivos XLSX.";
      setUploadState("iptCronograma", { status: "error", error: message });
      toast.error(message);
      return;
    }

    setCronogramaFiles(list);
    setCronogramaReport(null);
    await runCronogramaDryRun(list, cronogramaReplaceDatas);
  };

  /** Roda o dry-run (pré-visualização) com a lista de arquivos e o modo de datas atual. */
  const runCronogramaDryRun = async (list: File[], replaceDatas: boolean) => {
    if (!list.length) return;
    setUploadState("iptCronograma", { status: "uploading" });
    try {
      const report = await apiService.uploadCronogramaPlano(list, { dryRun: true, replaceDatas });
      setCronogramaReport(report);
      setUploadState("iptCronograma", { status: "idle" });
    } catch (error) {
      const message = getErrorMessage(error);
      setCronogramaFiles([]);
      setUploadState("iptCronograma", { status: "error", error: message });
      toast.error(message);
    }
  };

  /** Alterna mesclar/substituir; se já há arquivos selecionados, atualiza a pré-visualização. */
  const handleCronogramaReplaceToggle = (checked: boolean) => {
    setCronogramaReplaceDatas(checked);
    if (cronogramaFiles.length) void runCronogramaDryRun(cronogramaFiles, checked);
  };

  /** Passo 2: confirma e grava (dryRun=false). */
  const handleCronogramaConfirm = async () => {
    if (!cronogramaFiles.length) return;
    setUploadState("iptCronograma", { status: "uploading" });
    try {
      const report = await apiService.uploadCronogramaPlano(cronogramaFiles, {
        dryRun: false,
        replaceDatas: cronogramaReplaceDatas,
      });
      setCronogramaReport(report);
      setUploadState("iptCronograma", {
        status: "success",
        result: {
          processados: report.setores_arquivo,
          total: report.setores_arquivo,
          inseridos: report.novos,
          atualizados: report.atualizados,
          duplicados: 0,
          erros: 0,
        },
      });
      setCronogramaFiles([]);
      toast.success(
        `Cronograma importado: ${report.novos} novos, ${report.atualizados} atualizados, ${report.removidos.length} removidos.`,
      );
      await loadOverview();
    } catch (error) {
      const message = getErrorMessage(error);
      setUploadState("iptCronograma", { status: "error", error: message });
      toast.error(message);
    }
  };

  const handleCronogramaCancel = () => {
    setCronogramaFiles([]);
    setCronogramaReport(null);
    setUploadState("iptCronograma", { status: "idle" });
  };

  const handleSetoresModulosUpload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      const message = "Setores e módulos aceita apenas arquivos XLSX (SETORES.xlsx).";
      setUploadState("iptSetoresModulos", { status: "error", error: message });
      toast.error(message);
      return;
    }

    setUploadState("iptSetoresModulos", { status: "uploading" });
    try {
      const result = await apiService.uploadIptSetoresModulosXlsx(file);
      setUploadState("iptSetoresModulos", { status: "success", result });
      toast.success("Setores e módulos importados com sucesso.");
      await loadOverview();
    } catch (error) {
      const message = getErrorMessage(error);
      setUploadState("iptSetoresModulos", { status: "error", error: message });
      toast.error(message);
    }
  };

  const handleClearDadosBateria = async () => {
    const ok = window.confirm(
      "Isso apaga TODOS os registros de ipt_dados_bateria e reinicia o contador de ID (próximo import começa em 1). Continuar?"
    );
    if (!ok) return;
    try {
      const result = await apiService.clearIptDadosBateria();
      const deleted = Number(result?.deleted ?? 0);
      toast.success(
        deleted > 0
          ? `${deleted} registros removidos. IDs reiniciados — pode importar o histórico.`
          : "Tabela já estava vazia. IDs reiniciados."
      );
      await loadOverview();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const handleHistoricoBateriaUpload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx") && !file.name.toLowerCase().endsWith(".xls")) {
      const msg = "Aceita apenas arquivos XLSX/XLS.";
      setUploadState("iptHistoricoBateria", { status: "error", error: msg });
      toast.error(msg);
      return;
    }
    setUploadState("iptHistoricoBateria", { status: "uploading" });
    try {
      const result = await apiService.uploadIptHistoricoBateriaXlsx(file);
      setUploadState("iptHistoricoBateria", { status: "success", result });
      toast.success("Histórico de bateria importado com sucesso.");
      await loadOverview();
    } catch (error) {
      const message = getErrorMessage(error);
      setUploadState("iptHistoricoBateria", { status: "error", error: message });
      toast.error(message);
    }
  };

  const toggleHistory = (key: string) => {
    setExpandedHistory((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <MainLayout>
      <div
        className={cn(
          "relative space-y-10 pb-10",
          "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-72 before:-translate-y-8 before:bg-[radial-gradient(ellipse_90%_60%_at_50%_-10%,rgba(99,102,241,0.11),transparent)]",
          "dark:before:bg-[radial-gradient(ellipse_90%_60%_at_50%_-10%,rgba(99,102,241,0.18),transparent)]",
        )}
      >
        <div className="relative overflow-hidden rounded-3xl border border-indigo-400/20 bg-gradient-to-br from-indigo-600 via-indigo-700 to-purple-900 p-8 text-white shadow-2xl shadow-indigo-950/25 ring-1 ring-white/10 dark:border-white/10 dark:shadow-indigo-950/40">
          <div
            className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl dark:bg-white/5"
            aria-hidden
          />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-5">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-indigo-950/70 shadow-lg shadow-black/25 ring-1 ring-white/15">
                <Upload className="h-8 w-8" strokeWidth={1.8} />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-200/90">Central de importação</p>
                <h1 className="mt-1 text-4xl font-bold tracking-tight">Upload de dados</h1>
                <p className="mt-4 max-w-3xl text-sm leading-relaxed text-indigo-50/95 sm:text-base">
                  {isIptRestrictedUser
                    ? "Importação diária do status de bateria SELIMP (data da exportação = hoje ou personalizada)."
                    : "As importações principais ficam por sessão (FLIP, DDMX, SELIMP). "}
                </p>
                {isIptRestrictedUser ? (
                  <ul className="mt-4 flex flex-wrap gap-2 text-[11px] text-indigo-100/90">
                    <li className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">IPT</li>
                    <li className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">Status de bateria</li>
                    <li className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">Data da exportação</li>
                  </ul>
                ) : (
                  <ul className="mt-4 flex flex-wrap gap-2 text-[11px] text-indigo-100/90">
                    <li className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">Detecção automática</li>
                    <li className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">Histórico por sessão</li>
                    <li className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">Referência SELIMP explícita</li>
                  </ul>
                )}
              </div>
            </div>

            {!isIptRestrictedUser ? (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="h-11 w-11 shrink-0 rounded-xl border-0 bg-white/15 text-white shadow-lg shadow-black/20 ring-1 ring-white/20 hover:bg-white/25 hover:text-white"
                title="Importações de referência IPT (cronograma e setores)"
                onClick={() => setCronogramaModalOpen(true)}
              >
                <Settings className="h-5 w-5" />
                <span className="sr-only">Abrir importações de referência IPT</span>
              </Button>
            ) : null}
          </div>
        </div>

        {!isIptRestrictedUser ? (
          <div
            className={cn(
              "rounded-2xl border p-5 text-sm shadow-sm",
              "border-amber-200/70 bg-gradient-to-br from-amber-50/95 via-white to-orange-50/40 text-amber-950",
              "shadow-amber-900/[0.06] dark:border-amber-800/50 dark:bg-gradient-to-br dark:from-amber-950/55 dark:via-card dark:to-card dark:text-amber-50 dark:shadow-md dark:shadow-black/25",
            )}
          >
            <div className="flex items-start gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800 shadow-sm ring-1 ring-amber-200/80 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-500/30">
                <ShieldAlert className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="font-semibold tracking-tight text-amber-950 dark:text-amber-50">Proteção extra nos envios</div>
                <p className="mt-2 text-xs leading-relaxed text-amber-950/85 dark:text-amber-50/90">
                  Cada sessão aceita só formatos compatíveis. A validação final é no servidor (conteúdo + tipo real do arquivo).
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center rounded-md bg-white/80 px-2 py-1 font-mono text-[11px] font-semibold text-amber-950 shadow-sm ring-1 ring-amber-200/60 dark:bg-muted/60 dark:text-amber-100 dark:ring-border">
                    FLIP → .csv
                  </span>
                  <span className="inline-flex items-center rounded-md bg-white/80 px-2 py-1 font-mono text-[11px] font-semibold text-amber-950 shadow-sm ring-1 ring-amber-200/60 dark:bg-muted/60 dark:text-amber-100 dark:ring-border">
                    DDMX → .xlsx / .xls
                  </span>
                  <span className="inline-flex items-center rounded-md bg-white/80 px-2 py-1 text-[11px] font-medium text-amber-950 shadow-sm ring-1 ring-amber-200/60 dark:bg-muted/60 dark:text-amber-100 dark:ring-border">
                    Report SELIMP e status de bateria: fluxos à parte nesta página
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {isIptRestrictedUser ? (
          <div
            className={cn(
              "rounded-2xl border p-6 shadow-sm",
              "border-slate-200/85 bg-gradient-to-b from-white to-slate-50/40",
              "dark:border-border dark:bg-gradient-to-b dark:from-card dark:to-muted/25 dark:shadow-md dark:shadow-black/20",
            )}
          >
            <div className="mb-5 flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-500/25">
                <BatteryFull className="h-4 w-4" />
              </span>
              <div>
                <div className="text-lg font-semibold tracking-tight">IPT — Status de Bateria</div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Planilha oficial SELIMP do dia. Escolha a data da exportação (hoje ou personalizada) antes de enviar.
                </p>
              </div>
            </div>

            <div className="mb-5 rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/90 to-white p-4 shadow-sm dark:border-emerald-700/40 dark:bg-gradient-to-br dark:from-emerald-950/40 dark:to-muted/30">
              <Label className="mb-3 block text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                Data da exportação SELIMP
              </Label>
              <Select value={String(statusBateriaRefIdx)} onValueChange={(value) => setStatusBateriaRefIdx(Number(value))}>
                <SelectTrigger className="w-full border border-slate-200/80 bg-white shadow-sm dark:border-border dark:bg-card">
                  <SelectValue placeholder="Selecione a data" />
                </SelectTrigger>
                <SelectContent>
                  {statusBateriaReferenceOptions.map((option, idx) => (
                    <SelectItem key={idx} value={String(idx)}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {statusBateriaReferenceOptions[statusBateriaRefIdx]?.value === "personalizado" && (
                <div className="mt-3">
                  <Label className="mb-1 block text-xs text-emerald-800 dark:text-emerald-300">Data da exportação</Label>
                  <DatePicker
                    value={customStatusBateriaData}
                    onChange={setCustomStatusBateriaData}
                    placeholder="Data da exportação"
                  />
                </div>
              )}
              {(() => {
                const opt = statusBateriaReferenceOptions[statusBateriaRefIdx];
                const dataKey =
                  opt?.value === "personalizado" ? customStatusBateriaData : opt?.dataReferencia;
                if (!dataKey) return null;
                return (
                  <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                    Será gravado como: {formatPtDate(dataKey)}
                  </div>
                );
              })()}
            </div>

            <UploadDropzone
              inputId="iptStatusBateriaRestricted"
              accept=".xlsx"
              tone="emerald"
              loading={states.iptStatusBateria.status === "uploading"}
              helperText="Arquivo 'Status de Bateria.xlsx' da SELIMP."
              onFilesSelected={(files) => handleTypedUpload("iptStatusBateria", files)}
            />
            <HistoryBlock
              title="Último status de bateria importado"
              overview={overview.iptStatusBateria}
              expanded={Boolean(expandedHistory.iptStatusBateria)}
              onToggle={() => toggleHistory("iptStatusBateria")}
            />
            <SummaryBox state={states.iptStatusBateria} />

            {/* Histórico Geral de Bateria — descomentar para reativar
            <div
              className={cn(
                "mt-6 rounded-2xl border p-6 shadow-sm",
                "border-amber-200/70 bg-gradient-to-b from-amber-50/60 to-white",
                "dark:border-amber-800/45 dark:bg-gradient-to-b dark:from-amber-950/35 dark:to-muted/25 dark:shadow-md dark:shadow-black/20",
              )}
            >
              <div className="mb-4 flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800 ring-1 ring-amber-200/80 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-500/25">
                  <FileSpreadsheet className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-semibold tracking-tight">Histórico Geral de Bateria</div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    Arquivo HISTÓRICO GERAL BATERIA VARRICAO.xlsx — várias datas na coluna A. Reimportar substitui cada dia.
                  </p>
                </div>
              </div>
              <div className="mb-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-amber-300/80 text-amber-900 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-950/40"
                  onClick={handleClearDadosBateria}
                >
                  Limpar tabela e reiniciar IDs
                </Button>
              </div>
              <UploadDropzone
                inputId="iptHistoricoBateriaRestricted"
                accept=".xlsx,.xls"
                tone="amber"
                loading={states.iptHistoricoBateria.status === "uploading"}
                helperText="Arquivo histórico com múltiplas datas em coluna A. Formato: HISTÓRICO GERAL BATERIA VARRICAO.xlsx"
                onFilesSelected={handleHistoricoBateriaUpload}
              />
              <SummaryBox state={states.iptHistoricoBateria} />
            </div>
            */}
          </div>
        ) : (
        <Accordion
          className="space-y-5"
          transition={{ type: "spring", stiffness: 140, damping: 22 }}
          variants={ACCORDION_VARIANTS}
        >
          <SessionAccordionItem
            value="flip"
            accent="violet"
            icon={FileText}
            title="FLIP"
            subtitle="Um único campo para SAC, BFS, CNC (detalhes), Ouvidoria e ACIC. O tipo de CSV é inferido pelas colunas e, em último caso, pelo nome do arquivo."
          >
            <UploadDropzone
              inputId="flip"
              accept=".csv"
              tone="violet"
              loading={states.flip.status === "uploading"}
              helperText="Exportações do FLIP em CSV. A consulta CNC (detalhes) só substitui as linhas que vêm no arquivo — não zera CNCs de outros meses; dá para importar só o mês de apuração."
              onFilesSelected={(files) => handleSessionUpload("flip", files)}
            />
            <HistoryBlock
              title="Resumo da sessão FLIP"
              overview={overview.sessions?.flip}
              expanded={Boolean(expandedHistory.flip)}
              onToggle={() => toggleHistory("flip")}
            />
            <SummaryBox state={states.flip} />
          </SessionAccordionItem>

          <SessionAccordionItem
            value="ddmx"
            accent="sky"
            icon={Table2}
            title="DDMX"
            subtitle="Três canais separados: Varrição, Compactadores e Light (veículos). Cada um com seu próprio histórico e armazenamento dedicado."
            contentClassName="grid gap-6 pb-6 pt-1 md:grid-cols-3"
          >
            <div
              className={cn(
                "rounded-2xl border p-6 shadow-sm",
                "border-slate-200/85 bg-gradient-to-b from-white to-slate-50/40",
                "dark:border-border dark:bg-gradient-to-b dark:from-card dark:to-muted/25 dark:shadow-md dark:shadow-black/20",
              )}
            >
              <div className="mb-5 flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-800 ring-1 ring-sky-200/80 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-500/25">
                  <Table2 className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-lg font-semibold tracking-tight">Varrição</div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Histórico de OS de varrição do DDMX.
                  </p>
                </div>
              </div>
              <UploadDropzone
                inputId="ddmxVarricao"
                accept=".xlsx,.xls"
                tone="sky"
                loading={states.ddmxVarricao.status === "uploading"}
                helperText="Planilha de varrição DDMX (XLSX/XLS)."
                onFilesSelected={(files) => handleDdmxUpload("ddmxVarricao", files)}
              />
              <HistoryBlock
                title="Último import de varrição"
                overview={overview.ddmxVarricao ?? overview.iptHistoricoOsVarricao}
                expanded={Boolean(expandedHistory.ddmxVarricao)}
                onToggle={() => toggleHistory("ddmxVarricao")}
              />
              <SummaryBox state={states.ddmxVarricao} />
            </div>

            <div
              className={cn(
                "rounded-2xl border p-6 shadow-sm",
                "border-slate-200/85 bg-gradient-to-b from-white to-slate-50/40",
                "dark:border-border dark:bg-gradient-to-b dark:from-card dark:to-muted/25 dark:shadow-md dark:shadow-black/20",
              )}
            >
              <div className="mb-5 flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800 ring-1 ring-amber-200/80 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-500/25">
                  <Table2 className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-lg font-semibold tracking-tight">Compactadores</div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Histórico de OS de compactadores do DDMX.
                  </p>
                </div>
              </div>
              <UploadDropzone
                inputId="ddmxCompactadores"
                accept=".xlsx,.xls"
                tone="amber"
                loading={states.ddmxCompactadores.status === "uploading"}
                helperText="Planilha de compactadores DDMX (XLSX/XLS)."
                onFilesSelected={(files) => handleDdmxUpload("ddmxCompactadores", files)}
              />
              <HistoryBlock
                title="Último import de compactadores"
                overview={overview.ddmxCompactadores ?? overview.iptHistoricoOsCompactadores}
                expanded={Boolean(expandedHistory.ddmxCompactadores)}
                onToggle={() => toggleHistory("ddmxCompactadores")}
              />
              <SummaryBox state={states.ddmxCompactadores} />
            </div>

            <div
              className={cn(
                "rounded-2xl border p-6 shadow-sm",
                "border-slate-200/85 bg-gradient-to-b from-white to-slate-50/40",
                "dark:border-border dark:bg-gradient-to-b dark:from-card dark:to-muted/25 dark:shadow-md dark:shadow-black/20",
              )}
            >
              <div className="mb-5 flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-800 ring-1 ring-violet-200/80 dark:bg-violet-950/40 dark:text-violet-200 dark:ring-violet-500/25">
                  <Table2 className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-lg font-semibold tracking-tight">Light (Veículos)</div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Histórico de OS geral de veículos (frota leve) do DDMX.
                  </p>
                </div>
              </div>
              <UploadDropzone
                inputId="ddmxLight"
                accept=".xlsx,.xls"
                tone="violet"
                loading={states.ddmxLight.status === "uploading"}
                helperText="Planilha de veículos (light) DDMX (XLSX/XLS)."
                onFilesSelected={(files) => handleDdmxUpload("ddmxLight", files)}
              />
              <HistoryBlock
                title="Último import de light"
                overview={overview.ddmxLight ?? overview.iptHistoricoOs}
                expanded={Boolean(expandedHistory.ddmxLight)}
                onToggle={() => toggleHistory("ddmxLight")}
              />
              <SummaryBox state={states.ddmxLight} />
            </div>
          </SessionAccordionItem>

          <SessionAccordionItem
            value="selimp"
            accent="emerald"
            icon={LayoutDashboard}
            title="SELIMP"
            subtitle="Dois canais: relatório de ordens (período de referência) e status de bateria diário (data da exportação SELIMP)."
            contentClassName="grid gap-6 pb-6 pt-1 md:grid-cols-1 lg:grid-cols-2"
          >
            <div
              className={cn(
                "rounded-2xl border p-6 shadow-sm",
                "border-slate-200/85 bg-gradient-to-b from-white to-slate-50/40",
                "dark:border-border dark:bg-gradient-to-b dark:from-card dark:to-muted/25 dark:shadow-md dark:shadow-black/20",
              )}
            >
              <div className="mb-5 flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-fuchsia-100 text-fuchsia-800 ring-1 ring-fuchsia-200/80 dark:bg-fuchsia-950/40 dark:text-fuchsia-200 dark:ring-fuchsia-500/25">
                  <FileSpreadsheet className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-lg font-semibold tracking-tight">IPT — Report SELIMP</div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    A data agora vem da própria planilha (coluna “Data planejada”). É só enviar — o sistema identifica os dias automaticamente e sobrescreve os dados desses dias a cada reimportação.
                  </p>
                </div>
              </div>

                <UploadDropzone
                  inputId="iptReport"
                  accept=".xlsx"
                  tone="fuchsia"
                  loading={states.iptReport.status === "uploading"}
                  helperText="Arquivo oficial do report SELIMP (XLSX). Os dias são lidos da planilha e os dados desses dias são substituídos a cada envio."
                  onFilesSelected={(files) => handleTypedUpload("iptReport", files)}
                />
                <HistoryBlock
                  title="Último report importado"
                  overview={overview.iptReport}
                  expanded={Boolean(expandedHistory.iptReport)}
                  onToggle={() => toggleHistory("iptReport")}
                />
                <SummaryBox state={states.iptReport} />
              </div>


              <div
                className={cn(
                "rounded-2xl border p-6 shadow-sm",
                "border-slate-200/85 bg-gradient-to-b from-white to-slate-50/40",
                "dark:border-border dark:bg-gradient-to-b dark:from-card dark:to-muted/25 dark:shadow-md dark:shadow-black/20",
              )}
            >
                <div className="mb-5 flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-500/25">
                    <BatteryFull className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-lg font-semibold tracking-tight">IPT — Status de Bateria</div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      Planilha oficial SELIMP exportada no dia útil. Informe a data da exportação abaixo (a planilha não traz data embutida). Reimportar no mesmo dia atualiza bateria e comunicação; outro dia gera novas linhas.
                    </p>
                  </div>
                </div>

                <div className="mb-5 rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/90 to-white p-4 shadow-sm dark:border-emerald-700/40 dark:bg-gradient-to-br dark:from-emerald-950/40 dark:to-muted/30">
                  <Label className="mb-3 block text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                    Data da exportação SELIMP
                  </Label>
                  <Select value={String(statusBateriaRefIdx)} onValueChange={(value) => setStatusBateriaRefIdx(Number(value))}>
                    <SelectTrigger className="w-full border border-slate-200/80 bg-white shadow-sm dark:border-border dark:bg-card">
                      <SelectValue placeholder="Selecione a data" />
                    </SelectTrigger>
                    <SelectContent>
                      {statusBateriaReferenceOptions.map((option, idx) => (
                        <SelectItem key={idx} value={String(idx)}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {statusBateriaReferenceOptions[statusBateriaRefIdx]?.value === "personalizado" && (
                    <div className="mt-3">
                      <Label className="mb-1 block text-xs text-emerald-800 dark:text-emerald-300">Data da exportação</Label>
                      <DatePicker
                        value={customStatusBateriaData}
                        onChange={setCustomStatusBateriaData}
                        placeholder="Data da exportação"
                      />
                    </div>
                  )}
                  {(() => {
                    const opt = statusBateriaReferenceOptions[statusBateriaRefIdx];
                    const dataKey =
                      opt?.value === "personalizado" ? customStatusBateriaData : opt?.dataReferencia;
                    if (!dataKey) return null;
                    return (
                      <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                        Será gravado como: {formatPtDate(dataKey)}
                      </div>
                    );
                  })()}
                </div>

                <UploadDropzone
                  inputId="iptStatusBateria"
                  accept=".xlsx"
                  tone="emerald"
                  loading={states.iptStatusBateria.status === "uploading"}
                  helperText="Arquivo 'Status de Bateria.xlsx' da SELIMP. Colunas: Nome, Comunicação, Bateria, Última Comunicação, Status de Bateria, Dias."
                  onFilesSelected={(files) => handleTypedUpload("iptStatusBateria", files)}
                />
                <HistoryBlock
                  title="Último status de bateria importado"
                  overview={overview.iptStatusBateria}
                  expanded={Boolean(expandedHistory.iptStatusBateria)}
                  onToggle={() => toggleHistory("iptStatusBateria")}
                />
                <SummaryBox state={states.iptStatusBateria} />
              </div>

              {/* Histórico Geral de Bateria — descomentar para reativar
              <div
                className={cn(
                  "rounded-2xl border p-6 shadow-sm",
                  "border-amber-200/70 bg-gradient-to-b from-amber-50/60 to-white",
                  "dark:border-amber-800/45 dark:bg-gradient-to-b dark:from-amber-950/35 dark:to-muted/25 dark:shadow-md dark:shadow-black/20",
                )}
              >
                <div className="mb-4 flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800 ring-1 ring-amber-200/80 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-500/25">
                    <FileSpreadsheet className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-semibold tracking-tight">Histórico Geral de Bateria</div>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      Arquivo HISTÓRICO GERAL BATERIA VARRICAO.xlsx — várias datas na coluna A. Reimportar substitui cada dia.
                    </p>
                  </div>
                </div>
                <div className="mb-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-amber-300/80 text-amber-900 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-950/40"
                    onClick={handleClearDadosBateria}
                  >
                    Limpar tabela e reiniciar IDs
                  </Button>
                </div>
                <UploadDropzone
                  inputId="iptHistoricoBateria"
                  accept=".xlsx,.xls"
                  tone="amber"
                  loading={states.iptHistoricoBateria.status === "uploading"}
                  helperText="Arquivo histórico com múltiplas datas em coluna A. Formato: HISTÓRICO GERAL BATERIA VARRICAO.xlsx"
                  onFilesSelected={handleHistoricoBateriaUpload}
                />
                <SummaryBox state={states.iptHistoricoBateria} />
              </div>
              */}
          </SessionAccordionItem>
        </Accordion>
        )}

        {!isIptRestrictedUser ? (
        <Dialog open={cronogramaModalOpen} onOpenChange={setCronogramaModalOpen}>
          <DialogContent
            className={cn(
              "max-h-[90vh] max-w-3xl overflow-y-auto shadow-2xl",
              "border border-slate-200/90 bg-white shadow-slate-900/10",
              "dark:border-border dark:bg-card dark:shadow-black/60",
            )}
          >
            <DialogHeader className="space-y-1 text-left">
              <DialogTitle className="text-xl">Importações de referência IPT</DialogTitle>
              <DialogDescription className="text-xs leading-relaxed">
                Importações anuais ou esporádicas: cronograma por contrato e cadastro de setores com módulos SELIMP e DDMX.
              </DialogDescription>
            </DialogHeader>

            <Accordion
              className="space-y-4"
              transition={{ type: "spring", stiffness: 140, damping: 22 }}
              variants={ACCORDION_VARIANTS}
            >
              <SessionAccordionItem
                value="cronograma"
                accent="slate"
                icon={CalendarDays}
                title="Cronograma do Plano de Trabalho — importação anual"
                subtitle="Envie as DUAS planilhas juntas: “Cronogramas de Serviços Escalonados” (datas) e “Cronogramas de Serviços Fixos” (dias da semana). Substitui o cronograma vigente e remove setores que sumiram."
              >
                <UploadDropzone
                  inputId="iptCronograma"
                  accept=".xlsx"
                  tone="neutral"
                  loading={states.iptCronograma.status === "uploading"}
                  helperText="Selecione os 2 arquivos XLSX (Escalonados + Fixos). O sistema mostra uma pré-visualização antes de gravar."
                  onFilesSelected={handleCronogramaUpload}
                />

                <div className="mt-4 flex items-start gap-3 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 dark:border-border dark:bg-muted/30">
                  <Checkbox
                    id="cronograma-replace-datas"
                    checked={cronogramaReplaceDatas}
                    onCheckedChange={(v) => handleCronogramaReplaceToggle(v === true)}
                    className="mt-0.5"
                  />
                  <Label htmlFor="cronograma-replace-datas" className="cursor-pointer text-xs leading-relaxed font-normal text-muted-foreground">
                    <span className="font-semibold text-foreground">Substituir as datas do setor</span> (em vez de acumular).
                    <br />
                    Por padrão, as datas são <strong>mescladas</strong>: datas novas são adicionadas e as antigas mantidas
                    (nada duplica). Marque esta opção para <strong>apagar as datas antigas</strong> de cada setor e gravar
                    apenas as da planilha — use quando precisar corrigir datas erradas e refletir exatamente o plano vigente.
                  </Label>
                </div>

                <CronogramaPreview
                  report={cronogramaReport}
                  loading={states.iptCronograma.status === "uploading"}
                  onConfirm={handleCronogramaConfirm}
                  onCancel={handleCronogramaCancel}
                />

                <HistoryBlock
                  title="Último cronograma importado"
                  overview={overview.iptCronograma}
                  expanded={Boolean(expandedHistory.iptCronograma)}
                  onToggle={() => toggleHistory("iptCronograma")}
                />
                <SummaryBox state={states.iptCronograma} />
              </SessionAccordionItem>

              <SessionAccordionItem
                value="setores"
                accent="amber"
                icon={MapPin}
                title="Setores e módulos — SELIMP × DDMX"
                subtitle="Catálogo SETORES.xlsx: varrição manual, praças, vínculo de módulos, frequência e KM produtivo. Substitui o cadastro vigente; não altera o histórico já importado em ipt_dados_bateria — próximos uploads de Status Bateria usarão o novo mapeamento."
              >
                <UploadDropzone
                  inputId="iptSetoresModulos"
                  accept=".xlsx"
                  tone="amber"
                  loading={states.iptSetoresModulos.status === "uploading"}
                  helperText="Arquivo SETORES.xlsx (aba SETORES). Substitui setores_modulos e recalcula módulos; ipt_dados_bateria existente não é reescrito."
                  onFilesSelected={handleSetoresModulosUpload}
                />
                <HistoryBlock
                  title="Última importação de setores"
                  overview={overview.iptSetoresModulos}
                  expanded={Boolean(expandedHistory.iptSetoresModulos)}
                  onToggle={() => toggleHistory("iptSetoresModulos")}
                />
                <SummaryBox state={states.iptSetoresModulos} />
              </SessionAccordionItem>
            </Accordion>
          </DialogContent>
        </Dialog>
        ) : null}
      </div>
    </MainLayout>
  );
}
