'use client';

import { t } from '@madar/i18n';
import {
  formatCalendarDate,
  formatNumber,
  toLatinDigits,
  type FieldDef,
  type FieldValue as Value,
  type StatusColor,
  type TypeIcon as TypeIconKey,
} from '@madar/shared';
import {
  BookOpen,
  Bug,
  CircleCheckBig,
  FileText,
  Gavel,
  Lightbulb,
  LifeBuoy,
  Map as MapIcon,
  Megaphone,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';

import { cn } from '../lib/cn.js';
import { CheckboxField } from './checkbox.js';
import { DatePicker } from './date-picker.js';
import { TextAreaField, TextField } from './input.js';
import { AmountText } from './request.js';
import { SelectField } from './select.js';
import { statusColorDot, statusColorTone } from './task-meta.js';

/**
 * Department configs on screen (plan phase-3-step-19a): a status chip in the company's own
 * colour, the work type's icon, and one input/value pair per custom field type.
 */

export interface StatusChipProps {
  label: string;
  color: StatusColor;
  className?: string;
}

/** A department status as a pill with a coloured dot. */
export function StatusChip({ label, color, className }: StatusChipProps) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold',
        statusColorTone[color],
        className,
      )}
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', statusColorDot[color])} />
      {label}
    </span>
  );
}

/** Just the dot, for colour pickers and board column headers. */
export function StatusDot({ color, className }: { color: StatusColor; className?: string }) {
  return (
    <span aria-hidden className={cn('size-2.5 rounded-full', statusColorDot[color], className)} />
  );
}

const TYPE_ICONS: Record<TypeIconKey, LucideIcon> = {
  task: CircleCheckBig,
  ticket: LifeBuoy,
  bug: Bug,
  story: BookOpen,
  content: Megaphone,
  decision: Gavel,
  roadmap: MapIcon,
  hire: UserPlus,
  document: FileText,
  idea: Lightbulb,
};

export interface TypeIconProps {
  icon: TypeIconKey;
  /** Accessible name; without it the icon is decorative. */
  label?: string;
  className?: string;
}

export function TypeIcon({ icon, label, className }: TypeIconProps) {
  const Icon = TYPE_ICONS[icon];
  return (
    <Icon
      className={cn('size-4 shrink-0', className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  );
}

export interface MemberOption {
  id: string;
  displayName: string;
}

export interface FieldValueProps {
  field: FieldDef;
  value: Value | undefined;
  /** Names for member fields. */
  members?: readonly MemberOption[];
  className?: string;
}

/** A custom field's value, read-only. */
export function FieldValue({ field, value, members, className }: FieldValueProps) {
  if (value === undefined || value === '') {
    return <span className={cn('text-ink-subtle', className)}>{t('ui.fields.empty')}</span>;
  }
  const option = (key: string) => field.options?.find((o) => o.key === key)?.label ?? key;
  switch (field.type) {
    case 'number':
      return <span className={cn('tabular-nums', className)}>{formatNumber(Number(value))}</span>;
    case 'money':
      return <AmountText toman={Number(value)} className={className} />;
    case 'date':
      return <span className={className}>{formatCalendarDate(String(value))}</span>;
    case 'select':
      return <span className={className}>{option(String(value))}</span>;
    case 'multiselect':
      return (
        <span className={cn('flex flex-wrap gap-1', className)}>
          {(Array.isArray(value) ? value : []).map((key) => (
            <span key={key} className="rounded-full bg-sunken px-2 py-0.5 text-xs text-ink-muted">
              {option(key)}
            </span>
          ))}
        </span>
      );
    case 'member':
      return (
        <span className={className}>
          {members?.find((m) => m.id === value)?.displayName ?? t('ui.fields.unknownMember')}
        </span>
      );
    case 'url':
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noopener noreferrer"
          dir="ltr"
          className={cn('break-all text-primary-ink underline underline-offset-2', className)}
        >
          {String(value)}
        </a>
      );
    case 'boolean':
      return <span className={className}>{t(value ? 'ui.fields.yes' : 'ui.fields.no')}</span>;
    case 'longtext':
      return <span className={cn('whitespace-pre-line', className)}>{String(value)}</span>;
    default:
      return <span className={className}>{String(value)}</span>;
  }
}

export interface FieldInputProps {
  field: FieldDef;
  value: Value | undefined;
  /** `null` clears the field. */
  onChange: (value: Value | null) => void;
  /** Today in the tenant time zone (date fields). */
  today: string;
  members?: readonly MemberOption[];
  error?: string;
  className?: string;
}

/** The input for one custom field, labelled with the field's own label. */
export function FieldInput({
  field,
  value,
  onChange,
  today,
  members = [],
  error,
  className,
}: FieldInputProps) {
  const [draft, setDraft] = useState(() =>
    typeof value === 'number' ? formatNumber(value) : typeof value === 'string' ? value : '',
  );
  const label = field.label;
  const text = (next: string) => {
    setDraft(next);
    onChange(next.trim() ? next : null);
  };

  switch (field.type) {
    case 'text':
      return (
        <TextField
          label={label}
          value={draft}
          onChange={(e) => text(e.target.value)}
          maxLength={500}
          required={field.required}
          error={error}
          className={className}
        />
      );
    case 'longtext':
      return (
        <TextAreaField
          label={label}
          value={draft}
          onChange={(e) => text(e.target.value)}
          maxLength={5000}
          rows={3}
          required={field.required}
          error={error}
          className={className}
        />
      );
    case 'url':
      return (
        <TextField
          label={label}
          type="url"
          dir="ltr"
          inputMode="url"
          placeholder="https://"
          value={draft}
          onChange={(e) => text(e.target.value)}
          maxLength={500}
          required={field.required}
          error={error}
          className={className}
        />
      );
    case 'number':
    case 'money': {
      const parse = (raw: string) => {
        const latin = toLatinDigits(raw)
          .replace(/[٬,\s]/g, '')
          .replace('٫', '.');
        if (!latin) return null;
        const n = field.type === 'money' ? Number(latin.replace(/\D/g, '')) : Number(latin);
        return Number.isFinite(n) ? n : null;
      };
      return (
        <TextField
          label={label}
          inputMode={field.type === 'money' ? 'numeric' : 'decimal'}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            onChange(parse(e.target.value));
          }}
          onBlur={() => {
            const n = parse(draft);
            if (n !== null) setDraft(formatNumber(n));
          }}
          hint={field.type === 'money' ? t('ui.fields.toman') : undefined}
          required={field.required}
          error={error}
          className={className}
        />
      );
    }
    case 'date':
      return (
        <DatePicker
          label={label}
          value={typeof value === 'string' ? value : null}
          onChange={(next) => onChange(next)}
          today={today}
          className={className}
        />
      );
    case 'select':
    case 'member': {
      const options =
        field.type === 'select'
          ? (field.options ?? []).map((o) => ({ value: o.key, label: o.label }))
          : members.map((m) => ({ value: m.id, label: m.displayName }));
      return (
        <SelectField
          label={label}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || null)}
          options={[{ value: '', label: t('ui.fields.choose') }, ...options]}
          required={field.required}
          error={error}
          className={className}
        />
      );
    }
    case 'multiselect': {
      const chosen = Array.isArray(value) ? value : [];
      return (
        <fieldset className={cn('flex flex-col gap-1.5', className)}>
          <legend className="mb-1.5 text-sm font-medium text-ink">
            {label}
            {field.required && (
              <span className="ms-1 text-danger" aria-label={t('ui.required')}>
                *
              </span>
            )}
          </legend>
          <div className="flex flex-wrap gap-2">
            {(field.options ?? []).map((o) => {
              const on = chosen.includes(o.key);
              return (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const next = on ? chosen.filter((k) => k !== o.key) : [...chosen, o.key];
                    onChange(next.length ? next : null);
                  }}
                  className={cn(
                    'min-h-9 rounded-full border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    on
                      ? 'border-primary bg-primary-soft text-primary-ink'
                      : 'border-line bg-surface text-ink-muted hover:border-line-strong',
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {error ? <p className="text-xs text-danger-ink">{error}</p> : null}
        </fieldset>
      );
    }
    case 'boolean':
      return (
        <CheckboxField
          label={label}
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className={className}
        />
      );
  }
}
