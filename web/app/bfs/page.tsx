"use client";

import { Fragment, useState, useEffect, useMemo } from "react";
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
    const semIrregularidade = bfss.filter(b => b.sem_irregularidade).length;
    const comIrregularidade = bfss.length - semIrregularidade;
    const percentualSemIrregularidade = bfss.length > 0 
      ? ((semIrregularidade / bfss.length) * 100).toFixed(1)
      : "0";
    
    return {
      total: bfss.length,
      semIrregularidade,
      comIrregularidade,
      percentualSemIrregularidade,
    };
  }, [bfss]);

  useEffect(() => {
    loadBFSs();
  }, [filters]);

  const loadBFSs = async () => {
    try {
      setLoading(true);
      const params: Record<string, any> = { full: true };
      
      if (filters.periodo_inicial) params.periodo_inicial = filters.periodo_inicial;
      if (filters.periodo_final) params.periodo_final = filters.periodo_final;
      if (filters.subprefeitura !== "todas") params.subprefeitura = filters.subprefeitura;
      if (filters.status !== "todos") params.status = filters.status;
      if (filters.tipo_servico !== "todos") params.tipo_servico = filters.tipo_servico;
      
      const data = await apiService.getCNCs(params);
      setBfss(data.items || []);
      setTotal(data.total || 0);
    } catch (error) {
      console.error("Erro ao carregar BFSs:", error);
      setBfss([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

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
        <div className="relative overflow-hidden rounded-xl bg-linear-to-r from-orange-600/10 via-orange-600/5 to-transparent p-8 border border-orange-200/50 dark:border-orange-800/50">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-orange-600/10 rounded-full blur-3xl"></div>
          <div className="relative">
            <h1 className="text-4xl font-bold tracking-tight bg-linear-to-r from-orange-600 to-amber-500 bg-clip-text text-transparent pb-2">
              BFSs - Boletins de Fiscalização
            </h1>
            <p className="text-muted-foreground mt-2 text-lg max-w-2xl">
              Registros de fiscalização dos serviços não demandantes.
            </p>
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
                IF Estimado
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-blue-600 dark:text-blue-400">
                {stats.percentualSemIrregularidade}%
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Percentual sem irregularidades
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
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <Select
                  value={filters.status}
                  onValueChange={(value) => setFilters({ ...filters, status: value })}
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
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Status</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Tipo de Serviço</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Fiscal</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Subprefeitura</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Data Fiscalização</th>
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
                          <td className="px-6 py-4">
                            <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full border ${getStatusColor(bfs.status, bfs.sem_irregularidade)} bg-opacity-10 border-opacity-20`}>
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
                          <td className="px-6 py-4 text-muted-foreground">
                            {bfs.data_abertura ? format(new Date(bfs.data_abertura), "dd/MM/yyyy HH:mm") : "—"}
                          </td>
                        </tr>
                        {expandedIds[bfs.id] && (
                          <tr className="bg-muted/20">
                            <td colSpan={7} className="px-6 py-3 text-xs">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div><strong>BFS:</strong> {bfs.bfs}</div>
                                <div><strong>Fiscal:</strong> {bfs.fiscal || "—"}</div>
                                <div><strong>Sem irregularidade:</strong> {bfs.sem_irregularidade ? "Sim" : "Não"}</div>
                                <div><strong>Data fiscalização:</strong> {bfs.data_abertura ? format(new Date(bfs.data_abertura), "dd/MM/yyyy HH:mm") : "—"}</div>
                                <div><strong>Data vistoria:</strong> {bfs.data_vistoria ? format(new Date(bfs.data_vistoria), "dd/MM/yyyy HH:mm") : "—"}</div>
                                <div><strong>Subprefeitura:</strong> {bfs.subprefeitura || "—"}</div>
                                <div className="md:col-span-3"><strong>Endereço completo:</strong> {bfs.endereco || "—"}</div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Modal de Detalhes */}
        <Dialog open={!!selectedBFS} onOpenChange={() => setSelectedBFS(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Detalhes da BFS {selectedBFS?.bfs}</DialogTitle>
              <DialogDescription>
                Informações completas do Boletim de Fiscalização
              </DialogDescription>
            </DialogHeader>
            {selectedBFS && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Número BFS</label>
                    <p className="text-sm font-mono">{selectedBFS.bfs}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Status</label>
                    <p className="text-sm">
                      <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full border ${getStatusColor(selectedBFS.status, selectedBFS.sem_irregularidade)}`}>
                        {formatStatus(selectedBFS.status)}
                      </span>
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Tipo de Serviço</label>
                    <p className="text-sm">{selectedBFS.tipo_servico || "—"}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Fiscal</label>
                    <p className="text-sm">{selectedBFS.fiscal || "—"}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Subprefeitura</label>
                    <p className="text-sm">{selectedBFS.subprefeitura || "—"}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Sem Irregularidades</label>
                    <p className="text-sm">
                      {selectedBFS.sem_irregularidade ? (
                        <span className="text-green-600 dark:text-green-400 font-semibold">Sim</span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400 font-semibold">Não</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Data de Fiscalização</label>
                    <p className="text-sm">
                      {selectedBFS.data_abertura 
                        ? format(new Date(selectedBFS.data_abertura), "dd/MM/yyyy HH:mm")
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Data de Vistoria</label>
                    <p className="text-sm">
                      {selectedBFS.data_vistoria 
                        ? format(new Date(selectedBFS.data_vistoria), "dd/MM/yyyy HH:mm")
                        : "—"}
                    </p>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Endereço</label>
                  <p className="text-sm">{selectedBFS.endereco || "—"}</p>
                </div>
                {selectedBFS.coordenadas && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Coordenadas</label>
                    <p className="text-sm font-mono">{selectedBFS.coordenadas}</p>
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
