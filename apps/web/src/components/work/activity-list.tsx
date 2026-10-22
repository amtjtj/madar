'use client';

import { t, type MessageKey } from '@madar/i18n';
import { formatPercent, formatRelativeTime, toPersianDigits, type Activity } from '@madar/shared';

import { useActivity } from '@/hooks/work';

const KNOWN_VERBS = [
  'created',
  'updated',
  'status_changed',
  'collaborators_changed',
  'deleted',
  'progress',
  'attachments_added',
  'attachment_removed',
  'evidence_pinned',
  'evidence_unpinned',
  'message_pinned',
  'message_unpinned',
];
// Fields with a `task.fields.*` name; an unknown field is skipped instead of breaking the page.
const KNOWN_FIELDS = [
  'title',
  'description',
  'projectId',
  'assigneeId',
  'dueOn',
  'priority',
  'weight',
  'status',
  'keyResultId',
  'progressMode',
];
const statusName = (key: unknown) =>
  typeof key === 'string' ? t(`work.status.${key}` as MessageKey) : '';

function describe(entry: Activity): string {
  const actor = entry.actor?.displayName ?? t('task.someone');
  if (!KNOWN_VERBS.includes(entry.verb)) return actor;
  if (entry.verb === 'status_changed') {
    const status = entry.changes?.status;
    return t('task.verbs.status_changed', {
      actor,
      from: statusName(status?.from),
      to: statusName(status?.to),
    });
  }
  if (entry.verb === 'progress') {
    const to = entry.changes?.progress?.to;
    return t('task.verbs.progress', {
      actor,
      value: typeof to === 'number' ? formatPercent(to / 100) : '',
    });
  }
  if (entry.verb === 'attachments_added' || entry.verb === 'attachment_removed') {
    const files = entry.changes?.files;
    const names = (entry.verb === 'attachments_added' ? files?.to : files?.from) as unknown;
    return t(`task.verbs.${entry.verb}`, {
      actor,
      files: Array.isArray(names)
        ? names.map((n) => `«${String(n)}»`).join(t('ui.listSeparator'))
        : '',
    });
  }
  if (entry.verb === 'evidence_pinned' || entry.verb === 'evidence_unpinned') {
    const change = entry.changes?.evidence;
    const number = entry.verb === 'evidence_pinned' ? change?.to : change?.from;
    return t(`task.verbs.${entry.verb}`, {
      actor,
      number: typeof number === 'string' ? toPersianDigits(number) : '',
    });
  }
  return t(`task.verbs.${entry.verb}` as MessageKey, { actor });
}

/** The note someone wrote with their progress («با واحد حقوقی تماس گرفتم»). */
function progressNote(entry: Activity): string | null {
  const note = entry.verb === 'progress' ? entry.changes?.note?.to : null;
  return typeof note === 'string' && note ? note : null;
}

function changedFields(entry: Activity): string | null {
  if (entry.verb !== 'updated' || !entry.changes) return null;
  const names = Object.keys(entry.changes)
    .filter((field) => KNOWN_FIELDS.includes(field))
    .map((field) => t(`task.fields.${field}` as MessageKey));
  return names.length ? t('task.changedFields', { fields: names.join('، ') }) : null;
}

/** The task's history: who changed what, newest first. */
export function ActivityList({ taskId }: { taskId: string }) {
  const { data: activity } = useActivity(taskId);
  if (!activity?.length) return null;
  return (
    <section aria-labelledby="activity-title" className="flex flex-col gap-3">
      <h2 id="activity-title" className="text-lg font-bold text-ink">
        {t('task.activity')}
      </h2>
      <ol className="flex flex-col gap-3 border-s-2 border-line ps-4">
        {activity.map((entry) => {
          const fields = changedFields(entry);
          const note = progressNote(entry);
          return (
            <li key={entry.id} className="relative flex flex-col gap-0.5 text-sm">
              <span
                aria-hidden
                className="absolute -start-[1.4rem] top-1.5 size-2.5 rounded-full border-2 border-surface bg-line-strong"
              />
              <span className="text-ink">{describe(entry)}</span>
              {fields && <span className="text-ink-muted">{fields}</span>}
              {note && <q className="text-ink-muted">{note}</q>}
              <time dateTime={entry.createdAt} className="text-xs text-ink-subtle">
                {formatRelativeTime(new Date(entry.createdAt))}
              </time>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
