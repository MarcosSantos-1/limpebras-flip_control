"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

interface ManualIndicatorBadgeProps {
  observacao: string
  className?: string
  iconClassName?: string
  /** inline = ícone pequeno ao lado do título; full = badge centralizado (dashboard) */
  variant?: "full" | "inline"
}

function ManualIndicatorTooltip({
  observacao,
  iconClassName,
  size = "lg",
}: {
  observacao: string
  iconClassName?: string
  size?: "sm" | "lg"
}) {
  const [showTooltip, setShowTooltip] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useLayoutEffect(() => {
    if (!showTooltip || !anchorRef.current) return
    const el = anchorRef.current
    const update = () => {
      const r = el.getBoundingClientRect()
      const w = 320
      const margin = 8
      let left = r.left
      if (left + w > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - w - margin)
      }
      setPos({ top: r.bottom + margin, left })
    }
    update()
    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
  }, [showTooltip])

  const panel =
    typeof document !== "undefined" &&
    showTooltip &&
    observacao.trim() &&
    createPortal(
      <div
        className="pointer-events-none fixed z-[12000] w-80 max-w-[min(20rem,calc(100vw-1rem))] rounded-lg bg-zinc-900 p-4 text-xs text-white shadow-xl dark:bg-zinc-800"
        style={{ top: pos.top, left: pos.left }}
        role="tooltip"
      >
        <div className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Valor manual
        </div>
        <p className="leading-relaxed text-zinc-300 whitespace-pre-wrap">{observacao}</p>
      </div>,
      document.body
    )

  return (
    <>
      <div
        ref={anchorRef}
        className="relative inline-flex"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <AlertTriangle
          className={cn(
            "cursor-help text-amber-500 transition-colors hover:text-amber-400",
            size === "sm" ? "h-4 w-4" : "h-10 w-10",
            iconClassName
          )}
        />
      </div>
      {panel}
    </>
  )
}

export function ManualIndicatorAlert({
  observacao,
  iconClassName,
}: {
  observacao: string
  iconClassName?: string
}) {
  if (!observacao.trim()) return null
  return <ManualIndicatorTooltip observacao={observacao} iconClassName={iconClassName} size="sm" />
}

export function ManualIndicatorBadge({
  observacao,
  className,
  iconClassName,
  variant = "full",
}: ManualIndicatorBadgeProps) {
  if (variant === "inline") {
    return (
      <span className={cn("inline-flex items-center", className)}>
        <ManualIndicatorAlert observacao={observacao} iconClassName={iconClassName} />
      </span>
    )
  }

  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 py-4", className)}>
      <ManualIndicatorTooltip observacao={observacao} iconClassName={iconClassName} size="lg" />
      <span className="text-xs font-medium text-white/80 dark:text-muted-foreground">Valor manual</span>
    </div>
  )
}
