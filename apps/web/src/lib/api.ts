import { healthResponse, type HealthResponse } from '@madar/shared';

/** An API failure with the server's error code (mapped to Persian text by `errorMessage`). */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message?: string,
  ) {
    super(message ?? code ?? `HTTP ${status}`);
    this.name = 'ApiClientError';
  }
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Cancels the request (the error then has code `aborted`). */
  signal?: AbortSignal;
}

/** JSON request to our API (same origin; the session cookie rides along). */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? 'GET',
      headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal,
    });
  } catch {
    throw new ApiClientError(0, options.signal?.aborted ? 'aborted' : 'network');
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const body = data as {
      error?: { code?: string; message?: string };
      code?: string;
      message?: string;
    } | null;
    // Our API: { error: { code } }; Better Auth: { code, message }
    throw new ApiClientError(
      res.status,
      body?.error?.code ?? body?.code,
      body?.error?.message ?? body?.message,
    );
  }
  return data as T;
}

/** Fetches /api/health and validates the payload against the shared contract. */
export async function fetchHealth(fetchImpl: typeof fetch = fetch): Promise<HealthResponse> {
  const res = await fetchImpl('/api/health', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Health check failed with HTTP ${res.status}`);
  }
  return healthResponse.parse(await res.json());
}
