import { healthResponse, type HealthResponse } from '@madar/shared';

/** Fetches /api/health and validates the payload against the shared contract. */
export async function fetchHealth(fetchImpl: typeof fetch = fetch): Promise<HealthResponse> {
  const res = await fetchImpl('/api/health', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Health check failed with HTTP ${res.status}`);
  }
  return healthResponse.parse(await res.json());
}
