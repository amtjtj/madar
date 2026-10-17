import { Module } from '@nestjs/common';

import { RateLimitGuard } from '../common/rate-limit.js';
import { TenantsController } from './tenants.controller.js';
import { TenantsService } from './tenants.service.js';

@Module({
  controllers: [TenantsController],
  providers: [TenantsService, RateLimitGuard],
  exports: [TenantsService],
})
export class TenantsModule {}
