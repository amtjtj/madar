import type { StatusCategory } from './contracts/work.js';
import {
  moduleConfig,
  type FieldType,
  type ModuleConfig,
  type StatusColor,
  type TypeIcon,
} from './module-config.js';

/**
 * Built-in department templates (plan phase-3-step-19a). Labels here are i18n keys under
 * `templates.*`; `instantiateTemplate` resolves them once, when a department is made from a
 * template, and from then on the text is company data. Every template keeps the four core status
 * keys (`todo`, `in_progress`, `done`, `canceled`) so applying one to a department never needs a
 * mapping for work made under the general config. The first type is the default; «کار» (weight 1)
 * comes first wherever a heavier type exists, so plain work never pays more than before.
 */

export const TEMPLATE_KEYS = [
  'general',
  'executive',
  'engineering',
  'marketing',
  'support',
  'hr',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Bumped when a template changes (upgrade offers come after the MVP; ADR 0004). */
export const TEMPLATE_VERSION = 1;

export function isTemplateKey(key: string | null | undefined): key is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(key ?? '');
}

type S = [key: string, category: StatusCategory, color: StatusColor];
type F = [key: string, type: FieldType, required?: boolean, options?: string[]];
type T = [key: string, icon: TypeIcon, fields: string[], defaultWeight?: number];

interface TemplateSpec {
  vocabulary: [task: string, project: string];
  statuses: S[];
  fields: F[];
  types: T[];
}

const CORE: S[] = [
  ['todo', 'todo', 'gray'],
  ['in_progress', 'in_progress', 'blue'],
  ['done', 'done', 'green'],
  ['canceled', 'canceled', 'red'],
];

const SPECS: Record<TemplateKey, TemplateSpec> = {
  general: {
    vocabulary: ['task', 'project'],
    statuses: CORE,
    fields: [],
    types: [['task', 'task', []]],
  },
  executive: {
    vocabulary: ['task', 'project'],
    statuses: CORE,
    fields: [['meeting_date', 'date']],
    types: [
      ['task', 'task', []],
      ['decision', 'decision', ['meeting_date'], 2],
    ],
  },
  engineering: {
    vocabulary: ['task', 'release'],
    statuses: [
      ['backlog', 'todo', 'gray'],
      ['todo', 'todo', 'teal'],
      ['in_progress', 'in_progress', 'blue'],
      ['review', 'in_progress', 'violet'],
      ['done', 'done', 'green'],
      ['canceled', 'canceled', 'red'],
    ],
    fields: [
      ['severity', 'select', false, ['critical', 'high', 'medium', 'low']],
      ['environment', 'select', false, ['production', 'staging', 'development']],
      ['points', 'number'],
    ],
    types: [
      ['task', 'task', []],
      ['story', 'story', ['points'], 2],
      ['bug', 'bug', ['severity', 'environment'], 2],
      ['roadmap_item', 'roadmap', [], 3],
    ],
  },
  marketing: {
    vocabulary: ['task', 'campaign'],
    statuses: [
      ['todo', 'todo', 'gray'],
      ['in_progress', 'in_progress', 'blue'],
      ['awaiting_approval', 'in_progress', 'amber'],
      ['scheduled', 'in_progress', 'violet'],
      ['done', 'done', 'green'],
      ['canceled', 'canceled', 'red'],
    ],
    fields: [
      ['channels', 'multiselect', false, ['instagram', 'telegram', 'website', 'email', 'sms']],
      ['publish_on', 'date'],
      ['link', 'url'],
    ],
    types: [
      ['task', 'task', []],
      ['content', 'content', ['channels', 'publish_on', 'link'], 2],
    ],
  },
  support: {
    vocabulary: ['ticket', 'project'],
    statuses: [
      ['new', 'todo', 'orange'],
      ['todo', 'todo', 'gray'],
      ['in_progress', 'in_progress', 'blue'],
      ['waiting_customer', 'in_progress', 'amber'],
      ['done', 'done', 'green'],
      ['canceled', 'canceled', 'red'],
    ],
    fields: [
      ['channel', 'select', true, ['phone', 'chat', 'email', 'app']],
      ['customer', 'text'],
      ['category', 'select', false, ['payment', 'account', 'gold', 'app_bug', 'other']],
      ['customer_priority', 'select', false, ['urgent', 'normal', 'low']],
    ],
    types: [
      ['ticket', 'ticket', ['channel', 'customer', 'category', 'customer_priority']],
      ['task', 'task', []],
    ],
  },
  hr: {
    vocabulary: ['task', 'project'],
    statuses: CORE,
    fields: [
      ['position', 'text'],
      ['stage', 'select', false, ['screening', 'interview', 'offer', 'hired']],
    ],
    types: [
      ['task', 'task', []],
      ['hire', 'hire', ['position', 'stage'], 2],
    ],
  },
};

export type Translate = (key: string) => string;

/** The template as a company config, with its labels resolved by `translate`. */
export function instantiateTemplate(key: TemplateKey, translate: Translate): ModuleConfig {
  const spec = SPECS[key];
  const [task, project] = spec.vocabulary;
  return moduleConfig.parse({
    schemaVersion: 1,
    vocabulary: {
      task: translate(`templates.vocabulary.${task}`),
      taskPlural: translate(`templates.vocabulary.${task}Plural`),
      project: translate(`templates.vocabulary.${project}`),
      projectPlural: translate(`templates.vocabulary.${project}Plural`),
    },
    fields: spec.fields.map(([fieldKey, type, required = false, options]) => ({
      key: fieldKey,
      label: translate(`templates.fields.${fieldKey}`),
      type,
      required,
      ...(options && {
        options: options.map((o) => ({ key: o, label: translate(`templates.options.${o}`) })),
      }),
    })),
    workflows: [
      {
        key: 'main',
        statuses: spec.statuses.map(([statusKey, category, color]) => ({
          key: statusKey,
          label: translate(`templates.statuses.${key}.${statusKey}`),
          category,
          color,
        })),
      },
    ],
    workItemTypes: spec.types.map(([typeKey, icon, fields, defaultWeight = 1]) => ({
      key: typeKey,
      label: translate(`templates.types.${typeKey}`),
      icon,
      workflow: 'main',
      fields,
      defaultWeight,
    })),
  });
}
