'use client';

import { t } from '@madar/i18n';
import { formatNumber } from '@madar/shared';
import { useState } from 'react';

import { cn } from '../lib/cn.js';
import { getInitials } from '../lib/initials.js';

const sizes = {
  xs: 'size-6 text-[0.625rem]',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-14 text-lg',
  xl: 'size-20 text-2xl',
} as const;

// Hue rotations that read well in both themes; picked deterministically from the name.
const palettes = [
  'bg-primary-soft text-primary-ink',
  'bg-accent-soft text-accent-ink',
  'bg-info-soft text-info-ink',
  'bg-streak-soft text-streak',
  'bg-danger-soft text-danger-ink',
  'bg-success-soft text-success-ink',
] as const;

function paletteFor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return palettes[hash % palettes.length];
}

export interface AvatarProps {
  name: string;
  src?: string;
  size?: keyof typeof sizes;
  /** Small presence dot at the bottom inline-end corner. */
  status?: 'online' | 'away' | 'offline';
  className?: string;
}

export function Avatar({ name, src, size = 'md', status, className }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const showImage = src && !failed;
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        role="img"
        aria-label={name}
        className={cn(
          'inline-grid place-items-center overflow-hidden rounded-full font-bold ring-2 ring-surface',
          sizes[size],
          !showImage && paletteFor(name),
        )}
      >
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- ui package is framework-agnostic
          <img
            src={src}
            alt=""
            className="size-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <span aria-hidden>{getInitials(name, size === 'xs' || size === 'sm' ? 1 : 2)}</span>
        )}
      </span>
      {status && (
        <span
          aria-hidden
          className={cn(
            'absolute bottom-0 end-0 size-[28%] min-h-2 min-w-2 rounded-full ring-2 ring-surface',
            status === 'online' && 'bg-success',
            status === 'away' && 'bg-warning',
            status === 'offline' && 'bg-ink-subtle',
          )}
        />
      )}
    </span>
  );
}

export interface AvatarGroupProps {
  people: Array<{ name: string; src?: string }>;
  max?: number;
  size?: keyof typeof sizes;
  className?: string;
}

/** Overlapping avatars with a «+N» counter. */
export function AvatarGroup({ people, max = 4, size = 'sm', className }: AvatarGroupProps) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <div className={cn('flex items-center -space-x-2', className)}>
      {shown.map((person) => (
        <Avatar key={person.name} name={person.name} src={person.src} size={size} />
      ))}
      {rest > 0 && (
        <span
          aria-label={t('ui.more', { count: formatNumber(rest) })}
          className={cn(
            'inline-grid place-items-center rounded-full bg-sunken font-bold text-ink-muted ring-2 ring-surface',
            sizes[size],
          )}
        >
          +{formatNumber(rest)}
        </span>
      )}
    </div>
  );
}
