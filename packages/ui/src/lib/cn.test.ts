import { describe, expect, it } from 'vitest';

import { cn } from './cn.js';

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', false, 'b', undefined, null, 'c')).toBe('a b c');
  });

  it('lets later Tailwind classes win', () => {
    expect(cn('px-2 bg-primary', 'px-4')).toBe('bg-primary px-4');
  });

  it('keeps color and size utilities that share the text- prefix', () => {
    expect(cn('text-sm text-ink', 'text-ink-muted')).toBe('text-sm text-ink-muted');
  });
});
