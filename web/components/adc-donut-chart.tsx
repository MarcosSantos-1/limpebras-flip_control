"use client";

/** Gráfico donut formal para ADC (sem neon, cores sólidas). */
interface AdcDonutChartProps {
  total: number;
  percentual: number;
}

export function AdcDonutChart({ total, percentual }: AdcDonutChartProps) {
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (percentual / 100) * circumference;

  const strokeColor =
    percentual >= 90
      ? "#059669" // emerald-600
      : percentual >= 70
        ? "#d97706" // amber-600
        : percentual >= 50
          ? "#ea580c" // orange-600
          : "#dc2626"; // red-600

  return (
    <div className="flex flex-col items-center justify-center p-2">
      <div className="relative">
        <svg className="transform -rotate-90 w-40 h-40" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="#e5e7eb"
            strokeWidth="10"
            className="dark:stroke-zinc-700"
          />
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke={strokeColor}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-foreground">{total.toFixed(0)}</span>
          <span className="text-xs text-muted-foreground">pts</span>
          <span className="text-sm font-medium text-foreground mt-0.5">{percentual.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}
