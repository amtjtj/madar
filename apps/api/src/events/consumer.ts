import type { OutboxEvent, Tx } from '@madar/db';

/**
 * A domain-event consumer (ADR 0006). Runs in the worker inside `withTenant(event.tenantId)`,
 * in the same transaction that records it in `processed_events`, so each event takes effect once.
 */
export interface EventConsumer {
  /** Stable name: queue name and `processed_events.consumer`. */
  readonly name: string;
  handles(type: string): boolean;
  handle(tx: Tx, event: OutboxEvent): Promise<void>;
  /** Optional work after the transaction committed (e.g. realtime fan-out). */
  afterCommit?(event: OutboxEvent): Promise<void>;
}

export const EVENT_CONSUMERS = Symbol('EVENT_CONSUMERS');
export const REDIS = Symbol('REDIS');

/** The job payload: the tenant travels with every job and is checked before anything runs. */
export interface EventJob {
  tenantId: string;
  event: Omit<OutboxEvent, 'occurredAt'> & { occurredAt: string };
}
