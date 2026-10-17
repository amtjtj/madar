import { describe, expect, it } from 'vitest';

import { can, requiresTwoFactor, scopeFor, SYSTEM_ROLE_GRANTS, type Actor } from './permissions.js';

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    memberId: 'me',
    roles: ['member'],
    grants: SYSTEM_ROLE_GRANTS.member,
    departments: [{ id: 'support', deptRole: 'member' }],
    oversight: [],
    ...overrides,
  };
}

describe('can', () => {
  it('limits department-scoped work to the actor’s departments', () => {
    const a = actor();
    expect(can(a, 'task.read', { departmentId: 'support' })).toBe(true);
    expect(can(a, 'task.read', { departmentId: 'engineering' })).toBe(false);
  });

  it('lets everyone read the company structure', () => {
    expect(can(actor(), 'department.read')).toBe(true);
    expect(can(actor(), 'org_chart.read')).toBe(true);
  });

  it('denies what the role does not grant', () => {
    expect(can(actor(), 'member.create')).toBe(false);
    expect(can(actor(), 'audit.read')).toBe(false);
  });

  it('gives oversight departments tenant-wide read on configured resources only', () => {
    const exec = actor({ oversight: ['task', 'goal'] });
    expect(can(exec, 'task.read', { departmentId: 'engineering' })).toBe(true);
    expect(scopeFor(exec, 'goal.read')).toBe('tenant');
    expect(can(exec, 'leave.read')).toBe(false);
  });

  it('keeps oversight read-only', () => {
    const hr = actor({ oversight: ['member'] });
    expect(can(hr, 'member.read')).toBe(true);
    expect(can(hr, 'member.update')).toBe(false);
  });

  it('reserves oversight changes for the owner', () => {
    const admin = actor({ roles: ['admin'], grants: SYSTEM_ROLE_GRANTS.admin });
    const owner = actor({ roles: ['owner'], grants: SYSTEM_ROLE_GRANTS.owner });
    expect(can(admin, 'department.set_oversight')).toBe(false);
    expect(can(owner, 'department.set_oversight')).toBe(true);
  });

  it('matches own scope by member id', () => {
    const a = actor({ grants: [['task.read', 'own']] });
    expect(can(a, 'task.read', { ownerMemberId: 'me' })).toBe(true);
    expect(can(a, 'task.read', { ownerMemberId: 'someone' })).toBe(false);
  });
});

describe('requiresTwoFactor', () => {
  it('applies to owners and admins only', () => {
    expect(requiresTwoFactor(['owner'])).toBe(true);
    expect(requiresTwoFactor(['member', 'admin'])).toBe(true);
    expect(requiresTwoFactor(['hr_manager', 'member'])).toBe(false);
  });
});
