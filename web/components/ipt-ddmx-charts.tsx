"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useTheme } from "next-themes"
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from "chart.js"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartMonthNav } from "@/components/chart-month-nav"
import { apiService, type DdmxSerieResponse } from "@/lib/api"

const Chart = dynamic(() => import("react-chartjs-2").then((mod) => mod.Chart), { ssr: false })
const Bar = dynamic(() => import("react-chartjs-2").then((mod) => mod.Bar), { ssr: false })

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler)

/** Corte de execução usado no IPT Geral. */
const META_EXECUCAO = 80

interface Props {
  inicio: string
  fim: string
  monthLabel: string
  onPrevMonth: () => void
  onNextMonth: () => void
  disableNextMonth?: boolean
}

const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}%`)

/**
 * Gráficos IPT do Dashboard, só com DDMX (a CLIMP não publica mais o report):
 * evolução diária (despachos + % dia + % acumulado) e execução por serviço.
 */
export function IptDdmxCharts({ inicio, fim, monthLabel, onPrevMonth, onNextMonth, disableNextMonth }: Props) {
  const chave = `${inicio}|${fim}`
  const [resp, setResp] = useState<{ chave: string; data: DdmxSerieResponse | null } | null>(null)
  const loading = resp?.chave !== chave
  const data = loading ? null : resp?.data ?? null
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    let cancel = false
    apiService
      .getDdmxSerie(inicio, fim)
      .then((r) => !cancel && setResp({ chave, data: r }))
      .catch(() => !cancel && setResp({ chave, data: null }))
    return () => {
      cancel = true
    }
  }, [inicio, fim, chave])

  const serie = data?.serie ?? []
  const servicos = useMemo(
    () => [...(data?.servicos ?? [])].filter((s) => s.percentual != null).sort((a, b) => (a.percentual ?? 0) - (b.percentual ?? 0)),
    [data],
  )
  const ultimo = serie[serie.length - 1]
  const totalDespachos = ultimo?.despachosAcumulados ?? 0
  const totalZerados = ultimo?.zeradosAcumulados ?? 0
  const abaixoMeta = servicos.reduce((acc, s) => acc + s.abaixo80, 0)

  const isDark = resolvedTheme === "dark"
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"
  const tickColor = isDark ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.65)"
  const tooltip = {
    backgroundColor: isDark ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.95)",
    titleColor: tickColor,
    bodyColor: tickColor,
    borderColor: gridColor,
    borderWidth: 1,
    padding: 10,
  }

  const evolucaoData = {
    labels: serie.map((p) => p.data.slice(8, 10) + "/" + p.data.slice(5, 7)),
    datasets: [
      {
        type: "line" as const,
        label: "% acumulado",
        data: serie.map((p) => p.percentualAcumulado),
        borderColor: "rgb(139, 92, 246)",
        backgroundColor: "rgba(139, 92, 246, 0.12)",
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        yAxisID: "y",
      },
      {
        type: "line" as const,
        label: "% do dia",
        data: serie.map((p) => p.percentualDia),
        borderColor: "rgb(20, 184, 166)",
        borderDash: [4, 4],
        tension: 0.3,
        pointRadius: 2,
        yAxisID: "y",
      },
      {
        type: "bar" as const,
        label: "Despachos",
        data: serie.map((p) => p.despachos),
        backgroundColor: "rgba(59, 130, 246, 0.35)",
        borderRadius: 4,
        yAxisID: "y1",
      },
      {
        type: "bar" as const,
        label: "Zerados",
        data: serie.map((p) => p.zerados),
        backgroundColor: "rgba(244, 63, 94, 0.6)",
        borderRadius: 4,
        yAxisID: "y1",
      },
    ],
  }

  const evolucaoOptions: ChartOptions<"bar" | "line"> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "top", labels: { color: tickColor, boxWidth: 12 } },
      tooltip: {
        ...tooltip,
        callbacks: {
          label: (ctx) =>
            ctx.dataset.yAxisID === "y"
              ? `${ctx.dataset.label}: ${pct(ctx.parsed.y as number | null)}`
              : `${ctx.dataset.label}: ${ctx.parsed.y}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: tickColor } },
      y: {
        position: "left",
        min: 0,
        max: 100,
        grid: { color: gridColor },
        ticks: { color: tickColor, callback: (v) => `${v}%` },
      },
      y1: { position: "right", grid: { display: false }, ticks: { color: tickColor, precision: 0 } },
    },
  }

  const servicosData = {
    labels: servicos.map((s) => s.servico),
    datasets: [
      {
        label: "% com zerados",
        data: servicos.map((s) => s.percentual),
        backgroundColor: servicos.map((s) =>
          (s.percentual ?? 0) >= META_EXECUCAO ? "rgba(16, 185, 129, 0.75)" : "rgba(244, 63, 94, 0.7)",
        ),
        borderRadius: 4,
      },
      {
        label: "% sem zerados",
        data: servicos.map((s) => s.percentualSemZerados),
        backgroundColor: "rgba(148, 163, 184, 0.45)",
        borderRadius: 4,
      },
    ],
  }

  const servicosOptions: ChartOptions<"bar"> = {
    indexAxis: "y",
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "top", labels: { color: tickColor, boxWidth: 12 } },
      tooltip: {
        ...tooltip,
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${pct(ctx.parsed.x as number | null)}`,
          afterBody: (items) => {
            const s = servicos[items[0]?.dataIndex ?? -1]
            return s ? [`${s.despachos} despachos · ${s.planos} planos`, `${s.zerados} zerados · ${s.abaixo80} abaixo de ${META_EXECUCAO}%`] : []
          },
        },
      },
    },
    scales: {
      x: { min: 0, max: 100, grid: { color: gridColor }, ticks: { color: tickColor, callback: (v) => `${v}%` } },
      y: { grid: { display: false }, ticks: { color: tickColor, font: { size: 11 } } },
    },
  }

  const vazio = !loading && serie.length === 0
  const placeholder = (msg: string) => (
    <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">{msg}</div>
  )

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
      <Card className="h-full transition-shadow duration-200 hover:shadow-md xl:col-span-3">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-lg font-semibold text-violet-600 dark:text-violet-400">IPT — Execução diária (DDMX)</CardTitle>
            <ChartMonthNav label={monthLabel} onPrev={onPrevMonth} onNext={onNextMonth} disableNext={disableNextMonth} />
          </div>
          <CardDescription>
            Sem o report da CLIMP, a execução vem do rastreador DDMX: 1 despacho = 1 plano no dia.
          </CardDescription>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
            <span>
              Acumulado: <span className="font-semibold text-violet-600 dark:text-violet-400">{pct(ultimo?.percentualAcumulado)}</span>
            </span>
            <span>
              Sem zerados: <span className="font-semibold text-foreground">{pct(ultimo?.percentualAcumuladoSemZerados)}</span>
            </span>
            <span>
              Despachos: <span className="font-semibold text-foreground">{totalDespachos}</span>
            </span>
            <span>
              Zerados: <span className="font-semibold text-rose-500">{totalZerados}</span>
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {loading
            ? placeholder("Carregando gráfico...")
            : vazio
              ? placeholder("Ainda não há despachos DDMX neste período.")
              : (
                <div className="h-72">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <Chart type="bar" data={evolucaoData as any} options={evolucaoOptions as any} />
                </div>
              )}
        </CardContent>
      </Card>

      <Card className="h-full transition-shadow duration-200 hover:shadow-md xl:col-span-2">
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-lg font-semibold text-emerald-600">IPT por serviço (DDMX)</CardTitle>
            <Link href="/ipt" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
              Abrir IPT Geral →
            </Link>
          </div>
          <CardDescription>
            Média de execução no mês. Vermelho = abaixo do corte de {META_EXECUCAO}%.
          </CardDescription>
          <div className="text-sm text-muted-foreground">
            Despachos abaixo de {META_EXECUCAO}%: <span className="font-semibold text-rose-500">{abaixoMeta}</span>
            {totalDespachos > 0 && (
              <span> ({((abaixoMeta / totalDespachos) * 100).toFixed(1)}% do total)</span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading
            ? placeholder("Carregando gráfico...")
            : servicos.length === 0
              ? placeholder("Sem execução DDMX por serviço.")
              : (
                <div style={{ height: Math.max(288, servicos.length * 34) }}>
                  <Bar data={servicosData} options={servicosOptions} />
                </div>
              )}
        </CardContent>
      </Card>
    </div>
  )
}
