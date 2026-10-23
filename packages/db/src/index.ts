export { createDb, pingDb, type Database, type DbHandle } from './client.js';
export {
  appendAudit,
  emitEvent,
  recordActivity,
  type ActivityChanges,
  listMemberships,
  listActiveTenants,
  lockUnpublishedEvents,
  markEventsPublished,
  type OutboxEvent,
  setActor,
  withTenant,
  type AuditEntry,
  type Membership,
  type TenantScope,
  type Tx,
} from './tenant.js';
export { NotADemoDatabaseError, truncateAllData } from './truncate.js';
export { companyDay, dbNow, forgetKnowledge } from './knowledge.js';
export { uuidv7 } from './schema/columns.js';
export * as schema from './schema/index.js';
