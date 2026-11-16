"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BatteryCharging, CalendarClock, CheckCircle2, Loader2, RefreshCw, Search, Trash2, XCircle, AlertTriangle, BatteryWarning } from "lucide-react";
import { toast } from "react-toastify";
import { apiService, type DdmxModulo } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/motion-ui/motion-dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function isoBr(iso?: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function diasDesde(iso?: string | null): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const ms = Date.now() - new Date(y, m - 1, d).getTime();
  return Math.floor(ms / 86_400_000);
}

type Situacao = "critica" | "sem_leitura" | "desatualizada" | "baixa" | "ok";

/** Classifica a bateria do módulo DDMX pela última leitura dos despachos. */
function situacao(m: DdmxModulo): Situacao {
  const l = m.ultimaLeitura;
  if (!l) return "sem_leitura";
  if (l.desatualizada) return "desatualizada";
  if (l.bateria == null) return "sem_leitura";
  if (l.bateria < 20) return "critica";
  if (l.bateria < 45) return "baixa";
  return "ok";
}

const SITUACAO_INFO: Record<Situacao, { label: string; cls: string; ordem: number }> = {
  critica: { label: "Crítica (<20%)", cls: "bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400", ordem: 0 },
  desatualizada: { label: "Desatualizada", cls: "bg-orange-500/15 text-orange-600 border-orange-500/30 dark:text-orange-400", ordem: 1 },
  sem_leitura: { label: "Sem leitura", cls: "bg-zinc-500/15 text-zinc-600 border-zinc-500/30 dark:text-zinc-400", ordem: 2 },
  baixa: { label: "Baixa (<45%)", cls: "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400", ordem: 3 },
  ok: { label: "OK", cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400", ordem: 4 },
};

type Acao = { modo: "agendar" | "concluir"; modulos: DdmxModulo[] };

export function DdmxTab() {
  const [modulos, setModulos] = useState<DdmxModulo[]>([]);
  const [atualizadoAte, setAtualizadoAte] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtroSituacao, setFiltroSituacao] = useState<"all" | Situacao | "agendados">("all");
  const [filtroSub, setFiltroSub] = useState("all");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [acao, setAcao] = useState<Acao | null>(null);
  const [historicoDe, setHistoricoDe] = useState<DdmxModulo | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiService.getDdmxModulos();
      setModulos(r.modulos);
      setAtualizadoAte(r.atualizadoAte);
    } catch {
      toast.error("Não foi possível carregar os módulos DDMX.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const subs = useMemo(
    () => [...new Set(modulos.map((m) => m.subprefeitura).filter((s): s is string => !!s))].sort(),
    [modulos],
  );

  const contagem = useMemo(() => {
    const c: Record<Situacao, number> = { critica: 0, desatualizada: 0, sem_leitura: 0, baixa: 0, ok: 0 };
    let agendados = 0;
    let trocas30d = 0;
    for (const m of modulos) {
      c[situacao(m)] += 1;
      if (m.agendamento) agendados += 1;
      trocas30d += m.historico.filter((h) => h.status === "concluida" && (diasDesde(h.dataTroca) ?? 99) <= 30).length;
    }
    return { ...c, agendados, trocas30d };
  }, [modulos]);

  const lista = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return modulos
      .filter((m) => filtroSub === "all" || m.subprefeitura === filtroSub)
      .filter((m) =>
        filtroSituacao === "all" ? true : filtroSituacao === "agendados" ? !!m.agendamento : situacao(m) === filtroSituacao,
      )
      .filter((m) => !q || m.ddmxCodigo.toUpperCase().includes(q) || m.setores.some((s) => s.toUpperCase().includes(q)))
      .sort((a, b) => {
        const d = SITUACAO_INFO[situacao(a)].ordem - SITUACAO_INFO[situacao(b)].ordem;
        if (d !== 0) return d;
        return (a.ultimaLeitura?.bateria ?? -1) - (b.ultimaLeitura?.bateria ?? -1);
      });
  }, [modulos, busca, filtroSituacao, filtroSub]);

  const toggle = (codigo: string) =>
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(codigo)) next.delete(codigo);
      else next.add(codigo);
      return next;
    });

  const selecionadosModulos = modulos.filter((m) => selecionados.has(m.ddmxCodigo));

  const kpis: Array<{ key: typeof filtroSituacao; label: string; value: number; cls: string; icon: typeof BatteryCharging }> = [
    { key: "critica", label: "Bateria crítica", value: contagem.critica, cls: "from-red-500 to-rose-600", icon: BatteryWarning },
    { key: "desatualizada", label: "Desatualizadas", value: contagem.desatualizada, cls: "from-orange-500 to-amber-600", icon: AlertTriangle },
    { key: "sem_leitura", label: "Sem leitura (14d)", value: contagem.sem_leitura, cls: "from-zinc-500 to-slate-600", icon: XCircle },
    { key: "agendados", label: "Trocas agendadas", value: contagem.agendados, cls: "from-sky-500 to-blue-600", icon: CalendarClock },
    { key: "ok", label: "Bateria OK", value: contagem.ok, cls: "from-emerald-500 to-teal-600", icon: BatteryCharging },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {kpis.map((k) => (
          <button
            key={k.key}
            type="button"
            onClick={() => setFiltroSituacao((cur) => (cur === k.key ? "all" : k.key))}
            className={cn(
              "rounded-xl bg-linear-to-br p-4 text-left text-white shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl",
              k.cls,
              filtroSituacao === k.key && "ring-2 ring-white/80 ring-offset-2 ring-offset-background",
            )}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-white/85">{k.label}</p>
              <k.icon className="h-4 w-4 text-white/70" />
            </div>
            <p className="mt-2 text-3xl font-bold tabular-nums">{k.value}</p>
          </button>
        ))}
      </div>

      <Card className="border-0 shadow-lg">
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BatteryCharging className="h-5 w-5 text-emerald-500" /> Trocas de bateria — módulos DDMX
              </CardTitle>
              <CardDescription>
                Rastreador secundário, controlado de forma independente da CLIMP. Bateria = última leitura DDMX dos despachos
                (até {isoBr(atualizadoAte)}, janela de 14 dias). {modulos.length} módulos · {contagem.trocas30d} trocas nos últimos 30 dias.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!selecionadosModulos.length}
                onClick={() => setAcao({ modo: "agendar", modulos: selecionadosModulos })}
              >
                <CalendarClock className="mr-1.5 h-4 w-4" /> Agendar ({selecionadosModulos.length})
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={!selecionadosModulos.length}
                onClick={() => setAcao({ modo: "concluir", modulos: selecionadosModulos })}
              >
                <CheckCircle2 className="mr-1.5 h-4 w-4" /> Registrar troca ({selecionadosModulos.length})
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void carregar()} disabled={loading}>
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Módulo DDMX ou setor" className="pl-8" />
            </div>
            <Select value={filtroSub} onValueChange={setFiltroSub}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Subprefeitura" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas subs</SelectItem>
                {subs.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filtroSituacao !== "all" && (
              <Button size="sm" variant="ghost" onClick={() => setFiltroSituacao("all")}>Limpar filtro</Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : lista.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum módulo DDMX. Cadastre o código DDMX dos setores na aba Setores.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        checked={lista.length > 0 && lista.every((m) => selecionados.has(m.ddmxCodigo))}
                        onCheckedChange={(v) =>
                          setSelecionados(v ? new Set(lista.map((m) => m.ddmxCodigo)) : new Set())
                        }
                      />
                    </TableHead>
                    <TableHead>Módulo DDMX</TableHead>
                    <TableHead>Setores</TableHead>
                    <TableHead>Sub</TableHead>
                    <TableHead>Bateria</TableHead>
                    <TableHead>Últ. leitura</TableHead>
                    <TableHead>Exec. DDMX</TableHead>
                    <TableHead>Última troca</TableHead>
                    <TableHead>Agendada</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lista.map((m) => {
                    const s = situacao(m);
                    const dias = diasDesde(m.ultimaTroca?.dataTroca);
                    return (
                      <TableRow key={m.ddmxCodigo} className={cn(selecionados.has(m.ddmxCodigo) && "bg-emerald-500/5")}>
                        <TableCell>
                          <Checkbox checked={selecionados.has(m.ddmxCodigo)} onCheckedChange={() => toggle(m.ddmxCodigo)} />
                        </TableCell>
                        <TableCell className="font-mono text-xs font-semibold">{m.ddmxCodigo}</TableCell>
                        <TableCell className="max-w-[220px] font-mono text-[11px] text-muted-foreground">
                          {m.setores.join(", ")}
                        </TableCell>
                        <TableCell>{m.subprefeitura ?? "—"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={SITUACAO_INFO[s].cls}>
                              {m.ultimaLeitura?.bateria != null && !m.ultimaLeitura.desatualizada
                                ? `${m.ultimaLeitura.bateria.toFixed(0)}%`
                                : SITUACAO_INFO[s].label}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">{isoBr(m.ultimaLeitura?.data)}</TableCell>
                        <TableCell className="text-xs tabular-nums">
                          {m.ultimaLeitura?.percentualExecucao != null ? `${m.ultimaLeitura.percentualExecucao.toFixed(1)}%` : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {m.ultimaTroca ? (
                            <span className={cn(m.ultimaTroca.sucesso === false && "text-red-500")}>
                              {isoBr(m.ultimaTroca.dataTroca)}
                              {dias != null && <span className="text-muted-foreground"> · {dias}d</span>}
                              {m.ultimaTroca.juntoClimp && <span className="ml-1 text-[10px] text-sky-500">+CLIMP</span>}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {m.agendamento ? (
                            <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400">
                              {isoBr(m.agendamento.dataAgendada)}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setHistoricoDe(m)}>
                            Histórico ({m.historico.length})
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {acao && (
        <AcaoDialog
          acao={acao}
          onClose={() => setAcao(null)}
          onSaved={() => {
            setAcao(null);
            setSelecionados(new Set());
            void carregar();
          }}
        />
      )}

      <Dialog open={!!historicoDe} onOpenChange={(o) => !o && setHistoricoDe(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Histórico DDMX — {historicoDe?.ddmxCodigo}</DialogTitle>
            <DialogDescription>{historicoDe?.setores.join(", ")}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {historicoDe?.historico.length ? (
              historicoDe.historico.map((h) => (
                <div key={h.id} className="flex items-start justify-between gap-2 rounded-lg border border-border/60 p-3 text-sm">
                  <div>
                    <p className="font-medium">
                      {h.status === "agendada" ? `Agendada para ${isoBr(h.dataAgendada)}` : `Troca em ${isoBr(h.dataTroca)}`}
                      {h.status === "concluida" && (
                        <Badge variant="outline" className={cn("ml-2", h.sucesso === false ? "text-red-500" : "text-emerald-600")}>
                          {h.sucesso === false ? "Sem sucesso" : "Sucesso"}
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {h.bateriaAntes != null && `Bateria antes: ${h.bateriaAntes}% · `}
                      {h.juntoClimp && "Junto com a CLIMP · "}
                      {h.observacao}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-red-500"
                    onClick={async () => {
                      if (!window.confirm("Excluir este registro?")) return;
                      try {
                        await apiService.excluirDdmxTroca(h.id);
                        toast.success("Registro excluído.");
                        setHistoricoDe((cur) => (cur ? { ...cur, historico: cur.historico.filter((x) => x.id !== h.id) } : cur));
                        void carregar();
                      } catch {
                        toast.error("Falha ao excluir.");
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">Sem trocas registradas.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AcaoDialog({ acao, onClose, onSaved }: { acao: Acao; onClose: () => void; onSaved: () => void }) {
  const [data, setData] = useState(hojeIso());
  const [sucesso, setSucesso] = useState(true);
  const [juntoClimp, setJuntoClimp] = useState(false);
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const concluir = acao.modo === "concluir";

  const salvar = async () => {
    setSalvando(true);
    try {
      await apiService.salvarDdmxTrocas(
        acao.modulos.map((m) => ({
          ddmxCodigo: m.ddmxCodigo,
          setor: m.setores[0] ?? null,
          status: concluir ? "concluida" : "agendada",
          dataAgendada: concluir ? undefined : data,
          dataTroca: concluir ? data : undefined,
          sucesso: concluir ? sucesso : undefined,
          bateriaAntes: concluir && !m.ultimaLeitura?.desatualizada ? m.ultimaLeitura?.bateria ?? null : null,
          juntoClimp: concluir ? juntoClimp : undefined,
          observacao: observacao || undefined,
        })),
      );
      toast.success(concluir ? "Trocas DDMX registradas." : "Trocas DDMX agendadas.");
      onSaved();
    } catch {
      toast.error("Falha ao salvar.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{concluir ? "Registrar troca DDMX" : "Agendar troca DDMX"}</DialogTitle>
          <DialogDescription>
            {acao.modulos.length} módulo(s): {acao.modulos.slice(0, 6).map((m) => m.ddmxCodigo).join(", ")}
            {acao.modulos.length > 6 && "…"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{concluir ? "Data da troca" : "Data agendada"}</p>
            <DatePicker value={data} onChange={setData} />
          </div>
          {concluir && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={sucesso} onCheckedChange={(v) => setSucesso(Boolean(v))} /> Troca com sucesso
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={juntoClimp} onCheckedChange={(v) => setJuntoClimp(Boolean(v))} /> Trocada junto com a bateria CLIMP
              </label>
            </>
          )}
          <Input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Observação (opcional)" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void salvar()} disabled={salvando || !data}>
            {salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
