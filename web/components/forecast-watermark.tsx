import { cn } from "@/lib/utils";

/** Overlay diagonal "Previsão" — não captura cliques. O card pai precisa de `relative overflow-hidden`. */
export function ForecastWatermark({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 z-20 overflow-hidden select-none", className)}
    >
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 -rotate-[18deg] flex-col gap-3 opacity-[0.16]">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-6 whitespace-nowrap text-lg font-black uppercase tracking-widest">
            {Array.from({ length: 4 }).map((__, j) => (
              <span key={j}>Previsão</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
