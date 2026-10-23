'use client';

import { EmptyState } from '@madar/ui';

import { errorMessage } from '@/lib/errors';

/** A range that could not load (a person outside my list, a network failure). */
export function CalendarError({ error }: { error: unknown }) {
  return <EmptyState title={errorMessage(error)} />;
}
