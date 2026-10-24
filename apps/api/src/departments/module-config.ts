import { HttpStatus } from '@nestjs/common';
import { schema as s, type Tx } from '@madar/db';
import { t, type MessageKey } from '@madar/i18n';
import {
  instantiateTemplate,
  moduleConfig,
  TEMPLATE_VERSION,
  type FieldDef,
  type FieldValues,
  type ModuleConfig,
  type TemplateKey,
  type Translate,
} from '@madar/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { TenantContext } from '../common/context.js';
import { ApiError } from '../common/errors.js';

/**
 * Department configs (ADR 0004, plan phase-3-step-19a). Everything that needs a department's
 * statuses, work types or fields reads them here, once per request; a department with no saved
 * version runs on the general template.
 */

export const translate: Translate = (key) => t(key as MessageKey);

export interface ActiveConfig {
  /** 0 while the department still runs on the general default. */
  version: number;
  templateKey: string | null;
  config: ModuleConfig;
}

let general: ModuleConfig | undefined;

export function generalConfig(): ModuleConfig {
  general ??= instantiateTemplate('general', translate);
  return general;
}

/** The active config of each department (the general default for those without one). */
export async function loadConfigs(
  tx: Tx,
  departmentIds: readonly string[],
): Promise<Map<string, ActiveConfig>> {
  const ids = [...new Set(departmentIds)];
  const result = new Map<string, ActiveConfig>();
  if (ids.length === 0) return result;
  const rows = await tx
    .selectDistinctOn([s.moduleConfigs.departmentId], {
      departmentId: s.moduleConfigs.departmentId,
      version: s.moduleConfigs.version,
      templateKey: s.moduleConfigs.templateKey,
      config: s.moduleConfigs.config,
    })
    .from(s.moduleConfigs)
    .where(inArray(s.moduleConfigs.departmentId, ids))
    .orderBy(s.moduleConfigs.departmentId, desc(s.moduleConfigs.version));
  for (const row of rows) {
    result.set(row.departmentId, {
      version: row.version,
      templateKey: row.templateKey,
      config: moduleConfig.parse(row.config),
    });
  }
  for (const id of ids) {
    if (!result.has(id)) result.set(id, { version: 0, templateKey: null, config: generalConfig() });
  }
  return result;
}

export async function configFor(tx: Tx, departmentId: string): Promise<ActiveConfig> {
  const configs = await loadConfigs(tx, [departmentId]);
  return configs.get(departmentId) as ActiveConfig;
}

/** Version 1 of a new department, from its template, in the department's own transaction. */
export async function createInitialConfig(
  tx: Tx,
  ctx: TenantContext,
  departmentId: string,
  templateKey: TemplateKey,
): Promise<void> {
  await tx.insert(s.moduleConfigs).values({
    departmentId,
    templateKey,
    templateVersion: TEMPLATE_VERSION,
    version: 1,
    config: instantiateTemplate(templateKey, translate),
    createdBy: ctx.memberId,
  });
}

/** Member field values must name active members of the company. */
export async function requireMemberValues(
  tx: Tx,
  fields: readonly FieldDef[],
  values: FieldValues,
): Promise<void> {
  const ids = fields
    .filter((f) => f.type === 'member' && typeof values[f.key] === 'string')
    .map((f) => ({ field: f.key, id: values[f.key] as string }));
  if (ids.length === 0) return;
  const found = await tx
    .select({ id: s.members.id })
    .from(s.members)
    .where(
      and(
        inArray(
          s.members.id,
          ids.map((i) => i.id),
        ),
        eq(s.members.status, 'active'),
      ),
    );
  const known = new Set(found.map((m) => m.id));
  const missing = ids.find((i) => !known.has(i.id));
  if (missing) {
    throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_field_value', 'Unknown member', {
      field: missing.field,
    });
  }
}

/** How many tasks (deleted ones too) use each status and type of a department. */
export async function configUsage(
  tx: Tx,
  departmentId: string,
): Promise<{ statuses: Record<string, number>; types: Record<string, number> }> {
  const rows = await tx
    .select({
      statusKey: s.tasks.statusKey,
      typeKey: s.tasks.typeKey,
      n: sql<number>`count(*)::int`,
    })
    .from(s.tasks)
    .where(eq(s.tasks.departmentId, departmentId))
    .groupBy(s.tasks.statusKey, s.tasks.typeKey);
  const statuses: Record<string, number> = {};
  const types: Record<string, number> = {};
  for (const r of rows) {
    statuses[r.statusKey] = (statuses[r.statusKey] ?? 0) + r.n;
    types[r.typeKey] = (types[r.typeKey] ?? 0) + r.n;
  }
  return { statuses, types };
}
