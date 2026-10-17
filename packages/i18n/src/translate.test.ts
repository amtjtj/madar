import { describe, expect, it } from 'vitest';

import { t } from './translate.js';

describe('t', () => {
  it('returns the Persian string for a key', () => {
    expect(t('app.name')).toBe('مدار');
  });

  it('interpolates parameters', () => {
    expect(t('health.version', { version: '1.2.0' })).toBe('نسخه 1.2.0');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(t('health.version', {})).toBe('نسخه {version}');
  });
});
