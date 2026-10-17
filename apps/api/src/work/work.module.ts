import { Module } from '@nestjs/common';

import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { CommentsController, TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';
import { TodayController } from './today.controller.js';
import { TodayService } from './today.service.js';

@Module({
  controllers: [TasksController, CommentsController, ProjectsController, TodayController],
  providers: [TasksService, ProjectsService, TodayService],
  exports: [TasksService],
})
export class WorkModule {}
