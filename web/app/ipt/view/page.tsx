"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format, startOfDay, startOfMonth, endOfMonth, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Eye,
  RefreshCw,
  CalendarClock,
  AlertTriangle,
  Send,
  Sun,
  Sunset,
  Moon,
  MapPin,
  Clock,
  Layers,
  Brush,
  Loader2,
} from "lucide-react";
import { ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { apiService, type DespachosResponse, type IptPreviewResponse } from "@/lib/api";
import { SUBPREFEITURAS, subprefBadgeClass } from "@/lib/mock/ipt-shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Turnos canônicos. */
const TURNOS = [
  { value: "Diurno", label: "1 - Diurno" },
  { value: "Vespertino", label: "2 - Vespertino" },
  { value: "Noturno", label: "3 - Noturno" },
] as const;

const ORDEM_TURNO: Record<string, number> = { Diurno: 0, Vespertino: 1, Noturno: 2 };

/**
 * Turno + dia de referência conforme o horário atual (espelha a página de Despachos).
 */
function vigenteInicial(now = new Date()): { turno: "Diurno" | "Vespertino" | "Noturno"; dia: string } {
  const mins = now.getHours() * 60 + now.getMinutes();
  const hoje = startOfDay(now);
  if (mins >= 6 * 60 && mins < 14 * 60 + 20) return { turno: "Diurno", dia: format(hoje, "yyyy-MM-dd") };
  if (mins >= 14 * 60 + 20 && mins < 22 * 60 + 30) return { turno: "Vespertino", dia: format(hoje, "yyyy-MM-dd") };
  const diaRef = mins < 6 * 60 ? subDays(hoje, 1) : hoje;
  return { turno: "Noturno", dia: format(diaRef, "yyyy-MM-dd") };
}

/** Varrição = sarjetas (VJ/VL) e varrição de praças (VP) — ocultas por padrão (poluem a visão). */
function isVarricao(tipoServico: string): boolean {
  const t = tipoServico.toLowerCase();
  return t.includes("sarjeta") || t.includes("varrição de praças") || t.includes("varricao de pracas");
}

/** Rótulo de exibição do serviço (corrige nomes salvos de forma técnica). */
function servicoLabel(tipoServico: string): string {
  if (/serviços de vf|servicos de vf/i.test(tipoServico)) return "Varrição de feiras-livres";
  return tipoServico;
}

/** Sigla do serviço (2 letras) extraída da nomenclatura do setor — ex.: JT20402CV0002 → "CV". */
function siglaServico(setor: string): string | null {
  const m = setor.replace(/\s+/g, "").match(/^[A-Za-z]{2}\d{5}([A-Za-z]{2})\d{4}/);
  return m ? m[1].toUpperCase() : null;
}

function pct(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "--" : `${value.toFixed(1)}%`;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function parseDia(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return startOfDay(subDays(new Date(), 1));
  return new Date(y, m - 1, d);
}

const EMPTY_DESPACHOS: DespachosResponse = {
  dia: "",
  kpis: { previstos: 0, despachados: 0, naoDespachados: 0, foraPlano: 0, zerados: 0, cobertura: 0 },
  linhas: [],
  tendencia14d: [],
  turnos: [],
};

/** Card de KPI somente leitura (sem clique/filtro — esta é a visão CCO). */
function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tint,
  emphasis,
}: {
  icon: typeof Send;
  label: string;
  value: string | number;
  sub?: string;
  tint: string;
  emphasis?: boolean;
}) {
  return (
    <Card className={cn("relative overflow-hidden border-border/70", emphasis && "border-rose-500/40")}>
      <div className={cn("absolute inset-y-0 left-0 w-1", tint)} aria-hidden />
      <CardContent className="flex items-center justify-between gap-3 p-3 pl-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className={cn("mt-1 font-mono text-2xl font-bold leading-none tabular-nums", emphasis && "text-rose-600 dark:text-rose-400")}>
            {value}
          </p>
          {sub && <p className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">{sub}</p>}
        </div>
        <Icon className={cn("size-4 shrink-0 text-muted-foreground/70", emphasis && "text-rose-500")} />
      </CardContent>
    </Card>
  );
}

export default function ViewCcoPage() {
  const inicial = useMemo(() => vigenteInicial(), []);
  const hoje = format(startOfDay(new Date()), "yyyy-MM-dd");

  const [dia, setDia] = useState(inicial.dia);
  const [turno, setTurno] = useState<string>(inicial.turno);
  const [sub, setSub] = useState("all");
  const [hideVarricao, setHideVarricao] = useState(true); // padrão: oculta varrição
  const [nonce, setNonce] = useState(0);

  const [desp, setDesp] = useState<DespachosResponse>(EMPTY_DESPACHOS);
  const [servicosMes, setServicosMes] = useState<IptPreviewResponse["servicos"]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const diaDate = parseDia(dia);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      // Mês acumulado (dia 01 → hoje, capado no fim do mês) — mesma janela dos cards do IPT.
      const mesInicio = format(startOfMonth(diaDate), "yyyy-MM-dd");
      const fimMes = endOfMonth(diaDate);
      const cap = new Date() < fimMes ? new Date() : fimMes;
      const mesFim = format(cap < diaDate ? diaDate : cap, "yyyy-MM-dd");

      const [despRes, previewRes] = await Promise.all([
        apiService.getDespachos({ dia }),
        apiService.getIptPreview(mesInicio, mesFim, false, sub),
      ]);
      setDesp(despRes);
      setServicosMes(previewRes.servicos ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar o painel.");
      setDesp(EMPTY_DESPACHOS);
      setServicosMes([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dia, sub]);

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dia, sub, nonce]);

  /** Linhas do dia respeitando sub + varrição, mas SEM o filtro de turno (para o painel por turno). */
  const linhasBase = useMemo(() => {
    return desp.linhas.filter((l) => {
      if (sub !== "all" && (l.subprefeitura ?? "") !== sub) return false;
      if (hideVarricao && isVarricao(l.tipo_servico)) return false;
      return true;
    });
  }, [desp.linhas, sub, hideVarricao]);

  /** Linhas do turno selecionado (foco principal do CCO). */
  const linhasTurno = useMemo(() => {
    if (turno === "all") return linhasBase;
    return linhasBase.filter((l) => (l.turno ?? "").toLowerCase() === turno.toLowerCase());
  }, [linhasBase, turno]);

  /** KPIs recalculados para o turno/filtros atuais. */
  const kpis = useMemo(() => {
    let previstos = 0;
    let despachados = 0;
    let naoDespachados = 0;
    let foraPlano = 0;
    let zerados = 0;
    for (const l of linhasTurno) {
      if (l.esperado) previstos++;
      const fezDespacho = l.despachadoManual || l.despachosSelimp > 0;
      if (l.esperado && fezDespacho) despachados++;
      if (l.status === "nao_despachado") naoDespachados++;
      if (l.status === "fora_plano") foraPlano++;
      if (l.status === "zerado") zerados++;
    }
    return {
      previstos,
      despachados,
      naoDespachados,
      foraPlano,
      zerados,
      cobertura: previstos > 0 ? Math.round((despachados / previstos) * 100) : 0,
    };
  }, [linhasTurno]);

  /** Cobertura por turno (panorama — todos os turnos, independente do filtro de turno). */
  const porTurno = useMemo(() => {
    const map = new Map<string, { previstos: number; despachados: number }>();
    for (const l of linhasBase) {
      if (!l.esperado) continue;
      const t = l.turno ?? "Sem turno";
      const b = map.get(t) ?? { previstos: 0, despachados: 0 };
      b.previstos++;
      if (l.despachadoManual || l.despachosSelimp > 0) b.despachados++;
      map.set(t, b);
    }
    return Array.from(map.entries())
      .map(([t, v]) => ({
        turno: t,
        previstos: v.previstos,
        despachados: v.despachados,
        cobertura: v.previstos > 0 ? Math.round((v.despachados / v.previstos) * 100) : 0,
      }))
      .sort((a, b) => (ORDEM_TURNO[a.turno] ?? 99) - (ORDEM_TURNO[b.turno] ?? 99) || a.turno.localeCompare(b.turno));
  }, [linhasBase]);

  /** Serviços no dia (turno selecionado) — previstos × despachados × cobertura. */
  const porServicoDia = useMemo(() => {
    const map = new Map<string, { previstos: number; despachados: number }>();
    for (const l of linhasTurno) {
      if (!l.esperado) continue;
      const s = servicoLabel(l.tipo_servico);
      const b = map.get(s) ?? { previstos: 0, despachados: 0 };
      b.previstos++;
      if (l.despachadoManual || l.despachosSelimp > 0) b.despachados++;
      map.set(s, b);
    }
    return Array.from(map.entries())
      .map(([s, v]) => ({
        servico: s,
        previstos: v.previstos,
        despachados: v.despachados,
        cobertura: v.previstos > 0 ? Math.round((v.despachados / v.previstos) * 100) : 0,
      }))
      .sort((a, b) => b.previstos - a.previstos || a.servico.localeCompare(b.servico));
  }, [linhasTurno]);

  /** Lookup de cobertura por turno (para os cards Diurno/Vespertino/Noturno). */
  const porTurnoMap = useMemo(() => {
    const m = new Map<string, { previstos: number; despachados: number; cobertura: number }>();
    for (const t of porTurno) m.set(t.turno, t);
    return m;
  }, [porTurno]);

  /** Despachos pendentes (não despachados) no turno — ordenados por sub (A-Z) e depois serviço (A-Z). */
  const pendentesTurno = useMemo(() => {
    return linhasTurno
      .filter((l) => l.status === "nao_despachado")
      .sort(
        (a, b) =>
          (a.subprefeitura ?? "").localeCompare(b.subprefeitura ?? "") ||
          servicoLabel(a.tipo_servico).localeCompare(servicoLabel(b.tipo_servico)) ||
          a.setor.localeCompare(b.setor),
      );
  }, [linhasTurno]);

  /** Serviços ativos do MÊS (percentual de execução) — respeita o filtro de varrição. */
  const servicosMesFiltrados = useMemo(() => {
    return [...servicosMes]
      .filter((s) => !(hideVarricao && isVarricao(s.tipo_servico)))
      .sort((a, b) => (b.media_execucao ?? -1) - (a.media_execucao ?? -1));
  }, [servicosMes, hideVarricao]);

  // Ring no card principal (fundo azul) → traço branco sobre trilho translúcido.
  const donutTopbar = [
    { name: "Despachados", value: kpis.despachados, fill: "#ffffff" },
    { name: "Pendentes", value: Math.max(0, kpis.previstos - kpis.despachados), fill: "rgba(255,255,255,0.2)" },
  ];

  const turnoLabel = turno === "all" ? "Todos os turnos" : (TURNOS.find((t) => t.value === turno)?.label ?? turno);

  return (
    <MainLayout>
      <div className="min-h-screen bg-background">
        <div className="space-y-3 px-4 py-3">
          {erro && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {erro}
            </div>
          )}

          {/* Top bar unificado: título + filtros + ring de cobertura */}
          <Card className="relative overflow-hidden border-cyan-400/40 bg-linear-to-br from-cyan-600/95 via-sky-700 to-indigo-900 text-white shadow-lg shadow-cyan-900/30 ring-1 ring-white/15">
            <div className="pointer-events-none absolute -right-20 -top-20 size-56 rounded-full bg-cyan-300/20 blur-3xl" aria-hidden />
            <CardContent className="relative flex flex-wrap items-center gap-x-5 gap-y-3 p-4">
              <div className="flex shrink-0 items-center gap-2.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20 text-white shadow-inner">
                  <Eye className="h-5 w-5" />
                </div>
                <div className="leading-tight">
                  <h1 className="text-base font-bold text-white">Painel CCO</h1>
                  <p className="text-[11px] capitalize text-white/80">
                    {format(diaDate, "EEE, dd 'de' MMM", { locale: ptBR })} · {turnoLabel.toLowerCase()}
                  </p>
                </div>
              </div>

              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                <DatePicker
                  value={dia}
                  onChange={(v) => setDia(v || hoje)}
                  compact
                  className="h-9 max-w-none border-white/30 bg-white/10 text-white shadow-none hover:bg-white/20 hover:text-white"
                />
                <Select value={turno} onValueChange={setTurno}>
                  <SelectTrigger className="h-9 w-[150px] shrink-0 border-white/30 bg-white/10 text-white">
                    <Clock className="mr-1 h-4 w-4 text-cyan-200" />
                    <SelectValue placeholder="Turno" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os turnos</SelectItem>
                    {TURNOS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={sub} onValueChange={setSub}>
                  <SelectTrigger className="h-9 w-[140px] shrink-0 border-white/30 bg-white/10 text-white">
                    <MapPin className="mr-1 h-4 w-4 text-cyan-200" />
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
                <button
                  type="button"
                  onClick={() => setHideVarricao((v) => !v)}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition-colors",
                    hideVarricao
                      ? "border-white/70 bg-white/25 text-white"
                      : "border-white/30 bg-white/10 text-white/90 hover:bg-white/20",
                  )}
                  title={hideVarricao ? "Varrição oculta (clique para mostrar)" : "Varrição visível (clique para ocultar)"}
                >
                  <Brush className="h-4 w-4" />
                  {hideVarricao ? "Varrição oculta" : "Varrição visível"}
                </button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 shrink-0 border-white/30 bg-white/10 p-0 text-white hover:bg-white/20 hover:text-white"
                  onClick={() => setNonce((n) => n + 1)}
                  disabled={loading}
                  title="Atualizar"
                >
                  <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                </Button>
              </div>

              {/* Ring de cobertura (somente o %) */}
              <div className="relative ml-auto h-16 w-16 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donutTopbar} dataKey="value" innerRadius="72%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="none">
                      {donutTopbar.map((d) => (
                        <Cell key={d.name} fill={d.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="font-mono text-base font-bold tabular-nums text-white">{kpis.cobertura}%</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* KPIs do turno (somente leitura): previstos + cobertura por turno */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              icon={CalendarClock}
              label="Previstos / Despachados"
              value={`${kpis.previstos}/${kpis.despachados}`}
              tint="bg-cyan-500"
            />
            {([
              { turno: "Diurno", icon: Sun, tint: "bg-amber-500" },
              { turno: "Vespertino", icon: Sunset, tint: "bg-orange-500" },
              { turno: "Noturno", icon: Moon, tint: "bg-indigo-500" },
            ] as const).map((t) => {
              const d = porTurnoMap.get(t.turno);
              return (
                <KpiCard
                  key={t.turno}
                  icon={t.icon}
                  label={t.turno}
                  value={`${d?.cobertura ?? 0}%`}
                  sub={`${d?.despachados ?? 0}/${d?.previstos ?? 0} despachados`}
                  tint={t.tint}
                />
              );
            })}
          </div>

          {/* Listas (painel compacto): pendentes + serviços no dia + serviços no mês */}
          <div className="grid gap-3 lg:grid-cols-3">
            {/* Despachos pendentes no turno (não despachados) — com % histórico */}
            <Card className="border-border/70">
              <CardHeader className="p-3 pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-sm">Pendentes no turno</CardTitle>
                    <CardDescription className="text-[11px]">Previstos ainda não despachados.</CardDescription>
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 gap-1 border-rose-500/40 bg-rose-500/12 text-[11px] text-rose-700 dark:text-rose-300"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    {pendentesTurno.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-cyan-500" />
                  </p>
                ) : pendentesTurno.length === 0 ? (
                  <p className="py-8 text-center text-sm text-emerald-600 dark:text-emerald-400">
                    Tudo despachado. 🎉
                  </p>
                ) : (
                  <div className="divide-y divide-border/50">
                    {pendentesTurno.map((l) => (
                      <div key={l.setor} className="flex items-center gap-2 px-3 py-1.5">
                        <Badge variant="outline" className={cn("h-5 shrink-0 px-1.5 text-[10px]", subprefBadgeClass(l.subprefeitura ?? ""))}>
                          {l.subprefeitura ?? "—"}
                        </Badge>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5">
                            <span className="truncate font-mono text-sm font-bold text-foreground">{l.setor}</span>
                            {siglaServico(l.setor) && (
                              <span className="shrink-0 rounded bg-cyan-500/15 px-1 py-0.5 font-mono text-[10px] font-bold text-cyan-700 dark:text-cyan-300">
                                {siglaServico(l.setor)}
                              </span>
                            )}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">{servicoLabel(l.tipo_servico)}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-mono text-sm font-bold tabular-nums text-cyan-600 dark:text-cyan-400">
                            {l.percentualHistorico != null ? `${l.percentualHistorico}%` : "—"}
                          </p>
                          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">% ant.</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Serviços no dia */}
            <Card className="border-border/70">
              <CardHeader className="p-3 pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-sm">Serviços no dia</CardTitle>
                    <CardDescription className="text-[11px]">Despacho por tipo de serviço.</CardDescription>
                  </div>
                  <Layers className="h-4 w-4 shrink-0 text-cyan-500" />
                </div>
              </CardHeader>
              <CardContent className="space-y-1.5 p-3 pt-0">
                {loading && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-cyan-500" />
                  </p>
                )}
                {!loading && porServicoDia.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">Sem serviços previstos.</p>
                )}
                {!loading &&
                  porServicoDia.map((s) => (
                    <div key={s.servico} className="rounded-lg bg-background/60 p-2.5 shadow-sm">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-xs font-semibold">{s.servico}</span>
                        <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-cyan-600 dark:text-cyan-400">
                          {s.cobertura}%
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/50">
                          <div
                            className="h-full rounded-full bg-linear-to-r from-cyan-500 to-sky-500 transition-all"
                            style={{ width: `${clamp(s.cobertura)}%` }}
                          />
                        </div>
                        <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
                          {s.despachados}/{s.previstos}
                        </span>
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>

            {/* Serviços (ativos) no mês */}
            <Card className="border-border/70">
              <CardHeader className="p-3 pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-sm">Serviços (ativos) no mês</CardTitle>
                    <CardDescription className="text-[11px]">% execução · {format(diaDate, "MMM/yyyy", { locale: ptBR })}.</CardDescription>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {servicosMesFiltrados.length}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-1.5 p-3 pt-0">
                {loading && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-cyan-500" />
                  </p>
                )}
                {!loading && servicosMesFiltrados.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">Sem dados de execução.</p>
                )}
                {!loading &&
                  servicosMesFiltrados.map((s) => (
                    <div key={s.tipo_servico} className="rounded-lg bg-background/60 p-2.5 shadow-sm">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-xs font-semibold">{servicoLabel(s.tipo_servico || "Não informado")}</span>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className="font-mono text-sm font-bold tabular-nums text-cyan-600 dark:text-cyan-400" title="Média de execução (com zerados)">
                            {pct(s.media_execucao)}
                          </span>
                          <span className="text-[11px] text-muted-foreground" aria-hidden>/</span>
                          <span className="font-mono text-xs font-bold tabular-nums text-emerald-600 dark:text-emerald-400" title="Média de execução (sem zerados)">
                            {pct(s.media_sem_zerados ?? null)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/50">
                          <div
                            className="h-full rounded-full bg-linear-to-r from-emerald-500 to-cyan-500 transition-all"
                            style={{ width: `${clamp(s.media_execucao ?? 0)}%` }}
                          />
                        </div>
                        <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
                          {s.cobertura_despachos != null ? `${s.cobertura_despachos.toFixed(0)}% desp.` : "—"}
                        </span>
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
