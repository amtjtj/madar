import { HttpStatus } from '@nestjs/common';

import { ApiError } from '../common/errors.js';

/**
 * Per-person and per-company limits for assistant requests (fixed one-minute windows, in memory,
 * like `RateLimitGuard`; moves to Redis when the API scales out).
 */
export class AiLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly perMember: number,
    private readonly perTenant: number,
    private readonly windowMs = 60_000,
  ) {}

  take(tenantId: string, memberId: string, now = Date.now()): void {
    const member = this.bump(`m:${tenantId}:${memberId}`, now);
    const tenant = this.bump(`t:${tenantId}`, now);
    if (member > this.perMember || tenant > this.perTenant) {
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'rate_limited',
        'Too many assistant requests',
      );
    }
  }

  private bump(key: string, now: number): number {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10_000) {
        for (const [k, e] of this.hits) if (e.resetAt <= now) this.hits.delete(k);
      }
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }
}
