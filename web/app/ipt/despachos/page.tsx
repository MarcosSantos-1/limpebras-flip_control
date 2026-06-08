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
  Battery,
  Wrench,
  Flag,
  CloudRain,
  Hammer,
  MessageSquare,
  Calendar,
  X,
  Check,
  Trash2,
  CheckSquare,
} from "lucide-react";
import { ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
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
  fora_plano: { label: "Fora do plano", className: "border-slate-500/40 bg-slate-500/12 text-slate-700 dark:text-slate-300", dot: "bg-slate-500" },
  zerado: { label: "Zerado", className: "border-orange-500/40 bg-orange-500/12 text-orange-700 dark:text-orange-300", dot: "bg-orange-500" },
  nao_previsto: { label: "Sem previsão", className: "border-border/60 bg-muted/40 text-muted-foreground", dot: "bg-muted-foreground/40" },
};

/**
 * Categorias da observação diária — espelham a página IPT Geral para manter
 * o mesmo visual/semântica (o título salvo é o que aparece lá).
 */
const OBS_DIARIA_CATEGORIES = [
  {
    id: "bateria",
    label: "Bateria baixa",
    Icon: Battery,
    colorClass: "border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-500/20",
    activeClass: "border-violet-500 bg-violet-500/25 text-violet-700 dark:text-violet-200 ring-2 ring-violet-500/40",
  },
  {
    id: "alerta_despacho",
    label: "Problema no despacho",
    Icon: AlertTriangle,
    colorClass: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20",
    activeClass: "border-amber-500 bg-amber-500/25 text-amber-700 dark:text-amber-200 ring-2 ring-amber-500/40",
  },
  {
    id: "manutencao",
    label: "Manutenção / Veículo",
    Icon: Wrench,
    colorClass: "border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-300 hover:bg-orange-500/20",
    activeClass: "border-orange-500 bg-orange-500/25 text-orange-700 dark:text-orange-200 ring-2 ring-orange-500/40",
  },
  {
    id: "demanda_sub",
    label: "Demanda subprefeito",
    Icon: Flag,
    colorClass: "border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20",
    activeClass: "border-blue-500 bg-blue-500/25 text-blue-700 dark:text-blue-200 ring-2 ring-blue-500/40",
  },
  {
    id: "chuva",
    label: "Chuva / Intempérie",
    Icon: CloudRain,
    colorClass: "border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300 hover:bg-sky-500/20",
    activeClass: "border-sky-500 bg-sky-500/25 text-sky-700 dark:text-sky-200 ring-2 ring-sky-500/40",
  },
  {
    id: "obra",
    label: "Obra / Interdição",
    Icon: Hammer,
    colorClass: "border-yellow-500/50 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-500/20",
    activeClass: "border-yellow-500 bg-yellow-500/25 text-yellow-700 dark:text-yellow-200 ring-2 ring-yellow-500/40",
  },
  {
    id: "outro",
    label: "Outro motivo",
    Icon: MessageSquare,
    colorClass: "border-slate-500/50 bg-slate-500/10 text-slate-700 dark:text-slate-300 hover:bg-slate-500/20",
    activeClass: "border-slate-500 bg-slate-500/25 text-slate-700 dark:text-slate-200 ring-2 ring-slate-500/40",
  },
] as const;

type ObsDiariaCategoria = (typeof OBS_DIARIA_CATEGORIES)[number]["id"];

/** Mapeia um título já salvo de volta para a categoria (para ícone + destaque no modal). */
function getObsCategoria(titulo: string): (typeof OBS_DIARIA_CATEGORIES)[number] {
  const t = titulo.toLowerCase();
  if (t.includes("bateria")) return OBS_DIARIA_CATEGORIES.find((c) => c.id === "bateria")!;
  if (t.includes("despacho") || t.includes("alerta")) return OBS_DIARIA_CATEGORIES.find((c) => c.id === "alerta_despacho")!;
  if (t.includes("manuten") || t.includes("veículo") || t.includes("veiculo") || t.includes("frota"))
    return OBS_DIARIA_CATEGORIES.find((c) => c.id === "manutencao")!;
  if (t.includes("subpref") || t.includes("demanda")) return OBS_DIARIA_CATEGORIES.find((c) => c.id === "demanda_sub")!;
  if (t.includes("chuva") || t.includes("intemp")) return OBS_DIARIA_CATEGORIES.find((c) => c.id === "chuva")!;
  if (t.includes("obra") || t.includes("interdi") || t.includes("bloqueio")) return OBS_DIARIA_CATEGORIES.find((c) => c.id === "obra")!;
  return OBS_DIARIA_CATEGORIES.find((c) => c.id === "outro")!;
}

type ChipKey = "todos" | "varricao" | "outros";

type StatusFiltro = "fora_plano" | "zerado" | null;

/** Turnos canônicos, ordenados e numerados para o dropdown. */
const TURNOS = [
  { value: "Diurno", label: "1 - Diurno" },
  { value: "Vespertino", label: "2 - Vespertino" },
  { value: "Noturno", label: "3 - Noturno" },
] as const;

/**
 * Turno + dia de referência conforme o horário atual.
 *  - Diurno:     06:00 – 14:20  → dia de hoje
 *  - Vespertino: 14:20 – 22:30  → dia de hoje
 *  - Noturno:    22:30 – 06:00  → pertence ao dia em que COMEÇA (22:30).
 *      Por isso, na madrugada (00:00–06:00) o noturno vigente é o que começou ONTEM.
 *      Ex.: às 00:37 de 08/06, o noturno vigente é o de 07/06 (22:30 de 07 → 06:00 de 08).
 */
function vigenteInicial(now = new Date()): { turno: "Diurno" | "Vespertino" | "Noturno"; dia: string } {
  const mins = now.getHours() * 60 + now.getMinutes();
  const hoje = startOfDay(now);
  if (mins >= 6 * 60 && mins < 14 * 60 + 20) return { turno: "Diurno", dia: format(hoje, "yyyy-MM-dd") };
  if (mins >= 14 * 60 + 20 && mins < 22 * 60 + 30) return { turno: "Vespertino", dia: format(hoje, "yyyy-MM-dd") };
  const diaRef = mins < 6 * 60 ? subDays(hoje, 1) : hoje; // madrugada → noturno do dia anterior
  return { turno: "Noturno", dia: format(diaRef, "yyyy-MM-dd") };
}

const CHIPS: Array<{ key: ChipKey; label: string }> = [
  { key: "todos", label: "Todos" },
  { key: "varricao", label: "Varrição" },
  { key: "outros", label: "Outros escalonados" },
];

/** Varrição = sarjetas (VJ), sarjetas e calçadas (VL) e varrição de praças (VP). */
function isVarricao(tipoServico: string): boolean {
  const t = tipoServico.toLowerCase();
  return t.includes("sarjeta") || t.includes("varrição de praças") || t.includes("varricao de pracas");
}

/** Rótulo de exibição do serviço (corrige nomes salvos de forma técnica). */
function servicoLabel(tipoServico: string): string {
  if (/serviços de vf|servicos de vf/i.test(tipoServico)) return "Varrição de feiras-livres";
  return tipoServico;
}

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
  onClick,
  active,
  activeRing,
}: {
  icon: typeof Truck;
  label: string;
  value: string | number;
  tint: string;
  emphasis?: boolean;
  /** Quando definido, o card vira um filtro clicável (toggle). */
  onClick?: () => void;
  active?: boolean;
  /** Classe do anel/realce quando ativo (cor do status). */
  activeRing?: string;
}) {
  const clickable = !!onClick;
  return (
    <Card
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={cn(
        "relative overflow-hidden border-border/70",
        emphasis && "border-rose-500/40",
        clickable && "cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5",
        active && cn("ring-2 ring-offset-1 ring-offset-background", activeRing ?? "ring-amber-500/60"),
      )}
    >
      <div className={cn("absolute inset-y-0 left-0 w-1", tint)} aria-hidden />
      <CardContent className="flex items-center justify-between gap-3 p-4 pl-5">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
            {clickable && (
              <span className="ml-1 font-normal normal-case text-[10px] text-muted-foreground/70">
                {active ? "• filtrando" : "• filtrar"}
              </span>
            )}
          </p>
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
  const hoje = format(startOfDay(new Date()), "yyyy-MM-dd");
  // Default dinâmico: abre no turno vigente e no DIA a que esse turno pertence
  // (madrugada → noturno do dia anterior).
  const inicial = useMemo(() => vigenteInicial(), []);

  const [dia, setDia] = useState(inicial.dia);
  const [sub, setSub] = useState("all");
  const [serv, setServ] = useState("all");
  const [turno, setTurno] = useState<string>(inicial.turno);
  const [chip, setChip] = useState<ChipKey>("todos");
  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>(null);
  const [busca, setBusca] = useState("");
  const [nonce, setNonce] = useState(0);

  const [data, setData] = useState<DespachosResponse>(EMPTY_DATA);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Seleção múltipla + despacho manual
  const [selMode, setSelMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastIdx, setLastIdx] = useState<number | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);

  // Colagem SELIMP
  const [colarOpen, setColarOpen] = useState(false);
  const [colarTexto, setColarTexto] = useState("");
  const [colarPreview, setColarPreview] = useState<Awaited<ReturnType<typeof apiService.colarDespachos>> | null>(null);
  const [colarBusy, setColarBusy] = useState(false);

  // Observação diária (mesmo fluxo do IPT Geral)
  const [obs, setObs] = useState<DespachoLinha | null>(null);
  const [obsTitulo, setObsTitulo] = useState("");
  const [obsCategoria, setObsCategoria] = useState<ObsDiariaCategoria | "">("");
  const [obsBusy, setObsBusy] = useState(false);
  // Observação já existente do setor aberto (modo visualização/desfazer).
  const [obsSalva, setObsSalva] = useState<{ id: number; titulo: string } | null>(null);
  // Observações diárias já salvas para o dia: setor -> { id, titulo }
  const [obsDiarias, setObsDiarias] = useState<Record<string, { id: number; titulo: string }>>({});
  // Setores com observação salva nesta sessão — anima o ícone na tabela.
  const [recentObs, setRecentObs] = useState<Set<string>>(new Set());

  const diaDate = parseDia(dia);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      // Sempre carrega o DIA INTEIRO (sem sub/turno) para que os KPIs/hero/cobertura
      // reflitam o total do dia. Os filtros de sub e turno são aplicados na tabela (client-side).
      const res = await apiService.getDespachos({ dia });
      setData(res);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar despachos.");
      setData(EMPTY_DATA);
    } finally {
      setLoading(false);
    }
  }, [dia]);

  const carregarObservacoes = useCallback(async () => {
    try {
      const res = await apiService.getIptObservacoes(dia, dia);
      const map: Record<string, { id: number; titulo: string }> = {};
      for (const [setor, porData] of Object.entries(res.diarias ?? {})) {
        const o = porData?.[dia];
        if (o) map[setor] = { id: o.id, titulo: o.titulo };
      }
      setObsDiarias(map);
    } catch {
      setObsDiarias({});
    }
  }, [dia]);

  useEffect(() => {
    void carregar();
    void carregarObservacoes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dia, nonce]);

  // Troca de dia zera a seleção (setores podem não existir no novo dia).
  useEffect(() => {
    setSelMode(false);
    setSelected(new Set());
    setLastIdx(null);
  }, [dia]);

  // Opções de serviço derivadas dos dados (filtro client-side da tabela).
  const servicosDisponiveis = useMemo(
    () => Array.from(new Set(data.linhas.map((l) => l.tipo_servico))).sort(),
    [data.linhas]
  );

  const linhasFiltradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return data.linhas.filter((l) => {
      if (sub !== "all" && (l.subprefeitura ?? "") !== sub) return false;
      if (turno !== "all" && (l.turno ?? "").toLowerCase() !== turno.toLowerCase()) return false;
      if (statusFiltro && l.status !== statusFiltro) return false;
      if (chip === "varricao" && !isVarricao(l.tipo_servico)) return false;
      if (chip === "outros" && isVarricao(l.tipo_servico)) return false;
      if (serv !== "all" && l.tipo_servico !== serv) return false;
      if (!t) return true;
      return (
        l.setor.toLowerCase().includes(t) ||
        (l.subprefeitura ?? "").toLowerCase().includes(t) ||
        servicoLabel(l.tipo_servico).toLowerCase().includes(t)
      );
    });
  }, [data.linhas, chip, serv, busca, statusFiltro, sub, turno]);

  const donut = [
    { name: "Despachados", value: data.kpis.despachados, fill: "#f59e0b" },
    { name: "Pendentes", value: Math.max(0, data.kpis.previstos - data.kpis.despachados), fill: "rgba(120,113,108,0.25)" },
  ];

  const selectedLinhas = useMemo(
    () => data.linhas.filter((l) => selected.has(l.setor)),
    [data.linhas, selected],
  );

  function sairSelecao() {
    setSelMode(false);
    setSelected(new Set());
    setLastIdx(null);
  }

  function toggleSelMode() {
    if (selMode) sairSelecao();
    else setSelMode(true);
  }

  /** Shift = intervalo (sequência); clique/ctrl = alterna individual. */
  function handleRowSelect(setor: string, index: number, e: React.MouseEvent) {
    const isShift = e.shiftKey;
    setSelected((prev) => {
      const next = new Set(prev);
      if (isShift && lastIdx != null) {
        const [a, b] = [Math.min(lastIdx, index), Math.max(lastIdx, index)];
        for (let i = a; i <= b; i++) next.add(linhasFiltradas[i].setor);
      } else if (next.has(setor)) {
        next.delete(setor);
      } else {
        next.add(setor);
      }
      return next;
    });
    if (!isShift) setLastIdx(index);
  }

  async function confirmarManual() {
    const lista = [...selected];
    if (lista.length === 0) return;
    setManualBusy(true);
    try {
      const res = await apiService.despacharManual(dia, lista);
      toast.success(`${res.gravados} despacho(s) manual(is) gravado(s).`);
      setManualOpen(false);
      sairSelecao();
      setNonce((n) => n + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao despachar manualmente.");
    } finally {
      setManualBusy(false);
    }
  }

  function abrirObs(l: DespachoLinha) {
    setObs(l);
    const salva = obsDiarias[l.setor] ?? null;
    setObsSalva(salva);
    if (salva) {
      setObsTitulo(salva.titulo);
      setObsCategoria(getObsCategoria(salva.titulo).id);
    } else {
      setObsTitulo("");
      setObsCategoria("");
    }
  }

  async function desfazerObs() {
    if (!obs || !obsSalva) return;
    const setor = obs.setor;
    setObsBusy(true);
    try {
      await apiService.cancelarIptObservacaoDiaria(obsSalva.id);
      toast.success("Observação desfeita.");
      setRecentObs((prev) => {
        const n = new Set(prev);
        n.delete(setor);
        return n;
      });
      setObs(null);
      setObsSalva(null);
      void carregarObservacoes();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao desfazer observação.");
    } finally {
      setObsBusy(false);
    }
  }

  async function salvarObs() {
    if (!obs || !obsTitulo.trim()) return;
    const setor = obs.setor;
    setObsBusy(true);
    try {
      await apiService.createIptObservacaoDiaria(setor, dia, obsTitulo.trim(), undefined);
      toast.success("Observação diária registrada.");
      setRecentObs((prev) => new Set(prev).add(setor));
      setObs(null);
      void carregarObservacoes();
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
                <Send className="h-6 w-6 text-amber-500" />
                <div>
                  <h1 className="text-xl font-bold text-foreground">Despachos SELIMP</h1>
                  <p className="text-xs text-muted-foreground">Acompanhamento diário: planejado × despachado</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <DatePicker value={dia} onChange={(v) => setDia(v || hoje)} compact />
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
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
            <KpiCard
              icon={CalendarClock}
              label="Previstos / Despachados"
              value={`${data.kpis.previstos}/${data.kpis.despachados}`}
              tint="bg-amber-500"
            />
            <KpiCard icon={AlertTriangle} label="Não despachado" value={data.kpis.naoDespachados} tint="bg-rose-500" emphasis />
            <KpiCard
              icon={Send}
              label="Fora do plano"
              value={data.kpis.foraPlano}
              tint="bg-slate-500"
              onClick={() => setStatusFiltro((cur) => (cur === "fora_plano" ? null : "fora_plano"))}
              active={statusFiltro === "fora_plano"}
              activeRing="ring-slate-500/60"
            />
            <KpiCard
              icon={CircleSlash}
              label="Zerados"
              value={data.kpis.zerados}
              tint="bg-orange-500"
              onClick={() => setStatusFiltro((cur) => (cur === "zerado" ? null : "zerado"))}
              active={statusFiltro === "zerado"}
              activeRing="ring-orange-500/60"
            />
            <KpiCard icon={Truck} label="Cobertura" value={`${data.kpis.cobertura}%`} tint="bg-orange-500" />
          </div>

          {/* Tabela operacional */}
          <Card className="border-border/70">
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-base">Operação do dia</CardTitle>
                <div className="flex flex-1 items-center justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className={cn(
                      "h-9 shrink-0 gap-1.5",
                      selMode && "border-rose-500/50 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400",
                    )}
                    onClick={toggleSelMode}
                  >
                    {selMode ? <X className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}
                    {selMode ? "Cancelar" : "Selecionar"}
                  </Button>
                  {selMode ? (
                    <Button
                      size="sm"
                      className="h-9 shrink-0 gap-1.5 bg-amber-600 font-semibold text-white shadow-sm shadow-amber-900/20 hover:bg-amber-700 disabled:opacity-50"
                      disabled={selected.size === 0}
                      onClick={() => setManualOpen(true)}
                    >
                      <Send className="h-4 w-4" />
                      Despachar ({selected.size})
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="h-9 shrink-0 gap-1.5 bg-amber-600 font-semibold text-white shadow-sm shadow-amber-900/20 hover:bg-amber-700"
                      onClick={() => {
                        setColarPreview(null);
                        setColarTexto("");
                        setColarOpen(true);
                      }}
                    >
                      <ClipboardPaste className="h-4 w-4" />
                      Colar despachos
                    </Button>
                  )}
                  <div className="relative min-w-[200px] sm:max-w-xs sm:flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      placeholder="Buscar setor, sub, serviço…"
                      className="h-9 pl-9"
                    />
                  </div>
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
                  {statusFiltro && (
                    <button
                      type="button"
                      onClick={() => setStatusFiltro(null)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                        statusFiltro === "fora_plano"
                          ? "border-slate-500/50 bg-slate-500/15 text-slate-700 dark:text-slate-300"
                          : "border-orange-500/50 bg-orange-500/15 text-orange-700 dark:text-orange-300",
                      )}
                      title="Remover filtro"
                    >
                      {statusFiltro === "fora_plano" ? "Fora do plano" : "Zerados"}
                      <X className="h-3 w-3" />
                    </button>
                  )}
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
                      {TURNOS.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
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
                          {servicoLabel(s)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-hidden rounded-b-xl">
                <Table className="[&_td]:border-border/40 [&_th]:border-border/40 [&_tr]:border-border/40">
                  <TableHeader className="bg-muted/40">
                    <TableRow className="hover:bg-transparent">
                      {selMode && <TableHead className="w-9" />}
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wide">Setor</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wide">Serviço</TableHead>
                      <TableHead className="text-center text-[11px] font-semibold uppercase tracking-wide">Previsto?</TableHead>
                      <TableHead className="text-center text-[11px] font-semibold uppercase tracking-wide">Despacho</TableHead>
                      <TableHead className="text-center text-[11px] font-semibold uppercase tracking-wide">% exec.</TableHead>
                      <TableHead className="text-center text-[11px] font-semibold uppercase tracking-wide">Status</TableHead>
                      <TableHead className="text-center text-[11px] font-semibold uppercase tracking-wide">Próx.</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading && (
                      <TableRow>
                        <TableCell colSpan={selMode ? 9 : 8} className="py-12 text-center text-sm text-muted-foreground">
                          <Loader2 className="mx-auto h-5 w-5 animate-spin text-amber-500" />
                          <span className="mt-2 block">Carregando…</span>
                        </TableCell>
                      </TableRow>
                    )}
                    {!loading &&
                      linhasFiltradas.map((l, idx) => {
                        const sel = selected.has(l.setor);
                        return (
                        <TableRow
                          key={l.setor}
                          className={cn("hover:bg-amber-500/5", selMode && sel && "bg-amber-500/10")}
                          onClick={selMode ? (e) => handleRowSelect(l.setor, idx, e) : undefined}
                          style={selMode ? { cursor: "pointer", userSelect: "none" } : undefined}
                        >
                          {selMode && (
                            <TableCell className="text-center">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRowSelect(l.setor, idx, e);
                                }}
                                className={cn(
                                  "flex h-4 w-4 items-center justify-center rounded border transition-colors",
                                  sel ? "border-amber-500 bg-amber-500 text-white" : "border-zinc-400 hover:border-amber-500 dark:border-zinc-600",
                                )}
                                aria-label={sel ? "Desmarcar" : "Marcar"}
                              >
                                {sel && <Check className="h-3 w-3" />}
                              </button>
                            </TableCell>
                          )}
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", subprefBadgeClass(l.subprefeitura ?? ""))}>
                                {l.subprefeitura ?? "—"}
                              </Badge>
                              <span className="font-mono text-xs font-semibold text-foreground">{l.setor}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm font-medium text-foreground">{servicoLabel(l.tipo_servico)}</div>
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
                            {obsDiarias[l.setor] ? (
                              <Badge
                                variant="outline"
                                className="gap-1 border-amber-500/50 bg-amber-500/15 text-[10px] text-amber-700 dark:text-amber-300"
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                Observação
                              </Badge>
                            ) : (
                              <Badge variant="outline" className={cn("gap-1 text-[10px]", STATUS_META[l.status].className)}>
                                <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_META[l.status].dot)} />
                                {STATUS_META[l.status].label}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-center font-mono text-xs tabular-nums text-muted-foreground">
                            {l.proximaProgramacao ?? "—"}
                          </TableCell>
                          <TableCell className="text-center">
                            {(() => {
                              const salva = obsDiarias[l.setor];
                              const animar = recentObs.has(l.setor);
                              const ObsIcon = salva ? getObsCategoria(salva.titulo).Icon : MessageSquarePlus;
                              return (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    abrirObs(l);
                                  }}
                                  title={salva ? `Observação: ${salva.titulo}` : "Registrar observação diária"}
                                  className={cn(
                                    "inline-flex items-center justify-center rounded-lg border p-1.5 transition-all",
                                    salva
                                      ? "border-amber-500/60 bg-amber-500/20 text-amber-600 hover:bg-amber-500/30 dark:text-amber-400"
                                      : "border-zinc-300/70 bg-muted/40 text-muted-foreground hover:bg-muted dark:border-zinc-700",
                                    animar && "animate-pulse ring-2 ring-amber-500/50",
                                  )}
                                >
                                  <ObsIcon className="h-4 w-4" />
                                </button>
                              );
                            })()}
                          </TableCell>
                        </TableRow>
                        );
                      })}
                    {!loading && linhasFiltradas.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={selMode ? 9 : 8} className="py-10 text-center text-sm text-muted-foreground">
                          Nenhum despacho para os filtros atuais.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Dialog: colar despachos da SELIMP */}
      <Dialog open={colarOpen} onOpenChange={(o) => setColarOpen(o)}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
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
              <div className="space-y-3">
                {/* Resumo geral */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: "Extraídos", value: colarPreview.extraidos, cls: "text-foreground" },
                    { label: "Conforme", value: colarPreview.conforme, cls: "text-emerald-600 dark:text-emerald-400" },
                    { label: "Fora do plano", value: colarPreview.fora_plano, cls: "text-slate-600 dark:text-slate-400" },
                    { label: "Não despachados", value: colarPreview.nao_despachado, cls: "text-rose-600 dark:text-rose-400" },
                  ].map((k) => (
                    <div key={k.label} className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{k.label}</p>
                      <p className={cn("mt-0.5 font-mono text-xl font-bold tabular-nums", k.cls)}>{k.value}</p>
                    </div>
                  ))}
                </div>

                {/* Resumo por turno */}
                {colarPreview.porTurno.length > 0 && (
                  <div>
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" /> Despacho por turno · previstos × despachados
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {colarPreview.porTurno.map((t) => {
                        const pct = t.previstos > 0 ? Math.round((t.despachados / t.previstos) * 100) : 0;
                        const completo = t.faltam <= 0;
                        return (
                          <div key={t.turno} className="rounded-lg border border-border/70 bg-card p-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-foreground">{t.turno}</span>
                              <span
                                className={cn(
                                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                                  completo
                                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                    : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                                )}
                              >
                                {completo ? "Completo" : `Faltam ${t.faltam}`}
                              </span>
                            </div>
                            <p className="mt-1 font-mono text-lg font-bold tabular-nums text-foreground">
                              {t.despachados}
                              <span className="text-muted-foreground">/{t.previstos}</span>
                            </p>
                            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className={cn("h-full rounded-full", completo ? "bg-emerald-500" : "bg-amber-500")}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Lista dos despachos colados, separados */}
                {colarPreview.itens.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Despachos colados ({colarPreview.itens.length})
                    </div>
                    <div className="max-h-60 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border/70">
                      {colarPreview.itens.map((it) => (
                        <div key={it.setor} className="flex items-center gap-2 px-2.5 py-1.5">
                          <Badge variant="outline" className={cn("h-5 shrink-0 px-1.5 text-[10px]", subprefBadgeClass(it.subprefeitura ?? ""))}>
                            {it.subprefeitura ?? "—"}
                          </Badge>
                          <span className="shrink-0 font-mono text-xs font-semibold text-foreground">{it.setor}</span>
                          <span className="truncate text-xs text-muted-foreground">{servicoLabel(it.tipo_servico)}</span>
                          {it.turno && (
                            <span className="ml-auto shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {it.turno}
                            </span>
                          )}
                          <Badge
                            variant="outline"
                            className={cn(
                              "shrink-0 text-[10px]",
                              it.turno ? "" : "ml-auto",
                              it.situacao === "conforme"
                                ? "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                                : "border-slate-500/40 bg-slate-500/12 text-slate-700 dark:text-slate-300",
                            )}
                          >
                            {it.situacao === "conforme" ? "Previsto" : "Fora do plano"}
                          </Badge>
                          <span className="flex shrink-0 items-center gap-0.5 text-[10px] tabular-nums text-muted-foreground" title="Veículos">
                            <Truck className="h-3 w-3" />
                            {it.veiculos}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {colarPreview.avisos.length > 0 && (
                  <div className="rounded-lg border border-amber-300/60 bg-amber-50/60 p-2.5 dark:border-amber-800/50 dark:bg-amber-950/30">
                    <ul className="max-h-24 list-disc space-y-1 overflow-y-auto pl-4 text-[11px] text-amber-700 dark:text-amber-300">
                      {colarPreview.avisos.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>
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

      {/* Dialog: despacho manual da seleção */}
      <Dialog open={manualOpen} onOpenChange={(o) => !o && setManualOpen(false)}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Send className="h-5 w-5 text-amber-500" />
              Despachar manualmente — {format(diaDate, "dd/MM/yyyy")}
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              Revise os {selectedLinhas.length} setor(es) selecionado(s) antes de gravar o despacho manual.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border/70">
            {selectedLinhas.map((l) => (
              <div key={l.setor} className="flex items-center gap-2 px-2.5 py-1.5">
                <Badge variant="outline" className={cn("h-5 shrink-0 px-1.5 text-[10px]", subprefBadgeClass(l.subprefeitura ?? ""))}>
                  {l.subprefeitura ?? "—"}
                </Badge>
                <span className="shrink-0 font-mono text-xs font-semibold text-foreground">{l.setor}</span>
                <span className="truncate text-xs text-muted-foreground">{servicoLabel(l.tipo_servico)}</span>
                {l.turno && (
                  <span className="ml-auto shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {l.turno}
                  </span>
                )}
                <Badge variant="outline" className={cn("shrink-0 gap-1 text-[10px]", l.turno ? "" : "ml-auto", STATUS_META[l.status].className)}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_META[l.status].dot)} />
                  {STATUS_META[l.status].label}
                </Badge>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setManualOpen(false)} disabled={manualBusy}>
              Cancelar
            </Button>
            <Button
              onClick={confirmarManual}
              disabled={manualBusy || selectedLinhas.length === 0}
              className="gap-2 bg-amber-600 text-white hover:bg-amber-700"
            >
              {manualBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Despachar {selectedLinhas.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de observação diária — mesmo modal/animação/salvamento do IPT Geral */}
      <Dialog
        open={obs != null}
        onOpenChange={(o) => {
          if (!o) {
            setObs(null);
            setObsSalva(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
          {obs && (
            <>
              {/* Header colorido */}
              <div className="bg-gradient-to-br from-amber-500/90 via-amber-600 to-orange-700 px-6 pt-6 pb-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20 shadow-inner">
                    <Calendar className="h-5 w-5 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <DialogTitle className="text-white text-lg font-bold leading-tight">Observação diária</DialogTitle>
                    <DialogDescription className="text-amber-100/80 text-sm mt-0.5">
                      Justificativa para o dia específico — ex.: manutenção, chuva, demanda extra.
                    </DialogDescription>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-mono font-semibold text-white">
                        <MapPin className="h-3.5 w-3.5" />
                        {obs.setor}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-mono font-semibold text-white">
                        <Calendar className="h-3.5 w-3.5" />
                        {dia.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2/$1")}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-semibold text-white">
                        {servicoLabel(obs.tipo_servico)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {obsSalva ? (
                /* Modo visualização: motivo + título + desfazer */
                <div className="space-y-4 px-6 py-5">
                  {(() => {
                    const cat = getObsCategoria(obsSalva.titulo);
                    const Icon = cat.Icon;
                    return (
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 block">
                          Motivo da ocorrência
                        </label>
                        <div className={`flex items-center gap-2 rounded-xl border p-2.5 text-sm font-semibold ${cat.activeClass}`}>
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="leading-tight">{cat.label}</span>
                        </div>
                      </div>
                    );
                  })()}

                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Título</label>
                    <div className="w-full rounded-xl border-2 border-zinc-200 dark:border-zinc-700 bg-muted/30 px-3.5 py-2.5 text-sm font-medium">
                      {obsSalva.titulo}
                    </div>
                  </div>

                  {/* Ações */}
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <button
                      onClick={() => setObs(null)}
                      disabled={obsBusy}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 shadow-xl shadow-zinc-300/10 dark:shadow-zinc-700/10 bg-background/80 text-sm font-medium hover:bg-muted/60 transition-colors disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      Fechar
                    </button>
                    <button
                      onClick={desfazerObs}
                      disabled={obsBusy}
                      className="inline-flex items-center gap-2 px-5 py-2 rounded-xl border border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300 text-sm font-semibold disabled:opacity-50 hover:bg-rose-500/20 transition-all"
                    >
                      {obsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      Desfazer observação
                    </button>
                  </div>
                </div>
              ) : (
                /* Modo criação: grade de categorias + título + salvar */
                <div className="space-y-4 px-6 py-5">
                  {/* Seleção de categoria */}
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 block">
                      Motivo da ocorrência
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {OBS_DIARIA_CATEGORIES.map((cat) => {
                        const Icon = cat.Icon;
                        const isSelected = obsCategoria === cat.id;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => {
                              setObsCategoria(cat.id);
                              setObsTitulo(cat.label);
                            }}
                            className={`flex items-center gap-2 rounded-xl border p-2.5 text-left text-xs font-semibold transition-all duration-150 ${isSelected ? cat.activeClass : cat.colorClass}`}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="leading-tight">{cat.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Título */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                      Título <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={obsTitulo}
                      onChange={(e) => setObsTitulo(e.target.value)}
                      placeholder="Ex.: Bateria baixa, Manutenção..."
                      className="w-full h-10 rounded-xl border-2 border-zinc-300 dark:border-zinc-700 shadow-xl shadow-zinc-300/10 dark:shadow-zinc-700/10 bg-background/80 px-3.5 text-sm transition-all focus:outline-none focus:border-amber-500/60 focus:bg-background"
                    />
                  </div>

                  {/* Ações */}
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <button
                      onClick={() => setObs(null)}
                      disabled={obsBusy}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 shadow-xl shadow-zinc-300/10 dark:shadow-zinc-700/10 bg-background/80 text-sm font-medium hover:bg-muted/60 transition-colors disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      Cancelar
                    </button>
                    <button
                      onClick={salvarObs}
                      disabled={!obsTitulo.trim() || obsBusy}
                      className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-semibold disabled:opacity-50 hover:opacity-90 transition-all shadow-lg shadow-amber-500/30"
                    >
                      {obsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Salvar observação
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
