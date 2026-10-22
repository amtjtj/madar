'use client';

import { Suspense } from 'react';

import { MeetingFormPage } from '@/components/meetings/meeting-form';

export default function NewMeetingPage() {
  return (
    <Suspense>
      <MeetingFormPage />
    </Suspense>
  );
}
