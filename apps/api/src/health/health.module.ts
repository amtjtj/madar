import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';
import { healthRedisProvider } from './health.redis.js';
import { HealthService } from './health.service.js';

@Module({
  controllers: [HealthController],
  providers: [HealthService, healthRedisProvider],
})
export class HealthModule {}
