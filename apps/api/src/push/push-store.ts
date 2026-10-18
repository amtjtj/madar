import { schema as s, type Tx } from '@madar/db';
import type { NotificationKind, PushPayload } from '@madar/shared';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';

import type { PushResult, PushSender, PushTarget } from './push-sender.js';

/** Dropped after this many failed deliveries in a row (a gone endpoint is dropped at once). */
const MAX_FAILURES = 5;

export interface Device extends PushTarget {
  id: string;
}

export function devicesOf(tx: Tx, memberId: string): Promise<Device[]> {
  return tx
    .select({
      id: s.pushSubscriptions.id,
      endpoint: s.pushSubscriptions.endpoint,
      p256dh: s.pushSubscriptions.p256dh,
      auth: s.pushSubscriptions.auth,
    })
    .from(s.pushSubscriptions)
    .where(eq(s.pushSubscriptions.memberId, memberId));
}

/**
 * Claims the member's unread notifications that are due for a push (quiet hours over, not pushed
 * yet) and builds one content-free payload for them. Marks them pushed in the same transaction, so
 * two jobs never push the same notification. Null when there is nothing to push or no device.
 */
export async function claimDue(
  tx: Tx,
  memberId: string,
  now: Date,
): Promise<{ payload: PushPayload; devices: Device[] } | null> {
  const [member] = await tx
    .select({ status: s.members.status, tenantStatus: s.tenants.status })
    .from(s.members)
    .innerJoin(s.tenants, eq(s.tenants.id, s.members.tenantId))
    .where(eq(s.members.id, memberId));
  if (!member || member.status !== 'active' || member.tenantStatus === 'locked') return null;

  const due = await tx
    .select({
      id: s.notifications.id,
      kind: s.notifications.kind,
      subjectType: s.notifications.subjectType,
      subjectId: s.notifications.subjectId,
    })
    .from(s.notifications)
    .where(
      and(
        eq(s.notifications.recipientId, memberId),
        isNull(s.notifications.pushedAt),
        isNull(s.notifications.readAt),
        lte(s.notifications.deliverAfter, now),
      ),
    )
    .orderBy(asc(s.notifications.createdAt))
    .for('update', { skipLocked: true });
  if (due.length === 0) return null;
  await tx
    .update(s.notifications)
    .set({ pushedAt: now })
    .where(
      inArray(
        s.notifications.id,
        due.map((n) => n.id),
      ),
    );

  const devices = await devicesOf(tx, memberId);
  const latest = due.at(-1);
  if (devices.length === 0 || !latest) return null;
  const single = due.length === 1;
  return {
    devices,
    payload: {
      v: 1,
      kind: latest.kind as NotificationKind,
      count: due.length,
      subject: single
        ? { type: latest.subjectType as 'task' | 'project', id: latest.subjectId }
        : null,
    },
  };
}

/** Sends one payload to every device (outside any transaction: push services can be slow). */
export async function sendToDevices(
  sender: PushSender,
  devices: Device[],
  payload: PushPayload,
): Promise<{ id: string; result: PushResult }[]> {
  return Promise.all(
    devices.map(async (device) => ({ id: device.id, result: await sender.send(device, payload) })),
  );
}

/** Keeps healthy subscriptions, drops gone ones and those that keep failing. */
export async function recordResults(
  tx: Tx,
  results: { id: string; result: PushResult }[],
  now: Date,
): Promise<void> {
  const ids = (result: PushResult) => results.filter((r) => r.result === result).map((r) => r.id);
  const sent = ids('sent');
  const gone = ids('gone');
  const failed = ids('failed');
  if (sent.length) {
    await tx
      .update(s.pushSubscriptions)
      .set({ lastSuccessAt: now, failureCount: 0 })
      .where(inArray(s.pushSubscriptions.id, sent));
  }
  if (failed.length) {
    await tx
      .update(s.pushSubscriptions)
      .set({ failureCount: sql`${s.pushSubscriptions.failureCount} + 1` })
      .where(inArray(s.pushSubscriptions.id, failed));
    gone.push(
      ...(
        await tx
          .select({ id: s.pushSubscriptions.id })
          .from(s.pushSubscriptions)
          .where(
            and(
              inArray(s.pushSubscriptions.id, failed),
              sql`${s.pushSubscriptions.failureCount} >= ${MAX_FAILURES}`,
            ),
          )
      ).map((r) => r.id),
    );
  }
  if (gone.length) {
    await tx.delete(s.pushSubscriptions).where(inArray(s.pushSubscriptions.id, gone));
  }
}
