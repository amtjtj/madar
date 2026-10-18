import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/** Socket.IO with the Redis adapter, so the worker (emitter) and several API instances share rooms. */
export class RedisIoAdapter extends IoAdapter {
  private pub: Redis | undefined;
  private sub: Redis | undefined;

  constructor(
    app: INestApplicationContext,
    private readonly redisUrl: string,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    this.pub = new Redis(this.redisUrl);
    this.sub = this.pub.duplicate();
    server.adapter(createAdapter(this.pub, this.sub));
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.all([this.pub?.quit(), this.sub?.quit()].map((p) => p?.catch(() => undefined)));
  }
}
