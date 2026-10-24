import { describe, expect, it } from 'vitest';

import {
  allStatuses,
  defaultStatus,
  defaultType,
  fieldsOf,
  moduleConfig,
  newConfigKey,
  removedKeys,
  statusesOf,
  validateFieldValues,
  type FieldDef,
  type StatusDef,
  type WorkflowDef,
  type WorkItemTypeDef,
  type ModuleConfig,
} from './module-config.js';
import { instantiateTemplate, TEMPLATE_KEYS } from './templates.js';

const label = (key: string) => key.slice(key.lastIndexOf('.') + 1);
const main = (config: ModuleConfig) => config.workflows[0] as WorkflowDef;
const firstType = (config: ModuleConfig) => config.workItemTypes[0] as WorkItemTypeDef;

const engineering = () => instantiateTemplate('engineering', label);

describe('templates', () => {
  it.each(TEMPLATE_KEYS)('%s is a valid config with the four core status keys', (key) => {
    const config = instantiateTemplate(key, label);
    expect(moduleConfig.safeParse(config).success).toBe(true);
    const keys = allStatuses(config).map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['todo', 'in_progress', 'done', 'canceled']));
  });

  it('resolves labels through translate', () => {
    const config = instantiateTemplate('support', (k) => `«${label(k)}»`);
    expect(config.vocabulary.task).toBe('«ticket»');
    expect(defaultType(config).label).toBe('«ticket»');
  });
});

describe('moduleConfig', () => {
  const base = (): ModuleConfig => instantiateTemplate('general', label);

  it('needs a todo and a done status', () => {
    const config = base();
    main(config).statuses = main(config).statuses.filter((s) => s.category !== 'done');
    expect(moduleConfig.safeParse(config).success).toBe(false);
  });

  it('refuses duplicate keys and dangling references', () => {
    const dup = base();
    main(dup).statuses.push({ ...(main(dup).statuses[0] as StatusDef) });
    expect(moduleConfig.safeParse(dup).success).toBe(false);

    const dangling = base();
    firstType(dangling).fields = ['nope'];
    expect(moduleConfig.safeParse(dangling).success).toBe(false);

    const workflow = base();
    firstType(workflow).workflow = 'other';
    expect(moduleConfig.safeParse(workflow).success).toBe(false);
  });

  it('needs options on choice fields only', () => {
    const config = base();
    config.fields = [{ key: 'kind', label: 'نوع', type: 'select', required: false }];
    expect(moduleConfig.safeParse(config).success).toBe(false);
    config.fields = [
      {
        key: 'kind',
        label: 'نوع',
        type: 'text',
        required: false,
        options: [{ key: 'a', label: 'a' }],
      },
    ];
    expect(moduleConfig.safeParse(config).success).toBe(false);
  });

  it('refuses a key that is not a slug', () => {
    const config = base();
    (main(config).statuses[0] as StatusDef).key = 'Not A Key';
    expect(moduleConfig.safeParse(config).success).toBe(false);
  });
});

describe('statuses', () => {
  it('finds the first status of a category for a type', () => {
    const config = engineering();
    expect(defaultStatus(config, 'bug', 'todo')?.key).toBe('backlog');
    expect(defaultStatus(config, 'bug', 'in_progress')?.key).toBe('in_progress');
    expect(defaultStatus(config, 'missing', 'done')?.key).toBe('done');
    expect(statusesOf(config, 'story').map((s) => s.key)).toContain('review');
  });

  it('lists what a new config removes', () => {
    const before = engineering();
    const after = engineering();
    main(after).statuses = main(after).statuses.filter((s) => s.key !== 'review');
    after.workItemTypes = after.workItemTypes.filter((t) => t.key !== 'roadmap_item');
    expect(removedKeys(before, after)).toEqual({ statuses: ['review'], types: ['roadmap_item'] });
  });
});

describe('validateFieldValues', () => {
  const fields: FieldDef[] = [
    { key: 'title', label: 't', type: 'text', required: true },
    { key: 'note', label: 'n', type: 'longtext', required: false },
    { key: 'count', label: 'c', type: 'number', required: false },
    { key: 'price', label: 'p', type: 'money', required: false },
    { key: 'on', label: 'd', type: 'date', required: false },
    {
      key: 'kind',
      label: 'k',
      type: 'select',
      required: false,
      options: [
        { key: 'a', label: 'a' },
        { key: 'b', label: 'b' },
      ],
    },
    {
      key: 'tags',
      label: 'g',
      type: 'multiselect',
      required: false,
      options: [
        { key: 'x', label: 'x' },
        { key: 'y', label: 'y' },
      ],
    },
    { key: 'who', label: 'w', type: 'member', required: false },
    { key: 'link', label: 'l', type: 'url', required: false },
    { key: 'flag', label: 'f', type: 'boolean', required: false },
  ];

  it('accepts a value of each type', () => {
    const result = validateFieldValues(fields, {
      title: '  مشتری  ',
      note: 'متن',
      count: 2.5,
      price: 18_000_000,
      on: '2026-10-24',
      kind: 'a',
      tags: ['x', 'y'],
      who: '0192f0c4-7c4e-7000-8000-000000000001',
      link: 'https://example.ir/a',
      flag: false,
    });
    expect(result).toEqual({
      ok: true,
      values: expect.objectContaining({
        title: 'مشتری',
        price: 18_000_000,
        tags: ['x', 'y'],
        flag: false,
      }),
    });
  });

  it.each([
    ['count', 'two'],
    ['price', -1],
    ['price', 1.5],
    ['on', '1405-08-02x'],
    ['kind', 'c'],
    ['tags', ['x', 'x']],
    ['tags', []],
    ['who', 'nobody'],
    ['link', 'javascript:alert(1)'],
    ['flag', 'yes'],
    ['title', '   '],
    ['unknown', 'v'],
  ])('refuses %s = %j', (key, value) => {
    const result = validateFieldValues(fields, { [key]: value });
    expect(result).toEqual({ ok: false, error: { code: 'invalid_field_value', field: key } });
  });

  it('needs required fields when asked, and never lets them be cleared', () => {
    expect(validateFieldValues(fields, {}, {}, true)).toEqual({
      ok: false,
      error: { code: 'required_field_missing', field: 'title' },
    });
    expect(validateFieldValues(fields, {}, {}, false).ok).toBe(true);
    expect(validateFieldValues(fields, { title: null }, { title: 'a' })).toEqual({
      ok: false,
      error: { code: 'required_field_missing', field: 'title' },
    });
  });

  it('merges into current values and clears with null', () => {
    const result = validateFieldValues(
      fields,
      { count: null, kind: 'b' },
      { count: 3, old: 'kept' },
    );
    expect(result).toEqual({ ok: true, values: { kind: 'b', old: 'kept' } });
  });

  it('reads the fields of a type from the config', () => {
    expect(fieldsOf(engineering(), 'bug').map((f) => f.key)).toEqual(['severity', 'environment']);
    expect(fieldsOf(engineering(), 'nope')).toEqual([]);
  });
});

describe('newConfigKey', () => {
  it('makes a fresh valid key', () => {
    const key = newConfigKey('s', ['s_aaaaaa']);
    expect(key).toMatch(/^s_[a-z0-9]{6}$/);
    expect(key).not.toBe('s_aaaaaa');
  });
});
