"use client";

import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiService } from "@/lib/api";
import { format, subDays } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"

interface ACIC {
  id: string;
  n_acic: string;
  n_bfs?: string;
  n_cnc?: string;
  status?: string;
  data_fiscalizacao?: string;
  data_sincronizacao?: string;
  data_execucao?: string;
  data_acic?: string;
  data_confirmacao?: string;
  servico?: string;
  responsavel?: string;
  agente_fiscalizador?: string;
  contratada?: string;
  regional?: string;
  area?: string;
  setor?: string;
  turno?: string;
  descricao?: string;
  valor_multa?: number;
  clausula_contratual?: string;
  observacao?: string;
  endereco?: string;
}

export default function ACICPage() {
  const [acics, setAcics] = useState<ACIC[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({
    status: "todos",
    subprefeitura: "todas",
    periodo_inicial: format(subDays(new Date(), 30), "yyyy-MM-dd"),
    periodo_final: format(new Date(), "yyyy-MM-dd"),
  });

  useEffect(() => {
    loadACICs();
  }, [filters]);

  const loadACICs = async () => {
    try {
      setLoading(true);
      // Preparar filtros para API
      const apiFilters: any = {};
      
      if (filters.status && filters.status !== "todos") apiFilters.status = filters.status;
      if (filters.subprefeitura && filters.subprefeitura !== "todas") apiFilters.subprefeitura = filters.subprefeitura;
      if (filters.periodo_inicial) apiFilters.periodo_inicial = filters.periodo_inicial;
      if (filters.periodo_final) apiFilters.periodo_final = filters.periodo_final;
      
      const data = await apiService.getACICs(apiFilters);
      setAcics(data.items || []);
      setTotal(data.total || 0);
    } catch (error) {
      console.error("Erro ao carregar ACICs:", error);
      setAcics([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status?: string) => {
    if (!status) return "bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200";
    const colors: Record<string, string> = {
      "Confirmado": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200 dark:border-green-800",
      "Solicitacao": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800",
      "Cancelado": "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800",
    };
    return colors[status] || "bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200";
  };

  return (
    <MainLayout>
      <div className="space-y-8">
        <div className="relative overflow-hidden rounded-xl bg-linear-to-r from-red-600/10 via-red-600/5 to-transparent p-8 border border-red-200/50 dark:border-red-800/50">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-red-600/10 rounded-full blur-3xl"></div>
          <div className="relative">
            <h1 className="text-4xl font-bold tracking-tight bg-linear-to-r from-red-600 to-rose-500 bg-clip-text text-transparent pb-2">ACICs</h1>
            <p className="text-muted-foreground mt-2 text-lg max-w-2xl">
              Atas de Confirmação de Irregularidades - Registros confirmados de não conformidade.
            </p>
          </div>
        </div>

        {/* Contador e Estatísticas */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-primary">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total de ACICs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-primary">{total}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Total de registros no sistema
              </p>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-muted">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Exibindo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-muted-foreground">{acics.length}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Registros com filtros aplicados
              </p>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-green-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Confirmados</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-green-600 dark:text-green-400">
                {acics.filter(a => a.status === "Confirmado").length}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                ACICs confirmadas
              </p>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-red-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Com Multa</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-red-600 dark:text-red-400">
                {acics.filter(a => a.valor_multa && Number(a.valor_multa) > 0).length}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                ACICs com multa aplicada
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filtros */}
        <Card className="overflow-hidden border-none shadow-sm bg-muted/30">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-filter"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              Filtros Avançados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
                    <SelectItem value="Confirmado">Confirmado</SelectItem>
                    <SelectItem value="Solicitacao">Solicitação</SelectItem>
                    <SelectItem value="Cancelado">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
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
                    <SelectItem value="Santana/Tucuruvi">Santana/Tucuruvi</SelectItem>
                    <SelectItem value="Casa Verde/Cachoeirinha">Casa Verde/Cachoeirinha</SelectItem>
                    <SelectItem value="Jaçanã/Tremembé">Jaçanã/Tremembé</SelectItem>
                    <SelectItem value="Vila Maria/Vila Guilherme">Vila Maria/Vila Guilherme</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Início</label>
                <Input
                  type="date"
                  value={filters.periodo_inicial}
                  onChange={(e) => setFilters({ ...filters, periodo_inicial: e.target.value })}
                  className="bg-background"
                />
              </div>
              
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Fim</label>
                <Input
                  type="date"
                  value={filters.periodo_final}
                  onChange={(e) => setFilters({ ...filters, periodo_final: e.target.value })}
                  className="bg-background"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Lista de ACICs */}
        {loading ? (
          <div className="p-12 text-center text-muted-foreground animate-pulse">Carregando...</div>
        ) : acics.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-file-x text-muted-foreground/50"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m14.5 12.5-5 5"/><path d="m9.5 12.5 5 5"/></svg>
            <p>Nenhuma ACIC encontrada com os filtros atuais</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {acics.map((acic) => (
              <Card key={acic.id} className="hover:shadow-md transition-all duration-200 hover:border-primary/20">
                <CardContent className="p-6">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-bold font-mono text-primary">
                          ACIC: {acic.n_acic || "N/A"}
                        </h3>
                        {acic.status && (
                          <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full border bg-opacity-10 border-opacity-20 ${getStatusColor(acic.status)}`}>
                            {acic.status}
                          </span>
                        )}
                      </div>
                      
                      <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                        {acic.n_bfs && (
                          <span className="flex items-center gap-1 bg-muted/50 px-2 py-0.5 rounded">
                            <span className="font-medium">BFS:</span> {acic.n_bfs}
                          </span>
                        )}
                        {acic.n_cnc && (
                          <span className="flex items-center gap-1 bg-muted/50 px-2 py-0.5 rounded">
                            <span className="font-medium">CNC:</span> {acic.n_cnc}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                    {acic.endereco && (
                      <div className="md:col-span-2 flex items-start gap-2 text-muted-foreground mb-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-map-pin mt-0.5 shrink-0"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                        <span>{acic.endereco}</span>
                      </div>
                    )}
                    
                    {acic.servico && (
                      <div className="flex justify-between border-b border-dashed border-border/50 py-1">
                        <span className="text-muted-foreground">Serviço:</span>
                        <span className="font-medium text-right">{acic.servico}</span>
                      </div>
                    )}
                    {acic.area && (
                      <div className="flex justify-between border-b border-dashed border-border/50 py-1">
                        <span className="text-muted-foreground">Área:</span>
                        <span className="font-medium text-right">{acic.area}</span>
                      </div>
                    )}
                    {acic.agente_fiscalizador && (
                      <div className="flex justify-between border-b border-dashed border-border/50 py-1">
                        <span className="text-muted-foreground">Fiscal:</span>
                        <span className="font-medium text-right">{acic.agente_fiscalizador}</span>
                      </div>
                    )}
                    {acic.valor_multa && Number(acic.valor_multa) > 0 && (
                      <div className="flex justify-between border-b border-dashed border-border/50 py-1">
                        <span className="text-muted-foreground">Multa:</span>
                        <span className="font-bold text-red-600 dark:text-red-400">R$ {Number(acic.valor_multa).toFixed(2)}</span>
                      </div>
                    )}
                    {acic.data_acic && (
                      <div className="flex justify-between border-b border-dashed border-border/50 py-1">
                        <span className="text-muted-foreground">Data:</span>
                        <span className="font-medium text-right">{format(new Date(acic.data_acic), "dd/MM/yyyy HH:mm")}</span>
                      </div>
                    )}
                  </div>

                  {acic.descricao && (
                    <div className="mt-4 p-3 bg-muted/30 rounded-md text-xs border border-border/50">
                      <p className="font-medium mb-1 text-muted-foreground uppercase tracking-wider text-[10px]">Descrição</p>
                      <p className="text-foreground whitespace-pre-wrap leading-relaxed">
                        {acic.descricao}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </MainLayout>
  );
}
