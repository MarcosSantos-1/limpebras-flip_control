"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { useTheme } from "next-themes"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartMonthNav } from "@/components/chart-month-nav"

const Chart = dynamic(() => import("react-chartjs-2").then((mod) => mod.Chart), {
  ssr: false,
})

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
} from "chart.js"

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
)

export interface SACDemandantesResponseDatum {
  date: string
  avgHours: number | null
  foraPrazoCount: number
  volume: number
}

interface SACDemandantesResponseChartProps {
  data: SACDemandantesResponseDatum[]
  monthLabel: string
  onPrevMonth: () => void
  onNextMonth: () => void
  disableNextMonth?: boolean
}

export function SACDemandantesResponseChart({
  data,
  monthLabel,
  onPrevMonth,
  onNextMonth,
  disableNextMonth,
}: SACDemandantesResponseChartProps) {
  const [mounted, setMounted] = useState(false)
  const { theme } = useTheme()

  useEffect(() => {
    setMounted(true)
  }, [])

  const stats = useMemo(() => {
    const entriesWithAvg = data.filter((item) => item.avgHours !== null)
    const avgHours =
      entriesWithAvg.length > 0
        ? entriesWithAvg.reduce((acc, item) => acc + (item.avgHours ?? 0), 0) / entriesWithAvg.length
        : null
    const totalDemandantes = data.reduce((acc, item) => acc + item.volume, 0)
    const totalForaPrazo = data.reduce((acc, item) => acc + item.foraPrazoCount, 0)
    return { avgHours, totalDemandantes, totalForaPrazo }
  }, [data])

  if (!mounted) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-purple-600">
            Prazo de Resposta - Demandantes
          </CardTitle>
          <CardDescription>Média diária do tempo até execução</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Carregando gráfico...
          </div>
        </CardContent>
      </Card>
    )
  }

  const isDark = theme === "dark"
  const gridColor = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)"
  const textColor = isDark ? "rgba(255, 255, 255, 0.7)" : "rgba(0, 0, 0, 0.7)"
  const labels = data.map((item) => {
    try {
      const date = new Date(item.date)
      return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
    } catch {
      return item.date
    }
  })

  const hasActivity = data.some(
    (item) => (item.avgHours ?? 0) > 0 || item.volume > 0 || item.foraPrazoCount > 0
  )
  const maxCount = Math.max(
    0,
    ...data.map((item) => Math.max(item.volume, item.foraPrazoCount ?? 0))
  )

  const chartData = {
    labels,
    datasets: [
      {
        type: "line" as const,
        label: "Tempo médio até execução (h)",
        data: data.map((item) => item.avgHours),
        borderColor: "rgb(147, 51, 234)",
        backgroundColor: "rgba(147, 51, 234, 0.2)",
        tension: 0.4,
        yAxisID: "y",
        spanGaps: true,
        borderWidth: 2,
        pointRadius: 2,
      },
      {
        type: "bar" as const,
        label: "Fora do prazo (Qtd)",
        data: data.map((item) => item.foraPrazoCount),
        backgroundColor: "rgba(239, 68, 68, 0.5)",
        borderColor: "rgb(239, 68, 68)",
        borderWidth: 1.2,
        borderRadius: 4,
        yAxisID: "y1",
      },
      {
        type: "bar" as const,
        label: "Demandantes (Qtd)",
        data: data.map((item) => item.volume),
        backgroundColor: "rgba(59, 130, 246, 0.35)",
        borderColor: "rgb(59, 130, 246)",
        borderWidth: 1.2,
        borderRadius: 4,
        yAxisID: "y1",
      },
    ],
  }

  const options: ChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index",
      intersect: false,
    },
    plugins: {
      legend: {
        position: "top",
        labels: {
          color: textColor,
        },
      },
      tooltip: {
        backgroundColor: isDark ? "rgba(0, 0, 0, 0.85)" : "rgba(255, 255, 255, 0.85)",
        titleColor: textColor,
        bodyColor: textColor,
        borderColor: gridColor,
        borderWidth: 1,
        padding: 12,
      },
    },
    scales: {
      x: {
        grid: {
          color: gridColor,
        },
        ticks: {
          color: textColor,
        },
      },
      y: {
        type: "linear",
        position: "left",
        beginAtZero: true,
        grid: {
          color: gridColor,
        },
        ticks: {
          color: textColor,
        },
        title: {
          display: true,
          text: "Horas",
          color: textColor,
        },
      },
      y1: {
        type: "linear",
        position: "right",
        beginAtZero: true,
        grid: {
          drawOnChartArea: false,
        },
        ticks: {
          color: textColor,
        },
        title: {
          display: true,
          text: "Quantidade de SACs",
          color: textColor,
        },
        suggestedMax: maxCount > 0 ? maxCount * 1.2 : 10,
      },
    },
  }

  return (
    <Card className="h-full hover:shadow-md transition-shadow duration-200">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg font-semibold text-purple-600">
                Prazo de Resposta - Demandantes
              </CardTitle>
              <ChartMonthNav
                label={monthLabel}
                onPrev={onPrevMonth}
                onNext={onNextMonth}
                disableNext={disableNextMonth}
              />
            </div>
            <CardDescription>Média diária do tempo até execução</CardDescription>
          </div>
          <div className="text-right text-sm">
            <p className="text-muted-foreground">Média do mês</p>
            <p className="text-2xl font-semibold text-foreground">
              {stats.avgHours !== null ? `${stats.avgHours.toFixed(1)}h` : "--"}
            </p>
            <p className="text-xs text-muted-foreground">
              Fora do prazo: {stats.totalForaPrazo} / {stats.totalDemandantes} demandantes
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!hasActivity ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Ainda não há execuções registradas neste período.
          </div>
        ) : (
          <div className="h-72">
            <Chart type="line" data={chartData} options={options} />
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Indicador calculado apenas para demandantes procedentes. Use a curva para monitorar riscos de
          estouro de prazo e priorizar equipes.
        </p>
      </CardContent>
    </Card>
  )
}

