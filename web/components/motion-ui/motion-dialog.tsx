"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Dialog as MotionDialogRoot,
  DialogTrigger,
  DialogContent as MotionDialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
  type DialogProps,
  type DialogContentProps,
} from "@/components/motion-primitives/dialog";

/**
 * Drop-in Motion Dialog styled like shadcn (waitlist pattern).
 * Supports controlled `open` / `onOpenChange`.
 */
function Dialog(props: DialogProps) {
  return <MotionDialogRoot {...props} />;
}

function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: DialogContentProps & { showClose?: boolean }) {
  return (
    <MotionDialogContent
      className={cn("relative sm:rounded-xl", className)}
      {...props}
    >
      {children}
      {showClose ? <DialogClose /> : null}
    </MotionDialogContent>
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
};
