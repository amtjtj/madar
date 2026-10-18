import { Inject, Injectable } from '@nestjs/common';
import { schema as s, type OutboxEvent, type Tx } from '@madar/db';
import { eq } from 'drizzle-orm';

import type { EventConsumer } from '../events/consumer.js';
import { PushDeliveries } from './push-deliveries.service.js';
import { PUSH_SENDER, type PushSender } from './push-sender.js';

/** Schedules a device push for each new notification whose recipient has a device subscribed. */
@Injectable()
export class PushConsumer implements EventConsumer {
  readonly name = 'push';

  constructor(
    private readonly deliveries: PushDeliveries,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  handles(type: string): boolean {
    return type === 'notification.created' && this.sender.enabled;
  }

  async handle(tx: Tx, event: OutboxEvent): Promise<void> {
    const id = event.payload.notificationId;
    if (typeof id !== 'string') return;
    const [notification] = await tx
      .select({
        recipientId: s.notifications.recipientId,
        deliverAfter: s.notifications.deliverAfter,
        pushedAt: s.notifications.pushedAt,
        readAt: s.notifications.readAt,
      })
      .from(s.notifications)
      .where(eq(s.notifications.id, id));
    if (!notification || notification.pushedAt || notification.readAt) return;
    const [device] = await tx
      .select({ id: s.pushSubscriptions.id })
      .from(s.pushSubscriptions)
      .where(eq(s.pushSubscriptions.memberId, notification.recipientId))
      .limit(1);
    if (!device) return;
    // A job enqueued for a transaction that then rolls back finds nothing to claim.
    await this.deliveries.schedule(
      event.tenantId,
      notification.recipientId,
      notification.deliverAfter,
    );
  }
}
