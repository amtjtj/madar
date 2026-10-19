import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  commentBody,
  createTaskRequest,
  listTasksQuery,
  moveTaskRequest,
  setCollaboratorsRequest,
  setTaskProgressRequest,
  updateTaskRequest,
  type Activity,
  type Comment,
  type CommentBody,
  type CreateTaskRequest,
  type ListTasksQuery,
  type MoveTaskRequest,
  type SetCollaboratorsRequest,
  type Task,
  type SetTaskProgressRequest,
  type UpdateTaskRequest,
} from '@madar/shared';

import { Tenant, type TenantContext } from '../common/context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { TasksService } from './tasks.service.js';

/** Access is per task (involvement, department, project); see work/access.ts. */
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(
    @Tenant() ctx: TenantContext,
    @Query(new ZodPipe(listTasksQuery)) query: ListTasksQuery,
  ): Promise<Task[]> {
    return this.tasks.list(ctx, query);
  }

  @Post()
  create(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(createTaskRequest)) body: CreateTaskRequest,
  ): Promise<Task> {
    return this.tasks.create(ctx, body);
  }

  @Get(':id')
  get(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<Task> {
    return this.tasks.get(ctx, id);
  }

  @Patch(':id')
  update(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateTaskRequest)) body: UpdateTaskRequest,
  ): Promise<Task> {
    return this.tasks.update(ctx, id, body);
  }

  @Post(':id/progress')
  @HttpCode(HttpStatus.OK)
  setProgress(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(setTaskProgressRequest)) body: SetTaskProgressRequest,
  ): Promise<Task> {
    return this.tasks.setProgress(ctx, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.tasks.remove(ctx, id);
  }

  @Post(':id/move')
  move(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(moveTaskRequest)) body: MoveTaskRequest,
  ): Promise<Task> {
    return this.tasks.move(ctx, id, body);
  }

  @Put(':id/collaborators')
  setCollaborators(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(setCollaboratorsRequest)) body: SetCollaboratorsRequest,
  ): Promise<Task> {
    return this.tasks.setCollaborators(ctx, id, body);
  }

  @Get(':id/comments')
  comments(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Comment[]> {
    return this.tasks.listComments(ctx, id);
  }

  @Post(':id/comments')
  addComment(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(commentBody)) body: CommentBody,
  ): Promise<Comment> {
    return this.tasks.addComment(ctx, id, body);
  }

  @Get(':id/activity')
  activity(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Activity[]> {
    return this.tasks.activity(ctx, id);
  }
}

@Controller('comments')
export class CommentsController {
  constructor(private readonly tasks: TasksService) {}

  @Patch(':id')
  update(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(commentBody)) body: CommentBody,
  ): Promise<Comment> {
    return this.tasks.updateComment(ctx, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.tasks.updateComment(ctx, id, null);
  }
}
