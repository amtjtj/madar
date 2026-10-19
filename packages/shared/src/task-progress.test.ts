import { describe, expect, it } from 'vitest';

import { displayProgress, toProgressStep, weightedProgress } from './task-progress.js';

describe('task progress', () => {
  it('shows finished work as 100 %', () => {
    expect(displayProgress('done', 40)).toBe(100);
    expect(displayProgress('in_progress', 40)).toBe(40);
  });

  it('averages by weight and leaves canceled work out', () => {
    expect(
      weightedProgress([
        { statusCategory: 'in_progress', progress: 50, weight: 1 },
        { statusCategory: 'done', progress: 0, weight: 3 },
        { statusCategory: 'canceled', progress: 0, weight: 5 },
      ]),
    ).toBe(87.5);
    expect(weightedProgress([])).toBeNull();
    expect(weightedProgress([{ statusCategory: 'canceled', progress: 0, weight: 1 }])).toBeNull();
  });

  it('rounds to steps of five', () => {
    expect(toProgressStep(87.5)).toBe(90);
    expect(toProgressStep(32)).toBe(30);
    expect(toProgressStep(-3)).toBe(0);
    expect(toProgressStep(101)).toBe(100);
  });
});
