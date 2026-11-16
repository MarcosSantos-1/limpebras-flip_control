"use client";

import { Fragment, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  ArrowUpDown,
  Battery,
  BatteryCharging,
  Bell,
  BellRing,
  CalendarCheck2,
  CalendarPlus,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Hash,
  History,
  Link2,
  Loader2,
  MapPin,
  Percent,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Table2,
  Trash2,
  Trophy,
  Wifi,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";
import type { DdmxModulo, DdmxTroca, StatusBateriaDdmx } from "@/lib/api";
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
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import { MultiSelect } from "@/components/ui/multi-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BTN_AMBER,
  BTN_EMERALD,
  BTN_RED,
  BTN_SECONDARY,
  BTN_SKY,
  EXPANDED_ROW,
  GLASS_CARD,
  InfoTooltip,
  SetorCell,
  SortToggle,
  SUCESSO_MIN_PCT_DEPOIS,
  fmtDisplayDate,
  fmtIsoBr,
  getStatusColorClass,
  isoToday,
  pctBatteryLabel,
  renderBatteryStatus,
  trocaStatusBadgeClass,
  trocaStatusEmoji,
  trocaStatusLabel,
} from "./bateria-ui";
import { useDdmxState } from "./ddmx-state";

// ===== Constantes e helpers =====

const ITEMS_PER_PAGE = 50;
const MOTIVO_OPTIONS = ["Corretiva", "Preventiva", "Desnecessária"];
const STATUS_DDMX_OPTIONS: StatusBateriaDdmx[] = ["ALTA", "REGULAR", "BAIXA", "CRÍTICA", "DESATUALIZADA", "SEM LEITURA"];
const STATUS_RANK: Record<string, number> = { ALTA: 5, REGULAR: 4, BAIXA: 3, "CRÍTICA": 2, DESATUALIZADA: 1, "SEM LEITURA": 0 };

type SortKey = "bateria" | "exec" | "cargas" | "troca";

function parseIso(iso?: string | null): Date | null {
  if (!iso) return null;
  const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function diasEntre(a: Date, b: Date): number {
  return Math.max(0, Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000));
}

function inPeriod(iso: string | null | undefined, period: string): boolean {
  const d = parseIso(iso);
  if (!d) return false;
  const hoje = new Date();
  const end = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  if (d > end) return false;
  if (period === "all") return true;
  const days = Number(/^(\d+)d$/.exec(period)?.[1] ?? 30);
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return d >= start;
}

function trocaData(h: DdmxTroca): string | null {
  return h.status === "agendada" ? h.dataAgendada : h.dataTroca;
}

function setorLabel(m: DdmxModulo): string {
  return m.setores.join(" / ");
}

function bateriaAtualLabel(m: DdmxModulo): string {
  const l = m.leitura;
  if (!l) return "—";
  const pct = l.bateria != null ? `${Math.round(l.bateria)}%` : "—";
  return l.bateriaRaw ? `${pct} (${l.bateriaRaw})` : pct;
}

/** dd/MM/yyyy HH:mm do DDMX → mantém; ISO → dd/MM/yyyy. */
function fmtComunicacao(v?: string | null): string {
  if (!v) return "—";
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? fmtIsoBr(v.slice(0, 10)) : v;
}

function bateriaDiaColor(b: { bateria: number | null; desatualizada: boolean }): string {
  if (b.desatualizada) return "text-zinc-500 dark:text-zinc-400";
  const p = b.bateria ?? 0;
  if (p > 70) return "text-emerald-600 dark:text-emerald-400";
  if (p > 30) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

/** Status "SEM LEITURA" não existe na CLIMP — badge próprio, resto reaproveita o da CLIMP. */
function renderStatusDdmx(status: StatusBateriaDdmx, showEmoji = true) {
  if (status === "SEM LEITURA") {
    return (
      <Badge className="gap-1.5 border-zinc-500/30 bg-zinc-500/15 font-semibold text-zinc-600 dark:text-zinc-300">
        {showEmoji && <span>❔</span>}
        <span>SEM LEITURA</span>
      </Badge>
    );
  }
  return renderBatteryStatus(status, showEmoji);
}

/** Prévia do resultado a partir da leitura atual — resultado real usa a 1ª leitura após a troca. */
function sucessoPreviewChip(m: DdmxModulo) {
  const l = m.leitura;
  const semSucesso = !l || l.desatualizada || l.bateria == null || l.bateria < SUCESSO_MIN_PCT_DEPOIS;
  const motivo = !l || l.bateria == null ? "sem leitura" : l.desatualizada ? "desatualizada" : `abaixo de ${SUCESSO_MIN_PCT_DEPOIS}%`;
  return (
    <Badge
      title={`Sucesso exige leitura DDMX atualizada com pelo menos ${SUCESSO_MIN_PCT_DEPOIS}% de bateria`}
      className={cn(
        "gap-1 font-semibold",
        semSucesso
          ? "border-red-500/30 bg-red-500/15 text-red-600 dark:text-red-400"
          : "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
      )}
    >
      {semSucesso ? `❌ Prévia: sem sucesso (${motivo})` : "✅ Prévia: com sucesso"}
    </Badge>
  );
}

type AlertaLevel = "none" | "observacao" | "problema";

/** Triagem do módulo DDMX (mesma ideia da CLIMP: vermelho só com reincidência real). */
function alertaDdmx(m: DdmxModulo): { level: AlertaLevel; reasons: Array<{ severity: "problema" | "observacao"; text: string }> } {
  const reasons: Array<{ severity: "problema" | "observacao"; text: string }> = [];
  const concluidas = m.historico
    .filter((h) => h.status === "concluida")
    .sort((a, b) => String(b.dataTroca).localeCompare(String(a.dataTroca)));
  let streak = 0;
  for (const h of concluidas) {
    if (h.sucesso === false) streak += 1;
    else if (h.sucesso === true) break;
  }
  if (streak >= 2) reasons.push({ severity: "problema", text: `${streak} trocas DDMX seguidas sem sucesso — sinal/bateria não recuperaram` });
  else if (streak === 1) reasons.push({ severity: "observacao", text: "1 troca DDMX sem sucesso — em observação" });
  if (m.statusBateria === "DESATUALIZADA") reasons.push({ severity: "observacao", text: "Bateria DDMX desatualizada — módulo sem comunicar" });
  else if (m.statusBateria === "SEM LEITURA") reasons.push({ severity: "observacao", text: "Sem leitura DDMX nos últimos dias" });
  else if (m.statusBateria === "CRÍTICA") reasons.push({ severity: "observacao", text: "Bateria DDMX em nível crítico" });
  if (m.diasDesatualizados30 >= 7) reasons.push({ severity: "observacao", text: `${m.diasDesatualizados30} dias com bateria desatualizada em 30 dias` });
  if (m.execucaoMedia30 != null) {
    if (m.execucaoMedia30 < 30) reasons.push({ severity: "observacao", text: `Execução DDMX muito baixa (${m.execucaoMedia30}% em 30 dias)` });
    else if (m.execucaoMedia30 < 60) reasons.push({ severity: "observacao", text: `Execução DDMX abaixo do ideal (${m.execucaoMedia30}% em 30 dias)` });
  }
  const level: AlertaLevel = reasons.some((r) => r.severity === "problema") ? "problema" : reasons.length ? "observacao" : "none";
  return { level, reasons };
}

/** Dias que a bateria durou entre trocas com sucesso (até a próxima troca ou hoje, se ainda atualizada). */
function duracoesBateria(m: DdmxModulo, period: string): number[] {
  const concluidas = m.historico
    .filter((h) => h.status === "concluida" && h.dataTroca)
    .sort((a, b) => String(a.dataTroca).localeCompare(String(b.dataTroca)));
  const out: number[] = [];
  for (let i = 0; i < concluidas.length; i += 1) {
    if (concluidas[i].sucesso === false) continue;
    const start = parseIso(concluidas[i].dataTroca);
    const next = concluidas[i + 1];
    const atualizada = m.leitura && !m.leitura.desatualizada;
    const endKey = next ? next.dataTroca : atualizada ? isoToday() : null;
    const end = parseIso(endKey);
    if (!start || !end || !inPeriod(endKey, period)) continue;
    const d = diasEntre(start, end);
    if (d > 0) out.push(d);
  }
  return out;
}

function exportDdmxXlsx(modulos: DdmxModulo[], period: string) {
  const wb = XLSX.utils.book_new();
  const rows = modulos.map((m) => ({
    Subprefeitura: m.subprefeitura ?? "",
    Setores: setorLabel(m),
    "Módulo DDMX": m.ddmxCodigo,
    "Módulo CLIMP": m.selimpCodigos.join(" / "),
    "Dias de execução": m.setoresDias.map((s) => `${s.setor}: ${s.dias || "—"}`).join(" | "),
    "Bateria atual (%)": m.leitura?.bateria != null ? Math.round(m.leitura.bateria) : "",
    "Bateria atual (raw)": m.leitura?.bateriaRaw ?? "",
    "Status da bateria": m.statusBateria,
    "Última leitura": m.leitura?.data ? fmtIsoBr(m.leitura.data) : "",
    "Última comunicação": m.leitura?.ultimaComunicacao ?? "",
    "Execução média 30d (%)": m.execucaoMedia30 ?? "",
    "Motivo sugerido": m.motivoSugerido,
    "Trocas registradas": m.historico.filter((h) => h.status === "concluida").length,
    "Última troca": m.ultimaTroca?.dataTroca ? fmtIsoBr(m.ultimaTroca.dataTroca) : "",
    "Troca agendada": m.agendamento?.dataAgendada ? fmtIsoBr(m.agendamento.dataAgendada) : "",
    "Agendada com CLIMP": m.agendamento?.selimpVinculo ?? "",
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Módulos DDMX");
  const hist = modulos.flatMap((m) =>
    m.historico
      .filter((h) => inPeriod(trocaData(h), period))
      .map((h) => ({
        "Módulo DDMX": m.ddmxCodigo,
        Setores: setorLabel(m),
        Status: trocaStatusLabel(h).replace(/^\S+\s/, ""),
        Motivo: h.tipoTroca ?? "",
        Data: fmtDisplayDate(trocaData(h) ?? ""),
        "Bateria antes": pctBatteryLabel(h.bateriaAntes, h.bateriaAntesRaw ?? undefined),
        "Bateria depois": pctBatteryLabel(h.bateriaDepois, h.bateriaDepoisRaw ?? undefined),
        "Status depois": h.statusBateriaDepois ?? "",
        "Junto com CLIMP": h.juntoClimp ? "Sim" : "Não",
        "Módulo CLIMP": h.selimpVinculo ?? "",
        Observação: h.observacao ?? "",
      })),
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hist), "Histórico");
  XLSX.writeFile(wb, `Trocas DDMX ${isoToday()}.xlsx`);
}

// ===== Componente =====

export function DdmxTab({ period }: { period: string }) {
  const ddmx = useDdmxState();
  const modulos = ddmx.modulos;

  // Filtros / ordenação / paginação
  const [search, setSearch] = useState("");
  const [subFilter, setSubFilter] = useState<string[]>([]);
  const [daysFilter, setDaysFilter] = useState<string[]>([]);
  const [motivoFilter, setMotivoFilter] = useState<string[]>([]);
  const [bateriaFilter, setBateriaFilter] = useState<string[]>([]);
  const [agendadaFilter, setAgendadaFilter] = useState("all");
  const [alertaFilter, setAlertaFilter] = useState("all");
  const [sort, setSort] = useState("default");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Seleção em lote
  const [selMode, setSelMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastIdx, setLastIdx] = useState<number | null>(null);

  // Dialogs
  const [alertModule, setAlertModule] = useState<DdmxModulo | null>(null);
  const [agendarModule, setAgendarModule] = useState<DdmxModulo | null>(null);
  const [agendarDate, setAgendarDate] = useState("");
  const [agendadoModule, setAgendadoModule] = useState<DdmxModulo | null>(null);
  const [agendadoDate, setAgendadoDate] = useState("");
  const [agendadoReagendarOpen, setAgendadoReagendarOpen] = useState(false);
  const [concluirModule, setConcluirModule] = useState<DdmxModulo | null>(null);
  const [concluirDate, setConcluirDate] = useState("");
  const [concluirDesnecessaria, setConcluirDesnecessaria] = useState(false);
  const [bulkAgendarOpen, setBulkAgendarOpen] = useState(false);
  const [bulkAgendarDate, setBulkAgendarDate] = useState("");
  const [bulkAgendarMode, setBulkAgendarMode] = useState<"agendar" | "reagendar">("agendar");
  const [bulkConcluirOpen, setBulkConcluirOpen] = useState(false);
  const [bulkConcluirDate, setBulkConcluirDate] = useState("");
  const [bulkConcluirDesnecessaria, setBulkConcluirDesnecessaria] = useState(false);
  const [bulkCancelarOpen, setBulkCancelarOpen] = useState(false);
  const [eventoDelete, setEventoDelete] = useState<{ id: number; codigo: string; data: string } | null>(null);

  // ===== Agregados =====

  const diagnostico = useMemo(() => {
    const count = (s: StatusBateriaDdmx) => modulos.filter((m) => m.statusBateria === s).length;
    const comSinal = modulos.filter((m) => m.leitura && !m.leitura.desatualizada && m.statusBateria !== "SEM LEITURA").length;
    return {
      comSinal,
      semSinal: modulos.length - comSinal,
      alta: count("ALTA"),
      regular: count("REGULAR"),
      baixa: count("BAIXA"),
      critica: count("CRÍTICA"),
      desatualizada: count("DESATUALIZADA"),
      semLeitura: count("SEM LEITURA"),
    };
  }, [modulos]);

  const stats = useMemo(() => {
    const concluidas: Array<{ h: DdmxTroca; m: DdmxModulo }> = [];
    let agendadas = 0;
    for (const m of modulos) {
      for (const h of m.historico) {
        if (!inPeriod(trocaData(h), period)) continue;
        if (h.status === "concluida") concluidas.push({ h, m });
        else agendadas += 1;
      }
    }
    let corretivas = 0;
    let preventivas = 0;
    let desnecessarias = 0;
    const bat: number[] = [];
    for (const { h, m } of concluidas) {
      const tipo = (h.tipoTroca ?? m.motivoSugerido).toUpperCase();
      if (tipo.includes("DESNECESS")) desnecessarias += 1;
      else if (tipo.includes("CORRETIVA")) corretivas += 1;
      else if (tipo.includes("PREVENTIVA")) preventivas += 1;
      if (h.bateriaDepois != null) bat.push(h.bateriaDepois);
    }
    if (!bat.length) {
      for (const m of new Set(concluidas.map((c) => c.m))) {
        if (m.leitura?.bateria != null && !m.leitura.desatualizada) bat.push(m.leitura.bateria);
      }
    }
    const comSucesso = concluidas.filter(({ h }) => h.sucesso === true).length;
    const semSucesso = concluidas.filter(({ h }) => h.sucesso === false).length;
    const avaliadas = comSucesso + semSucesso;
    return {
      total: concluidas.length,
      agendadas,
      corretivas,
      preventivas,
      desnecessarias,
      comSucesso,
      semSucesso,
      aguardando: concluidas.length - avaliadas,
      juntoClimp: concluidas.filter(({ h }) => h.juntoClimp).length,
      acertividade: avaliadas ? Math.round((comSucesso / avaliadas) * 100) : 0,
      mediaBateria: bat.length ? Math.round(bat.reduce((a, b) => a + b, 0) / bat.length) : 0,
    };
  }, [modulos, period]);

  const ranking = useMemo(
    () =>
      modulos
        .map((m) => {
          const trocas = m.historico.filter((h) => h.status === "concluida" && inPeriod(h.dataTroca, period));
          const dur = duracoesBateria(m, period);
          return {
            m,
            total: trocas.length,
            juntoClimp: trocas.filter((h) => h.juntoClimp).length,
            mediaDuracao: dur.length ? Math.round(dur.reduce((a, b) => a + b, 0) / dur.length) : null,
          };
        })
        .filter((r) => r.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 7),
    [modulos, period],
  );

  const uniqueSubs = useMemo(
    () => [...new Set(modulos.map((m) => m.subprefeitura).filter((s): s is string => !!s))].sort(),
    [modulos],
  );
  const uniqueDays = useMemo(
    () =>
      [...new Set(modulos.flatMap((m) => m.setoresDias.map((s) => s.dias.trim()).filter(Boolean)))].sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [modulos],
  );

  const alertas = useMemo(() => new Map(modulos.map((m) => [m.ddmxCodigo, alertaDdmx(m)])), [modulos]);

  const lista = useMemo(() => {
    let r = modulos;
    if (subFilter.length) r = r.filter((m) => m.subprefeitura && subFilter.includes(m.subprefeitura));
    if (search) {
      const t = search.toLowerCase();
      r = r.filter(
        (m) =>
          m.ddmxCodigo.toLowerCase().includes(t) ||
          m.setores.some((s) => s.toLowerCase().includes(t)) ||
          m.selimpCodigos.some((s) => s.toLowerCase().includes(t)) ||
          (m.subprefeitura ?? "").toLowerCase().includes(t),
      );
    }
    if (daysFilter.length) r = r.filter((m) => m.setoresDias.some((s) => daysFilter.includes(s.dias.trim())));
    if (motivoFilter.length) r = r.filter((m) => motivoFilter.includes(m.motivoSugerido));
    if (bateriaFilter.length) r = r.filter((m) => bateriaFilter.includes(m.statusBateria));
    if (agendadaFilter !== "all") {
      r = r.filter((m) =>
        agendadaFilter === "sim" ? !!m.agendamento : agendadaFilter === "climp" ? !!m.agendamento?.selimpVinculo : !m.agendamento,
      );
      if (agendadaFilter !== "nao") {
        r = [...r].sort((a, b) => String(b.agendamento?.dataAgendada ?? "").localeCompare(String(a.agendamento?.dataAgendada ?? "")));
      }
    }
    if (alertaFilter !== "all") {
      r = r.filter((m) => {
        const problema = alertas.get(m.ddmxCodigo)?.level === "problema";
        return alertaFilter === "com_alerta" ? problema : !problema;
      });
    }
    if (sort !== "default") {
      const ultima = (m: DdmxModulo) => m.ultimaTroca?.dataTroca ?? "";
      const agendada = (m: DdmxModulo) => m.agendamento?.dataAgendada ?? "";
      const cargas = (m: DdmxModulo) => m.historico.length;
      const bat = (m: DdmxModulo) => m.leitura?.bateria ?? -1;
      const nullsLast = (a: string, b: string, asc: boolean) => {
        if (!a && !b) return 0;
        if (!a) return 1;
        if (!b) return -1;
        return asc ? a.localeCompare(b) : b.localeCompare(a);
      };
      r = [...r].sort((a, b) => {
        switch (sort) {
          case "cargas-desc":
            return cargas(b) - cargas(a);
          case "cargas-asc":
            return cargas(a) - cargas(b);
          case "bateria-desc":
            return (STATUS_RANK[b.statusBateria] ?? -1) - (STATUS_RANK[a.statusBateria] ?? -1) || bat(b) - bat(a);
          case "bateria-asc":
            return (STATUS_RANK[a.statusBateria] ?? -1) - (STATUS_RANK[b.statusBateria] ?? -1) || bat(a) - bat(b);
          case "exec-desc":
            return (b.execucaoMedia30 ?? -1) - (a.execucaoMedia30 ?? -1);
          case "exec-asc":
            return (a.execucaoMedia30 ?? 101) - (b.execucaoMedia30 ?? 101);
          case "ultima-troca":
            return nullsLast(ultima(a), ultima(b), false);
          case "ultima-troca-asc":
            return nullsLast(ultima(a), ultima(b), true);
          case "troca-desc":
            return nullsLast(agendada(a), agendada(b), false);
          case "troca-asc":
            return nullsLast(agendada(a), agendada(b), true);
          default:
            return 0;
        }
      });
    }
    return r;
  }, [modulos, subFilter, search, daysFilter, motivoFilter, bateriaFilter, agendadaFilter, alertaFilter, sort, alertas]);

  const totalPages = Math.max(1, Math.ceil(lista.length / ITEMS_PER_PAGE));
  const paginaAtual = Math.min(page, totalPages);
  // Página fora do intervalo (filtro reduziu a lista) é limitada à última, sem efeito extra.
  const paginated = lista.slice((paginaAtual - 1) * ITEMS_PER_PAGE, paginaAtual * ITEMS_PER_PAGE);

  const recencia = sort === "ultima-troca" || sort === "ultima-troca-asc" ? sort : "default";
  const colSortDir = (c: SortKey): "asc" | "desc" | null => (sort === `${c}-desc` ? "desc" : sort === `${c}-asc` ? "asc" : null);
  const cycleColSort = (c: SortKey) =>
    setSort((prev) => (prev === `${c}-desc` ? `${c}-asc` : prev === `${c}-asc` ? "default" : `${c}-desc`));

  // ===== Seleção =====

  function toggleSelMode() {
    setSelMode((v) => {
      if (v) {
        setSelected(new Set());
        setLastIdx(null);
      }
      return !v;
    });
  }

  function handleRowSelect(codigo: string, index: number, e: React.MouseEvent) {
    const shift = e.shiftKey;
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && lastIdx != null) {
        const [a, b] = [Math.min(lastIdx, index), Math.max(lastIdx, index)];
        for (let i = a; i <= b; i++) next.add(lista[i].ddmxCodigo);
      } else if (next.has(codigo)) next.delete(codigo);
      else next.add(codigo);
      return next;
    });
    if (!shift) setLastIdx(index);
  }

  const selectedModules = useMemo(() => lista.filter((m) => selected.has(m.ddmxCodigo)), [lista, selected]);
  const selectedAgendadas = selectedModules.filter((m) => m.agendamento);
  const selectedAllAgendadas = selectedModules.length > 0 && selectedAgendadas.length === selectedModules.length;

  // ===== Ações =====

  const baseItem = (m: DdmxModulo) => ({ ddmxCodigo: m.ddmxCodigo, setor: m.setores[0] ?? null });
  const antes = (m: DdmxModulo) => ({
    bateriaAntes: m.leitura?.bateria ?? null,
    bateriaAntesRaw: m.leitura?.bateriaRaw ?? null,
    statusBateriaAntes: m.statusBateria,
  });

  function confirmAgendar() {
    if (!agendarModule || !agendarDate) return;
    void ddmx.agendar([{ ...baseItem(agendarModule), dataAgendada: agendarDate, tipoTroca: agendarModule.motivoSugerido }]);
    setAgendarModule(null);
  }

  function openAgendado(m: DdmxModulo) {
    setAgendadoDate(m.agendamento?.dataAgendada ?? isoToday());
    setAgendadoReagendarOpen(false);
    setAgendadoModule(m);
  }

  function confirmReagendar() {
    if (!agendadoModule || !agendadoDate) return;
    void ddmx.agendar([
      {
        ...baseItem(agendadoModule),
        dataAgendada: agendadoDate,
        tipoTroca: agendadoModule.agendamento?.tipoTroca ?? agendadoModule.motivoSugerido,
        selimpVinculo: agendadoModule.agendamento?.selimpVinculo ?? null,
        juntoClimp: agendadoModule.agendamento?.juntoClimp,
      },
    ]);
    setAgendadoModule(null);
  }

  function openConcluir(m: DdmxModulo) {
    setConcluirDate(isoToday());
    setConcluirDesnecessaria(false);
    setConcluirModule(m);
  }

  function confirmConcluir() {
    if (!concluirModule || !concluirDate) return;
    void ddmx.concluir([
      {
        ...baseItem(concluirModule),
        ...antes(concluirModule),
        dataTroca: concluirDate,
        tipoTroca: concluirDesnecessaria ? "Desnecessária" : concluirModule.motivoSugerido,
      },
    ]);
    setConcluirModule(null);
  }

  function confirmBulkAgendar() {
    if (!bulkAgendarDate || !selectedModules.length) return;
    void ddmx.agendar(
      selectedModules.map((m) => ({
        ...baseItem(m),
        dataAgendada: bulkAgendarDate,
        tipoTroca: m.agendamento?.tipoTroca ?? m.motivoSugerido,
        selimpVinculo: m.agendamento?.selimpVinculo ?? null,
        juntoClimp: m.agendamento?.juntoClimp,
      })),
    );
    setBulkAgendarOpen(false);
    toggleSelMode();
  }

  function confirmBulkConcluir() {
    if (!bulkConcluirDate || !selectedModules.length) return;
    void ddmx.concluir(
      selectedModules.map((m) => ({
        ...baseItem(m),
        ...antes(m),
        dataTroca: bulkConcluirDate,
        tipoTroca: bulkConcluirDesnecessaria ? "Desnecessária" : m.motivoSugerido,
      })),
    );
    setBulkConcluirOpen(false);
    toggleSelMode();
  }

  function confirmBulkCancelar() {
    void ddmx.cancelar(selectedAgendadas.map((m) => m.ddmxCodigo));
    setBulkCancelarOpen(false);
    toggleSelMode();
  }

  const periodoLabel = period === "all" ? "todo o período" : `últimos ${period.replace("d", "")} dias`;

  if (!ddmx.loaded) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" /> Carregando módulos DDMX…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-violet-400/40 bg-linear-to-br from-violet-600/95 via-indigo-700 to-slate-950 px-6 py-8 shadow-xl shadow-indigo-950/30 ring-1 ring-white/15 sm:px-8">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-violet-400/15 blur-3xl dark:bg-indigo-500/25" aria-hidden />
        <div className="relative flex flex-col gap-8 xl:flex-row xl:items-stretch xl:justify-between xl:gap-10">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-violet-100/95">
              <Radio className="size-9 shrink-0 text-white opacity-95" aria-hidden />
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-white/85">Trocas DDMX</p>
                <h2 className="text-lg font-semibold text-white">Total de trocas realizadas</h2>
              </div>
            </div>
            <p className="mt-6 text-center text-[clamp(3rem,8vw,4.25rem)] font-bold leading-none tracking-tight text-white tabular-nums drop-shadow-sm sm:text-left">
              {stats.total}
            </p>
            <p className="mt-3 text-xs text-violet-100/85">
              Rastreador secundário · {periodoLabel} · {stats.agendadas} agendada(s) em aberto · {stats.juntoClimp} junto com a CLIMP.
            </p>
          </div>
          <div className="grid min-w-[220px] flex-1 grid-cols-1 gap-4 sm:grid-cols-3 xl:max-w-2xl">
            {[
              { label: "Preventivas", value: stats.preventivas, tip: "Bateria DDMX crítica ou baixa\nno momento da troca", Icon: ShieldCheck, color: "text-sky-200/95" },
              { label: "Corretivas", value: stats.corretivas, tip: "Bateria DDMX desatualizada\nou sem leitura", Icon: AlertTriangle, color: "text-amber-200/95" },
              { label: "Desnecessárias", value: stats.desnecessarias, tip: "Trocas feitas em baterias que ainda\nestavam em bom estado de operação", Icon: XCircle, color: "text-rose-200/95" },
            ].map(({ label, value, tip, Icon, color }) => (
              <div key={label} className="flex flex-col justify-between rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-white/80">{label}</p>
                  <InfoTooltip text={tip}>
                    <Icon className={cn("size-6 shrink-0 cursor-help", color)} aria-hidden />
                  </InfoTooltip>
                </div>
                <p className="mt-4 font-mono text-3xl font-bold text-white tabular-nums">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 4 indicadores */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="relative overflow-hidden border-0 bg-linear-to-br from-emerald-600 to-emerald-900 text-white shadow-xl shadow-emerald-900/25">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-semibold text-white/95">Trocas com Sucesso</CardTitle>
            <InfoTooltip text={`Primeira leitura DDMX após a troca\natualizada e com ≥ ${SUCESSO_MIN_PCT_DEPOIS}% de bateria`}>
              <CheckCircle2 className="size-5 shrink-0 cursor-help text-white/85" />
            </InfoTooltip>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-4xl font-bold text-white tabular-nums">{stats.comSucesso}</div>
            <p className="mt-2 text-sm font-medium text-white/90">
              Sinal e bateria restabelecidos{stats.aguardando > 0 ? ` · ${stats.aguardando} aguardando leitura` : ""}
            </p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-0 bg-linear-to-br from-rose-600 to-red-900 text-white shadow-xl shadow-red-900/25">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-semibold text-white/95">Trocas sem Sucesso</CardTitle>
            <InfoTooltip text={"Após a troca o DDMX seguiu desatualizado\nou abaixo do mínimo de bateria"}>
              <XCircle className="size-5 shrink-0 cursor-help text-white/85" />
            </InfoTooltip>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-4xl font-bold text-white tabular-nums">{stats.semSucesso}</div>
            <p className="mt-2 text-sm font-medium text-white/90">Permaneceram desatualizados</p>
          </CardContent>
        </Card>
        <Card className={cn("border-border/50 shadow-sm backdrop-blur-sm", GLASS_CARD)}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Acertividade</CardTitle>
            <InfoTooltip text={"Proporção de trocas com sucesso sobre o\ntotal de trocas com resultado conhecido"}>
              <Percent className="size-5 shrink-0 cursor-help text-emerald-500" />
            </InfoTooltip>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-emerald-600 tabular-nums dark:text-emerald-400">{stats.acertividade}%</div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${stats.acertividade}%` }} />
            </div>
          </CardContent>
        </Card>
        <Card className={cn("border-border/50 shadow-sm backdrop-blur-sm", GLASS_CARD)}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Média Bateria</CardTitle>
            <InfoTooltip text={"Bateria DDMX média lida após as trocas\ndo período"}>
              <BatteryCharging className="size-5 shrink-0 cursor-help text-sky-500" />
            </InfoTooltip>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-sky-600 tabular-nums dark:text-sky-400">{stats.mediaBateria}%</div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${stats.mediaBateria}%` }} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Ranking | Diagnóstico */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className={cn("border-border/50 shadow-sm backdrop-blur-sm", GLASS_CARD)}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <Trophy className="h-5 w-5 text-amber-500" /> Ranking de Trocas DDMX
            </CardTitle>
            <CardDescription>Módulos com maior quantidade de trocas no período</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/25 hover:bg-muted/25">
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Sub</TableHead>
                  <TableHead>Setor</TableHead>
                  <TableHead>DDMX</TableHead>
                  <TableHead className="text-center">Trocas</TableHead>
                  <TableHead className="text-center">c/ CLIMP</TableHead>
                  <TableHead className="text-center">Duração Bat.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ranking.map((r, i) => (
                  <TableRow key={r.m.ddmxCodigo} className="border-border/30 hover:bg-muted/20">
                    <TableCell className="font-bold text-muted-foreground tabular-nums">{i + 1}</TableCell>
                    <TableCell className="font-medium">{r.m.subprefeitura ?? "—"}</TableCell>
                    <TableCell><SetorCell value={setorLabel(r.m)} /></TableCell>
                    <TableCell className="font-mono text-xs">{r.m.ddmxCodigo}</TableCell>
                    <TableCell className="text-center font-bold text-violet-600 tabular-nums dark:text-violet-400">{r.total}</TableCell>
                    <TableCell className="text-center text-muted-foreground tabular-nums">{r.juntoClimp}</TableCell>
                    <TableCell className="text-center text-sky-600 tabular-nums dark:text-sky-400">
                      {r.mediaDuracao != null ? `${r.mediaDuracao}d` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {ranking.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">Sem trocas DDMX no período.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className={cn("border-border/50 shadow-sm backdrop-blur-sm", GLASS_CARD)}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <Battery className="h-5 w-5 text-violet-500" /> Diagnóstico de Baterias DDMX
            </CardTitle>
            <CardDescription>Última leitura de cada módulo nos despachos (janela de 45 dias)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {[
                { kind: "head-green", label: "COM SINAL", value: diagnostico.comSinal, note: "" },
                { kind: "value", label: "B/ ALTA", value: diagnostico.alta, note: ">70%", text: "text-emerald-600 dark:text-emerald-400" },
                { kind: "value", label: "B/ REGULAR", value: diagnostico.regular, note: ">30%", text: "text-orange-600 dark:text-orange-400" },
                { kind: "value", label: "B/ BAIXA", value: diagnostico.baixa, note: ">15%", text: "text-blue-600 dark:text-blue-400" },
                { kind: "value", label: "B/ CRÍTICA", value: diagnostico.critica, note: "<15%", text: "text-red-600 dark:text-red-500" },
                { kind: "head-red", label: "SEM SINAL", value: diagnostico.semSinal, note: "" },
                { kind: "value", label: "B/ DESATUALIZADA", value: diagnostico.desatualizada, note: "", text: "text-red-600 dark:text-red-500" },
                { kind: "value", label: "SEM LEITURA", value: diagnostico.semLeitura, note: "", text: "text-zinc-600 dark:text-zinc-300" },
              ].map((row, i) => {
                const green = row.kind === "head-green";
                const red = row.kind === "head-red";
                const head = green || red;
                const headBg = green ? "bg-emerald-700" : "bg-red-600";
                return (
                  <div key={i} className="flex items-center gap-2">
                    <div className="grid flex-1 grid-cols-[minmax(0,1fr)_72px] overflow-hidden rounded-md border border-border/60">
                      <div className={cn("px-3 py-2 text-xs font-semibold", head ? cn(headBg, "font-bold uppercase tracking-wide text-white") : "bg-muted/20 text-foreground")}>
                        {row.label}
                      </div>
                      <div className={cn("border-l px-3 py-2 text-right text-sm font-bold tabular-nums", head ? cn(headBg, "border-white/25 text-white") : cn("border-border/60", row.text))}>
                        {row.value}
                      </div>
                    </div>
                    <div className="w-10 shrink-0 text-[11px] font-semibold text-muted-foreground">{row.note}</div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Listagem */}
      <Card className={cn("border-border/50 shadow-sm backdrop-blur-sm", GLASS_CARD)}>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-foreground">
                <Table2 className="h-5 w-5 text-violet-500" /> Listagem Geral de Módulos DDMX
              </CardTitle>
              <CardDescription>Base para seleção e agendamento de trocas de bateria DDMX</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selMode && selected.size > 0 && (
                <>
                  {selectedAgendadas.length > 0 && (
                    <Button size="sm" className={cn("h-9 gap-1.5", BTN_RED)} onClick={() => setBulkCancelarOpen(true)}>
                      <XCircle className="h-4 w-4" /> Cancelar Troca ({selectedAgendadas.length})
                    </Button>
                  )}
                  {selectedAllAgendadas ? (
                    <>
                      <Button
                        size="sm"
                        className={cn("h-9 gap-1.5", BTN_SKY)}
                        onClick={() => {
                          setBulkConcluirDate(isoToday());
                          setBulkConcluirDesnecessaria(false);
                          setBulkConcluirOpen(true);
                        }}
                      >
                        <CalendarCheck2 className="h-4 w-4" /> Concluir ({selected.size})
                      </Button>
                      <Button
                        size="sm"
                        className={cn("h-9 gap-1.5", BTN_AMBER)}
                        onClick={() => {
                          setBulkAgendarMode("reagendar");
                          setBulkAgendarDate(isoToday());
                          setBulkAgendarOpen(true);
                        }}
                      >
                        <RefreshCw className="h-4 w-4" /> Reagendar ({selected.size})
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        className={cn("h-9 gap-1.5", BTN_EMERALD)}
                        onClick={() => {
                          setBulkAgendarMode("agendar");
                          setBulkAgendarDate(isoToday());
                          setBulkAgendarOpen(true);
                        }}
                      >
                        <CalendarPlus className="h-4 w-4" /> Agendar ({selected.size})
                      </Button>
                      <Button
                        size="sm"
                        className={cn("h-9 gap-1.5", BTN_SKY)}
                        onClick={() => {
                          setBulkConcluirDate(isoToday());
                          setBulkConcluirDesnecessaria(false);
                          setBulkConcluirOpen(true);
                        }}
                      >
                        <CalendarCheck2 className="h-4 w-4" /> Registrar troca ({selected.size})
                      </Button>
                    </>
                  )}
                </>
              )}
              {!selMode && (
                <Button
                  size="sm"
                  className={cn("h-9 gap-1.5", BTN_SECONDARY)}
                  disabled={lista.length === 0}
                  onClick={() => exportDdmxXlsx(lista, period)}
                >
                  <Download className="h-4 w-4" /> Exportar Excel
                </Button>
              )}
              <Button size="sm" className={cn("h-9 gap-1.5", selMode ? BTN_RED : BTN_SECONDARY)} onClick={toggleSelMode}>
                {selMode ? <X className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}
                {selMode ? "Cancelar" : "Selecionar"}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar setor, DDMX, CLIMP..." className="h-9 pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <MultiSelect compact className="w-[120px]" placeholder="Sub" emptyLabel="Todas subs" options={uniqueSubs.map((s) => ({ value: s, label: s }))} value={subFilter} onChange={setSubFilter} />
            <MultiSelect compact className="w-[204px]" placeholder="Dias de execução" options={uniqueDays.map((d) => ({ value: d, label: d }))} value={daysFilter} onChange={setDaysFilter} />
            <MultiSelect compact className="w-[160px]" placeholder="Motivo da Troca" options={MOTIVO_OPTIONS.map((m) => ({ value: m, label: m }))} value={motivoFilter} onChange={setMotivoFilter} />
            <MultiSelect compact className="w-[170px]" placeholder="Status da Bateria" options={STATUS_DDMX_OPTIONS.map((s) => ({ value: s, label: s }))} value={bateriaFilter} onChange={setBateriaFilter} />
            <Select value={agendadaFilter} onValueChange={setAgendadaFilter}>
              <SelectTrigger className="h-9 w-[190px]">
                <CalendarCheck2 className="mr-1 h-4 w-4 text-muted-foreground" />
                <SelectValue placeholder="Trocas agendadas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Trocas agendadas: Todas</SelectItem>
                <SelectItem value="sim">Com troca programada</SelectItem>
                <SelectItem value="climp">Pendentes da troca CLIMP</SelectItem>
                <SelectItem value="nao">Sem troca programada</SelectItem>
              </SelectContent>
            </Select>
            <Select value={alertaFilter} onValueChange={setAlertaFilter}>
              <SelectTrigger className="h-9 w-[170px]">
                <AlertTriangle className="mr-1 h-4 w-4 text-muted-foreground" />
                <SelectValue placeholder="Alertas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alertas: Todos</SelectItem>
                <SelectItem value="com_alerta">Com alerta crítico</SelectItem>
                <SelectItem value="sem_alerta">Sem alerta crítico</SelectItem>
              </SelectContent>
            </Select>
            <Select value={recencia} onValueChange={setSort}>
              <SelectTrigger className="h-9 w-[200px]">
                <ArrowUpDown className="mr-1 h-4 w-4 text-muted-foreground" />
                <SelectValue placeholder="Trocas por data" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Trocas: ordem padrão</SelectItem>
                <SelectItem value="ultima-troca">Trocas recentes → antigas</SelectItem>
                <SelectItem value="ultima-troca-asc">Trocas antigas → recentes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden overflow-x-auto rounded-xl bg-muted/15 shadow-sm ring-1 ring-zinc-200/80 dark:ring-zinc-700/60">
            <Table className="[&_tbody_tr]:border-b [&_tbody_tr]:border-border/30 [&_thead_tr]:border-b [&_thead_tr]:border-border/30">
              <TableHeader>
                <TableRow className="bg-muted/25 hover:bg-muted/25 [&>th]:h-16">
                  <TableHead className="w-8 text-center" />
                  <TableHead className="text-center">Sub</TableHead>
                  <TableHead>Setor</TableHead>
                  <TableHead>DDMX</TableHead>
                  <TableHead>Dias de execução</TableHead>
                  <TableHead>Última Comunicação</TableHead>
                  <TableHead>
                    <SortToggle label="Bateria" dir={colSortDir("bateria")} onClick={() => cycleColSort("bateria")} />
                  </TableHead>
                  <TableHead>Status da Bateria</TableHead>
                  <TableHead className="text-center">
                    <SortToggle label="Execução" dir={colSortDir("exec")} onClick={() => cycleColSort("exec")} />
                  </TableHead>
                  <TableHead className="text-center">
                    <SortToggle label={"Qtd.\nTrocas"} dir={colSortDir("cargas")} onClick={() => cycleColSort("cargas")} />
                  </TableHead>
                  <TableHead className="text-center">Ult. Troca</TableHead>
                  <TableHead className="text-center">
                    <div className="flex justify-center">
                      <SortToggle label="Troca" dir={colSortDir("troca")} onClick={() => cycleColSort("troca")} />
                    </div>
                  </TableHead>
                  <TableHead className="text-center">Alertas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((m, i) => {
                  const idx = (paginaAtual - 1) * ITEMS_PER_PAGE + i;
                  const sel = selected.has(m.ddmxCodigo);
                  const isExpanded = expanded === m.ddmxCodigo;
                  const alerta = alertas.get(m.ddmxCodigo) ?? { level: "none" as AlertaLevel, reasons: [] };
                  const comSinal = !!m.leitura && !m.leitura.desatualizada && m.statusBateria !== "SEM LEITURA";
                  const latestConcluidaId = m.historico.find((h) => h.status === "concluida")?.id;
                  return (
                    <Fragment key={m.ddmxCodigo}>
                      <TableRow
                        role="button"
                        tabIndex={0}
                        className={cn("border-border/30 hover:bg-muted/20", selMode && sel && "bg-violet-500/10", !selMode && isExpanded && EXPANDED_ROW)}
                        onClick={selMode ? (e) => handleRowSelect(m.ddmxCodigo, idx, e) : () => setExpanded((v) => (v === m.ddmxCodigo ? null : m.ddmxCodigo))}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" && e.key !== " ") return;
                          e.preventDefault();
                          if (!selMode) setExpanded((v) => (v === m.ddmxCodigo ? null : m.ddmxCodigo));
                        }}
                        style={{ cursor: "pointer", userSelect: selMode ? "none" : undefined }}
                      >
                        <TableCell className="w-8 text-center align-middle">
                          {selMode ? (
                            <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded border transition-colors", sel ? "border-violet-500 bg-violet-500 text-white" : "border-zinc-400 dark:border-zinc-600")}>
                              {sel && <Check className="h-3 w-3" />}
                            </span>
                          ) : isExpanded ? (
                            <ChevronDown className="mx-auto h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="mx-auto h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="text-center align-middle font-medium">{m.subprefeitura ?? "—"}</TableCell>
                        <TableCell className="align-middle"><SetorCell value={setorLabel(m)} /></TableCell>
                        <TableCell className="align-middle">
                          <span className="block font-mono font-semibold">{m.ddmxCodigo}</span>
                          {m.selimpCodigos.length > 0 && (
                            <span className="block text-[10px] text-muted-foreground" title="Módulo CLIMP do(s) mesmo(s) setor(es)">
                              CLIMP {m.selimpCodigos.join(" / ")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="align-middle">
                          <div className="space-y-1 text-xs leading-snug">
                            {m.setoresDias.map((sd) => (
                              <div key={sd.setor} className="flex flex-col">
                                <span className="font-mono text-[10px] text-muted-foreground">{sd.setor}</span>
                                <span className="text-foreground">{sd.dias || "—"}</span>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="align-middle text-xs text-muted-foreground tabular-nums">{fmtComunicacao(m.leitura?.ultimaComunicacao)}</TableCell>
                        <TableCell className="align-middle">
                          {m.leitura?.bateria != null ? (
                            <InfoTooltip text={`${m.leitura.bateriaRaw ?? "—"} · leitura de ${fmtIsoBr(m.leitura.data)}${m.leitura.desatualizada ? "\nDesatualizada — sem leitura válida" : ""}`}>
                              <span className={cn("cursor-help font-medium tabular-nums", m.leitura.desatualizada && "text-orange-600 dark:text-orange-400")}>
                                {Math.round(m.leitura.bateria)}%
                              </span>
                            </InfoTooltip>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="align-middle">
                          <div className="flex items-center gap-1.5">
                            <InfoTooltip text={comSinal ? "Bateria DDMX atualizada (com sinal)" : "Bateria DDMX desatualizada ou sem leitura"}>
                              {comSinal ? <Wifi className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <WifiOff className="h-3.5 w-3.5 shrink-0 text-red-500" />}
                            </InfoTooltip>
                            {renderStatusDdmx(m.statusBateria, false)}
                          </div>
                        </TableCell>
                        <TableCell className="text-center align-middle font-medium tabular-nums">{m.execucaoMedia30 != null ? `${m.execucaoMedia30}%` : "—"}</TableCell>
                        <TableCell className="text-center align-middle font-medium tabular-nums">{m.historico.filter((h) => h.status === "concluida").length}</TableCell>
                        <TableCell className="text-center align-middle text-xs text-muted-foreground tabular-nums">{fmtDisplayDate(m.ultimaTroca?.dataTroca ?? "")}</TableCell>
                        <TableCell className="text-center align-middle" onClick={(e) => e.stopPropagation()}>
                          {m.agendamento ? (
                            <Button size="sm" disabled={selMode} className={cn("h-7 gap-1", BTN_AMBER)} onClick={() => openAgendado(m)}>
                              <Clock className="h-3.5 w-3.5" /> Agendado · {fmtIsoBr(m.agendamento.dataAgendada ?? "")}
                              {m.agendamento.selimpVinculo && (
                                <span className="ml-0.5 rounded bg-white/25 px-1 text-[10px] font-bold" title={`Agendada junto com a troca CLIMP ${m.agendamento.selimpVinculo}`}>
                                  CLIMP
                                </span>
                              )}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              disabled={selMode}
                              className={cn("h-7 gap-1", BTN_EMERALD)}
                              onClick={() => {
                                setAgendarModule(m);
                                setAgendarDate(isoToday());
                              }}
                            >
                              <CalendarPlus className="h-3.5 w-3.5" /> Agendar
                            </Button>
                          )}
                        </TableCell>
                        <TableCell className="text-center align-middle" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            disabled={alerta.level === "none" || selMode}
                            onClick={() => setAlertModule(m)}
                            title={alerta.level === "problema" ? "Problemático" : alerta.level === "observacao" ? "Em observação" : "Sem alerta"}
                            className={cn(
                              "inline-flex h-7 w-7 items-center justify-center rounded-md border-0 transition-all hover:scale-[1.03] active:scale-[0.97]",
                              alerta.level === "problema"
                                ? BTN_RED
                                : alerta.level === "observacao"
                                  ? BTN_AMBER
                                  : "cursor-default bg-zinc-200 text-zinc-400 opacity-40 shadow-none hover:scale-100 active:scale-100 dark:bg-zinc-800 dark:text-zinc-500",
                            )}
                          >
                            {alerta.level === "problema" ? <BellRing className="h-4 w-4" /> : alerta.level === "observacao" ? <AlertTriangle className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                          </button>
                        </TableCell>
                      </TableRow>

                      {!selMode && isExpanded && (
                        <TableRow className="border-violet-500/20 bg-violet-500/5 hover:bg-violet-500/5">
                          <TableCell colSpan={13} className="p-0 align-middle">
                            <div className="space-y-4 px-4 py-4">
                              <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
                                <MiniStat label="Trocas registradas" value={m.historico.filter((h) => h.status === "concluida").length} big />
                                <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                                  <span className="block text-xs text-muted-foreground">Status da bateria</span>
                                  <span className="mt-1 block">{renderStatusDdmx(m.statusBateria)}</span>
                                </div>
                                <MiniStat label="Bateria atual" value={bateriaAtualLabel(m)} sub={m.leitura ? `leitura de ${fmtIsoBr(m.leitura.data)}` : undefined} />
                                <MiniStat
                                  label="Módulo CLIMP"
                                  value={m.selimpCodigos.join(" / ") || "—"}
                                  sub={m.instalacao ? `DDMX instalado em ${fmtIsoBr(m.instalacao)}` : undefined}
                                />
                                <MiniStat label="Última comunicação" value={fmtComunicacao(m.leitura?.ultimaComunicacao)} />
                                <MiniStat label="Dias desatualizados (30d)" value={`${m.diasDesatualizados30} de ${m.diasComLeitura30}`} big />
                              </div>

                              <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-2">
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <Percent className="h-4 w-4 text-sky-500" />
                                    <span className="text-sm font-semibold text-foreground">Execução DDMX</span>
                                  </div>
                                  <Badge className="border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300">
                                    Média 30d: {m.execucaoMedia30 != null ? `${m.execucaoMedia30}%` : "—"}
                                  </Badge>
                                </div>
                                {m.execucoes.length > 0 ? (
                                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-10">
                                    {[...m.execucoes].reverse().slice(0, 20).map((e) => {
                                      const troca = m.historico.find((h) => h.status === "concluida" && h.dataTroca === e.data);
                                      return (
                                        <div key={e.data} className={cn("rounded-lg border bg-muted/20 px-2 py-2", troca ? "border-violet-500/50" : "border-border/50")}>
                                          <div className="flex items-center justify-between gap-1">
                                            <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
                                              {fmtIsoBr(e.data).slice(0, 5)}
                                              {troca && <span title="Troca DDMX neste dia"> 🔄</span>}
                                            </span>
                                            <span className="text-xs font-bold text-foreground tabular-nums">{e.percentual != null ? `${Math.round(e.percentual)}%` : "—"}</span>
                                          </div>
                                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                                            <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(0, Math.min(100, e.percentual ?? 0))}%` }} />
                                          </div>
                                          <div className="mt-1.5 flex items-center gap-1" title={e.bateriaRaw ?? undefined}>
                                            <Battery className={cn("h-3 w-3 shrink-0", bateriaDiaColor(e))} />
                                            <span className={cn("text-[11px] font-semibold tabular-nums", bateriaDiaColor(e))}>
                                              {e.desatualizada ? "Desat." : e.bateria != null ? `${Math.round(e.bateria)}%` : "—"}
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">Sem despachos DDMX nos últimos 30 dias para os setores deste módulo.</p>
                                )}
                              </div>

                              <div className="rounded-xl border border-border/60 bg-background/60 p-3">
                                <div className="mb-3 flex items-center gap-2">
                                  <History className="h-4 w-4 text-violet-500" />
                                  <span className="text-sm font-semibold text-foreground">Histórico de trocas DDMX</span>
                                </div>
                                {m.historico.length === 0 ? (
                                  <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">Nenhuma troca DDMX registrada.</p>
                                ) : (
                                  <div className="space-y-2">
                                    {m.historico.map((h) => {
                                      const isLatest = h.status === "concluida" && h.id === latestConcluidaId;
                                      const statusAntes = h.statusBateriaAntes || "—";
                                      const statusDepois = h.statusBateriaDepois || (isLatest && h.sucesso == null ? "Aguardando" : "—");
                                      return (
                                        <div key={h.id} className="rounded-lg border border-border/50 bg-muted/20 p-3">
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                              <span className="text-lg leading-none">{trocaStatusEmoji(h)}</span>
                                              <Badge className={trocaStatusBadgeClass(h)}>{trocaStatusLabel(h)}</Badge>
                                              <span className="text-xs font-medium text-muted-foreground">{h.tipoTroca || m.motivoSugerido}</span>
                                              {h.selimpVinculo && (
                                                <Badge className="gap-1 border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300">
                                                  <Link2 className="h-3 w-3" /> CLIMP {h.selimpVinculo}
                                                </Badge>
                                              )}
                                              {h.status === "concluida" && h.juntoClimp && !h.selimpVinculo && (
                                                <Badge className="border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300">Junto com CLIMP</Badge>
                                              )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <span className="text-xs font-semibold text-foreground tabular-nums">{fmtDisplayDate(trocaData(h) ?? "")}</span>
                                              <button
                                                type="button"
                                                title="Excluir do histórico"
                                                onClick={() => setEventoDelete({ id: h.id, codigo: m.ddmxCodigo, data: trocaData(h) ?? "" })}
                                                className="text-muted-foreground transition-colors hover:text-red-500"
                                              >
                                                <Trash2 className="h-3.5 w-3.5" />
                                              </button>
                                            </div>
                                          </div>
                                          {h.status === "concluida" && (
                                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs lg:grid-cols-6">
                                              <HistStat label="Bateria antes" value={pctBatteryLabel(h.bateriaAntes, h.bateriaAntesRaw ?? undefined)} />
                                              <HistStat label="Bateria depois" value={pctBatteryLabel(h.bateriaDepois, h.bateriaDepoisRaw ?? undefined)} />
                                              <HistStat label="Status antes" value={statusAntes} className={getStatusColorClass(statusAntes)} />
                                              <HistStat label="Status depois" value={statusDepois} className={getStatusColorClass(statusDepois)} />
                                              <HistStat label="Leitura depois" value={fmtDisplayDate(h.dataLeituraDepois ?? "")} />
                                              <HistStat label="Últ. com. depois" value={fmtComunicacao(h.ultimaComunicacaoDepois)} />
                                            </div>
                                          )}
                                          {h.observacao && <p className="mt-2 text-xs text-muted-foreground">{h.observacao}</p>}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
                {lista.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={13} className="py-10 text-center text-sm text-muted-foreground">
                      Nenhum módulo DDMX encontrado. Cadastre o código DDMX dos setores na aba Setores.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Página {paginaAtual} de {totalPages} ({lista.length} módulos) — agende pela coluna “Troca”; “Selecionar” para ações em lote.
            </span>
            <div className="flex gap-2">
              <Button className={cn("size-8 p-0", BTN_SECONDARY)} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={paginaAtual === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button className={cn("size-8 p-0", BTN_SECONDARY)} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={paginaAtual === totalPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== Dialogs ===== */}

      <Dialog open={!!alertModule} onOpenChange={(o) => !o && setAlertModule(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Alertas do módulo DDMX {alertModule?.ddmxCodigo}
            </DialogTitle>
            <DialogDescription>{alertModule ? setorLabel(alertModule) : ""}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {(alertModule ? alertas.get(alertModule.ddmxCodigo)?.reasons ?? [] : []).map((r, i) => (
              <li
                key={i}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm",
                  r.severity === "problema" ? "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300" : "border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-200",
                )}
              >
                {r.text}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <Dialog open={!!agendarModule} onOpenChange={(o) => !o && setAgendarModule(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <CalendarPlus className="h-5 w-5 text-emerald-500" /> Agendar troca de bateria DDMX
            </DialogTitle>
            <DialogDescription>Defina a data de agendamento da troca.</DialogDescription>
          </DialogHeader>
          {agendarModule && (
            <div className="space-y-4">
              <ModuloResumo m={agendarModule} />
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <CalendarPlus className="h-4 w-4 text-emerald-500" /> Data Agendamento
                </label>
                <DatePicker value={agendarDate} onChange={setAgendarDate} />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button className={cn(BTN_SECONDARY)} onClick={() => setAgendarModule(null)}>Cancelar</Button>
            <Button className={cn(BTN_EMERALD)} disabled={!agendarDate} onClick={confirmAgendar}>
              <CalendarPlus className="h-4 w-4" /> Agendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!agendadoModule}
        onOpenChange={(o) => {
          if (o) return;
          setAgendadoReagendarOpen(false);
          setAgendadoModule(null);
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl overflow-hidden">
          <DialogHeader className="min-w-0 pr-6">
            <DialogTitle className="flex min-w-0 items-center gap-2 text-base">
              <Clock className="h-5 w-5 shrink-0 text-amber-500" />
              <span className="min-w-0 truncate">Troca DDMX agendada</span>
            </DialogTitle>
            <DialogDescription className="min-w-0 break-words">
              {agendadoModule ? `${setorLabel(agendadoModule)} · DDMX ${agendadoModule.ddmxCodigo}` : ""}
            </DialogDescription>
          </DialogHeader>
          {agendadoModule && (
            <div className="min-w-0 space-y-4">
              <div className="min-w-0 break-words rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm">
                Agendada para <strong className="tabular-nums">{fmtIsoBr(agendadoModule.agendamento?.dataAgendada ?? "")}</strong>
                {agendadoModule.agendamento?.selimpVinculo && (
                  <> junto com a troca CLIMP do módulo <strong>{agendadoModule.agendamento.selimpVinculo}</strong></>
                )}
                . Conclua, reagende ou cancele esta troca.
              </div>
              {agendadoReagendarOpen && (
                <div className="min-w-0">
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Nova data de agendamento</label>
                  <DatePicker value={agendadoDate} onChange={setAgendadoDate} />
                </div>
              )}
            </div>
          )}
          <DialogFooter className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:space-x-0">
            <Button
              className={cn("w-full min-w-0 justify-center whitespace-nowrap", BTN_RED)}
              onClick={() => {
                if (agendadoModule) void ddmx.cancelar([agendadoModule.ddmxCodigo]);
                setAgendadoModule(null);
              }}
            >
              <XCircle className="mr-1.5 h-4 w-4 shrink-0" /> <span className="truncate">Cancelar troca</span>
            </Button>
            <Button
              className={cn("w-full min-w-0 justify-center whitespace-nowrap", BTN_AMBER)}
              disabled={agendadoReagendarOpen && !agendadoDate}
              onClick={() => (agendadoReagendarOpen ? confirmReagendar() : setAgendadoReagendarOpen(true))}
            >
              <RefreshCw className="mr-1.5 h-4 w-4 shrink-0" /> <span className="truncate">{agendadoReagendarOpen ? "Salvar reagendamento" : "Reagendar"}</span>
            </Button>
            <Button
              className={cn("w-full min-w-0 justify-center whitespace-nowrap", BTN_SKY)}
              onClick={() => {
                const m = agendadoModule;
                setAgendadoModule(null);
                if (m) openConcluir(m);
              }}
            >
              <CalendarCheck2 className="mr-1.5 h-4 w-4 shrink-0" /> <span className="truncate">Concluir troca</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!concluirModule} onOpenChange={(o) => !o && setConcluirModule(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <CalendarCheck2 className="h-5 w-5 text-sky-500" /> Concluir troca de bateria DDMX
            </DialogTitle>
            <DialogDescription>{concluirModule ? `${setorLabel(concluirModule)} · DDMX ${concluirModule.ddmxCodigo}` : ""}</DialogDescription>
          </DialogHeader>
          {concluirModule && (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Data da troca</label>
                <DatePicker value={concluirDate} onChange={setConcluirDate} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Status atual</span>
                  {renderStatusDdmx(concluirModule.statusBateria)}
                  <span className="text-xs font-medium text-foreground tabular-nums">{bateriaAtualLabel(concluirModule)}</span>
                </div>
                {sucessoPreviewChip(concluirModule)}
              </div>
              <label className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
                <span className="text-xs text-foreground">
                  Troca desnecessária
                  <span className="block text-[11px] text-muted-foreground">Marque se a troca não era necessária. Com/sem sucesso continua automático.</span>
                </span>
                <Switch checked={concluirDesnecessaria} onCheckedChange={setConcluirDesnecessaria} />
              </label>
              <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                O resultado vem da primeira leitura DDMX em dia posterior à troca: com sucesso quando atualizada e com pelo menos{" "}
                <strong>{SUCESSO_MIN_PCT_DEPOIS}%</strong> de bateria.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button className={cn(BTN_SECONDARY)} onClick={() => setConcluirModule(null)}>Cancelar</Button>
            <Button className={cn(BTN_SKY)} disabled={!concluirDate} onClick={confirmConcluir}>Registrar conclusão</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkCancelarOpen} onOpenChange={setBulkCancelarOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5 text-red-500" /> Cancelar trocas DDMX agendadas
            </DialogTitle>
            <DialogDescription>Remove o agendamento de troca dos módulos selecionados.</DialogDescription>
          </DialogHeader>
          <ListaModulos modulos={selectedAgendadas} />
          <DialogFooter className="gap-2">
            <Button className={cn(BTN_SECONDARY)} onClick={() => setBulkCancelarOpen(false)}>Voltar</Button>
            <Button className={cn(BTN_RED)} disabled={!selectedAgendadas.length} onClick={confirmBulkCancelar}>
              <XCircle className="mr-1.5 h-4 w-4" /> Cancelar {selectedAgendadas.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkAgendarOpen} onOpenChange={setBulkAgendarOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {bulkAgendarMode === "reagendar" ? <RefreshCw className="h-5 w-5 text-amber-500" /> : <CalendarPlus className="h-5 w-5 text-emerald-500" />}
              {bulkAgendarMode === "reagendar" ? "Reagendar troca DDMX" : "Agendar troca DDMX"} — {selectedModules.length} módulo(s)
            </DialogTitle>
            <DialogDescription>Todos os módulos selecionados ficam com a mesma data.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="max-h-88 space-y-2.5 overflow-y-auto rounded-lg border border-border/60 bg-muted/15 p-2.5">
              {selectedModules.map((m) => (
                <ModuloResumo key={m.ddmxCodigo} m={m} compact />
              ))}
            </div>
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <CalendarPlus className="h-4 w-4 text-emerald-500" /> {bulkAgendarMode === "reagendar" ? "Nova data de agendamento" : "Data Agendamento"}
              </label>
              <DatePicker value={bulkAgendarDate} onChange={setBulkAgendarDate} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button className={cn(BTN_SECONDARY)} onClick={() => setBulkAgendarOpen(false)}>Cancelar</Button>
            <Button className={cn(bulkAgendarMode === "reagendar" ? BTN_AMBER : BTN_EMERALD)} disabled={!bulkAgendarDate} onClick={confirmBulkAgendar}>
              {bulkAgendarMode === "reagendar" ? "Reagendar" : "Agendar"} {selectedModules.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkConcluirOpen} onOpenChange={setBulkConcluirOpen}>
        <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <CalendarCheck2 className="h-5 w-5 text-sky-500" /> Concluir trocas DDMX — {selectedModules.length} módulo(s)
            </DialogTitle>
            <DialogDescription>Uma data para todos. O resultado (com/sem sucesso) é automático pela próxima leitura DDMX.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Data da troca</label>
              <DatePicker value={bulkConcluirDate} onChange={setBulkConcluirDate} />
            </div>
            <label className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
              <span className="text-xs text-foreground">
                Trocas desnecessárias
                <span className="block text-[11px] text-muted-foreground">Marca todas como desnecessárias.</span>
              </span>
              <Switch checked={bulkConcluirDesnecessaria} onCheckedChange={setBulkConcluirDesnecessaria} />
            </label>
            <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border/60 bg-muted/15 p-2">
              {selectedModules.map((m) => (
                <div key={m.ddmxCodigo} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background/70 px-2.5 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-foreground">{setorLabel(m)}</p>
                    <p className="text-xs text-muted-foreground">DDMX {m.ddmxCodigo}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {renderStatusDdmx(m.statusBateria)}
                    {sucessoPreviewChip(m)}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button className={cn(BTN_SECONDARY)} onClick={() => setBulkConcluirOpen(false)}>Cancelar</Button>
            <Button className={cn(BTN_SKY)} disabled={!bulkConcluirDate} onClick={confirmBulkConcluir}>Concluir {selectedModules.length}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!eventoDelete} onOpenChange={(o) => !o && setEventoDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Trash2 className="h-5 w-5 text-red-500" /> Excluir troca DDMX
            </DialogTitle>
            <DialogDescription>
              Remove permanentemente o registro de {fmtDisplayDate(eventoDelete?.data ?? "")} do módulo DDMX {eventoDelete?.codigo}. Não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button className={cn(BTN_SECONDARY)} onClick={() => setEventoDelete(null)}>Cancelar</Button>
            <Button
              className={cn("gap-1.5", BTN_RED)}
              onClick={() => {
                if (eventoDelete) void ddmx.removerEvento(eventoDelete.id);
                setEventoDelete(null);
              }}
            >
              <Trash2 className="h-4 w-4" /> Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===== Subcomponentes =====

function MiniStat({ label, value, sub, big }: { label: string; value: string | number; sub?: string; big?: boolean }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/70 p-3">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className={cn("mt-1 block font-semibold text-foreground tabular-nums", big ? "text-xl font-bold" : "text-sm")}>{value}</span>
      {sub && <span className="mt-1 block text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function HistStat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-md bg-background/70 p-2">
      <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("font-bold text-foreground tabular-nums", className)}>{value}</span>
    </div>
  );
}

function ModuloResumo({ m, compact }: { m: DdmxModulo; compact?: boolean }) {
  if (compact) {
    return (
      <div className="rounded-lg border border-border/50 bg-background/70 p-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-mono text-xs font-semibold">
            <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            DDMX {m.ddmxCodigo}
          </span>
          {renderStatusDdmx(m.statusBateria, false)}
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">{m.setoresDias.map((s) => `${s.setor} · ${s.dias || "—"}`).join("  |  ")}</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" /> Setores
        </span>
        <div className="mt-1 space-y-0.5">
          {m.setoresDias.map((s) => (
            <p key={s.setor} className="font-mono text-sm font-medium">
              {s.setor} <span className="text-xs font-normal text-muted-foreground">· {s.dias || "—"}</span>
            </p>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Hash className="h-3.5 w-3.5 shrink-0" /> Módulo DDMX
        </span>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="font-medium">{m.ddmxCodigo}</span>
          {renderStatusDdmx(m.statusBateria, false)}
        </div>
        <span className="mt-1 block text-xs text-muted-foreground">
          Bateria {bateriaAtualLabel(m)} · CLIMP {m.selimpCodigos.join(" / ") || "—"}
        </span>
      </div>
    </div>
  );
}

function ListaModulos({ modulos }: { modulos: DdmxModulo[] }) {
  return (
    <div className="max-h-44 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-2">
      <ul className="space-y-1 text-sm">
        {modulos.map((m) => (
          <li key={m.ddmxCodigo} className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-xs">{setorLabel(m)}</span>
            <span className="shrink-0 text-xs text-muted-foreground">DDMX {m.ddmxCodigo}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
