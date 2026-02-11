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
  pendentes: number
  regularizados: number
  vistoria: number
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
    (item) => item.pendentes > 0 || item.regularizados > 0 || item.vistoria > 0
  )

  const totals = useMemo(() => {
    return data.reduce(
      (acc, item) => {
        acc.total += item.pendentes + item.regularizados + item.vistoria
        acc.pendentes += item.pendentes
        acc.regularizados += item.regularizados
        acc.vistoria += item.vistoria
        return acc
      },
      { total: 0, pendentes: 0, regularizados: 0, vistoria: 0 }
    )
  }, [data])

  if (!mounted) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-emerald-600">CNCs por Sub</CardTitle>
          <CardDescription>Distribuição mensal de BFS fiscalizados</CardDescription>
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
        label: "Pendentes / Urgentes",
        data: data.map((item) => item.pendentes),
        backgroundColor: "rgba(239, 68, 68, 0.7)",
        borderColor: "rgb(239, 68, 68)",
        borderWidth: 1.5,
        borderRadius: 6,
        barPercentage: 0.65,
      },
      {
        label: "Aguard. Vistoria",
        data: data.map((item) => item.vistoria),
        backgroundColor: "rgba(251, 191, 36, 0.7)",
        borderColor: "rgb(251, 191, 36)",
        borderWidth: 1.5,
        borderRadius: 6,
        barPercentage: 0.65,
      },
      {
        label: "Regularizados",
        data: data.map((item) => item.regularizados),
        backgroundColor: "rgba(34, 197, 94, 0.7)",
        borderColor: "rgb(34, 197, 94)",
        borderWidth: 1.5,
        borderRadius: 6,
        barPercentage: 0.65,
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
        stacked: true,
        grid: {
          color: gridColor,
        },
        ticks: {
          color: tickColor,
          precision: 0,
        },
      },
      y: {
        stacked: true,
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
                CNCs por Subprefeitura
              </CardTitle>
              <ChartMonthNav
                label={monthLabel}
                onPrev={onPrevMonth}
                onNext={onNextMonth}
                disableNext={disableNextMonth}
              />
            </div>
            <CardDescription>Distribuição mensal das BFS por status</CardDescription>
          </div>
          <div className="text-right text-sm">
            <p className="text-muted-foreground">Total no mês</p>
            <p className="text-2xl font-semibold text-foreground">{totals.total}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!hasActivity ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            Nenhuma CNC registrada neste período.
          </div>
        ) : (
          <div className="h-72">
            <Bar data={chartData} options={options} />
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Acompanhe onde os boletins permanecem pendentes para priorizar equipes de fiscalização e
          regularização.
        </p>
      </CardContent>
    </Card>
  )
}

