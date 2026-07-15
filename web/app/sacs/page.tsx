"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SpotlightCard } from "@/components/motion-ui/spotlight-card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/motion-ui/motion-dialog";
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
import {
  AlertCircle,
  Bell,
  Calendar,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  MapPin,
  RefreshCw,
  Search,
} from "lucide-react";
import { formatFlipDateTimeUtc, formatFlipDateTimeUtcWithWeekday } from "@/lib/flip-datetime";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** IRD ou bueiros: classificação vazia na planilha — mesma regra de prazo (acionamento / só após finalizar). */
function sacUsesAcionamentoPrazoRules(sac: Pick<SAC, "classificacao_servico">): boolean {
  const c = (sac.classificacao_servico || "").trim();
  return c === "Reclamação" || c === "";
}

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
      tipo: "all" as "IA" | "IRD" | "Bueiros" | "all",
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

  /** Status: só cor + extrabold, sem bolha (centralizado na célula). */
  const getStatusTextClass = (status: string) => {
    const map: Record<string, string> = {
      Finalizado: "text-center text-sm font-extrabold text-emerald-600 dark:text-emerald-400",
      Executado: "text-center text-sm font-extrabold text-emerald-600 dark:text-emerald-400",
      Agendado: "text-center text-sm font-extrabold text-violet-600 dark:text-violet-400",
      "Em andamento": "text-center text-sm font-extrabold text-sky-600 dark:text-sky-400",
      "Em Execução": "text-center text-sm font-extrabold text-blue-600 dark:text-blue-400",
      "Aguardando Agendamento": "text-center text-sm font-extrabold text-amber-700 dark:text-amber-400",
      "Aguardando Análise": "text-center text-sm font-extrabold text-zinc-600 dark:text-zinc-400",
    };
    return map[status] || "text-center text-sm font-extrabold text-foreground";
  };

  const getSituacaoText = (sac: SAC) => {
    if (sac.fora_do_prazo) {
      return {
        label: "Fora do prazo",
        className: "text-center text-sm font-extrabold text-red-600 dark:text-red-400",
      };
    }
    const resp = (sac.responsividade_execucao?.trim() || "").toUpperCase();
    const finalized = Boolean(sac.data_execucao || sac.data_realizacao_confirmacao_execucao);
    if (resp === "SIM") {
      return {
        label: "No prazo",
        className: "text-center text-sm font-extrabold text-emerald-600 dark:text-emerald-400",
      };
    }
    if (resp === "NÃO") {
      if (finalized) {
        return {
          label: "No prazo",
          className: "text-center text-sm font-extrabold text-emerald-600 dark:text-emerald-400",
        };
      }
      return {
        label: "Em andamento",
        className: "text-center text-sm font-extrabold text-sky-600 dark:text-sky-400",
      };
    }
    return {
      label: sac.data_execucao ? "—" : "Em andamento",
      className: "text-center text-sm font-extrabold text-sky-600 dark:text-sky-400",
    };
  };

  const SacDatesCell = ({ sac }: { sac: SAC }) => {
    const fora = sac.fora_do_prazo;
    const sameAgend =
      sac.data_agendamento &&
      sac.data_acionamento_agendamento &&
      sac.data_agendamento === sac.data_acionamento_agendamento;
    return (
      <div className="space-y-1 text-[11px] leading-snug min-w-[10.5rem]">
        <div className="flex gap-1">
          <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" aria-hidden />
          <div>
            <span className="text-muted-foreground font-medium">Registro</span>
            <div className="font-mono tabular-nums">{formatFlipDateTimeUtc(sac.data_criacao)}</div>
          </div>
        </div>
        {sac.data_acionamento_agendamento && (
          <div className="flex gap-1">
            <Bell className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" aria-hidden />
            <div>
              <span className="text-muted-foreground font-medium">Acionam. / agend.</span>
              <div className="font-mono tabular-nums text-amber-800 dark:text-amber-200">
                {formatFlipDateTimeUtc(sac.data_acionamento_agendamento)}
              </div>
            </div>
          </div>
        )}
        {sac.data_agendamento && !sameAgend && (
          <div className="flex gap-1">
            <CalendarClock className="h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-400 mt-0.5" aria-hidden />
            <div>
              <span className="text-muted-foreground font-medium">Agendamento</span>
              <div className="font-mono tabular-nums text-violet-700 dark:text-violet-300">
                {formatFlipDateTimeUtc(sac.data_agendamento)}
              </div>
            </div>
          </div>
        )}
        {(sac.data_realizacao_confirmacao_execucao || sac.data_execucao) && (
          <div className="flex gap-1">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" aria-hidden />
            <div>
              <span className="text-muted-foreground font-medium">Execução / confirmação</span>
              {sac.data_realizacao_confirmacao_execucao && (
                <div className="font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
                  Conf.: {formatFlipDateTimeUtc(sac.data_realizacao_confirmacao_execucao)}
                </div>
              )}
              {sac.data_execucao && (
                <div className="font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
                  Exec.: {formatFlipDateTimeUtc(sac.data_execucao)}
                </div>
              )}
            </div>
          </div>
        )}
        {sac.data_ultima_atualizacao && (
          <div className="flex gap-1">
            <RefreshCw className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" aria-hidden />
            <div>
              <span className="text-muted-foreground font-medium">Últ. atualização</span>
              <div className="font-mono tabular-nums">{formatFlipDateTimeUtc(sac.data_ultima_atualizacao)}</div>
            </div>
          </div>
        )}
        {fora && (
          <div className="mt-1.5 rounded-lg border border-red-300/80 bg-red-500/10 dark:border-red-800 dark:bg-red-950/40 px-2 py-1.5 space-y-0.5">
            <div className="flex items-center gap-1 text-red-700 dark:text-red-300 font-semibold text-[10px] uppercase tracking-wide">
              <AlertCircle className="h-3.5 w-3.5" />
              Fora do prazo — horários
            </div>
            <div className="text-[10px]">
              <span className="text-muted-foreground">Abertura: </span>
              <span className="font-mono font-medium">{formatFlipDateTimeUtc(sac.data_criacao)}</span>
            </div>
            <div className="text-[10px]">
              <span className="text-muted-foreground">Finalização (efetiva): </span>
              <span className="font-mono font-medium text-red-800 dark:text-red-200">
                {formatFlipDateTimeUtc(sac.data_finalizacao_efetiva) || "—"}
              </span>
            </div>
          </div>
        )}
      </div>
    );
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
          <SpotlightCard className="hover:shadow-md transition-all duration-200 border-l-4 border-l-blue-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
              <CardDescription>{periodoLabel}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-blue-600 dark:text-blue-400">{stats.total}</div>
            </CardContent>
          </SpotlightCard>
          
          <SpotlightCard className="hover:shadow-md transition-all duration-200 border-l-4 border-l-indigo-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Demandantes (IA)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-indigo-600 dark:text-indigo-400">{stats.demandantes}</div>
            </CardContent>
          </SpotlightCard>

          <SpotlightCard className="hover:shadow-md transition-all duration-200 border-l-4 border-l-cyan-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Escalonados (IRD)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-cyan-600 dark:text-cyan-400">{stats.escalonados}</div>
            </CardContent>
          </SpotlightCard>

          <SpotlightCard className="hover:shadow-md transition-all duration-200 border-l-4 border-l-green-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">No Prazo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-green-600 dark:text-green-400">{stats.noPrazo}</div>
            </CardContent>
          </SpotlightCard>

          <SpotlightCard className="hover:shadow-md transition-all duration-200 border-l-4 border-l-red-500">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Fora do Prazo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-red-600 dark:text-red-400">{stats.foraPrazo}</div>
            </CardContent>
          </SpotlightCard>
        </div>

        {/* Filtros */}
        <Card className="overflow-visible border-none shadow-sm bg-muted/30">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-filter">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
              Filtros
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-visible">
            {/*
              Em ~1366px com sidebar, 4 colunas espremem triggers/popover. Menos colunas até 2xl + gap maior.
            */}
            <div className="grid grid-cols-1 gap-5 gap-y-6 min-[560px]:grid-cols-2 min-[1180px]:grid-cols-3 2xl:grid-cols-4 [&>*]:min-w-0">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Período Inicial</Label>
                <DatePicker
                  value={filters.data_inicio}
                  onChange={(value) => patchFilters({ data_inicio: value })}
                  placeholder="Selecionar início"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Período Final</Label>
                <DatePicker
                  value={filters.data_fim}
                  onChange={(value) => patchFilters({ data_fim: value })}
                  placeholder="Selecionar fim"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Tipo</Label>
                <Select
                  value={filters.tipo}
                  onValueChange={(value: "IA" | "IRD" | "Bueiros" | "all") => patchFilters({ tipo: value })}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="IA">IA - Solicitações</SelectItem>
                    <SelectItem value="IRD">IRD - Reclamações</SelectItem>
                    <SelectItem value="Bueiros">Bueiros (classificação vazia)</SelectItem>
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
                    <SelectItem value="Finalizado">Finalizado (com exec./confirmação)</SelectItem>
                    <SelectItem value="Agendado">Agendado</SelectItem>
                    <SelectItem value="Aguardando Análise">Aguardando Análise</SelectItem>
                    <SelectItem value="Aguardando Agendamento">Aguardando Agendamento</SelectItem>
                    <SelectItem value="Em Execução">Em Execução</SelectItem>
                    <SelectItem value="Executado">Executado (mesmo filtro que Finalizado)</SelectItem>
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

              <div className="col-span-full space-y-1.5 w-full min-w-0 pt-1">
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
                      <th className="px-6 py-3 font-medium uppercase text-xs tracking-wider min-w-[11rem]">
                        Linha do tempo
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sacs.map((sac) => (
                      <Fragment key={sac.id}>
                        <tr
                          className={`hover:bg-muted/50 transition-colors cursor-pointer ${
                            sac.fora_do_prazo ? "bg-red-50/50 dark:bg-red-900/10" : ""
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
                          <td className="px-6 py-4 align-middle">
                            <p className={getStatusTextClass(sac.status)}>{sac.status}</p>
                          </td>
                          <td className="px-6 py-4 text-center text-muted-foreground">
                            {sac.classificacao_servico || "—"}
                          </td>
                          <td className="px-6 py-4 align-middle">
                            {(() => {
                              const sit = getSituacaoText(sac);
                              return <p className={sit.className}>{sit.label}</p>;
                            })()}
                          </td>
                          <td className="px-6 py-4 align-top text-muted-foreground">
                            <SacDatesCell sac={sac} />
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
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <ClipboardList className="h-5 w-5 text-primary shrink-0" />
                SAC {selectedSAC?.protocolo}
              </DialogTitle>
              <DialogDescription>
                Datas em horário de Brasília. O status exibido combina a planilha com a existência de data de execução ou
                confirmação — evita “Finalizado” sem evidência na base.
              </DialogDescription>
            </DialogHeader>
            {selectedSAC && (
              <div className="space-y-6">
                <div className="rounded-xl border border-border/80 bg-muted/25 p-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                    <ClipboardList className="h-4 w-4" />
                    Identificação e situação
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Protocolo</p>
                      <p className="text-sm font-mono font-semibold">{selectedSAC.protocolo}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Status (derivado)</p>
                      <p className={getStatusTextClass(selectedSAC.status)}>{selectedSAC.status}</p>
                      {selectedSAC.status_planilha && selectedSAC.status_planilha !== selectedSAC.status && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Planilha: <span className="font-medium text-foreground">{selectedSAC.status_planilha}</span>
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Tipo de serviço</p>
                      <p className="text-sm">{selectedSAC.tipo_servico}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Subprefeitura</p>
                      <p className="text-sm">{selectedSAC.subprefeitura}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">
                        Classificação (IA / IRD; bueiro costuma vir vazio)
                      </p>
                      <p className="text-sm">{selectedSAC.classificacao_servico || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Responsividade (planilha)</p>
                      <p className="text-sm">
                        {selectedSAC.responsividade_execucao || "—"}
                        <span className="text-muted-foreground text-xs block mt-0.5">
                          SIM = no prazo · NÃO = fora do prazo
                        </span>
                      </p>
                    </div>
                    <div className="sm:col-span-2">
                      <p className="text-xs text-muted-foreground mb-0.5">Prazo / medição</p>
                      {(() => {
                        const sit = getSituacaoText(selectedSAC);
                        return (
                          <div className="space-y-1">
                            <p className={sit.className}>{sit.label}</p>
                            {sacUsesAcionamentoPrazoRules(selectedSAC) &&
                              selectedSAC.data_acionamento_agendamento && (
                                <p className="text-[11px] text-muted-foreground leading-snug">
                                  IRD / bueiros: em aberto não entra como fora do prazo; após{" "}
                                  <strong>finalização</strong>, compara-se o dia da execução à data de{" "}
                                  <strong>acionamento/agendamento</strong> da planilha.
                                </p>
                              )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-border/80 bg-card p-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Linha do tempo
                  </p>
                  {(() => {
                    type Step = { key: string; icon: ReactNode; title: string; hint: string; body: ReactNode };
                    const steps: Step[] = [
                      {
                        key: "reg",
                        icon: <Calendar className="h-5 w-5 shrink-0 text-muted-foreground" />,
                        title: "Registro do chamado",
                        hint: "Data de abertura na base FLIP",
                        body: (
                          <p className="font-mono text-sm mt-0.5">
                            {formatFlipDateTimeUtcWithWeekday(selectedSAC.data_criacao)}
                          </p>
                        ),
                      },
                    ];
                    if (selectedSAC.data_acionamento_agendamento) {
                      steps.push({
                        key: "acion",
                        icon: <Bell className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />,
                        title: "Acionamento / agendamento",
                        hint: "Serviço agendado. Referência de prazo após finalização",
                        body: (
                          <p className="font-mono text-sm mt-0.5 text-amber-900 dark:text-amber-100">
                            {formatFlipDateTimeUtcWithWeekday(selectedSAC.data_acionamento_agendamento)}
                          </p>
                        ),
                      });
                    }
                    const sameAgend =
                      selectedSAC.data_agendamento &&
                      selectedSAC.data_acionamento_agendamento &&
                      selectedSAC.data_agendamento === selectedSAC.data_acionamento_agendamento;
                    if (selectedSAC.data_agendamento && !sameAgend) {
                      steps.push({
                        key: "ag",
                        icon: <CalendarClock className="h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400" />,
                        title: "Agendamento (visita / execução)",
                        hint: "Quando informado na planilha além do acionamento",
                        body: (
                          <p className="font-mono text-sm mt-0.5 text-violet-800 dark:text-violet-200">
                            {formatFlipDateTimeUtcWithWeekday(selectedSAC.data_agendamento)}
                          </p>
                        ),
                      });
                    }
                    if (selectedSAC.data_realizacao_confirmacao_execucao || selectedSAC.data_execucao) {
                      steps.push({
                        key: "ex",
                        icon: <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />,
                        title: "Execução e confirmação",
                        hint: "Confirmação de realização e/ou data de execução na planilha",
                        body: (
                          <div className="space-y-1 mt-0.5">
                            {selectedSAC.data_realizacao_confirmacao_execucao && (
                              <p className="font-mono text-sm text-emerald-800 dark:text-emerald-200">
                                Confirmação:{" "}
                                {formatFlipDateTimeUtcWithWeekday(selectedSAC.data_realizacao_confirmacao_execucao)}
                              </p>
                            )}
                            {selectedSAC.data_execucao && (
                              <p className="font-mono text-sm text-emerald-800 dark:text-emerald-200">
                                Execução: {formatFlipDateTimeUtcWithWeekday(selectedSAC.data_execucao)}
                              </p>
                            )}
                          </div>
                        ),
                      });
                    }
                    if (selectedSAC.data_ultima_atualizacao) {
                      steps.push({
                        key: "ult",
                        icon: <RefreshCw className="h-5 w-5 shrink-0 text-muted-foreground" />,
                        title: "Última atualização do registro",
                        hint: "Última movimentação informada na planilha",
                        body: (
                          <p className="font-mono text-sm mt-0.5">
                            {formatFlipDateTimeUtcWithWeekday(selectedSAC.data_ultima_atualizacao)}
                          </p>
                        ),
                      });
                    }
                    return (
                      <>
                        <div className="space-y-0">
                          {steps.map((step, i) => (
                            <div key={step.key} className="flex gap-0">
                              <div className="flex w-9 shrink-0 flex-col items-center pt-1">
                                <div className="z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-card shadow-sm">
                                  <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />
                                </div>
                                {i < steps.length - 1 && (
                                  <div className="w-px flex-1 min-h-[1.75rem] bg-border" aria-hidden />
                                )}
                              </div>
                              <div className="min-w-0 flex-1 flex gap-3 pb-8 pt-0.5 last:pb-2">
                                {step.icon}
                                <div className="min-w-0">
                                  <p className="font-medium text-foreground">{step.title}</p>
                                  <p className="text-xs text-muted-foreground">{step.hint}</p>
                                  {step.body}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        {selectedSAC.fora_do_prazo && (
                          <div className="rounded-lg border border-red-300/80 bg-red-500/10 dark:bg-red-950/35 p-3 text-sm space-y-1">
                            <p className="font-semibold text-red-800 dark:text-red-200 flex items-center gap-2">
                              <AlertCircle className="h-4 w-4 shrink-0" />
                              Fora do prazo — horários para conferência
                            </p>
                            <p className="text-xs text-red-900/90 dark:text-red-100/90">
                              <span className="text-muted-foreground dark:text-red-200/80">Registro: </span>
                              <span className="font-mono font-medium">{formatFlipDateTimeUtc(selectedSAC.data_criacao)}</span>
                            </p>
                            {selectedSAC.data_acionamento_agendamento && (
                              <p className="text-xs text-red-900/90 dark:text-red-100/90">
                                <span className="text-muted-foreground dark:text-red-200/80">Acionam. / agend.: </span>
                                <span className="font-mono font-medium">
                                  {formatFlipDateTimeUtc(selectedSAC.data_acionamento_agendamento)}
                                </span>
                              </p>
                            )}
                            <p className="text-xs text-red-900/90 dark:text-red-100/90">
                              <span className="text-muted-foreground dark:text-red-200/80">Finalização efetiva: </span>
                              <span className="font-mono font-semibold">
                                {formatFlipDateTimeUtc(selectedSAC.data_finalizacao_efetiva) || "—"}
                              </span>
                            </p>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                <div className="rounded-xl border border-border/80 bg-muted/15 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2 mb-2">
                    <MapPin className="h-4 w-4" />
                    Local
                  </p>
                  <p className="text-sm leading-relaxed">{selectedSAC.endereco_text}</p>
                  {selectedSAC.lat != null && selectedSAC.lng != null && (
                    <p className="text-xs font-mono text-muted-foreground mt-2">
                      {selectedSAC.lat}, {selectedSAC.lng}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <span className="font-medium text-foreground">Procedência: </span>
                    {selectedSAC.procedente_por_status || "—"}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Fora de escopo: </span>
                    {selectedSAC.finalizado_fora_de_escopo || "—"}
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
