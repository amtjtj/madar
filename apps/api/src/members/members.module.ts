import { Module } from '@nestjs/common';

import {
  AuditLogsController,
  MembersController,
  OrgChartController,
} from './members.controller.js';
import { MembersService } from './members.service.js';

@Module({
  controllers: [MembersController, OrgChartController, AuditLogsController],
  providers: [MembersService],
})
export class MembersModule {}
