"use client";

import { Fragment, useState, useEffect, useMemo, useCallback } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiService } from "@/lib/api";
import { formatFlipDateTimeUtc, formatFlipDateTimeUtcWithWeekday } from "@/lib/flip-datetime";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { FileWarning, CalendarDays, ClipboardList, MapPin, Search, User, Wrench } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface BFS {
  id: string;
  bfs: string;
  subprefeitura: string;
  status: string;
  data_abertura: string;
  prazo_hours: number;
  endereco?: string;
  tipo_servico?: string;
  fiscal?: string;
  sem_irregularidade?: boolean;
  data_vistoria?: string;
  coordenadas?: string;
}

export default function BFSPage() {
  const [bfss, setBfss] = useState<BFS[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [pesquisaInput, setPesquisaInput] = useState("");
  const [pesquisa, setPesquisa] = useState("");
  const [listStats, setListStats] = useState<{
    total: number;
    sem_irregularidade: number;
    com_irregularidade: number;
  } | null>(null);
  const [ifEstimado, setIfEstimado] = useState<{
    if_percent: number;
    total_fiscalizacoes_adc: number;
    total_sem_irregularidade_adc: number;
  } | null>(null);
  const [selectedBFS, setSelectedBFS] = useState<BFS | null>(null);
  const [filters, setFilters] = useState(() => {
    const now = new Date();
    return {
      periodo_inicial: format(startOfMonth(now), "yyyy-MM-dd"),
      periodo_final: format(endOfMonth(now), "yyyy-MM-dd"),
      subprefeitura: "todas",
      status: "todos",
      tipo_servico: "todos",
    };
  });

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

  const stats = useMemo(() => {
    if (listStats) {
      const pctLista =
        listStats.total > 0
          ? ((listStats.sem_irregularidade / listStats.total) * 100).toFixed(1)
          : "0";
      return {
        total: listStats.total,
        semIrregularidade: listStats.sem_irregularidade,
        comIrregularidade: listStats.com_irregularidade,
        percentualSemIrregularidade: pctLista,
      };
    }
    return {
      total: 0,
      semIrregularidade: 0,
      comIrregularidade: 0,
      percentualSemIrregularidade: "0",
    };
  }, [listStats]);

  const ifPercentLabel = useMemo(() => {
    if (ifEstimado == null) return "—";
    return `${ifEstimado.if_percent.toFixed(1)}%`;
  }, [ifEstimado]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPesquisa(pesquisaInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [pesquisaInput]);

  const patchFilters = useCallback(
    (patch: Partial<typeof filters>) => {
      setFilters((prev) => ({ ...prev, ...patch }));
      setPage(1);
    },
    []
  );

  useEffect(() => {
    const loadBFSs = async () => {
      try {
        setLoading(true);
        const params: Record<string, string | number> = {
          page,
          page_size: pageSize,
        };
        if (filters.periodo_inicial) params.periodo_inicial = filters.periodo_inicial;
        if (filters.periodo_final) params.periodo_final = filters.periodo_final;
        if (filters.subprefeitura !== "todas") params.subprefeitura = filters.subprefeitura;
        if (filters.status !== "todos") params.status = filters.status;
        if (filters.tipo_servico !== "todos") params.tipo_servico = filters.tipo_servico;
        if (pesquisa) params.q = pesquisa;

        const data = await apiService.getCNCs(params);
        setBfss(data.items || []);
        setTotal(data.total ?? 0);
        if (data.stats) {
          setListStats({
            total: data.stats.total,
            sem_irregularidade: data.stats.sem_irregularidade,
            com_irregularidade: data.stats.com_irregularidade,
          });
        } else {
          setListStats(null);
        }
        if (data.if_estimado) {
          setIfEstimado({
            if_percent: data.if_estimado.if_percent,
            total_fiscalizacoes_adc: data.if_estimado.total_fiscalizacoes_adc,
            total_sem_irregularidade_adc: data.if_estimado.total_sem_irregularidade_adc,
          });
        } else {
          setIfEstimado(null);
        }
      } catch (error) {
        console.error("Erro ao carregar BFSs:", error);
        setBfss([]);
        setTotal(0);
        setListStats(null);
        setIfEstimado(null);
      } finally {
        setLoading(false);
      }
    };
    loadBFSs();
  }, [filters, pesquisa, page]);

  const formatStatus = (status?: string) => {
    if (!status) return "—";
    return status;
  };

  const getStatusColor = (status: string, semIrregularidade?: boolean) => {
    if (semIrregularidade) {
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    }
    if (status.toLowerCase().includes("irregularidade")) {
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    }
    return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <MainLayout>
      <div className="space-y-8">
        <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-orange-600 via-orange-700 to-amber-900 p-8 shadow-xl shadow-orange-900/35 dark:bg-linear-to-br dark:from-orange-700 dark:via-amber-800 dark:to-orange-950 dark:shadow-2xl dark:shadow-black/45">
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
            <div
              className="flex h-22 w-22 shrink-0 items-center justify-center rounded-2xl bg-amber-950 shadow-lg dark:bg-amber-950"
              aria-hidden
            >
              <FileWarning className="h-11 w-11 text-white" strokeWidth={1.5} />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-4xl font-bold tracking-tight text-white">BFSs - Boletins de Fiscalização</h1>
              <p className="mt-3 max-w-2xl text-lg text-orange-50">
                Registros de fiscalização dos serviços não demandantes.
              </p>
            </div>
          </div>
        </div>

        {/* Estatísticas */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-orange-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total no período
              </CardTitle>
              <CardDescription>{periodoLabel}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-orange-600 dark:text-orange-400">{stats.total}</div>
            </CardContent>
          </Card>
          
          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-green-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Sem Irregularidades
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-green-600 dark:text-green-400">{stats.semIrregularidade}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.percentualSemIrregularidade}% do total
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-red-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Com Irregularidades
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-red-600 dark:text-red-400">{stats.comIrregularidade}</div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-blue-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                IF estimado (ADC)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-blue-600 dark:text-blue-400">
                {ifPercentLabel}
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">
                Média dos % por subprefeitura no período (regra ADC: exclui 3 serviços e fiscais SELIMP -).
                {ifEstimado != null && (
                  <span className="block mt-1">
                    Base: {ifEstimado.total_sem_irregularidade_adc} sem irregularidade /{" "}
                    {ifEstimado.total_fiscalizacoes_adc} fiscalizações
                  </span>
                )}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filtros */}
        <Card className="overflow-hidden border-none shadow-sm bg-muted/30">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-filter">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
              Filtros
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Período Inicial</Label>
                <DatePicker
                  value={filters.periodo_inicial}
                  onChange={(value) => patchFilters({ periodo_inicial: value })}
                  placeholder="Selecionar início"
                />
              </div>
              
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Período Final</Label>
                <DatePicker
                  value={filters.periodo_final}
                  onChange={(value) => patchFilters({ periodo_final: value })}
                  placeholder="Selecionar fim"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Subprefeitura</Label>
                <Select
                  value={filters.subprefeitura}
                  onValueChange={(value) => patchFilters({ subprefeitura: value })}
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
                <Label className="text-xs text-muted-foreground">Status</Label>
                <Select
                  value={filters.status}
                  onValueChange={(value) => patchFilters({ status: value })}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="Sem Irregularidades">Sem Irregularidades</SelectItem>
                    <SelectItem value="Com Irregularidades">Com Irregularidades</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Tipo de Serviço</Label>
                <Select
                  value={filters.tipo_servico}
                  onValueChange={(value) => patchFilters({ tipo_servico: value })}
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

              <div className="space-y-1 md:col-span-2 lg:col-span-5 w-full min-w-0">
                <Label className="text-xs text-muted-foreground">Pesquisar (nº BFS ou endereço)</Label>
                <div className="relative w-full max-w-4xl">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    className="bg-background w-full pl-9"
                    placeholder="Ex.: número da BFS, rua…"
                    value={pesquisaInput}
                    onChange={(e) => setPesquisaInput(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Lista de BFSs */}
        {loading ? (
          <div className="p-12 text-center text-muted-foreground animate-pulse">Carregando...</div>
        ) : bfss.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-inbox">
              <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
              <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
            </svg>
            <p className="text-lg font-medium text-foreground">
              Nenhuma BFS encontrada para o período selecionado.
            </p>
          </div>
        ) : (
          <Card className="overflow-hidden border border-border shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 text-muted-foreground border-b border-border">
                    <tr>
                      <th className="px-3 py-3"></th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">BFS</th>
                      <th className="whitespace-nowrap px-6 py-3 font-medium uppercase text-xs tracking-wider">Status</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider min-w-20">
                        Tipo de serviço
                      </th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Fiscal</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Subprefeitura</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider min-w-28">
                        Datas
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {bfss.map((bfs) => (
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
                              aria-label="Expandir detalhes"
                            >
                              {expandedIds[bfs.id] ? "▾" : "▸"}
                            </button>
                          </td>
                          <td className="px-6 py-4 font-medium font-mono text-primary">
                            {bfs.bfs}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 align-middle">
                            <span className={`inline-flex max-w-none whitespace-nowrap px-2.5 py-0.5 text-xs font-medium rounded-full border ${getStatusColor(bfs.status, bfs.sem_irregularidade)} bg-opacity-10 border-opacity-20`}>
                              {formatStatus(bfs.status)}
                            </span>
                          </td>
                          <td className="px-6 py-4 max-w-xs truncate text-muted-foreground" title={bfs.tipo_servico}>
                            {bfs.tipo_servico || "—"}
                          </td>
                          <td className="px-6 py-4 text-muted-foreground">
                            {bfs.fiscal || "—"}
                          </td>
                          <td className="px-6 py-4 text-muted-foreground">
                            {bfs.subprefeitura || "—"}
                          </td>
                          <td className="px-6 py-4 text-muted-foreground align-top text-xs leading-relaxed min-w-28">
                            <div className="flex gap-1.5">
                              <CalendarDays className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
                              <div>
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Fiscalização
                                </span>
                                <div className="font-mono tabular-nums">
                                  {bfs.data_abertura ? formatFlipDateTimeUtc(bfs.data_abertura) : "—"}
                                </div>
                                <div className="text-[10px] text-muted-foreground mt-1">Registro do BFS na planilha</div>
                              </div>
                            </div>
                            <div className="flex gap-1.5 mt-2 pt-2 border-t border-border/60">
                              <ClipboardList className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                              <div>
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Vistoria
                                </span>
                                <div className="font-mono tabular-nums">
                                  {bfs.data_vistoria ? formatFlipDateTimeUtc(bfs.data_vistoria) : "—"}
                                </div>
                                <div className="text-[10px] text-muted-foreground mt-1">Quando constar na planilha</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                        {expandedIds[bfs.id] && (
                          <tr className="bg-muted/20">
                            <td colSpan={7} className="px-6 py-3 text-xs">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="flex items-start gap-2">
                                  <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                                  <div>
                                    <strong>BFS</strong>
                                    <div className="font-mono">{bfs.bfs}</div>
                                  </div>
                                </div>
                                <div className="flex items-start gap-2">
                                  <User className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                                  <div>
                                    <strong>Fiscal</strong>
                                    <div>{bfs.fiscal || "—"}</div>
                                  </div>
                                </div>
                                <div>
                                  <strong>Sem irregularidade</strong>
                                  <div>{bfs.sem_irregularidade ? "Sim" : "Não"}</div>
                                </div>
                                <div>
                                  <strong>Fiscalização (registro)</strong>
                                  <div className="font-mono">{bfs.data_abertura ? formatFlipDateTimeUtc(bfs.data_abertura) : "—"}</div>
                                </div>
                                <div>
                                  <strong>Vistoria em campo</strong>
                                  <div className="font-mono">{bfs.data_vistoria ? formatFlipDateTimeUtc(bfs.data_vistoria) : "—"}</div>
                                </div>
                                <div>
                                  <strong>Subprefeitura</strong>
                                  <div>{bfs.subprefeitura || "—"}</div>
                                </div>
                                <div className="md:col-span-3 flex gap-2">
                                  <MapPin className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                                  <div>
                                    <strong>Endereço</strong>
                                    <div>{bfs.endereco || "—"}</div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Mostrando {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} de {total}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Anterior
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page >= Math.max(1, Math.ceil(total / pageSize))}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Próxima
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Modal de Detalhes */}
        <Dialog open={!!selectedBFS} onOpenChange={() => setSelectedBFS(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <ClipboardList className="h-5 w-5 text-primary shrink-0" />
                BFS {selectedBFS?.bfs}
              </DialogTitle>
              <DialogDescription>
                Horários em Brasília. <strong>Fiscalização</strong> é o registro do boletim; <strong>vistoria</strong> é a
                data de campo quando informada na planilha — podem diferir.
              </DialogDescription>
            </DialogHeader>
            {selectedBFS && (
              <div className="space-y-6">
                <div className="rounded-xl border border-border/80 bg-muted/25 p-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identificação</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex gap-2">
                      <ClipboardList className="h-5 w-5 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">Número BFS</p>
                        <p className="text-sm font-mono font-semibold">{selectedBFS.bfs}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Status (planilha)</p>
                      <span
                        className={`inline-flex whitespace-nowrap px-2.5 py-0.5 text-xs font-medium rounded-full border ${getStatusColor(selectedBFS.status, selectedBFS.sem_irregularidade)}`}
                      >
                        {formatStatus(selectedBFS.status)}
                      </span>
                    </div>
                    <div className="flex gap-2 sm:col-span-2">
                      <Wrench className="h-5 w-5 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">Tipo de serviço</p>
                        <p className="text-sm">{selectedBFS.tipo_servico || "—"}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <User className="h-5 w-5 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">Fiscal</p>
                        <p className="text-sm">{selectedBFS.fiscal || "—"}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Subprefeitura</p>
                      <p className="text-sm">{selectedBFS.subprefeitura || "—"}</p>
                    </div>
                    <div className="sm:col-span-2">
                      <p className="text-xs text-muted-foreground mb-1">Irregularidade</p>
                      {selectedBFS.sem_irregularidade ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Sem irregularidades</span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400 font-semibold">Com irregularidade</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-border/80 bg-card p-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                    <CalendarDays className="h-4 w-4" />
                    Datas
                  </p>
                  <ul className="space-y-3 text-sm">
                    <li className="flex gap-3 pb-3 border-b border-border/60">
                      <CalendarDays className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
                      <div>
                        <p className="font-medium">Fiscalização (registro do BFS)</p>
                        <p className="text-xs text-muted-foreground">Data associada ao lançamento do boletim na base</p>
                        <p className="font-mono mt-1">
                          {selectedBFS.data_abertura
                            ? formatFlipDateTimeUtcWithWeekday(selectedBFS.data_abertura)
                            : "—"}
                        </p>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <ClipboardList className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                      <div>
                        <p className="font-medium">Vistoria em campo</p>
                        <p className="text-xs text-muted-foreground">Preenchida na planilha quando a vistoria ocorre</p>
                        <p className="font-mono mt-1">
                          {selectedBFS.data_vistoria
                            ? formatFlipDateTimeUtcWithWeekday(selectedBFS.data_vistoria)
                            : "—"}
                        </p>
                      </div>
                    </li>
                  </ul>
                </div>

                <div className="rounded-xl border border-border/80 bg-muted/15 p-4 flex gap-3">
                  <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Endereço</p>
                    <p className="text-sm leading-relaxed">{selectedBFS.endereco || "—"}</p>
                    {selectedBFS.coordenadas && (
                      <p className="text-xs font-mono text-muted-foreground mt-2">{selectedBFS.coordenadas}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
