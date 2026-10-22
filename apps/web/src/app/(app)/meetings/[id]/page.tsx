'use client';

import { useParams } from 'next/navigation';

import { MeetingView } from '@/components/meetings/meeting-view';

export default function MeetingPage() {
  const { id } = useParams<{ id: string }>();
  return <MeetingView id={id} />;
}
