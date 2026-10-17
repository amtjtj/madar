'use client';

import { t } from '@madar/i18n';
import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';

export interface ModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens the modal (rendered as-is). */
  trigger?: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
  /** Action buttons, laid out at the bottom. */
  footer?: ReactNode;
  className?: string;
}

/**
 * Bottom sheet on mobile, centered dialog from `sm` up.
 * Focus is trapped, Escape and the overlay close it, and focus returns to the trigger.
 */
export function Modal({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  className,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed z-50 flex max-h-[90dvh] flex-col gap-4 overflow-y-auto bg-surface p-6 shadow-lg outline-none',
            // mobile: bottom sheet
            'inset-x-0 bottom-0 rounded-t-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom))] data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in',
            // sm+: centered dialog
            'sm:inset-0 sm:m-auto sm:h-fit sm:w-[min(92vw,30rem)] sm:rounded-2xl sm:pb-6 sm:data-[state=closed]:animate-dialog-out sm:data-[state=open]:animate-dialog-in',
            className,
          )}
        >
          <span
            aria-hidden
            className="mx-auto -mt-2 mb-1 h-1.5 w-10 rounded-full bg-line-strong sm:hidden"
          />
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="text-xl font-bold text-ink">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-ink-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label={t('ui.close')}
              className="-m-2 rounded-lg p-2 text-ink-subtle hover:bg-sunken hover:text-ink [&_svg]:size-5"
            >
              <X aria-hidden />
            </Dialog.Close>
          </div>
          {children}
          {footer && (
            <div className="mt-2 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Wrap a button in this to make it close the surrounding modal. */
export const ModalClose = Dialog.Close;
