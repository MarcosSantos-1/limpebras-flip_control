"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MorphingDialog,
  MorphingDialogTrigger,
  MorphingDialogContainer,
  MorphingDialogContent,
  MorphingDialogClose,
  MorphingDialogTitle,
  MorphingDialogSubtitle,
  MorphingDialogDescription,
  MorphingDialogImage,
} from "@/components/motion-primitives/morphing-dialog";

const MORPH_TRANSITION = {
  type: "spring" as const,
  bounce: 0.05,
  duration: 0.35,
};

type MorphingDialogBasicProps = {
  trigger: React.ReactNode;
  triggerClassName?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
};

/** Morphing dialog that expands from a trigger — Shadcn waitlist look. */
export function MorphingDialogBasic({
  trigger,
  triggerClassName,
  title,
  description,
  children,
  contentClassName,
}: MorphingDialogBasicProps) {
  return (
    <MorphingDialog transition={MORPH_TRANSITION}>
      <MorphingDialogTrigger
        className={cn(
          "rounded-xl border border-border/70 bg-card text-left shadow-sm transition hover:border-primary/30 hover:shadow-md",
          triggerClassName
        )}
      >
        {trigger}
      </MorphingDialogTrigger>
      <MorphingDialogContainer>
        <MorphingDialogContent
          className={cn(
            "relative max-h-[85vh] w-[min(100vw-2rem,32rem)] overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-lg",
            contentClassName
          )}
        >
          <MorphingDialogClose className="absolute top-4 right-4 rounded-sm opacity-70 transition-opacity hover:opacity-100">
            <X className="h-4 w-4" />
          </MorphingDialogClose>
          {title ? (
            <MorphingDialogTitle className="pr-8 text-lg font-semibold tracking-tight">
              {title}
            </MorphingDialogTitle>
          ) : null}
          {description ? (
            <MorphingDialogSubtitle className="mt-1.5 text-sm text-muted-foreground">
              {description}
            </MorphingDialogSubtitle>
          ) : null}
          <div className={cn(title || description ? "mt-4" : undefined)}>{children}</div>
        </MorphingDialogContent>
      </MorphingDialogContainer>
    </MorphingDialog>
  );
}

type MorphingDialogImageViewerProps = {
  src: string;
  alt: string;
  thumbClassName?: string;
  title?: string;
  footer?: React.ReactNode;
};

/** Thumbnail → full image morph (photos / prints). */
export function MorphingDialogImageViewer({
  src,
  alt,
  thumbClassName,
  title,
  footer,
}: MorphingDialogImageViewerProps) {
  return (
    <MorphingDialog transition={MORPH_TRANSITION}>
      <MorphingDialogTrigger className="block overflow-hidden rounded-xl">
        <MorphingDialogImage
          src={src}
          alt={alt}
          className={cn("object-cover", thumbClassName)}
        />
      </MorphingDialogTrigger>
      <MorphingDialogContainer>
        <MorphingDialogContent className="relative max-h-[90vh] w-[min(100vw-2rem,56rem)] overflow-hidden rounded-xl border border-border bg-background shadow-lg">
          <MorphingDialogClose className="absolute top-3 right-3 z-10 rounded-md border border-border bg-background/90 p-1.5 opacity-90 hover:opacity-100">
            <X className="h-4 w-4" />
          </MorphingDialogClose>
          {title ? (
            <div className="border-b border-border px-4 py-3 pr-12">
              <MorphingDialogTitle className="truncate text-sm font-semibold">
                {title}
              </MorphingDialogTitle>
            </div>
          ) : null}
          <MorphingDialogImage
            src={src}
            alt={alt}
            className="max-h-[78vh] w-full object-contain"
          />
          {footer ? (
            <div className="border-t border-border px-4 py-3">{footer}</div>
          ) : null}
        </MorphingDialogContent>
      </MorphingDialogContainer>
    </MorphingDialog>
  );
}

export {
  MorphingDialog,
  MorphingDialogTrigger,
  MorphingDialogContainer,
  MorphingDialogContent,
  MorphingDialogClose,
  MorphingDialogTitle,
  MorphingDialogSubtitle,
  MorphingDialogDescription,
  MorphingDialogImage,
};
