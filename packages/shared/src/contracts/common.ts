import { z } from 'zod';

import { toLatinDigits } from '../locale/digits.js';

/** Lowercase Latin letters, digits, dot, dash, underscore; 3–32 chars; no leading/trailing symbol. */
export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,30})[a-z0-9]$/;

export const usernameSchema = z
  .string()
  .trim()
  .transform((value) => toLatinDigits(value).toLowerCase())
  .pipe(z.string().regex(USERNAME_PATTERN));

/** Company identifier used in URLs: lowercase Latin letters, digits and dashes, 3–40 chars. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

export const slugSchema = z
  .string()
  .trim()
  .transform((value) => toLatinDigits(value).toLowerCase())
  .pipe(z.string().regex(SLUG_PATTERN));

/** A person's or organization's display name. */
export const displayNameSchema = z.string().trim().min(2).max(80);
