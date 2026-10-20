import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Emitter } from '@socket.io/redis-emitter';
import { Redis } from 'ioredis';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { memberRoom } from './rooms.js';

/** Realtime actions the API itself triggers (most hints come from the worker). */
@Injectable()
export class RealtimePublisher implements OnApplicationShutdown {
  private readonly redis: Redis;
  private readonly emitter: Emitter;

  constructor(@Inject(ENV) env: Env) {
    this.redis = new Redis(env.REDIS_URL, { lazyConnect: true });
    this.emitter = new Emitter(this.redis);
  }

  /** Ends the live connections of a suspended member at once (their sessions are revoked too). */
  async disconnectMember(tenantId: string, memberId: string): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
    this.emitter.in(memberRoom(tenantId, memberId)).disconnectSockets(true);
  }

  /**
   * Sends to members' personal rooms. Chat messages (ADR 0022) are the only payloads with data,
   * and only to the people the caller computed may read them; everything else is a bare hint.
   */
  async toMembers(
    tenantId: string,
    memberIds: string[],
    event: string,
    payload?: unknown,
  ): Promise<void> {
    if (!memberIds.length) return;
    if (this.redis.status === 'wait') await this.redis.connect();
    const rooms = memberIds.map((m) => memberRoom(tenantId, m));
    if (payload === undefined) this.emitter.to(rooms).emit(event);
    else this.emitter.to(rooms).emit(event, payload);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status !== 'wait') await this.redis.quit().catch(() => undefined);
  }
}
