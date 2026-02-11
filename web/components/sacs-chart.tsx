"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { useTheme } from "next-themes"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartMonthNav } from "@/components/chart-month-nav"

// Dynamic import para evitar problemas de SSR
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

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
)

interface SACsChartProps {
  data: { date: string; count: number }[]
  monthLabel: string
  onPrevMonth: () => void
  onNextMonth: () => void
  disableNextMonth?: boolean
  todayCount?: number
}

export function SACsChart({
  data,
  monthLabel,
  onPrevMonth,
  onNextMonth,
  disableNextMonth,
  todayCount,
}: SACsChartProps) {
  const [mounted, setMounted] = useState(false)
  const { theme } = useTheme()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-primary">SACs</CardTitle>
          <CardDescription>Sistema de Atendimento ao Cidadão</CardDescription>
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
  const textColor = isDark ? "rgba(255, 255, 255, 0.7)" : "rgba(0, 0, 0, 0.7)"
  const monthlyTotal = data.reduce((acc, item) => acc + (item.count || 0), 0)
  const hasActivity = data.some((item) => item.count > 0)

  const labels = data.map((item) => {
    try {
      const date = new Date(item.date)
      if (isNaN(date.getTime())) {
        return item.date
      }
      return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
    } catch {
      return item.date
    }
  })

  const chartData = {
    labels,
    datasets: [
      {
        label: "SACs por dia",
        data: data.map((item) => item.count),
        backgroundColor: "rgba(59, 130, 246, 0.6)",
        borderColor: "rgb(59, 130, 246)",
        borderWidth: 2,
        borderRadius: 4,
      },
    ],
  }

  const options: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: isDark ? "rgba(0, 0, 0, 0.8)" : "rgba(255, 255, 255, 0.8)",
        titleColor: textColor,
        bodyColor: textColor,
        borderColor: gridColor,
        borderWidth: 1,
        padding: 12,
        callbacks: {
          label: function(context) {
            return `SACs: ${context.parsed.y}`
          }
        }
      },
    },
    scales: {
      x: {
        grid: {
          color: gridColor,
          display: false,
        },
        ticks: {
          color: textColor,
          maxRotation: 45,
          minRotation: 45,
        },
      },
      y: {
        beginAtZero: true,
        grid: {
          color: gridColor,
        },
        ticks: {
          color: textColor,
          stepSize: 1,
        },
      },
    },
  }

  return (
    <Card className="h-full hover:shadow-md transition-shadow duration-200">
      <CardHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg font-semibold text-primary">SACs</CardTitle>
                <ChartMonthNav
                  label={monthLabel}
                  onPrev={onPrevMonth}
                  onNext={onNextMonth}
                  disableNext={disableNextMonth}
                />
              </div>
              <CardDescription>Sistema de Atendimento ao Cidadão</CardDescription>
            </div>
            <div className="text-right text-sm">
              <p className="text-muted-foreground">Total no mês</p>
              <p className="text-2xl font-semibold text-primary">{monthlyTotal}</p>
              {todayCount !== undefined && (
                <span className="text-xs text-muted-foreground">Hoje: {todayCount}</span>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!hasActivity ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            Nenhum dado disponível para o período selecionado.
          </div>
        ) : (
          <div className="h-64">
            <Bar data={chartData} options={options} />
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-4">
          SACs são solicitações de serviços de limpeza urbana registradas pelos cidadãos através do sistema FLIP.
        </p>
      </CardContent>
    </Card>
  )
}

