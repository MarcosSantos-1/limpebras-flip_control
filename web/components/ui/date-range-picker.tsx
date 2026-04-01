"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { endOfMonth, format, isSameDay, max as dfMax, min as dfMin, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronsUpDown } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function rangeKey(r: DateRange | undefined) {
  if (!r?.from) return "";
  const a = r.from.getTime();
  const b = r.to?.getTime() ?? "";
  return `${a}-${b}`;
}

export interface DateRangePickerProps {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  maxDate?: Date;
  className?: string;
  disabled?: boolean;
  emptyLabel?: string;
  modeLabel: string;
  footer?: (close: () => void) => ReactNode;
}

export function DateRangePicker({
  value,
  onChange,
  maxDate,
  className,
  disabled,
  emptyLabel = "Selecionar período",
  modeLabel,
  footer,
}: DateRangePickerProps) {
  const cap = maxDate ? startOfDay(maxDate) : startOfDay(new Date());
  const [open, setOpen] = useState(false);
  /** Só altera enquanto o popover está aberto; ao abrir, copia `value`. Confirmação = chamar `onChange`. */
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);
  const [hoverDate, setHoverDate] = useState<Date | undefined>(undefined);
  const partialAnchorRef = useRef<Date | null>(null);

  useLayoutEffect(() => {
    if (open) {
      setDraft(value);
      setHoverDate(undefined);
      partialAnchorRef.current = null;
    }
  }, [open, rangeKey(value)]);

  const displayRange = open ? draft : value;

  const modifiers = useMemo(
    () => ({
      /** 1º dia escolhido (ainda falta o fim) — destaque âmbar, diferente do intervalo fechado */
      picking_start: (date: Date) =>
        Boolean(draft?.from && !draft?.to && isSameDay(startOfDay(date), startOfDay(draft.from))),
      /** Entre o 1º dia e o dia sob o mouse (antes do 2º clique) */
      preview_range: (date: Date) => {
        if (!draft?.from || draft?.to || !hoverDate) return false;
        const a = startOfDay(draft.from);
        const h = startOfDay(hoverDate);
        const lo = dfMin([a, h]);
        const hi = dfMax([a, h]);
        const d = startOfDay(date);
        if (d < lo || d > hi) return false;
        if (isSameDay(d, draft.from)) return false;
        return true;
      },
    }),
    [draft, hoverDate]
  );

  const triggerText = (() => {
    if (!displayRange?.from) return emptyLabel;
    const from = displayRange.from;
    const a = format(from, "dd/MM/yyyy", { locale: ptBR });
    if (!displayRange.to) return `${a} → …`;
    const to = displayRange.to;
    if (from.getTime() === to.getTime()) return a;
    const b = format(to, "dd/MM/yyyy", { locale: ptBR });
    return `${a} – ${b}`;
  })();

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setDraft(value);
          setHoverDate(undefined);
          partialAnchorRef.current = null;
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn(
            "h-10 min-w-0 shrink gap-2 border-0 bg-emerald-600 px-3 text-white shadow-sm hover:bg-emerald-700 hover:text-white [&_svg]:text-white",
            className
          )}
        >
          <span
            className={cn(
              "min-w-0 truncate text-left text-xs font-bold tabular-nums",
              displayRange?.from ? "text-white" : "text-white/85"
            )}
          >
            {triggerText}
          </span>
          {modeLabel ? (
            <span className="shrink-0 rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              {modeLabel}
            </span>
          ) : null}
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-white/80" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto max-w-[calc(100vw-1.5rem)] p-0"
        align="start"
        onPointerLeave={() => setHoverDate(undefined)}
      >
        <p className="border-b border-border px-3 py-2 text-[11px] leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">1º clique:</span> início (fica em destaque).{" "}
          <span className="font-medium text-foreground">Passe o mouse</span> para ver o intervalo.{" "}
          <span className="font-medium text-foreground">2º clique:</span> confirma o fim e carrega os dados — ou{" "}
          <span className="font-medium text-foreground">dois cliques no mesmo dia</span> para só esse dia.
        </p>
        <Calendar
          mode="range"
          locale={ptBR}
          numberOfMonths={2}
          /** 1º clique só define `from`; 2º define `to` (exige pelo menos 1 dia de “largura” lógica na lib). */
          min={1}
          /** Com intervalo já fechado, 1º clique em outro dia recomeça a seleção. */
          resetOnSelect
          selected={draft}
          modifiers={modifiers}
          modifiersClassNames={{
            picking_start:
              "!bg-purple-200 !text-purple-950 shadow-[inset_0_0_0_2px] shadow-purple-600 dark:!bg-purple-900/50 dark:!text-purple-50 dark:shadow-purple-400 [&>button]:!bg-transparent [&>button]:!text-inherit",
            preview_range:
              "!bg-purple-200/80 dark:!bg-purple-800/35 text-purple-950 dark:text-purple-50 [&>button]:!bg-transparent [&>button]:!text-inherit",
          }}
          onDayMouseEnter={(date) => {
            if (draft?.from && !draft?.to) {
              setHoverDate(date);
            }
          }}
          onDayMouseLeave={() => {
            setHoverDate(undefined);
          }}
          onSelect={(r) => {
            setHoverDate(undefined);
            if (r == null) {
              const anchor = partialAnchorRef.current;
              if (anchor) {
                const d = startOfDay(anchor);
                if (d <= cap) {
                  const single = { from: d, to: d };
                  setDraft(single);
                  onChange(single);
                  setOpen(false);
                }
                partialAnchorRef.current = null;
              }
              return;
            }
            if (r.from && !r.to) {
              partialAnchorRef.current = r.from;
              setDraft(r);
              return;
            }
            if (r.from && r.to) {
              partialAnchorRef.current = null;
              let a = startOfDay(r.from);
              let b = startOfDay(r.to);
              if (a > b) [a, b] = [b, a];
              if (a > cap) a = cap;
              if (b > cap) b = cap;
              const final = { from: a, to: b };
              setDraft(final);
              onChange(final);
              setOpen(false);
            }
          }}
          defaultMonth={draft?.from ?? cap}
          disabled={(date) => startOfDay(date) > cap}
          classNames={{
            day: "h-9 w-9 p-0 text-center text-sm relative",
          }}
        />
        {footer && (
          <div className="flex flex-wrap gap-2 border-t border-border p-2">{footer(() => setOpen(false))}</div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function getEsteMesRange(ref: Date, cap: Date): { from: Date; to: Date } {
  const c = startOfDay(cap);
  let from = startOfDay(startOfMonth(ref));
  let to = startOfDay(endOfMonth(ref));
  if (from > c) from = c;
  if (to > c) to = c;
  if (from > to) return { from: to, to: to };
  return { from, to };
}
