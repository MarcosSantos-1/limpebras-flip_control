"use client"

import { useMemo } from "react"

interface ADCRingChartProps {
  total: number
  percentual: number
}

export function ADCRingChart({ total, percentual }: ADCRingChartProps) {
  const circumference = 2 * Math.PI * 90 // raio 90
  const strokeDashoffset = useMemo(() => {
    return circumference - (percentual / 100) * circumference
  }, [circumference, percentual])

  const getGradientColors = (percent: number) => {
    if (percent >= 90) {
      return {
        start: "#047857",
        middle: "#059669",
        end: "#0e7490",
      }
    }
    if (percent >= 70) {
      return {
        start: "#d97706",
        middle: "#ea580c",
        end: "#b91c1c",
      }
    }
    return {
      start: "#dc2626",
      middle: "#be185d",
      end: "#7e22ce",
    }
  }

  const colors = getGradientColors(percentual)
  const gradientId = `adcRingGradient-${Math.floor(percentual)}`

  return (
    <div className="relative flex flex-col items-center justify-center p-4">
      <div className="relative">
        <svg className="transform -rotate-90 w-64 h-64" viewBox="0 0 200 200">
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={colors.start} />
              <stop offset="50%" stopColor={colors.middle} />
              <stop offset="100%" stopColor={colors.end} />
            </linearGradient>
          </defs>

          <circle
            cx="100"
            cy="100"
            r="90"
            stroke="currentColor"
            strokeWidth="14"
            fill="none"
            className="text-zinc-300/90 dark:text-zinc-800"
          />

          <circle
            cx="100"
            cy="100"
            r="90"
            stroke={`url(#${gradientId})`}
            strokeWidth="14"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        
        {/* Conteúdo central */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-center">
            <div 
              className="text-5xl font-bold mb-2"
              style={{
                backgroundImage: `linear-gradient(to right, ${colors.start}, ${colors.middle}, ${colors.end})`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {total.toFixed(0)}
            </div>
            <div className="text-sm font-medium text-zinc-700 dark:text-zinc-400">
              Pontos ADC
            </div>
            <div 
              className="text-lg font-semibold mt-1"
              style={{
                backgroundImage: `linear-gradient(to right, ${colors.start}, ${colors.middle})`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {percentual.toFixed(1)}%
            </div>
          </div>
        </div>
      </div>
      
      {/* Indicador de meta */}
      <div className="mt-4 text-xs text-zinc-600 dark:text-zinc-400 text-center">
        Meta: 100 pontos
      </div>
    </div>
  )
}

