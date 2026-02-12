"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartMonthNav } from "@/components/chart-month-nav";

const Bar = dynamic(() => import("react-chartjs-2").then((mod) => mod.Bar), { ssr: false });

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export interface SACsTopServiceDatum {
  tipoServico: string;
  quantidade: number;
}

interface SACsTopServicesChartProps {
  data: SACsTopServiceDatum[];
  monthLabel: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  disableNextMonth?: boolean;
}

export function SACsTopServicesChart({
  data,
  monthLabel,
  onPrevMonth,
  onNextMonth,
  disableNextMonth,
}: SACsTopServicesChartProps) {
  const [mounted, setMounted] = useState(false);
  const { theme } = useTheme();

  useEffect(() => setMounted(true), []);

  const topData = useMemo(() => [...data].sort((a, b) => b.quantidade - a.quantidade).slice(0, 8), [data]);
  const hasData = topData.some((d) => d.quantidade > 0);

  if (!mounted) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-indigo-600">Top Serviços SAC</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center text-muted-foreground">Carregando gráfico...</div>
        </CardContent>
      </Card>
    );
  }

  const isDark = theme === "dark";
  const gridColor = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  const textColor = isDark ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.75)";

  const chartData = {
    labels: topData.map((d) => d.tipoServico.length > 40 ? `${d.tipoServico.slice(0, 40)}...` : d.tipoServico),
    datasets: [
      {
        label: "Quantidade",
        data: topData.map((d) => d.quantidade),
        backgroundColor: "rgba(99, 102, 241, 0.65)",
        borderColor: "rgb(99, 102, 241)",
        borderWidth: 1.2,
        borderRadius: 6,
      },
    ],
  };

  const options: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: textColor } },
      tooltip: {
        backgroundColor: isDark ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.9)",
        titleColor: textColor,
        bodyColor: textColor,
        borderColor: gridColor,
        borderWidth: 1,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: textColor, maxRotation: 30, minRotation: 20 },
      },
      y: {
        beginAtZero: true,
        grid: { color: gridColor },
        ticks: { color: textColor, precision: 0 },
      },
    },
  };

  return (
    <Card className="h-full hover:shadow-md transition-shadow duration-200">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg font-semibold text-indigo-600">Top Serviços SAC</CardTitle>
              <ChartMonthNav
                label={monthLabel}
                onPrev={onPrevMonth}
                onNext={onNextMonth}
                disableNext={disableNextMonth}
              />
            </div>
            <CardDescription>Serviços com maior volume no período</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground">
            Sem dados de serviços para este período.
          </div>
        ) : (
          <div className="h-72">
            <Bar data={chartData} options={options} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

