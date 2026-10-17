import { describe, expect, it } from 'vitest';

import { cx } from './cx.js';

describe('cx', () => {
  it('joins truthy class names', () => {
    expect(cx('a', false, 'b', undefined, null, 'c')).toBe('a b c');
  });
});
