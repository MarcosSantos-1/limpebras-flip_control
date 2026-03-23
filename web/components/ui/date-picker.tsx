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
}: DatePickerProps) {
  const selectedDate = parseDateValue(value)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-between bg-background px-3 font-normal shadow-sm",
            !selectedDate && "text-muted-foreground",
            className
          )}
          disabled={disabled}
        >
          <span className="flex min-w-0 items-center gap-2">
            <CalendarIcon className="h-4 w-4 shrink-0 text-violet-500" />
            <span className="truncate">
              {selectedDate ? format(selectedDate, "dd/MM/yyyy", { locale: ptBR }) : placeholder}
            </span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
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
