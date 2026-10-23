import { describe, expect, it } from 'vitest';

import { DEFAULT_WORK_CALENDAR } from '../locale/work-calendar.js';
import {
  approvalChain,
  createRequestRequest,
  decideRequestRequest,
  leaveWorkingDays,
} from './requests.js';

const people = {
  requesterId: 'ali',
  managerChain: ['maryam', 'sara'],
  departmentManagers: ['head', 'maryam'],
  leaders: ['ceo', 'owner'],
};
const expense = (amountToman: number) => ({
  kind: 'expense' as const,
  amountToman,
  thresholdToman: 10_000_000,
});

describe('approvalChain (ADR 0028)', () => {
  it('goes to the direct manager, then the department, then the leadership', () => {
    expect(approvalChain(people, { kind: 'leave', amountToman: null, thresholdToman: 0 })).toEqual([
      'maryam',
    ]);
    expect(
      approvalChain(
        { ...people, managerChain: [] },
        { kind: 'general', amountToman: null, thresholdToman: 0 },
      ),
    ).toEqual(['head']);
    expect(
      approvalChain(
        { ...people, requesterId: 'head', managerChain: [], departmentManagers: ['head'] },
        { kind: 'leave', amountToman: null, thresholdToman: 0 },
      ),
    ).toEqual(['ceo']);
  });

  it('adds the leadership for an expense over the threshold, once', () => {
    expect(approvalChain(people, expense(10_000_000))).toEqual(['maryam']);
    expect(approvalChain(people, expense(18_000_000))).toEqual(['maryam', 'ceo']);
    expect(approvalChain({ ...people, managerChain: ['ceo'] }, expense(18_000_000))).toEqual([
      'ceo',
    ]);
  });

  it('never lets anyone approve their own request', () => {
    const ceo = {
      requesterId: 'ceo',
      managerChain: [],
      departmentManagers: [],
      leaders: ['ceo', 'owner'],
    };
    expect(approvalChain(ceo, expense(50_000_000))).toEqual(['owner']);
    expect(approvalChain({ ...ceo, leaders: ['ceo'] }, expense(50_000_000))).toEqual([]);
  });
});

describe('request forms', () => {
  it('validates each kind', () => {
    expect(
      createRequestRequest.safeParse({
        kind: 'leave',
        data: { kind: 'daily', startsOn: '2026-10-27', endsOn: '2026-10-29' },
      }).success,
    ).toBe(true);
    expect(
      createRequestRequest.safeParse({
        kind: 'leave',
        data: { kind: 'daily', startsOn: '2026-10-29', endsOn: '2026-10-27' },
      }).success,
    ).toBe(false);
    expect(
      createRequestRequest.safeParse({
        kind: 'leave',
        data: { kind: 'hourly', on: '2026-10-27', from: '10:00', to: '09:45' },
      }).success,
    ).toBe(false);
    expect(
      createRequestRequest.safeParse({
        kind: 'expense',
        data: { amountToman: 18_000_000, category: 'equipment', description: 'هدست' },
      }).success,
    ).toBe(true);
    expect(
      createRequestRequest.safeParse({ kind: 'general', data: { body: 'سلام سلام' } }).success,
    ).toBe(false);
    expect(decideRequestRequest.parse({ decision: 'approved' }).comment).toBe('');
  });

  it('counts the working days a leave takes', () => {
    // Saturday 2026-10-24 to Saturday 2026-10-31: Fridays off by default.
    expect(leaveWorkingDays(DEFAULT_WORK_CALENDAR, '2026-10-24', '2026-10-31')).toBe(7);
    expect(leaveWorkingDays(DEFAULT_WORK_CALENDAR, '2026-10-30', '2026-10-30')).toBe(0);
    expect(
      leaveWorkingDays(
        { ...DEFAULT_WORK_CALENDAR, holidays: ['2026-10-25'] },
        '2026-10-24',
        '2026-10-26',
      ),
    ).toBe(2);
  });
});
