'use client';

import { t } from '@madar/i18n';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { Toast as ToastPrimitive } from 'radix-ui';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { cn } from '../lib/cn.js';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Optional single action, e.g. «بازگردانی». */
  action?: { label: string; onClick: () => void };
  /** Milliseconds before auto-dismiss. */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  open: boolean;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toneStyles: Record<ToastTone, { icon: ReactNode; className: string }> = {
  success: { icon: <CircleCheck aria-hidden />, className: 'text-success' },
  error: { icon: <CircleAlert aria-hidden />, className: 'text-danger' },
  info: { icon: <Info aria-hidden />, className: 'text-info' },
};

let nextId = 1;

/** Wrap the app once. Toasts stack at the bottom, above the mobile bottom navigation. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((options: ToastOptions) => {
    const id = nextId++;
    setItems((current) => [...current.slice(-2), { ...options, id, open: true }]);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  const setOpen = (id: number, open: boolean) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, open } : item)));
    if (!open) {
      setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 200);
    }
  };

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="down" label={t('ui.notifications')}>
        {children}
        {items.map((item) => {
          const tone = toneStyles[item.tone ?? 'info'];
          return (
            <ToastPrimitive.Root
              key={item.id}
              open={item.open}
              onOpenChange={(open) => setOpen(item.id, open)}
              duration={item.duration ?? 4500}
              className={cn(
                'pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-lg',
                'data-[state=open]:animate-toast-in data-[state=closed]:animate-toast-out',
                'data-[swipe=move]:translate-y-(--radix-toast-swipe-move-y) data-[swipe=cancel]:translate-y-0 data-[swipe=cancel]:transition-transform data-[swipe=end]:animate-toast-out',
              )}
            >
              <span className={cn('mt-0.5 [&_svg]:size-5', tone.className)}>{tone.icon}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <ToastPrimitive.Title className="font-semibold text-ink">
                  {item.title}
                </ToastPrimitive.Title>
                {item.description && (
                  <ToastPrimitive.Description className="text-sm text-ink-muted">
                    {item.description}
                  </ToastPrimitive.Description>
                )}
              </div>
              {item.action && (
                <ToastPrimitive.Action
                  altText={item.action.label}
                  onClick={item.action.onClick}
                  className="rounded-md px-2 py-1 text-sm font-semibold text-primary-ink hover:bg-primary-soft"
                >
                  {item.action.label}
                </ToastPrimitive.Action>
              )}
              <ToastPrimitive.Close
                aria-label={t('ui.close')}
                className="-m-1 rounded-md p-1 text-ink-subtle hover:bg-sunken hover:text-ink [&_svg]:size-4"
              >
                <X aria-hidden />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 mx-auto flex w-full max-w-md flex-col gap-2 px-4 outline-none md:bottom-6" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
