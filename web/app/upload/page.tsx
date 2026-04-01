"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Settings,
  ShieldAlert,
  Upload,
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

interface UploadOverviewResponse {
  iptReport?: LastUploadInfo;
  iptStatusBateria?: LastUploadInfo;
  iptCronograma?: LastUploadInfo;
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
  const ultimoDiaMesAtual = new Date(anoAtual, mesAtual + 1, 0).getDate();

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

function SummaryBox({ state }: { state: UploadState }) {
  if (state.status === "success" && state.result) {
    return (
      <div className="mt-6 rounded-2xl border-0 bg-emerald-50/90 p-5 text-sm shadow-md shadow-emerald-900/10 ring-1 ring-emerald-500/15 dark:bg-emerald-950/30 dark:shadow-emerald-950/40 dark:ring-emerald-500/20">
        <div className="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          Upload concluido
        </div>
        <div className="mt-4 grid gap-3 text-xs leading-relaxed text-muted-foreground sm:grid-cols-2">
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
          <div className="mt-4 border-t border-emerald-500/20 pt-4 text-xs leading-relaxed text-muted-foreground dark:border-emerald-500/15">
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
          <div className="mt-4 border-t border-emerald-500/20 pt-4 text-xs leading-relaxed text-muted-foreground dark:border-emerald-500/15">
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
      <div className="mt-6 rounded-2xl border-0 bg-red-50/90 p-5 text-sm shadow-md shadow-red-900/10 ring-1 ring-red-500/15 dark:bg-red-950/30 dark:shadow-red-950/40 dark:ring-red-500/20">
        <div className="flex items-start gap-2 text-red-800 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Erro no upload</div>
            <div className="mt-2 text-xs leading-relaxed">{state.error}</div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function HistoryBlock({
  title,
  overview,
  expanded,
  onToggle,
}: {
  title: string;
  overview?: LastUploadInfo;
  expanded: boolean;
  onToggle: () => void;
}) {
  const history = overview?.history ?? [];

  return (
    <div className="mt-6 rounded-2xl border-0 bg-muted/30 p-5 text-xs leading-relaxed text-muted-foreground shadow-sm shadow-black/5 ring-1 ring-black/5 dark:bg-muted/20 dark:shadow-black/30 dark:ring-white/10">
      <div className="text-sm font-semibold tracking-tight text-foreground">{title}</div>
      <div className="mt-4 space-y-2.5">
        <div>Ultima atualizacao: <span className="font-semibold text-foreground">{formatDateTime(overview?.ultimo_import)}</span></div>
        <div>Arquivo: <span className="font-semibold text-foreground">{overview?.source_file || "—"}</span></div>
      {overview?.tipo_detectado_label && (
        <div>Tipo detectado: <span className="font-semibold text-foreground">{overview.tipo_detectado_label}</span></div>
      )}
      {overview?.ultima_referencia && (
        <div>Ultima referencia: <span className="font-semibold text-foreground">{overview.ultima_referencia}</span></div>
      )}
      {overview?.referencia_importada && !overview?.ultima_referencia && (
        <div>Referencia: <span className="font-semibold text-foreground">{overview.referencia_importada}</span></div>
      )}
      <div>Registros atuais: <span className="font-semibold text-foreground">{overview?.total_registros ?? 0}</span></div>
      {overview?.total_encerradas !== undefined && (
        <div>Encerrados acumulados: <span className="font-semibold text-foreground">{overview.total_encerradas ?? 0}</span></div>
      )}
      </div>

      {history.length > 0 && (
        <>
          <Button variant="ghost" type="button" className="mt-5 h-9 px-3 text-xs" onClick={onToggle}>
            {expanded ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}
            {expanded ? "Ocultar historico" : "Mostrar mais"}
          </Button>

          {expanded && (
            <div className="mt-4 space-y-3">
              {history.slice(0, 10).map((entry, index) => (
                <div
                  key={`${entry.created_at}-${entry.source_file}-${index}`}
                  className="rounded-xl border-0 bg-background/80 p-4 shadow-sm shadow-black/5 ring-1 ring-black/5 dark:shadow-black/40 dark:ring-white/10"
                >
                  <div className="font-medium text-foreground">{entry.tipo_label || "Importacao"}</div>
                  <div className="mt-2 space-y-1.5">
                  <div>Data: <span className="text-foreground">{formatDateTime(entry.created_at)}</span></div>
                  <div>Arquivo: <span className="text-foreground">{entry.source_file || "—"}</span></div>
                  <div>Processados: <span className="text-foreground">{entry.processados ?? 0}</span></div>
                  {entry.referencia_importada && (
                    <div>Referencia: <span className="text-foreground">{entry.referencia_importada}</span></div>
                  )}
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
}: {
  inputId: string;
  accept: string;
  loading: boolean;
  helperText: string;
  onFilesSelected: (files: FileList | null) => void;
}) {
  const [dragActive, setDragActive] = useState(false);

  return (
    <div
      className={`rounded-2xl border-0 bg-linear-to-b from-muted/60 to-muted/30 p-8 text-center shadow-md shadow-black/5 ring-1 ring-black/6 transition-all duration-200 dark:from-muted/40 dark:to-muted/15 dark:shadow-black/40 dark:ring-white/10 ${
        dragActive
          ? "scale-[1.01] bg-primary/8 shadow-lg shadow-primary/15 ring-2 ring-primary/25 dark:bg-primary/15"
          : "hover:shadow-lg hover:shadow-black/8 dark:hover:shadow-black/50"
      } ${loading ? "pointer-events-none opacity-70" : ""}`}
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
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-background/90 shadow-inner shadow-black/5 ring-1 ring-black/5 dark:bg-background/50 dark:ring-white/10">
          <FileSpreadsheet className="h-6 w-6 text-primary" />
        </div>
        <div className="mt-5 text-sm font-semibold tracking-tight text-foreground">
          {loading ? "Processando arquivo..." : "Clique ou arraste o arquivo aqui"}
        </div>
        <div className="mt-2 max-w-md mx-auto text-xs leading-relaxed text-muted-foreground">{helperText}</div>
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
        result = await apiService.uploadIptReportXlsx(file, {
          modoReferencia: selectedReference.value === "personalizado" ? "d_minus_1" : selectedReference.value as any,
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
      <div className="space-y-10">
        <div className="rounded-3xl bg-linear-to-br from-indigo-600 via-indigo-700 to-purple-900 p-8 text-white shadow-2xl shadow-indigo-950/40 ring-1 ring-white/10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-5">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-indigo-950/70 shadow-lg shadow-black/25">
                <Upload className="h-8 w-8" strokeWidth={1.8} />
              </div>
              <div>
                <h1 className="text-4xl font-bold tracking-tight">Upload de Dados</h1>
                <p className="mt-4 max-w-3xl text-sm leading-relaxed text-indigo-50/95 sm:text-base">
                  Agora as importacoes principais ficam concentradas por sessao. O sistema detecta o tipo do arquivo,
                  bloqueia arquivos fora da sessao e mantem historico recente das ultimas importacoes.
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-11 w-11 rounded-xl border-0 bg-white/15 text-white shadow-lg shadow-black/20 ring-1 ring-white/20 hover:bg-white/25 hover:text-white"
              title="Cronograma anual"
              onClick={() => setCronogramaModalOpen(true)}
            >
              <Settings className="h-5 w-5" />
              <span className="sr-only">Abrir cronograma</span>
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border-0 bg-amber-50/90 p-5 text-sm text-amber-950 shadow-md shadow-amber-900/10 ring-1 ring-amber-500/20 dark:bg-amber-950/35 dark:text-amber-50 dark:shadow-amber-950/50 dark:ring-amber-500/25">
          <div className="flex items-start gap-4">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 opacity-90" />
            <div>
              <div className="font-semibold tracking-tight">Protecao extra para imports sensiveis</div>
              <div className="mt-2 text-xs leading-relaxed opacity-95">
                `FLIP` aceita apenas CSV e `DDMX` apenas planilhas. O tipo real do arquivo e validado no backend antes da importacao.
                O Report SELIMP e o historico DDMX na secao SELIMP sao opcionais para conferencia ou outros fluxos.
              </div>
            </div>
          </div>
        </div>

        <Accordion type="multiple" defaultValue={["flip", "ddmx", "selimp"]} className="space-y-5">
          <AccordionItem value="flip" className="overflow-hidden rounded-2xl border-0 bg-card px-6 shadow-lg shadow-black/5 ring-1 ring-black/5 dark:shadow-black/40 dark:ring-white/10">
            <AccordionTrigger className="hover:no-underline py-5">
              <div className="text-left">
                <div className="text-base font-semibold tracking-tight">FLIP</div>
                <div className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  Um unico input para SAC, BFS, CNC, Ouvidoria e ACIC. O tipo e detectado pela estrutura do CSV.
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-0 pb-6 pt-0">
              <UploadDropzone
                inputId="flip"
                accept=".csv"
                loading={states.flip.status === "uploading"}
                helperText="Solte aqui qualquer CSV do FLIP. Se vier arquivo fora da sessao, o upload sera bloqueado."
                onFilesSelected={(files) => handleSessionUpload("flip", files)}
              />
              <HistoryBlock
                title="Resumo da sessao FLIP"
                overview={overview.sessions?.flip}
                expanded={Boolean(expandedHistory.flip)}
                onToggle={() => toggleHistory("flip")}
              />
              <SummaryBox state={states.flip} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="ddmx" className="overflow-hidden rounded-2xl border-0 bg-card px-6 shadow-lg shadow-black/5 ring-1 ring-black/5 dark:shadow-black/40 dark:ring-white/10">
            <AccordionTrigger className="hover:no-underline py-5">
              <div className="text-left">
                <div className="text-base font-semibold tracking-tight">DDMX</div>
                <div className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  Um unico input para Historico OS, Varricao e Compactadores. O backend tenta identificar a planilha com seguranca.
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-0 pb-6 pt-0">
              <UploadDropzone
                inputId="ddmx"
                accept=".xlsx,.xls"
                loading={states.ddmx.status === "uploading"}
                helperText="Aceita planilhas XLSX da sessao DDMX. Se a estrutura nao bater, a importacao sera recusada."
                onFilesSelected={(files) => handleSessionUpload("ddmx", files)}
              />
              <HistoryBlock
                title="Resumo da sessao DDMX"
                overview={overview.sessions?.ddmx}
                expanded={Boolean(expandedHistory.ddmx)}
                onToggle={() => toggleHistory("ddmx")}
              />
              <SummaryBox state={states.ddmx} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="selimp" className="overflow-hidden rounded-2xl border-0 bg-card px-6 shadow-lg shadow-black/5 ring-1 ring-black/5 dark:shadow-black/40 dark:ring-white/10">
            <AccordionTrigger className="hover:no-underline py-5">
              <div className="text-left">
                <div className="text-base font-semibold tracking-tight">SELIMP</div>
                <div className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  Mantido em dois inputs separados: `Report` e `Status de Bateria`.
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="grid gap-6 pb-6 pt-0 md:grid-cols-2">
              <div className="rounded-2xl border-0 bg-muted/20 p-6 shadow-md shadow-black/5 ring-1 ring-black/5 dark:bg-muted/10 dark:shadow-black/30 dark:ring-white/10">
                <div className="mb-5">
                  <div className="text-lg font-semibold tracking-tight">IPT - Report SELIMP</div>
                  <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Continua separado por ser o fluxo mais sensivel. A referencia deve ser escolhida antes do envio.
                  </div>
                </div>

                <div className="mb-5 rounded-2xl border-0 bg-fuchsia-50/90 p-4 shadow-sm shadow-fuchsia-900/10 ring-1 ring-fuchsia-500/20 dark:bg-fuchsia-950/25 dark:shadow-fuchsia-950/30 dark:ring-fuchsia-500/25">
                  <Label className="mb-3 block text-sm font-semibold text-fuchsia-900 dark:text-fuchsia-200">
                    Referencia da importacao
                  </Label>
                  <Select value={String(iptRefIdx)} onValueChange={(value) => setIptRefIdx(Number(value))}>
                    <SelectTrigger className="w-full border-0 bg-background/90 shadow-sm ring-1 ring-black/5 dark:bg-background/50 dark:ring-white/10">
                      <SelectValue placeholder="Selecione a referencia" />
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
                          className="w-full rounded-lg border-0 bg-background/90 px-3 py-2 text-sm shadow-sm ring-1 ring-black/5 dark:bg-background/50 dark:ring-white/10"
                          value={customPeriodoInicial}
                          onChange={(e) => setCustomPeriodoInicial(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="mb-1 block text-xs text-fuchsia-800 dark:text-fuchsia-300">Periodo Final</Label>
                        <input
                          type="date"
                          className="w-full rounded-lg border-0 bg-background/90 px-3 py-2 text-sm shadow-sm ring-1 ring-black/5 dark:bg-background/50 dark:ring-white/10"
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
                  loading={states.iptReport.status === "uploading"}
                  helperText="Use somente o report.xlsx da SELIMP."
                  onFilesSelected={(files) => handleTypedUpload("iptReport", files)}
                />
                <HistoryBlock
                  title="Ultimo report importado"
                  overview={overview.iptReport}
                  expanded={Boolean(expandedHistory.iptReport)}
                  onToggle={() => toggleHistory("iptReport")}
                />
                <SummaryBox state={states.iptReport} />
              </div>

              <div className="rounded-2xl border-0 bg-muted/20 p-6 shadow-md shadow-black/5 ring-1 ring-black/5 dark:bg-muted/10 dark:shadow-black/30 dark:ring-white/10">
                <div className="mb-5">
                  <div className="text-lg font-semibold tracking-tight">IPT - Status de Bateria</div>
                  <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Importacao isolada para proteger o fluxo do report.
                  </div>
                </div>

                <UploadDropzone
                  inputId="iptStatusBateria"
                  accept=".xlsx"
                  loading={states.iptStatusBateria.status === "uploading"}
                  helperText="Use somente a planilha Status de Bateria."
                  onFilesSelected={(files) => handleTypedUpload("iptStatusBateria", files)}
                />
                <HistoryBlock
                  title="Ultimo status importado"
                  overview={overview.iptStatusBateria}
                  expanded={Boolean(expandedHistory.iptStatusBateria)}
                  onToggle={() => toggleHistory("iptStatusBateria")}
                />
                <SummaryBox state={states.iptStatusBateria} />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Dialog open={cronogramaModalOpen} onOpenChange={setCronogramaModalOpen}>
          <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto border-0 shadow-2xl shadow-black/20 ring-1 ring-black/5 dark:shadow-black/60 dark:ring-white/10">
            <DialogHeader>
              <DialogTitle>Cronograma - importacao anual</DialogTitle>
              <DialogDescription>
                Fluxo especial para BL, MT, NH, LM e GO. Voce pode importar um ou varios XLSX de uma vez.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-2xl border-0 bg-muted/15 p-6 shadow-inner shadow-black/5 ring-1 ring-black/5 dark:bg-muted/10 dark:ring-white/10">
              <UploadDropzone
                inputId="iptCronograma"
                accept=".xlsx"
                loading={states.iptCronograma.status === "uploading"}
                helperText="Aceita BL.xlsx, MT.xlsx, NH.xlsx, LM.xlsx e GO.xlsx."
                onFilesSelected={handleCronogramaUpload}
              />
              <HistoryBlock
                title="Ultimo cronograma importado"
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
