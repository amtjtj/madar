'use client';

import { useParams } from 'next/navigation';

import { ConversationView } from '@/components/chat/conversation-view';

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  return <ConversationView key={id} id={id} />;
}
