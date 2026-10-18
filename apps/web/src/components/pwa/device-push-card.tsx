'use client';

import { BellOff, BellRing, Send } from 'lucide-react';

import { t } from '@madar/i18n';
import { Badge, Button, Card, CardContent, Skeleton, useToast } from '@madar/ui';

import { useDevicePush, type DevicePushStatus } from '@/hooks/pwa';
import { useMe } from '@/hooks/use-me';
import { ApiClientError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

const HINT: Partial<Record<DevicePushStatus, string>> = {
  denied: t('pwa.push.denied'),
  unsupported: t('pwa.push.unsupported'),
  'ios-install': t('pwa.push.iosInstallFirst'),
};

/** «Notifications on this device»: Web Push for the browser in hand. Hidden when push is off. */
export function DevicePushCard() {
  const { data: me } = useMe();
  const owner = me?.member && me.tenant ? `${me.tenant.id}:${me.member.id}` : null;
  const { status, enable, disable, test } = useDevicePush(owner);
  const { toast } = useToast();

  if (status === 'disabled') return null;
  const hint = HINT[status];

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-bold text-ink">{t('pwa.push.title')}</h2>
            <p className="text-sm text-ink-muted">{t('pwa.push.description')}</p>
          </div>
          {status === 'on' && (
            <Badge tone="success" dot>
              {t('pwa.push.on')}
            </Badge>
          )}
        </div>
        {status === 'loading' ? (
          <Skeleton className="h-11 w-44 rounded-lg" />
        ) : hint ? (
          <p role="status" className="rounded-lg bg-sunken px-3 py-2 text-sm text-ink-muted">
            {hint}
          </p>
        ) : status === 'on' ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={<Send aria-hidden />}
              loading={test.isPending}
              onClick={() =>
                test.mutate(undefined, {
                  onSuccess: () => toast({ tone: 'success', title: t('pwa.push.testSent') }),
                  onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
                })
              }
            >
              {t('pwa.push.test')}
            </Button>
            <Button
              variant="ghost"
              icon={<BellOff aria-hidden />}
              loading={disable.isPending}
              onClick={() =>
                disable.mutate(undefined, {
                  onSuccess: () => toast({ tone: 'success', title: t('pwa.push.turnedOff') }),
                })
              }
            >
              {t('pwa.push.disable')}
            </Button>
          </div>
        ) : (
          <Button
            className="self-start"
            icon={<BellRing aria-hidden />}
            loading={enable.isPending}
            onClick={() =>
              enable.mutate(undefined, {
                onSuccess: (on) => {
                  if (on) toast({ tone: 'success', title: t('pwa.push.turnedOn') });
                },
                onError: (error) =>
                  toast({
                    tone: 'error',
                    title:
                      error instanceof ApiClientError ? errorMessage(error) : t('pwa.push.failed'),
                  }),
              })
            }
          >
            {t('pwa.push.enable')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
