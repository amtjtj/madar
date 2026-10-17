# 0006 — API style, workers, events and file storage

- Status: Accepted
- Date: 2026-10-17

## Decision
- **API:** REST on NestJS, one Nest module per domain. Request/response schemas are Zod contracts in `packages/shared/contracts`, shared with the web client. Binding (decided in phase 1, step 4): a small in-house `ZodPipe` validates bodies and queries with the shared schemas — no ts-rest or nestjs-zod. Errors are `{ error: { code, message } }`; the web maps codes to Persian text, the API never sends UI text.
- **Deployment shape:** a reverse proxy (Caddy) serves web at `/` and api at `/api/*` on one domain: first-party cookies, no CORS.
- **Workers:** same codebase as the API with a second entrypoint `apps/api/src/worker.ts`, deployed as a separate container.
- **Domain events:** transactional outbox (`domain_events`) written in the same transaction as the change; a relay in the worker publishes to BullMQ; consumers are idempotent via `processed_events`. Audit logs are written synchronously, not via events.
- **Files:** S3-compatible storage behind an interface; MinIO in development, MinIO or an Iranian cloud S3 service in production. Object keys `tenants/{tenantId}/...`, downloads through short-lived signed URLs after a permission check.
- **Realtime:** Socket.IO gateway with Redis adapter; rooms prefixed by tenant.

## Alternatives considered
tRPC, GraphQL; in-process EventEmitter, LISTEN/NOTIFY, Kafka/NATS; separate `apps/worker`. See `docs/architecture.md` sections 1 and 5.
