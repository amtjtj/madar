/**
 * Permissions (ADR 0005): an action plus a scope. Defined here, enforced in the API;
 * the web uses the same `can()` only to hide controls.
 */

export const PERMISSIONS = [
  'tenant.manage',
  'member.read',
  'member.create',
  'member.update',
  'member.change_role',
  'member.reset_credentials',
  'member.suspend',
  'department.read',
  'department.manage',
  'department.set_oversight',
  'org_chart.read',
  'audit.read',
  // Work content
  'task.read',
  /** Edit, weigh and delete any task or project in scope (beyond what involvement allows). */
  'task.manage',
  'project.read',
  'goal.read',
  'metric.read',
  'approval.read',
  'leave.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const SCOPES = ['tenant', 'department_tree', 'department', 'own'] as const;
export type Scope = (typeof SCOPES)[number];

export const SYSTEM_ROLES = ['owner', 'admin', 'executive', 'hr_manager', 'member'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

/** Roles whose holders must use two-factor authentication. */
export const ROLES_REQUIRING_2FA: readonly SystemRole[] = ['owner', 'admin'];

export type Grant = readonly [Permission, Scope];

const all = (scope: Scope, ...permissions: Permission[]): Grant[] =>
  permissions.map((p) => [p, scope] as const);

/** Default grants seeded for each system role when a tenant is created. */
export const SYSTEM_ROLE_GRANTS: Record<SystemRole, Grant[]> = {
  owner: all('tenant', ...PERMISSIONS),
  // System administration, not content management: no oversight changes, no task.manage.
  admin: all(
    'tenant',
    ...PERMISSIONS.filter(
      (p) => p !== 'department.set_oversight' && p !== 'tenant.manage' && p !== 'task.manage',
    ),
  ),
  executive: all(
    'tenant',
    'member.read',
    'department.read',
    'org_chart.read',
    'task.read',
    'project.read',
    'goal.read',
    'metric.read',
    'approval.read',
  ),
  hr_manager: all(
    'tenant',
    'member.read',
    'member.create',
    'member.update',
    'member.reset_credentials',
    'member.suspend',
    'department.read',
    'org_chart.read',
    'leave.read',
  ),
  // Everyone sees the company structure and directory; work content stays within departments.
  member: [
    ...all('tenant', 'member.read', 'department.read', 'org_chart.read'),
    ...all('department', 'task.read', 'project.read', 'goal.read', 'metric.read'),
  ],
};

/** Resources an oversight department can be given tenant-wide read access to. */
export const OVERSIGHT_RESOURCES = [
  'task',
  'project',
  'goal',
  'metric',
  'approval',
  'member',
  'leave',
  'org_chart',
] as const;
export type OversightResource = (typeof OVERSIGHT_RESOURCES)[number];

export type DeptRole = 'head' | 'manager' | 'member' | 'viewer';

export interface Actor {
  memberId: string;
  roles: string[];
  grants: Grant[];
  departments: Array<{ id: string; deptRole: DeptRole }>;
  /** Resources readable tenant-wide because the member belongs to an oversight department. */
  oversight: OversightResource[];
}

/** What a permission check is about. Omit for tenant-level actions. */
export interface Resource {
  /** Department the resource belongs to. */
  departmentId?: string | null;
  /** Departments the resource belongs to, when more than one (e.g. a member). */
  departmentIds?: readonly string[];
  /** Member who owns / is the resource (for `own` scope). */
  ownerMemberId?: string | null;
}

const SCOPE_RANK: Record<Scope, number> = { own: 0, department: 1, department_tree: 2, tenant: 3 };

/** The widest scope the actor holds for a permission, or null if none. */
export function scopeFor(actor: Actor, permission: Permission): Scope | null {
  let best: Scope | null = null;
  for (const [p, scope] of actor.grants) {
    if (p === permission && (best === null || SCOPE_RANK[scope] > SCOPE_RANK[best])) best = scope;
  }
  const [resource, action] = permission.split('.') as [string, string];
  if (action === 'read' && (actor.oversight as string[]).includes(resource)) return 'tenant';
  return best;
}

/** Whether the actor may perform `permission` on `resource`. */
export function can(actor: Actor, permission: Permission, resource: Resource = {}): boolean {
  const scope = scopeFor(actor, permission);
  if (scope === null) return false;
  if (scope === 'tenant') return true;

  const actorDepartments = new Set(actor.departments.map((d) => d.id));
  const resourceDepartments = [
    ...(resource.departmentId ? [resource.departmentId] : []),
    ...(resource.departmentIds ?? []),
  ];
  const inMyDepartment = resourceDepartments.some((id) => actorDepartments.has(id));
  const mine = resource.ownerMemberId != null && resource.ownerMemberId === actor.memberId;

  switch (scope) {
    // department_tree needs the department hierarchy; the API resolves descendants before calling.
    case 'department_tree':
    case 'department':
      return inMyDepartment || mine;
    case 'own':
      return mine;
  }
}

export function requiresTwoFactor(roles: readonly string[]): boolean {
  return roles.some((role) => (ROLES_REQUIRING_2FA as readonly string[]).includes(role));
}
