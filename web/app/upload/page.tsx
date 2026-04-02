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
  LayoutDashboard,
  Settings,
  ShieldAlert,
  Table2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { toast } from "react-toastify";
import { MainLayout } from "@/components/layout/main-layout";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiService } from "@/lib/api";
import { cn } from "@/lib/utils";

type SessionKey = "flip" | "ddmx" | "selimp";
type UploadKey =
  | "flip"
  | "ddmx"
  | "iptReport"
  | "iptStatusBateria"
  | "iptCronograma";
type IptReferenceMode = "d_minus_1" | "fim_de_semana" | "mensal" | "personalizado";

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
  /** Só importação consolidada veículos — explica diferença linhas Excel vs inseridas */
  parse_stats?: {
    linhas_na_planilha?: number;
    linhas_importadas?: number;
    ignoradas_linha_vazia?: number;
    ignoradas_sem_setor?: number;
    ignoradas_sem_data?: number;
  };
  estimativa?: {
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
  iptHistoricoOs?: DdmxTipoSnapshot;
  iptHistoricoOsVarricao?: DdmxTipoSnapshot;
  iptHistoricoOsCompactadores?: DdmxTipoSnapshot;
  sessions?: Record<SessionKey, LastUploadInfo>;
}

interface IptReferenceOption {
  value: IptReferenceMode;
  label: string;
  periodoInicial: string;
  periodoFinal: string;
  mesReferencia?: string;
}

function getErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const apiError = error as UploadApiError;
    return apiError.response?.data?.detail || apiError.message || "Erro desconhecido";
  }
  return "Erro desconhecido";
}

function shiftDays(base: Date, days: number): Date {
  const copy = new Date(base);
  copy.setDate(copy.getDate() + days);
  return copy;
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

function buildIptReferenceOptions(now = new Date()): IptReferenceOption[] {
  const ontem = shiftDays(now, -1);
  const diffToPreviousSunday = now.getDay() === 0 ? 7 : now.getDay();
  const domingoAnterior = shiftDays(now, -diffToPreviousSunday);
  const sextaAnterior = shiftDays(domingoAnterior, -2);

  const dMinus1Key = toDateKey(ontem);
  const sextaKey = toDateKey(sextaAnterior);
  const domingoKey = toDateKey(domingoAnterior);

  const mesAtual = now.getMonth();
  const anoAtual = now.getFullYear();
  const mesAnterior = mesAtual === 0 ? 11 : mesAtual - 1;
  const anoMesAnterior = mesAtual === 0 ? anoAtual - 1 : anoAtual;
  const mesAnteriorStr = `${anoMesAnterior}-${String(mesAnterior + 1).padStart(2, "0")}`;
  const mesAtualStr = `${anoAtual}-${String(mesAtual + 1).padStart(2, "0")}`;
  const ultimoDiaMesAnterior = new Date(anoMesAnterior, mesAnterior + 1, 0).getDate();

  const nomeMesAnterior = new Date(anoMesAnterior, mesAnterior, 1).toLocaleDateString("pt-BR", { month: "long" });
  const nomeMesAtual = new Date(anoAtual, mesAtual, 1).toLocaleDateString("pt-BR", { month: "long" });

  return [
    {
      value: "d_minus_1",
      label: `D-1 (${formatPtDate(dMinus1Key)})`,
      periodoInicial: dMinus1Key,
      periodoFinal: dMinus1Key,
    },
    {
      value: "fim_de_semana",
      label: `Sexta a domingo (${formatPtDate(sextaKey)} a ${formatPtDate(domingoKey)})`,
      periodoInicial: sextaKey,
      periodoFinal: domingoKey,
    },
    {
      value: "mensal",
      label: `Mensal - ${nomeMesAnterior} ${anoMesAnterior}`,
      periodoInicial: `${anoMesAnterior}-${String(mesAnterior + 1).padStart(2, "0")}-01`,
      periodoFinal: `${anoMesAnterior}-${String(mesAnterior + 1).padStart(2, "0")}-${String(ultimoDiaMesAnterior).padStart(2, "0")}`,
      mesReferencia: mesAnteriorStr,
    },
    {
      value: "mensal",
      label: `Mensal - ${nomeMesAtual} ${anoAtual} (ate D-1)`,
      periodoInicial: `${anoAtual}-${String(mesAtual + 1).padStart(2, "0")}-01`,
      periodoFinal: dMinus1Key,
      mesReferencia: mesAtualStr,
    },
    {
      value: "personalizado",
      label: "Personalizado (datas manuais)",
      periodoInicial: "",
      periodoFinal: "",
    },
  ];
}

function createInitialStates(): Record<UploadKey, UploadState> {
  return {
    flip: { status: "idle" },
    ddmx: { status: "idle" },
    iptReport: { status: "idle" },
    iptStatusBateria: { status: "idle" },
    iptCronograma: { status: "idle" },
  };
}

type SessionAccent = "violet" | "sky" | "emerald";

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
      <AccordionTrigger className="rounded-none py-5 hover:no-underline data-[state=open]:border-b data-[state=open]:border-slate-100 dark:data-[state=open]:border-border">
        <div className="flex items-start gap-3.5 text-left">
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", a.icon)}>
            <Icon className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1 pr-2">
            <div className="text-base font-semibold tracking-tight text-foreground">{title}</div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{subtitle}</p>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className={cn("pb-6 pt-1", contentClassName ?? "space-y-0")}>{children}</AccordionContent>
    </AccordionItem>
  );
}

type DropzoneTone = "neutral" | "violet" | "sky" | "fuchsia" | "emerald";

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
};

function SummaryBox({ state }: { state: UploadState }) {
  if (state.status === "success" && state.result) {
    return (
      <div
        className={cn(
          "mt-6 rounded-2xl border p-5 text-sm shadow-sm",
          "border-emerald-200/60 bg-gradient-to-br from-emerald-50/90 via-white to-white",
          "shadow-emerald-900/[0.06] dark:border-emerald-800/50 dark:bg-gradient-to-br dark:from-emerald-950/50 dark:via-card dark:to-card dark:shadow-md dark:shadow-black/30",
        )}
      >
        <div className="flex items-center gap-2.5 font-semibold text-emerald-900 dark:text-emerald-300">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
          </span>
          Upload concluído
        </div>
        <div className="mt-4 grid gap-2.5 text-xs leading-relaxed text-muted-foreground sm:grid-cols-2">
          <div>Processados: <span className="font-semibold text-foreground">{state.result.processados ?? 0}</span></div>
          <div>Total: <span className="font-semibold text-foreground">{state.result.total ?? 0}</span></div>
          <div>Inseridos: <span className="font-semibold text-foreground">{state.result.inseridos ?? 0}</span></div>
          <div>Atualizados: <span className="font-semibold text-foreground">{state.result.atualizados ?? 0}</span></div>
          {state.result.tipo_detectado_label && (
            <div>Tipo detectado: <span className="font-semibold text-foreground">{state.result.tipo_detectado_label}</span></div>
          )}
          {state.result.referencia_importada && (
            <div>Referencia: <span className="font-semibold text-foreground">{state.result.referencia_importada}</span></div>
          )}
          {state.result.ordens_encerradas !== undefined && (
            <div>Encerrados: <span className="font-semibold text-foreground">{state.result.ordens_encerradas}</span></div>
          )}
        </div>
        {state.result.estimativa && (
          <div className="mt-4 border-t border-emerald-200/70 pt-4 text-xs leading-relaxed text-muted-foreground dark:border-emerald-500/15">
            <div className="font-semibold text-emerald-900 dark:text-emerald-200">Estimativa de datas</div>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
              <div>
                Alta confianca:{" "}
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">{state.result.estimativa.alta_confianca ?? 0}</span>
              </div>
              <div>
                Media:{" "}
                <span className="font-semibold text-amber-700 dark:text-amber-400">{state.result.estimativa.media_confianca ?? 0}</span>
              </div>
              <div>
                Baixa:{" "}
                <span className="font-semibold text-red-700 dark:text-red-400">{state.result.estimativa.baixa_confianca ?? 0}</span>
              </div>
            </div>
          </div>
        )}
        {state.result.parse_stats && (
          <div className="mt-4 border-t border-emerald-200/70 pt-4 text-xs leading-relaxed text-muted-foreground dark:border-emerald-500/15">
            <div className="font-semibold text-emerald-900 dark:text-emerald-200">Leitura da planilha (veiculos)</div>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              <div>
                Linhas de dados na aba:{" "}
                <span className="font-semibold text-foreground">{state.result.parse_stats.linhas_na_planilha ?? "—"}</span>
              </div>
              <div>
                Importadas:{" "}
                <span className="font-semibold text-foreground">{state.result.parse_stats.linhas_importadas ?? "—"}</span>
              </div>
              <div>
                Ignoradas (linha vazia):{" "}
                <span className="font-semibold text-foreground">{state.result.parse_stats.ignoradas_linha_vazia ?? 0}</span>
              </div>
              <div>
                Ignoradas (sem setor):{" "}
                <span className="font-semibold text-foreground">{state.result.parse_stats.ignoradas_sem_setor ?? 0}</span>
              </div>
              <div className="sm:col-span-2">
                Ignoradas (data invalida):{" "}
                <span className="font-semibold text-foreground">{state.result.parse_stats.ignoradas_sem_data ?? 0}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        className={cn(
          "mt-6 rounded-2xl border p-5 text-sm shadow-sm",
          "border-red-200/70 bg-gradient-to-br from-red-50/90 via-white to-white shadow-red-900/[0.05]",
          "dark:border-red-900/60 dark:bg-gradient-to-br dark:from-red-950/45 dark:via-card dark:to-card dark:shadow-md dark:shadow-black/30",
        )}
      >
        <div className="flex items-start gap-3 text-red-900 dark:text-red-300">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
            <AlertCircle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="font-semibold">Erro no upload</div>
            <div className="mt-2 text-xs leading-relaxed text-red-900/85 dark:text-red-200/90">{state.error}</div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function DdmxSnapFields({ snap }: { snap?: DdmxTipoSnapshot }) {
  const tem = Boolean(snap?.ultimo_import || snap?.source_file);
  return (
    <dl className="mt-2 space-y-2 text-[11px]">
      <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-2.5 py-2 dark:border-border dark:bg-muted/50">
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Arquivo</dt>
        <dd className="mt-0.5 break-all font-medium text-foreground">{tem ? snap?.source_file || "—" : "—"}</dd>
      </div>
      <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-2.5 py-2 dark:border-border dark:bg-muted/50">
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Atualizado</dt>
        <dd className="mt-0.5 font-medium text-foreground">
          {tem ? formatDateTime(snap?.ultimo_import) : "Ainda não importado"}
        </dd>
      </div>
      <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-2.5 py-2 dark:border-border dark:bg-muted/50">
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Registros na base</dt>
        <dd className="mt-0.5 font-medium tabular-nums text-foreground">{tem ? snap?.total_registros ?? 0 : "—"}</dd>
      </div>
    </dl>
  );
}

function DdmxPorTipoBlock({ overview }: { overview?: UploadOverviewResponse }) {
  const snapVeic = overview?.iptHistoricoOs;
  const snapComp = overview?.iptHistoricoOsCompactadores;
  const snapVarr = overview?.iptHistoricoOsVarricao;

  return (
    <div
      className={cn(
        "mt-6 rounded-2xl border p-5 text-xs leading-relaxed shadow-sm",
        "border-sky-200/55 bg-gradient-to-br from-sky-50/80 via-white to-slate-50/50",
        "shadow-sky-900/[0.04] dark:border-sky-800/45 dark:bg-gradient-to-br dark:from-sky-950/45 dark:via-card dark:to-card dark:text-foreground dark:shadow-md dark:shadow-black/25",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold tracking-tight text-foreground">Última importação por linha DDMX</span>
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800 dark:bg-sky-900/60 dark:text-sky-100">
          DDMX
        </span>
      </div>
      <p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-slate-600 dark:text-muted-foreground">
        Frota geral e compactadores compartilham o mesmo cartão (dois históricos OS distintos na base). Varrição permanece separada — outro layout de planilha.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div
          className={cn(
            "relative overflow-hidden rounded-xl border p-4 shadow-sm",
            "border-slate-200/90 bg-white/90 backdrop-blur-[2px]",
            "dark:border-border dark:bg-muted/40",
          )}
        >
          <div className="absolute left-0 top-0 h-full w-1 rounded-l-xl bg-violet-500" aria-hidden />
          <div className="pl-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-violet-500" aria-hidden />
              <div className="text-sm font-semibold text-foreground">Veículos e compactadores</div>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              Histórico OS da frota em geral e histórico OS de compactação — enviados pela mesma sessão DDMX, armazenados em conjuntos diferentes.
            </p>

            <div className="mt-4 border-t border-slate-100 pt-4 dark:border-border">
              <div className="text-[10px] font-bold uppercase tracking-wide text-violet-800 dark:text-violet-300">Veículos (geral)</div>
              <DdmxSnapFields snap={snapVeic} />
            </div>
            <div className="mt-4 border-t border-slate-100 pt-4 dark:border-border">
              <div className="text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">Compactadores</div>
              <DdmxSnapFields snap={snapComp} />
            </div>
          </div>
        </div>

        <div
          className={cn(
            "relative overflow-hidden rounded-xl border p-4 shadow-sm",
            "border-slate-200/90 bg-white/90 backdrop-blur-[2px]",
            "dark:border-border dark:bg-muted/40",
          )}
        >
          <div className="absolute left-0 top-0 h-full w-1 rounded-l-xl bg-sky-500" aria-hidden />
          <div className="pl-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-hidden />
              <div className="text-sm font-semibold text-foreground">Varrição</div>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Histórico OS específico de varrição.</p>
            <DdmxSnapFields snap={snapVarr} />
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoryStat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-slate-100 bg-white px-3 py-2.5 shadow-[0_1px_0_0_rgba(15,23,42,0.03)]",
        "dark:border-border dark:bg-muted/55 dark:shadow-none",
        className,
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium leading-snug text-foreground">{value}</div>
    </div>
  );
}

function HistoryBlock({
  title,
  overview,
  expanded,
  onToggle,
  hint,
}: {
  title: string;
  overview?: LastUploadInfo;
  expanded: boolean;
  onToggle: () => void;
  /** Texto curto abaixo do título (ex.: explicar que o bloco é só da última fila de upload). */
  hint?: string;
}) {
  const history = overview?.history ?? [];

  const summaryCells: { label: string; value: string; span?: "full" }[] = [
    { label: "Última atualização", value: formatDateTime(overview?.ultimo_import) },
    { label: "Arquivo", value: overview?.source_file || "—", span: "full" },
  ];
  if (overview?.tipo_detectado_label) {
    summaryCells.push({ label: "Tipo detectado", value: overview.tipo_detectado_label, span: "full" });
  }
  if (overview?.ultima_referencia) {
    summaryCells.push({ label: "Última referência", value: overview.ultima_referencia, span: "full" });
  } else if (overview?.referencia_importada) {
    summaryCells.push({ label: "Referência", value: overview.referencia_importada, span: "full" });
  }
  summaryCells.push({ label: "Registros (visão resumida)", value: String(overview?.total_registros ?? 0) });
  if (overview?.total_encerradas !== undefined) {
    summaryCells.push({ label: "Encerrados acumulados", value: String(overview.total_encerradas ?? 0) });
  }

  return (
    <div
      className={cn(
        "mt-6 rounded-2xl border p-5 text-xs leading-relaxed shadow-sm",
        "border-slate-200/80 bg-gradient-to-b from-slate-50/80 to-white",
        "shadow-slate-900/[0.03] dark:border-border dark:bg-gradient-to-b dark:from-card dark:to-muted/30 dark:shadow-md dark:shadow-black/20",
      )}
    >
      <div className="text-sm font-semibold tracking-tight text-foreground">{title}</div>
      {hint ? (
        <p className="mt-2 rounded-lg border border-slate-100 bg-white/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground dark:border-border dark:bg-muted/40">
          {hint}
        </p>
      ) : null}
      <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
        {summaryCells.map((cell) => (
          <HistoryStat
            key={cell.label}
            label={cell.label}
            value={cell.value}
            className={cell.span === "full" ? "sm:col-span-2" : undefined}
          />
        ))}
      </div>

      {history.length > 0 && (
        <>
          <Button
            variant="ghost"
            type="button"
            className="mt-5 h-9 border border-slate-200/80 bg-white px-3 text-xs shadow-sm hover:bg-slate-50 dark:border-border dark:bg-muted/40 dark:hover:bg-muted/70"
            onClick={onToggle}
          >
            {expanded ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}
            {expanded ? "Ocultar histórico" : `Ver histórico (${Math.min(history.length, 10)} recentes)`}
          </Button>

          {expanded && (
            <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 dark:border-border">
              {history.slice(0, 10).map((entry, index) => (
                <div
                  key={`${entry.created_at}-${entry.source_file}-${index}`}
                  className={cn(
                    "rounded-xl border p-4 shadow-sm",
                    "border-slate-200/70 bg-white",
                    "dark:border-border dark:bg-muted/35",
                  )}
                >
                  <div className="text-xs font-semibold text-foreground">{entry.tipo_label || "Importação"}</div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <HistoryStat label="Data" value={formatDateTime(entry.created_at)} />
                    <HistoryStat label="Processados" value={String(entry.processados ?? 0)} />
                    <HistoryStat label="Arquivo" value={entry.source_file || "—"} className="sm:col-span-2" />
                    {entry.referencia_importada ? (
                      <HistoryStat label="Referência" value={entry.referencia_importada} className="sm:col-span-2" />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
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
    <div
      className={cn(
        "rounded-2xl border border-dashed bg-gradient-to-b p-8 text-center shadow-sm transition-all duration-200",
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
          {loading ? "Processando arquivo…" : "Clique ou arraste o arquivo aqui"}
        </div>
        <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-slate-600 dark:text-muted-foreground">{helperText}</p>
        <p className="mt-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Formatos: <span className="font-semibold text-foreground/80">{accept.replace(/\./g, "").replace(/,/g, " · ")}</span>
        </p>
      </label>
    </div>
  );
}

export default function UploadPage() {
  const iptReferenceOptions = useMemo(() => buildIptReferenceOptions(), []);
  const defaultIdx = new Date().getDay() === 1 ? 1 : 0;
  const [states, setStates] = useState<Record<UploadKey, UploadState>>(createInitialStates());
  const [overview, setOverview] = useState<UploadOverviewResponse>({});
  const [iptRefIdx, setIptRefIdx] = useState(defaultIdx);
  const [customPeriodoInicial, setCustomPeriodoInicial] = useState("");
  const [customPeriodoFinal, setCustomPeriodoFinal] = useState("");
  const [cronogramaModalOpen, setCronogramaModalOpen] = useState(false);
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
        const selectedReference = iptReferenceOptions[iptRefIdx] ?? iptReferenceOptions[0];
        const isCustom = selectedReference.value === "personalizado";
        const pi = isCustom ? customPeriodoInicial : selectedReference.periodoInicial;
        const pf = isCustom ? customPeriodoFinal : selectedReference.periodoFinal;
        if (!pi || !pf) {
          setUploadState(key, { status: "error", error: "Informe periodo inicial e final." });
          toast.error("Informe periodo inicial e final.");
          return;
        }
        const modoRef: IptReferenceMode =
          selectedReference.value === "personalizado" ? "d_minus_1" : selectedReference.value;
        result = await apiService.uploadIptReportXlsx(file, {
          modoReferencia: modoRef,
          periodoInicial: pi,
          periodoFinal: pf,
          mesReferencia: selectedReference.mesReferencia,
        });
      } else {
        result = await apiService.uploadIptStatusBateriaXlsx(file);
      }

      setUploadState(key, { status: "success", result });
      toast.success("Upload concluido com sucesso.");
      await loadOverview();
    } catch (error) {
      const message = getErrorMessage(error);
      setUploadState(key, { status: "error", error: message });
      toast.error(message);
    }
  };

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

    setUploadState("iptCronograma", { status: "uploading" });
    try {
      let processados = 0;
      let total = 0;
      let inseridos = 0;
      let atualizados = 0;

      for (const file of list) {
        const result = await apiService.uploadIptCronogramaXlsx(file);
        processados += Number(result?.processados ?? 0);
        total += Number(result?.total ?? 0);
        inseridos += Number(result?.inseridos ?? 0);
        atualizados += Number(result?.atualizados ?? 0);
      }

      setUploadState("iptCronograma", {
        status: "success",
        result: { processados, total, inseridos, atualizados, duplicados: 0, erros: 0 },
      });
      toast.success("Cronograma importado com sucesso.");
      await loadOverview();
    } catch (error) {
      const message = getErrorMessage(error);
      setUploadState("iptCronograma", { status: "error", error: message });
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
                  As importações principais ficam por sessão (FLIP, DDMX, SELIMP). 
                </p>
                <ul className="mt-4 flex flex-wrap gap-2 text-[11px] text-indigo-100/90">
                  <li className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">Detecção automática</li>
                  <li className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">Histórico por sessão</li>
                  <li className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">Referência SELIMP explícita</li>
                </ul>
              </div>
            </div>

            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-11 w-11 shrink-0 rounded-xl border-0 bg-white/15 text-white shadow-lg shadow-black/20 ring-1 ring-white/20 hover:bg-white/25 hover:text-white"
              title="Cronograma anual (BL, MT, NH, LM, GO)"
              onClick={() => setCronogramaModalOpen(true)}
            >
              <Settings className="h-5 w-5" />
              <span className="sr-only">Abrir cronograma</span>
            </Button>
          </div>
        </div>

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

        <Accordion type="multiple" defaultValue={[]} className="space-y-5">
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
              helperText="Exportações do FLIP em CSV (delimitador padrão do sistema). Se o arquivo não for compatível com esta sessão, o upload é recusado."
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
            subtitle="Um envio por vez: o backend detecta veículos (histórico geral), compactadores ou varrição. O resumo abaixo agrupa frota + compactadores num único cartão e deixa varrição à parte."
          >
            <UploadDropzone
              inputId="ddmx"
              accept=".xlsx,.xls"
              tone="sky"
              loading={states.ddmx.status === "uploading"}
              helperText="Planilhas de histórico de OS do DDMX. A detecção usa o layout das abas e colunas — use o modelo habitual de cada operação."
              onFilesSelected={(files) => handleSessionUpload("ddmx", files)}
            />
            <DdmxPorTipoBlock overview={overview} />
            <HistoryBlock
              title="Histórico recente da sessão DDMX"
              hint="Os dados do topo deste quadro são só da última importação enviada (qualquer tipo). Para arquivo, data e volume por linha DDMX (frota, compactadores e varrição), use o bloco resumido acima."
              overview={overview.sessions?.ddmx}
              expanded={Boolean(expandedHistory.ddmx)}
              onToggle={() => toggleHistory("ddmx")}
            />
            <SummaryBox state={states.ddmx} />
          </SessionAccordionItem>

          <SessionAccordionItem
            value="selimp"
            accent="emerald"
            icon={LayoutDashboard}
            title="SELIMP"
            subtitle="Dois canais fixos: relatório de ordens (com período de referência obrigatório) e planilha de status de bateria, para não misturar com o DDMX."
            contentClassName="grid gap-6 pb-6 pt-1 md:grid-cols-2"
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
                    Fluxo mais sensível à referência: escolha o período antes de enviar para evitar sobrescrever ou duplicar leituras.
                  </p>
                </div>
              </div>

              <div className="mb-5 rounded-2xl border border-fuchsia-200/70 bg-gradient-to-br from-fuchsia-50/90 to-white p-4 shadow-sm dark:border-fuchsia-700/40 dark:bg-gradient-to-br dark:from-fuchsia-950/40 dark:to-muted/30">
                  <Label className="mb-3 block text-sm font-semibold text-fuchsia-900 dark:text-fuchsia-200">
                    Referência da importação
                  </Label>
                  <Select value={String(iptRefIdx)} onValueChange={(value) => setIptRefIdx(Number(value))}>
                    <SelectTrigger className="w-full border border-slate-200/80 bg-white shadow-sm dark:border-border dark:bg-card">
                      <SelectValue placeholder="Selecione a referência" />
                    </SelectTrigger>
                    <SelectContent>
                      {iptReferenceOptions.map((option, idx) => (
                        <SelectItem key={idx} value={String(idx)}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {iptReferenceOptions[iptRefIdx]?.value === "personalizado" && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <Label className="mb-1 block text-xs text-fuchsia-800 dark:text-fuchsia-300">Periodo Inicial</Label>
                        <input
                          type="date"
                          className="w-full rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-sm shadow-sm dark:border-border dark:bg-card"
                          value={customPeriodoInicial}
                          onChange={(e) => setCustomPeriodoInicial(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="mb-1 block text-xs text-fuchsia-800 dark:text-fuchsia-300">Periodo Final</Label>
                        <input
                          type="date"
                          className="w-full rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-sm shadow-sm dark:border-border dark:bg-card"
                          value={customPeriodoFinal}
                          onChange={(e) => setCustomPeriodoFinal(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                  {iptReferenceOptions[iptRefIdx]?.periodoInicial && iptReferenceOptions[iptRefIdx]?.value !== "personalizado" && (
                    <div className="mt-2 text-xs text-fuchsia-700 dark:text-fuchsia-400">
                      Periodo: {formatPtDate(iptReferenceOptions[iptRefIdx].periodoInicial)} a {formatPtDate(iptReferenceOptions[iptRefIdx].periodoFinal)}
                    </div>
                  )}
                </div>

                <UploadDropzone
                  inputId="iptReport"
                  accept=".xlsx"
                  tone="fuchsia"
                  loading={states.iptReport.status === "uploading"}
                  helperText="Arquivo oficial do report SELIMP (XLSX). O período selecionado acima define como as linhas serão etiquetadas e substituídas."
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
                    <div className="text-lg font-semibold tracking-tight">IPT — Status de bateria</div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      Canal separado do report: importações não competem com o mesmo período de referência do relatório de ordens.
                    </p>
                  </div>
                </div>

                <UploadDropzone
                  inputId="iptStatusBateria"
                  accept=".xlsx"
                  tone="emerald"
                  loading={states.iptStatusBateria.status === "uploading"}
                  helperText="Planilha dedicada ao acompanhamento de bateria / disponibilidade conforme modelo SELIMP."
                  onFilesSelected={(files) => handleTypedUpload("iptStatusBateria", files)}
                />
                <HistoryBlock
                  title="Último status importado"
                  overview={overview.iptStatusBateria}
                  expanded={Boolean(expandedHistory.iptStatusBateria)}
                  onToggle={() => toggleHistory("iptStatusBateria")}
                />
                <SummaryBox state={states.iptStatusBateria} />
              </div>
          </SessionAccordionItem>
        </Accordion>

        <Dialog open={cronogramaModalOpen} onOpenChange={setCronogramaModalOpen}>
          <DialogContent
            className={cn(
              "max-h-[90vh] max-w-3xl overflow-y-auto shadow-2xl",
              "border border-slate-200/90 bg-white shadow-slate-900/10",
              "dark:border-border dark:bg-card dark:shadow-black/60",
            )}
          >
            <DialogHeader className="space-y-1 text-left">
              <DialogTitle className="text-xl">Cronograma — importação anual</DialogTitle>
              <DialogDescription className="text-xs leading-relaxed">
                Uso para contratos BL, MT, NH, LM e GO. Você pode soltar vários XLSX de uma vez; cada arquivo é processado em sequência.
              </DialogDescription>
            </DialogHeader>

            <div
              className={cn(
                "rounded-2xl border p-6 shadow-inner",
                "border-slate-200/80 bg-gradient-to-b from-slate-50/60 to-white",
                "dark:border-border dark:bg-muted/25 dark:shadow-none",
              )}
            >
              <UploadDropzone
                inputId="iptCronograma"
                accept=".xlsx"
                tone="neutral"
                loading={states.iptCronograma.status === "uploading"}
                helperText="Um ou mais arquivos: BL, MT, NH, LM e GO no formato XLSX de cronograma já utilizado no fluxo IPT."
                onFilesSelected={handleCronogramaUpload}
              />
              <HistoryBlock
                title="Último cronograma importado"
                overview={overview.iptCronograma}
                expanded={Boolean(expandedHistory.iptCronograma)}
                onToggle={() => toggleHistory("iptCronograma")}
              />
              <SummaryBox state={states.iptCronograma} />
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
