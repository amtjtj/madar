import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { signupRequest, type SignupRequest, type SignupResponse } from '@madar/shared';
import type { Request } from 'express';

import { Public } from '../common/context.js';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { TenantsService } from './tenants.service.js';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  /** Company registration: creates the tenant and its owner account. */
  @Post()
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 5, windowMs: 10 * 60_000 })
  signup(
    @Req() req: Request,
    @Body(new ZodPipe(signupRequest)) body: SignupRequest,
  ): Promise<SignupResponse> {
    return this.tenants.signup(body, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
  }
}
