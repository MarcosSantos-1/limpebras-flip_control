"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Spotlight } from "@/components/motion-primitives/spotlight";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type SpotlightCardProps = React.ComponentProps<typeof Card> & {
  spotlightSize?: number;
  spotlightClassName?: string;
};

/** Card with cursor spotlight (Spotlight Basic). */
export function SpotlightCard({
  className,
  children,
  spotlightSize = 220,
  spotlightClassName,
  ...props
}: SpotlightCardProps) {
  return (
    <Card
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <Spotlight
        size={spotlightSize}
        className={cn(
          "from-primary/20 via-primary/10 to-transparent dark:from-primary/30 dark:via-primary/15",
          spotlightClassName
        )}
      />
      <div className="relative z-10">{children}</div>
    </Card>
  );
}

export { CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
