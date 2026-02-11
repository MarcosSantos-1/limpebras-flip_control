"use client";

import { useState, useEffect, useMemo } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiService, CNC } from "@/lib/api";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function BFSPage() {
  const [bfss, setBfss] = useState<CNC[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), "yyyy-MM"));

  const monthLabel = useMemo(() => {
    if (!selectedMonth) return "Período não definido";
    const monthDate = new Date(`${selectedMonth}-01T00:00:00`);
    return format(monthDate, "MMMM yyyy", { locale: ptBR });
  }, [selectedMonth]);

  const urgentCount = useMemo(
    () => bfss.filter((bfs) => bfs.status?.toLowerCase() === "urgente").length,
    [bfss]
  );

  useEffect(() => {
    loadBFSs();
  }, [selectedMonth]);

  const loadBFSs = async () => {
    try {
      setLoading(true);
      const params: Record<string, any> = { full: true };
      if (selectedMonth) params.mes_referencia = selectedMonth;
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

  const handleMonthChange = (value: string) => {
    setSelectedMonth(value);
  };

  const formatStatus = (status?: string) => {
    if (!status) return "—";
    if (status === status.toLowerCase()) {
      return status.charAt(0).toUpperCase() + status.slice(1);
    }
    return status;
  };

  return (
    <MainLayout>
      <div className="space-y-8">
        <div className="relative overflow-hidden rounded-xl bg-linear-to-r from-orange-600/10 via-orange-600/5 to-transparent p-8 border border-orange-200/50 dark:border-orange-800/50">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-orange-600/10 rounded-full blur-3xl"></div>
          <div className="relative">
            <h1 className="text-4xl font-bold tracking-tight bg-linear-to-r from-orange-600 to-amber-500 bg-clip-text text-transparent pb-2">BFSs</h1>
            <p className="text-muted-foreground mt-2 text-lg max-w-2xl">
              Boletins de Fiscalização - registros consolidados por mês de referência.
            </p>
          </div>
        </div>

        {/* Contador e Estatísticas */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-orange-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total no mês ({monthLabel})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-orange-600 dark:text-orange-400">{total}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Registros de BFS dentro do período selecionado
              </p>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-amber-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Exibindo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-amber-600 dark:text-amber-400">{bfss.length}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Lista completa sem limitação de registros
              </p>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-red-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Urgentes detectadas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-red-600 dark:text-red-400">{urgentCount}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Sem necessidade de alternar a visualização
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filtros */}
        <Card className="overflow-hidden border-none shadow-sm bg-muted/30">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-calendar"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
              Filtro de Competência
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Competência (mês)</label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(event) => handleMonthChange(event.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <p className="text-xs text-muted-foreground">
                  Exibindo registros de {monthLabel}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Lista de BFSs */}
        {loading ? (
          <div className="p-12 text-center text-muted-foreground animate-pulse">Carregando...</div>
        ) : bfss.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-check-circle text-green-500"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <p className="text-lg font-medium text-foreground">
              Nenhuma BFS encontrada para {monthLabel}.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {bfss.map((bfs) => {
              const isUrgente = bfs.status?.toLowerCase() === "urgente";
              return (
                <Card
                  key={bfs.id}
                  className={`hover:shadow-md transition-all duration-200 ${
                    isUrgente ? "border-destructive/50 bg-destructive/5" : "hover:border-primary/20"
                  }`}
                >
                  <CardContent className="p-6">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="text-lg font-bold font-mono text-primary">BFS: {bfs.bfs}</h3>
                          {isUrgente && (
                            <span className="px-2.5 py-0.5 bg-destructive/15 text-destructive text-xs font-bold uppercase tracking-wider rounded-full border border-destructive/20">
                              Urgente
                            </span>
                          )}
                          <span className="px-2.5 py-0.5 bg-muted text-muted-foreground text-xs font-medium rounded-full border border-border">
                            {formatStatus(bfs.status)}
                          </span>
                        </div>
                        
                        <div className="flex items-start gap-2 text-sm text-muted-foreground">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-map-pin mt-0.5 shrink-0"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                          <span>{bfs.endereco || "Endereço não informado"}</span>
                        </div>

                        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground pt-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">Subprefeitura:</span> {bfs.subprefeitura}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">Prazo:</span> {bfs.prazo_hours}h
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">Abertura:</span> {format(new Date(bfs.data_abertura), "dd/MM/yyyy HH:mm")}
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </MainLayout>
  );
}
