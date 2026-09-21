"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, LayoutDashboard, Link2, Loader2, MapPin, Moon, RefreshCw, Search, Smartphone, Table2, Unlink, Wifi, WifiOff, Wrench } from "lucide-react";
import { MainLayout } from "@/components/layout/main-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiService, type PortatilAtribuicao, type PortatilModulo } from "@/lib/api";
import { cn } from "@/lib/utils";
import { servicoCurto, subLabel } from "./labels";
import { ServicoTab } from "./servico-tab";

type StatusFilter = "all" | "ON" | "OFF";
type VinculoFilter = "all" | "com" | "sem";
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
  const [colSort, setColSort] = useState<ColSort>("default");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const modulosRes = await apiService.getPortateisModulos();
      setModulos(modulosRes.modulos ?? []);
      setDataExportacao(modulosRes.dataExportacao ?? null);
      setServicos(modulosRes.servicos ?? []);
    } catch (err) {
      setError(apiService.extractErrorMessage(err, "Erro ao carregar módulos portáteis"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const online = modulos.filter((modulo) => modulo.comunicacao === "ON").length;
    const offline = modulos.length - online;
    const vinculados = modulos.filter((modulo) => Boolean(modulo.atribuicao?.servico)).length;
    const pct = (count: number) => (modulos.length === 0 ? 0 : Math.round((count / modulos.length) * 100));
    return {
      total: modulos.length,
      online,
      offline,
      vinculados,
      semVinculo: modulos.length - vinculados,
      pctOnline: pct(online),
      pctOffline: pct(offline),
    };
  }, [modulos]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = modulos.filter((modulo) => {
      if (statusFilter !== "all" && modulo.comunicacao !== statusFilter) return false;
      const vinculado = Boolean(modulo.atribuicao?.servico);
      if (vinculoFilter === "com" && !vinculado) return false;
      if (vinculoFilter === "sem" && vinculado) return false;
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
    }
    return rows;
  }, [bateriaFilter, colSort, modulos, search, statusFilter, vinculoFilter]);

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
    setStatusFilter((prev) => (prev === next ? "all" : next));
  }

  function toggleVinculo(next: Exclude<VinculoFilter, "all">) {
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
                    <div className="grid min-w-[220px] flex-1 grid-cols-1 gap-4 sm:grid-cols-2 xl:max-w-xl">
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
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                  <Badge variant="outline" className="gap-1.5 opacity-70">
                    <Moon className="h-3 w-3" /> Hibernando
                    <span className="text-[10px] uppercase tracking-wide">reservado</span>
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
                      <Select value={vinculoFilter} onValueChange={(value) => setVinculoFilter(value as VinculoFilter)}>
                        <SelectTrigger className="h-9 w-[160px]">
                          <SelectValue placeholder="Vínculo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Vínculo: todos</SelectItem>
                          <SelectItem value="com">Vinculados</SelectItem>
                          <SelectItem value="sem">Sem vínculo</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-hidden rounded-xl bg-muted/15 shadow-sm ring-1 ring-zinc-200/80 dark:ring-zinc-700/60">
                      <Table className="[&_tbody_tr]:border-b [&_tbody_tr]:border-border/30 [&_thead_tr]:border-b [&_thead_tr]:border-border/30">
                        <TableHeader>
                          <TableRow className="bg-muted/25 hover:bg-muted/25 [&>th]:h-16">
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
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filtered.map((modulo) => {
                            const status = statusBateria(modulo);
                            return (
                              <TableRow key={modulo.nome} className="border-border/30 hover:bg-muted/20">
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
                                  </div>
                                </TableCell>
                                <TableCell className="text-xs tabular-nums text-muted-foreground">{fmtDateTime(modulo.ultimaComunicacao)}</TableCell>
                              </TableRow>
                            );
                          })}
                          {filtered.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
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
          )}
        </div>
      </div>
    </MainLayout>
  );
}
