"use client";

import { useState, useEffect, useMemo } from "react";
import type { DateRange } from "react-day-picker";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiService } from "@/lib/api";
import { format, isValid, startOfDay } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateRangePicker, getEsteMesRange } from "@/components/ui/date-range-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ShieldCheck,
  Clock,
  DollarSign,
  Archive,
  Ban,
  FileWarning,
  Calendar,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

/** Formata número no padrão BR: R$ 1.234,56 */
function formatBr(valor: number): string {
  if (valor <= 0 || isNaN(valor)) return "R$ 0,00";
  const [int, dec] = valor.toFixed(2).split(".");
  const intFormatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${intFormatted},${dec}`;
}

/** Parse input BR (R$ 1.234,56 / 1.234,56 / 1234,56) para número */
function parseBrInput(s: string): number {
  const t = String(s ?? "").trim().replace(/\s/g, "").replace(/R\$/gi, "");
  const normalized = t.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : Math.max(0, n);
}

/** Normaliza campos do ACIC (CSV pode vir com N_ACIC, N_BFS, etc.) */
function getAcicField(acic: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = acic[k] ?? acic[k.toLowerCase()];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

/** Igual ao CSV do servidor: cabeçalhos com ou sem acento. */
function canonicalHeaderKey(k: string): string {
  return k
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getAcicByCanonical(acic: Record<string, unknown>, want: string): string | undefined {
  for (const [k, v] of Object.entries(acic)) {
    if (k.startsWith("_")) continue;
    if (canonicalHeaderKey(k) === want && v != null && String(v).trim()) {
      return String(v).trim();
    }
  }
  return undefined;
}

/** Parse token BR tipo 1.234,56 ou 1234,56 para número. */
function parseBrMoneyToken(token: string): number {
  const t = String(token ?? "").trim().replace(/\./g, "").replace(",", ".");
  const n = parseFloat(t);
  return isNaN(n) || n < 0 ? 0 : n;
}

/**
 * Célula monetária BR (col. Valor_Multa): 1.234,56 / 750,00 / R$ 500 — não usar parseFloat direto na string inteira.
 */
function parseBrMoneyCell(raw: string | undefined): number {
  if (raw == null) return 0;
  let s = String(raw).trim();
  if (!s || s === "-" || /^n\/?a$/i.test(s)) return 0;
  s = s.replace(/R\$/gi, "").replace(/\s/g, "").replace(/\u00a0/g, "");
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    const li = s.lastIndexOf(",");
    const intPart = s.slice(0, li).replace(/\./g, "");
    const decPart = s.slice(li + 1);
    const n = parseFloat(`${intPart}.${decPart}`);
    return isNaN(n) || n < 0 ? 0 : n;
  }
  if (hasComma) {
    const li = s.lastIndexOf(",");
    const intPart = s.slice(0, li).replace(/\./g, "");
    const decPart = s.slice(li + 1);
    if (decPart.length <= 4) {
      const n = parseFloat(decPart.length ? `${intPart}.${decPart}` : intPart);
      return isNaN(n) || n < 0 ? 0 : n;
    }
  }
  if (!hasComma && hasDot && /^\d+\.\d{1,4}$/.test(s)) {
    const n = parseFloat(s);
    return isNaN(n) || n < 0 ? 0 : n;
  }
  const n = parseFloat(s.replace(/\./g, ""));
  return isNaN(n) || n < 0 ? 0 : n;
}

/**
 * Multa na coluna Observacao (Z) ou campo de texto do FLIP.
 * Handles BR format (1.234,56), plain float (13115.95), R$ variants.
 */
function parseValorMultaFromObservacao(obs: string | undefined): number {
  if (!obs?.trim()) return 0;
  const text = obs
    .replace(/\r\n/g, " ")
    .replace(/\n/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let best = 0;
  const bump = (n: number) => { if (n > best) best = n; };

  // Plain float stored by CSV parser: "13115.95", "18971.94" (whole string or standalone token)
  if (/^\d+\.\d{2}$/.test(text)) {
    const n = parseFloat(text);
    if (!isNaN(n) && n > 0) bump(n);
  }
  // Plain float inside text, at least 3 digits before decimal: 13115.95
  for (const m of text.matchAll(/(?<![.,\d])(\d{3,}\.\d{2})(?![.,\d])/g)) {
    const n = parseFloat(m[1] ?? "");
    if (!isNaN(n) && n >= 100) bump(n);
  }
  // R$ 1.234,56 or R$1234,56
  for (const m of text.matchAll(/R\$\s*([\d]{1,3}(?:\.\d{3})*(?:,\d{1,4})?|\d+(?:,\d{1,4})?)/gi)) {
    bump(parseBrMoneyCell(m[0]));
  }
  // BR milhar: 1.234,56
  for (const m of text.matchAll(/(\d{1,3}(?:\.\d{3})+,\d{2})/g)) {
    bump(parseBrMoneyToken(m[1] ?? ""));
  }
  // Keyword + value: "multa de 13.115,95"
  for (const m of text.matchAll(/(?:multa|valor|autua|cl[aá]usula)[^0-9]{0,45}(\d{1,3}(?:\.\d{3})*,\d{2}|\d{1,7},\d{2})/gi)) {
    bump(parseBrMoneyToken(m[1] ?? ""));
  }
  // Any BR decimal at word boundary
  for (const m of text.matchAll(/(\d[\d.]{0,14},\d{2})(?=\s|$|[);.])/g)) {
    bump(parseBrMoneyToken(m[1] ?? ""));
  }
  return best;
}

function acicStatusLower(acic: Record<string, unknown>): string {
  return (getAcicByCanonical(acic, "status") ?? getAcicField(acic, "Status", "status") ?? "").toLowerCase();
}

/**
 * Valor da multa no CSV.
 * Estratégia: col T (Valor_Multa) → col Z (Observacao) → col T como texto (quando col T foi preenchida errada).
 * Suporta BR (1.234,56), float puro (13115.95) e R$ variants.
 */
function getValorMultaDoCsv(acic: Record<string, unknown>): number {
  const rawT = getAcicByCanonical(acic, "valor_multa") ?? getAcicField(acic, "Valor_Multa", "valor_multa");
  const t = parseBrMoneyCell(rawT);
  if (t > 0) return t;

  const rawZ =
    getAcicByCanonical(acic, "observacao") ??
    getAcicField(acic, "Observacao", "observacao", "Observação");
  const z = parseValorMultaFromObservacao(rawZ);
  if (z > 0) return z;

  // col T pode ter texto descritivo (colunas deslocadas no CSV); tenta extrair valor embutido
  return parseValorMultaFromObservacao(rawT);
}

function valorResolvido(acic: Record<string, unknown>, nAcic: string, map: Record<string, number>): number {
  if (Object.prototype.hasOwnProperty.call(map, nAcic)) {
    return map[nAcic] ?? 0;
  }
  return getValorMultaDoCsv(acic);
}

/** Formata data FLIP (dd/MM/yyyy HH:mm or dd/MM/yyyy) de forma segura. */
function formatAcicDate(s: string | undefined): string {
  if (!s?.trim()) return "—";
  const t = s.trim();
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!m) return t;
  const [, d, mo, y, h, min, sec] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), h ? Number(h) : 0, min ? Number(min) : 0, sec ? Number(sec) : 0);
  if (!isValid(date)) return t;
  return format(date, "dd/MM/yyyy HH:mm");
}

type FiltroRegistro = "todos" | "defesa" | "em_aberto" | "confirmado" | "sem_recurso" | "arquivado";

function isStatusProcessoArquivado(status: string | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return s.includes("arquivado");
}

interface ACIC {
  id: string;
  [key: string]: unknown;
}

function clampDateNotFuture(d: Date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dd = new Date(d);
  dd.setHours(0, 0, 0, 0);
  return dd > today ? today : dd;
}

export default function ACICPage() {
  const [acics, setAcics] = useState<ACIC[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [defesaMap, setDefesaMap] = useState<Record<string, boolean>>({});
  const [semRecursoMap, setSemRecursoMap] = useState<Record<string, boolean>>({});
  const [valorMap, setValorMap] = useState<Record<string, number>>({});
  const [periodRange, setPeriodRange] = useState<DateRange | undefined>(undefined);
  const [filters, setFilters] = useState({
    registro: "todos" as FiltroRegistro,
  });

  const periodQueryKey = useMemo(() => {
    if (!periodRange?.from || !periodRange?.to) return "all";
    return `${format(startOfDay(periodRange.from), "yyyy-MM-dd")}|${format(startOfDay(periodRange.to), "yyyy-MM-dd")}`;
  }, [periodRange]);

  useEffect(() => {
    loadACICs();
  }, [periodQueryKey]);

  const periodModeLabel = periodRange?.from && periodRange?.to ? "Período" : "";

  const loadACICs = async () => {
    try {
      setLoading(true);
      const params =
        periodRange?.from && periodRange?.to
          ? {
              periodo_inicial: format(startOfDay(periodRange.from), "yyyy-MM-dd"),
              periodo_final: format(startOfDay(periodRange.to), "yyyy-MM-dd"),
            }
          : undefined;
      const data = await apiService.getACICs(params);
      const items = data.items || [];
      setAcics(items);
      setTotal(items.length);

      const defesa: Record<string, boolean> = {};
      const semRecurso: Record<string, boolean> = {};
      const valor: Record<string, number> = {};
      for (const a of items) {
        const n = getAcicField(a, "N_ACIC", "n_acic") ?? "";
        if (n) {
          defesa[n] = Boolean((a as { _defesa?: boolean })._defesa);
          semRecurso[n] = Boolean((a as { _sem_recurso?: boolean })._sem_recurso);
          const v = (a as { _valor_override?: number | null })._valor_override;
          if (v != null && Number(v) > 0) valor[n] = Number(v);
        }
      }
      setDefesaMap(defesa);
      setSemRecursoMap(semRecurso);
      setValorMap(valor);
    } catch (error) {
      console.error("Erro ao carregar ACICs:", error);
      setAcics([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  const toggleDefesa = async (nAcic: string) => {
    const next = !defesaMap[nAcic];
    setDefesaMap((prev) => ({ ...prev, [nAcic]: next }));
    try {
      await apiService.updateACICOverride(nAcic, { defesa: next });
    } catch (e) {
      console.error("Erro ao salvar defesa:", e);
      setDefesaMap((prev) => ({ ...prev, [nAcic]: !next }));
    }
  };

  const toggleSemRecurso = async (nAcic: string) => {
    const next = !semRecursoMap[nAcic];
    setSemRecursoMap((prev) => ({ ...prev, [nAcic]: next }));
    try {
      await apiService.updateACICOverride(nAcic, { sem_recurso: next });
    } catch (e) {
      console.error("Erro ao salvar sem recurso:", e);
      setSemRecursoMap((prev) => ({ ...prev, [nAcic]: !next }));
    }
  };

  const getValorForAcic = (acic: ACIC, nAcic: string): number => valorResolvido(acic, nAcic, valorMap);

  const setValorForAcic = async (nAcic: string, valor: number) => {
    setValorMap((prev) => ({ ...prev, [nAcic]: valor }));
    try {
      await apiService.updateACICOverride(nAcic, { valor: valor > 0 ? valor : null });
    } catch (e) {
      console.error("Erro ao salvar valor:", e);
    }
  };

  const acicsFiltered = useMemo(() => {
    return acics.filter((acic) => {
      const nAcic = getAcicField(acic, "N_ACIC", "n_acic") ?? "";
      const status = acicStatusLower(acic);
      const temDefesa = defesaMap[nAcic];
      const temSemRecurso = semRecursoMap[nAcic];
      const emAberto = status.includes("solicitacao") || status.includes("solicitação");
      const arquivado = status.includes("arquivado");
      const confirmado = status.includes("confirmado");

      switch (filters.registro) {
        case "defesa":
          return temDefesa;
        case "em_aberto":
          return emAberto;
        case "confirmado":
          return confirmado;
        case "sem_recurso":
          return temSemRecurso;
        case "arquivado":
          return arquivado;
        default:
          return true;
      }
    });
  }, [acics, filters.registro, defesaMap, semRecursoMap, valorMap]);

  const totalMultas = useMemo(() => {
    return acicsFiltered.reduce((sum, acic) => {
      const nAcic = getAcicField(acic, "N_ACIC", "n_acic") ?? "";
      return sum + getValorForAcic(acic, nAcic);
    }, 0);
  }, [acicsFiltered, valorMap]);

  const stats = useMemo(() => {
    let defesa = 0;
    let emAberto = 0;
    let semRecurso = 0;
    let arquivado = 0;
    let confirmado = 0;

    for (const a of acics) {
      const n = getAcicField(a, "N_ACIC", "n_acic") ?? "";
      const s = acicStatusLower(a);
      if (defesaMap[n]) defesa++;
      if (s.includes("solicitacao") || s.includes("solicitação")) emAberto++;
      if (s.includes("confirmado")) confirmado++;
      if (semRecursoMap[n]) semRecurso++;
      if (s.includes("arquivado")) arquivado++;
    }

    return { defesa, emAberto, confirmado, semRecurso, arquivado };
  }, [acics, defesaMap, semRecursoMap]);

  const getStatusColor = (status?: string) => {
    if (!status) return "bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200";
    const s = status.toLowerCase();
    if (s.includes("confirmado")) {
      return "bg-orange-100 text-orange-900 dark:bg-orange-950/50 dark:text-orange-200 border-orange-300 dark:border-orange-700";
    }
    if (s.includes("solicitacao") || s.includes("solicitação")) {
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800";
    }
    if (s.includes("autuado")) {
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800";
    }
    if (s.includes("arquivado")) {
      return "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/35 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700";
    }
    if (s.includes("cancelado")) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    return "bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200";
  };

  return (
    <MainLayout>
      <div className="space-y-8">
        <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-red-700 via-red-800 to-rose-950 p-8 shadow-xl shadow-red-950/40 dark:bg-linear-to-br dark:from-red-900 dark:via-rose-950 dark:to-red-950 dark:shadow-2xl dark:shadow-black/50">
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
            <div
              className="flex h-22 w-22 shrink-0 items-center justify-center rounded-2xl bg-red-950 shadow-lg dark:bg-red-950"
              aria-hidden
            >
              <FileWarning className="h-11 w-11 text-white" strokeWidth={1.5} />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-4xl font-bold tracking-tight text-white">Histórico de ACICs</h1>
              <p className="mt-3 max-w-2xl text-lg text-rose-50/95">
                Autos de Constatação de Irregularidade da Contratada — acompanhamento de defesa, recurso e status no FLIP 
              </p>
            </div>
          </div>
        </div>

        {/* Total de multas (padrão BR) */}
        <Card className="border-l-4 border-l-red-500 bg-red-50/50 dark:bg-red-950/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total de multas (filtro atual)</p>
                <p className="text-3xl font-bold text-red-700 dark:text-red-400 mt-1">{formatBr(totalMultas)}</p>
              </div>
              <DollarSign className="w-12 h-12 text-red-400/50" />
            </div>
          </CardContent>
        </Card>

        {/* Cards de estatísticas por tipo de registro */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <Card
            className={`cursor-pointer transition-all hover:shadow-md border-l-4 ${
              filters.registro === "todos" ? "border-l-primary ring-2 ring-primary/20" : "border-l-muted"
            }`}
            onClick={() => setFilters({ ...filters, registro: "todos" })}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Archive className="w-4 h-4" /> Todos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{total}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {periodRange?.from && periodRange?.to ? "ACICs únicos no período" : "ACICs únicos (todos os períodos)"}
              </p>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all hover:shadow-md border-l-4 ${
              filters.registro === "arquivado" ? "border-l-emerald-500 ring-2 ring-emerald-500/25" : "border-l-muted"
            }`}
            onClick={() => setFilters({ ...filters, registro: "arquivado" })}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Processo arquivado
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.arquivado}</div>
              <p className="text-xs text-muted-foreground mt-1">Multa não aplicada / encerrado</p>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all hover:shadow-md border-l-4 ${
              filters.registro === "defesa" ? "border-l-emerald-500 ring-2 ring-emerald-500/20" : "border-l-muted"
            }`}
            onClick={() => setFilters({ ...filters, registro: "defesa" })}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" /> Defesa
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.defesa}</div>
              <p className="text-xs text-muted-foreground mt-1">Apresentamos defesa</p>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all hover:shadow-md border-l-4 ${
              filters.registro === "em_aberto" ? "border-l-amber-500 ring-2 ring-amber-500/20" : "border-l-muted"
            }`}
            onClick={() => setFilters({ ...filters, registro: "em_aberto" })}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Clock className="w-4 h-4" /> Em aberto
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.emAberto}</div>
              <p className="text-xs text-muted-foreground mt-1">Solicitação</p>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all hover:shadow-md border-l-4 ${
              filters.registro === "confirmado" ? "border-l-orange-600 ring-2 ring-orange-500/25" : "border-l-muted"
            }`}
            onClick={() => setFilters({ ...filters, registro: "confirmado" })}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" /> Confirmado
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-700 dark:text-orange-400">{stats.confirmado}</div>
              <p className="text-xs text-muted-foreground mt-1">Multa homologada — avaliar recurso</p>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all hover:shadow-md border-l-4 ${
              filters.registro === "sem_recurso" ? "border-l-red-600 ring-2 ring-red-600/20" : "border-l-muted"
            }`}
            onClick={() => setFilters({ ...filters, registro: "sem_recurso" })}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Ban className="w-4 h-4" /> Sem Recurso
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.semRecurso}</div>
              <p className="text-xs text-muted-foreground mt-1">autuados</p>
            </CardContent>
          </Card>
        </div>

        {/* Filtros de período (mesmo DateRangePicker da IPT; sem D-1; padrão = todos os períodos) */}
        <Card className="overflow-hidden border-none shadow-sm bg-muted/30">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium">Período</CardTitle>
            <p className="text-sm font-normal text-muted-foreground">
              Sem datas selecionadas, lista todos os ACICs (import mais recente primeiro). Opcionalmente restrinja por intervalo.
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
              <div className="flex max-w-full min-w-0 shrink-0 items-center gap-2 rounded-lg bg-emerald-600 px-2.5 py-1.5 shadow-lg text-white">
                <Calendar className="h-4 w-4 shrink-0" aria-hidden />
                <DateRangePicker
                  value={periodRange}
                  onChange={(r) => {
                    if (!r?.from || !r?.to) {
                      setPeriodRange(undefined);
                      return;
                    }
                    setPeriodRange({ from: startOfDay(r.from), to: startOfDay(r.to) });
                  }}
                  maxDate={new Date()}
                  modeLabel={periodModeLabel}
                  emptyLabel="Todos os períodos"
                  className="max-w-[min(100vw-8rem,22rem)]"
                  footer={(close) => (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => {
                          const cap = clampDateNotFuture(new Date());
                          const { from, to } = getEsteMesRange(new Date(), cap);
                          setPeriodRange({ from, to });
                          close();
                        }}
                      >
                        Este mês
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => {
                          setPeriodRange(undefined);
                          close();
                        }}
                      >
                        Todos os períodos
                      </Button>
                    </>
                  )}
                />
              </div>
              <div className="min-w-[min(100%,220px)] flex-1 space-y-1">
                <Label className="text-xs text-muted-foreground">Filtro por registro</Label>
                <Select
                  value={filters.registro}
                  onValueChange={(value: FiltroRegistro) => setFilters({ ...filters, registro: value })}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="arquivado">Processo arquivado</SelectItem>
                    <SelectItem value="defesa">Defesa apresentada</SelectItem>
                    <SelectItem value="em_aberto">Em aberto (solicitação)</SelectItem>
                    <SelectItem value="confirmado">Confirmado (multa homologada)</SelectItem>
                    <SelectItem value="sem_recurso">Sem recurso</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Lista de ACICs */}
        {loading ? (
          <div className="p-12 text-center text-muted-foreground animate-pulse">Carregando...</div>
        ) : acicsFiltered.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-2">
            <Archive className="w-12 h-12 text-muted-foreground/50" />
            <p>Nenhuma ACIC encontrada com os filtros atuais</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {acicsFiltered.map((acic) => {
              const nAcic = getAcicField(acic, "N_ACIC", "n_acic") ?? "N/A";
              const nBfs = getAcicField(acic, "N_BFS", "n_bfs");
              const nCnc = getAcicField(acic, "N_CNC", "n_cnc");
              const status = getAcicByCanonical(acic, "status") ?? getAcicField(acic, "Status", "status");
              const valor = getValorForAcic(acic, nAcic);
              const temDefesa = defesaMap[nAcic];
              const temSemRecurso = semRecursoMap[nAcic];
              const endereco = getAcicField(acic, "Endereco", "endereco");
              const servico = getAcicField(acic, "Servico", "servico");
              const area = getAcicField(acic, "Area", "area");
              const agente = getAcicField(acic, "Agente_Fiscalizador", "agente_fiscalizador");
              const dataAcic = getAcicField(acic, "Data_ACIC", "data_acic");
              const descricao = getAcicField(acic, "Descricao", "descricao");
              const stLower = (status ?? "").toLowerCase();
              const isConfirmadoRow = stLower.includes("confirmado");
              const isArquivadoRow = stLower.includes("arquivado");

              return (
                <Card
                  key={acic.id}
                  className={`hover:shadow-md transition-all duration-200 ${
                    isConfirmadoRow
                      ? "border-l-4 border-l-orange-500 hover:border-orange-400/90 dark:hover:border-orange-600"
                      : isArquivadoRow
                        ? "border-l-4 border-l-emerald-500 hover:border-emerald-400/90 dark:hover:border-emerald-600"
                        : "hover:border-red-200/60 dark:hover:border-red-900/45"
                  }`}
                >
                  <CardContent className="p-6">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                          <h3 className="text-lg font-bold font-mono text-primary">ACIC: {nAcic}</h3>
                          {status && (
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-full border ${getStatusColor(status)}`}
                            >
                              {isConfirmadoRow ? (
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              ) : isArquivadoRow ? (
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              ) : null}
                              {status}
                            </span>
                          )}
                          {temDefesa && (
                            <span className="px-2.5 py-0.5 text-xs font-medium rounded-full border bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800">
                              Defesa
                            </span>
                          )}
                          {temSemRecurso && (
                            <span className="px-2.5 py-0.5 text-xs font-medium rounded-full border bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800">
                              Sem Recurso
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                          {nBfs && (
                            <span className="flex items-center gap-1 bg-muted/50 px-2 py-0.5 rounded">
                              <span className="font-medium">BFS:</span> {nBfs}
                            </span>
                          )}
                          {nCnc && (
                            <span className="flex items-center gap-1 bg-muted/50 px-2 py-0.5 rounded">
                              <span className="font-medium">CNC:</span> {nCnc}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => toggleDefesa(nAcic)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                            temDefesa
                              ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700"
                              : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                          }`}
                        >
                          {temDefesa ? "✓ Defesa" : "+ Marcar defesa"}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleSemRecurso(nAcic)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                            temSemRecurso
                              ? "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700"
                              : "bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:border-red-300"
                          }`}
                        >
                          {temSemRecurso ? "✓ Sem Recurso" : "+ Sem Recurso"}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                      {endereco && (
                        <div className="md:col-span-2 flex items-start gap-2 text-muted-foreground mb-2">
                          <span className="shrink-0">📍</span>
                          <span>{endereco}</span>
                        </div>
                      )}
                      {servico && (
                        <div className="flex justify-between border-b border-dashed border-border/50 py-1">
                          <span className="text-muted-foreground">Serviço:</span>
                          <span className="font-medium text-right">{servico}</span>
                        </div>
                      )}
                      {area && (
                        <div className="flex justify-between border-b border-dashed border-border/50 py-1">
                          <span className="text-muted-foreground">Área:</span>
                          <span className="font-medium text-right">{area}</span>
                        </div>
                      )}
                      {agente && (
                        <div className="flex justify-between border-b border-dashed border-border/50 py-1">
                          <span className="text-muted-foreground">Fiscal:</span>
                          <span className="font-medium text-right">{agente}</span>
                        </div>
                      )}
                      <div className="flex flex-col gap-1 md:col-span-2">
                        <label className="text-xs font-medium text-muted-foreground">Valor da multa</label>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0,00"
                          value={valor > 0 ? formatBr(valor) : ""}
                          onChange={(e) => {
                            const n = parseBrInput(e.target.value);
                            setValorForAcic(nAcic, n);
                          }}
                          className="bg-background max-w-[180px] font-mono font-bold text-red-600 dark:text-red-400"
                        />
                      </div>
                      {dataAcic && (
                        <div className="flex justify-between border-b border-dashed border-border/50 py-1">
                          <span className="text-muted-foreground">Data:</span>
                          <span className="font-medium text-right">
                            {formatAcicDate(dataAcic)}
                          </span>
                        </div>
                      )}
                    </div>

                    {descricao && (
                      <div className="mt-4 p-3 bg-muted/30 rounded-md text-xs border border-border/50">
                        <p className="font-medium mb-1 text-muted-foreground uppercase tracking-wider text-[10px]">Descrição</p>
                        <p className="text-foreground whitespace-pre-wrap leading-relaxed">{descricao}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </MainLayout>
  );
}
