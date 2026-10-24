'use client';

import { useEffect, useRef, useState } from 'react';

import { t } from '@madar/i18n';
import { formatNumber } from '@madar/shared';
import {
  Button,
  Card,
  CardContent,
  LevelBar,
  LevelUpMark,
  Modal,
  StreakFlame,
  useToast,
} from '@madar/ui';

import { NextLink } from '@/components/next-link';
import { useMyProgress } from '@/hooks/progress';
import { celebrateLevel, dayHint } from '@/lib/progress';

/**
 * «پیشرفت من» on the home page (ADR 0029): my streak, my level and what is left for a complete
 * day. Only mine; nothing here compares me with anyone. Hidden while the company has it off.
 */
export function ProgressCard() {
  const { data: progress } = useMyProgress();
  const [level, setLevel] = useState<number | null>(null);
  // Checked once per level seen (a state update during render, not an effect).
  const [checked, setChecked] = useState<number | null>(null);
  if (progress?.enabled && progress.level !== checked) {
    setChecked(progress.level);
    if (celebrateLevel(progress.level)) setLevel(progress.level);
  }
  // A short cheer when today becomes complete while I watch (not on every visit).
  const { toast } = useToast();
  const wasComplete = useRef<boolean | null>(null);
  const complete = progress?.enabled ? progress.today.complete : null;
  useEffect(() => {
    if (complete && wasComplete.current === false) {
      toast({ tone: 'success', title: t('progress.dayComplete') });
    }
    wasComplete.current = complete;
  }, [complete, toast]);
  if (!progress?.enabled) return null;
  const { today } = progress;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex items-center justify-between gap-3">
          <NextLink
            href="/progress"
            className="font-bold text-ink hover:underline"
            aria-label={t('progress.cardLink')}
          >
            {t('progress.cardTitle')}
          </NextLink>
          <StreakFlame count={progress.currentStreak} lit={today.complete} />
        </div>
        <p className="text-sm text-ink-muted">{dayHint(progress)}</p>
        <LevelBar level={progress.level} into={progress.levelInto} span={progress.levelSpan} />
      </CardContent>
      <LevelUp level={level} onClose={() => setLevel(null)} />
    </Card>
  );
}

function LevelUp({ level, onClose }: { level: number | null; onClose: () => void }) {
  return (
    <Modal
      open={level !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('progress.levelUp.title', { level: formatNumber(level ?? 0) })}
      description={t('progress.levelUp.description')}
      footer={<Button onClick={onClose}>{t('progress.levelUp.ok')}</Button>}
    >
      <LevelUpMark />
    </Modal>
  );
}
