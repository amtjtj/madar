import { schema as s, type Tx } from '@madar/db';
import { aiSettings, DEFAULT_AI_SETTINGS, type AiSettings } from '@madar/shared';
import { eq } from 'drizzle-orm';

/** The company's assistant switch (`tenants.settings.ai`); off unless turned on. */
export async function loadAiSettings(tx: Tx, tenantId: string): Promise<AiSettings> {
  const [tenant] = await tx
    .select({ settings: s.tenants.settings })
    .from(s.tenants)
    .where(eq(s.tenants.id, tenantId));
  const parsed = aiSettings.safeParse(tenant?.settings?.ai);
  return parsed.success ? parsed.data : DEFAULT_AI_SETTINGS;
}
