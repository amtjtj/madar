'use client';

import { t } from '@madar/i18n';
import { formatNumber } from '@madar/shared';
import { LayoutGroup, motion } from 'motion/react';
import type { ComponentType, ReactNode } from 'react';

import { cn } from '../lib/cn.js';

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: ReactNode;
  /** Unread or pending count. */
  count?: number;
}

/** Any link component (e.g. Next.js `Link`); defaults to a plain anchor. */
export type LinkComponent = ComponentType<{
  href: string;
  className?: string;
  children: ReactNode;
  'aria-current'?: 'page';
}>;

const DefaultLink: LinkComponent = ({ children, ...props }) => <a {...props}>{children}</a>;

function Count({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn(
        'grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[0.6875rem] font-bold text-on-danger',
        className,
      )}
    >
      {formatNumber(Math.min(value, 99))}
    </span>
  );
}

export interface BottomNavProps {
  items: NavItem[];
  activeKey: string;
  link?: LinkComponent;
  /** Fixed to the viewport bottom (default). Set false to render in place (previews). */
  floating?: boolean;
  className?: string;
}

/** Mobile tab bar (hidden from `md` up when floating). The active tab gets a sliding pill. */
export function BottomNav({
  items,
  activeKey,
  link: Link = DefaultLink,
  floating = true,
  className,
}: BottomNavProps) {
  return (
    <nav
      aria-label={t('ui.mainNavigation')}
      className={cn(
        'border-t border-line bg-surface/95 backdrop-blur',
        floating && 'fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)] md:hidden',
        className,
      )}
    >
      <LayoutGroup id="bottom-nav">
        <ul className="mx-auto flex max-w-lg items-stretch justify-around px-2">
          {items.map((item) => {
            const active = item.key === activeKey;
            return (
              <li key={item.key} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex h-16 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-semibold transition-colors',
                    active ? 'text-primary-ink' : 'text-ink-subtle hover:text-ink',
                  )}
                >
                  <span className="relative grid h-8 w-14 place-items-center">
                    {active && (
                      <motion.span
                        layoutId="bottom-nav-pill"
                        className="absolute inset-0 rounded-full bg-primary-soft"
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      />
                    )}
                    <span className="relative [&_svg]:size-5.5">{item.icon}</span>
                    {item.count ? (
                      <Count value={item.count} className="absolute -top-1 end-1" />
                    ) : null}
                  </span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </LayoutGroup>
    </nav>
  );
}

export interface SidebarProps {
  items: NavItem[];
  activeKey: string;
  link?: LinkComponent;
  /** Logo / product name at the top. */
  brand?: ReactNode;
  /** Optional heading above the items. */
  sectionLabel?: string;
  /** Bottom area, e.g. the current user. */
  footer?: ReactNode;
  /** Sticky full-height sidebar from `md` up (default). Set false to render in place. */
  floating?: boolean;
  className?: string;
}

/** Desktop navigation along the inline start (right in RTL). */
export function Sidebar({
  items,
  activeKey,
  link: Link = DefaultLink,
  brand,
  sectionLabel,
  footer,
  floating = true,
  className,
}: SidebarProps) {
  return (
    <aside
      className={cn(
        'flex w-64 shrink-0 flex-col gap-6 border-e border-line bg-surface p-4',
        floating && 'sticky top-0 hidden h-dvh md:flex',
        className,
      )}
    >
      {brand && <div className="px-2 pt-2">{brand}</div>}
      <nav aria-label={t('ui.mainNavigation')} className="flex flex-1 flex-col gap-1">
        {sectionLabel && (
          <p className="px-3 pb-1 text-xs font-semibold text-ink-subtle">{sectionLabel}</p>
        )}
        <LayoutGroup id="sidebar">
          <ul className="flex flex-col gap-1">
            {items.map((item) => {
              const active = item.key === activeKey;
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex h-11 items-center gap-3 rounded-lg px-3 font-semibold transition-colors',
                      active ? 'text-primary-ink' : 'text-ink-muted hover:bg-sunken hover:text-ink',
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="sidebar-active"
                        className="absolute inset-0 rounded-lg bg-primary-soft"
                        transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                      />
                    )}
                    <span className="relative [&_svg]:size-5">{item.icon}</span>
                    <span className="relative flex-1">{item.label}</span>
                    {item.count ? <Count value={item.count} className="relative" /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </LayoutGroup>
      </nav>
      {footer && <div className="border-t border-line pt-4">{footer}</div>}
    </aside>
  );
}
