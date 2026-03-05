"use client";

import { Fragment, useState, useEffect, useMemo, useCallback, useRef } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiService } from "@/lib/api";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Search,
  AlertTriangle,
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
} from "lucide-react";

const STATUS_DEFESA_KEY = "flip_defesa_status";
const FOTOS_DEFESA_KEY = "flip_defesa_fotos";

export type StatusDefesa = "Analisar" | "Irregular" | "Contestar";

export interface FotosContestar {
  agente_sub: string[];
  rastreamento: string[];
  nosso_agente: string[];
}

function getFotosStorage(): Record<string, FotosContestar> {
  if (typeof window === "undefined") return {};
  try {
    const s = localStorage.getItem(FOTOS_DEFESA_KEY);
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

function setFotosStorage(bfsId: string, fotos: FotosContestar) {
  const map = getFotosStorage();
  map[bfsId] = fotos;
  localStorage.setItem(FOTOS_DEFESA_KEY, JSON.stringify(map));
}

function removeFotosStorage(bfsId: string) {
  const map = getFotosStorage();
  delete map[bfsId];
  localStorage.setItem(FOTOS_DEFESA_KEY, JSON.stringify(map));
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

function getStatusDefesaStorage(): Record<string, StatusDefesa> {
  if (typeof window === "undefined") return {};
  try {
    const s = localStorage.getItem(STATUS_DEFESA_KEY);
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

function setStatusDefesaStorage(bfsId: string, status: StatusDefesa) {
  const map = getStatusDefesaStorage();
  map[bfsId] = status;
  localStorage.setItem(STATUS_DEFESA_KEY, JSON.stringify(map));
}

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
}

function FotoInputZone({
  images,
  onChange,
  maxCount,
  label,
  hint,
  single = false,
}: {
  images: string[];
  onChange: (imgs: string[]) => void;
  maxCount: number;
  label: string;
  hint?: string;
  single?: boolean;
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
    <div className="space-y-2">
      <label className="text-sm font-semibold">{label}</label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="flex flex-wrap gap-3">
        {images.map((img, i) => (
          <div key={i} className="relative group">
            <img src={img} alt="" className="w-24 h-24 object-cover rounded-lg border-2 border-border" />
            <button
              type="button"
              onClick={() => removeImage(i)}
              className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        {images.length < maxCount && (
          <div
            className={`w-28 h-28 rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all ${
              isDragging
                ? "border-violet-500 bg-violet-100 dark:bg-violet-900/40 scale-105"
                : "border-muted-foreground/40 hover:border-violet-400 hover:bg-violet-50/50 dark:hover:bg-violet-950/30"
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
              <span className="text-xs font-medium text-violet-600 dark:text-violet-400">Solte aqui</span>
            ) : (
              <>
                <ImagePlus className="h-7 w-7 text-muted-foreground mb-1" />
                <span className="text-[10px] text-muted-foreground">Clique ou arraste</span>
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
        className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded border border-dashed border-muted-foreground/50 hover:border-violet-400 hover:bg-muted/30 transition-colors"
      >
        <ClipboardPaste className="h-3.5 w-3.5" />
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
      status_defesa: "analisar_contestar" as "todos" | "analisar_contestar" | StatusDefesa,
      tipo_servico: "todos",
    };
  });
  const [statusDefesaMap, setStatusDefesaMap] = useState<Record<string, StatusDefesa>>({});
  const [modalRelatorioOpen, setModalRelatorioOpen] = useState(false);
  const [relatorioPeriodo, setRelatorioPeriodo] = useState(() => {
    const now = new Date();
    return {
      periodo_inicial: format(startOfMonth(now), "yyyy-MM-dd"),
      periodo_final: format(endOfMonth(now), "yyyy-MM-dd"),
    };
  });
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [modalContestarOpen, setModalContestarOpen] = useState(false);
  const [contestarBfsId, setContestarBfsId] = useState<string | null>(null);
  const [fotosContestarDraft, setFotosContestarDraft] = useState<FotosContestar>({ agente_sub: [], rastreamento: [], nosso_agente: [] });
  const [confirmExcluirFotosOpen, setConfirmExcluirFotosOpen] = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState<StatusDefesa | null>(null);
  const [pendingBfsId, setPendingBfsId] = useState<string | null>(null);

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

  const bfssFiltered = useMemo(() => {
    const getStatus = (b: BFSDefesa) => statusDefesaMap[b.id] ?? "Analisar";
    if (filters.status_defesa === "todos") return bfss;
    if (filters.status_defesa === "analisar_contestar") {
      const filtered = bfss.filter((b) => {
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
    return bfss.filter((b) => getStatus(b) === filters.status_defesa);
  }, [bfss, filters.status_defesa, statusDefesaMap]);

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
      const status = statusDefesaMap[b.id] ?? "Analisar";
      byStatus[status].total++;
      const hasCnc = (b.cnc_detalhes?.length ?? 0) > 0;
      if (hasCnc) byStatus[status].comCnc++;
      else byStatus[status].semCnc++;
    }
    return byStatus;
  }, [bfss, statusDefesaMap]);

  const getStatusDefesaColor = (status: StatusDefesa) =>
    STATUS_DEFESA_OPTIONS.find((o) => o.value === status)?.color ?? "bg-muted text-muted-foreground";

  useEffect(() => {
    setStatusDefesaMap(getStatusDefesaStorage());
  }, []);

  useEffect(() => {
    loadBFSs();
  }, [filters]);

  useEffect(() => {
    if (modalRelatorioOpen) {
      setRelatorioPeriodo({
        periodo_inicial: filters.periodo_inicial,
        periodo_final: filters.periodo_final,
      });
    }
  }, [modalRelatorioOpen, filters.periodo_inicial, filters.periodo_final]);

  const getStatusDefesa = useCallback((bfsId: string): StatusDefesa => {
    return statusDefesaMap[bfsId] ?? "Analisar";
  }, [statusDefesaMap]);

  const setStatusDefesa = useCallback((bfsId: string, status: StatusDefesa) => {
    setStatusDefesaStorage(bfsId, status);
    setStatusDefesaMap((prev) => ({ ...prev, [bfsId]: status }));
    setSelectedBFS((current) => (current && current.id === bfsId ? { ...current } : current));
  }, []);

  const getFotosForBfs = useCallback((bfsId: string) => getFotosStorage()[bfsId], []);

  const handleStatusClick = useCallback((bfsId: string, newStatus: StatusDefesa) => {
    const current = getStatusDefesa(bfsId);
    if (newStatus === "Contestar") {
      setContestarBfsId(bfsId);
      const existing = getFotosForBfs(bfsId);
      setFotosContestarDraft(existing ?? { agente_sub: [], rastreamento: [], nosso_agente: [] });
      setModalContestarOpen(true);
      return;
    }
    if (current === "Contestar") {
      setPendingBfsId(bfsId);
      setPendingStatusChange(newStatus);
      setConfirmExcluirFotosOpen(true);
      return;
    }
    setStatusDefesa(bfsId, newStatus);
  }, [getStatusDefesa, getFotosForBfs]);

  const confirmStatusChangeAndDeleteFotos = useCallback(() => {
    const bfsId = pendingBfsId ?? selectedBFS?.id;
    if (!bfsId || !pendingStatusChange) return;
    removeFotosStorage(bfsId);
    setStatusDefesa(bfsId, pendingStatusChange);
    setPendingStatusChange(null);
    setPendingBfsId(null);
    setConfirmExcluirFotosOpen(false);
  }, [selectedBFS, pendingBfsId, pendingStatusChange, setStatusDefesa]);

  const handleContestarSalvar = useCallback(() => {
    const bfsId = contestarBfsId ?? selectedBFS?.id;
    if (!bfsId) return;
    setFotosStorage(bfsId, fotosContestarDraft);
    setStatusDefesa(bfsId, "Contestar");
    setModalContestarOpen(false);
    setContestarBfsId(null);
    setFotosContestarDraft({ agente_sub: [], rastreamento: [], nosso_agente: [] });
  }, [selectedBFS, contestarBfsId, fotosContestarDraft, setStatusDefesa]);

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

  const handleDownloadRelatorio = async () => {
    setDownloadLoading(true);
    try {
      const params: Record<string, string> = {
        periodo_inicial: relatorioPeriodo.periodo_inicial,
        periodo_final: relatorioPeriodo.periodo_final,
      };
      const data = await apiService.getCNCsDefesa(params);
      const items = (data.items || []) as BFSDefesa[];
      const storage = getStatusDefesaStorage();

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
        const statusDefesa = storage[b.id] ?? "Analisar";
        const cncs = b.cnc_detalhes ?? [];
        const cncsStr = cncs.map((c) => c.numero_cnc).filter(Boolean).join("; ");
        const situacoes = cncs.map((c) => c.situacao_cnc).filter(Boolean).join("; ");
        return [
          b.bfs,
          statusDefesa,
          b.setor_resolvido || b.cnc_detalhes?.[0]?.setor || b.setor || "",
          b.tipo_servico || "",
          b.subprefeitura || "",
          b.data_abertura ? format(new Date(b.data_abertura), "dd/MM/yyyy HH:mm") : "",
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
      console.error("Erro ao gerar relatório:", err);
    } finally {
      setDownloadLoading(false);
    }
  };

  return ( 
    <MainLayout>
      <div className="space-y-8">
        <div className="relative overflow-hidden rounded-xl bg-linear-to-r from-violet-600/10 via-violet-600/5 to-transparent p-8 border border-violet-200/50 dark:border-violet-800/50">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-violet-600/10 rounded-full blur-3xl" />
          <div className="relative">
            <h1 className="text-4xl font-bold tracking-tight bg-linear-to-r from-violet-600 to-purple-500 bg-clip-text text-transparent pb-2">
              Defesa / Contestação
            </h1>
            <p className="text-muted-foreground mt-2 text-lg max-w-3xl">
              BFSs escalonados (Com irregularidade). Futura geração de relatórios de contestação.
            </p>
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
              <button
                type="button"
                onClick={() => setModalRelatorioOpen(true)}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-lg bg-violet-600 hover:bg-violet-700 text-white transition-colors shadow-sm"
              >
                <Download className="h-4 w-4" />
                Gerar relatório
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Período Inicial</label>
                <Input
                  type="date"
                  value={filters.periodo_inicial}
                  onChange={(e) => setFilters({ ...filters, periodo_inicial: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Período Final</label>
                <Input
                  type="date"
                  value={filters.periodo_final}
                  onChange={(e) => setFilters({ ...filters, periodo_final: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Subprefeitura</label>
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
                <label className="text-xs font-medium text-muted-foreground">Status Defesa</label>
                <Select
                  value={filters.status_defesa}
                  onValueChange={(value: "todos" | "analisar_contestar" | StatusDefesa) => setFilters({ ...filters, status_defesa: value })}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Filtrar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="analisar_contestar">Analisar + Contestar (padrão)</SelectItem>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="Analisar">Analisar</SelectItem>
                    <SelectItem value="Irregular">Irregular</SelectItem>
                    <SelectItem value="Contestar">Contestar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Tipo de Serviço</label>
                <Select
                  value={filters.tipo_servico}
                  onValueChange={(value) => setFilters({ ...filters, tipo_servico: value })}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="Varrição manual">Varrição manual</SelectItem>
                    <SelectItem value="Varrição mecanizada">Varrição mecanizada</SelectItem>
                    <SelectItem value="Lavagem">Lavagem</SelectItem>
                    <SelectItem value="Mutirão">Mutirão</SelectItem>
                    <SelectItem value="Bueiros">Bueiros</SelectItem>
                    <SelectItem value="Cata-Bagulho">Cata-Bagulho</SelectItem>
                    <SelectItem value="Ecoponto">Ecoponto</SelectItem>
                    <SelectItem value="PEV">PEV</SelectItem>
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
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Tipo Serviço</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">SUB</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Data Registro</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {bfssFiltered.map((bfs) => {
                      const cnc = primaryCnc(bfs);
                      const statusDefesa = getStatusDefesa(bfs.id);
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
                            <td className="px-6 py-4 font-medium font-mono text-primary">{bfs.bfs}</td>
                            <td className="px-6 py-4 font-medium">{bfs.setor_resolvido || cnc?.setor || bfs.setor || "—"}</td>
                            <td className="px-6 py-4">
                              <span
                                className={`inline-flex items-center justify-center min-w-20 h-7 px-2.5 text-xs font-semibold rounded-full ${getStatusDefesaColor(statusDefesa)}`}
                              >
                                {statusDefesa}
                              </span>
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
                                ? format(new Date(bfs.data_abertura), "dd/MM/yyyy HH:mm")
                                : "—"}
                            </td>
                          </tr>
                          {expandedIds[bfs.id] && (
                            <tr className="bg-muted/20">
                              <td colSpan={8} className="px-6 py-3 text-xs">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                  <div><strong>BFS:</strong> {bfs.bfs}</div>
                                  <div><strong>Fiscal:</strong> {bfs.fiscal || "—"}</div>
                                  <div><strong>Data Registro:</strong> {bfs.data_abertura ? format(new Date(bfs.data_abertura), "dd/MM/yyyy HH:mm") : "—"}</div>
                                  <div><strong>Data vistoria:</strong> {bfs.data_vistoria ? format(new Date(bfs.data_vistoria), "dd/MM/yyyy HH:mm") : "—"}</div>
                                  <div><strong>Subprefeitura:</strong> {bfs.subprefeitura || "—"}</div>
                                  <div><strong>Setor:</strong> {bfs.setor_resolvido || cnc?.setor || bfs.setor || "—"}</div>
                                  {(bfs.frequencia_resolvida || bfs.cronograma_resolvido) && (
                                    <>
                                      <div><strong>Frequência:</strong> {bfs.frequencia_resolvida || "—"}</div>
                                      <div className="md:col-span-2"><strong>Cronograma:</strong> {bfs.cronograma_resolvido || "—"}</div>
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
                                          <span className="text-muted-foreground ml-2">— Registro: {c.data_sincronizacao ? format(new Date(c.data_sincronizacao), "dd/MM/yyyy HH:mm") : "—"} — Execução: {c.data_execucao ? format(new Date(c.data_execucao), "dd/MM/yyyy HH:mm") : "—"}</span>
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
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto gap-6 p-8">
            <DialogHeader className="space-y-2">
              <DialogTitle className="flex items-center gap-3 text-xl">
                <FileText className="h-6 w-6 text-violet-500" />
                Detalhes - BFS {selectedBFS?.bfs}
              </DialogTitle>
              <DialogDescription>Informações para relatório de Defesa/Contestação</DialogDescription>
            </DialogHeader>
            {selectedBFS && (
              <div className="space-y-6">
                {/* Status Defesa - destaque */}
                <div className="rounded-xl border border-border bg-muted/10 p-8">
                  <p className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                    <FileStack className="h-4 w-4" />
                    Status para Defesa
                  </p>
                  <div className="flex flex-wrap gap-4">
                    {STATUS_DEFESA_OPTIONS.map((opt) => {
                      const isActive = getStatusDefesa(selectedBFS.id) === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          className={`inline-flex items-center justify-center gap-3 px-6 py-4 text-base font-bold rounded-xl transition-all duration-200 min-w-36 ${
                            isActive ? opt.btnSelected : opt.btnOutline
                          }`}
                          onClick={() => handleStatusClick(selectedBFS.id, opt.value)}
                        >
                          {opt.value === "Analisar" && <Search className="h-6 w-6" />}
                          {opt.value === "Irregular" && <AlertTriangle className="h-6 w-6" />}
                          {opt.value === "Contestar" && <FileCheck className="h-6 w-6" />}
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* BFS Contestado - fotos salvas */}
                {getStatusDefesa(selectedBFS.id) === "Contestar" && (() => {
                  const fotos = getFotosForBfs(selectedBFS.id);
                  const hasFotos = fotos && (fotos.agente_sub.length > 0 || fotos.rastreamento.length > 0 || fotos.nosso_agente.length > 0);
                  if (!hasFotos) return null;
                  return (
                    <div className="rounded-xl border-2 border-emerald-500/50 bg-emerald-50/30 dark:bg-emerald-950/20 p-6 space-y-4">
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
                        {fotos!.rastreamento.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-2">Rastreamento do plano</p>
                            <img src={fotos!.rastreamento[0]} alt="" className="w-full max-w-40 h-24 object-cover rounded-lg border" />
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
                    </div>
                  );
                })()}

                {/* Dados gerais */}
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
                    <p className="text-sm font-mono">{selectedBFS.setor_resolvido || selectedBFS.cnc_detalhes?.[0]?.setor || selectedBFS.setor || "—"}</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" /> Data Registro
                    </label>
                    <p className="text-sm">
                      {selectedBFS.data_abertura
                        ? format(new Date(selectedBFS.data_abertura), "dd/MM/yyyy HH:mm")
                        : "—"}
                    </p>
                  </div>
                  {selectedBFS.frequencia_resolvida && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Frequência</label>
                      <p className="text-sm">{selectedBFS.frequencia_resolvida}</p>
                    </div>
                  )}
                  {selectedBFS.cronograma_resolvido && (
                    <div className="col-span-2 space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cronograma (do setor)</label>
                      <p className="text-sm">{selectedBFS.cronograma_resolvido}</p>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" /> Endereço
                  </label>
                  <p className="text-sm">{selectedBFS.endereco || "—"}</p>
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
                              <span className="text-muted-foreground">Data Registro:</span>{" "}
                              {c.data_sincronizacao ? format(new Date(c.data_sincronizacao), "dd/MM/yyyy HH:mm") : "—"}
                            </div>
                            <div>
                              <span className="text-muted-foreground">Data Execução:</span>{" "}
                              {c.data_execucao ? format(new Date(c.data_execucao), "dd/MM/yyyy HH:mm") : "—"}
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
          </DialogContent>
        </Dialog>

        {/* Modal Contestar - Fotos */}
        <Dialog open={modalContestarOpen} onOpenChange={(open) => { setModalContestarOpen(open); if (!open) { setFotosContestarDraft({ agente_sub: [], rastreamento: [], nosso_agente: [] }); setContestarBfsId(null); } }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto gap-6 p-8">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileCheck className="h-5 w-5 text-emerald-500" />
                Contestar BFS {contestarBfsId ? bfss.find((b) => b.id === contestarBfsId)?.bfs : selectedBFS?.bfs} — Adicionar fotos
              </DialogTitle>
              <DialogDescription>
                Preencha as fotos necessárias para a contestação. Você pode arrastar, selecionar ou colar imagens (Ctrl+V).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6">
              <FotoInputZone
                label="Foto da Agente da sub"
                images={fotosContestarDraft.agente_sub}
                onChange={(imgs) => setFotosContestarDraft((p) => ({ ...p, agente_sub: imgs }))}
                maxCount={2}
              />
              <FotoInputZone
                label="Foto do Rastreamento do plano"
                images={fotosContestarDraft.rastreamento}
                onChange={(imgs) => setFotosContestarDraft((p) => ({ ...p, rastreamento: imgs }))}
                maxCount={1}
                single
                hint="Formato retangular, estilo paisagem (landscape)."
              />
              <FotoInputZone
                label="Foto do Nosso agente (finalização)"
                images={fotosContestarDraft.nosso_agente}
                onChange={(imgs) => setFotosContestarDraft((p) => ({ ...p, nosso_agente: imgs }))}
                maxCount={2}
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setModalContestarOpen(false)}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleContestarSalvar}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
              >
                <FileCheck className="h-4 w-4" />
                Salvar contestação
              </button>
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
              <button
                type="button"
                onClick={() => { setConfirmExcluirFotosOpen(false); setPendingStatusChange(null); }}
                className="px-4 py-2 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmStatusChangeAndDeleteFotos}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white"
              >
                OK, excluir fotos
              </button>
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
                Selecione o período e baixe o relatório em CSV com os BFSs e status de defesa.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Período Inicial</label>
                <Input
                  type="date"
                  value={relatorioPeriodo.periodo_inicial}
                  onChange={(e) => setRelatorioPeriodo((p) => ({ ...p, periodo_inicial: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Período Final</label>
                <Input
                  type="date"
                  value={relatorioPeriodo.periodo_final}
                  onChange={(e) => setRelatorioPeriodo((p) => ({ ...p, periodo_final: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setModalRelatorioOpen(false)}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDownloadRelatorio}
                disabled={downloadLoading}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-70 disabled:cursor-not-allowed transition-all"
              >
                {downloadLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Gerando...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Baixar
                  </>
                )}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
