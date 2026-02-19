"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format, endOfMonth, startOfMonth } from "date-fns";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IPTModal } from "@/components/ipt-modal";
import { apiService, type IptPreviewResponse } from "@/lib/api";

const pct = (value?: number | null) => (value == null ? "--" : `${value.toFixed(1)}%`);
const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const normalizeText = (value?: string) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const getSubTag = (subprefeitura?: string) => {
  const normalized = normalizeText(subprefeitura);
  const compact = normalized.replace(/[^a-z]/g, "");

  if (compact === "cv") {
    return { sigla: "CV", className: "border-lime-500/60 bg-lime-500/10 text-lime-700 dark:text-lime-400" };
  }
  if (compact === "jt") {
    return { sigla: "JT", className: "border-blue-800/60 bg-blue-700/10 text-blue-800 dark:text-blue-300" };
  }
  if (compact === "mg") {
    return { sigla: "MG", className: "border-cyan-500/60 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" };
  }
  if (compact === "st") {
    return { sigla: "ST", className: "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300" };
  }

  if (
    normalized.includes("casa verde") ||
    normalized.includes("limao") ||
    normalized.includes("cachoeirinha")
  ) {
    return { sigla: "CV", className: "border-lime-500/60 bg-lime-500/10 text-lime-700 dark:text-lime-400" };
  }
  if (normalized.includes("jacana") || normalized.includes("tremembe")) {
    return { sigla: "JT", className: "border-blue-800/60 bg-blue-700/10 text-blue-800 dark:text-blue-300" };
  }
  if (normalized.includes("vila maria") || normalized.includes("guilherme")) {
    return { sigla: "MG", className: "border-cyan-500/60 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" };
  }
  if (normalized.includes("santana") || normalized.includes("tucuruvi")) {
    return { sigla: "ST", className: "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300" };
  }

  return { sigla: "--", className: "border-muted-foreground/30 bg-muted/30 text-muted-foreground" };
};

const getSelimpBadgeClass = (value?: number | null) => {
  if (value == null) return "border-muted-foreground/30 bg-muted/30 text-muted-foreground";
  if (value >= 90) return "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (value >= 60) return "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-300";
};

const getOrigemBadgeClass = (origem: "ambos" | "somente_selimp" | "somente_nosso") => {
  if (origem === "somente_selimp") return "border-blue-500/60 bg-blue-500/10 text-blue-700 dark:text-blue-300";
  if (origem === "somente_nosso") return "border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-300";
  return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
};

export default function IPTPage() {
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [loading, setLoading] = useState(true);
  const [iptPreview, setIptPreview] = useState<IptPreviewResponse | null>(null);
  const [iptCard, setIptCard] = useState<{ valor?: number; pontuacao?: number }>({});
  const [iptModalOpen, setIptModalOpen] = useState(false);
  const [subprefeituraFilter, setSubprefeituraFilter] = useState("all");
  const [somenteDivergencia, setSomenteDivergencia] = useState(false);
  const [origemFilter, setOrigemFilter] = useState<"all" | "ambos" | "somente_selimp" | "somente_nosso">("all");
  const [tableExpanded, setTableExpanded] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const inicio = format(startOfMonth(selectedMonth), "yyyy-MM-dd");
      const fim = format(endOfMonth(selectedMonth), "yyyy-MM-dd");
      const [preview, kpis] = await Promise.all([
        apiService.getIptPreview(inicio, fim).catch(() => null),
        apiService.getKPIs(inicio, fim).catch(() => null),
      ]);
      setIptPreview(preview);
      setIptCard({
        valor: kpis?.indicadores?.ipt?.valor,
        pontuacao: kpis?.indicadores?.ipt?.pontuacao,
      });
    } finally {
      setLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const subprefeituraOptions = useMemo(() => {
    const values = (iptPreview?.subprefeituras ?? []).map((item) => item.subprefeitura).filter(Boolean);
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [iptPreview]);

  const filteredComparativo = useMemo(() => {
    const rows = iptPreview?.comparativo.itens ?? [];
    return rows.filter((row) => {
      if (subprefeituraFilter !== "all" && row.subprefeitura !== subprefeituraFilter) return false;
      if (origemFilter !== "all" && row.origem !== origemFilter) return false;
      if (somenteDivergencia) {
        if (row.diferenca_percentual == null || Math.abs(row.diferenca_percentual) < 5) return false;
      }
      return true;
    });
  }, [iptPreview, origemFilter, somenteDivergencia, subprefeituraFilter]);

  const origemDistribution = useMemo(() => {
    const total = iptPreview?.comparativo.total_linhas ?? 0;
    if (!total) return { ambos: 0, somenteSelimp: 0, somenteNosso: 0 };
    return {
      ambos: ((total - (iptPreview?.comparativo.somente_selimp ?? 0) - (iptPreview?.comparativo.somente_nosso ?? 0)) / total) * 100,
      somenteSelimp: ((iptPreview?.comparativo.somente_selimp ?? 0) / total) * 100,
      somenteNosso: ((iptPreview?.comparativo.somente_nosso ?? 0) / total) * 100,
    };
  }, [iptPreview]);

  const topSubprefeituras = useMemo(() => {
    const list = [...(iptPreview?.subprefeituras ?? [])];
    list.sort((a, b) => (b.media_execucao ?? -1) - (a.media_execucao ?? -1));
    return list.slice(0, 10);
  }, [iptPreview]);

  const topServicos = useMemo(() => {
    const list = [...(iptPreview?.servicos ?? [])];
    list.sort((a, b) => (b.media_execucao ?? -1) - (a.media_execucao ?? -1));
    return list.slice(0, 10);
  }, [iptPreview]);

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-emerald-400/20 via-teal-400/10 to-cyan-400/15 p-8 shadow-[0_0_45px_-20px_rgba(16,185,129,0.75)]">
          <div className="pointer-events-none absolute -top-16 right-10 h-44 w-44 rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 left-10 h-44 w-44 rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="relative">
            <h1 className="text-4xl font-bold tracking-tight bg-linear-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent pb-2">
              IPT
            </h1>
            <p className="text-muted-foreground mt-2 text-lg max-w-3xl">
              Análise macro e conferência SELIMP x base interna, com exclusão de módulos/planos inativos.
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-card/70 backdrop-blur p-4 shadow-lg">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3 items-end">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Mês de referência</p>
              <input
                type="month"
                value={format(selectedMonth, "yyyy-MM")}
                max={format(new Date(), "yyyy-MM")}
                onChange={(e) => {
                  if (!e.target.value) return;
                  const [year, month] = e.target.value.split("-");
                  setSelectedMonth(startOfMonth(new Date(Number(year), Number(month) - 1, 1)));
                }}
                className="h-10 rounded-xl bg-background/90 px-3 text-sm w-full shadow-inner ring-1 ring-white/10 focus:ring-2 focus:ring-emerald-500/60 outline-none"
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Subprefeitura</p>
              <select
                value={subprefeituraFilter}
                onChange={(e) => setSubprefeituraFilter(e.target.value)}
                className="h-10 rounded-xl bg-background/90 px-3 text-sm w-full shadow-inner ring-1 ring-white/10 focus:ring-2 focus:ring-emerald-500/60 outline-none"
              >
                <option value="all">Todas</option>
                {subprefeituraOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={loadData}
              className="h-10 rounded-xl px-4 text-sm font-medium text-white bg-linear-to-r from-emerald-500 to-teal-500 hover:opacity-90 transition-all shadow-[0_8px_20px_-10px_rgba(16,185,129,0.9)] inline-flex items-center justify-center gap-2"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <polyline points="21 3 21 9 15 9" />
              </svg>
              Atualizar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card className="xl:col-span-1 border-0 shadow-[0_20px_50px_-30px_rgba(16,185,129,0.7)] bg-linear-to-br from-emerald-500/15 via-card to-card">
            <CardHeader>
              <CardTitle className="text-base">IPT + Pontuacao Manual (simulacao)</CardTitle>
              <CardDescription>Bloco separado das medicoes automaticas das importacoes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl bg-background/70 p-4 shadow-sm transition-all hover:shadow-md">
                <p className="text-xs text-muted-foreground">IPT (%)</p>
                <p className="text-3xl font-bold text-emerald-600">{iptCard.valor != null ? `${iptCard.valor.toFixed(1)}%` : "--"}</p>
                <div className="mt-3 h-2 rounded-full bg-emerald-200/40 dark:bg-emerald-900/20">
                  <div
                    className="h-2 rounded-full bg-linear-to-r from-emerald-500 to-teal-500 transition-all"
                    style={{ width: `${clamp(iptCard.valor ?? 0)}%` }}
                  />
                </div>
              </div>
              <div className="rounded-xl bg-background/70 p-4 shadow-sm transition-all hover:shadow-md">
                <p className="text-xs text-muted-foreground">Pontuacao IPT</p>
                <p className="text-3xl font-bold text-teal-600">{iptCard.pontuacao ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-2">Referencia de simulacao manual.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="xl:col-span-2 border-0 shadow-[0_20px_50px_-30px_rgba(16,185,129,0.6)]">
            <CardHeader>
              <CardTitle className="text-base">Medicoes Automaticas (importacoes)</CardTitle>
              <CardDescription>Indicadores operacionais gerados automaticamente da base consolidada.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="rounded-xl bg-card/70 p-3 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg">
                <p className="text-xs text-muted-foreground">Planos (SELIMP)</p>
                <p className="text-xl font-bold">{iptPreview?.resumo.total_planos ?? 0}</p>
              </div>
              <div className="rounded-xl bg-emerald-500/10 p-3 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg">
                <p className="text-xs text-muted-foreground">Planos Ativos</p>
                <p className="text-xl font-bold text-emerald-600">{iptPreview?.resumo.total_planos_ativos ?? 0}</p>
              </div>
              <div className="rounded-xl bg-cyan-500/10 p-3 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg">
                <p className="text-xs text-muted-foreground">Execucao Media Ativa</p>
                <p className="text-xl font-bold">{pct(iptPreview?.resumo.media_execucao_planos_ativos)}</p>
                <div className="mt-2 h-1.5 rounded-full bg-cyan-200/40 dark:bg-cyan-900/20">
                  <div
                    className="h-1.5 rounded-full bg-cyan-500"
                    style={{ width: `${clamp(iptPreview?.resumo.media_execucao_planos_ativos ?? 0)}%` }}
                  />
                </div>
              </div>
              <div className="rounded-xl bg-emerald-500/10 p-3 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg">
                <p className="text-xs text-muted-foreground">Modulos Ativos</p>
                <p className="text-xl font-bold text-emerald-600">{iptPreview?.resumo.total_modulos_ativos ?? 0}</p>
              </div>
              <div className="rounded-xl bg-rose-500/10 p-3 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg">
                <p className="text-xs text-muted-foreground">Modulos Inativos</p>
                <p className="text-xl font-bold text-rose-600">{iptPreview?.resumo.total_modulos_inativos ?? 0}</p>
              </div>
              <div className="rounded-xl bg-amber-500/10 p-3 shadow transition-all hover:-translate-y-0.5 hover:shadow-lg">
                <p className="text-xs text-muted-foreground">Sem Status</p>
                <p className="text-xl font-bold text-amber-600">{iptPreview?.resumo.sem_status_bateria ?? 0}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <CardTitle className="text-base">Top Subprefeituras (ativos)</CardTitle>
              <CardDescription>Barras por volume e desempenho medio para leitura rapida.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {topSubprefeituras.map((item) => (
                <div key={item.subprefeitura} className="rounded-xl bg-background/60 p-2.5 shadow-sm transition-all hover:shadow-md">
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{item.subprefeitura || "Nao informado"}</span>
                    <span className="text-muted-foreground">{item.quantidade_planos} planos</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted/50">
                    <div
                      className="h-2 rounded-full bg-linear-to-r from-emerald-500 to-teal-500"
                      style={{ width: `${clamp(item.media_execucao ?? 0)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Execucao media: {pct(item.media_execucao)}</p>
                </div>
              ))}
              {!loading && topSubprefeituras.length === 0 && (
                <p className="text-sm text-muted-foreground">Sem dados para o período.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg">
            <CardHeader>
              <CardTitle className="text-base">Top Serviços (ativos)</CardTitle>
              <CardDescription>Distribuicao por tipo de servico com barras e realce visual.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {topServicos.map((item) => (
                <div key={item.tipo_servico} className="rounded-xl bg-background/60 p-2.5 shadow-sm transition-all hover:shadow-md">
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{item.tipo_servico || "Nao informado"}</span>
                    <span className="text-muted-foreground">{item.quantidade_planos} planos</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted/50">
                    <div
                      className="h-2 rounded-full bg-linear-to-r from-emerald-500 to-cyan-500"
                      style={{ width: `${clamp(item.media_execucao ?? 0)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Execucao media: {pct(item.media_execucao)}</p>
                </div>
              ))}
              {!loading && topServicos.length === 0 && (
                <p className="text-sm text-muted-foreground">Sem dados para o período.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle>Comparativo SELIMP x Nossa Base</CardTitle>
            <CardDescription>
              Conferencia por plano para validar divergencia percentual e cobertura entre planilhas.
              Delta (Δ) representa a diferenca em pontos percentuais: SELIMP - Nossa Base.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl p-3 bg-background/70 shadow-sm">
                <p className="text-xs text-muted-foreground">Linhas comparativas</p>
                <p className="text-xl font-bold">{iptPreview?.comparativo.total_linhas ?? 0}</p>
              </div>
              <div className="rounded-xl p-3 bg-amber-500/10 shadow-sm">
                <p className="text-xs text-muted-foreground">Divergencias (|Δ| &gt;= 5 p.p.)</p>
                <p className="text-xl font-bold text-amber-600">{iptPreview?.comparativo.divergencias ?? 0}</p>
                <div className="mt-2 h-1.5 rounded-full bg-amber-200/50 dark:bg-amber-900/20">
                  <div
                    className="h-1.5 rounded-full bg-amber-500"
                    style={{
                      width: `${clamp(
                        ((iptPreview?.comparativo.divergencias ?? 0) / Math.max(1, iptPreview?.comparativo.total_linhas ?? 1)) * 100
                      )}%`,
                    }}
                  />
                </div>
              </div>
              <div className="rounded-xl p-3 bg-cyan-500/10 shadow-sm">
                <p className="text-xs text-muted-foreground">Só SELIMP</p>
                <p className="text-xl font-bold text-cyan-600">{iptPreview?.comparativo.somente_selimp ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">{origemDistribution.somenteSelimp.toFixed(1)}%</p>
              </div>
              <div className="rounded-xl p-3 bg-fuchsia-500/10 shadow-sm">
                <p className="text-xs text-muted-foreground">Só Nossa Base</p>
                <p className="text-xl font-bold text-fuchsia-600">{iptPreview?.comparativo.somente_nosso ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">{origemDistribution.somenteNosso.toFixed(1)}%</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm rounded-xl bg-background/70 px-3 py-2 shadow-sm">
                <input
                  type="checkbox"
                  checked={somenteDivergencia}
                  onChange={(e) => setSomenteDivergencia(e.target.checked)}
                />
                Mostrar só divergências
              </label>
              <button
                type="button"
                onClick={() => setTableExpanded((prev) => !prev)}
                className="h-9 rounded-xl px-3 text-sm bg-background/70 shadow-sm hover:shadow-md transition-all"
              >
                {tableExpanded ? "Encolher tabela" : "Mostrar tabela"}
              </button>
              <select
                value={origemFilter}
                onChange={(e) =>
                  setOrigemFilter(e.target.value as "all" | "ambos" | "somente_selimp" | "somente_nosso")
                }
                className="h-9 rounded-xl bg-background/80 px-3 text-sm shadow-inner ring-1 ring-white/10 outline-none"
              >
                <option value="all">Todas origens</option>
                <option value="ambos">Apenas ambos</option>
                <option value="somente_selimp">Somente SELIMP</option>
                <option value="somente_nosso">Somente Nossa Base</option>
              </select>
            </div>

            {tableExpanded && (
              <div className="rounded-2xl bg-background/60 shadow-inner transition-all">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2">Plano</th>
                    <th className="text-left px-3 py-2">Sub.</th>
                    <th className="text-left px-3 py-2">Servico</th>
                    <th className="text-left px-3 py-2">SELIMP</th>
                    <th className="text-left px-3 py-2">Nossa</th>
                    <th className="text-left px-3 py-2">Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredComparativo.map((row, index) => {
                    const delta = row.diferenca_percentual;
                    const diverge = delta != null && Math.abs(delta) >= 5;
                    const subTag = getSubTag(row.subprefeitura);
                    return (
                      <tr
                        key={`${row.plano}-${row.origem}-${row.percentual_selimp}-${row.percentual_nosso}`}
                        className={`transition-colors hover:bg-emerald-500/10 ${
                          diverge
                            ? "bg-amber-500/10"
                            : index % 2 === 0
                            ? "bg-background/35"
                            : "bg-background/10"
                        }`}
                      >
                        <td className="px-3 py-2 font-medium">{row.plano || "-"}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-semibold ${subTag.className}`}>
                            {subTag.sigla}
                          </span>
                        </td>
                        <td className="px-3 py-2 wrap-break-word whitespace-normal leading-snug">
                          {row.tipo_servico || "-"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${getSelimpBadgeClass(
                              row.percentual_selimp
                            )}`}
                          >
                            {pct(row.percentual_selimp)}
                          </span>
                        </td>
                        <td className="px-3 py-2">{pct(row.percentual_nosso)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${getOrigemBadgeClass(
                              row.origem
                            )}`}
                          >
                            {row.origem === "ambos"
                              ? "Ambos"
                              : row.origem === "somente_selimp"
                              ? "Só SELIMP"
                              : "Só Nossa"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {!loading && filteredComparativo.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                        Sem dados para os filtros selecionados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            )}
          </CardContent>
        </Card>

        <IPTModal
          open={iptModalOpen}
          onOpenChange={setIptModalOpen}
          onSuccess={() => loadData()}
          currentValue={iptCard.valor}
          currentPontuacao={iptCard.pontuacao}
        />
      </div>
    </MainLayout>
  );
}
