import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { KnowledgeKind } from '@madar/shared';
import { z } from 'zod';

import { schema } from '@madar/db';

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

const summaryReply = z.object({ text: z.string().min(1).max(4000), model: z.string().max(200) });
const breakdownReply = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        dueInDays: z.number().int().min(0).max(365).nullable().optional(),
      }),
    )
    .max(10),
  model: z.string().max(200),
});

const embedReply = z.object({
  vectors: z.array(z.array(z.number()).length(schema.EMBEDDING_DIMENSIONS)),
  model: z.string().min(1).max(200),
});
const answerReply = z.object({
  text: z.string().min(1).max(4000),
  cited: z.array(z.number().int()),
  model: z.string().max(200),
});

/** One numbered source for an answer: only what the asking person may see (ADR 0026). */
export interface AnswerSource {
  n: number;
  kind: KnowledgeKind;
  title: string;
  text: string;
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
    return this.post('/v1/report-summary', facts, summaryReply);
  }

  taskBreakdown(
    input: BreakdownInput,
    signal?: AbortSignal,
  ): Promise<z.infer<typeof breakdownReply>> {
    return this.post('/v1/task-breakdown', input, breakdownReply, signal);
  }

  /** Vectors for chunks or a question (at most 64 texts per call); same order as `texts`. */
  async embed(
    texts: string[],
    signal?: AbortSignal,
  ): Promise<{ vectors: number[][]; model: string }> {
    const reply = await this.post('/v1/embed', { texts }, embedReply, signal);
    if (reply.vectors.length !== texts.length) {
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'ai_failed', 'AI service answered badly');
    }
    return reply;
  }

  answer(
    input: { question: string; today: string; sources: AnswerSource[] },
    signal?: AbortSignal,
  ): Promise<z.infer<typeof answerReply>> {
    return this.post('/v1/answer', input, answerReply, signal);
  }

  /** The embedding model the service runs now (its /health), or undefined when it cannot say. */
  async embedModel(): Promise<string | undefined> {
    if (!this.available) return undefined;
    try {
      const response = await fetch(`${this.env.AI_SERVICE_URL.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(4000),
      });
      const body = z
        .object({ embedModel: z.string().min(1).max(200) })
        .safeParse(await response.json());
      return response.ok && body.success ? body.data.embedModel : undefined;
    } catch {
      return undefined;
    }
  }

  /** The service and its model answer (admins' status page); never throws. */
  async health(): Promise<{ reachable: boolean; modelReachable: boolean }> {
    if (!this.available) return { reachable: false, modelReachable: false };
    try {
      const response = await fetch(`${this.env.AI_SERVICE_URL.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(4000),
      });
      const body = z.object({ modelReachable: z.boolean() }).safeParse(await response.json());
      return { reachable: response.ok, modelReachable: body.success && body.data.modelReachable };
    } catch {
      return { reachable: false, modelReachable: false };
    }
  }

  private async post<T>(
    path: string,
    body: unknown,
    reply: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
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
    if (response.ok) {
      // The service's answer is checked like any input before it is used.
      const parsed = reply.safeParse(await response.json().catch(() => null));
      if (parsed.success) return parsed.data;
      this.logger.warn(`${path}: malformed reply`);
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'ai_failed', 'AI service answered badly');
    }
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
