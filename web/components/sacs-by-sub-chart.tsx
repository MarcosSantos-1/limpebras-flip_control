"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { useTheme } from "next-themes"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SUBPREFEITURAS } from "@/constants/sacs"
import { ChartMonthNav } from "@/components/chart-month-nav"

const Bar = dynamic(() => import("react-chartjs-2").then((mod) => mod.Bar), {
  ssr: false,
})

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
} from "chart.js"

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

export interface SACsBySubDatum {
  subprefeitura: string
  label: string
  demandantes: number
  escalonados: number
}

interface SACsBySubChartProps {
  data: SACsBySubDatum[]
  monthLabel: string
  onPrevMonth: () => void
  onNextMonth: () => void
  disableNextMonth?: boolean
}

export function SACsBySubChart({
  data,
  monthLabel,
  onPrevMonth,
  onNextMonth,
  disableNextMonth,
}: SACsBySubChartProps) {
  const [mounted, setMounted] = useState(false)
  const { theme } = useTheme()

  useEffect(() => {
    setMounted(true)
  }, [])

  const totals = useMemo(() => {
    return data.reduce(
      (acc, item) => {
        acc.demandantes += item.demandantes
        acc.escalonados += item.escalonados
        return acc
      },
      { demandantes: 0, escalonados: 0 }
    )
  }, [data])

  if (!mounted) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-amber-600">SACs por Subprefeitura</CardTitle>
          <CardDescription>Distribuição de Demandantes x Escalonados</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            Carregando gráfico...
          </div>
        </CardContent>
      </Card>
    )
  }

  const isDark = theme === "dark"
  const gridColor = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)"
  const tickColor = isDark ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.7)"

  const hasActivity = data.some((item) => item.demandantes > 0 || item.escalonados > 0)
  const labels = data.length
    ? data.map((item) => item.label)
    : SUBPREFEITURAS.map((sub) => sub.label)

  const chartData = {
    labels,
    datasets: [
      {
        label: "Demandantes",
        data: data.map((item) => item.demandantes),
        backgroundColor: "rgba(59, 130, 246, 0.7)",
        borderColor: "rgb(59, 130, 246)",
        borderWidth: 1.5,
        borderRadius: 6,
        barPercentage: 0.6,
      },
      {
        label: "Escalonados",
        data: data.map((item) => item.escalonados),
        backgroundColor: "rgba(16, 185, 129, 0.7)",
        borderColor: "rgb(16, 185, 129)",
        borderWidth: 1.5,
        borderRadius: 6,
        barPercentage: 0.6,
      },
    ],
  }

  const options: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top",
        labels: {
          color: tickColor,
        },
      },
      tooltip: {
        backgroundColor: isDark ? "rgba(0, 0, 0, 0.85)" : "rgba(255, 255, 255, 0.9)",
        titleColor: tickColor,
        bodyColor: tickColor,
        borderColor: gridColor,
        borderWidth: 1,
        padding: 12,
        callbacks: {
          label: (context) => `${context.dataset.label}: ${context.parsed.y ?? context.parsed.x}`,
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: tickColor,
        },
      },
      y: {
        grid: {
          color: gridColor,
        },
        ticks: {
          color: tickColor,
          precision: 0,
        },
      },
    },
  }

  return (
    <Card className="h-full hover:shadow-md transition-shadow duration-200">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg font-semibold text-amber-600">
                SACs por Subprefeitura
              </CardTitle>
              <ChartMonthNav
                label={monthLabel}
                onPrev={onPrevMonth}
                onNext={onNextMonth}
                disableNext={disableNextMonth}
              />
            </div>
            <CardDescription>Comparativo mensal de Demandantes x Escalonados</CardDescription>
          </div>
        </div>
        <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-sky-400" />
            Demandantes: <span className="font-semibold text-foreground">{totals.demandantes}</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
            Escalonados: <span className="font-semibold text-foreground">{totals.escalonados}</span>
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {!hasActivity ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            Ainda não há SACs registrados neste período.
          </div>
        ) : (
          <div className="h-72">
            <Bar data={chartData} options={options} />
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-4">
          As barras mostram o volume mensal de SACs Demandantes (serviços críticos com prazos de 12h/72h)
          e Escalonados (rotinas planejadas). Use esses números para direcionar equipes por território.
        </p>
      </CardContent>
    </Card>
  )
}

