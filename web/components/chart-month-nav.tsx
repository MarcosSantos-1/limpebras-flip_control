"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"

interface ChartMonthNavProps {
  label: string
  onPrev: () => void
  onNext: () => void
  disableNext?: boolean
}

export function ChartMonthNav({ label, onPrev, onNext, disableNext }: ChartMonthNavProps) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="flex items-center gap-1">
        <span>-</span>
        <span className="font-medium text-foreground/80">{label}</span>
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onPrev}
          className="rounded-md border border-transparent p-1.5 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary/40"
          aria-label="Mês anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={disableNext}
          className="rounded-md border border-transparent p-1.5 hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary/40"
          aria-label="Próximo mês"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

