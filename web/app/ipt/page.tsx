"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format, endOfMonth, startOfMonth } from "date-fns";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IPTModal } from "@/components/ipt-modal";
import { apiService, type IptPreviewResponse } from "@/lib/api";

const pct = (value?: number | null) => (value == null ? "--" : `${value.toFixed(1)}%`);

export default function IPTPage() {
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [loading, setLoading] = useState(true);
  const [iptPreview, setIptPreview] = useState<IptPreviewResponse | null>(null);
  const [iptCard, setIptCard] = useState<{ valor?: number; pontuacao?: number }>({});
  const [iptModalOpen, setIptModalOpen] = useState(false);
  const [subprefeituraFilter, setSubprefeituraFilter] = useState("all");
  const [servicoFilter, setServicoFilter] = useState("");
  const [incluirInativos, setIncluirInativos] = useState(false);
  const [somenteDivergencia, setSomenteDivergencia] = useState(false);
  const [origemFilter, setOrigemFilter] = useState<"all" | "ambos" | "somente_selimp" | "somente_nosso">("all");

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
    return Array.from(new Set(values));
  }, [iptPreview]);

  const filteredMesclados = useMemo(() => {
    const rows = iptPreview?.mesclados ?? [];
    return rows.filter((row) => {
      if (!incluirInativos && !row.plano_ativo) return false;
      if (subprefeituraFilter !== "all" && row.subprefeitura !== subprefeituraFilter) return false;
      if (servicoFilter.trim() && !row.tipo_servico.toLowerCase().includes(servicoFilter.trim().toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [iptPreview, incluirInativos, servicoFilter, subprefeituraFilter]);

  const filteredComparativo = useMemo(() => {
    const rows = iptPreview?.comparativo.itens ?? [];
    return rows.filter((row) => {
      if (subprefeituraFilter !== "all" && row.subprefeitura !== subprefeituraFilter) return false;
      if (servicoFilter.trim() && !row.tipo_servico.toLowerCase().includes(servicoFilter.trim().toLowerCase())) {
        return false;
      }
      if (origemFilter !== "all" && row.origem !== origemFilter) return false;
      if (somenteDivergencia) {
        if (row.diferenca_percentual == null || Math.abs(row.diferenca_percentual) < 5) return false;
      }
      return true;
    });
  }, [iptPreview, origemFilter, servicoFilter, somenteDivergencia, subprefeituraFilter]);

  return (
    <MainLayout>
      <div className="space-y-5">
        <div className="relative overflow-hidden rounded-xl bg-linear-to-r from-purple-600/15 via-indigo-600/8 to-transparent p-8 border border-purple-200/50 dark:border-purple-800/50 shadow-lg">
          <div className="relative">
            <h1 className="text-4xl font-bold tracking-tight bg-linear-to-r from-purple-600 to-indigo-500 bg-clip-text text-transparent pb-2">
              IPT
            </h1>
            <p className="text-muted-foreground mt-2 text-lg max-w-3xl">
              Análise macro e conferência SELIMP x base interna, com exclusão de módulos/planos inativos.
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-card/60 backdrop-blur-sm p-4">
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
                className="h-10 rounded-md border border-border bg-background px-3 text-sm w-full"
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Subprefeitura</p>
              <select
                value={subprefeituraFilter}
                onChange={(e) => setSubprefeituraFilter(e.target.value)}
                className="h-10 rounded-md border border-border bg-background px-3 text-sm w-full"
              >
                <option value="all">Todas</option>
                {subprefeituraOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div className="xl:col-span-2">
              <p className="text-xs text-muted-foreground mb-1">Serviço (busca)</p>
              <input
                value={servicoFilter}
                onChange={(e) => setServicoFilter(e.target.value)}
                placeholder="Digite parte do tipo de serviço..."
                className="h-10 rounded-md border border-border bg-background px-3 text-sm w-full"
              />
            </div>
            <label className="flex items-center gap-2 text-sm h-10">
              <input
                type="checkbox"
                checked={incluirInativos}
                onChange={(e) => setIncluirInativos(e.target.checked)}
              />
              Incluir inativos
            </label>
            <button
              type="button"
              onClick={() => setIptModalOpen(true)}
              className="h-10 rounded-md px-4 text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 transition-colors"
            >
              Atualizar IPT manual
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <div className="rounded-lg border p-3 bg-background/70 shadow-sm">
            <p className="text-xs text-muted-foreground">IPT (%)</p>
            <p className="text-xl font-bold text-purple-600">{iptCard.valor != null ? `${iptCard.valor.toFixed(1)}%` : "--"}</p>
          </div>
          <div className="rounded-lg border p-3 bg-background/70 shadow-sm">
            <p className="text-xs text-muted-foreground">Pontuação IPT</p>
            <p className="text-xl font-bold text-indigo-600">{iptCard.pontuacao ?? 0}</p>
          </div>
          <div className="rounded-lg border p-3 bg-background/70 shadow-sm">
            <p className="text-xs text-muted-foreground">Planos (SELIMP)</p>
            <p className="text-xl font-bold">{iptPreview?.resumo.total_planos ?? 0}</p>
          </div>
          <div className="rounded-lg border p-3 bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-500/30 shadow-sm">
            <p className="text-xs text-muted-foreground">Planos Ativos</p>
            <p className="text-xl font-bold text-emerald-600">{iptPreview?.resumo.total_planos_ativos ?? 0}</p>
          </div>
          <div className="rounded-lg border p-3 bg-background/70 shadow-sm">
            <p className="text-xs text-muted-foreground">Execução Média Ativa</p>
            <p className="text-xl font-bold">{pct(iptPreview?.resumo.media_execucao_planos_ativos)}</p>
          </div>
          <div className="rounded-lg border p-3 bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-500/30 shadow-sm">
            <p className="text-xs text-muted-foreground">Módulos Ativos</p>
            <p className="text-xl font-bold text-emerald-600">{iptPreview?.resumo.total_modulos_ativos ?? 0}</p>
          </div>
          <div className="rounded-lg border p-3 bg-red-50/50 dark:bg-red-900/10 border-red-500/30 shadow-sm">
            <p className="text-xs text-muted-foreground">Módulos Inativos</p>
            <p className="text-xl font-bold text-red-600">{iptPreview?.resumo.total_modulos_inativos ?? 0}</p>
          </div>
          <div className="rounded-lg border p-3 bg-background/70 shadow-sm">
            <p className="text-xs text-muted-foreground">Sem Status</p>
            <p className="text-xl font-bold">{iptPreview?.resumo.sem_status_bateria ?? 0}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <CardTitle className="text-base">Top Subprefeituras (ativos)</CardTitle>
              <CardDescription>Volume de planos e média de execução considerando filtros.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(iptPreview?.subprefeituras ?? []).slice(0, 12).map((item) => (
                <div key={item.subprefeitura} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{item.subprefeitura || "Não informado"}</span>
                  <span className="text-muted-foreground">
                    {item.quantidade_planos} | {pct(item.media_execucao)}
                  </span>
                </div>
              ))}
              {!loading && (iptPreview?.subprefeituras?.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground">Sem dados para o período.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg">
            <CardHeader>
              <CardTitle className="text-base">Top Serviços (ativos)</CardTitle>
              <CardDescription>Volume de planos e média de execução considerando filtros.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(iptPreview?.servicos ?? []).slice(0, 12).map((item) => (
                <div key={item.tipo_servico} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{item.tipo_servico || "Não informado"}</span>
                  <span className="text-muted-foreground">
                    {item.quantidade_planos} | {pct(item.media_execucao)}
                  </span>
                </div>
              ))}
              {!loading && (iptPreview?.servicos?.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground">Sem dados para o período.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle>Comparativo SELIMP x Nossa Base</CardTitle>
            <CardDescription>
              Conferência por plano para validar divergência percentual e cobertura entre planilhas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border p-3 bg-background/70">
                <p className="text-xs text-muted-foreground">Linhas comparativas</p>
                <p className="text-xl font-bold">{iptPreview?.comparativo.total_linhas ?? 0}</p>
              </div>
              <div className="rounded-lg border p-3 bg-amber-50/40 dark:bg-amber-900/10 border-amber-500/30">
                <p className="text-xs text-muted-foreground">Divergências (|Δ| ≥ 5)</p>
                <p className="text-xl font-bold text-amber-600">{iptPreview?.comparativo.divergencias ?? 0}</p>
              </div>
              <div className="rounded-lg border p-3 bg-cyan-50/40 dark:bg-cyan-900/10 border-cyan-500/30">
                <p className="text-xs text-muted-foreground">Só SELIMP</p>
                <p className="text-xl font-bold text-cyan-600">{iptPreview?.comparativo.somente_selimp ?? 0}</p>
              </div>
              <div className="rounded-lg border p-3 bg-fuchsia-50/40 dark:bg-fuchsia-900/10 border-fuchsia-500/30">
                <p className="text-xs text-muted-foreground">Só Nossa Base</p>
                <p className="text-xl font-bold text-fuchsia-600">{iptPreview?.comparativo.somente_nosso ?? 0}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={somenteDivergencia}
                  onChange={(e) => setSomenteDivergencia(e.target.checked)}
                />
                Mostrar só divergências
              </label>
              <select
                value={origemFilter}
                onChange={(e) =>
                  setOrigemFilter(e.target.value as "all" | "ambos" | "somente_selimp" | "somente_nosso")
                }
                className="h-9 rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="all">Todas origens</option>
                <option value="ambos">Apenas ambos</option>
                <option value="somente_selimp">Somente SELIMP</option>
                <option value="somente_nosso">Somente Nossa Base</option>
              </select>
            </div>

            <div className="rounded-lg border bg-background/60 overflow-x-auto max-h-[420px]">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">Plano</th>
                    <th className="text-left px-3 py-2">Subprefeitura</th>
                    <th className="text-left px-3 py-2">Serviço</th>
                    <th className="text-left px-3 py-2">SELIMP</th>
                    <th className="text-left px-3 py-2">Nossa</th>
                    <th className="text-left px-3 py-2">Δ</th>
                    <th className="text-left px-3 py-2">Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredComparativo.slice(0, 300).map((row) => {
                    const delta = row.diferenca_percentual;
                    const diverge = delta != null && Math.abs(delta) >= 5;
                    return (
                      <tr
                        key={`${row.plano}-${row.origem}-${row.percentual_selimp}-${row.percentual_nosso}`}
                        className={`border-t ${diverge ? "bg-amber-50/40 dark:bg-amber-900/10" : ""}`}
                      >
                        <td className="px-3 py-2 font-medium">{row.plano || "-"}</td>
                        <td className="px-3 py-2">{row.subprefeitura || "-"}</td>
                        <td className="px-3 py-2 max-w-[280px] truncate" title={row.tipo_servico}>
                          {row.tipo_servico || "-"}
                        </td>
                        <td className="px-3 py-2">{pct(row.percentual_selimp)}</td>
                        <td className="px-3 py-2">{pct(row.percentual_nosso)}</td>
                        <td className={`px-3 py-2 font-semibold ${diverge ? "text-amber-600" : "text-muted-foreground"}`}>
                          {delta == null ? "--" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} p.p.`}
                        </td>
                        <td className="px-3 py-2">
                          <span className="rounded-full border px-2 py-0.5 text-xs">
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
                      <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                        Sem dados para os filtros selecionados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle>Detalhamento Operacional (Mescla SELIMP)</CardTitle>
            <CardDescription>Planos filtrados para leitura operacional e diagnóstico de módulo.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border bg-background/60 overflow-x-auto max-h-[520px]">
              <table className="w-full min-w-[1100px] text-sm">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">Plano</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">Ativo</th>
                    <th className="text-left px-3 py-2">Subprefeitura</th>
                    <th className="text-left px-3 py-2">Serviço</th>
                    <th className="text-left px-3 py-2">% Exec.</th>
                    <th className="text-left px-3 py-2">Equipamentos</th>
                    <th className="text-left px-3 py-2">Módulos</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMesclados.slice(0, 250).map((row) => (
                    <tr key={`${row.plano}-${row.atualizado_em}`} className={`border-t ${row.plano_ativo ? "" : "bg-red-50/30 dark:bg-red-900/10"}`}>
                      <td className="px-3 py-2 font-medium">{row.plano || "-"}</td>
                      <td className="px-3 py-2">{row.status_execucao || "-"}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs border ${row.plano_ativo ? "text-emerald-600 border-emerald-500/40" : "text-red-600 border-red-500/40"}`}>
                          {row.plano_ativo ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td className="px-3 py-2">{row.subprefeitura || "-"}</td>
                      <td className="px-3 py-2 max-w-[280px] truncate" title={row.tipo_servico}>
                        {row.tipo_servico || "-"}
                      </td>
                      <td className="px-3 py-2">{pct(row.percentual_execucao)}</td>
                      <td className="px-3 py-2 max-w-[220px] truncate" title={row.equipamentos.join(", ")}>
                        {row.equipamentos.length ? row.equipamentos.join(", ") : "-"}
                      </td>
                      <td className="px-3 py-2">
                        {row.modulos_status.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {row.modulos_status.slice(0, 3).map((m) => (
                              <span
                                key={`${row.plano}-${m.codigo}`}
                                className={`rounded-full px-2 py-0.5 text-xs border ${
                                  m.ativo
                                    ? "text-emerald-600 border-emerald-500/40"
                                    : "text-red-600 border-red-500/40"
                                }`}
                                title={`${m.codigo} | ${m.status_bateria} | ${m.status_comunicacao}`}
                              >
                                {m.codigo}
                              </span>
                            ))}
                            {row.modulos_status.length > 3 && (
                              <span className="text-xs text-muted-foreground">+{row.modulos_status.length - 3}</span>
                            )}
                          </div>
                        ) : (
                          "Sem status"
                        )}
                      </td>
                    </tr>
                  ))}
                  {!loading && filteredMesclados.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                        Sem dados para os filtros selecionados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
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
