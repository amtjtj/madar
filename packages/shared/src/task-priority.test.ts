import { describe, expect, it } from 'vitest';

import { DEFAULT_WORK_CALENDAR } from './locale/work-calendar.js';
import {
  DEFAULT_PRIORITY_WEIGHTS,
  deriveTaskSource,
  dueBucket,
  mergeManualOrder,
  priorityScore,
  type RankInput,
} from './task-priority.js';

const base = {
  actorId: 'boss',
  assigneeId: 'ali',
  assigneeManagers: ['maryam', 'boss'],
  departmentManagers: ['head'],
  actorIsTop: false,
};

describe('deriveTaskSource', () => {
  it('is personal when people assign themselves', () => {
    expect(deriveTaskSource({ ...base, actorId: 'ali' })).toEqual({
      source: 'personal',
      ceo: false,
    });
  });

  it('is assigned from anyone up the management chain or a department manager', () => {
    expect(deriveTaskSource({ ...base, actorId: 'maryam' }).source).toBe('assigned');
    expect(deriveTaskSource(base)).toEqual({ source: 'assigned', ceo: false });
    expect(deriveTaskSource({ ...base, actorId: 'head' }).source).toBe('assigned');
  });

  it('marks the CEO, who has no manager above them, also outside a chain not filled in yet', () => {
    expect(deriveTaskSource({ ...base, actorIsTop: true })).toEqual({
      source: 'assigned',
      ceo: true,
    });
    expect(deriveTaskSource({ ...base, actorId: 'reza', actorIsTop: true })).toEqual({
      source: 'assigned',
      ceo: true,
    });
    expect(deriveTaskSource({ ...base, actorId: 'ali', actorIsTop: true }).source).toBe('personal');
  });

  it('is a request from a colleague', () => {
    expect(deriveTaskSource({ ...base, actorId: 'zahra' })).toEqual({
      source: 'request',
      ceo: false,
    });
  });
});

describe('dueBucket', () => {
  // 2026-10-19 is a Monday; Friday 2026-10-23 is the weekly day off; the week ends that Friday.
  const today = '2026-10-19';
  it.each([
    ['2026-10-18', 'overdue'],
    ['2026-10-19', 'today'],
    ['2026-10-20', 'tomorrow'],
    ['2026-10-22', 'week'],
    ['2026-10-23', 'week'],
    ['2026-10-24', 'later'],
    [null, 'none'],
  ] as const)('%s is %s', (dueOn, bucket) => {
    expect(dueBucket(dueOn, today, DEFAULT_WORK_CALENDAR)).toBe(bucket);
  });

  it('counts tomorrow as the next working day', () => {
    // Thursday: Friday is off, so Saturday is «tomorrow».
    expect(dueBucket('2026-10-24', '2026-10-22', DEFAULT_WORK_CALENDAR)).toBe('tomorrow');
    const holiday = { ...DEFAULT_WORK_CALENDAR, holidays: ['2026-10-20'] };
    expect(dueBucket('2026-10-21', today, holiday)).toBe('tomorrow');
  });
});

describe('priorityScore', () => {
  const plain: RankInput = {
    due: 'none',
    priority: 'low',
    source: 'personal',
    ceo: false,
    keyResult: false,
    weight: 1,
  };

  it('is zero for a personal, low, undated task and 100 at the top of every input', () => {
    expect(priorityScore(plain)).toEqual({ score: 0, reasons: [] });
    expect(
      priorityScore({
        due: 'overdue',
        priority: 'urgent',
        source: 'assigned',
        ceo: true,
        keyResult: true,
        weight: 5,
      }).score,
    ).toBe(100);
  });

  it('orders each input as the feedback asks', () => {
    const score = (patch: Partial<RankInput>) => priorityScore({ ...plain, ...patch }).score;
    const dues = ['overdue', 'today', 'tomorrow', 'week', 'later', 'none'] as const;
    for (let i = 1; i < dues.length; i++) {
      expect(score({ due: dues[i - 1] })).toBeGreaterThan(score({ due: dues[i] }));
    }
    expect(score({ priority: 'urgent' })).toBeGreaterThan(score({ priority: 'high' }));
    expect(score({ priority: 'high' })).toBeGreaterThan(score({ priority: 'normal' }));
    expect(score({ source: 'assigned', ceo: true })).toBeGreaterThan(score({ source: 'assigned' }));
    expect(score({ source: 'assigned' })).toBeGreaterThan(score({ source: 'meeting' }));
    expect(score({ source: 'meeting' })).toBeGreaterThan(score({ source: 'request' }));
    expect(score({ source: 'request' })).toBeGreaterThan(score({ source: 'personal' }));
    expect(score({ keyResult: true })).toBeGreaterThan(score({}));
    expect(score({ weight: 5 })).toBeGreaterThan(score({ weight: 2 }));
  });

  it('gives the two strongest reasons', () => {
    const r = priorityScore({ ...plain, due: 'tomorrow', source: 'assigned', ceo: true });
    expect(r.reasons).toEqual(['due.tomorrow', 'source.ceo']);
    expect(priorityScore({ ...plain, due: 'later', priority: 'normal' }).reasons).toEqual([]);
  });

  it('follows the company weights', () => {
    const sourceFirst = { ...DEFAULT_PRIORITY_WEIGHTS, due: 5, source: 60 };
    const ceoLater = { ...plain, due: 'later' as const, source: 'assigned' as const, ceo: true };
    const mineOverdue = { ...plain, due: 'overdue' as const };
    expect(priorityScore(mineOverdue).score).toBeGreaterThan(priorityScore(ceoLater).score);
    expect(priorityScore(ceoLater, sourceFirst).score).toBeGreaterThan(
      priorityScore(mineOverdue, sourceFirst).score,
    );
  });
});

describe('mergeManualOrder', () => {
  const items = [
    { id: 'a', score: 90 },
    { id: 'b', score: 70 },
    { id: 'c', score: 50 },
    { id: 'd', score: 30 },
  ];

  it('keeps the score order without a manual order', () => {
    expect(mergeManualOrder(items, new Map()).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps a manual order and slots new items before the first lower-scoring one', () => {
    // The person moved d to the top and c above b; a and the others are new.
    const manual = new Map([
      ['d', 'a0'],
      ['c', 'a1'],
      ['b', 'a2'],
    ]);
    expect(mergeManualOrder(items, manual).map((i) => i.id)).toEqual(['a', 'd', 'c', 'b']);
    const late = [...items, { id: 'e', score: 40 }].sort((x, y) => y.score - x.score);
    expect(mergeManualOrder(late, manual).map((i) => i.id)).toEqual(['a', 'e', 'd', 'c', 'b']);
  });
});
