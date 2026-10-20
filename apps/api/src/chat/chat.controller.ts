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
  addMembersRequest,
  createGroupRequest,
  directConversationRequest,
  editMessageRequest,
  listMessagesQuery,
  markReadRequest,
  muteRequest,
  renameGroupRequest,
  sendMessageRequest,
  type Conversation,
  type ConversationSummary,
  type CreateGroupRequest,
  type EditMessageRequest,
  type ListMessagesQuery,
  type Message,
  type MessagePage,
  type SendMessageRequest,
} from '@madar/shared';

import { Tenant, type TenantContext } from '../common/context.js';
import { RateLimit } from '../common/rate-limit.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ChatService } from './chat.service.js';

/** Internal chat (ADR 0022). Access is per conversation; see chat/access.ts. */
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  list(@Tenant() ctx: TenantContext): Promise<ConversationSummary[]> {
    return this.chat.list(ctx);
  }

  @Get('unread-count')
  async unreadCount(@Tenant() ctx: TenantContext): Promise<{ count: number }> {
    return { count: await this.chat.unreadCount(ctx) };
  }

  @Get('by-project/:projectId')
  byProject(
    @Tenant() ctx: TenantContext,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ConversationSummary> {
    return this.chat.forSource(ctx, 'project', projectId);
  }

  @Get('by-department/:departmentId')
  byDepartment(
    @Tenant() ctx: TenantContext,
    @Param('departmentId', ParseUUIDPipe) departmentId: string,
  ): Promise<ConversationSummary> {
    return this.chat.forSource(ctx, 'department', departmentId);
  }

  @Post('direct')
  @HttpCode(HttpStatus.OK)
  direct(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(directConversationRequest)) body: { memberId: string },
  ): Promise<Conversation> {
    return this.chat.direct(ctx, body.memberId);
  }

  @Post('group')
  createGroup(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(createGroupRequest)) body: CreateGroupRequest,
  ): Promise<Conversation> {
    return this.chat.createGroup(ctx, body);
  }

  @Get(':id')
  get(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<Conversation> {
    return this.chat.get(ctx, id);
  }

  @Patch(':id')
  rename(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(renameGroupRequest)) body: { title: string },
  ): Promise<Conversation> {
    return this.chat.rename(ctx, id, body.title);
  }

  @Post(':id/members')
  @HttpCode(HttpStatus.OK)
  addMembers(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(addMembersRequest)) body: { memberIds: string[] },
  ): Promise<Conversation> {
    return this.chat.addMembers(ctx, id, body.memberIds);
  }

  @Delete(':id/members/:memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ): Promise<void> {
    return this.chat.removeMember(ctx, id, memberId);
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.chat.leave(ctx, id);
  }

  @Put(':id/mute')
  @HttpCode(HttpStatus.NO_CONTENT)
  mute(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(muteRequest)) body: { muted: boolean },
  ): Promise<void> {
    return this.chat.setMuted(ctx, id, body.muted);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  read(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(markReadRequest)) body: { messageId: string },
  ): Promise<void> {
    return this.chat.markRead(ctx, id, body.messageId);
  }

  @Get(':id/messages')
  messages(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(listMessagesQuery)) query: ListMessagesQuery,
  ): Promise<MessagePage> {
    return this.chat.messages(ctx, id, query);
  }

  @Post(':id/messages')
  @RateLimit({ max: 30, windowMs: 60_000 })
  send(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(sendMessageRequest)) body: SendMessageRequest,
  ): Promise<Message> {
    return this.chat.send(ctx, id, body);
  }
}

@Controller('messages')
export class MessagesController {
  constructor(private readonly chat: ChatService) {}

  @Patch(':id')
  @RateLimit({ max: 30, windowMs: 60_000 })
  edit(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(editMessageRequest)) body: EditMessageRequest,
  ): Promise<Message> {
    return this.chat.edit(ctx, id, body.body);
  }

  @Delete(':id')
  @RateLimit({ max: 30, windowMs: 60_000 })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.chat.remove(ctx, id);
  }
}
