import { z } from 'zod';

import { STATUS_CATEGORIES, type StatusCategory } from './contracts/work.js';

/**
 * A department module as a versioned config document (ADR 0004, plan phase-3-step-19a). Keys are
 * immutable once made (rows store them); labels are company data and may change. Schema version 1
 * holds the work parts; forms, approval flows and metrics join it later as optional keys.
 */

export const FIELD_TYPES = [
  'text',
  'longtext',
  'number',
  'money',
  'date',
  'select',
  'multiselect',
  'member',
  'url',
  'boolean',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Status colours; the UI maps each to a design token. */
export const STATUS_COLORS = [
  'gray',
  'blue',
  'violet',
  'amber',
  'orange',
  'green',
  'teal',
  'red',
] as const;
export type StatusColor = (typeof STATUS_COLORS)[number];

/** Work item type icons; the UI maps each to an icon. */
export const TYPE_ICONS = [
  'task',
  'ticket',
  'bug',
  'story',
  'content',
  'decision',
  'roadmap',
  'hire',
  'document',
  'idea',
] as const;
export type TypeIcon = (typeof TYPE_ICONS)[number];

export const CONFIG_LIMITS = {
  statuses: 12,
  types: 10,
  fields: 30,
  options: 30,
  textLength: 500,
  longtextLength: 5000,
  urlLength: 500,
} as const;

export const configKey = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const configLabel = z.string().trim().min(1).max(40);

export const fieldOption = z.object({ key: configKey, label: configLabel });
export type FieldOption = z.infer<typeof fieldOption>;

export const fieldDef = z.object({
  key: configKey,
  label: configLabel,
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  options: z.array(fieldOption).max(CONFIG_LIMITS.options).optional(),
});
export type FieldDef = z.infer<typeof fieldDef>;

export const statusDef = z.object({
  key: configKey,
  label: configLabel,
  category: z.enum(STATUS_CATEGORIES),
  color: z.enum(STATUS_COLORS),
});
export type StatusDef = z.infer<typeof statusDef>;

export const workflowDef = z.object({
  key: configKey,
  statuses: z.array(statusDef).min(2).max(CONFIG_LIMITS.statuses),
});
export type WorkflowDef = z.infer<typeof workflowDef>;

export const workItemTypeDef = z.object({
  key: configKey,
  label: configLabel,
  icon: z.enum(TYPE_ICONS),
  workflow: configKey,
  fields: z.array(configKey).max(CONFIG_LIMITS.fields),
  defaultWeight: z.number().int().min(1).max(5).default(1),
});
export type WorkItemTypeDef = z.infer<typeof workItemTypeDef>;

export const vocabulary = z.object({
  task: configLabel,
  taskPlural: configLabel,
  project: configLabel,
  projectPlural: configLabel,
});
export type Vocabulary = z.infer<typeof vocabulary>;

function duplicates(keys: readonly string[]): string[] {
  return keys.filter((k, i) => keys.indexOf(k) !== i);
}

export const moduleConfig = z
  .object({
    schemaVersion: z.literal(1),
    vocabulary,
    fields: z.array(fieldDef).max(CONFIG_LIMITS.fields),
    workflows: z.array(workflowDef).min(1).max(5),
    workItemTypes: z.array(workItemTypeDef).min(1).max(CONFIG_LIMITS.types),
  })
  .superRefine((config, ctx) => {
    const issue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: 'custom', message, path });

    for (const k of duplicates(config.fields.map((f) => f.key)))
      issue(`duplicate field ${k}`, ['fields']);
    for (const k of duplicates(config.workflows.map((w) => w.key))) {
      issue(`duplicate workflow ${k}`, ['workflows']);
    }
    for (const k of duplicates(config.workItemTypes.map((t) => t.key))) {
      issue(`duplicate type ${k}`, ['workItemTypes']);
    }

    config.fields.forEach((f, i) => {
      const choice = f.type === 'select' || f.type === 'multiselect';
      if (choice && !f.options?.length) issue('options required', ['fields', i, 'options']);
      if (!choice && f.options !== undefined)
        issue('options not allowed', ['fields', i, 'options']);
      for (const k of duplicates((f.options ?? []).map((o) => o.key))) {
        issue(`duplicate option ${k}`, ['fields', i, 'options']);
      }
    });

    config.workflows.forEach((w, i) => {
      for (const k of duplicates(w.statuses.map((s) => s.key))) {
        issue(`duplicate status ${k}`, ['workflows', i, 'statuses']);
      }
      for (const category of ['todo', 'done'] as const) {
        if (!w.statuses.some((s) => s.category === category)) {
          issue(`needs a ${category} status`, ['workflows', i, 'statuses']);
        }
      }
    });

    // One status key means one thing across workflows (rows keep only the key and its category).
    const categories = new Map<string, StatusCategory>();
    for (const s of config.workflows.flatMap((w) => w.statuses)) {
      const seen = categories.get(s.key);
      if (seen && seen !== s.category) issue(`status ${s.key} changes category`, ['workflows']);
      categories.set(s.key, s.category);
    }

    const fieldKeys = new Set(config.fields.map((f) => f.key));
    const workflowKeys = new Set(config.workflows.map((w) => w.key));
    config.workItemTypes.forEach((t, i) => {
      if (!workflowKeys.has(t.workflow))
        issue('unknown workflow', ['workItemTypes', i, 'workflow']);
      for (const f of t.fields) {
        if (!fieldKeys.has(f)) issue(`unknown field ${f}`, ['workItemTypes', i, 'fields']);
      }
      for (const k of duplicates(t.fields))
        issue(`duplicate field ${k}`, ['workItemTypes', i, 'fields']);
    });
  });
export type ModuleConfig = z.infer<typeof moduleConfig>;

export function defaultType(config: ModuleConfig): WorkItemTypeDef {
  // The schema keeps at least one type.
  return config.workItemTypes[0] as WorkItemTypeDef;
}

export function typeOf(config: ModuleConfig, typeKey: string): WorkItemTypeDef | undefined {
  return config.workItemTypes.find((t) => t.key === typeKey);
}

/** The statuses a work item type moves through (its workflow, in order). */
export function statusesOf(config: ModuleConfig, typeKey: string): StatusDef[] {
  const type = typeOf(config, typeKey) ?? defaultType(config);
  return config.workflows.find((w) => w.key === type.workflow)?.statuses ?? [];
}

/** Every status of the department once, in workflow order (board columns, labels). */
export function allStatuses(config: ModuleConfig): StatusDef[] {
  const seen = new Set<string>();
  return config.workflows
    .flatMap((w) => w.statuses)
    .filter((s) => !seen.has(s.key) && seen.add(s.key));
}

export function findStatus(
  config: ModuleConfig,
  typeKey: string,
  statusKey: string,
): StatusDef | undefined {
  return statusesOf(config, typeKey).find((s) => s.key === statusKey);
}

/**
 * The first status of a category in a type's workflow: where new work starts, where «done» and
 * «reopen» go, and where recorded progress moves an open task. Null when the workflow has none
 * of that category (only `in_progress` and `canceled` may be missing).
 */
export function defaultStatus(
  config: ModuleConfig,
  typeKey: string,
  category: StatusCategory,
): StatusDef | null {
  return statusesOf(config, typeKey).find((s) => s.category === category) ?? null;
}

export function fieldsOf(config: ModuleConfig, typeKey: string): FieldDef[] {
  const type = typeOf(config, typeKey);
  if (!type) return [];
  return type.fields
    .map((k) => config.fields.find((f) => f.key === k))
    .filter((f): f is FieldDef => f !== undefined);
}

export type FieldValue = string | number | boolean | string[];
export type FieldValues = Record<string, FieldValue>;

export type FieldValueError = {
  code: 'invalid_field_value' | 'required_field_missing';
  field: string;
};

const isoDate = z.iso.date();
const uuid = z.uuid();

function validValue(field: FieldDef, value: unknown): FieldValue | undefined {
  const options = new Set((field.options ?? []).map((o) => o.key));
  switch (field.type) {
    case 'text':
    case 'longtext': {
      if (typeof value !== 'string') return undefined;
      const text = value.trim();
      const max = field.type === 'text' ? CONFIG_LIMITS.textLength : CONFIG_LIMITS.longtextLength;
      return text.length > 0 && text.length <= max ? text : undefined;
    }
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e12
        ? value
        : undefined;
    case 'money':
      return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value
        : undefined;
    case 'date':
      return typeof value === 'string' && isoDate.safeParse(value).success ? value : undefined;
    case 'select':
      return typeof value === 'string' && options.has(value) ? value : undefined;
    case 'multiselect': {
      if (!Array.isArray(value) || value.length === 0) return undefined;
      const keys = value.filter((v): v is string => typeof v === 'string' && options.has(v));
      return keys.length === value.length && new Set(keys).size === keys.length ? keys : undefined;
    }
    case 'member':
      return typeof value === 'string' && uuid.safeParse(value).success ? value : undefined;
    case 'url': {
      // http(s) only (never `javascript:`), no spaces; checked as text so it runs everywhere.
      if (typeof value !== 'string') return undefined;
      const url = value.trim();
      return url.length <= CONFIG_LIMITS.urlLength && /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(url)
        ? url
        : undefined;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
  }
}

/**
 * Checks values against a type's fields and merges them into `current`: `null` clears a field,
 * a key the type does not have is refused. `requireAll` (creating a task) needs every required
 * field. Values of fields no longer on the type stay stored, untouched.
 */
export function validateFieldValues(
  fields: readonly FieldDef[],
  input: Record<string, unknown>,
  current: FieldValues = {},
  requireAll = false,
): { ok: true; values: FieldValues } | { ok: false; error: FieldValueError } {
  let values: FieldValues = { ...current };
  for (const [key, raw] of Object.entries(input)) {
    const field = fields.find((f) => f.key === key);
    if (!field) return { ok: false, error: { code: 'invalid_field_value', field: key } };
    if (raw === null) {
      if (field.required)
        return { ok: false, error: { code: 'required_field_missing', field: key } };
      values = Object.fromEntries(Object.entries(values).filter(([k]) => k !== key));
      continue;
    }
    const value = validValue(field, raw);
    if (value === undefined)
      return { ok: false, error: { code: 'invalid_field_value', field: key } };
    values[key] = value;
  }
  if (requireAll) {
    const missing = fields.find((f) => f.required && values[f.key] === undefined);
    if (missing)
      return { ok: false, error: { code: 'required_field_missing', field: missing.key } };
  }
  return { ok: true, values };
}

/** Status and type keys a new config drops (rows using them need a mapping). */
export function removedKeys(
  before: ModuleConfig,
  after: ModuleConfig,
): { statuses: string[]; types: string[] } {
  const afterStatuses = new Set(allStatuses(after).map((s) => s.key));
  const afterTypes = new Set(after.workItemTypes.map((t) => t.key));
  return {
    statuses: allStatuses(before)
      .map((s) => s.key)
      .filter((k) => !afterStatuses.has(k)),
    types: before.workItemTypes.map((t) => t.key).filter((k) => !afterTypes.has(k)),
  };
}

export const configMappings = z.object({
  statuses: z.record(configKey, configKey).default({}),
  types: z.record(configKey, configKey).default({}),
});
export type ConfigMappings = z.infer<typeof configMappings>;

/** A fresh key for something an admin adds (admins never see or choose keys). */
export function newConfigKey(prefix: 's' | 't' | 'f' | 'o', taken: Iterable<string>): string {
  const used = new Set(taken);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (;;) {
    let suffix = '';
    for (let i = 0; i < 6; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    const key = `${prefix}_${suffix}`;
    if (!used.has(key)) return key;
  }
}
