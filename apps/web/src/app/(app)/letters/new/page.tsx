'use client';

import { Suspense } from 'react';

import { Compose } from '@/components/letters/compose';

export default function NewLetterPage() {
  return (
    <Suspense>
      <Compose />
    </Suspense>
  );
}
