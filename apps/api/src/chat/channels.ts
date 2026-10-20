import { schema as s, uuidv7, type Tx } from '@madar/db';

/**
 * The chat channel of a project or department (ADR 0022), created with its source in the same
 * transaction. Its members are the source's members, so nothing else needs syncing.
 */
export async function createChannel(
  tx: Tx,
  source: { projectId: string } | { departmentId: string },
): Promise<void> {
  await tx
    .insert(s.conversations)
    .values(
      'projectId' in source
        ? { id: uuidv7(), kind: 'project', projectId: source.projectId }
        : { id: uuidv7(), kind: 'department', departmentId: source.departmentId },
    )
    .onConflictDoNothing();
}
