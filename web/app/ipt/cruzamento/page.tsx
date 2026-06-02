"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import {
  Network,
  ArrowLeft,
  AlertTriangle,
  Ban,
  Activity,
  GitCompareArrows,
  Search,
  Download,
  CalendarRange,
  TrendingDown,
  Layers,
  MapPin,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
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
import {
  getCruzamentoMock,
  formatDiaCurto,
  type RankingRow,
  type StatusSetor,
  type EstadoCelula,
} from "@/lib/mock/cruzamento";
import {
  SUBPREFEITURAS,
  TIPOS_SERVICO,
  getPlanoInicio,
  subprefBadgeClass,
} from "@/lib/mock/ipt-shared";
import { cn } from "@/lib/utils";

const STATUS_META: Record<StatusSetor, { label: string; className: string }> = {
  nunca: { label: "Nunca executado", className: "border-rose-500/40 bg-rose-500/12 text-rose-700 dark:text-rose-300" },
  critico: { label: "Crítico", className: "border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300" },
  irregular: { label: "Irregular", className: "border-yellow-500/40 bg-yellow-500/12 text-yellow-700 dark:text-yellow-300" },
  ok: { label: "OK", className: "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
};

const CELULA_META: Record<EstadoCelula, { className: string; label: string }> = {
  exec: { className: "bg-emerald-500", label: "Executado" },
  parcial: { className: "bg-amber-400", label: "Parcial (<50%)" },
  falha: { className: "bg-rose-500", label: "Não executado" },
  nao_previsto: { className: "bg-muted-foreground/15", label: "Sem previsão" },
};

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tint,
}: {
  icon: typeof Network;
  label: string;
  value: string | number;
  sub?: string;
  tint: string;
}) {
  return (
    <Card className="relative overflow-hidden border-border/70">
      <div className={cn("absolute inset-y-0 left-0 w-1", tint)} aria-hidden />
      <CardContent className="flex items-start justify-between gap-3 p-4 pl-5">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-2 font-mono text-3xl font-bold tabular-nums">{value}</p>
          {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
        </div>
        <Icon className="size-5 shrink-0 text-muted-foreground/70" />
      </CardContent>
    </Card>
  );
}

export default function CruzamentoPage() {
  const hoje = startOfDay(new Date());
  const planoInicio = getPlanoInicio(hoje);

  const [range, setRange] = useState<DateRange | undefined>({ from: planoInicio, to: hoje });
  const [sub, setSub] = useState("all");
  const [serv, setServ] = useState("all");
  const [apenasComPrevisao, setApenasComPrevisao] = useState(true);
  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState<RankingRow | null>(null);

  const from = range?.from ?? planoInicio;
  const to = range?.to ?? hoje;

  const data = useMemo(
    () =>
      getCruzamentoMock({
        from,
        to,
        subprefeitura: sub,
        tipoServico: serv,
        apenasComPrevisao,
      }),
    [from, to, sub, serv, apenasComPrevisao]
  );

  const rankingFiltrado = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return data.ranking;
    return data.ranking.filter(
      (r) =>
        r.setor.toLowerCase().includes(t) ||
        r.subprefeitura.toLowerCase().includes(t) ||
        r.tipo_servico.toLowerCase().includes(t)
    );
  }, [data.ranking, busca]);

  const heatmapLinhas = data.heatmap.linhas.slice(0, 14);

  function exportarCsv() {
    const headers = [
      "rank", "setor", "subprefeitura", "servico", "frequencia",
      "dias_previstos", "dias_executados", "gap", "percentual_medio", "zerados", "divergencias", "status",
    ];
    const linhas = data.ranking.map((r) =>
      [
        r.rank, `"${r.setor}"`, r.subprefeitura, `"${r.tipo_servico}"`, r.frequencia,
        r.diasPrevistos, r.diasExecutados, r.gap, r.percentualMedio ?? "", r.zerados, r.divergencias, r.status,
      ].join(",")
    );
    const csv = [headers.join(","), ...linhas].join("\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cruzamento_${format(from, "yyyy-MM-dd")}_${format(to, "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
                    Setores não operantes e ranking de execução
                  </p>
                </div>
              </div>
            </div>
            <Badge
              variant="outline"
              className="gap-1.5 border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300"
            >
              <CalendarRange className="h-3.5 w-3.5" />
              Plano consolidado a partir de mai/{hoje.getFullYear()}
            </Badge>
          </div>
        </div>

        <div className="space-y-6 px-6 py-6">
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
              <SelectTrigger className="h-10 w-[210px]">
                <Layers className="mr-1 h-4 w-4 text-violet-500" />
                <SelectValue placeholder="Tipo de serviço" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os serviços</SelectItem>
                {TIPOS_SERVICO.map((s) => (
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
              Só setores com execução prevista
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
              className="h-10 gap-2 border-violet-500/40 text-violet-700 hover:bg-violet-500/10 dark:text-violet-300"
              onClick={exportarCsv}
            >
              <Download className="h-4 w-4" />
              Exportar ranking
            </Button>
          </div>

          {/* Hero */}
          <div className="relative overflow-hidden rounded-2xl border border-violet-400/40 bg-linear-to-br from-violet-600/95 via-purple-700 to-indigo-950 px-6 py-8 shadow-xl shadow-indigo-950/30 ring-1 ring-white/15 sm:px-8">
            <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-fuchsia-400/15 blur-3xl" aria-hidden />
            <div className="relative flex flex-col gap-8 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-violet-100/95">
                  <Ban className="size-8 shrink-0 text-white" aria-hidden />
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-white/85">Diagnóstico do período</p>
                    <h2 className="text-lg font-semibold text-white">Setores nunca executados</h2>
                  </div>
                </div>
                <p className="mt-4 text-[clamp(3rem,8vw,4.25rem)] font-bold leading-none tracking-tight text-white tabular-nums drop-shadow-sm">
                  {data.diagnostico.nuncaExecutados}
                </p>
                <p className="mt-2 text-sm text-violet-100/90">
                  de {data.diagnostico.totalSetores} setores analisados ·{" "}
                  {format(from, "dd/MM", { locale: ptBR })} – {format(to, "dd/MM", { locale: ptBR })}
                </p>
              </div>
              <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-3 xl:max-w-2xl">
                <div className="rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-white/80">Críticos</p>
                  <p className="mt-3 font-mono text-3xl font-bold tabular-nums text-white">{data.diagnostico.criticos}</p>
                </div>
                <div className="rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-white/80">Cobertura</p>
                  <p className="mt-3 font-mono text-3xl font-bold tabular-nums text-white">{data.diagnostico.coberturaDespachos}%</p>
                </div>
                <div className="rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-white/80">Divergências</p>
                  <p className="mt-3 font-mono text-3xl font-bold tabular-nums text-white">{data.diagnostico.divergencias}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Cards de diagnóstico */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard icon={Ban} label="Nunca executados" value={data.diagnostico.nuncaExecutados} tint="bg-rose-500" sub="0 despachos no período" />
            <StatCard icon={AlertTriangle} label="Execução crítica" value={data.diagnostico.criticos} tint="bg-amber-500" sub="abaixo do limiar" />
            <StatCard icon={Activity} label="Cobertura de despachos" value={`${data.diagnostico.coberturaDespachos}%`} tint="bg-violet-500" sub="despachado ÷ previsto" />
            <StatCard icon={Ban} label="Despachos zerados" value={data.diagnostico.despachosZerados} tint="bg-slate-500" sub="despachado com 0%" />
            <StatCard icon={GitCompareArrows} label="Divergências SELIMP×nosso" value={data.diagnostico.divergencias} tint="bg-cyan-500" sub="diferença > 12pp" />
          </div>

          {/* Ranking */}
          <Card className="border-border/70">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-violet-500" />
                <CardTitle className="text-base">Ranking de execução</CardTitle>
              </div>
              <span className="text-xs text-muted-foreground">
                {rankingFiltrado.length} setores · ordenado por gap (previstos − executados)
              </span>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[560px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead className="w-12 text-center">#</TableHead>
                      <TableHead>Setor</TableHead>
                      <TableHead>Serviço / Frequência</TableHead>
                      <TableHead className="text-center">Prev. × Exec.</TableHead>
                      <TableHead className="text-center">Gap</TableHead>
                      <TableHead className="text-center">% médio</TableHead>
                      <TableHead className="text-center">Zerados</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rankingFiltrado.map((r) => (
                      <TableRow
                        key={r.setorId}
                        className="cursor-pointer transition-colors hover:bg-violet-500/5"
                        onClick={() => setSelecionado(r)}
                      >
                        <TableCell className="text-center font-mono text-sm font-bold tabular-nums text-muted-foreground">
                          {r.rank}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", subprefBadgeClass(r.subprefeitura))}>
                              {r.subprefeitura}
                            </Badge>
                            <span className="font-medium">{r.setor}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{r.tipo_servico}</div>
                          <div className="text-xs text-muted-foreground">{r.frequencia}</div>
                        </TableCell>
                        <TableCell className="text-center font-mono text-sm tabular-nums">
                          {r.diasExecutados}
                          <span className="text-muted-foreground"> / {r.diasPrevistos}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span
                            className={cn(
                              "font-mono text-sm font-bold tabular-nums",
                              r.gap > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"
                            )}
                          >
                            {r.gap}
                          </span>
                        </TableCell>
                        <TableCell className="text-center font-mono text-sm tabular-nums">
                          {r.percentualMedio != null ? `${r.percentualMedio}%` : "—"}
                        </TableCell>
                        <TableCell className="text-center font-mono text-sm tabular-nums">{r.zerados}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={cn("text-[10px]", STATUS_META[r.status].className)}>
                            {STATUS_META[r.status].label}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {rankingFiltrado.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                          Nenhum setor encontrado para os filtros atuais.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Heatmap */}
          <Card className="border-border/70">
            <CardHeader className="space-y-0">
              <CardTitle className="text-base">Calendário de execução</CardTitle>
              <p className="text-xs text-muted-foreground">
                Top {heatmapLinhas.length} setores do ranking — cada célula é um dia do período
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <div className="min-w-[640px] space-y-1.5">
                  {heatmapLinhas.map((linha) => (
                    <div key={linha.setorId} className="flex items-center gap-2">
                      <div className="flex w-44 shrink-0 items-center gap-1.5 truncate">
                        <Badge variant="outline" className={cn("h-4 px-1 text-[9px]", subprefBadgeClass(linha.subprefeitura))}>
                          {linha.subprefeitura}
                        </Badge>
                        <span className="truncate text-xs text-muted-foreground" title={linha.setor}>
                          {linha.setor}
                        </span>
                      </div>
                      <div className="flex flex-1 gap-0.5">
                        {linha.celulas.map((c) => (
                          <div
                            key={c.data}
                            className={cn("h-4 flex-1 rounded-[3px]", CELULA_META[c.estado].className)}
                            title={`${formatDiaCurto(c.data)} · ${CELULA_META[c.estado].label}${c.percentual != null ? ` · ${c.percentual}%` : ""}`}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                {(Object.keys(CELULA_META) as EstadoCelula[]).map((k) => (
                  <span key={k} className="flex items-center gap-1.5">
                    <span className={cn("h-3 w-3 rounded-[3px]", CELULA_META[k].className)} />
                    {CELULA_META[k].label}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Gráficos */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="border-border/70">
              <CardHeader className="space-y-0">
                <CardTitle className="text-base">Cobertura por tipo de serviço</CardTitle>
                <p className="text-xs text-muted-foreground">Foco nos serviços de alto volume</p>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.porServico} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="tipo_servico" width={130} tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", fontSize: 12 }}
                      formatter={(v: number) => [`${v}%`, "Cobertura"]}
                    />
                    <Bar dataKey="cobertura" radius={[0, 6, 6, 0]}>
                      {data.porServico.map((s) => (
                        <Cell key={s.tipo_servico} fill={s.cobertura < 50 ? "#f43f5e" : s.cobertura < 80 ? "#f59e0b" : "#8b5cf6"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-border/70">
              <CardHeader className="space-y-0">
                <CardTitle className="text-base">Falhas por subprefeitura</CardTitle>
                <p className="text-xs text-muted-foreground">Dias previstos não executados</p>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.porSubprefeitura} margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" vertical={false} />
                    <XAxis dataKey="subprefeitura" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", fontSize: 12 }}
                      formatter={(v: number, n) => [v, n === "falhas" ? "Falhas" : n]}
                    />
                    <Bar dataKey="falhas" radius={[6, 6, 0, 0]} fill="#a855f7" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Drawer de detalhe do setor */}
      <Dialog open={selecionado != null} onOpenChange={(o) => !o && setSelecionado(null)}>
        <DialogContent className="max-w-2xl">
          {selecionado && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", subprefBadgeClass(selecionado.subprefeitura))}>
                    {selecionado.subprefeitura}
                  </Badge>
                  {selecionado.setor}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>{selecionado.tipo_servico}</span>
                  <span>·</span>
                  <span>{selecionado.frequencia}</span>
                  <Badge variant="outline" className={cn("ml-auto text-[10px]", STATUS_META[selecionado.status].className)}>
                    {STATUS_META[selecionado.status].label}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { l: "Previstos", v: selecionado.diasPrevistos },
                    { l: "Executados", v: selecionado.diasExecutados },
                    { l: "Gap", v: selecionado.gap },
                    { l: "% médio", v: selecionado.percentualMedio != null ? `${selecionado.percentualMedio}%` : "—" },
                  ].map((m) => (
                    <div key={m.l} className="rounded-xl border border-border/70 bg-muted/20 p-3 text-center">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{m.l}</p>
                      <p className="mt-1 font-mono text-xl font-bold tabular-nums">{m.v}</p>
                    </div>
                  ))}
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Detalhe diário</p>
                  <div className="flex flex-wrap gap-1">
                    {selecionado.detalhes.map((d) => {
                      const estado: EstadoCelula = !d.esperado
                        ? "nao_previsto"
                        : d.despachos_selimp === 0
                          ? "falha"
                          : d.percentual_selimp != null && d.percentual_selimp < 50
                            ? "parcial"
                            : "exec";
                      return (
                        <div
                          key={d.data}
                          className={cn(
                            "flex h-8 w-8 items-center justify-center rounded-md text-[10px] font-semibold text-white/90",
                            CELULA_META[estado].className
                          )}
                          title={`${formatDiaCurto(d.data)} · ${CELULA_META[estado].label}${d.percentual_selimp != null ? ` · ${d.percentual_selimp}%` : ""}`}
                        >
                          {d.data.slice(-2)}
                        </div>
                      );
                    })}
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
