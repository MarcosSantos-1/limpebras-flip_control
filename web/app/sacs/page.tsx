"use client";

import { useEffect, useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiService, SAC } from "@/lib/api";
import { endOfMonth, format, startOfMonth } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { TIPOS_DEMANDANTES, TIPOS_ESCALONADOS, STATUS_PROCEDENTES } from "@/constants/sacs"

export default function SACsPage() {
  const [sacs, setSacs] = useState<SAC[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState(() => {
    const now = new Date();
    return {
      status: "todos",
      tipo_servico: "todos",
      categoria_tipo: "todas", // "escalonados", "demandantes", "outros"
      subprefeitura: "todas",
      data_inicio: format(startOfMonth(now), "yyyy-MM-dd"),
      data_fim: format(endOfMonth(now), "yyyy-MM-dd"),
      fora_prazo: false,
    };
  });

  const periodoLabel = useMemo(() => {
    if (!filters.data_inicio || !filters.data_fim) return "Sem período definido";
    const inicio = format(new Date(filters.data_inicio), "dd/MM/yyyy");
    const fim = format(new Date(filters.data_fim), "dd/MM/yyyy");
    return `${inicio} → ${fim}`;
  }, [filters.data_inicio, filters.data_fim]);

  const demandantesProcedentes = useMemo(
    () =>
      sacs.filter(
        (s) => TIPOS_DEMANDANTES.includes(s.tipo_servico) && STATUS_PROCEDENTES.includes(s.status)
      ),
    [sacs]
  );

  const demandantesNoPrazo = useMemo(
    () => demandantesProcedentes.filter((s) => !s.fora_do_prazo),
    [demandantesProcedentes]
  );

  const demandantesForaPrazo = useMemo(
    () => demandantesProcedentes.filter((s) => s.fora_do_prazo),
    [demandantesProcedentes]
  );

  const escalonadosProcedentes = useMemo(
    () =>
      sacs.filter(
        (s) => TIPOS_ESCALONADOS.includes(s.tipo_servico) && STATUS_PROCEDENTES.includes(s.status)
      ),
    [sacs]
  );

  useEffect(() => {
    loadSACs();
  }, [filters]);

  const loadSACs = async () => {
    try {
      setLoading(true);
      // Preparar filtros para API
      const apiFilters: any = {
        page: 1,
        page_size: 100,
        full: true, // força a API a retornar todos os registros do período
      };
      
      if (filters.status && filters.status !== "todos") apiFilters.status = filters.status;
      if (filters.subprefeitura && filters.subprefeitura !== "todas") apiFilters.subprefeitura = filters.subprefeitura;
      if (filters.fora_prazo) apiFilters.fora_do_prazo = true;
      
      // Converter datas para formato ISO se fornecidas
      if (filters.data_inicio) {
        const dataInicio = new Date(filters.data_inicio);
        dataInicio.setHours(0, 0, 0, 0);
        apiFilters.data_inicio = dataInicio.toISOString();
      }
      if (filters.data_fim) {
        const dataFim = new Date(filters.data_fim);
        dataFim.setHours(23, 59, 59, 999);
        apiFilters.data_fim = dataFim.toISOString();
      }
      
      // Se categoria_tipo está selecionada, não filtrar por tipo específico na API
      // Vamos filtrar no frontend depois
      if (filters.categoria_tipo === "todas" && filters.tipo_servico !== "todos") {
        apiFilters.tipo_servico = filters.tipo_servico;
      }
      
      console.log("Carregando SACs com filtros:", apiFilters);
      const data = await apiService.getSACs(apiFilters);
      console.log("Dados recebidos:", data);
      
      let filteredSacs = (data.items || []) as SAC[];
      
      // Filtrar por categoria se necessário (filtro no frontend)
      if (filters.categoria_tipo !== "todas") {
        if (filters.categoria_tipo === "escalonados") {
          filteredSacs = filteredSacs.filter(s => TIPOS_ESCALONADOS.includes(s.tipo_servico));
        } else if (filters.categoria_tipo === "demandantes") {
          filteredSacs = filteredSacs.filter(s => TIPOS_DEMANDANTES.includes(s.tipo_servico));
        } else if (filters.categoria_tipo === "outros") {
          // Outros são serviços que não estão em nenhuma categoria específica
          filteredSacs = filteredSacs.filter(s => 
            !TIPOS_ESCALONADOS.includes(s.tipo_servico) && 
            !TIPOS_DEMANDANTES.includes(s.tipo_servico)
          );
        }
      }
      
      setSacs(filteredSacs);
      setTotal(data.total || 0);
    } catch (error) {
      console.error("Erro ao carregar SACs:", error);
      setSacs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      "Em Execução": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
      "Aguardando Agendamento": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
      "Executado": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
      "Finalizado": "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300",
    };
    return colors[status] || "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300";
  };

  return (
    <MainLayout>
      <div className="space-y-8">
        <div className="relative overflow-hidden rounded-xl bg-linear-to-r from-blue-600/10 via-blue-600/5 to-transparent p-8 border border-blue-200/50 dark:border-blue-800/50">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-blue-600/10 rounded-full blur-3xl"></div>
          <div className="relative">
            <h1 className="text-4xl font-bold tracking-tight bg-linear-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent pb-2">SACs</h1>
            <p className="text-muted-foreground mt-2 text-lg max-w-2xl">
              Sistema de Atendimento ao Cidadão - Solicitações de serviços de limpeza urbana.
            </p>
            
            <div className="mt-6 flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-green-100/50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800/50">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                No prazo: <span className="font-bold">{demandantesNoPrazo.length}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-red-100/50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800/50">
                <span className="w-2 h-2 rounded-full bg-red-500"></span>
                Fora do prazo: <span className="font-bold">{demandantesForaPrazo.length}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Contador e Estatísticas Principais */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-blue-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total do período</CardTitle>
              <CardDescription>{periodoLabel}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-blue-600 dark:text-blue-400">{total}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Registros disponíveis na base
              </p>
            </CardContent>
          </Card>
          
          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-indigo-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Demandantes Procedentes (IA)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-indigo-600 dark:text-indigo-400">{demandantesProcedentes.length}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Entulho, Animal Morto e Papeleiras
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-cyan-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Escalonados Procedentes (IRD)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-cyan-600 dark:text-cyan-400">{escalonadosProcedentes.length}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Cata-Bagulho, Varrição, Mutirão, etc.
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
                    <SelectItem value="Aguardando Análise">Aguardando Análise</SelectItem>
                    <SelectItem value="Aguardando Agendamento">Aguardando Agendamento</SelectItem>
                    <SelectItem value="Em Execução">Em Execução</SelectItem>
                    <SelectItem value="Executado">Executado</SelectItem>
                    <SelectItem value="Finalizado">Finalizado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Categoria</label>
                <Select
                  value={filters.categoria_tipo}
                  onValueChange={(value) => setFilters({ ...filters, categoria_tipo: value, tipo_servico: "todos" })}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas</SelectItem>
                    <SelectItem value="escalonados">Escalonados</SelectItem>
                    <SelectItem value="demandantes">Demandantes</SelectItem>
                    <SelectItem value="outros">Outros</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Serviço Específico</label>
                <Select
                  value={filters.tipo_servico}
                  onValueChange={(value) => setFilters({ ...filters, tipo_servico: value, categoria_tipo: "todas" })}
                  disabled={filters.categoria_tipo !== "todas"}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="ENTULHO">Coleta de entulho e G.O</SelectItem>
                    <SelectItem value="ANIMAL_MORTO">Remoção de Animal Morto</SelectItem>
                    <SelectItem value="PAPELEIRAS">Papeleiras</SelectItem>
                    <SelectItem value="CATABAGULHO">Cata-Bagulho</SelectItem>
                    <SelectItem value="VARRIACAO_COLETA">Coleta de Varrição</SelectItem>
                    <SelectItem value="MUTIRAO">Mutirão</SelectItem>
                    <SelectItem value="LAVAGEM">Lavagem</SelectItem>
                    <SelectItem value="BUEIRO">Limpeza de Bueiros</SelectItem>
                    <SelectItem value="VARRIACAO">Varrição</SelectItem>
                    <SelectItem value="VARRIACAO_PRACAS">Varrição de Praças</SelectItem>
                    <SelectItem value="MONUMENTOS">Monumentos</SelectItem>
                    <SelectItem value="OUTROS">Outros</SelectItem>
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
                    <SelectItem value="CV">Casa Verde/Cachoeirinha</SelectItem>
                    <SelectItem value="JT">Jaçanã/Tremembé</SelectItem>
                    <SelectItem value="ST">Santana/Tucuruvi</SelectItem>
                    <SelectItem value="MG">Vila Maria/Vila Guilherme</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Início</label>
                <Input
                  type="date"
                  value={filters.data_inicio}
                  onChange={(e) => setFilters({ ...filters, data_inicio: e.target.value })}
                  className="bg-background"
                />
              </div>
              
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Fim</label>
                <Input
                  type="date"
                  value={filters.data_fim}
                  onChange={(e) => setFilters({ ...filters, data_fim: e.target.value })}
                  className="bg-background"
                />
              </div>

              <div className="flex items-end pb-2">
                <div className="flex items-center gap-2">
                  <input
                    id="fora-prazo"
                    type="checkbox"
                    checked={filters.fora_prazo}
                    onChange={(e) => setFilters({ ...filters, fora_prazo: e.target.checked })}
                    className="h-4 w-4 accent-primary rounded border-input"
                  />
                  <label htmlFor="fora-prazo" className="text-sm text-muted-foreground cursor-pointer select-none">
                    Apenas fora do prazo
                  </label>
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
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-inbox"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
              <p>Nenhum SAC encontrado com os filtros atuais</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground border-b border-border">
                  <tr>
                    <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Protocolo</th>
                    <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Tipo</th>
                    <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Endereço</th>
                    <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Status</th>
                    <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider text-center">Prazo</th>
                    <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider text-center">Execução</th>
                    <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider text-center">Situação</th>
                    <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Datas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sacs.map((sac) => (
                    <tr
                      key={sac.id}
                      className={`hover:bg-muted/50 transition-colors ${
                        sac.fora_do_prazo ? "bg-red-50/50 dark:bg-red-900/10" : ""
                      }`}
                    >
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
                        {sac.prazo_max_hours}h
                      </td>
                      <td className="px-6 py-4 text-center font-medium">
                        {sac.horas_ate_execucao !== null && sac.horas_ate_execucao !== undefined
                          ? `${sac.horas_ate_execucao}h`
                          : "—"}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {sac.horas_ate_execucao === null || sac.horas_ate_execucao === undefined ? (
                          <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                            Em andamento
                          </span>
                        ) : sac.fora_do_prazo ? (
                          <span className="px-2 py-1 text-xs font-semibold rounded-md bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800">
                            Fora do prazo
                          </span>
                        ) : (
                          <span className="px-2 py-1 text-xs font-medium rounded-md bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800">
                            No prazo
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
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}

