import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { schema as s } from '@madar/db';
import {
  isAllowedPushEndpoint,
  type PushConfig,
  type PushSubscriptionRequest,
} from '@madar/shared';
import { and, eq } from 'drizzle-orm';

import type { TenantContext } from '../common/context.js';
import { ApiError } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { PUSH_SENDER, type PushSender } from './push-sender.js';
import { devicesOf, recordResults, sendToDevices } from './push-store.js';

/** A member's own push subscriptions (this device), never anyone else's. */
@Injectable()
export class PushService {
  constructor(
    private readonly db: TenantDb,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  config(): PushConfig {
    return { enabled: this.sender.enabled, publicKey: this.sender.publicKey };
  }

  subscribe(ctx: TenantContext, input: PushSubscriptionRequest): Promise<void> {
    this.requireEnabled();
    if (!isAllowedPushEndpoint(input.endpoint)) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'push_endpoint_not_allowed',
        'Unknown push service',
      );
    }
    return this.db.run(ctx, async (tx) => {
      // One browser belongs to one member per company: the last one who signed in on it.
      const subscription = {
        memberId: ctx.memberId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: ctx.userAgent?.slice(0, 300) ?? null,
      };
      await tx
        .insert(s.pushSubscriptions)
        .values({ ...subscription, endpoint: input.endpoint })
        .onConflictDoUpdate({
          target: [s.pushSubscriptions.tenantId, s.pushSubscriptions.endpoint],
          set: subscription,
        });
    });
  }

  unsubscribe(ctx: TenantContext, endpoint: string): Promise<void> {
    return this.db.run(ctx, async (tx) => {
      await tx
        .delete(s.pushSubscriptions)
        .where(
          and(
            eq(s.pushSubscriptions.memberId, ctx.memberId),
            eq(s.pushSubscriptions.endpoint, endpoint),
          ),
        );
    });
  }

  /** A test push to the member's own devices; returns how many accepted it. */
  async test(ctx: TenantContext): Promise<{ sent: number }> {
    this.requireEnabled();
    const devices = await this.db.run(ctx, (tx) => devicesOf(tx, ctx.memberId));
    const results = await sendToDevices(this.sender, devices, {
      v: 1,
      kind: 'test',
      count: 1,
      subject: null,
    });
    await this.db.run(ctx, (tx) => recordResults(tx, results, new Date()));
    return { sent: results.filter((r) => r.result === 'sent').length };
  }

  private requireEnabled(): void {
    if (!this.sender.enabled) {
      throw new ApiError(HttpStatus.CONFLICT, 'push_disabled', 'Push is not configured');
    }
  }
}
