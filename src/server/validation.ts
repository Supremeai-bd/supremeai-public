import type { Request, Response } from 'express';
import { z } from 'zod';

/**
 * Request-body validation helpers built on Zod.
 *
 * Usage inside a route:
 *
 *   const parsed = parseBody(loginSchema, req, res);
 *   if (!parsed.ok) return;          // response already sent
 *   const { email, password } = parsed.data;   // fully typed
 *
 * The parsed value is a fresh object with unknown keys stripped, so handlers
 * never touch raw `req.body` and never receive unexpected fields.
 */

export interface ParseFailure {
  ok: false;
  status: number;
  error: string;
  issues: Array<{ path: string; message: string }>;
}

export type ParseResult<T> = { ok: true; data: T } | ParseFailure;

function toIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.slice(0, 10).map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

function fail(
  res: Response,
  status: number,
  error: string,
  issues: ParseResult<never> extends never ? never : Array<{ path: string; message: string }>
): ParseFailure {
  res.status(status).json({ success: false, error, issues });
  return { ok: false, status, error, issues };
}

/** Validates `req.body` against a Zod schema, replying 400 on failure. */
export function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  req: Request,
  res: Response
): ParseResult<z.infer<T>> {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    const issues = toIssues(result.error);
    const first = issues[0];
    return fail(
      res,
      400,
      first ? `Invalid request body: ${first.path} — ${first.message}` : 'Invalid request body.',
      issues
    );
  }
  return { ok: true, data: result.data };
}

/** Validates `req.query` against a Zod schema, replying 400 on failure. */
export function parseQuery<T extends z.ZodTypeAny>(
  schema: T,
  req: Request,
  res: Response
): ParseResult<z.infer<T>> {
  const result = schema.safeParse(req.query ?? {});
  if (!result.success) {
    const issues = toIssues(result.error);
    const first = issues[0];
    return fail(
      res,
      400,
      first ? `Invalid query: ${first.path} — ${first.message}` : 'Invalid query parameters.',
      issues
    );
  }
  return { ok: true, data: result.data };
}

// ---------------------------------------------------------------------------
// Shared field schemas reused across routes
// ---------------------------------------------------------------------------

/** Trimmed, lowercased email address. */
export const emailField = z
  .string()
  .trim()
  .min(3, 'Email is required.')
  .max(254, 'Email is too long.')
  .email('Enter a valid email address.')
  .transform((value) => value.toLowerCase());

/** 6-digit RFC 6238 TOTP code. */
export const totpCodeField = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.');

/** Non-empty trimmed string with a sensible upper bound. */
export const requiredString = (max = 512, label = 'This field') =>
  z.string().trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);

// ---------------------------------------------------------------------------
// Auth route schemas
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: emailField.optional(),
  username: emailField.optional(),
  password: z.string().min(1, 'Password is required.').max(1024, 'Password is too long.'),
});

export const signupSchema = z.object({
  name: z.string().trim().max(120).optional(),
  email: emailField,
  password: z.string().min(8, 'Password must be at least 8 characters.').max(1024),
});

export const refreshSchema = z.object({
  refresh_token: z.string().trim().max(2048).optional(),
});

export const totpConfirmSchema = z.object({
  userEmail: emailField.optional(),
  token: totpCodeField,
  trustFor7Days: z.boolean().optional(),
});

export const verify2faSchema = z.object({
  userEmail: emailField.optional(),
  token: totpCodeField,
  method: z.string().trim().max(32).optional(),
  trustFor7Days: z.boolean().optional(),
});

export const adminPasskeySchema = z.object({
  passkey: z.string().min(1, 'Passkey is required.').max(512, 'Passkey is too long.'),
});
