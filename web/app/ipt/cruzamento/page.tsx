"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import {
  Network,
  ArrowLeft,
  AlertTriangle,
  Search,
  Download,
  CalendarRange,
  TrendingDown,
  Layers,
  MapPin,
  Loader2,
  Battery,
  Users,
  FileWarning,
  HelpCircle,
  CheckCircle2,
  RefreshCw,
  Construction,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { MainLayout } from "@/components/layout/main-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { apiService, type IptPreviewResponse } from "@/lib/api";
import { SUBPREFEITURAS, subprefBadgeClass } from "@/lib/mock/ipt-shared";
import { getSubFromPlano } from "@/lib/ipt-utils";
import {
  buildCruzamento,
  ROOT_CAUSE_META,
  STATUS_META,
  type ObservacoesMap,
  type RootCause,
  type SectorAnalysis,
} from "@/lib/cruzamento-engine";
import { exportCruzamentoPlanoAcao } from "@/lib/cruzamento-export";
import { cn } from "@/lib/utils";

/** Janela padrão de análise: a partir de 01/mai (abril = troca de plano, ignorado). */
function maioInicio(ref: Date): Date {
  const candidato = new Date(ref.getFullYear(), 4, 1); // maio = índice 4
  if (candidato > ref) candidato.setFullYear(ref.getFullYear() - 1);
  return startOfDay(candidato);
}

const CAUSA_ORDER: RootCause[] = ["operacao", "bateria", "cadastro", "nunca"];

const CAUSA_ICON: Record<RootCause, typeof Users> = {
  operacao: Users,
  bateria: Battery,
  cadastro: FileWarning,
  nunca: HelpCircle,
  ok: CheckCircle2,
};

const CAUSA_TINT: Record<RootCause, { card: string; chip: string; bar: string }> = {
  operacao: { card: "bg-rose-500", chip: "border-rose-500/40 bg-rose-500/12 text-rose-700 dark:text-rose-300", bar: "#f43f5e" },
  bateria: { card: "bg-violet-500", chip: "border-violet-500/40 bg-violet-500/12 text-violet-700 dark:text-violet-300", bar: "#8b5cf6" },
  cadastro: { card: "bg-cyan-500", chip: "border-cyan-500/40 bg-cyan-500/12 text-cyan-700 dark:text-cyan-300", bar: "#06b6d4" },
  nunca: { card: "bg-amber-500", chip: "border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300", bar: "#f59e0b" },
  ok: { card: "bg-emerald-500", chip: "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", bar: "#10b981" },
};

const fmtInt = (v: number) => Math.round(v).toLocaleString("pt-BR");
const fmtPct = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);

/** Cores da célula do heatmap diário (a partir do detalhe cru). */
function celulaEstado(d: SectorAnalysis["detalhes"][number]): { className: string; label: string; pct: number | null } {
  if (!d.esperado) return { className: "bg-muted-foreground/15", label: "Sem previsão", pct: null };
  const pct = d.percentual_selimp;
  if ((d.despachos_selimp ?? 0) === 0) return { className: "bg-rose-500", label: "Não despachado", pct: null };
  if (pct != null && pct <= 0) return { className: "bg-rose-400", label: "Zerado (0%)", pct: 0 };
  if (pct != null && pct < 50) return { className: "bg-amber-400", label: "Parcial", pct };
  return { className: "bg-emerald-500", label: "Executado", pct };
}

/** Overlay diagonal repetido "EM DESENVOLVIMENTO" — não captura cliques. */
function DevWatermark({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 z-30 overflow-hidden select-none", className)}
    >
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 -rotate-[18deg] flex-col gap-6 opacity-[0.10]">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex gap-8 whitespace-nowrap text-2xl font-black uppercase tracking-widest">
            {Array.from({ length: 6 }).map((__, j) => (
              <span key={j}>Em desenvolvimento</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Chip de aviso "em desenvolvimento". */
function DevBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-400/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300",
        className
      )}
    >
      <Construction className="h-3 w-3" />
      Em desenvolvimento
    </span>
  );
}

export default function CruzamentoPage() {
  const hoje = useMemo(() => startOfDay(new Date()), []);
  const inicioPadrao = useMemo(() => maioInicio(hoje), [hoje]);

  const [range, setRange] = useState<DateRange | undefined>({ from: inicioPadrao, to: hoje });
  const [sub, setSub] = useState("all");
  const [serv, setServ] = useState("all");
  const [causaFiltro, setCausaFiltro] = useState<RootCause | "all">("all");
  const [apenasComPrevisao, setApenasComPrevisao] = useState(true);
  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState<SectorAnalysis | null>(null);

  const [preview, setPreview] = useState<IptPreviewResponse | null>(null);
  const [obs, setObs] = useState<ObservacoesMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [salvandoCausa, setSalvandoCausa] = useState(false);

  const from = range?.from ?? inicioPadrao;
  const to = range?.to ?? hoje;

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const inicio = format(from, "yyyy-MM-dd");
      const fim = format(to, "yyyy-MM-dd");
      const [previewRes, obsRes] = await Promise.all([
        apiService.getIptPreview(inicio, fim, false, "all"),
        apiService.getIptObservacoes(inicio, fim),
      ]);
      setPreview(previewRes);
      setObs(obsRes as ObservacoesMap);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar o cruzamento.");
      setPreview(null);
      setObs(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, nonce]);

  /** Serviços disponíveis (para o filtro). */
  const servicoOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of preview?.itens ?? []) if (it.tipo_servico) set.add(it.tipo_servico);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [preview]);

  /** Itens dentro do escopo estrutural (sub + serviço) — base para resumo e cards. */
  const itensScoped = useMemo(() => {
    const itens = preview?.itens ?? [];
    return itens.filter((it) => {
      if (sub !== "all") {
        const itemSub = getSubFromPlano(it.plano) || it.subprefeitura;
        if (itemSub !== sub) return false;
      }
      if (serv !== "all" && it.tipo_servico !== serv) return false;
      return true;
    });
  }, [preview, sub, serv]);

  const result = useMemo(
    () => buildCruzamento(itensScoped, { obs: obs ?? undefined, apenasComPrevisao }),
    [itensScoped, obs, apenasComPrevisao]
  );

  /** Lista visível: aplica busca + filtro de causa sobre o ranking. */
  const setoresVisiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return result.setores.filter((s) => {
      if (causaFiltro !== "all" && s.causaRaiz !== causaFiltro) return false;
      if (!t) return true;
      return (
        s.plano.toLowerCase().includes(t) ||
        s.sub.toLowerCase().includes(t) ||
        s.tipoServico.toLowerCase().includes(t)
      );
    });
  }, [result.setores, busca, causaFiltro]);

  const periodoLabel = `${format(from, "dd/MM/yy", { locale: ptBR })} – ${format(to, "dd/MM/yy", { locale: ptBR })}`;

  const registrarCausa = useCallback(
    async (setor: SectorAnalysis, titulo: string) => {
      setSalvandoCausa(true);
      try {
        await apiService.createIptObservacaoGlobal(setor.plano, titulo);
        await carregar();
      } catch {
        // silencioso: a UI continua utilizável mesmo se o registro falhar
      } finally {
        setSalvandoCausa(false);
      }
    },
    [carregar]
  );

  const exportar = useCallback(() => {
    exportCruzamentoPlanoAcao(result.setores, {
      periodoLabel,
      subLabel: sub === "all" ? "Todas" : sub,
      servicoLabel: serv === "all" ? "Todos" : serv,
    });
  }, [result.setores, periodoLabel, sub, serv]);

  const dadosPorServico = useMemo(() => result.porServico.slice(0, 8), [result.porServico]);

  return (
    <MainLayout>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
            <div className="flex items-center gap-4">
              <Link
                href="/ipt"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-zinc-200 hover:text-foreground dark:hover:bg-zinc-800"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div className="flex items-center gap-3">
                <Network className="h-6 w-6 text-violet-500" />
                <div>
                  <h1 className="text-xl font-bold text-foreground">Cruzamento Inteligente</h1>
                  <p className="text-xs text-muted-foreground">
                    Setores problemáticos priorizados por impacto no IPT · causa-raiz · plano de ação
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <DevBadge />
              <Badge
                variant="outline"
                className="gap-1.5 border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300"
              >
                <CalendarRange className="h-3.5 w-3.5" />
                Análise a partir de mai/{from.getFullYear()}
              </Badge>
            </div>
          </div>
        </div>

        <div className="space-y-6 px-6 py-6">
          {erro && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {erro}
            </div>
          )}

          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-card/60 p-3">
            <DateRangePicker
              value={range}
              onChange={setRange}
              maxDate={hoje}
              modeLabel="Período"
              className="bg-violet-600 hover:bg-violet-700"
            />
            <Select value={sub} onValueChange={setSub}>
              <SelectTrigger className="h-10 w-[170px]">
                <MapPin className="mr-1 h-4 w-4 text-violet-500" />
                <SelectValue placeholder="Subprefeitura" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as subs</SelectItem>
                {SUBPREFEITURAS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={serv} onValueChange={setServ}>
              <SelectTrigger className="h-10 w-[230px]">
                <Layers className="mr-1 h-4 w-4 text-violet-500" />
                <SelectValue placeholder="Tipo de serviço" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os serviços</SelectItem>
                {servicoOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex select-none items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-xs font-medium text-muted-foreground">
              <Switch
                checked={apenasComPrevisao}
                onCheckedChange={setApenasComPrevisao}
                className="data-[state=checked]:bg-violet-600"
              />
              Só setores com previsão
            </label>
            <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar setor, sub, serviço…"
                className="h-10 pl-9"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-10 w-10 shrink-0 p-0"
              onClick={() => setNonce((n) => n + 1)}
              disabled={loading}
              title="Atualizar"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
            <Button
              variant="outline"
              className="h-10 gap-2 border-violet-500/40 text-violet-700 hover:bg-violet-500/10 dark:text-violet-300"
              onClick={exportar}
              disabled={result.setores.length === 0}
            >
              <Download className="h-4 w-4" />
              Plano de ação
            </Button>
          </div>

          {loading && !preview ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
            </div>
          ) : (
            <>
              {/* Hero: diagnóstico do impacto */}
              <div className="relative overflow-hidden rounded-2xl border border-violet-400/40 bg-linear-to-br from-violet-600/95 via-purple-700 to-indigo-950 px-6 py-8 shadow-xl shadow-indigo-950/30 ring-1 ring-white/15 sm:px-8">
                <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-fuchsia-400/15 blur-3xl" aria-hidden />
                <DevWatermark className="text-white" />
                <DevBadge className="absolute right-4 top-4 z-40 border-white/40 bg-white/15 text-white" />
                <div className="relative flex flex-col gap-8 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-violet-100/95">
                      <TrendingDown className="size-8 shrink-0 text-white" aria-hidden />
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-white/85">Diagnóstico do período · {periodoLabel}</p>
                        <h2 className="text-lg font-semibold text-white">Impacto no IPT (despachos-equivalentes perdidos)</h2>
                      </div>
                    </div>
                    <p className="mt-4 text-[clamp(3rem,8vw,4.25rem)] font-bold leading-none tracking-tight text-white tabular-nums drop-shadow-sm">
                      {fmtInt(result.resumo.impactoTotal)}
                    </p>
                    <p className="mt-2 text-sm text-violet-100/90">
                      de {fmtInt(result.resumo.previstosTotal)} despachos previstos ·{" "}
                      {result.resumo.setoresCriticos} setores com alerta ·{" "}
                      <span className="font-semibold text-white">
                        top 10 concentram {result.resumo.concentracaoTop10.toFixed(0)}% do impacto
                      </span>
                    </p>
                  </div>
                  <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-3 xl:max-w-2xl">
                    <div className="rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-white/80">Setores analisados</p>
                      <p className="mt-3 font-mono text-3xl font-bold tabular-nums text-white">{result.resumo.totalSetores}</p>
                    </div>
                    <div className="rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-white/80">Cobertura geral</p>
                      <p className="mt-3 font-mono text-3xl font-bold tabular-nums text-white">{fmtPct(result.resumo.coberturaGeral)}</p>
                    </div>
                    <div className="rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-white/80">Nunca executados</p>
                      <p className="mt-3 font-mono text-3xl font-bold tabular-nums text-white">{result.resumo.nuncaExecutados}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Cards por causa-raiz (clicáveis = filtram o ranking) */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {CAUSA_ORDER.map((causa) => {
                  const Icon = CAUSA_ICON[causa];
                  const meta = ROOT_CAUSE_META[causa];
                  const dados = result.resumo.porCausa[causa];
                  const ativo = causaFiltro === causa;
                  return (
                    <button
                      key={causa}
                      type="button"
                      onClick={() => setCausaFiltro((prev) => (prev === causa ? "all" : causa))}
                      className={cn(
                        "group relative overflow-hidden rounded-2xl border bg-card p-4 pl-5 text-left transition-all hover:shadow-md",
                        ativo ? "border-violet-500/60 ring-2 ring-violet-500/30" : "border-border/70"
                      )}
                      title={meta.descricao}
                    >
                      <div className={cn("absolute inset-y-0 left-0 w-1", CAUSA_TINT[causa].card)} aria-hidden />
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{meta.label}</p>
                          <p className="mt-2 font-mono text-3xl font-bold tabular-nums">{dados.setores}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {fmtInt(dados.impacto)} impacto · → {meta.responsavel}
                          </p>
                        </div>
                        <Icon className="size-5 shrink-0 text-muted-foreground/70" />
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Ranking por impacto */}
              <Card className="relative overflow-hidden border-border/70">
                <DevWatermark />
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-violet-500" />
                    <CardTitle className="text-base">Ranking por impacto no IPT</CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    {causaFiltro !== "all" && (
                      <Badge variant="outline" className={cn("gap-1 text-[11px]", CAUSA_TINT[causaFiltro].chip)}>
                        {ROOT_CAUSE_META[causaFiltro].label}
                        <button type="button" onClick={() => setCausaFiltro("all")} className="ml-1 hover:opacity-70">
                          ✕
                        </button>
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {setoresVisiveis.length} setores · ordenado por impacto
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div>
                    <Table>
                      <TableHeader className="bg-card">
                        <TableRow>
                          <TableHead className="w-12 text-center">#</TableHead>
                          <TableHead>Setor</TableHead>
                          <TableHead>Serviço / Frequência</TableHead>
                          <TableHead className="text-center">Desp. × Prev.</TableHead>
                          <TableHead className="text-center">% médio</TableHead>
                          <TableHead className="text-center">Impacto</TableHead>
                          <TableHead className="text-center">Bateria</TableHead>
                          <TableHead className="text-center">Causa</TableHead>
                          <TableHead className="text-center">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {setoresVisiveis.map((s, i) => (
                          <TableRow
                            key={s.plano}
                            className="cursor-pointer transition-colors hover:bg-violet-500/5"
                            onClick={() => setSelecionado(s)}
                          >
                            <TableCell className="text-center font-mono text-sm font-bold tabular-nums text-muted-foreground">
                              {i + 1}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", subprefBadgeClass(s.sub))}>
                                  {s.sub}
                                </Badge>
                                <span className="font-medium">{s.plano}</span>
                                {s.isVarricao && (
                                  <span className="rounded bg-violet-500/15 px-1 py-0.5 text-[9px] font-bold text-violet-700 dark:text-violet-300">
                                    VARR
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">{s.tipoServico}</div>
                              <div className="text-xs text-muted-foreground">{s.frequenciaLabel}</div>
                            </TableCell>
                            <TableCell className="text-center font-mono text-sm tabular-nums">
                              {s.despachados}
                              <span className="text-muted-foreground"> / {s.previstos}</span>
                            </TableCell>
                            <TableCell className="text-center font-mono text-sm tabular-nums">
                              {s.percentualMedio != null ? `${s.percentualMedio.toFixed(0)}%` : "—"}
                            </TableCell>
                            <TableCell className="text-center">
                              <span className="font-mono text-sm font-bold tabular-nums text-rose-600 dark:text-rose-400">
                                {s.impactoIpt.toFixed(1)}
                              </span>
                            </TableCell>
                            <TableCell className="text-center">
                              {s.temBateria ? (
                                <span
                                  className={cn(
                                    "font-mono text-xs font-semibold tabular-nums",
                                    s.bateriaProblema ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"
                                  )}
                                >
                                  {s.bateriaMedia != null ? `${s.bateriaMedia.toFixed(0)}%` : "—"}
                                </span>
                              ) : (
                                <span className="text-[10px] text-muted-foreground">s/ mód.</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className={cn("text-[10px]", CAUSA_TINT[s.causaRaiz].chip)}>
                                {ROOT_CAUSE_META[s.causaRaiz].label}
                                {s.causaManual && " ✓"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className={cn("text-[10px]", STATUS_META[s.status].className)}>
                                {STATUS_META[s.status].label}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                        {setoresVisiveis.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                              Nenhum setor encontrado para os filtros atuais.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {/* Gráficos */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card className="relative overflow-hidden border-border/70">
                  <DevWatermark />
                  <CardHeader className="space-y-0">
                    <CardTitle className="text-base">Impacto por tipo de serviço</CardTitle>
                    <p className="text-xs text-muted-foreground">Onde se concentra a perda de IPT</p>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={dadosPorServico} layout="vertical" margin={{ left: 8, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="chave" width={150} tick={{ fontSize: 10 }} />
                        <Tooltip
                          contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", fontSize: 12 }}
                          formatter={(v: number) => [Math.round(v), "Impacto"]}
                        />
                        <Bar dataKey="impacto" radius={[0, 6, 6, 0]} fill="#8b5cf6" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="relative overflow-hidden border-border/70">
                  <DevWatermark />
                  <CardHeader className="space-y-0">
                    <CardTitle className="text-base">Impacto por subprefeitura</CardTitle>
                    <p className="text-xs text-muted-foreground">Despachos-equivalentes perdidos por SUB</p>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={result.porSub} margin={{ left: 8, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" vertical={false} />
                        <XAxis dataKey="chave" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", fontSize: 12 }}
                          formatter={(v: number) => [Math.round(v), "Impacto"]}
                        />
                        <Bar dataKey="impacto" radius={[6, 6, 0, 0]} fill="#a855f7" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Drawer de detalhe do setor */}
      <Dialog open={selecionado != null} onOpenChange={(o) => !o && setSelecionado(null)}>
        <DialogContent className="max-w-2xl">
          {selecionado && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", subprefBadgeClass(selecionado.sub))}>
                    {selecionado.sub}
                  </Badge>
                  {selecionado.plano}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>{selecionado.tipoServico}</span>
                  <span>·</span>
                  <span>{selecionado.frequenciaLabel}</span>
                  <Badge variant="outline" className={cn("ml-auto text-[10px]", CAUSA_TINT[selecionado.causaRaiz].chip)}>
                    {ROOT_CAUSE_META[selecionado.causaRaiz].label} → {ROOT_CAUSE_META[selecionado.causaRaiz].responsavel}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { l: "Previstos", v: selecionado.previstos },
                    { l: "Despachados", v: selecionado.despachados },
                    { l: "% médio", v: selecionado.percentualMedio != null ? `${selecionado.percentualMedio.toFixed(0)}%` : "—" },
                    { l: "Impacto IPT", v: selecionado.impactoIpt.toFixed(1) },
                  ].map((m) => (
                    <div key={m.l} className="rounded-xl border border-border/70 bg-muted/20 p-3 text-center">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{m.l}</p>
                      <p className="mt-1 font-mono text-xl font-bold tabular-nums">{m.v}</p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                  <div className="rounded-lg border border-border/60 px-3 py-2">
                    <p className="text-muted-foreground">Não despachados</p>
                    <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-rose-600 dark:text-rose-400">{selecionado.naoDespachados}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 px-3 py-2">
                    <p className="text-muted-foreground">Zerados</p>
                    <p className="mt-0.5 font-mono text-sm font-bold tabular-nums">{selecionado.zerados}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 px-3 py-2">
                    <p className="text-muted-foreground">Bateria média</p>
                    <p className={cn("mt-0.5 font-mono text-sm font-bold tabular-nums", selecionado.bateriaProblema && "text-rose-600 dark:text-rose-400")}>
                      {selecionado.temBateria ? (selecionado.bateriaMedia != null ? `${selecionado.bateriaMedia.toFixed(0)}%` : "—") : "s/ módulo"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 px-3 py-2">
                    <p className="text-muted-foreground">Divergência</p>
                    <p className="mt-0.5 font-mono text-sm font-bold tabular-nums">
                      {selecionado.divergencia != null ? `${selecionado.divergencia.toFixed(0)}pp` : "—"}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Execução diária no período</p>
                  <div className="flex flex-wrap gap-1">
                    {selecionado.detalhes.filter((d) => d.esperado).map((d) => {
                      const est = celulaEstado(d);
                      return (
                        <div
                          key={d.data}
                          className={cn("flex h-8 w-8 items-center justify-center rounded-md text-[10px] font-semibold text-white/90", est.className)}
                          title={`${d.data} · ${est.label}${est.pct != null ? ` · ${est.pct}%` : ""}`}
                        >
                          {d.data.slice(-2)}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Registro de causa → alimenta o relatório */}
                <div className="rounded-xl border border-border/70 bg-muted/15 p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Registrar causa (entra na pauta e no relatório)
                    {selecionado.temObsGlobal && (
                      <span className="ml-2 text-emerald-600 dark:text-emerald-400">· já registrado: {selecionado.obsGlobalTitulo}</span>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { titulo: "Operação não cumpriu", causa: "operacao" as const },
                      { titulo: "Bateria recorrente", causa: "bateria" as const },
                      { titulo: "Setor incorreto SELIMP", causa: "cadastro" as const },
                      { titulo: "Nunca Pontuou", causa: "nunca" as const },
                    ].map((opt) => (
                      <Button
                        key={opt.titulo}
                        variant="outline"
                        size="sm"
                        disabled={salvandoCausa}
                        className={cn("h-8 gap-1.5 text-xs", CAUSA_TINT[opt.causa].chip)}
                        onClick={() => registrarCausa(selecionado, opt.titulo)}
                      >
                        {salvandoCausa ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        {opt.titulo}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
