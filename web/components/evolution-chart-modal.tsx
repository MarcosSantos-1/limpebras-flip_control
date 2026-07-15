"use client"

import { useMemo } from "react"
import dynamic from "next/dynamic"
import { useTheme } from "next-themes"
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ChartOptions,
} from "chart.js"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/motion-ui/motion-dialog"

const Line = dynamic(() => import("react-chartjs-2").then((mod) => mod.Line), { ssr: false })

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

export type EvolutionSeriesPoint = {
  date: string
  value: number | null
  secondaryValue?: number | null
  dayValue?: number | null
  count?: number
  dayCount?: number
  plannedCount?: number
  plannedDayCount?: number
  coverageValue?: number | null
  dayCoverageValue?: number | null
  notDispatchedCount?: number
  notDispatchedDayCount?: number
  zeroCount?: number
  dayZeroCount?: number
  meta?: string
}

type EvolutionChartModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  primaryLabel: string
  secondaryLabel?: string
  points: EvolutionSeriesPoint[]
  loading?: boolean
  emptyMessage?: string
  valueSuffix?: string
  showPointDetails?: boolean
}

function formatDateLabel(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-")
  if (!year || !month || !day) return value
  return `${day}/${month}`
}

export function EvolutionChartModal({
  open,
  onOpenChange,
  title,
  description,
  primaryLabel,
  secondaryLabel,
  points,
  loading,
  emptyMessage = "Sem pontos históricos para este período.",
  valueSuffix = "%",
  showPointDetails = false,
}: EvolutionChartModalProps) {
  const { theme } = useTheme()

  const sortedPoints = useMemo(
    () => [...points].sort((a, b) => a.date.localeCompare(b.date)),
    [points]
  )

  const labels = sortedPoints.map((point) => formatDateLabel(point.date))
  const isDark = theme === "dark"
  const gridColor = isDark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.10)"
  const textColor = isDark ? "rgba(244,244,245,0.82)" : "rgba(39,39,42,0.78)"
  const tickStep = labels.length > 18 ? Math.ceil(labels.length / 9) : labels.length > 10 ? 2 : 1
  const hasSecondary = Boolean(secondaryLabel) && sortedPoints.some((point) => point.secondaryValue != null)

  const chartData = {
    labels,
    datasets: [
      {
        label: primaryLabel,
        data: sortedPoints.map((point) => point.value),
        borderColor: "rgb(14, 165, 233)",
        backgroundColor: "rgba(14, 165, 233, 0.14)",
        pointBackgroundColor: "rgb(14, 165, 233)",
        pointRadius: 3,
        pointHoverRadius: 5,
        fill: true,
        tension: 0.35,
        spanGaps: true,
      },
      ...(hasSecondary
        ? [
            {
              label: secondaryLabel,
              data: sortedPoints.map((point) => point.secondaryValue ?? null),
              borderColor: "rgb(16, 185, 129)",
              backgroundColor: "rgba(16, 185, 129, 0.10)",
              pointBackgroundColor: "rgb(16, 185, 129)",
              pointRadius: 3,
              pointHoverRadius: 5,
              fill: false,
              tension: 0.35,
              spanGaps: true,
            },
          ]
        : []),
    ],
  }

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "top",
        labels: { color: textColor, usePointStyle: true, boxWidth: 8 },
      },
      tooltip: {
        backgroundColor: isDark ? "rgba(9,9,11,0.94)" : "rgba(255,255,255,0.94)",
        titleColor: textColor,
        bodyColor: textColor,
        borderColor: gridColor,
        borderWidth: 1,
        padding: 12,
        callbacks: {
          title: (items) => {
            const index = items[0]?.dataIndex ?? 0
            const raw = sortedPoints[index]?.date ?? ""
            const [year, month, day] = raw.slice(0, 10).split("-")
            return year && month && day ? `${day}/${month}/${year}` : raw
          },
          label: (context) => {
            const value = context.parsed.y
            const suffix = valueSuffix ? valueSuffix : ""
            return `${context.dataset.label}: ${value == null ? "--" : `${value.toFixed(2)}${suffix}`}`
          },
          afterBody: (items) => {
            const index = items[0]?.dataIndex ?? 0
            const point = sortedPoints[index]
            const lines = []
            if (point?.count != null) lines.push(`Despachados: ${point.count}`)
            if (point?.plannedCount != null) lines.push(`Previstos: ${point.plannedCount}`)
            if (point?.coverageValue != null) lines.push(`Cobertura: ${point.coverageValue.toFixed(2)}%`)
            if (point?.meta) lines.push(point.meta)
            return lines
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: textColor,
          autoSkip: false,
          callback: (_value, index) => (index % tickStep === 0 ? labels[index] : ""),
          maxRotation: 0,
        },
      },
      y: {
        beginAtZero: true,
        suggestedMax: valueSuffix === "%" ? 100 : undefined,
        grid: { color: gridColor },
        ticks: {
          color: textColor,
          callback: (value) => `${value}${valueSuffix}`,
        },
      },
    },
  }

  const hasData = sortedPoints.some((point) => point.value != null || point.secondaryValue != null)
  const formatValue = (value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return "--"
    return `${value.toFixed(2)}${valueSuffix}`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-[1480px] max-h-[90vh] overflow-y-auto p-6 sm:p-7 animate-in fade-in zoom-in-95 duration-300">
        <DialogHeader>
          <DialogTitle className="text-xl">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="min-h-[360px] rounded-2xl border border-border/70 bg-card/80 p-5 shadow-sm">
          {loading ? (
            <div className="flex h-[320px] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <span className="h-8 w-8 rounded-full border-2 border-muted border-t-primary animate-spin" />
              Carregando evolução...
            </div>
          ) : !hasData ? (
            <div className="flex h-[320px] items-center justify-center px-8 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </div>
          ) : (
            <>
              <div className="h-[340px] sm:h-[380px]">
                <Line data={chartData} options={options} />
              </div>
              {showPointDetails && (
                <div className="mt-5 overflow-hidden rounded-xl border border-border/70 shadow-sm">
                  <table className="w-full table-fixed text-xs">
                    <thead className="sticky top-0 z-10 bg-muted/95 text-[11px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                      <tr>
                        <th className="px-2.5 py-2.5 text-left font-semibold">Data</th>
                        <th className="px-2.5 py-2.5 text-right font-semibold">% dia</th>
                        <th className="px-2.5 py-2.5 text-right font-semibold">% acum. c/ zeros</th>
                        <th className="px-2.5 py-2.5 text-right font-semibold">% acum. s/ zeros</th>
                        <th className="px-2.5 py-2.5 text-right font-semibold">% desp.</th>
                        <th className="px-2.5 py-2.5 text-right font-semibold">Prev. dia</th>
                        <th className="px-2.5 py-2.5 text-right font-semibold">Prev. acum.</th>
                        <th className="px-2.5 py-2.5 text-right font-semibold">Desp. dia</th>
                        <th className="px-2.5 py-2.5 text-right font-semibold">Desp. acum.</th>
                        <th className="px-2.5 py-2.5 text-right font-semibold">Nao desp.</th>
                        <th className="px-2.5 py-2.5 text-right font-semibold">Zerados acum.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {sortedPoints.map((point) => (
                        <tr
                          key={`${point.date}-${point.count ?? 0}`}
                          className="odd:bg-background/60 even:bg-muted/15 transition-colors hover:bg-emerald-500/5"
                        >
                          <td className="whitespace-nowrap px-2.5 py-2 font-medium text-foreground">{formatDateLabel(point.date)}</td>
                          <td className="px-2.5 py-2 text-right tabular-nums">{formatValue(point.dayValue)}</td>
                          <td className="px-2.5 py-2 text-right tabular-nums">{formatValue(point.value)}</td>
                          <td className="px-2.5 py-2 text-right tabular-nums">{formatValue(point.secondaryValue)}</td>
                          <td className="px-2.5 py-2 text-right tabular-nums">{formatValue(point.coverageValue)}</td>
                          <td className="px-2.5 py-2 text-right tabular-nums">{point.plannedDayCount ?? "--"}</td>
                          <td className="px-2.5 py-2 text-right tabular-nums">{point.plannedCount ?? "--"}</td>
                          <td className="px-2.5 py-2 text-right tabular-nums">{point.dayCount ?? "--"}</td>
                          <td className="px-2.5 py-2 text-right tabular-nums">{point.count ?? "--"}</td>
                          <td className="px-2.5 py-2 text-right tabular-nums">{point.notDispatchedCount ?? "--"}</td>
                          <td className="px-2.5 py-2 text-right tabular-nums">{point.zeroCount ?? "--"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
