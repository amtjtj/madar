'use client';

import { Popover as RadixPopover } from 'radix-ui';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';

export interface PopoverProps {
  /** The element that opens the popover (rendered as-is). */
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
  /** Accessible name of the panel. */
  label?: string;
  className?: string;
}

/** A floating panel anchored to its trigger (keyboard and screen-reader friendly, RTL). */
export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  align = 'end',
  label,
  className,
}: PopoverProps) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          sideOffset={8}
          collisionPadding={12}
          aria-label={label}
          dir="rtl"
          className={cn(
            'z-50 rounded-2xl border border-line bg-surface shadow-lg outline-none data-[state=open]:animate-fade-in',
            className,
          )}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
