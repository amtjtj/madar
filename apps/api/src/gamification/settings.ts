import { schema as s, type Tx } from '@madar/db';
import { gamificationSettings, type GamificationSettings } from '@madar/shared';
import { eq } from 'drizzle-orm';

/** The company's gamification settings (`tenants.settings.gamification`, ADR 0029). */
export async function loadGamificationSettings(
  tx: Tx,
  tenantId: string,
): Promise<GamificationSettings> {
  const [tenant] = await tx
    .select({ settings: s.tenants.settings })
    .from(s.tenants)
    .where(eq(s.tenants.id, tenantId));
  const parsed = gamificationSettings.safeParse(
    (tenant?.settings as { gamification?: unknown } | null)?.gamification ?? {},
  );
  return parsed.success ? parsed.data : gamificationSettings.parse({});
}
