"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  components,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      navLayout="around"
      className={cn("p-3", className)}
      classNames={{
        root: "w-full",
        months: "flex flex-col gap-4 sm:flex-row",
        // Com navLayout="around", prev/caption/next são irmãos dentro do mês; sem grid ficam empilhados pelo space-y.
        month:
          "grid grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_1fr] items-center gap-x-2 gap-y-4 pt-1",
        month_caption:
          "col-start-2 row-start-1 flex min-w-0 items-center justify-center justify-self-stretch px-1",
        caption_label: "text-center text-sm font-semibold",
        nav: "flex items-center gap-1",
        button_previous: cn(
          buttonVariants({ variant: "outline", size: "icon" }),
          "col-start-1 row-start-1 h-7 w-7 rounded-md bg-transparent p-0 opacity-70 hover:opacity-100"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline", size: "icon" }),
          "col-start-3 row-start-1 h-7 w-7 rounded-md bg-transparent p-0 opacity-70 hover:opacity-100"
        ),
        weekdays: "grid grid-cols-7 gap-1",
        weekday: "flex h-8 items-center justify-center text-xs font-medium text-muted-foreground",
        month_grid: "col-span-3 row-start-2 w-full border-collapse",
        week: "mt-1 grid grid-cols-7 gap-1",
        day: "h-9 w-9 p-0 text-center text-sm",
        day_button: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "h-9 w-9 rounded-md p-0 font-normal aria-selected:opacity-100"
        ),
        /** Intervalo completo (modo range) — cores distintas início / meio / fim */
        range_start:
          "rounded-l-md bg-primary text-primary-foreground [&>button]:rounded-l-md [&>button]:bg-primary [&>button]:text-primary-foreground",
        range_middle:
          "rounded-none bg-accent/60 text-accent-foreground [&>button]:rounded-none [&>button]:bg-transparent [&>button]:text-foreground",
        range_end:
          "rounded-r-md bg-primary text-primary-foreground [&>button]:rounded-r-md [&>button]:bg-primary [&>button]:text-primary-foreground",
        /** Dia único ou seleção ainda sem intervalo visual da lib */
        selected:
          "rounded-md bg-primary text-primary-foreground [&>button]:bg-primary [&>button]:text-primary-foreground",
        today: "rounded-md bg-accent text-accent-foreground",
        outside: "text-muted-foreground opacity-50",
        disabled: "text-muted-foreground opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ className: chevronClassName, orientation, ...chevronProps }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("h-4 w-4", chevronClassName)} {...chevronProps} />
          ) : (
            <ChevronRight className={cn("h-4 w-4", chevronClassName)} {...chevronProps} />
          ),
        ...components,
      }}
      {...props}
    />
  )
}

Calendar.displayName = "Calendar"

export { Calendar }
