import { HttpStatus, Injectable } from '@nestjs/common';
import { emitEvent, schema as s, type Tx } from '@madar/db';
import { t } from '@madar/i18n';
import {
  allStatuses,
  instantiateTemplate,
  TEMPLATE_KEYS,
  TEMPLATE_VERSION,
  type ApplyTemplateRequest,
  type ConfigMappings,
  type DepartmentConfig,
  type DepartmentConfigDetail,
  type ModuleConfig,
  type SaveConfigRequest,
  type TemplateSummary,
} from '@madar/shared';
import { and, eq, isNull } from 'drizzle-orm';

import type { TenantContext } from '../common/context.js';
import { ApiError, notFound } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.service.js';
import {
  configFor,
  configUsage,
  loadConfigs,
  translate,
  type ActiveConfig,
} from './module-config.js';

@Injectable()
export class ModuleConfigService {
  constructor(private readonly db: TenantDb) {}

  templates(): TemplateSummary[] {
    return TEMPLATE_KEYS.map((key) => {
      const config = instantiateTemplate(key, translate);
      return {
        key,
        name: t(`templates.names.${key}`),
        description: t(`templates.descriptions.${key}`),
        types: config.workItemTypes.map((type) => type.label),
        statuses: allStatuses(config),
        config,
      };
    });
  }

  /** Active configs of every active department (readable by all members; ADR 0004). */
  list(ctx: TenantContext): Promise<DepartmentConfig[]> {
    return this.db.run(ctx, async (tx) => {
      const departments = await tx
        .select({ id: s.departments.id })
        .from(s.departments)
        .where(isNull(s.departments.archivedAt));
      const configs = await loadConfigs(
        tx,
        departments.map((d) => d.id),
      );
      return [...configs].map(([departmentId, c]) => ({ departmentId, ...c }));
    });
  }

  detail(ctx: TenantContext, departmentId: string): Promise<DepartmentConfigDetail> {
    return this.db.run(ctx, async (tx) => {
      await requireDepartment(tx, departmentId);
      const active = await configFor(tx, departmentId);
      return { departmentId, ...active, usage: await configUsage(tx, departmentId) };
    });
  }

  save(
    ctx: TenantContext,
    departmentId: string,
    input: SaveConfigRequest,
  ): Promise<DepartmentConfigDetail> {
    return this.db.run(ctx, async (tx) => {
      const current = await this.lockCurrent(tx, departmentId, input.version);
      await this.apply(tx, ctx, departmentId, current, input.config, input.mappings, {
        templateKey: current.templateKey,
        action: 'department.config_saved',
      });
      return this.detailIn(tx, departmentId);
    });
  }

  applyTemplate(
    ctx: TenantContext,
    departmentId: string,
    input: ApplyTemplateRequest,
  ): Promise<DepartmentConfigDetail> {
    return this.db.run(ctx, async (tx) => {
      const current = await this.lockCurrent(tx, departmentId, input.version);
      const next = instantiateTemplate(input.templateKey, translate);
      await this.apply(tx, ctx, departmentId, current, next, input.mappings, {
        templateKey: input.templateKey,
        action: 'department.template_applied',
      });
      await tx
        .update(s.departments)
        .set({ templateKey: input.templateKey })
        .where(eq(s.departments.id, departmentId));
      return this.detailIn(tx, departmentId);
    });
  }

  private async detailIn(tx: Tx, departmentId: string): Promise<DepartmentConfigDetail> {
    const active = await configFor(tx, departmentId);
    return { departmentId, ...active, usage: await configUsage(tx, departmentId) };
  }

  /** One save at a time per department (row lock), and only on top of the version the editor read. */
  private async lockCurrent(tx: Tx, departmentId: string, version: number): Promise<ActiveConfig> {
    await requireDepartment(tx, departmentId, true);
    const current = await configFor(tx, departmentId);
    if (current.version !== version) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'config_version_conflict',
        'The config was changed by someone else',
        { version: current.version },
      );
    }
    return current;
  }

  private async apply(
    tx: Tx,
    ctx: TenantContext,
    departmentId: string,
    current: ActiveConfig,
    next: ModuleConfig,
    mappings: ConfigMappings | undefined,
    meta: { templateKey: string | null; action: string },
  ): Promise<void> {
    const before = current.config;
    const nextStatuses = new Map(allStatuses(next).map((st) => [st.key, st]));

    // A status key keeps its category for good: rows store both (ADR 0004), and moving finished
    // work back to open (or the other way) would change XP and reports behind people's backs.
    for (const status of allStatuses(before)) {
      const kept = nextStatuses.get(status.key);
      if (kept && kept.category !== status.category) {
        throw new ApiError(
          HttpStatus.BAD_REQUEST,
          'invalid_config',
          'A status keeps its category',
          {
            status: status.key,
          },
        );
      }
    }

    // Work in a status or type the new config drops moves where the admin says. A status moves
    // only within its category, so completion times, XP and reports stay as they are and no task
    // events are needed.
    const usage = await configUsage(tx, departmentId);
    const statusMap = mappings?.statuses ?? {};
    const typeMap = mappings?.types ?? {};
    const movedStatuses: Record<string, string> = {};
    const unmappedStatuses: string[] = [];
    for (const key of Object.keys(usage.statuses).filter((k) => !nextStatuses.has(k))) {
      const target = nextStatuses.get(statusMap[key] ?? '');
      if (target) {
        await tx
          .update(s.tasks)
          .set({ statusKey: target.key })
          .where(
            and(
              eq(s.tasks.departmentId, departmentId),
              eq(s.tasks.statusKey, key),
              eq(s.tasks.statusCategory, target.category),
            ),
          );
        movedStatuses[key] = target.key;
      }
      const [left] = await tx
        .select({ id: s.tasks.id })
        .from(s.tasks)
        .where(and(eq(s.tasks.departmentId, departmentId), eq(s.tasks.statusKey, key)))
        .limit(1);
      if (left) unmappedStatuses.push(key);
    }
    if (unmappedStatuses.length) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'status_mapping_required',
        'Removed statuses still have work',
        { statuses: unmappedStatuses },
      );
    }
    const nextTypes = new Set(next.workItemTypes.map((type) => type.key));
    const goneTypes = Object.keys(usage.types).filter((k) => !nextTypes.has(k));
    const unmappedTypes = goneTypes.filter((k) => !nextTypes.has(typeMap[k] ?? ''));
    if (unmappedTypes.length) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'type_mapping_required',
        'Removed types still have work',
        { types: unmappedTypes },
      );
    }
    const movedTypes: Record<string, string> = {};
    for (const key of goneTypes) {
      const target = typeMap[key] as string;
      movedTypes[key] = target;
      await tx
        .update(s.tasks)
        .set({ typeKey: target })
        .where(and(eq(s.tasks.departmentId, departmentId), eq(s.tasks.typeKey, key)));
    }

    const version = current.version + 1;
    await tx.insert(s.moduleConfigs).values({
      departmentId,
      templateKey: meta.templateKey,
      templateVersion: meta.action === 'department.template_applied' ? TEMPLATE_VERSION : null,
      version,
      config: next,
      createdBy: ctx.memberId,
    });
    await this.db.audit(tx, ctx, {
      action: meta.action,
      subjectType: 'department',
      subjectId: departmentId,
      before: { version: current.version, templateKey: current.templateKey },
      after: {
        version,
        templateKey: meta.templateKey,
        statuses: allStatuses(next).length,
        types: next.workItemTypes.length,
        fields: next.fields.length,
        movedStatuses,
        movedTypes,
      },
    });
    await emitEvent(tx, 'department.config_changed', { departmentId, version }, ctx.memberId);
  }
}

async function requireDepartment(tx: Tx, departmentId: string, lock = false): Promise<void> {
  const query = tx
    .select({ id: s.departments.id })
    .from(s.departments)
    .where(and(eq(s.departments.id, departmentId), isNull(s.departments.archivedAt)));
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw notFound('Department');
}
