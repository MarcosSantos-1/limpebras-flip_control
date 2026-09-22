"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { format, startOfDay, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import {
  ArrowLeft,
  AlertTriangle,
  Search,
  Download,
  CalendarRange,
  Loader2,
  RefreshCw,
  Wrench,
  Users,
  MapPin,
  Layers,
} from "lucide-react";
import { MainLayout } from "@/components/layout/main-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
} from "@/components/motion-ui/motion-dialog";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  apiService,
  type GargaloDia,
  type GargaloSetor,
  type GargalosResponse,
  type MotivoGargalo,
  type ServicoGargalo,
} from "@/lib/api";
import { SUBPREFEITURAS, subprefBadgeClass } from "@/lib/mock/ipt-shared";
import { MOTIVO_GARGALO_LABEL, exportGargalos } from "@/lib/cruzamento-export";
import { cn } from "@/lib/utils";

const MOTIVO_CHIP: Record<MotivoGargalo, string> = {
  bateria: "border-rose-500/40 bg-rose-500/12 text-rose-700 dark:text-rose-300",
  falta_envio: "border-amber-500/40 bg-amber-500/12 text-amber-800 dark:text-amber-300",
  planejamento: "border-slate-500/40 bg-slate-500/12 text-slate-700 dark:text-slate-300",
  nunca: "border-orange-500/40 bg-orange-500/12 text-orange-800 dark:text-orange-300",
  execucao_baixa: "border-yellow-500/40 bg-yellow-500/12 text-yellow-800 dark:text-yellow-200",
};

const fmtInt = (v: number) => Math.round(v).toLocaleString("pt-BR");
const fmtPct = (v: number | null) => (v == null ? "—" : `${Math.round(v).toLocaleString("pt-BR")}%`);
const fmtPp = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function fraseLista(s: GargaloSetor): string {
  const motivo = s.frase.charAt(0).toUpperCase() + s.frase.slice(1);
  if (s.pp >= 0.05) return `Tira ${fmtPp(s.pp)} pp deste serviço — ${s.frase}`;
  return motivo;
}

function celula(d: GargaloDia): { className: string; label: string } {
  if (!d.encerrado && d.naoEnviado) return { className: "bg-rose-500 text-white", label: "Não enviado" };
  if (!d.encerrado) return { className: "bg-muted-foreground/25 text-foreground", label: "Não encerrado" };
  if (d.percentual != null && d.percentual <= 0) return { className: "bg-rose-400 text-white", label: "Zerado" };
  if (d.percentual != null && d.percentual < 50) return { className: "bg-amber-400 text-white", label: "Parcial" };
  return { className: "bg-emerald-500 text-white", label: "Executado" };
}

function servicoPesa(s: ServicoGargalo): boolean {
  return s.setoresProblema > 0 || s.naoEnviados > 0 || (s.gap ?? 0) >= 5;
}

function ListaGargalos({
  titulo,
  descricao,
  icon,
  setores,
  onAbrir,
}: {
  titulo: string;
  descricao: string;
  icon: ReactNode;
  setores: GargaloSetor[];
  onAbrir: (s: GargaloSetor) => void;
}) {
  return (
    <Card className="border-border/70">
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            {icon}
            {titulo}
          </CardTitle>
          <span className="text-xs text-muted-foreground">{setores.length} setores</span>
        </div>
        <p className="text-xs text-muted-foreground">{descricao}</p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center">#</TableHead>
              <TableHead>Setor</TableHead>
              <TableHead className="text-center">Encerr. / prev.</TableHead>
              <TableHead className="text-center">%</TableHead>
              <TableHead className="text-center">Pontos</TableHead>
              <TableHead>O que pesa</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {setores.map((s, i) => (
              <TableRow key={s.plano} className="cursor-pointer hover:bg-muted/40" onClick={() => onAbrir(s)}>
                <TableCell className="text-center font-mono text-xs tabular-nums text-muted-foreground">{i + 1}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", subprefBadgeClass(s.sub))}>
                      {s.sub}
                    </Badge>
                    <div className="min-w-0">
                      <div className="font-medium">{s.plano}</div>
                      <div className="truncate text-xs text-muted-foreground">{s.frequencia}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-center font-mono text-sm tabular-nums">
                  {s.encerrados}
                  <span className="text-muted-foreground"> / {s.previstos}</span>
                </TableCell>
                <TableCell className="text-center font-mono text-sm tabular-nums">{fmtPct(s.percentual)}</TableCell>
                <TableCell className="text-center font-mono text-sm font-bold tabular-nums text-rose-600 dark:text-rose-400">
                  {s.pp >= 0.05 ? fmtPp(s.pp) : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn("mb-1 text-[10px]", MOTIVO_CHIP[s.motivo])}>
                    {MOTIVO_GARGALO_LABEL[s.motivo]}
                  </Badge>
                  <p className="max-w-xs text-xs text-muted-foreground">{fraseLista(s)}</p>
                </TableCell>
              </TableRow>
            ))}
            {setores.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum setor neste grupo para os filtros atuais.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function CruzamentoPage() {
  const hoje = useMemo(() => startOfDay(new Date()), []);
  const inicioMes = useMemo(() => startOfMonth(hoje), [hoje]);

  const [range, setRange] = useState<DateRange | undefined>({ from: inicioMes, to: hoje });
  const [sub, setSub] = useState("all");
  const [serv, setServ] = useState("all");
  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState<GargaloSetor | null>(null);
  const [dias, setDias] = useState<GargaloDia[] | null>(null);
  const [diasLoading, setDiasLoading] = useState(false);
  const [data, setData] = useState<GargalosResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [salvando, setSalvando] = useState(false);

  const from = range?.from ?? inicioMes;
  const to = range?.to ?? hoje;

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const res = await apiService.getGargalos(format(from, "yyyy-MM-dd"), format(to, "yyyy-MM-dd"));
      setData(res);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar os gargalos.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void carregar();
  }, [carregar, nonce]);

  const periodoLabel = `${format(from, "dd/MM/yy", { locale: ptBR })} – ${format(to, "dd/MM/yy", { locale: ptBR })}`;

  const problemas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (data?.setores ?? []).filter((s) => {
      if (sub !== "all" && s.sub !== sub) return false;
      if (serv !== "all" && s.tipoServico !== serv) return false;
      if (!t) return true;
      return (
        s.plano.toLowerCase().includes(t) ||
        s.sub.toLowerCase().includes(t) ||
        s.tipoServico.toLowerCase().includes(t) ||
        s.frase.toLowerCase().includes(t)
      );
    });
  }, [data, sub, serv, busca]);

  const nossos = useMemo(() => problemas.filter((s) => s.grupo === "nosso"), [problemas]);
  const operacionais = useMemo(() => problemas.filter((s) => s.grupo === "operacional"), [problemas]);

  const servicosVisiveis = useMemo(() => {
    const lista = data?.servicos ?? [];
    if (serv !== "all") return lista.filter((s) => s.tipoServico === serv);
    return lista.filter(servicoPesa);
  }, [data, serv]);

  const servicosQuietos = useMemo(() => {
    if (serv !== "all") return [];
    return (data?.servicos ?? []).filter((s) => !servicoPesa(s));
  }, [data, serv]);

  const planoAberto = selecionado?.plano ?? null;

  useEffect(() => {
    if (!planoAberto) {
      setDias(null);
      return;
    }
    let cancel = false;
    setDiasLoading(true);
    setDias(null);
    apiService
      .getGargaloDetalhe(planoAberto, format(from, "yyyy-MM-dd"), format(to, "yyyy-MM-dd"))
      .then((res) => {
        if (!cancel) setDias(res.dias);
      })
      .catch(() => {
        if (!cancel) setDias([]);
      })
      .finally(() => {
        if (!cancel) setDiasLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [planoAberto, from, to]);

  useEffect(() => {
    if (!selecionado || !data) return;
    const atual = data.setores.find((s) => s.plano === selecionado.plano);
    if (atual && atual.obsTitulo !== selecionado.obsTitulo) setSelecionado(atual);
  }, [data, selecionado]);

  const registrar = useCallback(
    async (titulo: string) => {
      if (!selecionado) return;
      setSalvando(true);
      try {
        await apiService.createIptObservacaoGlobal(selecionado.plano, titulo);
        setSelecionado({ ...selecionado, obsTitulo: titulo });
        await carregar();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível registrar a causa.");
      } finally {
        setSalvando(false);
      }
    },
    [selecionado, carregar],
  );

  return (
    <MainLayout>
      <div className="min-h-screen bg-background">
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
                <AlertTriangle className="h-6 w-6 text-amber-500" />
                <div>
                  <h1 className="text-xl font-bold text-foreground">Gargalos de execução</h1>
                  <p className="text-xs text-muted-foreground">
                    O que puxa o percentual de cada serviço para baixo
                  </p>
                </div>
              </div>
            </div>
            <Badge variant="outline" className="gap-1.5">
              <CalendarRange className="h-3.5 w-3.5" />
              {periodoLabel}
            </Badge>
          </div>
        </div>

        <div className="space-y-6 px-6 py-6">
          {erro && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {erro}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-card/60 p-3">
            <DateRangePicker
              value={range}
              onChange={setRange}
              maxDate={hoje}
              modeLabel="Período"
              className="bg-amber-600 hover:bg-amber-700"
            />
            <Select value={sub} onValueChange={setSub}>
              <SelectTrigger className="h-10 w-[170px]">
                <MapPin className="mr-1 h-4 w-4 text-amber-600" />
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
              <SelectTrigger className="h-10 w-[260px]">
                <Layers className="mr-1 h-4 w-4 text-amber-600" />
                <SelectValue placeholder="Tipo de serviço" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os serviços</SelectItem>
                {(data?.servicos ?? []).map((s) => (
                  <SelectItem key={s.tipoServico} value={s.tipoServico}>
                    {s.tipoServico}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              className="h-10 gap-2"
              onClick={() =>
                exportGargalos(problemas, {
                  periodoLabel,
                  subLabel: sub === "all" ? "Todas" : sub,
                  servicoLabel: serv === "all" ? "Todos" : serv,
                })
              }
              disabled={problemas.length === 0}
            >
              <Download className="h-4 w-4" />
              Exportar
            </Button>
          </div>

          {loading && !data ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-7 w-7 animate-spin text-amber-500" />
            </div>
          ) : (
            <>
              <p className="max-w-3xl text-sm text-muted-foreground">
                A média de cada serviço olha só os despachos encerrados. Cada dia conta uma vez, então um setor
                diário derruba o percentual bem mais do que um mensal. O que não foi enviado fica de fora dessa
                média — é buraco nosso de planejamento, e aparece pelo volume.
              </p>

              {!loading && (data?.servicos.length ?? 0) === 0 && (
                <div className="rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                  Não há despachos encerrados neste período. Ajuste as datas para um mês que já tenha relatório SELIMP.
                </div>
              )}

              {sub !== "all" && (
                <p className="text-xs text-muted-foreground">
                  Os pontos de cada card são do serviço inteiro. A lista abaixo mostra só {sub}.
                </p>
              )}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {servicosVisiveis.map((s) => (
                  <Card key={s.tipoServico} className="border-border/70">
                    <CardHeader className="space-y-1 pb-2">
                      <p className="text-3xl font-bold tabular-nums">{fmtPct(s.percentual)}</p>
                      <CardTitle className="text-sm font-medium leading-snug">{s.tipoServico}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1.5 text-sm text-muted-foreground">
                      {s.percentual == null ? (
                        <p>Nenhum despacho encerrado neste período.</p>
                      ) : (s.gap ?? 0) >= 0.5 ? (
                        <p>
                          {fmtPp(s.gap ?? 0)} pp abaixo de 100%
                          {s.setoresProblema > 0 ? ` · ${s.setoresProblema} setores na lista` : ""}.
                        </p>
                      ) : null}
                      {s.ppBateria >= 0.5 && <p>Bateria tira {fmtPp(s.ppBateria)} pp — pendente.</p>}
                      {s.ppPlanejamento >= 0.5 && (
                        <p>Planejamento ou cadastro tira {fmtPp(s.ppPlanejamento)} pp — pendente.</p>
                      )}
                      {s.ppFaltaEnvio >= 0.5 && (
                        <p>
                          {fmtPp(s.ppFaltaEnvio)} pp vêm do pedaço encerrado de setores que quase não enviamos.
                        </p>
                      )}
                      {s.ppOperacional >= 0.5 && (
                        <p>Execução em campo, com bateria ok, tira {fmtPp(s.ppOperacional)} pp.</p>
                      )}
                      {s.ppDemais >= 1 && (
                        <p>O restante, {fmtPp(s.ppDemais)} pp, são setores que executam sem fechar em 100%.</p>
                      )}
                      {s.naoEnviados > 0 && (
                        <p className="font-medium text-amber-700 dark:text-amber-300">
                          {fmtInt(s.naoEnviados)} previstos não foram enviados. Não entram nessa média.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              {servicosQuietos.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Sem gargalo relevante: {servicosQuietos.map((s) => `${s.tipoServico} (${fmtPct(s.percentual)})`).join(" · ")}
                </p>
              )}

              <div className="grid grid-cols-1 gap-4">
                <ListaGargalos
                  titulo="Problema operacional"
                  descricao="Foi despachado, a bateria está ok, e a execução não acompanha."
                  icon={<Users className="h-4 w-4 text-orange-600" />}
                  setores={operacionais}
                  onAbrir={setSelecionado}
                />
                <ListaGargalos
                  titulo="Pendentes"
                  descricao="Bateria, falta de envio ou cadastro. Dá para agir daqui."
                  icon={<Wrench className="h-4 w-4 text-amber-600" />}
                  setores={nossos}
                  onAbrir={setSelecionado}
                />
              </div>
            </>
          )}
        </div>
      </div>

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
                  <span>{selecionado.frequencia}</span>
                  <Badge variant="outline" className={cn("ml-auto text-[10px]", MOTIVO_CHIP[selecionado.motivo])}>
                    {selecionado.grupo === "nosso" ? "Pendentes" : "Problema operacional"} ·{" "}
                    {MOTIVO_GARGALO_LABEL[selecionado.motivo]}
                  </Badge>
                </div>

                <p className="text-sm">{fraseLista(selecionado)}</p>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { l: "Previstos", v: selecionado.previstos },
                    { l: "Encerrados", v: selecionado.encerrados },
                    { l: "Não enviados", v: selecionado.naoEnviados },
                    { l: "% médio", v: fmtPct(selecionado.percentual) },
                  ].map((m) => (
                    <div key={m.l} className="rounded-xl border border-border/70 bg-muted/20 p-3 text-center">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{m.l}</p>
                      <p className="mt-1 font-mono text-xl font-bold tabular-nums">{m.v}</p>
                    </div>
                  ))}
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Dias previstos no período</p>
                  {diasLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {(dias ?? []).map((d) => {
                        const est = celula(d);
                        return (
                          <div
                            key={d.data}
                            className={cn(
                              "flex h-8 w-8 items-center justify-center rounded-md text-[10px] font-semibold",
                              est.className,
                            )}
                            title={`${d.data} · ${est.label}${d.percentual != null ? ` · ${Math.round(d.percentual)}%` : ""}`}
                          >
                            {d.data.slice(-2)}
                          </div>
                        );
                      })}
                      {!diasLoading && (dias ?? []).length === 0 && (
                        <p className="text-xs text-muted-foreground">Sem dias previstos neste período.</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-md border border-border/60 px-2 py-1">
                    Módulo:{" "}
                    <strong>{!selecionado.temModulo ? "sem SELIMP" : selecionado.comSinal ? "com sinal" : "sem sinal"}</strong>
                  </span>
                  <span className="rounded-md border border-border/60 px-2 py-1">
                    Bateria:{" "}
                    <strong>{selecionado.bateriaMedia != null ? fmtPct(selecionado.bateriaMedia) : "—"}</strong>
                  </span>
                  <span className="rounded-md border border-border/60 px-2 py-1">
                    Trocas: <strong>{selecionado.qtdTrocas}</strong>
                  </span>
                  {selecionado.divergencia != null && (
                    <span className="rounded-md border border-border/60 px-2 py-1">
                      SELIMP {fmtPct(selecionado.percentual)} × DDMX {fmtPct(selecionado.percentualDdmx)}
                    </span>
                  )}
                </div>

                <div className="rounded-xl border border-border/70 bg-muted/15 p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Registrar causa
                    {selecionado.obsTitulo && (
                      <span className="ml-2 text-emerald-600 dark:text-emerald-400">· {selecionado.obsTitulo}</span>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {["Bateria", "Falta de envio", "Planejamento / cadastro", "Operação não cumpriu"].map((titulo) => (
                      <Button
                        key={titulo}
                        variant="outline"
                        size="sm"
                        disabled={salvando}
                        className="h-8 text-xs"
                        onClick={() => void registrar(titulo)}
                      >
                        {salvando ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                        {titulo}
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
