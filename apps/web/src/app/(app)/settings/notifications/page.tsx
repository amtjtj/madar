'use client';

import { t } from '@madar/i18n';
import { NOTIFICATION_KINDS, type NotificationKind } from '@madar/shared';
import { Card, CardContent, CheckboxField, Skeleton, useToast } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { useNotificationPreferences, useSaveNotificationPreferences } from '@/hooks/notifications';
import { errorMessage } from '@/lib/errors';

export default function NotificationSettingsPage() {
  const { data: prefs, isPending } = useNotificationPreferences();
  const save = useSaveNotificationPreferences();
  const { toast } = useToast();

  const update = (next: { mutedKinds?: NotificationKind[]; offHours?: boolean }) => {
    if (!prefs) return;
    save.mutate(
      { ...prefs, ...next },
      {
        onSuccess: () =>
          toast({ tone: 'success', title: t('notificationSettings.saved'), duration: 1500 }),
        onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
      },
    );
  };

  return (
    <>
      <PageHeader
        title={t('notificationSettings.title')}
        subtitle={t('notificationSettings.subtitle')}
      />
      {isPending || !prefs ? (
        <Skeleton className="h-80 rounded-2xl" />
      ) : (
        <div className="flex flex-col gap-6">
          <Card>
            <CardContent className="flex flex-col gap-1">
              <h2 className="mb-2 text-lg font-bold text-ink">
                {t('notificationSettings.kindsTitle')}
              </h2>
              {NOTIFICATION_KINDS.map((kind) => (
                <CheckboxField
                  key={kind}
                  label={t(`notificationSettings.kinds.${kind}`)}
                  checked={!prefs.mutedKinds.includes(kind)}
                  onChange={(e) =>
                    update({
                      mutedKinds: e.target.checked
                        ? prefs.mutedKinds.filter((k) => k !== kind)
                        : [...prefs.mutedKinds, kind],
                    })
                  }
                />
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <CheckboxField
                label={t('notificationSettings.offHours')}
                description={t('notificationSettings.offHoursHint')}
                checked={prefs.offHours}
                onChange={(e) => update({ offHours: e.target.checked })}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
