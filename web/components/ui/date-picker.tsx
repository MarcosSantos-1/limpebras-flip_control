"use client"

import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { Calendar as CalendarIcon, ChevronsUpDown, X, CalendarClock } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface DatePickerProps {
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  /** Botão estreito (ex.: barras de filtro em uma linha) — não usa largura total */
  compact?: boolean
}

function parseDateValue(value?: string) {
  if (!value) return undefined

  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) return undefined

  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function DatePicker({
  value,
  onChange,
  placeholder = "Selecione uma data",
  className,
  disabled,
  compact,
}: DatePickerProps) {
  const selectedDate = parseDateValue(value)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          className={cn(
            "justify-between bg-background font-normal shadow-sm",
            compact
              ? "h-8 w-auto max-w-[118px] min-w-0 shrink-0 gap-1 px-2 text-xs md:max-w-[124px]"
              : "w-full px-3 text-base md:text-sm",
            !selectedDate && "text-muted-foreground",
            className
          )}
          disabled={disabled}
        >
          <span className={cn("flex min-w-0 items-center", compact ? "gap-1" : "gap-2")}>
            <CalendarIcon
              className={cn("shrink-0 text-violet-500", compact ? "h-3 w-3" : "h-4 w-4")}
            />
            <span className="truncate tabular-nums">
              {selectedDate ? format(selectedDate, "dd/MM/yyyy", { locale: ptBR }) : placeholder}
            </span>
          </span>
          <ChevronsUpDown
            className={cn("shrink-0 opacity-50", compact ? "h-3 w-3" : "h-4 w-4")}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" sideOffset={8} collisionPadding={12}>
        <Calendar
          mode="single"
          locale={ptBR}
          selected={selectedDate}
          onSelect={(date) => onChange(date ? format(date, "yyyy-MM-dd") : "")}
          initialFocus
        />
        <div className="flex gap-2 border-t border-border p-2">
          <Button
            type="button"
            variant="ghost"
            className="flex-1 justify-center gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => onChange(format(new Date(), "yyyy-MM-dd"))}
          >
            <CalendarClock className="h-4 w-4 shrink-0" />
            Hoje
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="flex-1 justify-center gap-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
            onClick={() => onChange("")}
            disabled={!selectedDate}
          >
            <X className="h-4 w-4 shrink-0" />
            Limpar data
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
