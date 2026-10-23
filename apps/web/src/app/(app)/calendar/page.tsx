'use client';

import { Suspense } from 'react';

import { CalendarPage } from '@/components/calendar/calendar-page';

export default function CalendarRoute() {
  return (
    <Suspense>
      <CalendarPage />
    </Suspense>
  );
}
