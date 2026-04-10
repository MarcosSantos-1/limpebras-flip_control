"use client";

import { useState, useEffect, useMemo } from "react";
import type { DateRange } from "react-day-picker";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AcicEntendimentoDialog,
  AcicMotivoPenalidadeDialog,
  AcicValorMultaDialog,
  ClausulaMultaPersistDisplay,
} from "@/app/acic/acic-dialogs";
import { apiService } from "@/lib/api";
import { format, isValid, startOfDay } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  CalendarDays,
  MapPin,
  MapMinus,
  ClipboardList,
  User,
  Hash,
  Link2,
  Layers,
  Coins,
  AlertTriangle,
  CheckCircle2,
  MessageSquare,
  Pencil,
  Calculator,
  CircleDollarSign,
  Gavel,
} from "lucide-react";

/** Formata número no padrão BR: R$ 1.234,56 */
function formatBr(valor: number): string {
  if (valor <= 0 || isNaN(valor)) return "R$ 0,00";
  const [int, dec] = valor.toFixed(2).split(".");
  const intFormatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${intFormatted},${dec}`;
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

/** Valor homologado / importado (CSV) ou ajuste manual não-estimativa — campo "Valor da multa". */
function getValorMultaOficial(
  acic: Record<string, unknown>,
  nAcic: string,
  valorOficialMap: Record<string, number>
): number {
  const csv = getValorMultaDoCsv(acic);
  if (csv > 0) return csv;
  if (Object.prototype.hasOwnProperty.call(valorOficialMap, nAcic)) {
    return valorOficialMap[nAcic] ?? 0;
  }
  return 0;
}

/** Estimativa manual (campo amarelo); some no total geral; não aparece em ACIC confirmada (valor homologado vem do CSV). */
function getValorEstimativaAtiva(
  acic: Record<string, unknown>,
  nAcic: string,
  valorEstimativaMap: Record<string, number>,
  estimativaMap: Record<string, boolean>
): number {
  if (acicStatusLower(acic).includes("confirmado")) return 0;
  if (!estimativaMap[nAcic]) return 0;
  return valorEstimativaMap[nAcic] ?? 0;
}

/** Mesmas cores de subprefeitura da página Defesa / IPT. */
const ACIC_AREA_SUB_BADGES: Record<string, { sigla: string; className: string }> = {
  "Santana/Tucuruvi": {
    sigla: "ST",
    className:
      "bg-yellow-500/20 text-yellow-800 dark:bg-yellow-500/25 dark:text-yellow-200 border border-yellow-400/50",
  },
  "Casa Verde/Cachoeirinha": {
    sigla: "CV",
    className:
      "bg-green-500/20 text-green-800 dark:bg-green-500/25 dark:text-green-200 border border-green-400/50",
  },
  "Jaçanã/Tremembé": {
    sigla: "JT",
    className:
      "bg-blue-800/20 text-blue-900 dark:bg-blue-800/30 dark:text-blue-200 border border-blue-700/50",
  },
  "Vila Maria/Vila Guilherme": {
    sigla: "MG",
    className: "bg-cyan-500/20 text-cyan-800 dark:bg-cyan-500/25 dark:text-cyan-200 border border-cyan-400/50",
  },
};

function getAcicAreaSubBadge(area: string | undefined): { sigla: string; className: string } {
  const t = (area ?? "").trim();
  if (!t) return { sigla: "—", className: "bg-muted/70 text-muted-foreground border border-border" };
  const exact = ACIC_AREA_SUB_BADGES[t];
  if (exact) return exact;
  const norm = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const [key, val] of Object.entries(ACIC_AREA_SUB_BADGES)) {
    const kn = key.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (norm.includes(kn) || kn.includes(norm)) return val;
  }
  return { sigla: t.slice(0, 2).toUpperCase(), className: "bg-muted/70 text-muted-foreground border border-border" };
}

const ACIC_SUBPREFEITURA_ORDER = [
  "Santana/Tucuruvi",
  "Casa Verde/Cachoeirinha",
  "Jaçanã/Tremembé",
  "Vila Maria/Vila Guilherme",
] as const;

function acicAreaMatchesSubFilter(area: string | undefined, subKey: string): boolean {
  if (subKey === "todas") return true;
  const target = ACIC_AREA_SUB_BADGES[subKey];
  if (!target) return true;
  return getAcicAreaSubBadge(area).sigla === target.sigla;
}

function flipDateSortMs(s: string | undefined): number {
  if (!s?.trim()) return 0;
  const m = s
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!m) return 0;
  return new Date(
    Number(m[3]),
    Number(m[2]) - 1,
    Number(m[1]),
    m[4] ? Number(m[4]) : 0,
    m[5] ? Number(m[5]) : 0,
    m[6] ? Number(m[6]) : 0
  ).getTime();
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
  const [valorOficialMap, setValorOficialMap] = useState<Record<string, number>>({});
  const [valorEstimativaMap, setValorEstimativaMap] = useState<Record<string, number>>({});
  const [entendimentoMap, setEntendimentoMap] = useState<Record<string, string>>({});
  const [motivoPenalidadeMap, setMotivoPenalidadeMap] = useState<Record<string, string>>({});
  const [clausulaMap, setClausulaMap] = useState<Record<string, string>>({});
  const [estimativaMap, setEstimativaMap] = useState<Record<string, boolean>>({});
  const [entModalNAcic, setEntModalNAcic] = useState<string | null>(null);
  const [motivoModalNAcic, setMotivoModalNAcic] = useState<string | null>(null);
  const [valorModalCtx, setValorModalCtx] = useState<{
    nAcic: string;
    valorAtOpen: number;
    isSolicitacao: boolean;
    clausulaAtOpen: string | null;
    estimativaAtOpen: boolean;
  } | null>(null);
  const [periodRange, setPeriodRange] = useState<DateRange | undefined>(undefined);
  const [filters, setFilters] = useState({
    registro: "todos" as FiltroRegistro,
    subprefeitura: "todas",
    somenteBfsMultipla: false,
    somenteSemClausula: false,
    somenteSemValor: false,
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
      const valorOficial: Record<string, number> = {};
      const valorEstimativa: Record<string, number> = {};
      const entendimento: Record<string, string> = {};
      const motivo: Record<string, string> = {};
      const clausulas: Record<string, string> = {};
      const est: Record<string, boolean> = {};
      for (const a of items) {
        const n = getAcicField(a, "N_ACIC", "n_acic") ?? "";
        if (n) {
          const st = acicStatusLower(a);
          const confirmado = st.includes("confirmado");
          defesa[n] = Boolean((a as { _defesa?: boolean })._defesa);
          semRecurso[n] = Boolean((a as { _sem_recurso?: boolean })._sem_recurso);
          const v = (a as { _valor_override?: number | null })._valor_override;
          if (v != null && Number(v) > 0) valorOficial[n] = Number(v);
          const ve = (a as { _valor_estimativa_override?: number | null })._valor_estimativa_override;
          if (!confirmado && ve != null && Number(ve) > 0) valorEstimativa[n] = Number(ve);
          if (!confirmado && Boolean((a as { _multa_valor_estimativa?: boolean })._multa_valor_estimativa)) {
            est[n] = true;
          }
          const ent = (a as { _entendimento_defesa_previa?: string | null })._entendimento_defesa_previa;
          if (ent != null && String(ent).length > 0) entendimento[n] = String(ent);
          const mot = (a as { _motivo_penalidade?: string | null })._motivo_penalidade;
          if (mot != null && String(mot).trim()) motivo[n] = String(mot);
          const cl = (a as { _multa_clausula_texto?: string | null })._multa_clausula_texto;
          if (cl != null && String(cl).trim()) clausulas[n] = String(cl);
        }
      }
      setDefesaMap(defesa);
      setSemRecursoMap(semRecurso);
      setValorOficialMap(valorOficial);
      setValorEstimativaMap(valorEstimativa);
      setEntendimentoMap(entendimento);
      setMotivoPenalidadeMap(motivo);
      setClausulaMap(clausulas);
      setEstimativaMap(est);
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

  const persistEntendimentoDefesaPrevia = async (nAcic: string, value: string) => {
    const trimmed = value.trim();
    setEntendimentoMap((prev) => {
      const next = { ...prev };
      if (trimmed === "") delete next[nAcic];
      else next[nAcic] = value;
      return next;
    });
    try {
      await apiService.updateACICOverride(nAcic, {
        entendimento_defesa_previa: trimmed === "" ? null : value,
      });
    } catch (e) {
      console.error("Erro ao salvar entendimento para defesa prévia:", e);
      await loadACICs();
    }
  };

  const persistMotivoPenalidade = async (nAcic: string, value: string) => {
    const trimmed = value.trim();
    setMotivoPenalidadeMap((prev) => {
      const next = { ...prev };
      if (trimmed === "") delete next[nAcic];
      else next[nAcic] = value;
      return next;
    });
    try {
      await apiService.updateACICOverride(nAcic, {
        motivo_penalidade: trimmed === "" ? null : value,
      });
    } catch (e) {
      console.error("Erro ao salvar motivo da penalidade:", e);
      await loadACICs();
    }
  };

  const saveMultaFromModal = async (
    nAcic: string,
    payload: { valor: number; clausulaTexto: string | null; estimativa: boolean }
  ) => {
    if (payload.valor <= 0) return;
    setClausulaMap((prev) => {
      const next = { ...prev };
      if (payload.clausulaTexto?.trim()) next[nAcic] = payload.clausulaTexto.trim();
      else delete next[nAcic];
      return next;
    });
    if (payload.estimativa) {
      setValorEstimativaMap((prev) => ({ ...prev, [nAcic]: payload.valor }));
      setValorOficialMap((prev) => {
        const next = { ...prev };
        delete next[nAcic];
        return next;
      });
      setEstimativaMap((prev) => ({ ...prev, [nAcic]: true }));
      try {
        await apiService.updateACICOverride(nAcic, {
          valor: null,
          valor_estimativa: payload.valor,
          multa_clausula_texto: payload.clausulaTexto?.trim() ? payload.clausulaTexto.trim() : null,
          multa_valor_estimativa: true,
        });
      } catch (e) {
        console.error("Erro ao salvar valor/cláusula:", e);
        await loadACICs();
      }
    } else {
      setValorOficialMap((prev) => ({ ...prev, [nAcic]: payload.valor }));
      setValorEstimativaMap((prev) => {
        const next = { ...prev };
        delete next[nAcic];
        return next;
      });
      setEstimativaMap((prev) => {
        const next = { ...prev };
        delete next[nAcic];
        return next;
      });
      try {
        await apiService.updateACICOverride(nAcic, {
          valor: payload.valor,
          valor_estimativa: null,
          multa_clausula_texto: payload.clausulaTexto?.trim() ? payload.clausulaTexto.trim() : null,
          multa_valor_estimativa: false,
        });
      } catch (e) {
        console.error("Erro ao salvar valor/cláusula:", e);
        await loadACICs();
      }
    }
  };

  const clearMultaOverride = async (nAcic: string) => {
    setValorOficialMap((prev) => {
      const next = { ...prev };
      delete next[nAcic];
      return next;
    });
    setValorEstimativaMap((prev) => {
      const next = { ...prev };
      delete next[nAcic];
      return next;
    });
    setClausulaMap((prev) => {
      const next = { ...prev };
      delete next[nAcic];
      return next;
    });
    setEstimativaMap((prev) => {
      const next = { ...prev };
      delete next[nAcic];
      return next;
    });
    try {
      await apiService.updateACICOverride(nAcic, {
        valor: null,
        valor_estimativa: null,
        multa_clausula_texto: null,
        multa_valor_estimativa: false,
      });
    } catch (e) {
      console.error("Erro ao limpar multa:", e);
      await loadACICs();
    }
  };

  const acicsBaseFiltered = useMemo(() => {
    return acics.filter((acic) => {
      const nAcic = getAcicField(acic, "N_ACIC", "n_acic") ?? "";
      const status = acicStatusLower(acic);
      const temDefesa = defesaMap[nAcic];
      const temSemRecurso = semRecursoMap[nAcic];
      const emAberto = status.includes("solicitacao") || status.includes("solicitação");
      const arquivado = status.includes("arquivado");
      const confirmado = status.includes("confirmado");

      let ok = false;
      switch (filters.registro) {
        case "defesa":
          ok = temDefesa;
          break;
        case "em_aberto":
          ok = emAberto;
          break;
        case "confirmado":
          ok = confirmado;
          break;
        case "sem_recurso":
          ok = temSemRecurso;
          break;
        case "arquivado":
          ok = arquivado;
          break;
        default:
          ok = true;
      }
      if (!ok) return false;
      if (!acicAreaMatchesSubFilter(getAcicField(acic, "Area", "area"), filters.subprefeitura)) return false;
      if (filters.somenteSemClausula || filters.somenteSemValor) {
        if (arquivado) return false;
      }
      if (filters.somenteSemClausula) {
        const cl = clausulaMap[nAcic]?.trim();
        if (cl) return false;
      }
      if (filters.somenteSemValor) {
        const vo = getValorMultaOficial(acic, nAcic, valorOficialMap);
        const ve = getValorEstimativaAtiva(acic, nAcic, valorEstimativaMap, estimativaMap);
        if (vo > 0 || ve > 0) return false;
      }
      return true;
    });
  }, [
    acics,
    filters.registro,
    filters.subprefeitura,
    filters.somenteSemClausula,
    filters.somenteSemValor,
    defesaMap,
    semRecursoMap,
    clausulaMap,
    valorOficialMap,
    valorEstimativaMap,
    estimativaMap,
  ]);

  const bfsAcicCountInBase = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of acicsBaseFiltered) {
      const b = getAcicField(a, "N_BFS", "n_bfs")?.trim();
      if (b) m.set(b, (m.get(b) ?? 0) + 1);
    }
    return m;
  }, [acicsBaseFiltered]);

  const acicsFiltered = useMemo(() => {
    if (!filters.somenteBfsMultipla) return acicsBaseFiltered;
    return acicsBaseFiltered.filter((a) => {
      const b = getAcicField(a, "N_BFS", "n_bfs")?.trim();
      return Boolean(b && (bfsAcicCountInBase.get(b) ?? 0) > 1);
    });
  }, [acicsBaseFiltered, filters.somenteBfsMultipla, bfsAcicCountInBase]);

  const bfsAcicCountInView = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of acicsFiltered) {
      const b = getAcicField(a, "N_BFS", "n_bfs")?.trim();
      if (b) m.set(b, (m.get(b) ?? 0) + 1);
    }
    return m;
  }, [acicsFiltered]);

  /** Mais recentes primeiro (Data_ACIC), depois id estável. */
  const acicsDisplay = useMemo(() => {
    return [...acicsFiltered].sort((a, b) => {
      const db = flipDateSortMs(getAcicField(b, "Data_ACIC", "data_acic"));
      const da = flipDateSortMs(getAcicField(a, "Data_ACIC", "data_acic"));
      if (db !== da) return db - da;
      return String(b.id).localeCompare(String(a.id), undefined, { numeric: true });
    });
  }, [acicsFiltered]);

  const totalMultasComEstimativa = useMemo(() => {
    return acicsFiltered.reduce((sum, acic) => {
      const nAcic = getAcicField(acic, "N_ACIC", "n_acic") ?? "";
      const oficial = getValorMultaOficial(acic, nAcic, valorOficialMap);
      const est = getValorEstimativaAtiva(acic, nAcic, valorEstimativaMap, estimativaMap);
      return sum + oficial + est;
    }, 0);
  }, [acicsFiltered, valorOficialMap, valorEstimativaMap, estimativaMap]);

  const totalMultasConfirmadas = useMemo(() => {
    return acicsFiltered.reduce((sum, acic) => {
      if (!acicStatusLower(acic).includes("confirmado")) return sum;
      const nAcic = getAcicField(acic, "N_ACIC", "n_acic") ?? "";
      return sum + getValorMultaOficial(acic, nAcic, valorOficialMap);
    }, 0);
  }, [acicsFiltered, valorOficialMap]);

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
                Autos de Constatação de Irregularidade da Contratada 
                <br />
                Acompanhamento de defesa, recurso e status no FLIP.
              </p>
            </div>
          </div>
        </div>

        {/* Totais de multa: homologado + estimativas vs só confirmadas homologadas */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-l-4 border-l-red-500 bg-red-50/50 dark:bg-red-950/20">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Total de multas + estimativas (filtro atual)
                  </p>
                  <p className="text-3xl font-bold text-red-700 dark:text-red-400 mt-1">
                    {formatBr(totalMultasComEstimativa)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Soma do valor da multa e dos valores estimativos em aberto.
                  </p>
                </div>
                <DollarSign className="w-12 h-12 shrink-0 text-red-400/50" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-orange-500 bg-orange-50/50 dark:bg-orange-950/20">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Multas confirmadas (homologadas)
                  </p>
                  <p className="text-3xl font-bold text-orange-700 dark:text-orange-400 mt-1">
                    {formatBr(totalMultasConfirmadas)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Apenas ACICs em status Confirmado (sem estimativa manual).
                  </p>
                </div>
                <CircleDollarSign className="w-12 h-12 shrink-0 text-orange-400/60" />
              </div>
            </CardContent>
          </Card>
        </div>

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
              Sem período, lista todos os ACICs. A lista segue da <strong className="font-medium text-foreground">data da ACIC mais recente</strong> para a mais antiga. Use subprefeitura e BFS com várias ACICs para refinar.
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
              <div className="min-w-0 shrink-0">
                <div className="inline-flex max-w-full items-center gap-2 rounded-lg bg-emerald-600 px-2.5 py-1.5 shadow-lg text-white">
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
                    className="max-w-[min(100vw-8rem,22rem)] w-[min(100%,22rem)]"
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
              </div>

              <div className="flex min-w-0 w-full flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-end lg:flex-1">
                <div className="min-w-0 space-y-1 sm:w-[min(100%,17rem)]">
                  <Label className="text-xs text-muted-foreground">Registro</Label>
                  <Select
                    value={filters.registro}
                    onValueChange={(value: FiltroRegistro) => setFilters({ ...filters, registro: value })}
                  >
                    <SelectTrigger className="bg-background w-full">
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
                <div className="min-w-0 space-y-1 sm:w-[min(100%,70%)] sm:max-w-[17.5rem]">
                  <Label className="text-xs text-muted-foreground">Subprefeitura</Label>
                  <Select
                    value={filters.subprefeitura}
                    onValueChange={(value) => setFilters({ ...filters, subprefeitura: value })}
                  >
                    <SelectTrigger className="bg-background w-full">
                      <SelectValue placeholder="Todas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todas">Todas as subs</SelectItem>
                      {ACIC_SUBPREFEITURA_ORDER.map((sub) => (
                        <SelectItem key={sub} value={sub}>
                          {sub}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-3 border-t border-border/50 pt-4 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="acic-only-multi-bfs"
                  checked={filters.somenteBfsMultipla}
                  onCheckedChange={(c) => setFilters({ ...filters, somenteBfsMultipla: c === true })}
                />
                <Label htmlFor="acic-only-multi-bfs" className="cursor-pointer text-sm font-normal leading-snug">
                  Só BFS com mais de uma ACIC (no filtro atual)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="acic-sem-clausula"
                  checked={filters.somenteSemClausula}
                  onCheckedChange={(c) => setFilters({ ...filters, somenteSemClausula: c === true })}
                />
                <Label htmlFor="acic-sem-clausula" className="cursor-pointer text-sm font-normal leading-snug">
                  Só ACICs sem cláusula (multa) adicionada;
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="acic-sem-valor"
                  checked={filters.somenteSemValor}
                  onCheckedChange={(c) => setFilters({ ...filters, somenteSemValor: c === true })}
                />
                <Label htmlFor="acic-sem-valor" className="cursor-pointer text-sm font-normal leading-snug">
                  Só ACICs sem valor (arquivadas ou estimativa);
                </Label>
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
            {acicsDisplay.map((acic) => {
              const nAcic = getAcicField(acic, "N_ACIC", "n_acic") ?? "N/A";
              const nBfs = getAcicField(acic, "N_BFS", "n_bfs")?.trim() ?? "";
              const nCnc = getAcicField(acic, "N_CNC", "n_cnc");
              const status = getAcicByCanonical(acic, "status") ?? getAcicField(acic, "Status", "status");
              const valorOficial = getValorMultaOficial(acic, nAcic, valorOficialMap);
              const valorEstimativaLinha = getValorEstimativaAtiva(
                acic,
                nAcic,
                valorEstimativaMap,
                estimativaMap
              );
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
              const isSolicitacaoRow =
                stLower.includes("solicitacao") || stLower.includes("solicitação");
              const bfsGroupSize = nBfs ? (bfsAcicCountInView.get(nBfs) ?? 0) : 0;
              const multiBfs = bfsGroupSize > 1;
              const areaBadge = getAcicAreaSubBadge(area);

              return (
                <Card
                  key={acic.id}
                  className={`hover:shadow-md transition-all duration-200 ${
                    isConfirmadoRow
                      ? "border-l-4 border-l-orange-500 hover:border-orange-400/90 dark:hover:border-orange-600"
                      : isArquivadoRow
                        ? "border-l-4 border-l-emerald-500 hover:border-emerald-400/90 dark:hover:border-emerald-600"
                        : "hover:border-red-200/60 dark:hover:border-red-900/45"
                  } ${multiBfs ? "ring-1 ring-amber-500/35 bg-amber-500/4 dark:bg-amber-950/20" : ""}`}
                >
                  <CardContent className="p-6">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                          <h3 className="text-lg font-bold font-mono text-primary inline-flex items-center gap-2">
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-sm">ACIC</span>
                            {nAcic}
                          </h3>
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
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-full border bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800">
                              <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden />
                              Defesa
                            </span>
                          )}
                          {temSemRecurso && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-full border bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800">
                              <Ban className="h-3 w-3 shrink-0" aria-hidden />
                              Sem recurso
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2 text-sm">
                          {nBfs ? (
                            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/35 px-2.5 py-1.5">
                              <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">BFS</span>
                              <span className="font-mono font-semibold text-foreground">{nBfs}</span>
                              {multiBfs ? (
                                <span
                                  className="ml-0.5 inline-flex items-center gap-1 rounded-md border border-amber-500/55 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-950 dark:text-amber-100"
                                  title="Esta BFS aparece mais de uma vez no filtro atual — várias ACICs no mesmo BFS"
                                >
                                  <Layers className="h-3 w-3 shrink-0" aria-hidden />
                                  {bfsGroupSize} ACICs
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                          {nCnc ? (
                            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/35 px-2.5 py-1.5">
                              <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">CNC</span>
                              <span className="font-mono font-semibold text-foreground">{nCnc}</span>
                            </span>
                          ) : null}
                        </div>

                        {dataAcic || (area ?? "").trim() ? (
                          <div className="mt-2 flex flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
                              {dataAcic ? (
                                <>
                                  <CalendarDays className="h-4 w-4 shrink-0 text-primary/65" aria-hidden />
                                  <span className="text-lg py-2 font-semibold">Data:</span>
                                  <span className="text-lg text-foreground">{formatAcicDate(dataAcic)}</span>
                                </>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 flex-col items-end sm:ml-auto">
                              <div className="flex items-center gap-2">
                                <MapMinus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                  Subprefeitura
                                </p>
                              </div>
                              <div className="mt-0.5 flex flex-wrap justify-end gap-2">
                                {(area ?? "").trim() ? (
                                  <span
                                    className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold ${areaBadge.className}`}
                                  >
                                    <span className="font-mono text-[10px] opacity-80">{areaBadge.sigla}</span>
                                    {area}
                                  </span>
                                ) : (
                                  <span className="text-sm text-muted-foreground">Não informado</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                      {isArquivadoRow ? (
                        <div className="shrink-0 max-w-44 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-center text-[11px] font-medium text-emerald-900 dark:text-emerald-200">
                          Processo arquivado
                        </div>
                      ) : isSolicitacaoRow ? (
                        <div className="shrink-0 max-w-44 rounded-lg border border-amber-500/45 bg-amber-500/10 px-3 py-2 text-center text-[11px] font-medium text-amber-950 dark:text-amber-100">
                          Em solicitação
                        </div>
                      ) : (
                        <div className="shrink-0 flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => toggleDefesa(nAcic)}
                            className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                              temDefesa
                                ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700"
                                : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                            }`}
                          >
                            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                            {temDefesa ? "Defesa" : "+ Defesa"}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleSemRecurso(nAcic)}
                            className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                              temSemRecurso
                                ? "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700"
                                : "bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:border-red-300"
                            }`}
                          >
                            <Ban className="h-3.5 w-3.5" aria-hidden />
                            {temSemRecurso ? "Sem recurso" : "+ Sem recurso"}
                          </button>
                        </div>
                      )}
                    </div>

                    {endereco?.trim() ? (
                      <div className="mt-3">
                        <div className="flex min-h-11 items-start gap-2.5 rounded-lg border border-border/60 bg-muted/25 px-3 py-2.5 text-sm">
                          <MapPin className="h-4 w-4 shrink-0 mt-0.5 text-red-500/85" aria-hidden />
                          <span className="min-w-0 leading-snug text-foreground">{endereco}</span>
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 grid grid-cols-1 gap-6 border-t border-border/40 pt-4 text-sm lg:grid-cols-2 lg:gap-8">
                      <div className="min-w-0 space-y-3">
                        {servico ? (
                          <div className="flex items-start gap-2">
                            <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" aria-hidden />
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Serviço</p>
                              <p className="font-medium leading-snug">{servico}</p>
                            </div>
                          </div>
                        ) : null}
                        {agente ? (
                          <div className="flex items-start gap-2">
                            <User className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" aria-hidden />
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Agente fiscalizador</p>
                              <p className="font-medium leading-snug">{agente}</p>
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div className="min-w-0 space-y-6 border-border/40 lg:border-l lg:pl-8">
                        <div className="flex items-start gap-2">
                          <Gavel className="h-4 w-4 shrink-0 text-red-600/90 dark:text-red-400 mt-1" aria-hidden />
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <Label className="text-[10px] font-bold uppercase tracking-wide text-red-800 dark:text-red-300">
                                Motivo da penalidade
                              </Label>
                              {!isArquivadoRow && (motivoPenalidadeMap[nAcic] ?? "").trim() ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 shrink-0 text-red-700 hover:bg-red-600/10 hover:text-red-800 dark:text-red-400"
                                  aria-label="Editar motivo da penalidade"
                                  onClick={() => setMotivoModalNAcic(nAcic)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              ) : null}
                            </div>
                            {!isArquivadoRow ? (
                              (motivoPenalidadeMap[nAcic] ?? "").trim() ? (
                                <div className="rounded-lg border-l-4 border-l-red-600 bg-red-50/95 px-4 py-3 text-sm font-medium leading-relaxed text-red-950 shadow-sm whitespace-pre-wrap dark:border-red-500 dark:bg-red-950/45 dark:text-red-50">
                                  {motivoPenalidadeMap[nAcic]}
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="w-full rounded-lg border-0 bg-red-600 px-4 py-3 text-left text-sm font-semibold text-white shadow-md transition-colors hover:bg-red-700"
                                  onClick={() => setMotivoModalNAcic(nAcic)}
                                >
                                  Registrar motivo da penalidade
                                </button>
                              )
                            ) : (motivoPenalidadeMap[nAcic] ?? "").trim() ? (
                              <p className="whitespace-pre-wrap rounded-md border border-red-200/60 bg-red-50/40 px-3 py-2 text-sm leading-relaxed text-foreground dark:border-red-900/40 dark:bg-red-950/25">
                                {motivoPenalidadeMap[nAcic]}
                              </p>
                            ) : (
                              <p className="text-sm italic text-muted-foreground">Sem registro (processo arquivado)</p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-start gap-2 border-t border-border/30 pt-6">
                          <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground mt-1" aria-hidden />
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <Label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                Entendimento para defesa prévia
                              </Label>
                              {!isArquivadoRow && (entendimentoMap[nAcic] ?? "").trim() ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 shrink-0 text-emerald-700 hover:bg-emerald-600/10 hover:text-emerald-800 dark:text-emerald-400"
                                  aria-label="Editar entendimento"
                                  onClick={() => setEntModalNAcic(nAcic)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              ) : null}
                            </div>
                            {!isArquivadoRow ? (
                              (entendimentoMap[nAcic] ?? "").trim() ? (
                                <div className="rounded-lg border-l-4 border-l-emerald-600 bg-emerald-50/95 px-4 py-3 text-sm font-medium leading-relaxed text-emerald-950 shadow-sm whitespace-pre-wrap dark:border-emerald-500 dark:bg-emerald-950/50 dark:text-emerald-50">
                                  {entendimentoMap[nAcic]}
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="w-full rounded-lg border-0 bg-emerald-600 px-4 py-3 text-left text-sm font-semibold text-white shadow-md transition-colors hover:bg-emerald-700"
                                  onClick={() => setEntModalNAcic(nAcic)}
                                >
                                  Registrar entendimento para defesa prévia
                                </button>
                              )
                            ) : (entendimentoMap[nAcic] ?? "").trim() ? (
                              <p className="whitespace-pre-wrap rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm leading-relaxed text-foreground">
                                {entendimentoMap[nAcic]}
                              </p>
                            ) : (
                              <p className="text-sm italic text-muted-foreground">Sem registro (processo arquivado)</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {!isArquivadoRow ? (
                      <div className="mt-4 flex items-start gap-2 border-t border-border/40 pt-3 text-sm">
                        <Coins className="h-4 w-4 shrink-0 mt-1" aria-hidden />
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-end gap-3">
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                Valor da multa
                              </label>
                              <Input
                                type="text"
                                readOnly
                                disabled
                                aria-readonly
                                value={valorOficial > 0 ? formatBr(valorOficial) : "—"}
                                className="max-w-[220px] cursor-not-allowed bg-muted/40 font-mono font-bold text-red-600 opacity-100 dark:text-red-400"
                              />
                              <p className="text-[10px] text-muted-foreground max-w-[240px] leading-snug">
                                Valor do FLIP/importação; em Confirmado vem do upload.
                              </p>
                            </div>
                            {valorEstimativaLinha > 0 ? (
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                                  Estimativa
                                </label>
                                <Input
                                  type="text"
                                  readOnly
                                  disabled
                                  aria-readonly
                                  value={formatBr(valorEstimativaLinha)}
                                  className="max-w-[220px] cursor-not-allowed border-amber-400/70 bg-amber-100 font-mono font-bold text-amber-950 opacity-100 dark:border-amber-600/60 dark:bg-amber-950/45 dark:text-amber-100"
                                />
                                <p className="text-[10px] text-amber-900/80 dark:text-amber-200/90 max-w-[240px] leading-snug">
                                  Entra no total geral; deixa de aparecer quando a ACIC fica Confirmada (valor homologado no FLIP).
                                </p>
                              </div>
                            ) : null}
                            <Button
                              type="button"
                              className="border-0 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 shrink-0"
                              onClick={() => {
                                const csv = getValorMultaDoCsv(acic);
                                const of = valorOficialMap[nAcic];
                                const ev = valorEstimativaMap[nAcic];
                                const isEst = estimativaMap[nAcic];
                                const openVal =
                                  isEst && ev != null && ev > 0
                                    ? ev
                                    : csv > 0
                                      ? csv
                                      : of != null && of > 0
                                        ? of
                                        : 0;
                                setValorModalCtx({
                                  nAcic,
                                  valorAtOpen: openVal,
                                  isSolicitacao: isSolicitacaoRow,
                                  clausulaAtOpen: clausulaMap[nAcic] ?? null,
                                  estimativaAtOpen: Boolean(isEst),
                                });
                              }}
                            >
                              <Calculator className="mr-2 h-4 w-4" aria-hidden />
                              Valor e cláusula
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {descricao ? (
                      <div className="mt-4 flex gap-2 rounded-lg border border-dashed border-border/70 bg-muted/20 p-3 text-xs">
                        <FileWarning className="h-4 w-4 shrink-0 text-amber-600/80 mt-0.5" aria-hidden />
                        <div className="min-w-0">
                          <p className="font-bold text-muted-foreground uppercase tracking-wider text-[10px] mb-1">Descrição</p>
                          <p className="text-foreground whitespace-pre-wrap leading-relaxed">{descricao}</p>
                        </div>
                      </div>
                    ) : null}

                    {clausulaMap[nAcic]?.trim() ? (
                      <div className="mt-3 rounded-lg border border-emerald-500/35 bg-emerald-500/[0.07] p-3 shadow-sm dark:border-emerald-600/40 dark:bg-emerald-950/25">
                        <div className="flex gap-2.5">
                          <ClipboardList
                            className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5"
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 mb-1.5">
                              Cláusula aplicável à multa
                            </p>
                            <ClausulaMultaPersistDisplay text={clausulaMap[nAcic]} />
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <AcicEntendimentoDialog
          open={entModalNAcic !== null}
          onOpenChange={(o) => {
            if (!o) setEntModalNAcic(null);
          }}
          initialText={entModalNAcic ? entendimentoMap[entModalNAcic] ?? "" : ""}
          onSave={async (text) => {
            if (!entModalNAcic) return;
            await persistEntendimentoDefesaPrevia(entModalNAcic, text);
          }}
        />

        <AcicMotivoPenalidadeDialog
          open={motivoModalNAcic !== null}
          onOpenChange={(o) => {
            if (!o) setMotivoModalNAcic(null);
          }}
          initialText={motivoModalNAcic ? motivoPenalidadeMap[motivoModalNAcic] ?? "" : ""}
          onSave={async (text) => {
            if (!motivoModalNAcic) return;
            await persistMotivoPenalidade(motivoModalNAcic, text);
          }}
        />

        <AcicValorMultaDialog
          open={valorModalCtx !== null}
          onOpenChange={(o) => {
            if (!o) setValorModalCtx(null);
          }}
          initialValorBr={
            valorModalCtx && valorModalCtx.valorAtOpen > 0 ? formatBr(valorModalCtx.valorAtOpen) : ""
          }
          initialEstimativa={valorModalCtx ? valorModalCtx.estimativaAtOpen : false}
          suggestEstimativa={valorModalCtx?.isSolicitacao ?? false}
          hasSavedMulta={
            valorModalCtx
              ? valorModalCtx.valorAtOpen > 0 || Boolean(valorModalCtx.clausulaAtOpen?.trim())
              : false
          }
          initialClausulaTexto={valorModalCtx?.clausulaAtOpen ?? null}
          onSave={async (p) => {
            if (!valorModalCtx) return;
            await saveMultaFromModal(valorModalCtx.nAcic, p);
          }}
          onClear={async () => {
            if (!valorModalCtx) return;
            await clearMultaOverride(valorModalCtx.nAcic);
          }}
        />
      </div>
    </MainLayout>
  );
}
