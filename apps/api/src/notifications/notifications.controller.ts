import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  listNotificationsQuery,
  notificationPreferences,
  workCalendar,
  type ListNotificationsQuery,
  type NotificationList,
  type NotificationPreferences,
  type WorkCalendarDto,
} from '@madar/shared';

import { RequirePermission, Tenant, type TenantContext } from '../common/context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { NotificationsService } from './notifications.service.js';

/** Own notifications only: every member, no extra permission. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @Tenant() ctx: TenantContext,
    @Query(new ZodPipe(listNotificationsQuery)) query: ListNotificationsQuery,
  ): Promise<NotificationList> {
    return this.notifications.list(ctx, query);
  }

  @Get('unread-count')
  unreadCount(@Tenant() ctx: TenantContext): Promise<{ unreadCount: number }> {
    return this.notifications.unreadCount(ctx);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  readAll(@Tenant() ctx: TenantContext): Promise<void> {
    return this.notifications.markAllRead(ctx);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  read(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.notifications.markRead(ctx, id);
  }
}

@Controller('me/notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  get(@Tenant() ctx: TenantContext): Promise<NotificationPreferences> {
    return this.notifications.preferences(ctx);
  }

  @Put()
  set(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(notificationPreferences)) body: NotificationPreferences,
  ): Promise<NotificationPreferences> {
    return this.notifications.setPreferences(ctx, body);
  }
}

@Controller('work-calendar')
export class WorkCalendarController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  get(@Tenant() ctx: TenantContext): Promise<WorkCalendarDto> {
    return this.notifications.workCalendar(ctx);
  }

  @Put()
  @RequirePermission('tenant.manage')
  set(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(workCalendar)) body: WorkCalendarDto,
  ): Promise<WorkCalendarDto> {
    return this.notifications.setWorkCalendar(ctx, body);
  }
}
