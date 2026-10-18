'use client';

import { Download, Share, SquarePlus, Smartphone, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { t } from '@madar/i18n';
import { Button, Card, CardContent } from '@madar/ui';

import { useInstall } from '@/hooks/pwa';
import { INSTALL_CARD_DISMISSED_KEY } from '@/lib/pwa';

function IosSteps() {
  const steps = [
    { icon: <Share aria-hidden />, text: t('pwa.install.iosStep1') },
    { icon: <SquarePlus aria-hidden />, text: t('pwa.install.iosStep2') },
    { icon: <Smartphone aria-hidden />, text: t('pwa.install.iosStep3') },
  ];
  return (
    <ol className="flex flex-col gap-3" aria-label={t('pwa.install.iosTitle')}>
      {steps.map((step, i) => (
        <li key={i} className="flex items-start gap-3 text-sm text-ink">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-ink [&_svg]:size-4">
            {step.icon}
          </span>
          <span className="pt-1.5">{step.text}</span>
        </li>
      ))}
    </ol>
  );
}

/** Install guidance in the notification settings: a button on Android, steps on iPhone. */
export function InstallSection() {
  const { ready, installed, canPrompt, iosManual, install } = useInstall();
  if (!ready || (!installed && !canPrompt && !iosManual)) return null;
  return (
    <Card id="install">
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-bold text-ink">{t('pwa.install.title')}</h2>
          <p className="text-sm text-ink-muted">
            {installed ? t('pwa.install.installed') : t('pwa.install.description')}
          </p>
        </div>
        {canPrompt && (
          <Button
            className="self-start"
            icon={<Download aria-hidden />}
            onClick={() => void install()}
          >
            {t('pwa.install.action')}
          </Button>
        )}
        {iosManual && <IosSteps />}
      </CardContent>
    </Card>
  );
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_CARD_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** One-time, dismissible install suggestion on the Today screen (phones only). */
export function InstallCard() {
  const { ready, canPrompt, iosManual, install } = useInstall();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    // localStorage exists only in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(readDismissed());
  }, []);
  if (!ready || dismissed || (!canPrompt && !iosManual)) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(INSTALL_CARD_DISMISSED_KEY, '1');
    } catch {
      // Private mode: the card simply comes back next time.
    }
  };

  return (
    <Card className="md:hidden">
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-ink [&_svg]:size-5">
            <Smartphone aria-hidden />
          </span>
          <div className="flex flex-1 flex-col gap-1">
            <h2 className="font-bold text-ink">{t('pwa.install.title')}</h2>
            <p className="text-sm text-ink-muted">{t('pwa.install.description')}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="-me-2 -mt-2 shrink-0"
            aria-label={t('ui.close')}
            onClick={dismiss}
          >
            <X aria-hidden />
          </Button>
        </div>
        {iosManual && <IosSteps />}
        <div className="flex flex-wrap gap-2">
          {canPrompt && (
            <Button
              icon={<Download aria-hidden />}
              onClick={() => void install().then((accepted) => accepted && dismiss())}
            >
              {t('pwa.install.action')}
            </Button>
          )}
          <Button variant="ghost" onClick={dismiss}>
            {t('pwa.install.dismiss')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
