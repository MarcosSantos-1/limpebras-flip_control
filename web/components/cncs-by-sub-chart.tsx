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

export interface CNCsBySubDatum {
  subprefeitura: string
  label: string
  quantidade: number
  semIrregularidade: number
  comIrregularidade: number
}

interface CNCsBySubChartProps {
  data: CNCsBySubDatum[]
  monthLabel: string
  onPrevMonth: () => void
  onNextMonth: () => void
  disableNextMonth?: boolean
}

export function CNCsBySubChart({
  data,
  monthLabel,
  onPrevMonth,
  onNextMonth,
  disableNextMonth,
}: CNCsBySubChartProps) {
  const [mounted, setMounted] = useState(false)
  const { theme } = useTheme()

  useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = theme === "dark"
  const gridColor = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)"
  const tickColor = isDark ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.7)"
  const hasActivity = data.some(
    (item) => item.quantidade > 0 || item.semIrregularidade > 0 || item.comIrregularidade > 0
  )

  const totals = useMemo(() => {
    return data.reduce(
      (acc, item) => {
        acc.total += item.quantidade
        acc.semIrregularidade += item.semIrregularidade
        acc.comIrregularidade += item.comIrregularidade
        return acc
      },
      { total: 0, semIrregularidade: 0, comIrregularidade: 0 }
    )
  }, [data])

  if (!mounted) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-emerald-600">BFS por Subprefeitura</CardTitle>
          <CardDescription>Quantidade total de BFS por sub</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Carregando gráfico...
          </div>
        </CardContent>
      </Card>
    )
  }

  const labels = data.length
    ? data.map((item) => item.label)
    : SUBPREFEITURAS.map((sub) => sub.label)

  const chartData = {
    labels,
    datasets: [
      {
        label: "Quantidade de BFS",
        data: data.map((item) => item.quantidade),
        backgroundColor: "rgba(16, 185, 129, 0.7)",
        borderColor: "rgb(16, 185, 129)",
        borderWidth: 1.5,
        borderRadius: 6,
        barPercentage: 0.55,
      },
      {
        label: "BFS sem irregularidade",
        data: data.map((item) => item.semIrregularidade),
        backgroundColor: "rgba(59, 130, 246, 0.65)",
        borderColor: "rgb(59, 130, 246)",
        borderWidth: 1.2,
        borderRadius: 6,
        barPercentage: 0.55,
      },
      {
        label: "BFS com irregularidade",
        data: data.map((item) => item.comIrregularidade),
        backgroundColor: "rgba(244, 63, 94, 0.65)",
        borderColor: "rgb(244, 63, 94)",
        borderWidth: 1.2,
        borderRadius: 6,
        barPercentage: 0.55,
      },
    ],
  }

  const options: ChartOptions<"bar"> = {
    indexAxis: "y",
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
        backgroundColor: isDark ? "rgba(0, 0, 0, 0.85)" : "rgba(255, 255, 255, 0.85)",
        titleColor: tickColor,
        bodyColor: tickColor,
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
          color: tickColor,
          precision: 0,
        },
      },
      y: {
        grid: {
          display: false,
        },
        ticks: {
          color: tickColor,
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
              <CardTitle className="text-lg font-semibold text-emerald-600">
                BFS por Subprefeitura
              </CardTitle>
              <ChartMonthNav
                label={monthLabel}
                onPrev={onPrevMonth}
                onNext={onNextMonth}
                disableNext={disableNextMonth}
              />
            </div>
            <CardDescription>Quantidade mensal de BFS registradas por sub</CardDescription>
          </div>
          <div className="text-right text-sm">
            <p className="text-muted-foreground">Total no mês</p>
            <p className="text-2xl font-semibold text-foreground">{totals.total}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Sem irreg.: {totals.semIrregularidade} | Com irreg.: {totals.comIrregularidade}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!hasActivity ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Nenhuma BFS registrada neste período.
          </div>
        ) : (
          <div className="h-72">
            <Bar data={chartData} options={options} />
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Use este ranking para distribuir equipes e fiscalizações conforme volume por território.
        </p>
      </CardContent>
    </Card>
  )
}

