'use client';

import type { ReactNode } from 'react';

import { useAiStatus } from '@/hooks/ai';

/** Renders its children only when this server has the assistant and the company turned it on. */
export function AssistantGate({ children }: { children: ReactNode }) {
  const { data } = useAiStatus();
  return data?.available && data.enabled ? <>{children}</> : null;
}
