"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Battery, CalendarCheck2, CalendarPlus, ChevronDown, ChevronRight, Clock, History, LayoutDashboard, Link2, Loader2, MapPin, Moon, RefreshCw, Search, Smartphone, Store, Table2, Unlink, Wifi, WifiOff, Wrench, XCircle } from "lucide-react";
import { toast } from "react-toastify";
import { MainLayout } from "@/components/layout/main-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/motion-ui/motion-dialog";
import { apiService, type PortatilAtribuicao, type PortatilModulo, type PortatilTroca, type PortatilTrocaHistorico } from "@/lib/api";
import { cn } from "@/lib/utils";
import { avaliarPortatil } from "./atencao";
import { isServicoFeira, servicoCurto, subLabel } from "./labels";
import { ServicoTab } from "./servico-tab";

type StatusFilter = "all" | "ON" | "OFF";
type VinculoFilter = "all" | "com" | "sem" | "feira";
type AlertaFilter = "all" | "problema" | "hibernando";

const BTN_EMERALD =
  "bg-linear-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-500 hover:to-teal-500 shadow-md shadow-emerald-950/10 border-0 font-semibold";
const BTN_AMBER =
  "bg-linear-to-r from-amber-500 to-orange-600 text-white hover:from-amber-400 hover:to-orange-500 shadow-md shadow-orange-950/10 border-0 font-semibold";
const BTN_SKY =
  "bg-linear-to-r from-sky-600 to-blue-600 text-white hover:from-sky-500 hover:to-blue-500 shadow-md shadow-blue-950/10 border-0 font-semibold";
const BTN_RED =
  "bg-linear-to-r from-red-600 to-rose-600 text-white hover:from-red-500 hover:to-rose-500 shadow-md shadow-rose-950/10 border-0 font-semibold";
const SUCESSO_MIN_PCT = 60;
type ColSort = "default" | "bateria-desc" | "bateria-asc" | "comunicacao-desc" | "comunicacao-asc";

const GLASS_CARD =
  "border border-border bg-card shadow-lg shadow-zinc-900/[0.06] dark:border-white/10 dark:bg-muted/60 dark:shadow-black/40";

const STATUS_BAT_OPTIONS = ["ALTA", "REGULAR", "BAIXA", "CRÍTICA", "DESATUALIZADA"];

const STATUS_BAT_BADGE: Record<string, string> = {
  ALTA: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
  REGULAR: "bg-orange-500/15 text-orange-600 border-orange-500/30 dark:text-orange-400",
  BAIXA: "bg-blue-500/15 text-blue-600 border-blue-500/30 dark:text-blue-400",
  CRÍTICA: "bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400",
  DESATUALIZADA: "bg-purple-500/15 text-purple-600 border-purple-500/30 dark:text-purple-400",
};

function statusBateria(modulo: PortatilModulo): string | null {
  if (modulo.bateriaDesatualizada) return "DESATUALIZADA";
  if (modulo.bateriaPercentual == null) return null;
  if (modulo.bateriaPercentual > 70) return "ALTA";
  if (modulo.bateriaPercentual > 30) return "REGULAR";
  if (modulo.bateriaPercentual > 15) return "BAIXA";
  return "CRÍTICA";
}

function SortToggle({ label, dir, onClick }: { label: string; dir: "asc" | "desc" | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 text-left leading-tight transition-colors hover:text-foreground",
        dir ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
      )}
      title="Ordenar"
    >
      {label}
      {dir === "desc" ? <ArrowDown className="h-3.5 w-3.5" /> : dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowUpDown className="h-3 w-3 opacity-40" />}
    </button>
  );
}

function fmtExportacao(iso?: string | null): string {
  if (!iso) return "Sem importação";
  const [year, month, day] = iso.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : iso;
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function isoToday(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function fmtIsoBr(iso?: string | null): string {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : iso;
}

function bateriaCor(percentual: number | null, desatualizada: boolean): string {
  if (desatualizada || percentual == null) return "text-zinc-500 dark:text-zinc-400";
  if (percentual > 70) return "text-emerald-600 dark:text-emerald-400";
  if (percentual > 30) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function fmtPct(value: number | null, raw: string | null): string {
  if (value == null) return raw?.trim() || "—";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

export default function PortateisPage() {
  const [modulos, setModulos] = useState<PortatilModulo[]>([]);
  const [servicos, setServicos] = useState<string[]>([]);
  const [dataExportacao, setDataExportacao] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [vinculoFilter, setVinculoFilter] = useState<VinculoFilter>("all");
  const [bateriaFilter, setBateriaFilter] = useState<string[]>([]);
  const [alertaFilter, setAlertaFilter] = useState<AlertaFilter>("all");
  const [colSort, setColSort] = useState<ColSort>("default");
  const [expandedNome, setExpandedNome] = useState<string | null>(null);
  const [trocaRecords, setTrocaRecords] = useState<Record<string, PortatilTroca>>({});
  const [trocaHistory, setTrocaHistory] = useState<Record<string, PortatilTrocaHistorico[]>>({});
  const [agendarModulo, setAgendarModulo] = useState<PortatilModulo | null>(null);
  const [agendarData, setAgendarData] = useState(isoToday());
  const [agendadoModulo, setAgendadoModulo] = useState<PortatilModulo | null>(null);
  const [reagendarAberto, setReagendarAberto] = useState(false);
  const [reagendarData, setReagendarData] = useState(isoToday());
  const [concluirModulo, setConcluirModulo] = useState<PortatilModulo | null>(null);
  const [concluirData, setConcluirData] = useState(isoToday());
  const [salvandoTroca, setSalvandoTroca] = useState(false);

  const reloadTrocas = useCallback(async () => {
    const trocasRes = await apiService.getPortateisTrocas();
    setTrocaRecords(trocasRes.records ?? {});
    setTrocaHistory(trocasRes.history ?? {});
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [modulosRes, trocasRes] = await Promise.all([
        apiService.getPortateisModulos(),
        apiService.getPortateisTrocas(),
      ]);
      setModulos(modulosRes.modulos ?? []);
      setDataExportacao(modulosRes.dataExportacao ?? null);
      setServicos(modulosRes.servicos ?? []);
      setTrocaRecords(trocasRes.records ?? {});
      setTrocaHistory(trocasRes.history ?? {});
    } catch (err) {
      setError(apiService.extractErrorMessage(err, "Erro ao carregar módulos portáteis"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const atencaoDe = useCallback(
    (modulo: PortatilModulo) => avaliarPortatil(modulo, dataExportacao),
    [dataExportacao],
  );

  const stats = useMemo(() => {
    let online = 0;
    let offline = 0;
    let hibernando = 0;
    for (const modulo of modulos) {
      const atencao = avaliarPortatil(modulo, dataExportacao);
      if (modulo.comunicacao === "ON") online += 1;
      else if (atencao.hibernando) hibernando += 1;
      else offline += 1;
    }
    const vinculados = modulos.filter((modulo) => Boolean(modulo.atribuicao?.servico)).length;
    const feira = modulos.filter((modulo) => isServicoFeira(modulo.atribuicao?.servico)).length;
    const pct = (count: number) => (modulos.length === 0 ? 0 : Math.round((count / modulos.length) * 100));
    return {
      total: modulos.length,
      online,
      offline,
      hibernando,
      vinculados,
      semVinculo: modulos.length - vinculados,
      feira,
      pctOnline: pct(online),
      pctOffline: pct(offline),
      pctHibernando: pct(hibernando),
    };
  }, [dataExportacao, modulos]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = modulos.filter((modulo) => {
      const atencao = avaliarPortatil(modulo, dataExportacao);
      if (statusFilter === "ON" && modulo.comunicacao !== "ON") return false;
      if (statusFilter === "OFF" && (modulo.comunicacao !== "OFF" || atencao.hibernando)) return false;
      if (alertaFilter === "problema" && atencao.level !== "problema") return false;
      if (alertaFilter === "hibernando" && !atencao.hibernando) return false;
      const vinculado = Boolean(modulo.atribuicao?.servico);
      if (vinculoFilter === "com" && !vinculado) return false;
      if (vinculoFilter === "sem" && vinculado) return false;
      if (vinculoFilter === "feira" && !isServicoFeira(modulo.atribuicao?.servico)) return false;
      if (bateriaFilter.length > 0 && !bateriaFilter.includes(statusBateria(modulo) ?? "")) return false;
      if (!term) return true;
      const blob = [
        modulo.nome,
        modulo.atribuicao?.subprefeitura,
        subLabel(modulo.atribuicao?.subprefeitura),
        servicoCurto(modulo.atribuicao?.servico),
        modulo.atribuicao?.servico,
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(term);
    });
    const dir = colSort.endsWith("-asc") ? 1 : -1;
    if (colSort.startsWith("bateria")) {
      rows.sort((a, b) => dir * ((a.bateriaPercentual ?? -1) - (b.bateriaPercentual ?? -1)));
    } else if (colSort.startsWith("comunicacao")) {
      rows.sort(
        (a, b) =>
          dir * ((Date.parse(a.ultimaComunicacao ?? "") || 0) - (Date.parse(b.ultimaComunicacao ?? "") || 0)),
      );
    } else if (vinculoFilter === "feira") {
      const subOrder = ["CV", "JT", "ST", "MG"];
      rows.sort((a, b) => {
        const left = subOrder.indexOf(a.atribuicao?.subprefeitura ?? "");
        const right = subOrder.indexOf(b.atribuicao?.subprefeitura ?? "");
        const bySub = (left < 0 ? 99 : left) - (right < 0 ? 99 : right);
        return bySub || a.nome.localeCompare(b.nome, "pt-BR");
      });
    }
    return rows;
  }, [alertaFilter, bateriaFilter, colSort, dataExportacao, modulos, search, statusFilter, vinculoFilter]);

  function colSortDir(col: "bateria" | "comunicacao"): "asc" | "desc" | null {
    if (colSort === `${col}-desc`) return "desc";
    if (colSort === `${col}-asc`) return "asc";
    return null;
  }

  function cycleColSort(col: "bateria" | "comunicacao") {
    setColSort((prev) => (prev === `${col}-desc` ? `${col}-asc` : prev === `${col}-asc` ? "default" : `${col}-desc`));
  }

  function applyAtribuicao(nome: string, atribuicao: PortatilAtribuicao | null) {
    setModulos((prev) => prev.map((modulo) => (modulo.nome === nome ? { ...modulo, atribuicao } : modulo)));
  }

  function toggleStatus(next: Exclude<StatusFilter, "all">) {
    setAlertaFilter("all");
    setVinculoFilter("all");
    setStatusFilter((prev) => (prev === next ? "all" : next));
  }

  function toggleAlerta(next: Exclude<AlertaFilter, "all">) {
    setStatusFilter("all");
    setVinculoFilter("all");
    setAlertaFilter((prev) => (prev === next ? "all" : next));
  }

  async function confirmAgendar(nome: string, dataAgendada: string) {
    try {
      setSalvandoTroca(true);
      await apiService.agendarPortatilTrocas([{ nome, dataAgendada }]);
      await reloadTrocas();
      setAgendarModulo(null);
      setAgendadoModulo(null);
      setReagendarAberto(false);
    } catch (err) {
      toast.error(apiService.extractErrorMessage(err, "Erro ao agendar a troca"));
    } finally {
      setSalvandoTroca(false);
    }
  }

  async function confirmConcluir() {
    if (!concluirModulo || !concluirData) return;
    try {
      setSalvandoTroca(true);
      await apiService.concluirPortatilTrocas([{ nome: concluirModulo.nome, dataTroca: concluirData }]);
      await reloadTrocas();
      setConcluirModulo(null);
    } catch (err) {
      toast.error(apiService.extractErrorMessage(err, "Erro ao concluir a troca"));
    } finally {
      setSalvandoTroca(false);
    }
  }

  async function confirmCancelar(nome: string) {
    try {
      setSalvandoTroca(true);
      await apiService.cancelarPortatilTroca(nome);
      await reloadTrocas();
      setAgendadoModulo(null);
    } catch (err) {
      toast.error(apiService.extractErrorMessage(err, "Erro ao cancelar a troca"));
    } finally {
      setSalvandoTroca(false);
    }
  }

  function toggleVinculo(next: Exclude<VinculoFilter, "all">) {
    setStatusFilter("all");
    setAlertaFilter("all");
    setVinculoFilter((prev) => (prev === next ? "all" : next));
  }

  return (
    <MainLayout>
      <div className="min-h-screen bg-background">
        <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-md">
          <div className="flex items-center justify-between gap-3 px-6 py-4">
            <div className="flex items-center gap-3">
              <Smartphone className="h-6 w-6 text-cyan-500" />
              <div>
                <h1 className="text-xl font-bold text-foreground">Módulos portáteis</h1>
                <p className="text-xs text-muted-foreground">Online e offline. A equipe é a sub e o serviço, sem mapa.</p>
              </div>
            </div>
            <Button type="button" variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => void load()}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
              Exportação: {fmtExportacao(dataExportacao)}
            </Button>
          </div>
        </div>

        <div className="px-6 py-6">
          {loading && modulos.length === 0 ? (
            <div className="flex h-[40vh] items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Carregando módulos
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-6 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          ) : (
            <>
            <Tabs defaultValue="overview" className="space-y-6">
              <TabsList className="border border-border bg-muted/50 [&_[data-active-pill]]:bg-emerald-500 [&_[data-state=active]]:text-white">
                <TabsTrigger value="overview" className="text-muted-foreground data-[state=active]:bg-transparent data-[state=active]:text-white">
                  <LayoutDashboard className="mr-2 h-4 w-4" /> Visão geral
                </TabsTrigger>
                <TabsTrigger value="setores" className="text-muted-foreground data-[state=active]:bg-transparent data-[state=active]:text-white">
                  <MapPin className="mr-2 h-4 w-4" /> Serviço
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-6">
                <div className="relative overflow-hidden rounded-2xl border border-cyan-400/40 bg-linear-to-br from-cyan-600/95 via-sky-700 to-slate-950 px-6 py-8 text-white shadow-xl">
                  <div className="relative flex flex-col gap-8 xl:flex-row xl:items-stretch xl:justify-between xl:gap-10">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium uppercase tracking-wider text-white/80">Status de bateria</p>
                      <h2 className="text-lg font-semibold">Total de módulos portáteis</h2>
                      <p className="mt-4 font-mono text-6xl font-bold tabular-nums">{stats.total}</p>
                    </div>
                    <div className="grid min-w-[220px] flex-1 grid-cols-1 gap-4 sm:grid-cols-3 xl:max-w-3xl">
                      <button type="button" className="text-left" onClick={() => toggleVinculo("com")}>
                        <div className={cn("flex h-full flex-col justify-between rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm", vinculoFilter === "com" && "ring-2 ring-white")}>
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-medium uppercase tracking-wide text-white/80">Vinculados</p>
                            <Link2 className="size-8 shrink-0 text-emerald-200/95" />
                          </div>
                          <p className="mt-4 font-mono text-4xl font-bold tabular-nums">{stats.vinculados}</p>
                        </div>
                      </button>
                      <button type="button" className="text-left" onClick={() => toggleVinculo("sem")}>
                        <div className={cn("flex h-full flex-col justify-between rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm", vinculoFilter === "sem" && "ring-2 ring-white")}>
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-medium uppercase tracking-wide text-white/80">Sem vínculo</p>
                            <Unlink className="size-8 shrink-0 text-amber-100/95" />
                          </div>
                          <p className="mt-4 font-mono text-4xl font-bold tabular-nums">{stats.semVinculo}</p>
                        </div>
                      </button>
                      <button type="button" className="text-left" onClick={() => toggleVinculo("feira")}>
                        <div className={cn("flex h-full flex-col justify-between rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm", vinculoFilter === "feira" && "ring-2 ring-white")}>
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-medium uppercase tracking-wide text-white/80">Feira</p>
                            <Store className="size-8 shrink-0 text-amber-200/95" />
                          </div>
                          <p className="mt-4 font-mono text-4xl font-bold tabular-nums">{stats.feira}</p>
                          <p className="mt-1 text-[11px] text-white/70">Leitura diária</p>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <button type="button" className="text-left" onClick={() => toggleStatus("ON")}>
                    <Card className={cn("border-0 bg-linear-to-br from-emerald-600 to-emerald-900 text-white shadow-xl", statusFilter === "ON" && "ring-2 ring-white")}>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-semibold text-white/95">Online</CardTitle>
                        <Wifi className="size-5 text-white/80" />
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-baseline gap-3">
                          <span className="font-mono text-4xl font-bold tabular-nums">{stats.online}</span>
                          <span className="font-mono text-2xl font-bold text-white/85">({stats.pctOnline}%)</span>
                        </div>
                        <p className="mt-2 text-sm text-white/90">Comunicação ativa</p>
                      </CardContent>
                    </Card>
                  </button>
                  <button type="button" className="text-left" onClick={() => toggleAlerta("hibernando")}>
                    <Card className={cn("border-0 bg-linear-to-br from-cyan-600 to-blue-950 text-white shadow-xl", alertaFilter === "hibernando" && "ring-2 ring-white")}>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-semibold text-white/95">Hibernando</CardTitle>
                        <Moon className="size-5 text-white/85" />
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-baseline gap-3">
                          <span className="font-mono text-4xl font-bold tabular-nums">{stats.hibernando}</span>
                          <span className="font-mono text-2xl font-bold text-cyan-100/95">({stats.pctHibernando}%)</span>
                        </div>
                        <p className="mt-2 text-sm text-cyan-50/95">Ociosos entre importações</p>
                      </CardContent>
                    </Card>
                  </button>
                  <button type="button" className="text-left" onClick={() => toggleStatus("OFF")}>
                    <Card className={cn("border-0 bg-linear-to-br from-red-700 to-rose-950 text-white shadow-xl", statusFilter === "OFF" && "ring-2 ring-white")}>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-semibold text-white">Offline</CardTitle>
                        <WifiOff className="size-5 text-white/90" />
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-baseline gap-3">
                          <span className="font-mono text-4xl font-bold tabular-nums">{stats.offline}</span>
                          <span className="font-mono text-2xl font-bold text-red-100/95">({stats.pctOffline}%)</span>
                        </div>
                        <p className="mt-2 text-sm text-red-50/95">Sem comunicação</p>
                      </CardContent>
                    </Card>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium uppercase tracking-wide">Legenda</span>
                  <Badge variant="outline" className="gap-1.5 border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                    <Wifi className="h-3 w-3" /> Online
                  </Badge>
                  <Badge variant="outline" className="gap-1.5 border-red-500/40 text-red-700 dark:text-red-300">
                    <WifiOff className="h-3 w-3" /> Offline
                  </Badge>
                  <Badge variant="outline" className="gap-1.5 border-cyan-500/40 text-cyan-700 dark:text-cyan-300">
                    <Moon className="h-3 w-3" /> Hibernando
                  </Badge>
                  <Badge variant="outline" className="gap-1.5 opacity-70">
                    <Wrench className="h-3 w-3" /> Manutenção
                    <span className="text-[10px] uppercase tracking-wide">reservado</span>
                  </Badge>
                </div>

                <Card className={cn("border-border/50 shadow-sm backdrop-blur-sm", GLASS_CARD)}>
                  <CardHeader className="space-y-3">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-foreground">
                        <Table2 className="h-5 w-5 text-emerald-500" /> Listagem de portáteis
                      </CardTitle>
                      <CardDescription>Sub e serviço da equipe, com bateria e última comunicação</CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative w-[220px]">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Buscar módulo, sub ou serviço"
                          className="h-9 pl-9"
                        />
                      </div>
                      <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
                        <SelectTrigger className="h-9 w-[150px]">
                          <SelectValue placeholder="Comunicação" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Comunicação: todas</SelectItem>
                          <SelectItem value="ON">Online</SelectItem>
                          <SelectItem value="OFF">Offline</SelectItem>
                        </SelectContent>
                      </Select>
                      <MultiSelect
                        compact
                        className="w-[190px]"
                        placeholder="Status da Bateria"
                        options={STATUS_BAT_OPTIONS.map((status) => ({ value: status, label: status }))}
                        value={bateriaFilter}
                        onChange={setBateriaFilter}
                      />
                      <Select value={alertaFilter} onValueChange={(value) => setAlertaFilter(value as AlertaFilter)}>
                        <SelectTrigger className="h-9 w-[170px]">
                          <SelectValue placeholder="Alertas" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Alertas: todos</SelectItem>
                          <SelectItem value="problema">Com alerta</SelectItem>
                          <SelectItem value="hibernando">Somente hibernando</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={vinculoFilter} onValueChange={(value) => setVinculoFilter(value as VinculoFilter)}>
                        <SelectTrigger className="h-9 w-[160px]">
                          <SelectValue placeholder="Vínculo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Vínculo: todos</SelectItem>
                          <SelectItem value="com">Vinculados</SelectItem>
                          <SelectItem value="sem">Sem vínculo</SelectItem>
                          <SelectItem value="feira">Feira</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-hidden rounded-xl bg-muted/15 shadow-sm ring-1 ring-zinc-200/80 dark:ring-zinc-700/60">
                      <Table className="[&_tbody_tr]:border-b [&_tbody_tr]:border-border/30 [&_thead_tr]:border-b [&_thead_tr]:border-border/30">
                        <TableHeader>
                          <TableRow className="bg-muted/25 hover:bg-muted/25 [&>th]:h-16">
                            <TableHead className="w-8" />
                            <TableHead className="text-center">Sub</TableHead>
                            <TableHead>Serviço</TableHead>
                            <TableHead>Módulo</TableHead>
                            <TableHead>Comunicação</TableHead>
                            <TableHead>
                              <SortToggle label="Bateria" dir={colSortDir("bateria")} onClick={() => cycleColSort("bateria")} />
                            </TableHead>
                            <TableHead>
                              <SortToggle label="Última comunicação" dir={colSortDir("comunicacao")} onClick={() => cycleColSort("comunicacao")} />
                            </TableHead>
                            <TableHead>Atenção</TableHead>
                            <TableHead>Troca</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filtered.map((modulo) => {
                            const status = statusBateria(modulo);
                            const atencao = atencaoDe(modulo);
                            const troca = trocaRecords[modulo.nome];
                            const historicoTroca = trocaHistory[modulo.nome] ?? [];
                            const aberto = expandedNome === modulo.nome;
                            const serie = (modulo.historico ?? []).slice(0, 10);
                            return (
                              <Fragment key={modulo.nome}>
                              <TableRow
                                className="cursor-pointer border-border/30 hover:bg-muted/20"
                                onClick={() => setExpandedNome((atual) => (atual === modulo.nome ? null : modulo.nome))}
                              >
                                <TableCell>
                                  {aberto ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                                </TableCell>
                                <TableCell className="text-center font-medium">{modulo.atribuicao?.subprefeitura ?? "—"}</TableCell>
                                <TableCell title={modulo.atribuicao?.servico ?? undefined}>{servicoCurto(modulo.atribuicao?.servico)}</TableCell>
                                <TableCell className="font-medium">{modulo.nome}</TableCell>
                                <TableCell>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      modulo.comunicacao === "ON"
                                        ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                                        : "border-red-500/40 text-red-700 dark:text-red-300",
                                    )}
                                  >
                                    {modulo.comunicacao === "ON" ? "Online" : "Offline"}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-1.5">
                                    {modulo.comunicacao === "ON" ? (
                                      <Wifi className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                    ) : (
                                      <WifiOff className="h-3.5 w-3.5 shrink-0 text-red-500" />
                                    )}
                                    <span className="tabular-nums">{fmtPct(modulo.bateriaPercentual, modulo.bateriaRaw)}</span>
                                    {status && (
                                      <Badge className={cn("font-semibold", STATUS_BAT_BADGE[status])}>{status}</Badge>
                                    )}
                                    {atencao.hibernando && (
                                      <span title="Hibernando — offline agora e online nas duas importações anteriores" className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-cyan-500/40 bg-cyan-500/15 px-1 text-[11px] font-bold text-cyan-600 dark:text-cyan-400">H</span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-xs tabular-nums text-muted-foreground">{fmtDateTime(modulo.ultimaComunicacao)}</TableCell>
                                <TableCell>
                                  {atencao.level === "problema" ? (
                                    <Badge title={atencao.motivos.join(" · ")} className="border-amber-500/30 bg-amber-500/15 font-semibold text-amber-700 dark:text-amber-300">
                                      <AlertTriangle className="mr-1 h-3 w-3" /> Atenção
                                    </Badge>
                                  ) : atencao.hibernando ? (
                                    <span title={atencao.motivos.join(" · ")} className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-cyan-500/40 bg-cyan-500/15 px-1 text-[11px] font-bold text-cyan-600 dark:text-cyan-400">H</span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                                <TableCell onClick={(event) => event.stopPropagation()}>
                                  {troca?.status === "agendada" ? (
                                    <Button
                                      size="sm"
                                      className={cn("h-7 gap-1", BTN_AMBER)}
                                      onClick={() => {
                                        setReagendarAberto(false);
                                        setReagendarData(troca.dataAgendada ?? isoToday());
                                        setAgendadoModulo(modulo);
                                      }}
                                    >
                                      <Clock className="h-3.5 w-3.5" /> Agendado · {fmtIsoBr(troca.dataAgendada)}
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      className={cn("h-7 gap-1", BTN_EMERALD)}
                                      onClick={() => {
                                        setAgendarData(isoToday());
                                        setAgendarModulo(modulo);
                                      }}
                                    >
                                      <CalendarPlus className="h-3.5 w-3.5" /> Agendar
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                              {aberto && (
                                <TableRow key={`${modulo.nome}-detalhe`} className="hover:bg-transparent">
                                  <TableCell colSpan={9} className="bg-muted/20">
                                    <div className="space-y-3 py-2">
                                      <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-2">
                                        <div className="mb-2 flex items-center gap-2">
                                          <Battery className="h-4 w-4 text-emerald-500" />
                                          <span className="text-sm font-semibold">Histórico de bateria</span>
                                        </div>
                                        {serie.length > 0 ? (
                                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-10">
                                            {serie.map((ponto) => (
                                              <div key={ponto.dataExportacao} className="rounded-lg border border-border/50 bg-muted/20 px-2 py-2">
                                                <span className="text-[11px] font-medium tabular-nums text-muted-foreground">{fmtIsoBr(ponto.dataExportacao).slice(0, 5)}</span>
                                                <span className={cn("mt-1 block text-xs font-bold tabular-nums", bateriaCor(ponto.bateriaPercentual, ponto.bateriaDesatualizada))}>
                                                  {ponto.bateriaDesatualizada ? "Desat." : ponto.bateriaPercentual != null ? `${Math.round(ponto.bateriaPercentual)}%` : "—"}
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <p className="text-xs text-muted-foreground">Sem importações anteriores.</p>
                                        )}
                                      </div>
                                      <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-2">
                                        <div className="mb-2 flex items-center gap-2">
                                          <History className="h-4 w-4 text-emerald-500" />
                                          <span className="text-sm font-semibold">Histórico de trocas</span>
                                        </div>
                                        {historicoTroca.length === 0 ? (
                                          <p className="text-xs text-muted-foreground">Nenhuma troca registrada.</p>
                                        ) : (
                                          <ul className="space-y-1 text-xs">
                                            {historicoTroca.map((item) => (
                                              <li key={item.id} className="flex flex-wrap items-center gap-2">
                                                <span className="font-medium">{item.status === "agendada" ? "Agendada" : "Concluída"}</span>
                                                <span className="tabular-nums text-muted-foreground">{fmtIsoBr(item.dataTroca ?? item.dataAgendada)}</span>
                                                {item.status === "concluida" && (
                                                  <Badge className={cn("font-semibold", item.sucesso == null ? "bg-zinc-500/15 text-zinc-600" : item.sucesso ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-600")}>
                                                    {item.sucesso == null ? "Aguardando leitura seguinte" : item.sucesso ? "Com sucesso" : "Sem sucesso"}
                                                  </Badge>
                                                )}
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </div>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                              </Fragment>
                            );
                          })}
                          {filtered.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                                {modulos.length === 0
                                  ? "Nenhum módulo portátil na última importação de status de bateria."
                                  : "Nenhum módulo neste filtro."}
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="setores">
                <ServicoTab modulos={modulos} servicos={servicos} onSaved={applyAtribuicao} />
              </TabsContent>
            </Tabs>
            <Dialog open={!!agendarModulo} onOpenChange={(open) => !open && setAgendarModulo(null)}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <CalendarPlus className="h-5 w-5 text-emerald-500" /> Agendar troca de bateria
                  </DialogTitle>
                  <DialogDescription>{agendarModulo?.nome}</DialogDescription>
                </DialogHeader>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Data do agendamento</label>
                  <DatePicker value={agendarData} onChange={setAgendarData} />
                </div>
                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => setAgendarModulo(null)}>Cancelar</Button>
                  <Button className={BTN_EMERALD} disabled={!agendarData || salvandoTroca} onClick={() => agendarModulo && void confirmAgendar(agendarModulo.nome, agendarData)}>
                    <CalendarPlus className="h-4 w-4" /> Agendar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={!!agendadoModulo} onOpenChange={(open) => { if (!open) { setAgendadoModulo(null); setReagendarAberto(false); } }}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <Clock className="h-5 w-5 text-amber-500" /> Troca agendada
                  </DialogTitle>
                  <DialogDescription>{agendadoModulo?.nome}</DialogDescription>
                </DialogHeader>
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm">
                  Agendada para <strong className="tabular-nums">{fmtIsoBr(agendadoModulo ? trocaRecords[agendadoModulo.nome]?.dataAgendada : null)}</strong>. Conclua, reagende ou cancele.
                </p>
                {reagendarAberto && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Nova data</label>
                    <DatePicker value={reagendarData} onChange={setReagendarData} />
                  </div>
                )}
                <DialogFooter className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Button className={BTN_RED} disabled={salvandoTroca} onClick={() => agendadoModulo && void confirmCancelar(agendadoModulo.nome)}>
                    <XCircle className="mr-1.5 h-4 w-4" /> Cancelar troca
                  </Button>
                  <Button
                    className={BTN_AMBER}
                    disabled={salvandoTroca || (reagendarAberto && !reagendarData)}
                    onClick={() => {
                      if (!reagendarAberto) {
                        setReagendarAberto(true);
                        return;
                      }
                      if (agendadoModulo) void confirmAgendar(agendadoModulo.nome, reagendarData);
                    }}
                  >
                    <RefreshCw className="mr-1.5 h-4 w-4" /> {reagendarAberto ? "Salvar" : "Reagendar"}
                  </Button>
                  <Button
                    className={BTN_SKY}
                    onClick={() => {
                      const modulo = agendadoModulo;
                      setAgendadoModulo(null);
                      setReagendarAberto(false);
                      if (modulo) {
                        setConcluirData(isoToday());
                        setConcluirModulo(modulo);
                      }
                    }}
                  >
                    <CalendarCheck2 className="mr-1.5 h-4 w-4" /> Concluir
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={!!concluirModulo} onOpenChange={(open) => !open && setConcluirModulo(null)}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <CalendarCheck2 className="h-5 w-5 text-sky-500" /> Concluir troca de bateria
                  </DialogTitle>
                  <DialogDescription>{concluirModulo?.nome}</DialogDescription>
                </DialogHeader>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Data da troca</label>
                  <DatePicker value={concluirData} onChange={setConcluirData} />
                </div>
                <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  O resultado fica com sucesso quando a importação seguinte estiver atualizada e com pelo menos <strong>{SUCESSO_MIN_PCT}%</strong>. Até lá a troca permanece aguardando essa leitura.
                </p>
                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => setConcluirModulo(null)}>Cancelar</Button>
                  <Button className={BTN_SKY} disabled={!concluirData || salvandoTroca} onClick={() => void confirmConcluir()}>
                    Registrar conclusão
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
