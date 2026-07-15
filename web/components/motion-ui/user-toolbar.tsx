"use client";

import * as React from "react";
import Link from "next/link";
import { motion, MotionConfig } from "motion/react";
import { ChevronUp, LogOut, Sparkles, Users } from "lucide-react";
import useClickOutside from "@/hooks/useClickOutside";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { TextShimmer } from "@/components/motion-primitives/text-shimmer";

const transition = {
  type: "spring" as const,
  bounce: 0.1,
  duration: 0.25,
};

type UserToolbarItem = {
  href: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
};

type UserToolbarProps = {
  displayName: string;
  username: string;
  roleLabel: string;
  statusLabel: string;
  menuItems?: UserToolbarItem[];
  onLogout: () => void | Promise<void>;
  className?: string;
};

/** Toolbar Dynamic adapted for sidebar user menu. */
export function UserToolbar({
  displayName,
  username,
  roleLabel,
  statusLabel,
  menuItems = [],
  onLogout,
  className,
}: UserToolbarProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  useClickOutside(containerRef, () => setIsOpen(false));

  return (
    <MotionConfig transition={transition}>
      <div ref={containerRef} className={cn("w-full", className)}>
        <motion.div
          layout
          className="overflow-hidden rounded-2xl border border-border/70 bg-linear-to-r from-background via-background to-cyan-500/5 shadow-sm"
        >
          <button
            type="button"
            onClick={() => setIsOpen((v) => !v)}
            className="group flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-muted/30 max-[1440px]:gap-2 max-[1440px]:px-2.5 max-[1440px]:py-2.5"
            aria-expanded={isOpen}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-blue-600 to-cyan-500 text-white shadow-md max-[1440px]:h-9 max-[1440px]:w-9">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground">
                {displayName}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="rounded-full bg-blue-500/10 px-2 py-0.5 font-medium text-blue-700 dark:text-blue-300">
                  {roleLabel}
                </span>
                <span className="truncate">{statusLabel}</span>
              </div>
            </div>
            <ChevronUp
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                isOpen ? "rotate-0" : "rotate-180"
              )}
            />
          </button>

          <motion.div
            initial={false}
            animate={{
              height: isOpen ? "auto" : 0,
              opacity: isOpen ? 1 : 0,
            }}
            className="overflow-hidden"
          >
            <div className="space-y-3 border-t border-border/70 p-3">
              <div className="rounded-xl border border-border/70 bg-muted/25 px-3 py-3">
                <div className="text-sm font-semibold text-foreground">{displayName}</div>
                <div className="mt-1 text-xs text-muted-foreground">@{username}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:text-blue-300">
                    {roleLabel}
                  </span>
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                    {statusLabel}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border/70 px-3 py-2.5">
                <TextShimmer as="span" className="text-sm font-medium" duration={2.5}>
                  Tema
                </TextShimmer>
                <ThemeToggle />
              </div>

              {menuItems.length > 0 && (
                <div className="space-y-1 rounded-xl border border-border/70 p-1.5">
                  {menuItems.map((item) => {
                    const Icon = item.icon ?? Users;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setIsOpen(false)}
                        className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
                      >
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                onClick={() => void onLogout()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                <LogOut className="h-4 w-4" />
                Sair
              </button>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </MotionConfig>
  );
}
