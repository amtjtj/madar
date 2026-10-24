'use client';

import { useParams } from 'next/navigation';

import { RequestView } from '@/components/requests/request-view';

export default function RequestPage() {
  const { id } = useParams<{ id: string }>();
  return <RequestView id={id} />;
}
