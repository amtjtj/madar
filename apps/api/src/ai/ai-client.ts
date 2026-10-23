import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { ApiError } from '../common/errors.js';

/** What the AI service needs to summarise a report: facts only, never a person (ADR 0025). */
export interface ReportFacts {
  scope: 'company' | 'department';
  name: string;
  weekLabel: string;
  partial: boolean;
  totals: { done: number; created: number; overdue: number };
  previous: { done: number; created: number; overdue: number | null };
  departments: Array<{
    name: string;
    done: number;
    overdue: number;
    behind: boolean;
    goalProgress: number | null;
  }>;
  goals: Array<{ title: string; progress: number; change: number | null }>;
  atRiskProjects: Array<{ name: string; done: number; total: number; overdue: number }>;
  highlights: string[];
  stuck: number;
}

export interface BreakdownInput {
  sentence: string;
  department: string;
  today: string;
}

/**
 * The only way to the AI service (ADR 0025): over the internal network with the shared token,
 * with a timeout. It never logs what it sends or gets back, only what failed.
 */
@Injectable()
export class AiClient {
  private readonly logger = new Logger('AiClient');

  constructor(@Inject(ENV) private readonly env: Env) {}

  get available(): boolean {
    return this.env.AI_SERVICE_URL !== '';
  }

  reportSummary(facts: ReportFacts): Promise<{ text: string; model: string }> {
    return this.post('/v1/report-summary', facts);
  }

  taskBreakdown(
    input: BreakdownInput,
    signal?: AbortSignal,
  ): Promise<{ tasks: Array<{ title: string; dueInDays: number | null }>; model: string }> {
    return this.post('/v1/task-breakdown', input, signal);
  }

  private async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    if (!this.available) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'ai_unavailable', 'No AI service');
    }
    const timeout = AbortSignal.timeout(this.env.AI_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${this.env.AI_SERVICE_URL.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.env.AI_SERVICE_TOKEN}`,
        },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      });
    } catch (error) {
      this.logger.warn(`${path}: ${error instanceof Error ? error.name : 'error'}`);
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ai_unavailable',
        'AI service unreachable',
      );
    }
    if (response.ok) return (await response.json()) as T;
    this.logger.warn(`${path}: ${response.status}`);
    if (response.status === 503 || response.status === 401) {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ai_unavailable',
        'AI service unavailable',
      );
    }
    throw new ApiError(HttpStatus.BAD_GATEWAY, 'ai_failed', 'AI service failed');
  }
}
