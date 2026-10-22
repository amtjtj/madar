'use client';

import { CalendarClock, ChevronLeft } from 'lucide-react';
import Link from 'next/link';

import { t } from '@madar/i18n';
import { Card } from '@madar/ui';

import { PageHeader, useOrgNavItems } from '@/components/app-shell';

/** Mobile hub for the organization screens (the tab bar has room for four tabs). */
export default function OrgPage() {
  // Meetings live in the sidebar on desktop; on phones they are reached from here and the today card.
  const items = [
    {
      key: '/meetings',
      label: t('meetings.nav'),
      href: '/meetings',
      icon: <CalendarClock aria-hidden />,
    },
    ...useOrgNavItems(),
  ];
  return (
    <>
      <PageHeader title={t('org.title')} subtitle={t('org.subtitle')} />
      <Card className="p-0">
        <ul className="flex flex-col divide-y divide-line">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="flex items-center gap-3 px-4 py-4 font-semibold text-ink hover:bg-sunken [&_svg]:size-5"
              >
                <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-primary-ink">
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                <ChevronLeft aria-hidden className="text-ink-subtle" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
