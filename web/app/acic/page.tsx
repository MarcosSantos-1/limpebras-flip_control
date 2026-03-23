"use client";

import { useState, useEffect, useMemo } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiService } from "@/lib/api";
import { format, startOfMonth, isValid } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShieldCheck, Clock, DollarSign, Archive, Ban, FileWarning } from "lucide-react";

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

function getAcicNum(acic: Record<string, unknown>, ...keys: string[]): number {
  const v = getAcicField(acic, ...keys);
  if (!v) return 0;
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
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

type FiltroRegistro = "todos" | "defesa" | "em_aberto" | "valor" | "sem_recurso";

interface ACIC {
  id: string;
  [key: string]: unknown;
}

export default function ACICPage() {
  const [acics, setAcics] = useState<ACIC[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [defesaMap, setDefesaMap] = useState<Record<string, boolean>>({});
  const [semRecursoMap, setSemRecursoMap] = useState<Record<string, boolean>>({});
  const [valorMap, setValorMap] = useState<Record<string, number>>({});
  const hoje = new Date();
  const [filters, setFilters] = useState({
    registro: "todos" as FiltroRegistro,
    periodo_inicial: format(startOfMonth(hoje), "yyyy-MM-dd"),
    periodo_final: format(hoje, "yyyy-MM-dd"),
  });

  useEffect(() => {
    loadACICs();
  }, [filters.periodo_inicial, filters.periodo_final]);

  const loadACICs = async () => {
    try {
      setLoading(true);
      const data = await apiService.getACICs({
        periodo_inicial: filters.periodo_inicial,
        periodo_final: filters.periodo_final,
      });
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

  const getValorForAcic = (acic: ACIC, nAcic: string): number => {
    const override = valorMap[nAcic];
    if (override !== undefined && override > 0) return override;
    return getAcicNum(acic, "Valor_Multa", "valor_multa");
  };

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
      const status = (getAcicField(acic, "Status", "status") ?? "").toLowerCase();
      const valor = getValorForAcic(acic, nAcic);
      const temDefesa = defesaMap[nAcic];
      const temSemRecurso = semRecursoMap[nAcic];
      const emAberto = status.includes("solicitacao") || status.includes("solicitação");

      switch (filters.registro) {
        case "defesa":
          return temDefesa;
        case "em_aberto":
          return emAberto;
        case "valor":
          return valor > 0;
        case "sem_recurso":
          return temSemRecurso;
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
    return {
      defesa: acics.filter((a) => defesaMap[getAcicField(a, "N_ACIC", "n_acic") ?? ""]).length,
      emAberto: acics.filter((a) => {
        const s = (getAcicField(a, "Status", "status") ?? "").toLowerCase();
        return s.includes("solicitacao") || s.includes("solicitação");
      }).length,
      valor: acics.filter((a) => {
        const n = getAcicField(a, "N_ACIC", "n_acic") ?? "";
        const v = valorMap[n] ?? getAcicNum(a, "Valor_Multa", "valor_multa");
        return v > 0;
      }).length,
      semRecurso: acics.filter((a) => semRecursoMap[getAcicField(a, "N_ACIC", "n_acic") ?? ""]).length,
    };
  }, [acics, defesaMap, semRecursoMap, valorMap]);

  const getStatusColor = (status?: string) => {
    if (!status) return "bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200";
    const s = status.toLowerCase();
    if (s.includes("confirmado")) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200 dark:border-green-800";
    if (s.includes("solicitacao") || s.includes("solicitação")) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800";
    if (s.includes("autuado")) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800";
    if (s.includes("arquivado")) return "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200";
    if (s.includes("cancelado")) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    return "bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200";
  };

  return (
    <MainLayout>
      <div className="space-y-8">
        <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-amber-600 via-amber-700 to-orange-900 p-8 shadow-xl shadow-amber-900/35 dark:bg-linear-to-br dark:from-amber-800 dark:via-orange-900 dark:to-amber-950 dark:shadow-2xl dark:shadow-black/45">
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
            <div
              className="flex h-22 w-22 shrink-0 items-center justify-center rounded-2xl bg-orange-950 shadow-lg dark:bg-orange-950"
              aria-hidden
            >
              <FileWarning className="h-11 w-11 text-white" strokeWidth={1.5} />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-4xl font-bold tracking-tight text-white">Histórico de ACICs</h1>
              <p className="mt-3 max-w-2xl text-lg text-amber-50">
                Autos de Constatação de Irregularidade da Contratada — Registro para histórico: defesa apresentada, em aberto, valor e sem recurso.
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
              <p className="text-xs text-muted-foreground mt-1">Registros no período</p>
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
              filters.registro === "valor" ? "border-l-red-500 ring-2 ring-red-500/20" : "border-l-muted"
            }`}
            onClick={() => setFilters({ ...filters, registro: "valor" })}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <DollarSign className="w-4 h-4" /> Valor
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.valor}</div>
              <p className="text-xs text-muted-foreground mt-1">Com multa registrada</p>
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

        {/* Filtros de período */}
        <Card className="overflow-hidden border-none shadow-sm bg-muted/30">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium">Período</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Início</Label>
                <DatePicker
                  value={filters.periodo_inicial}
                  onChange={(value) => setFilters({ ...filters, periodo_inicial: value })}
                  placeholder="Selecionar início"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Fim</Label>
                <DatePicker
                  value={filters.periodo_final}
                  onChange={(value) => setFilters({ ...filters, periodo_final: value })}
                  placeholder="Selecionar fim"
                />
              </div>
              <div className="space-y-1">
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
                    <SelectItem value="defesa">Defesa apresentada</SelectItem>
                    <SelectItem value="em_aberto">Em aberto (solicitação)</SelectItem>
                    <SelectItem value="valor">Com multa registrada</SelectItem>
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
              const status = getAcicField(acic, "Status", "status");
              const valor = getValorForAcic(acic, nAcic);
              const temDefesa = defesaMap[nAcic];
              const temSemRecurso = semRecursoMap[nAcic];
              const endereco = getAcicField(acic, "Endereco", "endereco");
              const servico = getAcicField(acic, "Servico", "servico");
              const area = getAcicField(acic, "Area", "area");
              const agente = getAcicField(acic, "Agente_Fiscalizador", "agente_fiscalizador");
              const dataAcic = getAcicField(acic, "Data_ACIC", "data_acic");
              const descricao = getAcicField(acic, "Descricao", "descricao");

              return (
                <Card key={acic.id} className="hover:shadow-md transition-all duration-200 hover:border-amber-200/50 dark:hover:border-amber-800/50">
                  <CardContent className="p-6">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                          <h3 className="text-lg font-bold font-mono text-primary">ACIC: {nAcic}</h3>
                          {status && (
                            <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full border ${getStatusColor(status)}`}>
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
