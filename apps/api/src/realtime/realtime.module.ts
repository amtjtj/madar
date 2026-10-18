import { Global, Module } from '@nestjs/common';

import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimePublisher } from './realtime.publisher.js';

@Global()
@Module({ providers: [RealtimeGateway, RealtimePublisher], exports: [RealtimePublisher] })
export class RealtimeModule {}
