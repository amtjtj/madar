'use client';

import { DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';

export interface MenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onSelect: () => void;
}

export interface MenuProps {
  /** The element that opens the menu (rendered as-is). */
  trigger: ReactNode;
  items: MenuItem[];
  label?: string;
}

/** Accessible actions menu (keyboard and screen-reader friendly); opens toward the inline end. */
export function Menu({ trigger, items, label }: MenuProps) {
  return (
    <DropdownMenu.Root dir="rtl">
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          aria-label={label}
          className="z-50 min-w-48 rounded-xl border border-line bg-surface p-1.5 shadow-lg data-[state=open]:animate-fade-in"
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.key}
              disabled={item.disabled}
              onSelect={item.onSelect}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium outline-none select-none [&_svg]:size-4',
                'data-highlighted:bg-sunken data-disabled:cursor-not-allowed data-disabled:opacity-50',
                item.tone === 'danger' ? 'text-danger-ink' : 'text-ink',
              )}
            >
              {item.icon}
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
