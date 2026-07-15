'use client';
import { AnimatePresence, motion, Transition, Variants } from 'motion/react';
import React, { createContext, useContext, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useId } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { usePreventScroll } from '@/hooks/usePreventScroll';

/**
 * Div-based modal (not native <dialog showModal>) so Radix Select / Popover /
 * DatePicker portals to document.body stack above the overlay correctly.
 */
const DialogContext = createContext<{
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  contentRef: React.RefObject<HTMLDivElement | null>;
  variants: Variants;
  transition?: Transition;
  ids: {
    dialog: string;
    title: string;
    description: string;
  };
  handleTrigger: () => void;
} | null>(null);

const defaultVariants: Variants = {
  initial: {
    opacity: 0,
    scale: 0.95,
  },
  animate: {
    opacity: 1,
    scale: 1,
  },
  exit: {
    opacity: 0,
    scale: 0.95,
  },
};

const defaultTransition: Transition = {
  ease: 'easeOut',
  duration: 0.2,
};

export type DialogProps = {
  children: React.ReactNode;
  variants?: Variants;
  transition?: Transition;
  className?: string;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
};

function Dialog({
  children,
  variants = defaultVariants,
  transition = defaultTransition,
  defaultOpen,
  onOpenChange,
  open,
}: DialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
    defaultOpen || false
  );
  const contentRef = useRef<HTMLDivElement>(null);
  const isOpen = open !== undefined ? open : uncontrolledOpen;

  usePreventScroll({
    isDisabled: !isOpen,
  });

  const setIsOpen = React.useCallback(
    (value: boolean) => {
      setUncontrolledOpen(value);
      onOpenChange?.(value);
    },
    [onOpenChange]
  );

  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('overflow-hidden');
    } else {
      document.body.classList.remove('overflow-hidden');
    }
    return () => {
      document.body.classList.remove('overflow-hidden');
    };
  }, [isOpen]);

  const handleTrigger = () => {
    setIsOpen(true);
  };

  const baseId = useId();
  const ids = {
    dialog: `motion-ui-dialog-${baseId}`,
    title: `motion-ui-dialog-title-${baseId}`,
    description: `motion-ui-dialog-description-${baseId}`,
  };

  return (
    <DialogContext.Provider
      value={{
        isOpen,
        setIsOpen,
        contentRef,
        variants,
        transition,
        ids,
        handleTrigger,
      }}
    >
      {children}
    </DialogContext.Provider>
  );
}

export type DialogTriggerProps = {
  children: React.ReactNode;
  className?: string;
};

function DialogTrigger({ children, className }: DialogTriggerProps) {
  const context = useContext(DialogContext);
  if (!context) throw new Error('DialogTrigger must be used within Dialog');

  return (
    <button
      onClick={context.handleTrigger}
      className={cn(
        'inline-flex items-center justify-center rounded-md text-sm font-medium',
        'transition-colors focus-visible:ring-2 focus-visible:outline-hidden',
        'focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        className
      )}
    >
      {children}
    </button>
  );
}

export type DialogPortalProps = {
  children: React.ReactNode;
  container?: HTMLElement | null;
};

function DialogPortal({
  children,
  container = typeof window !== 'undefined' ? document.body : null,
}: DialogPortalProps) {
  const [mounted, setMounted] = React.useState(false);
  const [portalContainer, setPortalContainer] =
    React.useState<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
    setPortalContainer(container || document.body);
    return () => setMounted(false);
  }, [container]);

  if (!mounted || !portalContainer) {
    return null;
  }

  return createPortal(children, portalContainer);
}

export type DialogContentProps = {
  children: React.ReactNode;
  className?: string;
  container?: HTMLElement;
  onPointerDownOutside?: (e: { preventDefault: () => void }) => void;
  onEscapeKeyDown?: (e: { preventDefault: () => void }) => void;
  onInteractOutside?: (e: { preventDefault: () => void }) => void;
};

function DialogContent({
  children,
  className,
  container,
  onPointerDownOutside,
  onEscapeKeyDown,
  onInteractOutside,
}: DialogContentProps) {
  const context = useContext(DialogContext);
  if (!context) throw new Error('DialogContent must be used within Dialog');
  const { isOpen, setIsOpen, contentRef, variants, transition, ids } = context;

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      let blocked = false;
      onEscapeKeyDown?.({
        preventDefault: () => {
          blocked = true;
        },
      });
      if (!blocked) setIsOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onEscapeKeyDown, setIsOpen]);

  const tryCloseOutside = () => {
    let blocked = false;
    const synthetic = {
      preventDefault: () => {
        blocked = true;
      },
    };
    onPointerDownOutside?.(synthetic);
    onInteractOutside?.(synthetic);
    if (!blocked) setIsOpen(false);
  };

  const content = (
    <AnimatePresence mode='wait'>
      {isOpen && (
        <div
          key={ids.dialog}
          className='fixed inset-0 z-50 flex items-center justify-center p-4'
        >
          <motion.div
            aria-hidden
            className='absolute inset-0 bg-black/80'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={tryCloseOutside}
          />
          <motion.div
            ref={contentRef}
            id={ids.dialog}
            role='dialog'
            aria-modal='true'
            aria-labelledby={ids.title}
            aria-describedby={ids.description}
            initial='initial'
            animate='animate'
            exit='exit'
            variants={variants}
            transition={transition}
            className={cn(
              'relative z-10 grid w-full max-w-lg gap-4',
              'rounded-xl border border-border bg-background p-6 text-foreground shadow-lg',
              className
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  return <DialogPortal container={container}>{content}</DialogPortal>;
}

export type DialogHeaderProps = {
  children: React.ReactNode;
  className?: string;
};

function DialogHeader({ children, className }: DialogHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col space-y-1.5 text-center sm:text-left',
        className
      )}
    >
      {children}
    </div>
  );
}

export type DialogFooterProps = {
  children: React.ReactNode;
  className?: string;
};

function DialogFooter({ children, className }: DialogFooterProps) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
        className
      )}
    >
      {children}
    </div>
  );
}

export type DialogTitleProps = {
  children: React.ReactNode;
  className?: string;
};

function DialogTitle({ children, className }: DialogTitleProps) {
  const context = useContext(DialogContext);
  if (!context) throw new Error('DialogTitle must be used within Dialog');

  return (
    <h2
      id={context.ids.title}
      className={cn(
        'text-lg font-semibold leading-none tracking-tight',
        className
      )}
    >
      {children}
    </h2>
  );
}

export type DialogDescriptionProps = {
  children: React.ReactNode;
  className?: string;
};

function DialogDescription({ children, className }: DialogDescriptionProps) {
  const context = useContext(DialogContext);
  if (!context) throw new Error('DialogDescription must be used within Dialog');

  return (
    <p
      id={context.ids.description}
      className={cn('text-sm text-muted-foreground', className)}
    >
      {children}
    </p>
  );
}

export type DialogCloseProps = {
  className?: string;
  children?: React.ReactNode;
  disabled?: boolean;
};

function DialogClose({ className, children, disabled }: DialogCloseProps) {
  const context = useContext(DialogContext);
  if (!context) throw new Error('DialogClose must be used within Dialog');

  return (
    <button
      onClick={() => context.setIsOpen(false)}
      type='button'
      aria-label='Close dialog'
      className={cn(
        'absolute top-4 right-4 rounded-sm opacity-70 ring-offset-background transition-opacity',
        'hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        'disabled:pointer-events-none',
        className
      )}
      disabled={disabled}
    >
      {children || <X className='h-4 w-4' />}
      <span className='sr-only'>Close</span>
    </button>
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
