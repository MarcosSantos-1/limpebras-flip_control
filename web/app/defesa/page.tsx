"use client";

import { Fragment, useState, useEffect, useMemo, useCallback, useRef } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiService } from "@/lib/api";
import {
  formatFlipDateTimeUtc,
  formatFlipDateTimeUtcCnc,
  formatFlipDateTimeUtcWithWeekday,
} from "@/lib/flip-datetime";
import { uploadFotosToStorage, deleteFotosFromStorage } from "@/lib/firebase-defesa-fotos";
import { defesaStorageKey, firebaseDefesaFolderSegment } from "@/lib/defesa-storage-key";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ptBR } from "date-fns/locale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Search,
  AlertTriangle,
  CheckCircle2,
  FileCheck,
  FileText,
  MapPin,
  Calendar,
  User,
  Building2,
  Hash,
  FileStack,
  Download,
  Loader2,
  ImagePlus,
  X,
  ClipboardPaste,
  Plus,
  ShieldCheck,
  Sparkles,
  Route,
  Info,
  Clock,
} from "lucide-react";
import { getCronogramaTextoParaRelatorioPdf } from "@/lib/defesa-cronograma";

export type StatusDefesa = "Analisar" | "Irregular" | "Contestar";

export interface ItemFiscalizado {
  item: string;
  proatividade: string;
  turno?: string;
  observacoes: string;
}

export interface FotosContestar {
  agente_sub: string[];
  itens_fiscalizados: ItemFiscalizado[];
  nosso_agente: string[];
  justificativa?: string;
  setor_override?: string | null;
  /** Texto base do cronograma (planilha/índice ou editado). Nos serviços de cronograma reduzido, a exibição compacta usa antes | mais próxima | depois. */
  cronograma_override?: string | null;
  frequencia_override?: string | null;
}

/** Retorna o setor efetivo: fotos.setor_override ou o setor do BFS. */
function getSetorParaExibir(
  bfs: { setor_resolvido?: string | null; cnc_detalhes?: { setor?: string }[]; setor?: string } | undefined,
  fotos: { setor_override?: string | null } | undefined
): string {
  const override = fotos?.setor_override;
  if (override !== undefined) return override ?? "Sem Setor";
  return bfs?.setor_resolvido ?? bfs?.cnc_detalhes?.[0]?.setor ?? bfs?.setor ?? "—";
}

function getCronogramaBruto(
  bfs: { cronograma_resolvido?: string | null } | undefined,
  fotos: { cronograma_override?: string | null } | undefined
): string {
  const o = fotos?.cronograma_override;
  if (o !== undefined && o !== null && String(o).trim() !== "") return String(o).trim();
  return bfs?.cronograma_resolvido?.trim() ?? "";
}

function getFrequenciaParaExibir(
  bfs: {
    frequencia_resolvida?: string | null;
    setor_resolvido?: string | null;
    cnc_detalhes?: { setor?: string }[];
    setor?: string;
  } | undefined,
  fotos: { frequencia_override?: string | null; setor_override?: string | null } | undefined
): string {
  const setor = getSetorParaExibir(bfs, fotos);
  if (setor === "Sem Setor" || !setor?.trim()) return "";
  const o = fotos?.frequencia_override;
  if (o !== undefined && o !== null && String(o).trim() !== "") return String(o).trim();
  return bfs?.frequencia_resolvida?.trim() ?? "";
}

/** Cronograma na UI: vazio se Sem Setor; serviços com cronograma reduzido → três papéis `antes | mais próxima | depois` (igual ao PDF). */
function getCronogramaParaExibir(
  bfs: {
    setor_resolvido?: string | null;
    cnc_detalhes?: { setor?: string }[];
    setor?: string;
    cronograma_resolvido?: string | null;
    tipo_servico?: string;
    data_abertura?: string;
  } | undefined,
  fotos: { setor_override?: string | null; cronograma_override?: string | null } | undefined
): string {
  const setor = getSetorParaExibir(bfs, fotos);
  if (setor === "Sem Setor" || !setor?.trim()) return "";
  const raw = getCronogramaBruto(bfs, fotos);
  if (!raw) return "";
  return getCronogramaTextoParaRelatorioPdf(raw, bfs?.tipo_servico, bfs?.data_abertura ?? null);
}

/** True se há algo no rascunho de contestação que não deva ser perdido ao fechar sem salvar. */
function hasContestarDraftContent(d: FotosContestar): boolean {
  if ((d.agente_sub?.length ?? 0) > 0 && d.agente_sub.some((x) => String(x ?? "").trim())) return true;
  if ((d.nosso_agente?.length ?? 0) > 0 && d.nosso_agente.some((x) => String(x ?? "").trim())) return true;
  if ((d.itens_fiscalizados?.length ?? 0) > 0) {
    const temItemPreenchido = d.itens_fiscalizados!.some(
      (row) =>
        String(row.item ?? "").trim() ||
        String(row.proatividade ?? "").trim() ||
        String(row.turno ?? "").trim() ||
        String(row.observacoes ?? "").trim()
    );
    if (temItemPreenchido) return true;
  }
  if (String(d.justificativa ?? "").trim()) return true;
  if (d.setor_override !== undefined) return true;
  if (String(d.cronograma_override ?? "").trim()) return true;
  if (String(d.frequencia_override ?? "").trim()) return true;
  return false;
}

/** Extrai turno do setor (ex: ST10304VJ0060 -> "1" = 1° turno). 1=1° turno, 2=2° turno, 3=3° turno. */
function getTurnoFromSetor(setor: string): string {
  const s = String(setor ?? "").trim().replace(/\s+/g, "");
  if (s.length >= 3) {
    const t = s.charAt(2);
    if (t === "1") return "1° turno";
    if (t === "2") return "2° turno";
    if (t === "3") return "3° turno";
  }
  return "";
}

const STATUS_DEFESA_OPTIONS: {
  value: StatusDefesa;
  label: string;
  color: string;
  btnSelected: string;
  btnOutline: string;
}[] = [
  {
    value: "Analisar",
    label: "Analisar",
    color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    btnSelected: "bg-amber-400 hover:bg-amber-500 text-amber-950 shadow-lg scale-100 hover:scale-[1.02] active:scale-[0.98]",
    btnOutline: "border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-400 hover:bg-amber-100 hover:border-amber-500 dark:hover:bg-amber-900/40 hover:shadow-md active:scale-[0.98]",
  },
  {
    value: "Irregular",
    label: "Irregular",
    color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    btnSelected: "bg-red-500 hover:bg-red-600 text-white shadow-lg scale-100 hover:scale-[1.02] active:scale-[0.98]",
    btnOutline: "border-2 border-red-400 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 hover:bg-red-100 hover:border-red-500 dark:hover:bg-red-900/40 hover:shadow-md active:scale-[0.98]",
  },
  {
    value: "Contestar",
    label: "Contestar",
    color: "bg-green-100 text-green-500 dark:bg-green-900/30 dark:text-green-500 border-green-400/50",
    btnSelected: "bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg scale-100 hover:scale-[1.02] active:scale-[0.98]",
    btnOutline: "border-2 border-emerald-600 bg-emerald-50 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-400 hover:bg-emerald-100 hover:border-emerald-500 dark:hover:bg-emerald-900/50 dark:hover:text-emerald-50 hover:shadow-md active:scale-[0.98]",
  },
];

interface CncDetalhe {
  numero_cnc?: string;
  situacao_cnc?: string;
  data_execucao?: string | null;
  data_sincronizacao?: string | null;
  setor?: string;
  fiscal_contratada?: string;
  responsividade?: string;
  coordenada?: string;
}

/** Defesa/contestação persistida no banco (tabela bfs_defesa_state). */
export interface DefesaTrabalhoPersistido {
  status: StatusDefesa;
  dados: FotosContestar | null;
}

interface BFSDefesa {
  id: string;
  bfs: string;
  subprefeitura: string;
  setor?: string;
  setor_resolvido?: string | null;
  frequencia_resolvida?: string | null;
  cronograma_resolvido?: string | null;
  status: string;
  data_abertura: string;
  endereco?: string;
  tipo_servico?: string;
  fiscal?: string;
  sem_irregularidade?: boolean;
  data_vistoria?: string;
  cnc_detalhes?: CncDetalhe[];
  defesa_trabalho?: DefesaTrabalhoPersistido | null;
}

function getStatusDefesaForRow(b: BFSDefesa): StatusDefesa {
  const s = b.defesa_trabalho?.status;
  if (s === "Irregular" || s === "Contestar" || s === "Analisar") return s;
  return "Analisar";
}

function getFotosDadosForRow(b: BFSDefesa): FotosContestar | undefined {
  const d = b.defesa_trabalho?.dados;
  if (!d || typeof d !== "object") return undefined;
  return d as FotosContestar;
}

function rowMatchesSituacaoCncFilter(b: BFSDefesa, filtro: string): boolean {
  if (filtro === "todas") return true;
  if (filtro === "__sem_cnc__") return (b.cnc_detalhes?.length ?? 0) === 0;
  return (b.cnc_detalhes ?? []).some((c) => (c.situacao_cnc ?? "").trim() === filtro);
}

function FotoInputZone({
  images,
  onChange,
  maxCount,
  label,
  hint,
  single = false,
  landscape = false,
}: {
  images: string[];
  onChange: (imgs: string[]) => void;
  maxCount: number;
  label: string;
  hint?: string;
  single?: boolean;
  landscape?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pasteStatus, setPasteStatus] = useState<"idle" | "success" | "error">("idle");

  const addImage = (dataUrl: string) => {
    if (single) {
      onChange([dataUrl]);
      return;
    }
    if (images.length >= maxCount) return;
    onChange([...images, dataUrl]);
  };

  const removeImage = (idx: number) => onChange(images.filter((_, i) => i !== idx));

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const r = new FileReader();
    r.onload = () => addImage(r.result as string);
    r.readAsDataURL(file);
  };

  const handlePaste = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of ["image/png", "image/jpeg", "image/webp"]) {
          try {
            const blob = await item.getType(type);
            if (blob) {
              const r = new FileReader();
              r.onload = () => addImage(r.result as string);
              r.readAsDataURL(blob);
              setPasteStatus("success");
              setTimeout(() => setPasteStatus("idle"), 1500);
              return;
            }
          } catch { /* try next type */ }
        }
      }
      setPasteStatus("error");
      setTimeout(() => setPasteStatus("idle"), 1500);
    } catch {
      setPasteStatus("error");
      setTimeout(() => setPasteStatus("idle"), 1500);
    }
  };

  return (
    <div className="space-y-3">
      <label className="text-base font-semibold text-foreground">{label}</label>
      {hint && <p className="text-sm text-muted-foreground/90">{hint}</p>}
      <div className={landscape ? "flex flex-col gap-3" : "flex flex-wrap gap-4"}>
        {images.map((img, i) => (
          <div key={i} className={`relative group ${landscape ? "w-full max-w-md" : ""}`}>
            <img
              src={img}
              alt=""
              className={
                landscape
                  ? "w-full aspect-video object-contain rounded-xl border-2 border-emerald-200 dark:border-emerald-800 shadow-sm"
                  : "w-28 h-28 object-cover rounded-xl border-2 border-emerald-200 dark:border-emerald-800 shadow-sm"
              }
            />
            <button
              type="button"
              onClick={() => removeImage(i)}
              className="absolute -top-1.5 -right-1.5 w-7 h-7 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {images.length < maxCount && (
          <div
            className={`${landscape ? "w-full max-w-md aspect-video" : "w-32 h-32"} rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all ${
              isDragging
                ? "border-emerald-500 bg-emerald-100 dark:bg-emerald-900/40 scale-105 shadow-md"
                : "border-muted-foreground/40 hover:border-emerald-400 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/40 hover:shadow-md"
            }`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
          >
            {isDragging ? (
              <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Solte aqui</span>
            ) : (
              <>
                <ImagePlus className="h-8 w-8 text-emerald-500/70 dark:text-emerald-400/70 mb-1" />
                <span className="text-xs text-muted-foreground">Clique ou arraste</span>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
            />
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={handlePaste}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border-2 border-dashed border-emerald-300 dark:border-emerald-700 hover:border-emerald-500 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/50 transition-all"
      >
        <ClipboardPaste className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        Colar foto {pasteStatus === "success" && "✓"} {pasteStatus === "error" && "✗"}
      </button>
    </div>
  );
}

const getCncSituacaoColor = (situacao?: string) => {
  if (!situacao) return "bg-muted text-muted-foreground";
  const s = situacao.toLowerCase();
  if (s.includes("regularizado")) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  if (s.includes("notificado")) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
  if (s.includes("respondido")) return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
  if (s.includes("autuado")) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  return "bg-muted text-muted-foreground";
};

function StatusDefesaButton({
  opt,
  isActive,
  onSelect,
}: {
  opt: (typeof STATUS_DEFESA_OPTIONS)[0];
  isActive: boolean;
  onSelect: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const analisarJaSelecionado = opt.value === "Analisar" && isActive;
  const baseClass =
    "inline-flex items-center justify-center gap-3 px-6 py-4 text-base font-bold rounded-xl transition-all duration-200 min-w-36";
  const cursorClass = analisarJaSelecionado ? "cursor-not-allowed" : "cursor-pointer";
  const activeClass = isActive ? opt.btnSelected : opt.btnOutline;
  const hoverClass =
    !analisarJaSelecionado && !isActive && isHovered
      ? opt.value === "Analisar"
        ? "!bg-amber-100 !border-amber-500 !scale-[1.03] !shadow-lg dark:!bg-amber-900/50"
        : opt.value === "Irregular"
          ? "!bg-red-100 !border-red-500 !scale-[1.03] !shadow-lg dark:!bg-red-900/50"
          : "!bg-emerald-100 !border-emerald-500 !scale-[1.03] !shadow-lg dark:!bg-emerald-900/50"
      : "";
  /** Estado atual já é Analisar: sem hover/scale no selecionado (btnSelected traz hover:bg e hover:scale). */
  const analisarLockedOverrides = analisarJaSelecionado
    ? "opacity-100 shadow-lg !scale-100 hover:!scale-100 hover:!bg-amber-400 active:!scale-100 dark:hover:!bg-amber-400"
    : "";
  return (
    <button
      type="button"
      disabled={analisarJaSelecionado}
      className={`${baseClass} ${cursorClass} ${activeClass} ${hoverClass} ${analisarLockedOverrides}`}
      onClick={onSelect}
      onMouseEnter={() => !analisarJaSelecionado && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {opt.value === "Analisar" && <Search className="h-6 w-6" />}
      {opt.value === "Irregular" && <AlertTriangle className="h-6 w-6" />}
      {opt.value === "Contestar" && <FileCheck className="h-6 w-6" />}
      {opt.label}
    </button>
  );
}

export default function DefesaPage() {
  const [bfss, setBfss] = useState<BFSDefesa[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [selectedBFS, setSelectedBFS] = useState<BFSDefesa | null>(null);
  const [filters, setFilters] = useState(() => {
    const now = new Date();
    return {
      periodo_inicial: format(startOfMonth(now), "yyyy-MM-dd"),
      periodo_final: format(endOfMonth(now), "yyyy-MM-dd"),
      subprefeitura: "todas",
      /** Padrão "todos" para não ocultar linhas em "Irregular" (ex.: CNC Autuado). */
      status_defesa: "todos" as "todos" | "analisar_contestar" | StatusDefesa,
      situacao_cnc: "todas",
      tipo_servico: "todos",
    };
  });
  const [modalRelatorioOpen, setModalRelatorioOpen] = useState(false);
  const [relatorioPeriodo, setRelatorioPeriodo] = useState(() => {
    const now = new Date();
    return {
      periodo_inicial: format(startOfMonth(now), "yyyy-MM-dd"),
      periodo_final: format(endOfMonth(now), "yyyy-MM-dd"),
    };
  });
  const [relatorioContratoNumero, setRelatorioContratoNumero] = useState("");
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [modalContestarOpen, setModalContestarOpen] = useState(false);
  const [contestarBfsId, setContestarBfsId] = useState<string | null>(null);
  const [fotosContestarDraft, setFotosContestarDraft] = useState<FotosContestar>({ agente_sub: [], itens_fiscalizados: [], nosso_agente: [], justificativa: "" });
  const [confirmExcluirFotosOpen, setConfirmExcluirFotosOpen] = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState<StatusDefesa | null>(null);
  const [pendingBfsId, setPendingBfsId] = useState<string | null>(null);
  const [contestarSalvando, setContestarSalvando] = useState(false);
  const [setorPreviewLoading, setSetorPreviewLoading] = useState(false);
  /** Destaque na lista só na sessão atual (some ao recarregar a página). */
  const [recentDefesaHighlightKeys, setRecentDefesaHighlightKeys] = useState<Set<string>>(() => new Set());
  const [confirmFecharContestarOpen, setConfirmFecharContestarOpen] = useState(false);
  const fotosContestarDraftRef = useRef(fotosContestarDraft);
  fotosContestarDraftRef.current = fotosContestarDraft;
  const setorPreviewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setorPreviewSeqRef = useRef(0);

  const contestarRow = useMemo(() => {
    if (!modalContestarOpen) return null;
    if (contestarBfsId) return bfss.find((b) => defesaStorageKey(b) === contestarBfsId) ?? null;
    return selectedBFS;
  }, [modalContestarOpen, contestarBfsId, bfss, selectedBFS]);

  const setorPreviewKey = useMemo(() => {
    if (!modalContestarOpen || !contestarRow) return "";
    const v =
      fotosContestarDraft.setor_override !== undefined
        ? (fotosContestarDraft.setor_override ?? "")
        : (contestarRow.setor_resolvido ?? contestarRow.cnc_detalhes?.[0]?.setor ?? contestarRow.setor ?? "");
    return v.trim();
  }, [modalContestarOpen, contestarRow, fotosContestarDraft.setor_override]);

  useEffect(() => {
    if (!modalContestarOpen || !contestarRow) return;
    if (setorPreviewTimeoutRef.current) clearTimeout(setorPreviewTimeoutRef.current);
    if (!setorPreviewKey || setorPreviewKey === "Sem Setor") {
      setSetorPreviewLoading(false);
      setFotosContestarDraft((p) => {
        if (p.cronograma_override === undefined && p.frequencia_override === undefined) return p;
        return { ...p, cronograma_override: undefined, frequencia_override: undefined };
      });
      return;
    }
    setorPreviewTimeoutRef.current = setTimeout(async () => {
      const seq = ++setorPreviewSeqRef.current;
      setSetorPreviewLoading(true);
      try {
        const data = await apiService.getDefesaSetorPreview({
          setor: setorPreviewKey,
          subprefeitura: contestarRow.subprefeitura,
          tipo_servico: contestarRow.tipo_servico,
        });
        if (seq !== setorPreviewSeqRef.current) return;
        setFotosContestarDraft((p) => ({
          ...p,
          cronograma_override: data.cronograma_resolvido ?? p.cronograma_override,
          frequencia_override: data.frequencia_resolvida ?? p.frequencia_override,
        }));
      } catch (e) {
        console.warn("Preview setor:", e);
      } finally {
        if (seq === setorPreviewSeqRef.current) setSetorPreviewLoading(false);
      }
    }, 450);
    return () => {
      if (setorPreviewTimeoutRef.current) clearTimeout(setorPreviewTimeoutRef.current);
    };
  }, [modalContestarOpen, contestarRow, setorPreviewKey]);

  const parseDateInputLocal = (value?: string) => {
    if (!value) return null;
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const periodoLabel = useMemo(() => {
    if (!filters.periodo_inicial || !filters.periodo_final) return "Período não definido";
    const inicioDate = parseDateInputLocal(filters.periodo_inicial);
    const fimDate = parseDateInputLocal(filters.periodo_final);
    const inicio = inicioDate ? format(inicioDate, "dd/MM/yyyy", { locale: ptBR }) : "--";
    const fim = fimDate ? format(fimDate, "dd/MM/yyyy", { locale: ptBR }) : "--";
    return `${inicio} → ${fim}`;
  }, [filters.periodo_inicial, filters.periodo_final]);

  const tipoServicoOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: string[] = [];
    for (const b of bfss) {
      const ts = (b.tipo_servico || "").trim();
      if (ts && !seen.has(ts)) {
        seen.add(ts);
        opts.push(ts);
      }
    }
    return opts.sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [bfss]);

  const situacaoCncOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: string[] = [];
    for (const b of bfss) {
      for (const c of b.cnc_detalhes ?? []) {
        const s = (c.situacao_cnc ?? "").trim();
        if (s && !seen.has(s)) {
          seen.add(s);
          opts.push(s);
        }
      }
    }
    return opts.sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [bfss]);

  const bfssFiltered = useMemo(() => {
    const porSituacao = bfss.filter((b) => rowMatchesSituacaoCncFilter(b, filters.situacao_cnc));
    const getStatus = (b: BFSDefesa) => getStatusDefesaForRow(b);
    if (filters.status_defesa === "todos") return porSituacao;
    if (filters.status_defesa === "analisar_contestar") {
      const filtered = porSituacao.filter((b) => {
        const s = getStatus(b);
        return s === "Analisar" || s === "Contestar";
      });
      return [...filtered].sort((a, b) => {
        const sa = getStatus(a);
        const sb = getStatus(b);
        if (sa === "Analisar" && sb === "Contestar") return -1;
        if (sa === "Contestar" && sb === "Analisar") return 1;
        return 0;
      });
    }
    return porSituacao.filter((b) => getStatus(b) === filters.status_defesa);
  }, [bfss, filters.status_defesa, filters.situacao_cnc]);

  const totalFiltered = bfssFiltered.length;

  const stats = useMemo(() => {
    const comCnc = bfssFiltered.filter((b) => (b.cnc_detalhes?.length ?? 0) > 0).length;
    return {
      total: totalFiltered,
      comCnc,
      semCnc: totalFiltered - comCnc,
    };
  }, [bfssFiltered, totalFiltered]);

  const statsByStatus = useMemo(() => {
    const byStatus: Record<StatusDefesa, { total: number; comCnc: number; semCnc: number }> = {
      Analisar: { total: 0, comCnc: 0, semCnc: 0 },
      Irregular: { total: 0, comCnc: 0, semCnc: 0 },
      Contestar: { total: 0, comCnc: 0, semCnc: 0 },
    };
    for (const b of bfss) {
      const status = getStatusDefesaForRow(b);
      byStatus[status].total++;
      const hasCnc = (b.cnc_detalhes?.length ?? 0) > 0;
      if (hasCnc) byStatus[status].comCnc++;
      else byStatus[status].semCnc++;
    }
    return byStatus;
  }, [bfss]);

  const getStatusDefesaColor = (status: StatusDefesa) =>
    STATUS_DEFESA_OPTIONS.find((o) => o.value === status)?.color ?? "bg-muted text-muted-foreground";

  useEffect(() => {
    loadBFSs();
  }, [filters.periodo_inicial, filters.periodo_final, filters.subprefeitura, filters.tipo_servico]);

  useEffect(() => {
    setSelectedBFS((cur) => {
      if (!cur) return null;
      const fresh = bfss.find((x) => x.id === cur.id);
      return fresh ?? cur;
    });
  }, [bfss]);

  useEffect(() => {
    if (modalRelatorioOpen) {
      setRelatorioPeriodo({
        periodo_inicial: filters.periodo_inicial,
        periodo_final: filters.periodo_final,
      });
    }
  }, [modalRelatorioOpen, filters.periodo_inicial, filters.periodo_final]);

  const applyDefesaTrabalhoToRow = useCallback((rowId: string, trabalho: DefesaTrabalhoPersistido | null) => {
    setBfss((prev) => prev.map((x) => (x.id === rowId ? { ...x, defesa_trabalho: trabalho } : x)));
    setSelectedBFS((cur) => (cur?.id === rowId ? { ...cur, defesa_trabalho: trabalho } : cur));
  }, []);

  const setStatusDefesaForRow = useCallback(
    async (b: BFSDefesa, status: StatusDefesa, dados?: FotosContestar | null) => {
      const numero = defesaStorageKey(b);
      const prevTrabalho = b.defesa_trabalho ?? null;
      const payloadDados =
        status === "Contestar"
          ? dados !== undefined
            ? dados
            : ((prevTrabalho?.dados as FotosContestar | null) ?? null)
          : null;
      const optimistic: DefesaTrabalhoPersistido = { status, dados: payloadDados };

      applyDefesaTrabalhoToRow(b.id, optimistic);
      try {
        const data = await apiService.updateDefesaBfs(numero, {
          status_defesa: status,
          dados_contestacao: status === "Contestar" ? payloadDados : null,
        });
        const t = data.defesa_trabalho;
        if (t) {
          applyDefesaTrabalhoToRow(b.id, {
            status: t.status as StatusDefesa,
            dados: (t.dados as FotosContestar) ?? null,
          });
        }
        if (status === "Contestar" || status === "Irregular") {
          setRecentDefesaHighlightKeys((prev) => new Set([...prev, defesaStorageKey(b)]));
        }
      } catch (err) {
        console.error(err);
        applyDefesaTrabalhoToRow(b.id, prevTrabalho);
        alert("Não foi possível salvar no servidor. Tente novamente.");
      }
    },
    [applyDefesaTrabalhoToRow]
  );

  const handleStatusClick = useCallback(
    (b: BFSDefesa, newStatus: StatusDefesa) => {
      const k = defesaStorageKey(b);
      const current = getStatusDefesaForRow(b);
      if (newStatus === "Contestar") {
        setContestarBfsId(k);
        const existing = getFotosDadosForRow(b);
        const migrated = existing
          ? {
              agente_sub: existing.agente_sub ?? [],
              itens_fiscalizados: existing.itens_fiscalizados ?? [],
              nosso_agente: existing.nosso_agente ?? [],
              justificativa: existing.justificativa ?? "",
              setor_override: existing.setor_override ?? undefined,
              cronograma_override: existing.cronograma_override ?? undefined,
              frequencia_override: existing.frequencia_override ?? undefined,
            }
          : {
              agente_sub: [],
              itens_fiscalizados: [],
              nosso_agente: [],
              justificativa: "",
              setor_override: undefined,
              cronograma_override: undefined,
              frequencia_override: undefined,
            };
        setFotosContestarDraft(migrated);
        setModalContestarOpen(true);
        return;
      }
      if (current === "Contestar") {
        setPendingBfsId(k);
        setPendingStatusChange(newStatus);
        setConfirmExcluirFotosOpen(true);
        return;
      }
      void setStatusDefesaForRow(b, newStatus, null);
    },
    [setStatusDefesaForRow]
  );

  const confirmStatusChangeAndDeleteFotos = useCallback(async () => {
    const row =
      selectedBFS ??
      (pendingBfsId ? bfss.find((x) => defesaStorageKey(x) === pendingBfsId || x.id === pendingBfsId) : null);
    const storageKey = pendingBfsId ?? (row ? defesaStorageKey(row) : null);
    if (!storageKey || !pendingStatusChange || !row) return;
    const folderKeys = new Set<string>([storageKey, defesaStorageKey(row), row.id]);
    try {
      await deleteFotosFromStorage(...folderKeys);
    } catch (e) {
      console.warn("Erro ao excluir fotos do Firebase:", e);
    }
    await setStatusDefesaForRow(row, pendingStatusChange, null);
    setPendingStatusChange(null);
    setPendingBfsId(null);
    setConfirmExcluirFotosOpen(false);
  }, [selectedBFS, pendingBfsId, pendingStatusChange, bfss, setStatusDefesaForRow]);

  const closeContestarModalAndClear = useCallback(() => {
    setModalContestarOpen(false);
    setConfirmFecharContestarOpen(false);
    setFotosContestarDraft({
      agente_sub: [],
      itens_fiscalizados: [],
      nosso_agente: [],
      justificativa: "",
      setor_override: undefined,
      cronograma_override: undefined,
      frequencia_override: undefined,
    });
    setContestarBfsId(null);
  }, []);

  const requestCloseContestarModal = useCallback(() => {
    if (hasContestarDraftContent(fotosContestarDraftRef.current)) {
      setConfirmFecharContestarOpen(true);
      return;
    }
    closeContestarModalAndClear();
  }, [closeContestarModalAndClear]);

  const handleContestarSalvar = useCallback(async () => {
    const row =
      selectedBFS ??
      (contestarBfsId ? bfss.find((x) => defesaStorageKey(x) === contestarBfsId) : null);
    if (!row) return;
    const folderSeg = firebaseDefesaFolderSegment(row.bfs, row.id);
    setContestarSalvando(true);
    try {
      const fotosComUrls = await uploadFotosToStorage(folderSeg, fotosContestarDraft);
      const dados: FotosContestar = {
        ...fotosComUrls,
        justificativa: fotosContestarDraft.justificativa,
        setor_override: fotosContestarDraft.setor_override ?? undefined,
        cronograma_override: fotosContestarDraft.cronograma_override ?? undefined,
        frequencia_override: fotosContestarDraft.frequencia_override ?? undefined,
      };
      await setStatusDefesaForRow(row, "Contestar", dados);
      closeContestarModalAndClear();
    } catch (err) {
      console.error("Erro ao enviar fotos para o Firebase:", err);
    } finally {
      setContestarSalvando(false);
    }
  }, [selectedBFS, contestarBfsId, bfss, fotosContestarDraft, setStatusDefesaForRow, closeContestarModalAndClear]);

  const loadBFSs = async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};

      if (filters.periodo_inicial) params.periodo_inicial = filters.periodo_inicial;
      if (filters.periodo_final) params.periodo_final = filters.periodo_final;
      if (filters.subprefeitura !== "todas") params.subprefeitura = filters.subprefeitura;
      if (filters.tipo_servico !== "todos") params.tipo_servico = filters.tipo_servico;

      const data = await apiService.getCNCsDefesa(params);
      setBfss(data.items || []);
    } catch (error) {
      console.error("Erro ao carregar BFSs para Defesa:", error);
      setBfss([]);
    } finally {
      setLoading(false);
    }
  };

  const formatStatus = (status?: string) => status || "—";

  const subToBadge: Record<string, { sigla: string; className: string }> = {
    "Santana/Tucuruvi": { sigla: "ST", className: "bg-yellow-500/20 text-yellow-700 dark:bg-yellow-500/30 dark:text-yellow-300 border-yellow-400/50" },
    "Casa Verde/Cachoeirinha": { sigla: "CV", className: "bg-green-500/20 text-green-700 dark:bg-green-500/30 dark:text-green-300 border-green-400/50" },
    "Jaçanã/Tremembé": { sigla: "JT", className: "bg-blue-800/20 text-blue-800 dark:bg-blue-700/30 dark:text-blue-300 border-blue-700/50" },
    "Vila Maria/Vila Guilherme": { sigla: "MG", className: "bg-cyan-500/20 text-cyan-700 dark:bg-cyan-500/30 dark:text-cyan-300 border-cyan-400/50" },
  };
  const getSubBadge = (sub?: string) => {
    if (!sub?.trim()) return { sigla: "—", className: "bg-muted text-muted-foreground" };
    const match = subToBadge[sub.trim()];
    if (match) return match;
    return { sigla: sub.slice(0, 2).toUpperCase(), className: "bg-muted text-muted-foreground" };
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const primaryCnc = (bfs: BFSDefesa) => bfs.cnc_detalhes?.[0];

  const handleDownloadRelatorioPDF = async () => {
    setDownloadLoading(true);
    try {
      const params: Record<string, string> = {
        periodo_inicial: relatorioPeriodo.periodo_inicial,
        periodo_final: relatorioPeriodo.periodo_final,
      };
      const [dataDefesa, dataIndicadores] = await Promise.all([
        apiService.getCNCsDefesa(params),
        apiService.getIndicadoresDetalhes(relatorioPeriodo.periodo_inicial, relatorioPeriodo.periodo_final),
      ]);
      const items = (dataDefesa.items || []) as BFSDefesa[];

      const bfssContestar = items.filter((b) => getStatusDefesaForRow(b) === "Contestar");
      if (bfssContestar.length === 0) {
        alert("Nenhum BFS marcado como 'Contestar' no período selecionado. Marque os BFSs que deseja contestar antes de gerar o PDF.");
        return;
      }

      const fotosMapPorId: Record<string, import("@/lib/pdf-relatorio-contestacao").FotosContestarBfs> = {};
      for (const b of bfssContestar) {
        const f = getFotosDadosForRow(b);
        if (f) fotosMapPorId[b.id] = f;
      }

      const { gerarRelatorioContestacaoPDF } = await import("@/lib/pdf-relatorio-contestacao");
      await gerarRelatorioContestacaoPDF({
        periodoInicial: relatorioPeriodo.periodo_inicial,
        periodoFinal: relatorioPeriodo.periodo_final,
        contratada: "Limpebras Engenharia Ambiental",
        contratoNumero: relatorioContratoNumero || undefined,
        bfssContestar,
        fotosMap: fotosMapPorId,
        ifPorSub: dataIndicadores?.if?.if_por_sub,
        baseUrl: typeof window !== "undefined" ? window.location.origin : undefined,
      });
      setModalRelatorioOpen(false);
    } catch (err) {
      console.error("Erro ao gerar relatório PDF:", err);
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Erro ao gerar PDF: ${msg}\n\nVerifique se os arquivos (logotipo.png, design_capa.png, design_rodape_capafinal.png) estão em public/ e se há BFSs contestados com fotos válidas.`);
    } finally {
      setDownloadLoading(false);
    }
  };

  const handleDownloadRelatorioCSV = async () => {
    setDownloadLoading(true);
    try {
      const params: Record<string, string> = {
        periodo_inicial: relatorioPeriodo.periodo_inicial,
        periodo_final: relatorioPeriodo.periodo_final,
      };
      const data = await apiService.getCNCsDefesa(params);
      const items = (data.items || []) as BFSDefesa[];

      const headers = [
        "BFS",
        "Status Defesa",
        "Setor",
        "Tipo Serviço",
        "Subprefeitura",
        "Data Registro",
        "Endereço",
        "Fiscal",
        "CNCs vinculadas",
        "Situação CNC(s)",
      ];
      const rows = items.map((b) => {
        const statusDefesa = getStatusDefesaForRow(b);
        const cncs = b.cnc_detalhes ?? [];
        const cncsStr = cncs.map((c) => c.numero_cnc).filter(Boolean).join("; ");
        const situacoes = cncs.map((c) => c.situacao_cnc).filter(Boolean).join("; ");
        return [
          b.bfs,
          statusDefesa,
          b.setor_resolvido || b.cnc_detalhes?.[0]?.setor || b.setor || "",
          b.tipo_servico || "",
          b.subprefeitura || "",
          b.data_abertura ? formatFlipDateTimeUtc(b.data_abertura) : "",
          b.endereco || "",
          b.fiscal || "",
          cncsStr,
          situacoes,
        ];
      });

      const csvContent = [headers.join(";"), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))].join("\n");
      const bom = "\uFEFF";
      const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `relatorio_defesa_${relatorioPeriodo.periodo_inicial}_${relatorioPeriodo.periodo_final}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setModalRelatorioOpen(false);
    } catch (err) {
      console.error("Erro ao gerar relatório CSV:", err);
    } finally {
      setDownloadLoading(false);
    }
  };

  return ( 
    <MainLayout>
      <div className="space-y-8">
        <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-violet-600 via-purple-700 to-indigo-900 p-8 shadow-xl shadow-violet-900/35 dark:bg-linear-to-br dark:from-violet-800 dark:via-purple-900 dark:to-indigo-950 dark:shadow-2xl dark:shadow-black/45">
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
            <div
              className="flex h-22 w-22 shrink-0 items-center justify-center rounded-2xl bg-violet-950 shadow-lg dark:bg-violet-950"
              aria-hidden
            >
              <ShieldCheck className="h-11 w-11 text-white" strokeWidth={1.5} />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-4xl font-bold tracking-tight text-white">Defesa / Contestação (IF)</h1>
              <p className="mt-3 max-w-3xl text-lg text-violet-50">
                BFSs escalonados (Com irregularidade). Futura geração de relatórios de contestação.
              </p>
            </div>
          </div>
        </div>

        {/* Total no período - compacto */}
        <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-xl border border-border bg-muted/20 shadow-sm">
          <span className="text-lg font-bold text-lime-600 dark:text-lime-300">Total no período - </span>
          <span className="text-md font-medium text-lime-700 dark:text-lime-400">[ {periodoLabel}  ] - </span>
          <span className="text-2xl font-bold text-lime-600 dark:text-lime-400 tabular-nums">{stats.total}</span>
        </div>

        {/* Estatísticas por Status Defesa */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {STATUS_DEFESA_OPTIONS.map((opt) => {
              const s = statsByStatus[opt.value];
              return (
                <Card
                  key={opt.value}
                  className={`overflow-hidden border-l-4 ${
                    opt.value === "Analisar"
                      ? "border-l-yellow-500"
                      : opt.value === "Irregular"
                        ? "border-l-red-500"
                        : "border-l-green-500"
                  }`}
                >
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className={`text-sm font-semibold ${opt.value === "Analisar" ? "text-yellow-700 dark:text-yellow-400" : opt.value === "Irregular" ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>
                      {opt.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total no período:</span>
                      <span className="font-bold">{s.total}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Com dados CNC:</span>
                      <span className="font-bold text-green-600 dark:text-green-400">{s.comCnc}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Sem CNC importado:</span>
                      <span className="font-bold text-amber-600 dark:text-amber-400">{s.semCnc}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

        {/* Filtros */}
        <Card className="overflow-hidden border-none shadow-sm bg-muted/30">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium flex items-center justify-between flex-wrap gap-3">
              Filtros
              <Button
                onClick={() => setModalRelatorioOpen(true)}
                className="bg-violet-600 text-white shadow-sm hover:bg-violet-700"
              >
                <Download className="h-4 w-4" />
                Gerar relatório
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Período Inicial</Label>
                <DatePicker
                  value={filters.periodo_inicial}
                  onChange={(value) => setFilters({ ...filters, periodo_inicial: value })}
                  placeholder="Selecionar início"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Período Final</Label>
                <DatePicker
                  value={filters.periodo_final}
                  onChange={(value) => setFilters({ ...filters, periodo_final: value })}
                  placeholder="Selecionar fim"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Subprefeitura</Label>
                <Select
                  value={filters.subprefeitura}
                  onValueChange={(value) => setFilters({ ...filters, subprefeitura: value })}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas</SelectItem>
                    <SelectItem value="Casa Verde/Cachoeirinha">Casa Verde/Cachoeirinha</SelectItem>
                    <SelectItem value="Jaçanã/Tremembé">Jaçanã/Tremembé</SelectItem>
                    <SelectItem value="Santana/Tucuruvi">Santana/Tucuruvi</SelectItem>
                    <SelectItem value="Vila Maria/Vila Guilherme">Vila Maria/Vila Guilherme</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Status Defesa</Label>
                <Select
                  value={filters.status_defesa}
                  onValueChange={(value: "todos" | "analisar_contestar" | StatusDefesa) => setFilters({ ...filters, status_defesa: value })}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Filtrar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos (padrão)</SelectItem>
                    <SelectItem value="analisar_contestar">Só Analisar + Contestar</SelectItem>
                    <SelectItem value="Analisar">Analisar</SelectItem>
                    <SelectItem value="Irregular">Irregular</SelectItem>
                    <SelectItem value="Contestar">Contestar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Situação CNC</Label>
                <Select
                  value={filters.situacao_cnc}
                  onValueChange={(value) => setFilters({ ...filters, situacao_cnc: value })}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas</SelectItem>
                    <SelectItem value="__sem_cnc__">Sem CNC importado</SelectItem>
                    {situacaoCncOptions.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.length > 56 ? `${s.slice(0, 53)}…` : s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Tipo de Serviço</Label>
                <Select
                  value={filters.tipo_servico}
                  onValueChange={(value) => setFilters({ ...filters, tipo_servico: value })}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    {tipoServicoOptions.map((ts) => (
                      <SelectItem key={ts} value={ts}>
                        {ts.length > 50 ? `${ts.slice(0, 47)}...` : ts}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Lista */}
        {loading ? (
          <div className="p-12 text-center text-muted-foreground animate-pulse">Carregando...</div>
        ) : bfss.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-2">
            <p className="text-lg font-medium text-foreground">Nenhum BFS escalonado encontrado para o período.</p>
            <p className="text-sm">Verifique se há BFSs &quot;Com irregularidade&quot; (exceto os 4 serviços excluídos) no período.</p>
          </div>
        ) : (
          <Card className="overflow-hidden border border-border shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 text-muted-foreground border-b border-border">
                    <tr>
                      <th className="px-3 py-3" />
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">BFS</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Setor</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Status Defesa</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Situação CNC</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Tipo Serviço</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">SUB</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Data Registro</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {bfssFiltered.map((bfs) => {
                      const cnc = primaryCnc(bfs);
                      const statusDefesa = getStatusDefesaForRow(bfs);
                      const rowKey = defesaStorageKey(bfs);
                      const showRecentPulse =
                        recentDefesaHighlightKeys.has(rowKey) &&
                        (statusDefesa === "Contestar" || statusDefesa === "Irregular");
                      return (
                        <Fragment key={bfs.id}>
                          <tr
                            className="hover:bg-muted/50 transition-colors cursor-pointer"
                            onClick={() => setSelectedBFS(bfs)}
                          >
                            <td className="px-3 py-4">
                              <button
                                className="text-muted-foreground hover:text-foreground"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleExpand(bfs.id);
                                }}
                                aria-label="Expandir"
                              >
                                {expandedIds[bfs.id] ? "▾" : "▸"}
                              </button>
                            </td>
                            <td className="px-6 py-4 font-medium font-mono text-primary">
                              <span className="inline-flex items-center gap-2">
                                {showRecentPulse && (
                                  <span
                                    className="inline-flex shrink-0 text-base animate-bounce motion-reduce:animate-none"
                                    title="Atualizado agora nesta sessão"
                                    aria-hidden
                                  >
                                    {statusDefesa === "Contestar" ? "✅" : "⚠️"}
                                  </span>
                                )}
                                {bfs.bfs}
                              </span>
                            </td>
                            <td className="px-6 py-4 font-medium">
                              {(() => {
                                const setor = getSetorParaExibir(bfs, getFotosDadosForRow(bfs));
                                return setor === "Sem Setor" ? (
                                  <span className="text-red-600 dark:text-red-400 font-semibold">Sem Setor</span>
                                ) : (
                                  setor
                                );
                              })()}
                            </td>
                            <td className="px-6 py-4">
                              <span
                                className={`inline-flex items-center justify-center min-w-20 h-7 px-2.5 text-xs font-semibold rounded-full ${getStatusDefesaColor(statusDefesa)}`}
                              >
                                {statusDefesa}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              {cnc?.situacao_cnc ? (
                                <span
                                  className={`inline-flex items-center justify-center min-w-20 h-7 px-2.5 text-xs font-semibold rounded-full ${getCncSituacaoColor(cnc.situacao_cnc)}`}
                                >
                                  {cnc.situacao_cnc}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-6 py-4 max-w-xs truncate text-muted-foreground" title={bfs.tipo_servico}>
                              {bfs.tipo_servico || "—"}
                            </td>
                            <td className="px-6 py-4">
                              {(() => {
                                const badge = getSubBadge(bfs.subprefeitura);
                                return (
                                  <span
                                    className={`inline-flex items-center justify-center w-7 h-7 text-xs font-bold rounded-full border ${badge.className}`}
                                    title={bfs.subprefeitura || ""}
                                  >
                                    {badge.sigla}
                                  </span>
                                );
                              })()}
                            </td>
                            <td className="px-6 py-4 text-muted-foreground">
                              {bfs.data_abertura
                                ? formatFlipDateTimeUtcWithWeekday(bfs.data_abertura)
                                : "—"}
                            </td>
                          </tr>
                          {expandedIds[bfs.id] && (
                            <tr className="bg-muted/20">
                              <td colSpan={9} className="px-6 py-3 text-xs">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                  <div><strong>BFS:</strong> {bfs.bfs}</div>
                                  <div><strong>Fiscal:</strong> {bfs.fiscal || "—"}</div>
                                  <div><strong>Data Registro:</strong> {bfs.data_abertura ? formatFlipDateTimeUtcWithWeekday(bfs.data_abertura) : "—"}</div>
                                  <div><strong>Data vistoria:</strong> {bfs.data_vistoria ? formatFlipDateTimeUtc(bfs.data_vistoria) : "—"}</div>
                                  <div><strong>Subprefeitura:</strong> {bfs.subprefeitura || "—"}</div>
                                  <div><strong>Setor:</strong>{(() => {
                                    const s = getSetorParaExibir(bfs, getFotosDadosForRow(bfs));
                                    return s === "Sem Setor" ? <span className="text-red-600 dark:text-red-400 font-semibold">Sem Setor</span> : ` ${s}`;
                                  })()}</div>
                                  {(getFrequenciaParaExibir(bfs, getFotosDadosForRow(bfs)) || getCronogramaParaExibir(bfs, getFotosDadosForRow(bfs))) && (
                                    <>
                                      {getFrequenciaParaExibir(bfs, getFotosDadosForRow(bfs)) ? (
                                        <div><strong>Frequência:</strong> {getFrequenciaParaExibir(bfs, getFotosDadosForRow(bfs))}</div>
                                      ) : null}
                                      {getCronogramaParaExibir(bfs, getFotosDadosForRow(bfs)) ? (
                                        <div className="md:col-span-2 rounded-lg border-2 border-violet-400/90 dark:border-violet-500/80 bg-violet-100/95 dark:bg-violet-950/60 px-3 py-2 shadow-sm ring-1 ring-violet-300/50 dark:ring-violet-500/30">
                                          <strong className="text-violet-800 dark:text-violet-200">Cronograma:</strong>{" "}
                                          <span className="text-violet-950 dark:text-violet-50 font-medium">
                                            {getCronogramaParaExibir(bfs, getFotosDadosForRow(bfs))}
                                          </span>
                                        </div>
                                      ) : null}
                                    </>
                                  )}
                                  <div className="md:col-span-3"><strong>Endereço:</strong> {bfs.endereco || "—"}</div>
                                  {(bfs.cnc_detalhes?.length ?? 0) > 0 && (
                                    <div className="md:col-span-3 space-y-3">
                                      <strong>CNCs vinculadas:</strong>
                                      {bfs.cnc_detalhes!.map((c, i) => (
                                        <div
                                          key={i}
                                          className={`pl-3 py-2 border-l-2 border-violet-300 dark:border-violet-700 bg-muted/10 rounded-r ${
                                            i > 0 ? "mt-2 border-t border-t-violet-200 dark:border-t-violet-800 pt-2" : ""
                                          }`}
                                        >
                                          <span>Nº {c.numero_cnc}</span>
                                          {c.situacao_cnc && (
                                            <span className={`ml-2 inline-flex px-1.5 py-0.5 text-xs font-semibold rounded ${getCncSituacaoColor(c.situacao_cnc)}`}>
                                              {c.situacao_cnc}
                                            </span>
                                          )}
                                          <span className="text-muted-foreground ml-2">— Registro CNC: {c.data_sincronizacao ? formatFlipDateTimeUtcCnc(c.data_sincronizacao, bfs.tipo_servico) : "—"} — Finalizado: {c.data_execucao ? formatFlipDateTimeUtcCnc(c.data_execucao, bfs.tipo_servico) : "—"}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Modal de detalhes */}
        <Dialog open={!!selectedBFS} onOpenChange={() => setSelectedBFS(null)}>
          <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto gap-0 p-0 sm:p-0 border-0 shadow-2xl shadow-black/20">
            <div className="p-6 sm:p-8 space-y-6 bg-linear-to-b from-background to-muted/30">
              <DialogHeader className="space-y-2 text-left px-0">
                <DialogTitle className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xl">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-400 shadow-inner">
                    <FileText className="h-6 w-6" />
                  </span>
                  <span className="min-w-0">Detalhes — BFS {selectedBFS?.bfs}</span>
                  {selectedBFS && getStatusDefesaForRow(selectedBFS) === "Contestar" && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/50 bg-emerald-500/12 px-3 py-1.5 text-sm font-bold text-emerald-700 shadow-sm dark:bg-emerald-500/20 dark:text-emerald-300">
                      <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                      Contestado
                    </span>
                  )}
                  {selectedBFS && getStatusDefesaForRow(selectedBFS) === "Irregular" && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/50 bg-red-500/12 px-3 py-1.5 text-sm font-bold text-red-700 shadow-sm dark:bg-red-500/20 dark:text-red-300">
                      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                      Irregular
                    </span>
                  )}
                </DialogTitle>
                <DialogDescription className="text-base">
                  Informações para relatório de Defesa/Contestação
                </DialogDescription>
              </DialogHeader>
            {selectedBFS && (
              <div className="space-y-8">
                {/* Status Defesa - destaque */}
                <div className="rounded-2xl border border-border/80 bg-card p-6 sm:p-8 shadow-lg shadow-black/5 dark:shadow-black/40">
                  <p className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                    <FileStack className="h-4 w-4" />
                    Status para Defesa
                  </p>
                  <div className="flex flex-wrap gap-4">
                    {STATUS_DEFESA_OPTIONS.map((opt) => {
                      const isActive = getStatusDefesaForRow(selectedBFS) === opt.value;
                      return (
                        <StatusDefesaButton
                          key={opt.value}
                          opt={opt}
                          isActive={isActive}
                          onSelect={() => handleStatusClick(selectedBFS, opt.value)}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* BFS Contestado - fotos salvas */}
                {getStatusDefesaForRow(selectedBFS) === "Contestar" && (() => {
                  const fotos = getFotosDadosForRow(selectedBFS);
                  const hasFotos = fotos && (fotos.agente_sub.length > 0 || (fotos.itens_fiscalizados?.length ?? 0) > 0 || fotos.nosso_agente.length > 0);
                  const justificativaTxt = (fotos?.justificativa ?? "").trim();
                  if (!hasFotos && !justificativaTxt) return null;
                  return (
                    <div className="rounded-2xl border-2 border-emerald-500/45 bg-emerald-50/35 dark:bg-emerald-950/25 p-6 sm:p-8 space-y-4 shadow-md shadow-emerald-900/10">
                      <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                        <FileCheck className="h-4 w-4" />
                        BFS Contestado — Fotos anexadas
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {fotos!.agente_sub.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-2">Agente da sub</p>
                            <div className="flex gap-2">
                              {fotos!.agente_sub.map((src, i) => (
                                <img key={i} src={src} alt="" className="w-20 h-20 object-cover rounded-lg border" />
                              ))}
                            </div>
                          </div>
                        )}
                        {(fotos!.itens_fiscalizados?.length ?? 0) > 0 && (
                          <div className="col-span-full">
                            <p className="text-xs font-medium text-muted-foreground mb-2">Itens Fiscalizados</p>
                            <div className="overflow-x-auto rounded-lg border">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="bg-muted/50">
                                    <th className="px-3 py-2 text-left font-semibold">Item</th>
                                    <th className="px-3 py-2 text-left font-semibold">Serviço</th>
                                    <th className="px-3 py-2 text-left font-semibold">Proatividade</th>
                                    <th className="px-3 py-2 text-left font-semibold">Turno</th>
                                    <th className="px-3 py-2 text-left font-semibold">Observações</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {fotos!.itens_fiscalizados!.map((row, i) => (
                                    <tr key={i} className="border-t border-border">
                                      <td className="px-3 py-2">{row.item || "—"}</td>
                                      <td className="px-3 py-2 text-muted-foreground">{selectedBFS?.tipo_servico || "—"}</td>
                                      <td className="px-3 py-2">{row.proatividade || "—"}</td>
                                      <td className="px-3 py-2">{row.turno || "—"}</td>
                                      <td className="px-3 py-2">{row.observacoes || "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                        {fotos!.nosso_agente.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-2">Nosso agente</p>
                            <div className="flex gap-2">
                              {fotos!.nosso_agente.map((src, i) => (
                                <img key={i} src={src} alt="" className="w-20 h-20 object-cover rounded-lg border" />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      {justificativaTxt ? (
                        <div className="rounded-xl border border-emerald-400/40 bg-white/70 dark:bg-emerald-950/40 p-4 sm:p-5 shadow-sm">
                          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200 mb-2">
                            Justificativa técnica
                          </p>
                          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{justificativaTxt}</p>
                        </div>
                      ) : null}
                    </div>
                  );
                })()}

                {/* Dados gerais */}
                <div className="rounded-2xl border border-border/80 bg-card p-6 sm:p-8 shadow-lg shadow-black/5 dark:shadow-black/40">
                  <p className="text-sm font-semibold text-muted-foreground mb-5 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-violet-500" />
                    Dados da BFS
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Hash className="h-3.5 w-3.5" /> Número BFS
                    </label>
                    <p className="text-sm font-mono font-medium">{selectedBFS.bfs}</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5" /> Tipo de Serviço
                    </label>
                    <p className="text-sm">{selectedBFS.tipo_servico || "—"}</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5" /> Fiscal
                    </label>
                    <p className="text-sm">{selectedBFS.fiscal || "—"}</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5" /> Subprefeitura
                    </label>
                    <p className="text-sm">{selectedBFS.subprefeitura || "—"}</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Hash className="h-3.5 w-3.5" /> Setor
                    </label>
                    <p className={`text-sm font-mono ${getSetorParaExibir(selectedBFS, selectedBFS ? getFotosDadosForRow(selectedBFS) : undefined) === "Sem Setor" ? "text-red-600 dark:text-red-400 font-semibold" : ""}`}>
                      {getSetorParaExibir(selectedBFS, selectedBFS ? getFotosDadosForRow(selectedBFS) : undefined)}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" /> Data Registro
                    </label>
                    <p className="text-sm">
                      {selectedBFS.data_abertura
                        ? formatFlipDateTimeUtcWithWeekday(selectedBFS.data_abertura)
                        : "—"}
                    </p>
                  </div>
                  {(getFrequenciaParaExibir(selectedBFS, selectedBFS ? getFotosDadosForRow(selectedBFS) : undefined) || getCronogramaParaExibir(selectedBFS, selectedBFS ? getFotosDadosForRow(selectedBFS) : undefined)) && (
                    <>
                      {getFrequenciaParaExibir(selectedBFS, selectedBFS ? getFotosDadosForRow(selectedBFS) : undefined) ? (
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5" /> Frequência
                          </label>
                          <p className="text-sm leading-relaxed">{getFrequenciaParaExibir(selectedBFS, selectedBFS ? getFotosDadosForRow(selectedBFS) : undefined)}</p>
                        </div>
                      ) : null}
                      {getCronogramaParaExibir(selectedBFS, selectedBFS ? getFotosDadosForRow(selectedBFS) : undefined) ? (
                        <div className="col-span-2 space-y-1.5 md:col-span-3 rounded-lg border-2 border-violet-400/90 dark:border-violet-500/80 bg-violet-100/95 dark:bg-violet-950/60 px-3 py-2.5 shadow-sm ring-1 ring-violet-300/50 dark:ring-violet-500/30">
                          <label className="text-xs font-semibold text-violet-800 dark:text-violet-200 uppercase tracking-wider flex items-center gap-1.5">
                            <Route className="h-3.5 w-3.5 shrink-0" /> Cronograma (referência à data de registro do BFS)
                          </label>
                          <p className="text-sm leading-relaxed text-violet-950 dark:text-violet-50 font-medium">
                            {getCronogramaParaExibir(selectedBFS, selectedBFS ? getFotosDadosForRow(selectedBFS) : undefined)}
                          </p>
                        </div>
                      ) : null}
                    </>
                  )}
                  </div>
                </div>

                <div className="rounded-2xl border border-border/80 bg-muted/15 p-5 sm:p-6 shadow-md">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
                    <MapPin className="h-3.5 w-3.5" /> Endereço
                  </label>
                  <p className="text-sm leading-relaxed">{selectedBFS.endereco || "—"}</p>
                </div>

                {(selectedBFS.cnc_detalhes?.length ?? 0) > 0 && (
                  <div className="space-y-4">
                    <label className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                      <FileStack className="h-4 w-4" />
                      Dados CNC ({selectedBFS.cnc_detalhes!.length} {selectedBFS.cnc_detalhes!.length === 1 ? "CNC" : "CNCs"} vinculada{selectedBFS.cnc_detalhes!.length === 1 ? "" : "s"})
                    </label>
                    <div className="space-y-4">
                      {selectedBFS.cnc_detalhes!.map((c, i) => (
                        <div
                          key={i}
                          className={`rounded-xl border border-border bg-muted/20 p-5 space-y-3 ${
                            i > 0 ? "mt-4 pt-5 border-t-2 border-t-violet-300 dark:border-t-violet-700" : ""
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="font-mono font-semibold text-primary">Nº {c.numero_cnc}</span>
                            {c.situacao_cnc && (
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-full ${getCncSituacaoColor(c.situacao_cnc)}`}
                              >
                                {c.situacao_cnc}
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                            <div>
                              <span className="text-muted-foreground">Setor:</span> {c.setor || "—"}
                            </div>
                            <div>
                              <span className="text-muted-foreground">Registro CNC</span>{" "}
                              {c.data_sincronizacao ? formatFlipDateTimeUtcCnc(c.data_sincronizacao, selectedBFS.tipo_servico) : "—"}
                            </div>
                            <div>
                              <span className="text-muted-foreground">Finalizado</span>{" "}
                              {c.data_execucao ? formatFlipDateTimeUtcCnc(c.data_execucao, selectedBFS.tipo_servico) : "—"}
                            </div>
                            <div>
                              <span className="text-muted-foreground">Fiscal Contratada:</span> {c.fiscal_contratada || "—"}
                            </div>
                            <div>
                              <span className="text-muted-foreground">Responsividade:</span> {c.responsividade || "—"}
                            </div>
                            {c.coordenada && (
                              <div className="col-span-2 md:col-span-3">
                                <span className="text-muted-foreground">Coordenada:</span> <code className="text-xs bg-muted px-1 rounded">{c.coordenada}</code>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Modal Contestar - Fotos */}
        <Dialog
          open={modalContestarOpen}
          onOpenChange={(open) => {
            if (open) {
              setModalContestarOpen(true);
              return;
            }
            if (hasContestarDraftContent(fotosContestarDraftRef.current)) {
              setConfirmFecharContestarOpen(true);
              return;
            }
            closeContestarModalAndClear();
          }}
        >
          <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto gap-0 p-0 sm:p-0 border-0 shadow-2xl shadow-black/20">
            <div className="p-6 sm:p-8 space-y-8 bg-linear-to-b from-background to-muted/25">
            <DialogHeader className="space-y-2 text-left">
              <DialogTitle className="flex items-center gap-3 text-xl">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shadow-inner">
                  <FileCheck className="h-6 w-6" />
                </span>
                <span>
                  Contestar BFS{" "}
                  {contestarBfsId ? bfss.find((b) => defesaStorageKey(b) === contestarBfsId)?.bfs : selectedBFS?.bfs}
                </span>
              </DialogTitle>
              <DialogDescription className="text-base leading-relaxed">
                Preencha as fotos e os itens fiscalizados. Arraste, selecione ou cole imagens (Ctrl+V). Ao informar o setor, o sistema busca frequência e cronograma nas planilhas importadas.
              </DialogDescription>
            </DialogHeader>

              {contestarRow && (
                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="bfs-detalhes-modal" className="rounded-2xl border border-border/80 bg-card shadow-lg shadow-black/5 dark:shadow-black/40 ring-1 ring-border/60">
                    <AccordionTrigger className="hover:no-underline py-4 px-4 sm:px-5 text-left data-[state=open]:border-b border-border/60">
                      <span className="flex items-center gap-3 text-sm font-semibold text-foreground">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/12 text-violet-600 dark:text-violet-400">
                          <Info className="h-4 w-4" />
                        </span>
                        <span className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                          <span>Detalhes da BFS e CNCs</span>
                          <span className="text-xs font-normal text-muted-foreground sm:font-medium">
                            (abrir aqui — sem voltar à lista)
                          </span>
                        </span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-6 text-sm">
                      <div className="rounded-xl border border-border/70 bg-muted/20 p-4 sm:p-5 space-y-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                          <FileText className="h-3.5 w-3.5" />
                          BFS
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                          <div>
                            <span className="text-muted-foreground text-xs block mb-0.5">Número</span>
                            <span className="font-mono font-medium">{contestarRow.bfs}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground text-xs block mb-0.5">Subprefeitura</span>
                            <span>{contestarRow.subprefeitura || "—"}</span>
                          </div>
                          <div className="sm:col-span-2">
                            <span className="text-muted-foreground text-xs block mb-0.5">Tipo de serviço</span>
                            <span>{contestarRow.tipo_servico || "—"}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground text-xs block mb-0.5">Fiscal (BFS)</span>
                            <span>{contestarRow.fiscal || "—"}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground text-xs block mb-0.5">Status</span>
                            <span>{contestarRow.status || "—"}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground text-xs flex items-center gap-1 mb-0.5">
                              <Calendar className="h-3 w-3" /> Data registro (BFS)
                            </span>
                            <span>{formatFlipDateTimeUtcWithWeekday(contestarRow.data_abertura)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground text-xs flex items-center gap-1 mb-0.5">
                              <Clock className="h-3 w-3" /> Data vistoria
                            </span>
                            <span>{formatFlipDateTimeUtc(contestarRow.data_vistoria)}</span>
                          </div>
                          <div className="sm:col-span-2">
                            <span className="text-muted-foreground text-xs flex items-center gap-1 mb-0.5">
                              <MapPin className="h-3 w-3" /> Endereço
                            </span>
                            <span className="leading-relaxed">{contestarRow.endereco || "—"}</span>
                          </div>
                          <div className="sm:col-span-2">
                            <span className="text-muted-foreground text-xs block mb-0.5">Setor (referência)</span>
                            <span className="font-mono text-xs sm:text-sm break-all">
                              {getSetorParaExibir(contestarRow, fotosContestarDraft)}
                            </span>
                          </div>
                          {(getFrequenciaParaExibir(contestarRow, fotosContestarDraft) || getCronogramaParaExibir(contestarRow, fotosContestarDraft)) && (
                            <>
                              {getFrequenciaParaExibir(contestarRow, fotosContestarDraft) ? (
                                <div className="sm:col-span-2">
                                  <span className="text-muted-foreground text-xs block mb-0.5">Frequência</span>
                                  <span className="leading-relaxed">{getFrequenciaParaExibir(contestarRow, fotosContestarDraft)}</span>
                                </div>
                              ) : null}
                              {getCronogramaParaExibir(contestarRow, fotosContestarDraft) ? (
                                <div className="sm:col-span-2 rounded-lg border-2 border-violet-400/90 dark:border-violet-500/80 bg-violet-100/95 dark:bg-violet-950/60 px-3 py-2.5 shadow-sm ring-1 ring-violet-300/50 dark:ring-violet-500/30">
                                  <span className="text-violet-800 dark:text-violet-200 text-xs font-semibold uppercase tracking-wide block mb-0.5">
                                    Cronograma (vs. data de registro)
                                  </span>
                                  <span className="leading-relaxed text-violet-950 dark:text-violet-50 font-medium block">
                                    {getCronogramaParaExibir(contestarRow, fotosContestarDraft)}
                                  </span>
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border border-border/70 bg-card p-4 sm:p-5 space-y-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                          <FileStack className="h-3.5 w-3.5" />
                          CNCs vinculadas
                          {(contestarRow.cnc_detalhes?.length ?? 0) > 0 && (
                            <span className="inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300 text-xs font-bold">
                              {contestarRow.cnc_detalhes!.length}
                            </span>
                          )}
                        </p>
                        {(contestarRow.cnc_detalhes?.length ?? 0) === 0 ? (
                          <p className="text-muted-foreground text-sm py-2">
                            Nenhuma CNC cadastrada para este BFS no período.
                          </p>
                        ) : (
                          <div className="space-y-4">
                            {contestarRow.cnc_detalhes!.map((c, idx) => (
                              <div
                                key={`${c.numero_cnc ?? idx}-${idx}`}
                                className="rounded-lg border border-violet-200/60 dark:border-violet-800/50 bg-violet-50/50 dark:bg-violet-950/20 p-4 space-y-3"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-mono font-semibold text-foreground">CNC {c.numero_cnc ?? "—"}</span>
                                  {c.situacao_cnc && (
                                    <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded ${getCncSituacaoColor(c.situacao_cnc)}`}>
                                      {c.situacao_cnc}
                                    </span>
                                  )}
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
                                  <div>
                                    <span className="text-muted-foreground text-xs block mb-0.5">Registro CNC</span>
                                    <span>{formatFlipDateTimeUtcCnc(c.data_sincronizacao, contestarRow.tipo_servico)}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs block mb-0.5">Finalizado</span>
                                    <span className="font-medium">{formatFlipDateTimeUtcCnc(c.data_execucao, contestarRow.tipo_servico)}</span>
                                  </div>
                                  <div className="sm:col-span-2">
                                    <span className="text-muted-foreground text-xs block mb-0.5">Fiscal (contratada / resposta)</span>
                                    <span>{c.fiscal_contratada || "—"}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs block mb-0.5">Responsividade</span>
                                    <span>{c.responsividade || "—"}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs block mb-0.5">Setor (CNC)</span>
                                    <span className="font-mono text-xs break-all">{c.setor || "—"}</span>
                                  </div>
                                  {c.coordenada && (
                                    <div className="sm:col-span-2">
                                      <span className="text-muted-foreground text-xs block mb-0.5">Coordenada</span>
                                      <code className="text-xs bg-muted/80 px-2 py-1 rounded break-all">{c.coordenada}</code>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}

              <div className="rounded-2xl border border-border/80 bg-card p-5 sm:p-7 shadow-lg shadow-black/5 dark:shadow-black/40">
              <FotoInputZone
                label="Foto da Agente da sub"
                images={fotosContestarDraft.agente_sub}
                onChange={(imgs) => setFotosContestarDraft((p) => ({ ...p, agente_sub: imgs }))}
                maxCount={2}
              />
              </div>
              <div className="rounded-2xl border border-border/80 bg-card p-5 sm:p-7 shadow-lg shadow-black/5 dark:shadow-black/40 space-y-4">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-violet-500" />
                  <label className="text-base font-semibold">Setor no relatório</label>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                  <div className="relative flex-1">
                    <Input
                      value={
                        fotosContestarDraft.setor_override !== undefined
                          ? fotosContestarDraft.setor_override ?? "Sem Setor"
                          : (contestarBfsId
                            ? (() => {
                                const cr = bfss.find((b) => defesaStorageKey(b) === contestarBfsId);
                                return cr?.setor_resolvido ?? cr?.cnc_detalhes?.[0]?.setor ?? cr?.setor ?? "";
                              })()
                            : selectedBFS?.setor_resolvido ?? selectedBFS?.cnc_detalhes?.[0]?.setor ?? selectedBFS?.setor ?? "")
                      }
                      onChange={(e) => setFotosContestarDraft((p) => ({ ...p, setor_override: e.target.value || null }))}
                      placeholder="Ex: CV10302VM0002 ou ST10304VJ0060"
                      className="flex-1 pr-10 h-11"
                    />
                    {setorPreviewLoading && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" title="Buscando cronograma…">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setFotosContestarDraft((p) => ({ ...p, setor_override: "Sem Setor", cronograma_override: undefined, frequencia_override: undefined }))}
                    className="shrink-0 px-4 py-2.5 text-sm font-semibold rounded-xl border-2 border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 shadow-sm"
                  >
                    SEM SETOR
                  </button>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  O setor é exibido no relatório e na tabela. Códigos como <span className="font-mono text-foreground/90">CV…VM…</span> indicam varrição mecanizada; a frequência é lida da nomenclatura (ex.: 0203 = Ter/Qua/Sáb). &quot;Sem Setor&quot; oculta cronograma no PDF.
                </p>
                {(() => {
                  const setorModal = getSetorParaExibir(contestarRow ?? undefined, fotosContestarDraft);
                  if (setorModal === "Sem Setor" || !setorModal?.trim() || setorModal === "—") return null;
                  return (
                  <div className="rounded-xl border-2 border-purple-500/55 bg-purple-50/80 dark:bg-purple-950/40 p-4 sm:p-5 space-y-3 shadow-inner shadow-purple-900/10">
                    <div className="flex items-center gap-2 text-purple-800 dark:text-purple-200">
                      <Route className="h-4 w-4 shrink-0" />
                      <span className="text-sm font-semibold">Frequência e cronograma (relatório)</span>
                      {setorPreviewLoading && <Loader2 className="h-3.5 w-3.5 animate-spin opacity-70" />}
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium uppercase tracking-wide text-purple-700/80 dark:text-purple-300/90">Frequência</p>
                      <p className="text-sm text-purple-950 dark:text-purple-50 leading-relaxed">
                        {getFrequenciaParaExibir(contestarRow ?? undefined, fotosContestarDraft) || "— (ajuste o setor ou aguarde a busca)"}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-purple-700/80 dark:text-purple-300/90">Cronograma (texto base — editável)</p>
                      <textarea
                        value={getCronogramaBruto(contestarRow ?? undefined, fotosContestarDraft)}
                        onChange={(e) =>
                          setFotosContestarDraft((p) => ({ ...p, cronograma_override: e.target.value }))
                        }
                        placeholder="Datas no formato dd/MM/aaaa; separadas por ; conforme a planilha importada"
                        rows={3}
                        className="w-full min-h-[88px] px-3 py-2.5 rounded-lg border border-purple-200/80 dark:border-purple-800 bg-white/90 dark:bg-purple-950/50 text-sm text-purple-950 dark:text-purple-50 resize-y leading-relaxed"
                      />
                    </div>
                    {contestarRow?.data_abertura && getCronogramaBruto(contestarRow, fotosContestarDraft) ? (
                      <div className="pt-1 border-t border-purple-200/60 dark:border-purple-800/80">
                        <p className="text-xs font-medium text-purple-800/90 dark:text-purple-200 mb-1">Como no relatório (referência: data de registro do BFS)</p>
                        <p className="text-sm text-purple-900 dark:text-purple-100 leading-relaxed">
                          {getCronogramaParaExibir(contestarRow, fotosContestarDraft) || "—"}
                        </p>
                      </div>
                    ) : null}
                  </div>
                  );
                })()}
              </div>
              <div className="space-y-3 rounded-2xl border border-border/80 bg-card p-5 sm:p-7 shadow-lg shadow-black/5 dark:shadow-black/40">
                <div className="flex items-center justify-between">
                  <label className="text-base font-semibold text-foreground">Itens Fiscalizados</label>
                  <button
                    type="button"
                    onClick={() => setFotosContestarDraft((p) => ({
                      ...p,
                      itens_fiscalizados: [...(p.itens_fiscalizados ?? []), {
                        item: "",
                        proatividade: "",
                        turno: getTurnoFromSetor(
                          fotosContestarDraft.setor_override !== undefined
                            ? (fotosContestarDraft.setor_override ?? "")
                            : (contestarBfsId
                              ? (() => {
                                  const cr = bfss.find((b) => defesaStorageKey(b) === contestarBfsId);
                                  return cr?.setor_resolvido ?? cr?.cnc_detalhes?.[0]?.setor ?? cr?.setor ?? "";
                                })()
                              : selectedBFS?.setor_resolvido ?? selectedBFS?.cnc_detalhes?.[0]?.setor ?? selectedBFS?.setor ?? "")
                        ) || "",
                        observacoes: "",
                      }],
                    }))}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    Adicionar item
                  </button>
                </div>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/60">
                        <th className="px-3 py-2.5 text-left font-semibold">Item</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Serviço</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Proatividade</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Turno</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Observações</th>
                        <th className="w-10 px-1" />
                      </tr>
                    </thead>
                    <tbody>
                      {(fotosContestarDraft.itens_fiscalizados?.length ?? 0) === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                            Nenhum item. Clique em &quot;Adicionar item&quot; para incluir.
                          </td>
                        </tr>
                      ) : (
                        fotosContestarDraft.itens_fiscalizados!.map((row, i) => (
                          <tr key={i} className="border-t border-border hover:bg-muted/20">
                            <td className="px-3 py-2 align-top">
                              <Input
                                value={row.item}
                                onChange={(e) => setFotosContestarDraft((p) => {
                                  const next = [...(p.itens_fiscalizados ?? [])];
                                  next[i] = { ...next[i], item: e.target.value };
                                  return { ...p, itens_fiscalizados: next };
                                })}
                                placeholder="Ex: Item 1"
                                className="h-8 text-sm"
                              />
                            </td>
                            <td className="px-3 py-2 align-top text-muted-foreground min-w-[180px]">
                              {contestarBfsId
                                ? bfss.find((b) => defesaStorageKey(b) === contestarBfsId)?.tipo_servico ?? "—"
                                : selectedBFS?.tipo_servico ?? "—"}
                            </td>
                            <td className="px-3 py-2 align-top">
                              <Input
                                value={row.proatividade}
                                onChange={(e) => setFotosContestarDraft((p) => {
                                  const next = [...(p.itens_fiscalizados ?? [])];
                                  next[i] = { ...next[i], proatividade: e.target.value };
                                  return { ...p, itens_fiscalizados: next };
                                })}
                                placeholder="Proatividade"
                                className="h-8 text-sm"
                              />
                            </td>
                            <td className="px-3 py-2 align-top">
                              <Input
                                value={row.turno ?? ""}
                                onChange={(e) => setFotosContestarDraft((p) => {
                                  const next = [...(p.itens_fiscalizados ?? [])];
                                  next[i] = { ...next[i], turno: e.target.value };
                                  return { ...p, itens_fiscalizados: next };
                                })}
                                placeholder="1° turno, 2° turno..."
                                className="h-8 text-sm w-28"
                              />
                            </td>
                            <td className="px-3 py-2 align-top">
                              <Input
                                value={row.observacoes ?? ""}
                                onChange={(e) => setFotosContestarDraft((p) => {
                                  const next = [...(p.itens_fiscalizados ?? [])];
                                  next[i] = { ...next[i], observacoes: e.target.value };
                                  return { ...p, itens_fiscalizados: next };
                                })}
                                placeholder="Observações"
                                className="h-8 text-sm"
                              />
                            </td>
                            <td className="px-1 py-2 align-top">
                              <button
                                type="button"
                                onClick={() => setFotosContestarDraft((p) => ({
                                  ...p,
                                  itens_fiscalizados: (p.itens_fiscalizados ?? []).filter((_, idx) => idx !== i),
                                }))}
                                className="p-1.5 rounded-md text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="rounded-2xl border border-border/80 bg-card p-5 sm:p-7 shadow-lg shadow-black/5 dark:shadow-black/40">
                <FotoInputZone
                  label="Foto do Nosso agente (finalização)"
                  images={fotosContestarDraft.nosso_agente}
                  onChange={(imgs) => setFotosContestarDraft((p) => ({ ...p, nosso_agente: imgs }))}
                  maxCount={2}
                />
              </div>
              <div className="rounded-2xl border border-border/80 bg-card p-5 sm:p-7 shadow-lg shadow-black/5 dark:shadow-black/40 space-y-3">
                <label className="text-base font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  Justificativa técnica
                </label>
                <textarea
                  value={fotosContestarDraft.justificativa ?? ""}
                  onChange={(e) => setFotosContestarDraft((p) => ({ ...p, justificativa: e.target.value }))}
                  placeholder="Descreva a justificativa técnica para contestação desta BFS..."
                  className="w-full min-h-[320px] px-3 py-2.5 rounded-lg border border-input bg-background text-sm resize-y leading-relaxed"
                  rows={14}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 sm:px-8 py-4 border-t border-border/80 bg-muted/15">
              <button
                type="button"
                onClick={() => requestCloseContestarModal()}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleContestarSalvar()}
                disabled={contestarSalvando}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {contestarSalvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck className="h-4 w-4" />}
                {contestarSalvando ? "Enviando fotos..." : "Salvar contestação"}
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Rascunho da contestação: fechar sem salvar */}
        <Dialog open={confirmFecharContestarOpen} onOpenChange={setConfirmFecharContestarOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Descartar rascunho da contestação?</DialogTitle>
              <DialogDescription className="text-base leading-relaxed">
                Há fotos, texto ou outros dados preenchidos neste formulário. Se fechar agora, esse rascunho será perdido e você precisará preencher de novo.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3 pt-2">
              <Button
                type="button"
                variant="ghost"
                className="w-full sm:w-auto"
                onClick={() => setConfirmFecharContestarOpen(false)}
              >
                Continuar editando
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="w-full sm:w-auto"
                onClick={() => closeContestarModalAndClear()}
              >
                Excluir rascunho
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Dialog: Confirmar exclusão de fotos */}
        <Dialog open={confirmExcluirFotosOpen} onOpenChange={setConfirmExcluirFotosOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Excluir fotos da contestação?</DialogTitle>
              <DialogDescription>
                Ao alterar o status para {pendingStatusChange === "Irregular" ? "Irregular" : "Analisar"}, as fotos salvas para este BFS serão excluídas permanentemente. Deseja continuar?
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="ghost"
                onClick={() => { setConfirmExcluirFotosOpen(false); setPendingStatusChange(null); }}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={confirmStatusChangeAndDeleteFotos}
              >
                OK, excluir fotos
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Modal Gerar Relatório */}
        <Dialog open={modalRelatorioOpen} onOpenChange={setModalRelatorioOpen}>
          <DialogContent className="max-w-2xl gap-6 p-6 mx-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                Gerar relatório de Defesa
              </DialogTitle>
              <DialogDescription>
                Selecione o período e baixe o relatório em PDF (com capas, tabelas e BFSs contestados) ou em CSV.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-sm text-muted-foreground">Período Inicial</Label>
                  <DatePicker
                    value={relatorioPeriodo.periodo_inicial}
                    onChange={(value) => setRelatorioPeriodo((p) => ({ ...p, periodo_inicial: value }))}
                    placeholder="Selecionar início"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm text-muted-foreground">Período Final</Label>
                  <DatePicker
                    value={relatorioPeriodo.periodo_final}
                    onChange={(value) => setRelatorioPeriodo((p) => ({ ...p, periodo_final: value }))}
                    placeholder="Selecionar fim"
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-3 pt-2">
              <Button
                variant="ghost"
                onClick={() => setModalRelatorioOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                variant="outline"
                onClick={handleDownloadRelatorioCSV}
                disabled={downloadLoading}
                className="border-violet-400/50 bg-violet-500/10 text-violet-700 hover:bg-violet-500/20 dark:text-violet-300"
              >
                Baixar CSV
              </Button>
              <Button
                onClick={handleDownloadRelatorioPDF}
                disabled={downloadLoading}
                className="bg-violet-600 text-white hover:bg-violet-700"
              >
                {downloadLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Gerando PDF...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Baixar PDF
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
