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

  /** Counts the request only when both the person and the company are under their limit. */
  take(tenantId: string, memberId: string, now = Date.now()): void {
    const member = this.entry(`m:${tenantId}:${memberId}`, now);
    const tenant = this.entry(`t:${tenantId}`, now);
    if (member.count >= this.perMember || tenant.count >= this.perTenant) {
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'rate_limited',
        'Too many assistant requests',
      );
    }
    member.count += 1;
    tenant.count += 1;
  }

  private entry(key: string, now: number): { count: number; resetAt: number } {
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
      if (this.hits.size > 10_000) {
        for (const [k, e] of this.hits) if (e.resetAt <= now) this.hits.delete(k);
      }
    }
    return entry;
  }
}
