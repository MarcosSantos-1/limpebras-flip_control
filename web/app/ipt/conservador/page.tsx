"use client";

/**
 * Painel IPT Conservador vs Otimista
 *
 * Mostra os 3 numeros (otimista, conservador, SELIMP oficial), o limite seguro
 * para nao tomar glosa, e a evolucao diaria por servico. O "conservador" eh
 * o proxy SELIMP do servico ipt-conservador no backend.
 *
 * Sem dados inventados: tudo vem de /indicadores/ipt-conservador e
 * /indicadores/ipt-servico-evolucao (snapshots gravados a cada upload).
 */

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { format, endOfMonth, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { apiService } from "@/lib/api";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  TrendingUp,
  AlertTriangle,
  Info,
  RefreshCcw,
} from "lucide-react";

// Chart.js dinamico para evitar SSR
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title as ChartTitle,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ChartTitle,
  Tooltip,
  Legend,
  Filler,
);

const Line = dynamic(() => import("react-chartjs-2").then((m) => m.Line), { ssr: false });

// ---------- helpers ----------

/** Limites de risco do IPT em pontos percentuais (faixa contratual ADC). */
const LIMITE_SEGURO = 90; // >= 90 = 40 pontos IPT (max) -> ADC >= 90 = sem glosa
const LIMITE_ALERTA = 80;

function corPorPercentual(pct: number | null | undefined): {
  text: string;
  bg: string;
  border: string;
  ring: string;
  label: string;
} {
  if (pct == null) {
    return { text: "text-muted-foreground", bg: "bg-muted/30", border: "border-muted", ring: "ring-muted", label: "Sem dado" };
  }
  if (pct >= LIMITE_SEGURO) {
    return {
      text: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
      border: "border-emerald-200 dark:border-emerald-900",
      ring: "ring-emerald-500",
      label: "Sem risco de glosa",
    };
  }
  if (pct >= LIMITE_ALERTA) {
    return {
      text: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-950/30",
      border: "border-amber-200 dark:border-amber-900",
      ring: "ring-amber-500",
      label: "Risco moderado",
    };
  }
  return {
    text: "text-red-600 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-950/30",
    border: "border-red-200 dark:border-red-900",
    ring: "ring-red-500",
    label: "Risco alto de glosa",
  };
}

function iconRisco(risco: "baixo" | "medio" | "alto") {
  if (risco === "alto") return <ShieldX className="h-5 w-5 text-red-600 dark:text-red-400" />;
  if (risco === "medio") return <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400" />;
  return <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}

// ---------- componente ----------

type ConservadorResp = Awaited<ReturnType<typeof apiService.getIptConservador>>;
type EvolucaoResp = Awaited<ReturnType<typeof apiService.getIptServicoEvolucao>>;

export default function IptConservadorPage() {
  const hoje = new Date();
  const [periodoInicial, setPeriodoInicial] = useState(format(startOfMonth(hoje), "yyyy-MM-dd"));
  const [periodoFinal, setPeriodoFinal] = useState(format(endOfMonth(hoje), "yyyy-MM-dd"));
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ConservadorResp | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // SELIMP oficial (preenchido por mes na tabela ipt_oficial_mensal — entrada manual por enquanto)
  const [selimpOficial, setSelimpOficial] = useState<string>("");

  // Servico selecionado + evolucao
  const [servicos, setServicos] = useState<Array<{ tipo_servico: string; metric_key: string }>>([]);
  const [servicoSelecionado, setServicoSelecionado] = useState<string>("");
  const [evolucao, setEvolucao] = useState<EvolucaoResp | null>(null);
  const [loadingEvolucao, setLoadingEvolucao] = useState(false);

  // Buscar dados principais
  const carregar = async () => {
    setLoading(true);
    setErro(null);
    try {
      const [res, servs] = await Promise.all([
        apiService.getIptConservador(periodoInicial, periodoFinal),
        apiService.getIptServicosDisponiveis(periodoInicial, periodoFinal),
      ]);
      setData(res);
      setServicos(servs.servicos);
      if (!servicoSelecionado && servs.servicos.length > 0) {
        setServicoSelecionado(servs.servicos[0].tipo_servico);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Falha ao carregar IPT conservador";
      setErro(msg);
    } finally {
      setLoading(false);
    }
  };

  // Buscar evolucao do servico
  const carregarEvolucao = async (servico: string) => {
    if (!servico) return;
    setLoadingEvolucao(true);
    try {
      const res = await apiService.getIptServicoEvolucao(periodoInicial, periodoFinal, servico);
      setEvolucao(res);
    } catch {
      setEvolucao(null);
    } finally {
      setLoadingEvolucao(false);
    }
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (servicoSelecionado) carregarEvolucao(servicoSelecionado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicoSelecionado]);

  const otimista = useMemo(() => {
    if (!data) return null;
    return data.variantes.find((v) => v.id === data.recomendacao.otimista)?.percentual ?? null;
  }, [data]);

  const conservador = useMemo(() => {
    if (!data) return null;
    return data.variantes.find((v) => v.id === data.recomendacao.conservador)?.percentual ?? null;
  }, [data]);

  const selimpNum = useMemo(() => {
    const n = Number(selimpOficial.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [selimpOficial]);

  const corOtim = corPorPercentual(otimista);
  const corCons = corPorPercentual(conservador);
  const corSel = corPorPercentual(selimpNum);

  // Dados do grafico de evolucao
  const chartData = useMemo(() => {
    if (!evolucao || evolucao.pontos.length === 0) return null;
    const labels = evolucao.pontos.map((p) =>
      format(new Date(p.data + "T12:00:00"), "dd/MM", { locale: ptBR }),
    );
    return {
      labels,
      datasets: [
        {
          label: "% Com zeros",
          data: evolucao.pontos.map((p) => p.percentual_com_zeros),
          borderColor: "rgb(239, 68, 68)",
          backgroundColor: "rgba(239, 68, 68, 0.1)",
          tension: 0.3,
        },
        {
          label: "% Sem zeros",
          data: evolucao.pontos.map((p) => p.percentual_sem_zeros),
          borderColor: "rgb(59, 130, 246)",
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          tension: 0.3,
        },
        {
          label: "Limite seguro (90%)",
          data: evolucao.pontos.map(() => LIMITE_SEGURO),
          borderColor: "rgb(34, 197, 94)",
          borderDash: [5, 5],
          pointRadius: 0,
          tension: 0,
        },
      ],
    };
  }, [evolucao]);

  return (
    <MainLayout>
      <div className="container mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="h-6 w-6" />
              IPT — Otimista vs Conservador
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Acompanhamento de risco de glosa. O conservador eh um proxy SELIMP calibrado para
              evitar surpresa no fechamento mensal (limite seguro: 90%).
            </p>
          </div>
          <Button onClick={carregar} disabled={loading} variant="outline" size="sm">
            <RefreshCcw className="h-4 w-4 mr-2" /> {loading ? "Carregando..." : "Atualizar"}
          </Button>
        </div>

        {/* Filtros */}
        <Card>
          <CardContent className="pt-6 flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Periodo inicial</Label>
              <DatePicker value={periodoInicial} onChange={setPeriodoInicial} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Periodo final</Label>
              <DatePicker value={periodoFinal} onChange={setPeriodoFinal} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>SELIMP oficial (manual)</Label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="Ex.: 65,30"
                value={selimpOficial}
                onChange={(e) => setSelimpOficial(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <Button onClick={carregar} disabled={loading}>
              {loading ? "Carregando..." : "Aplicar"}
            </Button>
          </CardContent>
        </Card>

        {erro && (
          <Card className="border-red-200 dark:border-red-900">
            <CardContent className="pt-6 text-red-600 dark:text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> {erro}
            </CardContent>
          </Card>
        )}

        {/* Cards principais */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Otimista */}
          <Card className={`${corOtim.border} border-2`}>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center justify-between">
                <span>IPT Otimista (sistema atual)</span>
                <Badge variant="outline" className="text-xs">v1</Badge>
              </CardDescription>
              <CardTitle className={`text-4xl ${corOtim.text}`}>{fmtPct(otimista)}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Calculo atual em producao (blend + cobertura forcada). Tende a inflar em meses com
                muitos zeros.
              </p>
            </CardContent>
          </Card>

          {/* Conservador */}
          <Card className={`${corCons.border} border-2`}>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center justify-between">
                <span>IPT Conservador (proxy SELIMP)</span>
                <Badge variant="outline" className="text-xs">v7</Badge>
              </CardDescription>
              <CardTitle className={`text-4xl ${corCons.text}`}>{fmtPct(conservador)}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Media linha-a-linha com zeros + media por plano com zeros. Numero mais proximo da
                apuracao SELIMP.
              </p>
            </CardContent>
          </Card>

          {/* SELIMP Oficial */}
          <Card className={`${corSel.border} border-2`}>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center justify-between">
                <span>SELIMP Oficial</span>
                <Badge variant="outline" className="text-xs">Manual</Badge>
              </CardDescription>
              <CardTitle className={`text-4xl ${corSel.text}`}>{fmtPct(selimpNum)}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Valor apurado pela SELIMP. Preencher no campo acima quando divulgado.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Risco de glosa */}
        {data && (
          <Card className={`${corPorPercentual(conservador).bg} border-2`}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                {iconRisco(data.recomendacao.risco_glosa)} Risco de glosa: {data.recomendacao.risco_glosa.toUpperCase()}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">{data.recomendacao.justificativa}</p>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Gap otimista vs conservador:</span>{" "}
                  <span className="font-semibold">{data.recomendacao.gap_pp.toFixed(2)}pp</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Limite seguro:</span>{" "}
                  <span className="font-semibold">≥ 90% (40 pontos ADC)</span>
                </div>
              </div>
              {/* Barra de progresso simples */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>0%</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">90% (seguro)</span>
                  <span>100%</span>
                </div>
                <div className="relative h-3 bg-muted rounded overflow-hidden">
                  <div
                    className={`absolute inset-y-0 left-0 ${conservador != null && conservador >= LIMITE_SEGURO ? "bg-emerald-500" : conservador != null && conservador >= LIMITE_ALERTA ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${Math.min(100, Math.max(0, conservador ?? 0))}%` }}
                  />
                  {/* Marca do limite seguro */}
                  <div className="absolute inset-y-0 left-[90%] w-px bg-emerald-700 dark:bg-emerald-300" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Variantes detalhadas */}
        {data && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Todas as variantes calculadas</CardTitle>
              <CardDescription>
                Cada linha eh uma forma diferente de calcular o IPT a partir da mesma base de dados.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-2 pr-3">Variante</th>
                      <th className="py-2 pr-3">Descricao</th>
                      <th className="py-2 pr-3 text-right">%</th>
                      <th className="py-2 pr-3 text-right">Pontos IPT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.variantes.map((v) => {
                      const isOtim = v.id === data.recomendacao.otimista;
                      const isCons = v.id === data.recomendacao.conservador;
                      const cor = corPorPercentual(v.percentual);
                      return (
                        <tr key={v.id} className="border-b last:border-0">
                          <td className="py-2 pr-3 font-mono text-xs">
                            {v.id}
                            {isOtim && <Badge className="ml-2 text-xs">Otimista</Badge>}
                            {isCons && <Badge className="ml-2 text-xs" variant="secondary">Conservador</Badge>}
                          </td>
                          <td className="py-2 pr-3 text-xs text-muted-foreground">{v.descricao}</td>
                          <td className={`py-2 pr-3 text-right font-medium ${cor.text}`}>{fmtPct(v.percentual)}</td>
                          <td className="py-2 pr-3 text-right">{v.pontuacao ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Diagnostico */}
        {data && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Info className="h-4 w-4" /> Diagnostico operacional
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground">Linhas totais</div>
                  <div className="text-2xl font-semibold">{data.diagnostico.total_linhas.toLocaleString("pt-BR")}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Linhas zeradas</div>
                  <div className={`text-2xl font-semibold ${data.diagnostico.pct_linhas_zeradas > 20 ? "text-red-600" : ""}`}>
                    {data.diagnostico.linhas_zeradas.toLocaleString("pt-BR")}{" "}
                    <span className="text-sm font-normal text-muted-foreground">({data.diagnostico.pct_linhas_zeradas}%)</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Planos distintos</div>
                  <div className="text-2xl font-semibold">{data.diagnostico.planos_distintos.toLocaleString("pt-BR")}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Planos 100% zerados</div>
                  <div className={`text-2xl font-semibold ${data.diagnostico.pct_planos_zerados > 10 ? "text-red-600" : ""}`}>
                    {data.diagnostico.planos_totalmente_zerados}{" "}
                    <span className="text-sm font-normal text-muted-foreground">({data.diagnostico.pct_planos_zerados}%)</span>
                  </div>
                </div>
              </div>

              {data.diagnostico.subprefeituras_criticas.length > 0 && (
                <div>
                  <div className="text-sm font-medium mb-2">Subprefeituras criticas (menor % com zeros)</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-muted-foreground border-b">
                        <tr>
                          <th className="py-1.5 pr-3">Subprefeitura</th>
                          <th className="py-1.5 pr-3 text-right">% com zeros</th>
                          <th className="py-1.5 pr-3 text-right">Planos</th>
                          <th className="py-1.5 pr-3 text-right">Zeros</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.diagnostico.subprefeituras_criticas.map((s) => (
                          <tr key={s.subprefeitura} className="border-b last:border-0">
                            <td className="py-1.5 pr-3">{s.subprefeitura}</td>
                            <td className={`py-1.5 pr-3 text-right ${s.media_com_zeros < 50 ? "text-red-600 font-medium" : ""}`}>
                              {s.media_com_zeros.toFixed(2)}%
                            </td>
                            <td className="py-1.5 pr-3 text-right">{s.planos}</td>
                            <td className="py-1.5 pr-3 text-right">{s.zeros}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Evolucao por servico */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <CardTitle className="text-base">Evolucao por servico</CardTitle>
                <CardDescription>
                  Snapshots gravados a cada upload de planilha. Sem dados artificiais — cada ponto
                  eh o valor real registrado naquele dia.
                </CardDescription>
              </div>
              <div className="min-w-[280px]">
                <Select value={servicoSelecionado} onValueChange={setServicoSelecionado}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um servico" />
                  </SelectTrigger>
                  <SelectContent>
                    {servicos.map((s) => (
                      <SelectItem key={s.metric_key} value={s.tipo_servico}>
                        {s.tipo_servico}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingEvolucao ? (
              <div className="h-72 flex items-center justify-center text-muted-foreground">Carregando...</div>
            ) : chartData ? (
              <div className="h-80">
                <Line
                  data={chartData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: "index", intersect: false },
                    scales: {
                      y: {
                        min: 0,
                        max: 100,
                        ticks: { callback: (v) => `${v}%` },
                      },
                    },
                    plugins: {
                      legend: { position: "top" },
                      tooltip: {
                        callbacks: {
                          label: (ctx) =>
                            `${ctx.dataset.label}: ${ctx.parsed.y != null ? `${(ctx.parsed.y as number).toFixed(2)}%` : "—"}`,
                          afterLabel: (ctx) => {
                            const ponto = evolucao?.pontos[ctx.dataIndex];
                            if (!ponto) return "";
                            return [
                              `Despachos: ${ponto.despachos}`,
                              `Zerados: ${ponto.zerados}`,
                              `Planos: ${ponto.planos}`,
                            ];
                          },
                        },
                      },
                    },
                  }}
                />
              </div>
            ) : (
              <div className="h-72 flex flex-col items-center justify-center text-muted-foreground gap-2">
                <AlertTriangle className="h-8 w-8" />
                <div>Sem snapshots no periodo.</div>
                <div className="text-xs">Importe planilhas consolidadas para gerar dados de evolucao.</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
