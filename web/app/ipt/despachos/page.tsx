"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, startOfDay, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Truck,
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Ban,
  CalendarClock,
  Search,
  MapPin,
  Layers,
  MessageSquarePlus,
  CircleSlash,
  Send,
  ClipboardPaste,
  Loader2,
  Clock,
} from "lucide-react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { toast } from "react-toastify";
import { MainLayout } from "@/components/layout/main-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { apiService, type DespachoLinha, type DespachosResponse, type StatusDiaDespacho } from "@/lib/api";
import { SUBPREFEITURAS, subprefBadgeClass } from "@/lib/mock/ipt-shared";
import { cn } from "@/lib/utils";

const STATUS_META: Record<StatusDiaDespacho, { label: string; className: string; dot: string }> = {
  conforme: { label: "Conforme", className: "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  nao_despachado: { label: "Não despachado", className: "border-rose-500/40 bg-rose-500/12 text-rose-700 dark:text-rose-300", dot: "bg-rose-500" },
  fora_plano: { label: "Fora do plano", className: "border-blue-500/40 bg-blue-500/12 text-blue-700 dark:text-blue-300", dot: "bg-blue-500" },
  zerado: { label: "Zerado", className: "border-slate-500/40 bg-slate-500/12 text-slate-700 dark:text-slate-300", dot: "bg-slate-500" },
  nao_previsto: { label: "Sem previsão", className: "border-border/60 bg-muted/40 text-muted-foreground", dot: "bg-muted-foreground/40" },
};

type ChipKey = "todos" | "nao_despachado" | "fora_plano" | "zerado";

const CHIPS: Array<{ key: ChipKey; label: string }> = [
  { key: "todos", label: "Todos" },
  { key: "nao_despachado", label: "Só falhas" },
  { key: "fora_plano", label: "Fora do plano" },
  { key: "zerado", label: "Zerados" },
];

const EMPTY_DATA: DespachosResponse = {
  dia: "",
  kpis: { previstos: 0, despachados: 0, naoDespachados: 0, foraPlano: 0, zerados: 0, cobertura: 0 },
  linhas: [],
  tendencia14d: [],
  turnos: [],
};

function KpiCard({
  icon: Icon,
  label,
  value,
  tint,
  emphasis,
}: {
  icon: typeof Truck;
  label: string;
  value: string | number;
  tint: string;
  emphasis?: boolean;
}) {
  return (
    <Card className={cn("relative overflow-hidden border-border/70", emphasis && "border-rose-500/40")}>
      <div className={cn("absolute inset-y-0 left-0 w-1", tint)} aria-hidden />
      <CardContent className="flex items-center justify-between gap-3 p-4 pl-5">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className={cn("mt-1.5 font-mono text-3xl font-bold tabular-nums", emphasis && "text-rose-600 dark:text-rose-400")}>
            {value}
          </p>
        </div>
        <Icon className={cn("size-5 shrink-0 text-muted-foreground/70", emphasis && "text-rose-500")} />
      </CardContent>
    </Card>
  );
}

function parseDia(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return startOfDay(subDays(new Date(), 1));
  return new Date(y, m - 1, d);
}

export default function DespachosPage() {
  const ontem = format(subDays(startOfDay(new Date()), 1), "yyyy-MM-dd");

  const [dia, setDia] = useState(ontem);
  const [sub, setSub] = useState("all");
  const [serv, setServ] = useState("all");
  const [turno, setTurno] = useState("all");
  const [chip, setChip] = useState<ChipKey>("todos");
  const [busca, setBusca] = useState("");
  const [nonce, setNonce] = useState(0);

  const [data, setData] = useState<DespachosResponse>(EMPTY_DATA);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Colagem SELIMP
  const [colarOpen, setColarOpen] = useState(false);
  const [colarTexto, setColarTexto] = useState("");
  const [colarPreview, setColarPreview] = useState<Awaited<ReturnType<typeof apiService.colarDespachos>> | null>(null);
  const [colarBusy, setColarBusy] = useState(false);

  // Observação
  const [obs, setObs] = useState<DespachoLinha | null>(null);
  const [obsTexto, setObsTexto] = useState("");
  const [obsBusy, setObsBusy] = useState(false);

  const diaDate = parseDia(dia);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const res = await apiService.getDespachos({
        dia,
        subprefeitura: sub !== "all" ? sub : undefined,
        turno: turno !== "all" ? turno : undefined,
      });
      setData(res);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar despachos.");
      setData(EMPTY_DATA);
    } finally {
      setLoading(false);
    }
  }, [dia, sub, turno]);

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dia, sub, turno, nonce]);

  // Opções de serviço derivadas dos dados (filtro client-side da tabela).
  const servicosDisponiveis = useMemo(
    () => Array.from(new Set(data.linhas.map((l) => l.tipo_servico))).sort(),
    [data.linhas]
  );

  const linhasFiltradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return data.linhas.filter((l) => {
      if (chip !== "todos" && l.status !== chip) return false;
      if (serv !== "all" && l.tipo_servico !== serv) return false;
      if (!t) return true;
      return (
        l.setor.toLowerCase().includes(t) ||
        (l.subprefeitura ?? "").toLowerCase().includes(t) ||
        l.tipo_servico.toLowerCase().includes(t)
      );
    });
  }, [data.linhas, chip, serv, busca]);

  const donut = [
    { name: "Despachados", value: data.kpis.despachados, fill: "#f59e0b" },
    { name: "Pendentes", value: Math.max(0, data.kpis.previstos - data.kpis.despachados), fill: "rgba(120,113,108,0.25)" },
  ];

  function abrirObs(l: DespachoLinha) {
    setObs(l);
    setObsTexto("");
  }

  async function salvarObs() {
    if (!obs || !obsTexto.trim()) return;
    setObsBusy(true);
    try {
      await apiService.createIptObservacaoDiaria(obs.setor, dia, "Despacho", obsTexto.trim());
      toast.success("Observação registrada.");
      setObs(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar observação.");
    } finally {
      setObsBusy(false);
    }
  }

  async function previewColagem() {
    if (!colarTexto.trim()) return;
    setColarBusy(true);
    try {
      const res = await apiService.colarDespachos(dia, colarTexto, { dryRun: true });
      setColarPreview(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao processar a colagem.");
    } finally {
      setColarBusy(false);
    }
  }

  async function confirmarColagem() {
    if (!colarTexto.trim()) return;
    setColarBusy(true);
    try {
      const res = await apiService.colarDespachos(dia, colarTexto, { dryRun: false });
      toast.success(`${res.gravados} despachos gravados para ${format(diaDate, "dd/MM")}.`);
      setColarOpen(false);
      setColarTexto("");
      setColarPreview(null);
      setNonce((n) => n + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gravar os despachos.");
    } finally {
      setColarBusy(false);
    }
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
                <Truck className="h-6 w-6 text-amber-500" />
                <div>
                  <h1 className="text-xl font-bold text-foreground">Despachos SELIMP</h1>
                  <p className="text-xs text-muted-foreground">Acompanhamento diário: planejado × despachado</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-8 gap-1.5 bg-amber-600 text-white hover:bg-amber-700"
                onClick={() => {
                  setColarPreview(null);
                  setColarTexto("");
                  setColarOpen(true);
                }}
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
                Colar despachos
              </Button>
              <DatePicker value={dia} onChange={(v) => setDia(v || ontem)} compact />
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => setNonce((n) => n + 1)}
                disabled={loading}
                title="Atualizar"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                Atualizar
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-6 px-6 py-6">
          {erro && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {erro}
            </div>
          )}

          {/* Hero cobertura + donut */}
          <div className="relative overflow-hidden rounded-2xl border border-amber-400/40 bg-linear-to-br from-amber-500/95 via-orange-600 to-amber-900 px-6 py-8 shadow-xl shadow-amber-900/30 ring-1 ring-white/15 sm:px-8">
            <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-yellow-300/20 blur-3xl" aria-hidden />
            <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-amber-50/95">
                  <Send className="size-7 shrink-0 text-white" aria-hidden />
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-white/85">
                      {format(diaDate, "EEEE, dd 'de' MMMM", { locale: ptBR })}
                    </p>
                    <h2 className="text-lg font-semibold text-white">Cobertura de despachos do dia</h2>
                  </div>
                </div>
                <p className="mt-4 text-[clamp(3rem,8vw,4.5rem)] font-bold leading-none tracking-tight text-white tabular-nums drop-shadow-sm">
                  {data.kpis.cobertura}%
                </p>
                <p className="mt-2 text-sm text-amber-50/90">
                  {data.kpis.despachados} de {data.kpis.previstos} setores previstos despachados
                </p>
              </div>
              <div className="relative h-44 w-44 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donut} dataKey="value" innerRadius={58} outerRadius={78} startAngle={90} endAngle={-270} stroke="none">
                      {donut.map((d) => (
                        <Cell key={d.name} fill={d.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-mono text-3xl font-bold tabular-nums text-white">{data.kpis.cobertura}%</span>
                  <span className="text-[11px] uppercase tracking-wide text-white/80">cobertura</span>
                </div>
              </div>
            </div>
          </div>

          {/* KPIs do dia */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <KpiCard icon={CalendarClock} label="Previstos hoje" value={data.kpis.previstos} tint="bg-amber-500" />
            <KpiCard icon={CheckCircle2} label="Despachados" value={data.kpis.despachados} tint="bg-emerald-500" />
            <KpiCard icon={AlertTriangle} label="Não despachado" value={data.kpis.naoDespachados} tint="bg-rose-500" emphasis />
            <KpiCard icon={Send} label="Fora do plano" value={data.kpis.foraPlano} tint="bg-blue-500" />
            <KpiCard icon={CircleSlash} label="Zerados" value={data.kpis.zerados} tint="bg-slate-500" />
            <KpiCard icon={Truck} label="Cobertura" value={`${data.kpis.cobertura}%`} tint="bg-orange-500" />
          </div>

          {/* Tabela operacional */}
          <Card className="border-border/70">
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-base">Operação do dia</CardTitle>
                <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar setor, sub, serviço…"
                    className="h-9 pl-9"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2">
                  {CHIPS.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setChip(c.key)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                        chip === c.key
                          ? "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                          : "border-border/70 text-muted-foreground hover:bg-accent"
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Select value={sub} onValueChange={setSub}>
                    <SelectTrigger className="h-9 w-[140px]">
                      <MapPin className="mr-1 h-4 w-4 text-amber-500" />
                      <SelectValue placeholder="Sub" />
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
                  <Select value={turno} onValueChange={setTurno}>
                    <SelectTrigger className="h-9 w-[150px]">
                      <Clock className="mr-1 h-4 w-4 text-amber-500" />
                      <SelectValue placeholder="Turno" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os turnos</SelectItem>
                      {data.turnos.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={serv} onValueChange={setServ}>
                    <SelectTrigger className="h-9 w-[200px]">
                      <Layers className="mr-1 h-4 w-4 text-amber-500" />
                      <SelectValue placeholder="Serviço" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os serviços</SelectItem>
                      {servicosDisponiveis.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[520px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead>Setor</TableHead>
                      <TableHead>Serviço</TableHead>
                      <TableHead className="text-center">Previsto?</TableHead>
                      <TableHead className="text-center">Despacho</TableHead>
                      <TableHead className="text-center">% exec.</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="text-center">Próx.</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading && (
                      <TableRow>
                        <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                          <Loader2 className="mx-auto h-5 w-5 animate-spin text-amber-500" />
                          <span className="mt-2 block">Carregando…</span>
                        </TableCell>
                      </TableRow>
                    )}
                    {!loading &&
                      linhasFiltradas.map((l) => (
                        <TableRow key={l.setor} className="hover:bg-amber-500/5">
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", subprefBadgeClass(l.subprefeitura ?? ""))}>
                                {l.subprefeitura ?? "—"}
                              </Badge>
                              <span className="font-mono text-xs font-medium">{l.setor}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">{l.tipo_servico}</div>
                            <div className="text-xs text-muted-foreground">
                              {l.frequencia}
                              {l.turno ? ` · ${l.turno}` : ""}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            {l.esperado ? (
                              <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-500" />
                            ) : (
                              <Ban className="mx-auto h-4 w-4 text-muted-foreground/50" />
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {l.despachadoManual ? (
                              <Badge variant="outline" className="gap-1 border-emerald-500/40 bg-emerald-500/12 text-[10px] text-emerald-700 dark:text-emerald-300">
                                <ClipboardPaste className="h-3 w-3" />
                                Colado
                              </Badge>
                            ) : l.despachosSelimp > 0 ? (
                              <span className="font-mono text-sm tabular-nums">{l.despachosSelimp} SELIMP</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center font-mono text-sm tabular-nums">
                            {l.percentual != null ? `${l.percentual}%` : "—"}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className={cn("gap-1 text-[10px]", STATUS_META[l.status].className)}>
                              <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_META[l.status].dot)} />
                              {STATUS_META[l.status].label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center font-mono text-xs tabular-nums text-muted-foreground">
                            {l.proximaProgramacao ?? "—"}
                          </TableCell>
                          <TableCell className="text-center">
                            <button
                              type="button"
                              onClick={() => abrirObs(l)}
                              className="text-muted-foreground transition-colors hover:text-amber-600"
                              title="Registrar observação"
                            >
                              <MessageSquarePlus className="h-4 w-4" />
                            </button>
                          </TableCell>
                        </TableRow>
                      ))}
                    {!loading && linhasFiltradas.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                          Nenhum despacho para os filtros atuais.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Tendência 14 dias */}
          <Card className="border-border/70">
            <CardHeader className="space-y-0">
              <CardTitle className="text-base">Tendência — últimos 14 dias</CardTitle>
              <p className="text-xs text-muted-foreground">Previstos × despachados e cobertura diária</p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={data.tendencia14d} margin={{ left: 4, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" vertical={false} />
                  <XAxis dataKey="data" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="left" dataKey="previstos" name="Previstos" fill="rgba(245,158,11,0.35)" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="left" dataKey="despachados" name="Despachados" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" dataKey="cobertura" name="Cobertura %" stroke="#7c3aed" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Dialog: colar despachos da SELIMP */}
      <Dialog open={colarOpen} onOpenChange={(o) => setColarOpen(o)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ClipboardPaste className="h-5 w-5 text-amber-500" />
              Colar despachos da SELIMP — {format(diaDate, "dd/MM/yyyy")}
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              Copie a grade de despachos direto da plataforma SELIMP e cole abaixo. O sistema extrai os setores
              automaticamente (ignora o cabeçalho) e cruza com o cronograma do dia.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={colarTexto}
              onChange={(e) => {
                setColarTexto(e.target.value);
                setColarPreview(null);
              }}
              placeholder="Cole aqui as linhas copiadas da SELIMP…"
              rows={10}
              className="font-mono text-xs"
            />
            {colarPreview && (
              <div className="rounded-xl border border-sky-200/70 bg-sky-50/60 p-3 text-xs dark:border-sky-800/50 dark:bg-sky-950/30">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div>Extraídos: <span className="font-semibold text-foreground">{colarPreview.extraidos}</span></div>
                  <div>Conforme (previsto): <span className="font-semibold text-emerald-600 dark:text-emerald-400">{colarPreview.conforme}</span></div>
                  <div>Fora do plano: <span className="font-semibold text-blue-600 dark:text-blue-400">{colarPreview.fora_plano}</span></div>
                  <div>Não despachados: <span className="font-semibold text-rose-600 dark:text-rose-400">{colarPreview.nao_despachado}</span></div>
                </div>
                {colarPreview.avisos.length > 0 && (
                  <ul className="mt-2 max-h-24 list-disc space-y-1 overflow-y-auto pl-4 text-amber-700 dark:text-amber-300">
                    {colarPreview.avisos.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setColarOpen(false)} disabled={colarBusy}>
              Cancelar
            </Button>
            {!colarPreview ? (
              <Button onClick={previewColagem} disabled={colarBusy || !colarTexto.trim()} className="gap-2">
                {colarBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Pré-visualizar
              </Button>
            ) : (
              <Button
                onClick={confirmarColagem}
                disabled={colarBusy || colarPreview.extraidos === 0}
                className="gap-2 bg-amber-600 text-white hover:bg-amber-700"
              >
                {colarBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Gravar {colarPreview.extraidos} despachos
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de observação */}
      <Dialog open={obs != null} onOpenChange={(o) => !o && setObs(null)}>
        <DialogContent className="max-w-md">
          {obs && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <MessageSquarePlus className="h-5 w-5 text-amber-500" />
                  Registrar observação
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", subprefBadgeClass(obs.subprefeitura ?? ""))}>
                      {obs.subprefeitura ?? "—"}
                    </Badge>
                    <span className="font-mono text-sm font-medium">{obs.setor}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{obs.tipo_servico}</span>
                    <span>·</span>
                    <Badge variant="outline" className={cn("text-[10px]", STATUS_META[obs.status].className)}>
                      {STATUS_META[obs.status].label}
                    </Badge>
                  </div>
                </div>
                <Textarea
                  value={obsTexto}
                  onChange={(e) => setObsTexto(e.target.value)}
                  placeholder="Ex.: equipe remanejada para emergência; despacho não lançado no SELIMP…"
                  rows={4}
                />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setObs(null)} disabled={obsBusy}>
                  Cancelar
                </Button>
                <Button
                  className="gap-2 bg-amber-600 text-white hover:bg-amber-700"
                  disabled={!obsTexto.trim() || obsBusy}
                  onClick={salvarObs}
                >
                  {obsBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Salvar observação
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
