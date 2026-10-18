import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  deletePushSubscriptionRequest,
  pushSubscriptionRequest,
  type DeletePushSubscriptionRequest,
  type PushConfig,
  type PushSubscriptionRequest,
} from '@madar/shared';

import { Tenant, type TenantContext } from '../common/context.js';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PushService } from './push.service.js';

/** Device notifications: every member, for their own devices only. */
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('config')
  config(): PushConfig {
    return this.push.config();
  }

  @Post('subscriptions')
  @HttpCode(HttpStatus.NO_CONTENT)
  subscribe(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(pushSubscriptionRequest)) body: PushSubscriptionRequest,
  ): Promise<void> {
    return this.push.subscribe(ctx, body);
  }

  @Delete('subscriptions')
  @HttpCode(HttpStatus.NO_CONTENT)
  unsubscribe(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(deletePushSubscriptionRequest)) body: DeletePushSubscriptionRequest,
  ): Promise<void> {
    return this.push.unsubscribe(ctx, body.endpoint);
  }

  @Post('test')
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 3, windowMs: 60_000 })
  test(@Tenant() ctx: TenantContext): Promise<{ sent: number }> {
    return this.push.test(ctx);
  }
}
