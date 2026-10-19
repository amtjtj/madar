'use client';

import { useParams } from 'next/navigation';

import { LetterView } from '@/components/letters/letter-view';

export default function LetterPage() {
  const { id } = useParams<{ id: string }>();
  return <LetterView id={id} />;
}
