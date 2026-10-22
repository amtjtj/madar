'use client';

import { useParams, useSearchParams } from 'next/navigation';

import { ConversationView } from '@/components/chat/conversation-view';

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  // `?m=` opens the conversation around one message (a search result).
  const focus = useSearchParams().get('m');
  return <ConversationView key={id} id={id} focusId={focus} />;
}
