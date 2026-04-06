"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiService, SAC } from "@/lib/api";
import { endOfMonth, format, startOfMonth } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { FileText, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function SACsPage() {
  const [sacs, setSacs] = useState<SAC[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [pesquisaInput, setPesquisaInput] = useState("");
  const [pesquisa, setPesquisa] = useState("");
  const [serverStats, setServerStats] = useState<{
    total: number;
    demandantes: number;
    escalonados: number;
    no_prazo: number;
    fora_prazo: number;
  } | null>(null);
  const [selectedSAC, setSelectedSAC] = useState<SAC | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [filters, setFilters] = useState(() => {
    const now = new Date();
    return {
      status: "todos",
      subprefeitura: "todas",
      data_inicio: format(startOfMonth(now), "yyyy-MM-dd"),
      data_fim: format(endOfMonth(now), "yyyy-MM-dd"),
      fora_prazo: false,
      tipo: "all" as "IA" | "IRD" | "all",
      tipo_servico: "todos",
      procedente: "todos" as "todos" | "PROCEDE" | "NAO_PROCEDE",
    };
  });

  const parseDateInputLocal = (value?: string) => {
    if (!value) return null;
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };

  const periodoLabel = useMemo(() => {
    if (!filters.data_inicio || !filters.data_fim) return "Sem período definido";
    const inicioDate = parseDateInputLocal(filters.data_inicio);
    const fimDate = parseDateInputLocal(filters.data_fim);
    const inicio = inicioDate ? format(inicioDate, "dd/MM/yyyy") : "--";
    const fim = fimDate ? format(fimDate, "dd/MM/yyyy") : "--";
    return `${inicio} → ${fim}`;
  }, [filters.data_inicio, filters.data_fim]);

  const stats = useMemo(() => {
    if (serverStats) {
      return {
        total: serverStats.total,
        demandantes: serverStats.demandantes,
        escalonados: serverStats.escalonados,
        noPrazo: serverStats.no_prazo,
        foraPrazo: serverStats.fora_prazo,
      };
    }
    return { total: 0, demandantes: 0, escalonados: 0, noPrazo: 0, foraPrazo: 0 };
  }, [serverStats]);

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
    const loadSACs = async () => {
      try {
        setLoading(true);
        const apiFilters: Record<string, string | number | boolean> = {
          page,
          page_size: pageSize,
        };
        if (filters.data_inicio) apiFilters.periodo_inicial = filters.data_inicio;
        if (filters.data_fim) apiFilters.periodo_final = filters.data_fim;
        if (filters.status && filters.status !== "todos") apiFilters.status = filters.status;
        if (filters.subprefeitura && filters.subprefeitura !== "todas") apiFilters.subprefeitura = filters.subprefeitura;
        if (filters.fora_prazo) apiFilters.fora_do_prazo = true;
        if (filters.tipo !== "all") apiFilters.tipo = filters.tipo;
        if (filters.tipo_servico !== "todos") apiFilters.tipo_servico = filters.tipo_servico;
        if (filters.procedente !== "todos") apiFilters.procedente = filters.procedente;
        if (pesquisa) apiFilters.q = pesquisa;

        const data = await apiService.getSACs(apiFilters);
        const items = Array.isArray(data) ? data : (data?.items ?? []);
        setSacs(items);
        setTotal(Array.isArray(data) ? data.length : (data?.total ?? items.length));
        const st = !Array.isArray(data) ? data?.stats : undefined;
        if (st) {
          setServerStats({
            total: st.total,
            demandantes: st.demandantes,
            escalonados: st.escalonados,
            no_prazo: st.no_prazo,
            fora_prazo: st.fora_prazo,
          });
        } else {
          setServerStats(null);
        }
      } catch (error) {
        console.error("Erro ao carregar SACs:", error);
        setSacs([]);
        setTotal(0);
        setServerStats(null);
      } finally {
        setLoading(false);
      }
    };
    loadSACs();
  }, [filters, pesquisa, page]);

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      "Finalizado": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
      "Em Execução": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
      "Aguardando Agendamento": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
      "Aguardando Análise": "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
      "Executado": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    };
    return colors[status] || "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300";
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <MainLayout>
      <div className="space-y-8">
        <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-blue-600 via-blue-700 to-cyan-800 p-8 shadow-xl shadow-blue-900/35 dark:bg-linear-to-br dark:from-blue-800 dark:via-blue-900 dark:to-cyan-950 dark:shadow-2xl dark:shadow-black/45">
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
            <div
              className="flex h-22 w-22 shrink-0 items-center justify-center rounded-2xl bg-slate-950 shadow-lg dark:bg-slate-950"
              aria-hidden
            >
              <FileText className="h-11 w-11 text-white" strokeWidth={1.5} />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-4xl font-bold tracking-tight text-white">SACs - Sistema de Atendimento ao Cidadão</h1>
              <p className="mt-3 max-w-2xl text-lg text-blue-50">
                Solicitações e reclamações de serviços de limpeza urbana.
              </p>
            </div>
          </div>
        </div>

        {/* Estatísticas */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-blue-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
              <CardDescription>{periodoLabel}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-blue-600 dark:text-blue-400">{stats.total}</div>
            </CardContent>
          </Card>
          
          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-indigo-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Demandantes (IA)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-indigo-600 dark:text-indigo-400">{stats.demandantes}</div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-cyan-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Escalonados (IRD)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-cyan-600 dark:text-cyan-400">{stats.escalonados}</div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-green-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">No Prazo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-green-600 dark:text-green-400">{stats.noPrazo}</div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-red-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Fora do Prazo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-red-600 dark:text-red-400">{stats.foraPrazo}</div>
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Período Inicial</Label>
                <DatePicker
                  value={filters.data_inicio}
                  onChange={(value) => patchFilters({ data_inicio: value })}
                  placeholder="Selecionar início"
                />
              </div>
              
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Período Final</Label>
                <DatePicker
                  value={filters.data_fim}
                  onChange={(value) => patchFilters({ data_fim: value })}
                  placeholder="Selecionar fim"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Tipo</Label>
                <Select
                  value={filters.tipo}
                  onValueChange={(value: "IA" | "IRD" | "all") => patchFilters({ tipo: value })}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="IA">IA - Solicitações</SelectItem>
                    <SelectItem value="IRD">IRD - Reclamações</SelectItem>
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
                    <SelectItem value="Aguardando Análise">Aguardando Análise</SelectItem>
                    <SelectItem value="Aguardando Agendamento">Aguardando Agendamento</SelectItem>
                    <SelectItem value="Em Execução">Em Execução</SelectItem>
                    <SelectItem value="Executado">Executado</SelectItem>
                    <SelectItem value="Finalizado">Finalizado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Procedência</Label>
                <Select
                  value={filters.procedente}
                  onValueChange={(value: "todos" | "PROCEDE" | "NAO_PROCEDE") =>
                    patchFilters({ procedente: value })
                  }
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="PROCEDE">PROCEDE</SelectItem>
                    <SelectItem value="NAO_PROCEDE">NÃO PROCEDE</SelectItem>
                  </SelectContent>
                </Select>
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
                    <SelectItem value="Coleta">Coleta</SelectItem>
                    <SelectItem value="Remoção">Remoção</SelectItem>
                    <SelectItem value="Animais mortos">Animais mortos</SelectItem>
                    <SelectItem value="Bueiros">Bueiros</SelectItem>
                    <SelectItem value="Papeleiras">Papeleiras</SelectItem>
                    <SelectItem value="Mutirão">Mutirão</SelectItem>
                    <SelectItem value="Varrição">Varrição</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end pb-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="fora-prazo"
                    checked={filters.fora_prazo}
                    onCheckedChange={(checked) => patchFilters({ fora_prazo: checked as boolean })}
                  />
                  <Label htmlFor="fora-prazo" className="text-sm text-muted-foreground cursor-pointer">
                    Apenas fora do prazo
                  </Label>
                </div>
              </div>

              <div className="space-y-1 md:col-span-2 lg:col-span-4 w-full min-w-0">
                <Label className="text-xs text-muted-foreground">Pesquisar (protocolo ou endereço)</Label>
                <div className="relative w-full max-w-4xl">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    className="bg-background w-full pl-9"
                    placeholder="Ex.: número do protocolo, rua, bairro…"
                    value={pesquisaInput}
                    onChange={(e) => setPesquisaInput(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabela */}
        <Card className="overflow-hidden border border-border shadow-sm">
          <CardContent className="p-0">
            {loading ? (
              <div className="p-12 text-center text-muted-foreground animate-pulse">Carregando dados...</div>
            ) : sacs.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-inbox">
                  <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
                  <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
                </svg>
                <p>Nenhum SAC encontrado com os filtros atuais</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 text-muted-foreground border-b border-border">
                    <tr>
                      <th className="px-3 py-3"></th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Protocolo</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Tipo</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Endereço</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Status</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider text-center">Classificação</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider text-center">Situação</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Datas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sacs.map((sac) => (
                      <Fragment key={sac.id}>
                        <tr
                          className={`hover:bg-muted/50 transition-colors cursor-pointer ${
                            (sac.responsividade_execucao?.trim() || "") === "NÃO" ? "bg-red-50/50 dark:bg-red-900/10" : ""
                          }`}
                          onClick={() => setSelectedSAC(sac)}
                        >
                          <td className="px-3 py-4">
                            <button
                              className="text-muted-foreground hover:text-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpand(sac.id);
                              }}
                              aria-label="Expandir detalhes"
                            >
                              {expandedIds[sac.id] ? "▾" : "▸"}
                            </button>
                          </td>
                          <td className="px-6 py-4 font-medium font-mono text-primary">
                            {sac.protocolo}
                          </td>
                          <td className="px-6 py-4">
                            {sac.tipo_servico}
                          </td>
                          <td className="px-6 py-4 max-w-xs truncate text-muted-foreground" title={sac.endereco_text}>
                            {sac.endereco_text}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full border ${getStatusColor(sac.status)} bg-opacity-10 border-opacity-20`}>
                              {sac.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center text-muted-foreground">
                            {sac.classificacao_servico || "—"}
                          </td>
                          <td className="px-6 py-4 text-center">
                            {(sac.responsividade_execucao?.trim() || "") === "NÃO" ? (
                              <span className="px-2 py-1 text-xs font-semibold rounded-md bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800">
                                Fora do prazo
                              </span>
                            ) : (sac.responsividade_execucao?.trim() || "") === "SIM" ? (
                              <span className="px-2 py-1 text-xs font-medium rounded-md bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800">
                                No prazo
                              </span>
                            ) : (
                              <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                                {sac.data_execucao ? "—" : "Em andamento"}
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-xs text-muted-foreground">
                            <div>C: {format(new Date(sac.data_criacao), "dd/MM/yy")}</div>
                            {sac.data_execucao && (
                              <div className="text-green-600 dark:text-green-400 font-medium mt-0.5">
                                E: {format(new Date(sac.data_execucao), "dd/MM/yy")}
                              </div>
                            )}
                          </td>
                        </tr>
                        {expandedIds[sac.id] && (
                          <tr className="bg-muted/20">
                            <td colSpan={8} className="px-6 py-3 text-xs">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div><strong>Procedência:</strong> {sac.procedente_por_status || "—"}</div>
                                <div><strong>Fora de escopo:</strong> {sac.finalizado_fora_de_escopo || "—"}</div>
                                <div><strong>Resp. execução:</strong> {sac.responsividade_execucao || "—"}</div>
                                <div className="md:col-span-3"><strong>Endereço completo:</strong> {sac.endereco_text || "—"}</div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!loading && sacs.length > 0 && (
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
            )}
          </CardContent>
        </Card>

        {/* Modal de Detalhes */}
        <Dialog open={!!selectedSAC} onOpenChange={() => setSelectedSAC(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>SAC {selectedSAC?.protocolo}</DialogTitle>
              <DialogDescription>
                Detalhes completos da solicitação/reclamação
              </DialogDescription>
            </DialogHeader>
            {selectedSAC && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Protocolo</label>
                    <p className="text-sm font-mono">{selectedSAC.protocolo}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Status</label>
                    <p className="text-sm">
                      <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full border ${getStatusColor(selectedSAC.status)}`}>
                        {selectedSAC.status}
                      </span>
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Tipo de Serviço</label>
                    <p className="text-sm">{selectedSAC.tipo_servico}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Subprefeitura</label>
                    <p className="text-sm">{selectedSAC.subprefeitura}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Classificação</label>
                    <p className="text-sm">{selectedSAC.classificacao_servico || "—"}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Responsividade Execução</label>
                    <p className="text-sm">{selectedSAC.responsividade_execucao || "—"} (SIM = no prazo, NÃO = fora do prazo)</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Data de Criação</label>
                    <p className="text-sm">
                      {selectedSAC.data_criacao 
                        ? format(new Date(selectedSAC.data_criacao), "dd/MM/yyyy HH:mm")
                        : "—"}
                    </p>
                  </div>
                  {selectedSAC.data_agendamento && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Data de Agendamento</label>
                      <p className="text-sm">
                        {format(new Date(selectedSAC.data_agendamento), "dd/MM/yyyy HH:mm")}
                      </p>
                    </div>
                  )}
                  {selectedSAC.data_execucao && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Data de Execução</label>
                      <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                        {format(new Date(selectedSAC.data_execucao), "dd/MM/yyyy HH:mm")}
                      </p>
                    </div>
                  )}
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Situação</label>
                    <p className="text-sm">
                      {(selectedSAC.responsividade_execucao?.trim() || "") === "NÃO" ? (
                        <span className="text-red-600 dark:text-red-400 font-semibold">Fora do prazo</span>
                      ) : (selectedSAC.responsividade_execucao?.trim() || "") === "SIM" ? (
                        <span className="text-green-600 dark:text-green-400 font-semibold">No prazo</span>
                      ) : (
                        <span className="text-blue-600 dark:text-blue-400 font-semibold">Em andamento</span>
                      )}
                    </p>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Endereço</label>
                  <p className="text-sm">{selectedSAC.endereco_text}</p>
                </div>
                {(selectedSAC.lat && selectedSAC.lng) && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Coordenadas</label>
                    <p className="text-sm font-mono">{selectedSAC.lat}, {selectedSAC.lng}</p>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
