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

export interface SACOverdueBySubDatum {
  label: string;
  foraPrazo: number;
  totalDemandantes: number;
}

interface SACsOverdueBySubChartProps {
  data: SACOverdueBySubDatum[];
  monthLabel: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  disableNextMonth?: boolean;
}

export function SACsOverdueBySubChart({
  data,
  monthLabel,
  onPrevMonth,
  onNextMonth,
  disableNextMonth,
}: SACsOverdueBySubChartProps) {
  const [mounted, setMounted] = useState(false);
  const { theme } = useTheme();

  useEffect(() => setMounted(true), []);

  const ranking = useMemo(() => [...data].sort((a, b) => b.foraPrazo - a.foraPrazo), [data]);
  const totalForaPrazo = useMemo(() => ranking.reduce((acc, d) => acc + d.foraPrazo, 0), [ranking]);
  const hasData = ranking.some((d) => d.foraPrazo > 0);

  if (!mounted) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-rose-600">SACs Fora do Prazo por Sub</CardTitle>
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
    labels: ranking.map((d) => d.label),
    datasets: [
      {
        label: "Fora do prazo",
        data: ranking.map((d) => d.foraPrazo),
        backgroundColor: "rgba(239, 68, 68, 0.7)",
        borderColor: "rgb(239, 68, 68)",
        borderWidth: 1.5,
        borderRadius: 6,
      },
    ],
  };

  const options: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: "y",
    plugins: {
      legend: {
        labels: { color: textColor },
      },
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
        beginAtZero: true,
        grid: { color: gridColor },
        ticks: { color: textColor, precision: 0 },
      },
      y: {
        grid: { display: false },
        ticks: { color: textColor },
      },
    },
  };

  return (
    <Card className="h-full hover:shadow-md transition-shadow duration-200">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg font-semibold text-rose-600">SACs Fora do Prazo por Sub</CardTitle>
              <ChartMonthNav
                label={monthLabel}
                onPrev={onPrevMonth}
                onNext={onNextMonth}
                disableNext={disableNextMonth}
              />
            </div>
            <CardDescription>Ranking mensal de demandantes fora do prazo</CardDescription>
          </div>
          <div className="text-right text-sm">
            <p className="text-muted-foreground">Total fora do prazo</p>
            <p className="text-2xl font-semibold text-foreground">{totalForaPrazo}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground">
            Nenhum SAC fora do prazo neste período.
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

