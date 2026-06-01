"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Info } from "lucide-react"
import { cn } from "@/lib/utils"

interface IndicatorTooltipProps {
  tipo: "IA" | "IRD" | "IF" | "IPT"
  valor?: number
  pontuacao?: number
  /** Sobrescreve estilos do ícone (ex.: card colorido no modo claro). */
  iconClassName?: string
  children: React.ReactNode
}

const tooltips = {
  IRD: {
    nome: "IRD – ÍNDICADOR DE RECLAMAÇÕES POR DOMICÍLIO",
    descricao:
      "Avalia o número de reclamações recebidas no FLIP relativos aos serviços regulares escalonados (varrição, mutirão, limpeza de bueiro e cata-bagulho).",
    formula: "IRD = (Reclamações Escalonadas Procedentes / Nº Domicílios) × 1000",
    pontuacaoMax: 20,
  },
  IA: {
    nome: "IA – ÍNDICADOR DE ATENDIMENTO",
    descricao: "Avalia o percentual de solicitações demandantes atendidas dentro do prazo estabelecido.",
    formula: "IA = (No prazo / (No prazo + Fora do prazo)) × 100",
    pontuacaoMax: 20,
  },
  IF: {
    nome: "IF – ÍNDICADOR DE FISCALIZAÇÃO",
    descricao: "Avalia o percentual de BFS (Boletins de Fiscalização) respondidos dentro do prazo sem irregularidades.",
    formula: "IF = (BFS Sem Irregularidade / Total BFS) × 100",
    pontuacaoMax: 20,
  },
  IPT: {
    nome: "IPT – INDICADOR PLANO DE TRABALHO",
    descricao: "Avalia a execução dos planos de trabalho. Algoritmo SELIMP: 70% Qualidade + 30% Cobertura.",
    formula: "70% Qualidade + 30% Cobertura",
    pontuacaoMax: 40,
  },
}

export function IndicatorTooltip({ tipo, valor, pontuacao, iconClassName, children }: IndicatorTooltipProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const info = tooltips[tipo]

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
    createPortal(
      <div
        className="pointer-events-none fixed z-[12000] w-80 max-w-[min(20rem,calc(100vw-1rem))] rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-xs text-white shadow-xl dark:bg-zinc-800"
        style={{ top: pos.top, left: pos.left }}
        role="tooltip"
      >
        <div className="mb-2 text-sm font-bold text-violet-400">{info.nome}</div>
        <div className="mb-3 text-xs leading-relaxed text-zinc-300">{info.descricao}</div>

        <div className="mb-3 rounded border border-zinc-700 bg-zinc-800 p-2 dark:bg-zinc-900">
          <div className="mb-1 text-xs text-zinc-400">Fórmula:</div>
          <div className="font-mono text-xs font-semibold text-violet-300">{info.formula}</div>
        </div>

        <div className="space-y-1 border-t border-zinc-700 pt-2">
          {valor !== undefined && (
            <div className="flex justify-between">
              <span className="text-zinc-400">Valor:</span>
              <span className="font-semibold text-violet-300">
                {tipo === "IRD" ? valor.toFixed(3) : valor.toFixed(1)}
                {tipo !== "IRD" ? "%" : ""}
              </span>
            </div>
          )}
          {pontuacao !== undefined && (
            <div className="flex justify-between">
              <span className="text-zinc-400">Pontuação:</span>
              <span className="font-semibold text-green-400">
                {pontuacao.toFixed(0)} / {info.pontuacaoMax} pontos
              </span>
            </div>
          )}
        </div>
      </div>,
      document.body
    )

  return (
    <div className="relative inline-flex items-center gap-2">
      {children}
      <div
        ref={anchorRef}
        className="relative"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <Info
          className={cn(
            "h-4 w-4 cursor-help transition-colors",
            iconClassName ?? "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          )}
        />
      </div>
      {panel}
    </div>
  )
}
