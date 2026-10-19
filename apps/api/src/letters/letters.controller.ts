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
  Query,
} from '@nestjs/common';
import {
  listLettersQuery,
  referLetterRequest,
  saveLetterRequest,
  type Letter,
  type LetterList,
  type LetterUnreadCount,
  type ListLettersQuery,
  type ReferLetterRequest,
  type SaveLetterRequest,
} from '@madar/shared';

import { Tenant, type TenantContext } from '../common/context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { LettersService } from './letters.service.js';

/** Internal letters (ADR 0020). Access is per letter (sender and recipients); see letters/access.ts. */
@Controller('letters')
export class LettersController {
  constructor(private readonly letters: LettersService) {}

  @Get()
  list(
    @Tenant() ctx: TenantContext,
    @Query(new ZodPipe(listLettersQuery)) query: ListLettersQuery,
  ): Promise<LetterList> {
    return this.letters.list(ctx, query);
  }

  @Get('unread-count')
  async unreadCount(@Tenant() ctx: TenantContext): Promise<LetterUnreadCount> {
    return { count: await this.letters.unreadCount(ctx) };
  }

  @Get(':id')
  get(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<Letter> {
    return this.letters.get(ctx, id);
  }

  @Post()
  create(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(saveLetterRequest)) body: SaveLetterRequest,
  ): Promise<Letter> {
    return this.letters.create(ctx, body);
  }

  @Patch(':id')
  update(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(saveLetterRequest)) body: SaveLetterRequest,
  ): Promise<Letter> {
    return this.letters.update(ctx, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.letters.remove(ctx, id);
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  send(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<Letter> {
    return this.letters.send(ctx, id);
  }

  @Post(':id/refer')
  @HttpCode(HttpStatus.OK)
  refer(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(referLetterRequest)) body: ReferLetterRequest,
  ): Promise<Letter> {
    return this.letters.refer(ctx, id, body);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.letters.setArchived(ctx, id, true);
  }

  @Post(':id/unarchive')
  @HttpCode(HttpStatus.NO_CONTENT)
  unarchive(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.letters.setArchived(ctx, id, false);
  }
}
