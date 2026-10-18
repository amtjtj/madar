'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  BellRing,
  Building2,
  ChartNetwork,
  Clock,
  FolderKanban,
  House,
  ListTodo,
  LogOut,
  Network,
  ScrollText,
  Users,
  WifiOff,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { t } from '@madar/i18n';
import {
  Avatar,
  BottomNav,
  Menu,
  OrbitIllustration,
  Sidebar,
  ThemeToggle,
  type LinkComponent,
  type NavItem,
} from '@madar/ui';

import {
  NotificationLink,
  NotificationPopover,
} from '@/components/notifications/notification-bell';
import { useCan } from '@/hooks/queries';
import { useRealtime } from '@/hooks/realtime';
import { useMe } from '@/hooks/use-me';
import { auth } from '@/lib/auth';

const NextLink: LinkComponent = ({ href, children, ...props }) => (
  <Link href={href} {...props}>
    {children}
  </Link>
);

function roleLabel(roles: string[]): string {
  const order = ['owner', 'admin', 'executive', 'hr_manager', 'member'] as const;
  const top = order.find((r) => roles.includes(r)) ?? 'member';
  return t(`roles.${top}`);
}

/** The organization screens the member may open (sidebar section and the /org hub). */
export function useOrgNavItems(): NavItem[] {
  const can = useCan();
  return [
    ...(can('member.read')
      ? [
          {
            key: '/members',
            label: t('shell.members'),
            href: '/members',
            icon: <Users aria-hidden />,
          },
        ]
      : []),
    ...(can('department.read')
      ? [
          {
            key: '/departments',
            label: t('shell.departments'),
            href: '/departments',
            icon: <Building2 aria-hidden />,
          },
        ]
      : []),
    ...(can('org_chart.read')
      ? [
          {
            key: '/org-chart',
            label: t('shell.orgChart'),
            href: '/org-chart',
            icon: <ChartNetwork aria-hidden />,
          },
        ]
      : []),
    ...(can('audit.read')
      ? [
          {
            key: '/audit',
            label: t('shell.audit'),
            href: '/audit',
            icon: <ScrollText aria-hidden />,
          },
        ]
      : []),
    ...(can('tenant.manage')
      ? [
          {
            key: '/org/work-calendar',
            label: t('workCalendar.short'),
            href: '/org/work-calendar',
            icon: <Clock aria-hidden />,
          },
        ]
      : []),
  ];
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();

  const workItems: NavItem[] = [
    { key: '/', label: t('nav.today'), href: '/', icon: <House aria-hidden /> },
    { key: '/tasks', label: t('shell.tasks'), href: '/tasks', icon: <ListTodo aria-hidden /> },
    {
      key: '/projects',
      label: t('shell.projects'),
      href: '/projects',
      icon: <FolderKanban aria-hidden />,
    },
  ];
  const orgItems = useOrgNavItems();
  const items = [...workItems, ...orgItems];
  // The mobile tab bar has room for four: the organization screens share one «سازمان» hub.
  const bottomItems: NavItem[] = [
    ...workItems,
    ...(orgItems.length
      ? [{ key: '/org', label: t('shell.org'), href: '/org', icon: <Network aria-hidden /> }]
      : []),
  ];
  const activeKey =
    items
      .map((i) => i.key)
      .filter((key) => (key === '/' ? pathname === '/' : pathname.startsWith(key)))
      .sort((a, b) => b.length - a.length)[0] ?? '/';
  const bottomActiveKey =
    pathname === '/org' || orgItems.some((i) => i.key === activeKey) ? '/org' : activeKey;

  async function signOut() {
    await auth.signOut().catch(() => undefined);
    queryClient.clear();
    router.replace('/login');
  }

  const name = me?.member?.displayName ?? me?.user.name ?? '';
  const online = useRealtime(Boolean(me?.member));
  const offline = !online && (
    <span
      role="status"
      title={t('notifications.offline')}
      className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning-ink"
    >
      <WifiOff aria-hidden className="size-3.5" />
      <span className="sr-only md:not-sr-only">{t('notifications.offline')}</span>
    </span>
  );
  const brand = (
    <div className="flex items-center gap-2">
      <OrbitIllustration className="h-9" />
      <div className="flex flex-col leading-tight">
        <span className="text-lg font-black text-ink">{t('app.name')}</span>
        <span className="text-xs text-ink-subtle">{me?.tenant?.name}</span>
      </div>
    </div>
  );

  const userMenu = (
    <Menu
      label={t('shell.account')}
      trigger={
        <button
          type="button"
          className="flex items-center gap-3 rounded-lg p-1 text-start hover:bg-sunken"
          aria-label={t('shell.account')}
        >
          <Avatar name={name} size="sm" />
          <span className="hidden flex-col md:flex">
            <span className="text-sm font-bold text-ink">{name}</span>
            <span className="text-xs text-ink-muted">{roleLabel(me?.member?.roles ?? [])}</span>
          </span>
        </button>
      }
      items={[
        {
          key: 'notification-settings',
          label: t('notifications.settings'),
          icon: <BellRing aria-hidden />,
          onSelect: () => router.push('/settings/notifications'),
        },
        {
          key: 'sign-out',
          label: t('auth.signOut'),
          icon: <LogOut aria-hidden />,
          tone: 'danger',
          onSelect: () => void signOut(),
        },
      ]}
    />
  );

  return (
    <div className="flex min-h-dvh">
      <Sidebar
        items={items}
        activeKey={activeKey}
        link={NextLink}
        brand={
          <div className="flex items-center justify-between gap-2">
            {brand}
            <NotificationPopover />
          </div>
        }
        footer={
          <div className="flex flex-col gap-3">
            {offline}
            {userMenu}
            <ThemeToggle className="self-start" />
          </div>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-canvas/90 px-4 py-2 backdrop-blur md:hidden">
          {brand}
          <div className="flex items-center gap-1">
            {offline}
            <NotificationLink />
            {userMenu}
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-28 md:px-8 md:pt-10 md:pb-12">
          {children}
        </main>
      </div>
      <BottomNav items={bottomItems} activeKey={bottomActiveKey} link={NextLink} />
    </div>
  );
}

/** Page header used by every app screen. */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-black text-ink md:text-3xl">{title}</h1>
        {subtitle && <p className="text-ink-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
