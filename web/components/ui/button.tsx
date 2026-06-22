"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/30",
        destructive:
          "bg-destructive text-white shadow-md shadow-destructive/25 hover:bg-destructive/90 hover:shadow-lg hover:shadow-destructive/30",
        outline:
          "border border-border bg-secondary text-secondary-foreground shadow-sm hover:bg-accent hover:text-accent-foreground hover:shadow-md",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/70 hover:shadow-md",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        glass:
          "border border-white/50 bg-white/45 text-foreground backdrop-blur-md shadow-[0_4px_14px_-6px_rgba(15,23,42,0.25),inset_0_1px_0_0_rgba(255,255,255,0.6)] hover:bg-white/65 dark:border-white/10 dark:bg-white/10 dark:hover:bg-white/[0.16] dark:shadow-[0_6px_18px_-8px_rgba(0,0,0,0.6),inset_0_1px_0_0_rgba(255,255,255,0.08)]",
        glassPrimary:
          "border border-emerald-300/40 bg-emerald-500/85 text-white backdrop-blur-md shadow-[0_8px_22px_-10px_rgba(16,185,129,0.85),inset_0_1px_0_0_rgba(255,255,255,0.35)] hover:bg-emerald-500/95",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    )
  }
)

Button.displayName = "Button"

export { Button, buttonVariants }
