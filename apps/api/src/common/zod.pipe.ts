import { HttpStatus, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

import { ApiError } from './errors.js';

/** Validates and parses a request part with a shared Zod schema: `@Body(new ZodPipe(schema))`. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'validation_failed',
        'Request validation failed',
        result.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
      );
    }
    return result.data;
  }
}
