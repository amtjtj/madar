import { z } from 'zod';

import { displayNameSchema, slugSchema, usernameSchema } from './common.js';
import { passwordSchema } from './me.js';

export const signupRequest = z.object({
  companyName: displayNameSchema,
  slug: slugSchema,
  adminName: displayNameSchema,
  username: usernameSchema,
  password: passwordSchema,
  /** Required when the server sets TENANT_SIGNUP_CODE (production). */
  signupCode: z.string().max(200).optional(),
});
export type SignupRequest = z.infer<typeof signupRequest>;

export const signupResponse = z.object({
  tenantId: z.uuid(),
  slug: z.string(),
  username: z.string(),
});
export type SignupResponse = z.infer<typeof signupResponse>;
