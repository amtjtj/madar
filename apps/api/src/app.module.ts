import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthGuard } from './auth/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { DepartmentsModule } from './departments/departments.module.js';
import { GoalsModule } from './goals/goals.module.js';
import { HealthModule } from './health/health.module.js';
import { MeModule } from './me/me.module.js';
import { MembersModule } from './members/members.module.js';
import { NotificationsModule } from './notifications/notifications-http.module.js';
import { PushModule } from './push/push-http.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { TenantsModule } from './tenants/tenants.module.js';
import { FilesModule } from './files/files.module.js';
import { ChatModule } from './chat/chat.module.js';
import { EvidenceModule } from './evidence/evidence.module.js';
import { LettersModule } from './letters/letters.module.js';
import { MeetingsModule } from './meetings/meetings.module.js';
import { WorkModule } from './work/work.module.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule,
    HealthModule,
    MeModule,
    TenantsModule,
    DepartmentsModule,
    MembersModule,
    WorkModule,
    FilesModule,
    LettersModule,
    EvidenceModule,
    ChatModule,
    MeetingsModule,
    GoalsModule,
    DashboardModule,
    ReportsModule,
    NotificationsModule,
    PushModule,
    RealtimeModule,
  ],
  providers: [{ provide: APP_GUARD, useExisting: AuthGuard }],
})
export class AppModule {}
