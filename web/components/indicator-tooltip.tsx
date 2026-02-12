"use client"

import { useState } from "react"
import { Info } from "lucide-react"

interface IndicatorTooltipProps {
  tipo: "IA" | "IRD" | "IF" | "IPT"
  valor?: number
  pontuacao?: number
  children: React.ReactNode
}

const tooltips = {
  IRD: {
    nome: "IRD – ÍNDICADOR DE RECLAMAÇÕES POR DOMICÍLIO",
    descricao: "Avalia o número de reclamações recebidas no FLIP relativos aos serviços regulares escalonados (varrição, mutirão, limpeza de bueiro e cata-bagulho).",
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
    descricao: "Avalia a execução dos planos de trabalho através de mão de obra e equipamentos.",
    formula: "IPT = (Mão de Obra × 50%) + (Equipamentos × 50%)",
    pontuacaoMax: 40,
  },
}

export function IndicatorTooltip({ tipo, valor, pontuacao, children }: IndicatorTooltipProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const info = tooltips[tipo]

  return (
    <div className="relative inline-flex items-center gap-2">
      {children}
      <div
        className="relative"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <Info className="h-4 w-4 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 cursor-help transition-colors" />
        {showTooltip && (
          <div className="absolute left-0 top-6 z-50 w-80 rounded-lg bg-zinc-900 dark:bg-zinc-800 p-4 text-xs text-white shadow-xl border border-zinc-700">
            <div className="font-bold mb-2 text-sm text-violet-400">{info.nome}</div>
            <div className="text-zinc-300 mb-3 text-xs leading-relaxed">{info.descricao}</div>
            
            {/* Fórmula estilizada */}
            <div className="mb-3 p-2 bg-zinc-800 dark:bg-zinc-900 rounded border border-zinc-700">
              <div className="text-zinc-400 text-xs mb-1">Fórmula:</div>
              <div className="font-mono text-xs text-violet-300 font-semibold">
                {info.formula}
              </div>
            </div>
            
            {/* Valores */}
            <div className="space-y-1 border-t border-zinc-700 pt-2">
              {valor !== undefined && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">Valor:</span>
                  <span className="font-semibold text-violet-300">
                    {tipo === "IRD" ? valor.toFixed(3) : valor.toFixed(1)}{tipo !== "IRD" ? "%" : ""}
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
          </div>
        )}
      </div>
    </div>
  )
}

