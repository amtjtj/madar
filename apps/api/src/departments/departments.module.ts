import { Module } from '@nestjs/common';

import { DepartmentsController } from './departments.controller.js';
import { DepartmentsService } from './departments.service.js';
import { ModuleConfigController } from './module-config.controller.js';
import { ModuleConfigService } from './module-config.service.js';

@Module({
  controllers: [DepartmentsController, ModuleConfigController],
  providers: [DepartmentsService, ModuleConfigService],
})
export class DepartmentsModule {}
