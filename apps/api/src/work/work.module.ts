import { Module } from '@nestjs/common';

import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { CommentsController, TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  controllers: [TasksController, CommentsController, ProjectsController],
  providers: [TasksService, ProjectsService],
  exports: [TasksService],
})
export class WorkModule {}
