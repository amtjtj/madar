import { Inject, Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, type OnGatewayConnection } from '@nestjs/websockets';
import { schema as s, withTenant, type DbHandle } from '@madar/db';
import { REALTIME_PATH, requiresTwoFactor } from '@madar/shared';
import { fromNodeHeaders } from 'better-auth/node';
import { eq, or } from 'drizzle-orm';
import type { Server, Socket } from 'socket.io';

import type { Auth } from '../auth/auth.js';
import { AUTH } from '../auth/auth.tokens.js';
import { TenantContextService } from '../auth/tenant-context.service.js';
import { DB_HANDLE } from '../database/tokens.js';
import { departmentRoom, memberRoom, projectRoom } from './rooms.js';

/**
 * Realtime hints. A socket is accepted only with a valid session, an active membership in an
 * active (or read-only) tenant and no pending security step; the server then puts it in its own
 * member, department and project rooms. Clients cannot join rooms and send nothing.
 */
// No trailing slash: the web proxy (Next rewrites) normalizes it away.
@WebSocketGateway({ path: REALTIME_PATH, serveClient: false, addTrailingSlash: false })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger('Realtime');
  @WebSocketServer() server!: Server;

  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    private readonly tenants: TenantContextService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const rooms = await this.roomsFor(client);
      if (!rooms) {
        client.disconnect(true);
        return;
      }
      await client.join(rooms);
    } catch (error) {
      this.logger.warn(`connection refused: ${String(error)}`);
      client.disconnect(true);
    }
  }

  private async roomsFor(client: Socket): Promise<string[] | null> {
    const result = await this.auth.api.getSession({
      headers: fromNodeHeaders(client.request.headers),
    });
    if (!result) return null;
    const user = result.user as typeof result.user & {
      twoFactorEnabled?: boolean | null;
      mustChangePassword?: boolean | null;
    };
    if (user.mustChangePassword) return null;

    let tenantId = (result.session as { activeTenantId?: string | null }).activeTenantId ?? null;
    const memberships = await this.tenants.memberships(user.id);
    if (!tenantId) {
      const active = memberships.filter((m) => m.memberStatus === 'active');
      tenantId = active.length === 1 ? (active[0]?.tenantId ?? null) : null;
    }
    const membership = memberships.find((m) => m.tenantId === tenantId);
    if (!tenantId || !membership || membership.memberStatus !== 'active') return null;
    if (membership.tenantStatus === 'locked') return null;

    const member = await this.tenants.loadMember(tenantId, user.id);
    if (!member || member.status !== 'active') return null;
    if (requiresTwoFactor(member.actor.roles) && !user.twoFactorEnabled) return null;

    const projects = await withTenant(this.handle.db, { tenantId }, (tx) =>
      tx
        .selectDistinct({ id: s.projects.id })
        .from(s.projects)
        .leftJoin(s.projectMembers, eq(s.projectMembers.projectId, s.projects.id))
        .where(
          or(
            eq(s.projects.ownerId, member.memberId),
            eq(s.projectMembers.memberId, member.memberId),
          ),
        ),
    );
    const id = tenantId;
    return [
      memberRoom(id, member.memberId),
      ...member.actor.departments.map((d) => departmentRoom(id, d.id)),
      ...projects.map((p) => projectRoom(id, p.id)),
    ];
  }
}
