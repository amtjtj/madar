import { Controller, Get, Header } from '@nestjs/common';
import type { HealthResponse } from '@madar/shared';

import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  check(): Promise<HealthResponse> {
    return this.health.check();
  }
}
