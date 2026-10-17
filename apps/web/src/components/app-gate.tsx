'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { Skeleton } from '@madar/ui';

import { nextStep, useMe } from '@/hooks/use-me';

/** Renders the app only for a signed-in member with no pending security steps. */
export function AppGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: me, isPending, isError } = useMe();
  const step = isPending || isError ? null : nextStep(me);

  useEffect(() => {
    if (!step) return;
    router.replace(step === '/login' ? `/login?next=${encodeURIComponent(pathname)}` : step);
  }, [step, pathname, router]);

  if (isPending || step || !me) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6" aria-busy>
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    );
  }
  return <>{children}</>;
}
