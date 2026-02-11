interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
}

export function KPICard({ title, value, subtitle, trend = "neutral" }: KPICardProps) {
  const trendColors = {
    up: "text-green-600 dark:text-green-400",
    down: "text-destructive",
    neutral: "text-muted-foreground",
  };

  return (
    <div className="bg-card text-card-foreground border border-border rounded-lg p-6 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          {title}
        </h3>
        {trend !== "neutral" && (
          <span className={`text-xs ${trendColors[trend]}`}>
            {trend === "up" ? "↑" : "↓"}
          </span>
        )}
      </div>
      <div className="text-3xl font-bold mb-1">{value}</div>
      {subtitle && (
        <div className="text-sm text-muted-foreground">{subtitle}</div>
      )}
    </div>
  );
}

