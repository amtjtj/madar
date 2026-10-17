import type { Actor, SystemRole } from '@madar/shared';

import { forbidden } from '../common/errors.js';

/**
 * Who may act on whose account. Permissions say *what* an actor can do; these rules protect
 * the people above them: only an owner touches an owner, only owner/admin touch an admin.
 */
export function assertCanManage(actor: Actor, targetRoles: readonly string[]): void {
  const isOwner = actor.roles.includes('owner');
  const isAdmin = actor.roles.includes('admin');
  if (targetRoles.includes('owner') && !isOwner)
    throw forbidden('Only an owner can manage an owner');
  if (targetRoles.includes('admin') && !isOwner && !isAdmin) {
    throw forbidden('Only an owner or admin can manage an admin');
  }
}

/** Granting or removing roles: owner role only by owners; admin role only by owners/admins. */
export function assertCanAssignRoles(
  actor: Actor,
  before: readonly string[],
  after: readonly SystemRole[],
): void {
  const changed = new Set([
    ...before.filter((r) => !after.includes(r as SystemRole)),
    ...after.filter((r) => !before.includes(r)),
  ]);
  assertCanManage(actor, [...changed]);
}
