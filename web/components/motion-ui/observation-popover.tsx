"use client";

import * as React from "react";
import { MessageSquarePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MorphingPopover,
  MorphingPopoverTrigger,
  MorphingPopoverContent,
} from "@/components/motion-primitives/morphing-popover";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

type ObservationPopoverProps = {
  triggerLabel?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  onSave?: (value: string) => void | Promise<void>;
  saveLabel?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
};

/** Morphing popover with textarea — "Adicione Observação". */
export function ObservationPopover({
  triggerLabel = "Adicione Observação",
  placeholder = "Escreva a observação…",
  value: controlledValue,
  onChange,
  onSave,
  saveLabel = "Salvar",
  className,
  triggerClassName,
  disabled,
}: ObservationPopoverProps) {
  const [open, setOpen] = React.useState(false);
  const [internal, setInternal] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const value = controlledValue ?? internal;

  const setValue = (next: string) => {
    if (controlledValue === undefined) setInternal(next);
    onChange?.(next);
  };

  const handleSave = async () => {
    if (!onSave) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(value);
      setOpen(false);
      if (controlledValue === undefined) setInternal("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <MorphingPopover
      open={open}
      onOpenChange={setOpen}
      className={cn("justify-start", className)}
      transition={{ type: "spring", bounce: 0.1, duration: 0.35 }}
    >
      <MorphingPopoverTrigger
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium shadow-sm transition hover:bg-muted",
          triggerClassName
        )}
        disabled={disabled}
      >
        <MessageSquarePlus className="h-4 w-4" />
        {triggerLabel}
      </MorphingPopoverTrigger>
      <MorphingPopoverContent className="w-[min(100vw-2rem,22rem)] space-y-3 p-3 shadow-xl">
        <div className="space-y-1.5">
          <Label htmlFor="obs-textarea" className="text-sm font-medium">
            Observação
          </Label>
          <Textarea
            id="obs-textarea"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            rows={4}
            className="resize-none"
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSave()}
            disabled={saving || !value.trim()}
          >
            {saveLabel}
          </Button>
        </div>
      </MorphingPopoverContent>
    </MorphingPopover>
  );
}

type MorphingMenuPopoverProps = {
  trigger: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** Simple morphing popover menu (edit / cancel actions). */
export function MorphingMenuPopover({
  trigger,
  children,
  contentClassName,
  open,
  onOpenChange,
}: MorphingMenuPopoverProps) {
  return (
    <MorphingPopover
      open={open}
      onOpenChange={onOpenChange}
      className="inline-flex"
      transition={{ type: "spring", bounce: 0.1, duration: 0.3 }}
    >
      <MorphingPopoverTrigger className="inline-flex">{trigger}</MorphingPopoverTrigger>
      <MorphingPopoverContent
        className={cn("min-w-[9.5rem] space-y-0.5 p-1 shadow-xl", contentClassName)}
      >
        {children}
      </MorphingPopoverContent>
    </MorphingPopover>
  );
}
