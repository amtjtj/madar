import { Module } from '@nestjs/common';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { WorkModule } from '../work/work.module.js';
import {
  AttachmentsController,
  FileSettingsController,
  TaskAttachmentsController,
  UploadsController,
} from './attachments.controller.js';
import { AttachmentsService } from './attachments.service.js';
import { FILE_STORAGE, createStorage } from './storage.js';

/** Attachments and their storage (ADR 0019). */
@Module({
  imports: [WorkModule],
  controllers: [
    UploadsController,
    TaskAttachmentsController,
    AttachmentsController,
    FileSettingsController,
  ],
  providers: [
    AttachmentsService,
    { provide: FILE_STORAGE, useFactory: (env: Env) => createStorage(env), inject: [ENV] },
  ],
  exports: [FILE_STORAGE],
})
export class FilesModule {}
