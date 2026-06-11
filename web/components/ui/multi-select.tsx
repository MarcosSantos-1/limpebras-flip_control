"use client";

import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
  /** Largura/altura reduzidas para barras de filtro. */
  compact?: boolean;
  /** Texto exibido quando nada está selecionado e há opções. */
  emptyLabel?: string;
}

/**
 * Dropdown de seleção múltipla (Popover + checkboxes). Não existe equivalente
 * no Radix `Select` (single-only), por isso este componente próprio.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Selecionar...",
  className,
  compact,
  emptyLabel,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);

  const toggle = (v: string) => {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  };

  const selectedLabels = options.filter((o) => value.includes(o.value)).map((o) => o.label);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-3 text-sm text-foreground transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            compact ? "h-9" : "h-10",
            className,
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-left">
            {selectedLabels.length === 0 ? (
              <span className="text-muted-foreground">{emptyLabel ?? placeholder}</span>
            ) : selectedLabels.length <= 2 ? (
              <span className="truncate">{selectedLabels.join(", ")}</span>
            ) : (
              <span className="truncate">
                {selectedLabels[0]}
                <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                  +{selectedLabels.length - 1}
                </span>
              </span>
            )}
          </span>
          {value.length > 0 ? (
            <X
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
            />
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] max-w-[320px] p-1">
        <div className="max-h-64 overflow-y-auto">
          {options.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">Sem opções.</p>
          )}
          {options.map((o) => {
            const checked = value.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60",
                  checked && "font-medium",
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    checked ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {checked && <Check className="h-3 w-3" />}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
