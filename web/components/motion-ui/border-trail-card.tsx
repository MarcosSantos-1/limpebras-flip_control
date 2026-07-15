"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { BorderTrail } from "@/components/motion-primitives/border-trail";

type BorderTrailCardProps = React.HTMLAttributes<HTMLDivElement> & {
  loading?: boolean;
  trailClassName?: string;
  trailSize?: number;
};

/**
 * Card with animated border trail.
 * Use `loading` for faster trail while uploading.
 */
export function BorderTrailCard({
  className,
  children,
  loading = false,
  trailClassName,
  trailSize = 48,
  ...props
}: BorderTrailCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card",
        className
      )}
      {...props}
    >
      <BorderTrail
        size={trailSize}
        className={cn(
          loading ? "bg-emerald-500" : "bg-primary/70",
          trailClassName
        )}
        transition={
          loading
            ? { repeat: Infinity, duration: 1.4, ease: "linear" }
            : { repeat: Infinity, duration: 5, ease: "linear" }
        }
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
