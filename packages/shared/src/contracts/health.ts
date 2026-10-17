import { z } from 'zod';

export const dependencyStatus = z.enum(['up', 'down']);
export type DependencyStatus = z.infer<typeof dependencyStatus>;

/** GET /api/health — liveness of the API and its backing services. */
export const healthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.literal('madar-api'),
  version: z.string(),
  time: z.iso.datetime(),
  dependencies: z.object({
    database: dependencyStatus,
  }),
});
export type HealthResponse = z.infer<typeof healthResponse>;
