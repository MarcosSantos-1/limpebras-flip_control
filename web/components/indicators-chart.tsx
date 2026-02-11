"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { useTheme } from "next-themes"

// Dynamic import para evitar problemas de SSR
const Line = dynamic(() => import("react-chartjs-2").then((mod) => mod.Line), {
  ssr: false,
})

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ChartOptions,
} from "chart.js"

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

interface IndicatorsChartProps {
  data: any[]
}

export function IndicatorsChart({ data }: IndicatorsChartProps) {
  const [mounted, setMounted] = useState(false)
  const { theme } = useTheme()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Carregando gráfico...
      </div>
    )
  }

  const isDark = theme === "dark"
  const gridColor = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)"
  const textColor = isDark ? "rgba(255, 255, 255, 0.7)" : "rgba(0, 0, 0, 0.7)"

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-center px-8">
        Nenhum dado disponível para o período selecionado. Recalcule e salve os indicadores para liberar a evolução histórica.
      </div>
    )
  }

  const labels = data.map((item) => {
    try {
      // Tenta diferentes formatos de data
      let date: Date
      if (item.data) {
        date = new Date(item.data)
      } else if (item.periodo_inicial) {
        date = new Date(item.periodo_inicial)
      } else if (item.calculated_at) {
        date = new Date(item.calculated_at)
      } else {
        return "Data inválida"
      }
      
      if (isNaN(date.getTime())) {
        return item.data || "Data inválida"
      }
      return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
    } catch {
      return item.data || "Data inválida"
    }
  })

  const chartData = {
    labels,
    datasets: [
      {
        label: "IA (%)",
        data: data.map((item) => {
          // Tenta diferentes estruturas de dados
          if (item.ia?.valor !== undefined) return item.ia.valor
          if (item.indicadores?.ia?.valor !== undefined) return item.indicadores.ia.valor
          // Procura por tipo de indicador
          const iaItem = Array.isArray(item.indicadores) 
            ? item.indicadores.find((ind: any) => ind.tipo === "IA")
            : null
          return iaItem?.valor ?? null
        }),
        borderColor: "rgb(59, 130, 246)",
        backgroundColor: "rgba(59, 130, 246, 0.1)",
        fill: true,
        tension: 0.4,
      },
      {
        label: "IRD",
        data: data.map((item) => {
          if (item.ird?.valor !== undefined) return item.ird.valor
          if (item.indicadores?.ird?.valor !== undefined) return item.indicadores.ird.valor
          const irdItem = Array.isArray(item.indicadores) 
            ? item.indicadores.find((ind: any) => ind.tipo === "IRD")
            : null
          return irdItem?.valor ?? null
        }),
        borderColor: "rgb(16, 185, 129)",
        backgroundColor: "rgba(16, 185, 129, 0.1)",
        fill: true,
        tension: 0.4,
      },
      {
        label: "IF (%)",
        data: data.map((item) => {
          if (item.if?.valor !== undefined) return item.if.valor
          if (item.indicadores?.if?.valor !== undefined) return item.indicadores.if.valor
          const ifItem = Array.isArray(item.indicadores) 
            ? item.indicadores.find((ind: any) => ind.tipo === "IF")
            : null
          return ifItem?.valor ?? null
        }),
        borderColor: "rgb(251, 191, 36)",
        backgroundColor: "rgba(251, 191, 36, 0.1)",
        fill: true,
        tension: 0.4,
      },
      {
        label: "IPT (%)",
        data: data.map((item) => {
          if (item.ipt?.valor !== undefined) return item.ipt.valor
          if (item.indicadores?.ipt?.valor !== undefined) return item.indicadores.ipt.valor
          const iptItem = Array.isArray(item.indicadores) 
            ? item.indicadores.find((ind: any) => ind.tipo === "IPT")
            : null
          return iptItem?.valor ?? null
        }),
        borderColor: "rgb(168, 85, 247)",
        backgroundColor: "rgba(168, 85, 247, 0.1)",
        fill: true,
        tension: 0.4,
      },
    ],
  }

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top",
        labels: {
          color: textColor,
        },
      },
      tooltip: {
        mode: "index",
        intersect: false,
        titleColor: textColor,
        bodyColor: textColor,
        backgroundColor: isDark ? "rgba(0, 0, 0, 0.8)" : "rgba(255, 255, 255, 0.8)",
        borderColor: gridColor,
        borderWidth: 1,
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
        beginAtZero: true,
        max: 100,
        grid: {
          color: gridColor,
        },
        ticks: {
          color: textColor,
        },
      },
    },
  }

  return (
    <div className="h-96">
      <Line data={chartData} options={options} />
    </div>
  )
}

