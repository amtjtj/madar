import { z } from 'zod';

import { configMappings, moduleConfig, statusDef } from '../module-config.js';
import { TEMPLATE_KEYS } from '../templates.js';

/** A built-in template as the department dialog previews it. */
export const templateSummary = z.object({
  key: z.enum(TEMPLATE_KEYS),
  name: z.string(),
  description: z.string(),
  types: z.array(z.string()),
  statuses: z.array(statusDef),
  /** The config a department gets from it (the editor works out mappings from it). */
  config: moduleConfig,
});
export type TemplateSummary = z.infer<typeof templateSummary>;

/** A department's active config; version 0 means it still runs on the general default. */
export const departmentConfig = z.object({
  departmentId: z.uuid(),
  templateKey: z.string().nullable(),
  version: z.number().int().min(0),
  config: moduleConfig,
});
export type DepartmentConfig = z.infer<typeof departmentConfig>;

/** For the editor: how much work uses each status and type (a removal then needs a mapping). */
export const departmentConfigDetail = departmentConfig.extend({
  usage: z.object({
    statuses: z.record(z.string(), z.number().int()),
    types: z.record(z.string(), z.number().int()),
  }),
});
export type DepartmentConfigDetail = z.infer<typeof departmentConfigDetail>;

export const saveConfigRequest = z.object({
  /** The version the editor loaded; a mismatch returns config_version_conflict. */
  version: z.number().int().min(0),
  config: moduleConfig,
  mappings: configMappings.optional(),
});
export type SaveConfigRequest = z.infer<typeof saveConfigRequest>;

export const applyTemplateRequest = z.object({
  version: z.number().int().min(0),
  templateKey: z.enum(TEMPLATE_KEYS),
  mappings: configMappings.optional(),
});
export type ApplyTemplateRequest = z.infer<typeof applyTemplateRequest>;
