import { randomUUID } from 'node:crypto';

import { ConsoleLogger, Logger, type LoggerService } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Production logs are one JSON object per line (Docker rotates them; plan phase-1-step-9 §6).
 * Read from the process environment because it is needed before the config module loads.
 */
export function productionLogger(): LoggerService | undefined {
  return process.env.NODE_ENV === 'production' ? new ConsoleLogger({ json: true }) : undefined;
}

const REQUEST_ID = /^[\w-]{1,64}$/;
const http = new Logger('HTTP');

/**
 * Gives every request an id (Caddy's, or a new one), returns it as `X-Request-Id` and logs failed
 * requests with it. Only the path is logged: no query string, body, cookies or tokens.
 */
export function requestLog(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get('x-request-id');
  const id = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  const started = performance.now();
  res.on('finish', () => {
    if (res.statusCode < 500) return;
    http.error({
      requestId: id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Math.round(performance.now() - started),
    });
  });
  next();
}
