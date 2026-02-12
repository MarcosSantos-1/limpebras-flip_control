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
        start: "#10b981", // emerald-400
        middle: "#06b6d4", // cyan-400
        end: "#3b82f6", // blue-500
      }
    }
    if (percent >= 70) {
      return {
        start: "#fbbf24", // yellow-400
        middle: "#f97316", // orange-500
        end: "#dc2626", // red-600
      }
    }
    return {
      start: "#ef4444", // red-400
      middle: "#ec4899", // pink-500
      end: "#a855f7", // purple-500
    }
  }

  const colors = getGradientColors(percentual)
  const gradientId = `neonGradient-${Math.floor(percentual)}`

  return (
    <div className="relative flex flex-col items-center justify-center p-4">
      <div className="relative">
        {/* Ring externo com glow neon */}
        <svg className="transform -rotate-90 w-64 h-64" viewBox="0 0 200 200">
          <defs>
            {/* Gradiente neon */}
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={colors.start} />
              <stop offset="50%" stopColor={colors.middle} />
              <stop offset="100%" stopColor={colors.end} />
            </linearGradient>
            {/* Glow filter */}
            <filter id="glow">
              <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          
          {/* Background ring */}
          <circle
            cx="100"
            cy="100"
            r="90"
            stroke="currentColor"
            strokeWidth="12"
            fill="none"
            className="text-zinc-200 dark:text-zinc-800"
          />
          
          {/* Progress ring com gradiente neon */}
          <circle
            cx="100"
            cy="100"
            r="90"
            stroke={`url(#${gradientId})`}
            strokeWidth="12"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-1000 ease-out"
            style={{
              filter: "url(#glow)",
            }}
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
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
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
      <div className="mt-4 text-xs text-zinc-500 dark:text-zinc-400 text-center">
        Meta: 100 pontos
      </div>
    </div>
  )
}

