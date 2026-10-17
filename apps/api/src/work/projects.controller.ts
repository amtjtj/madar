import {
  Body,
  Controller,
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
  createProjectRequest,
  setProjectMembersRequest,
  updateProjectRequest,
  type CreateProjectRequest,
  type Project,
  type SetProjectMembersRequest,
  type UpdateProjectRequest,
} from '@madar/shared';

import { Tenant, type TenantContext } from '../common/context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ProjectsService } from './projects.service.js';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(
    @Tenant() ctx: TenantContext,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<Project[]> {
    return this.projects.list(ctx, includeArchived === 'true');
  }

  @Post()
  create(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(createProjectRequest)) body: CreateProjectRequest,
  ): Promise<Project> {
    return this.projects.create(ctx, body);
  }

  @Get(':id')
  get(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<Project> {
    return this.projects.get(ctx, id);
  }

  @Patch(':id')
  update(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateProjectRequest)) body: UpdateProjectRequest,
  ): Promise<Project> {
    return this.projects.update(ctx, id, body);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.projects.archive(ctx, id);
  }

  @Put(':id/members')
  setMembers(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(setProjectMembersRequest)) body: SetProjectMembersRequest,
  ): Promise<Project> {
    return this.projects.setMembers(ctx, id, body);
  }
}
