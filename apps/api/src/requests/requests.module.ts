import { Module } from '@nestjs/common';

import { RequestsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';

/** Requests and approvals (plan phase-3-step-17b, ADR 0028). */
@Module({
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
