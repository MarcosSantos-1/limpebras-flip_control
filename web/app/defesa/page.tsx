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
  status: string;
  data_abertura: string;
  endereco?: string;
  tipo_servico?: string;
  fiscal?: string;
  sem_irregularidade?: boolean;
  data_vistoria?: string;
  cnc_detalhes?: CncDetalhe[];
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
    const comCnc = bfss.filter((b) => (b.cnc_detalhes?.length ?? 0) > 0).length;
    return {
      total: bfss.length,
      comCnc,
      semCnc: bfss.length - comCnc,
    };
  }, [bfss]);

  useEffect(() => {
    loadBFSs();
  }, [filters]);

  const loadBFSs = async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};

      if (filters.periodo_inicial) params.periodo_inicial = filters.periodo_inicial;
      if (filters.periodo_final) params.periodo_final = filters.periodo_final;
      if (filters.subprefeitura !== "todas") params.subprefeitura = filters.subprefeitura;
      if (filters.status !== "todos") params.status = filters.status;
      if (filters.tipo_servico !== "todos") params.tipo_servico = filters.tipo_servico;

      const data = await apiService.getCNCsDefesa(params);
      setBfss(data.items || []);
      setTotal(data.total || 0);
    } catch (error) {
      console.error("Erro ao carregar BFSs para Defesa:", error);
      setBfss([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  const formatStatus = (status?: string) => status || "—";

  const getStatusColor = (status: string) => {
    if ((status || "").toLowerCase().includes("regularizado")) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    if ((status || "").toLowerCase().includes("notificado")) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
    if ((status || "").toLowerCase().includes("respondido")) return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    if ((status || "").toLowerCase().includes("autuado")) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    return "bg-muted text-muted-foreground";
  };

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

        {/* Estatísticas */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-violet-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total no período
              </CardTitle>
              <CardDescription>{periodoLabel}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-violet-600 dark:text-violet-400">{stats.total}</div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-green-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Com dados CNC
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-green-600 dark:text-green-400">{stats.comCnc}</div>
              <p className="text-xs text-muted-foreground mt-1">Data execução, fiscal contratada, etc.</p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-all duration-200 border-l-4 border-l-amber-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Sem CNC importado
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-amber-600 dark:text-amber-400">{stats.semCnc}</div>
              <p className="text-xs text-muted-foreground mt-1">Importe FLIP_CONSULTA_CNC para cruzar</p>
            </CardContent>
          </Card>
        </div>

        {/* Filtros */}
        <Card className="overflow-hidden border-none shadow-sm bg-muted/30">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium flex items-center gap-2">Filtros</CardTitle>
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
                <label className="text-xs font-medium text-muted-foreground">Status CNC</label>
                <Select
                  value={filters.status}
                  onValueChange={(value) => setFilters({ ...filters, status: value })}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="Regularizado">Regularizado</SelectItem>
                    <SelectItem value="Respondido">Respondido</SelectItem>
                    <SelectItem value="Notificado">Notificado</SelectItem>
                    <SelectItem value="Autuado">Autuado</SelectItem>
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
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Situação CNC</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Tipo Serviço</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">SUB</th>
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider">Data Registro</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {bfss.map((bfs) => {
                      const cnc = primaryCnc(bfs);
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
                            <td className="px-6 py-4 text-muted-foreground">{cnc?.setor || bfs.setor || "—"}</td>
                            <td className="px-6 py-4">
                              {cnc?.situacao_cnc ? (
                                <span
                                  className={`inline-flex items-center justify-center min-w-6 h-6 px-2 text-xs font-semibold rounded-full ${getStatusColor(cnc.situacao_cnc)}`}
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
                                  <div className="md:col-span-3"><strong>Endereço:</strong> {bfs.endereco || "—"}</div>
                                  {(bfs.cnc_detalhes?.length ?? 0) > 0 && (
                                    <div className="md:col-span-3 space-y-2">
                                      <strong>CNCs vinculadas:</strong>
                                      {bfs.cnc_detalhes!.map((c, i) => (
                                        <div key={i} className="pl-2 border-l-2 border-violet-300 dark:border-violet-700">
                                          <span>Nº {c.numero_cnc} — {c.situacao_cnc} — Registro: {c.data_sincronizacao ? format(new Date(c.data_sincronizacao), "dd/MM/yyyy HH:mm") : "—"} — Execução: {c.data_execucao ? format(new Date(c.data_execucao), "dd/MM/yyyy HH:mm") : "—"}
                                          </span>
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

        {/* Modal */}
        <Dialog open={!!selectedBFS} onOpenChange={() => setSelectedBFS(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Detalhes - BFS {selectedBFS?.bfs}</DialogTitle>
              <DialogDescription>Informações para relatório de Defesa/Contestação</DialogDescription>
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
                    <p className="text-sm">{formatStatus(selectedBFS.status)}</p>
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
                    <label className="text-sm font-medium text-muted-foreground">Data Registro</label>
                    <p className="text-sm">
                      {selectedBFS.data_abertura
                        ? format(new Date(selectedBFS.data_abertura), "dd/MM/yyyy HH:mm")
                        : "—"}
                    </p>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Endereço</label>
                  <p className="text-sm">{selectedBFS.endereco || "—"}</p>
                </div>
                {(selectedBFS.cnc_detalhes?.length ?? 0) > 0 && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Dados CNC</label>
                    <div className="mt-2 space-y-2 border rounded-lg p-3 bg-muted/30">
                      {selectedBFS.cnc_detalhes!.map((c, i) => (
                        <div key={i} className="text-sm space-y-1">
                          <p><strong>Nº CNC:</strong> {c.numero_cnc}</p>
                          <p><strong>Situação:</strong> {c.situacao_cnc}</p>
                          <p><strong>Setor:</strong> {c.setor || "—"}</p>
                          <p><strong>Data Registro:</strong> {c.data_sincronizacao ? format(new Date(c.data_sincronizacao), "dd/MM/yyyy HH:mm") : "—"}</p>
                          <p><strong>Data Execução:</strong> {c.data_execucao ? format(new Date(c.data_execucao), "dd/MM/yyyy HH:mm") : "—"}</p>
                          <p><strong>Fiscal Contratada:</strong> {c.fiscal_contratada || "—"}</p>
                          <p><strong>Responsividade:</strong> {c.responsividade || "—"}</p>
                          {c.coordenada && <p><strong>Coordenada:</strong> <code className="text-xs">{c.coordenada}</code></p>}
                        </div>
                      ))}
                    </div>
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
