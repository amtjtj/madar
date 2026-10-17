'use client';

import { Building2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { t } from '@madar/i18n';
import { Card, Skeleton } from '@madar/ui';

import { AuthHeading } from '@/components/forms/auth-heading';
import { FormError } from '@/components/forms/form-error';
import { nextStep, useMe, useRefreshMe } from '@/hooks/use-me';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

export default function SelectTenantPage() {
  const router = useRouter();
  const { data: me, isPending } = useMe();
  const refreshMe = useRefreshMe();
  const [error, setError] = useState<string | null>(null);

  async function choose(tenantId: string) {
    setError(null);
    try {
      await api('/api/me/active-tenant', { method: 'POST', body: { tenantId } });
      const me = await refreshMe();
      router.replace(nextStep(me) ?? '/');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <AuthHeading
        title={t('auth.selectTenant.title')}
        subtitle={t('auth.selectTenant.subtitle')}
      />
      <FormError message={error} />
      <ul className="flex flex-col gap-3">
        {isPending
          ? [0, 1].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)
          : me?.memberships.map((m) => (
              <li key={m.tenantId}>
                <Card interactive>
                  <button
                    type="button"
                    onClick={() => void choose(m.tenantId)}
                    className="flex w-full items-center gap-3 p-4 text-start"
                  >
                    <span className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary-ink [&_svg]:size-5">
                      <Building2 aria-hidden />
                    </span>
                    <span className="flex flex-col">
                      <span className="font-bold text-ink">{m.tenantName}</span>
                      <span dir="ltr" className="text-start text-xs text-ink-subtle">
                        {m.tenantSlug}
                      </span>
                    </span>
                  </button>
                </Card>
              </li>
            ))}
      </ul>
    </>
  );
}
