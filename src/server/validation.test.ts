import { describe, it, expect } from 'vitest';
import type { Request, Response } from 'express';
import {
  parseBody,
  parseQuery,
  loginSchema,
  signupSchema,
  totpConfirmSchema,
  adminPasskeySchema,
  emailField,
  totpCodeField,
} from './validation';

function mockRes() {
  const state = { status: 0, body: undefined as unknown, ended: false };
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(payload: unknown) {
      state.body = payload;
      return res;
    },
  } as unknown as Response;
  return { res, state };
}

const reqWith = (body: unknown) => ({ body }) as Request;

describe('src/server/validation.ts', () => {
  describe('emailField', () => {
    it('lowercases and trims valid emails', () => {
      expect(emailField.parse('  Admin@Example.COM ')).toBe('admin@example.com');
    });

    it('rejects malformed emails', () => {
      expect(emailField.safeParse('not-an-email').success).toBe(false);
      expect(emailField.safeParse('').success).toBe(false);
    });
  });

  describe('totpCodeField', () => {
    it('accepts exactly six digits', () => {
      expect(totpCodeField.parse('123456')).toBe('123456');
    });

    it('rejects non-numeric, short, and long codes', () => {
      expect(totpCodeField.safeParse('12345').success).toBe(false);
      expect(totpCodeField.safeParse('1234567').success).toBe(false);
      expect(totpCodeField.safeParse('12a456').success).toBe(false);
    });
  });

  describe('loginSchema', () => {
    it('accepts username as an alias for email', () => {
      const out = loginSchema.parse({ username: 'User@Site.io', password: 'x' });
      expect(out.username).toBe('user@site.io');
    });

    it('rejects a missing password', () => {
      expect(loginSchema.safeParse({ email: 'a@b.co' }).success).toBe(false);
    });

    it('strips unknown keys so handlers never see extras', () => {
      const out = loginSchema.parse({ email: 'a@b.co', password: 'p', isAdmin: true });
      expect(Object.keys(out)).not.toContain('isAdmin');
    });
  });

  describe('signupSchema', () => {
    it('enforces a minimum password length', () => {
      expect(signupSchema.safeParse({ email: 'a@b.co', password: 'short' }).success).toBe(false);
      expect(signupSchema.safeParse({ email: 'a@b.co', password: 'longenough' }).success).toBe(
        true
      );
    });
  });

  describe('totpConfirmSchema', () => {
    it('requires a 6-digit token', () => {
      expect(totpConfirmSchema.safeParse({ token: '123456' }).success).toBe(true);
      expect(totpConfirmSchema.safeParse({ token: 'abc' }).success).toBe(false);
    });
  });

  describe('adminPasskeySchema', () => {
    it('rejects an empty passkey', () => {
      expect(adminPasskeySchema.safeParse({ passkey: '' }).success).toBe(false);
      expect(adminPasskeySchema.safeParse({}).success).toBe(false);
    });
  });

  describe('parseBody', () => {
    it('returns typed data on success', () => {
      const { res } = mockRes();
      const result = parseBody(loginSchema, reqWith({ email: 'A@B.co', password: 'pw' }), res);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.email).toBe('a@b.co');
    });

    it('replies 400 and names the offending field on failure', () => {
      const { res, state } = mockRes();
      const result = parseBody(loginSchema, reqWith({ email: 'bad', password: 'pw' }), res);
      expect(result.ok).toBe(false);
      expect(state.status).toBe(400);
      const body = state.body as { success: boolean; error: string; issues: unknown[] };
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/email/i);
      expect(Array.isArray(body.issues)).toBe(true);
    });

    it('handles a completely missing body without throwing', () => {
      const { res, state } = mockRes();
      const result = parseBody(loginSchema, reqWith(undefined), res);
      expect(result.ok).toBe(false);
      expect(state.status).toBe(400);
    });

    it('caps the reported issues at ten', () => {
      const { res, state } = mockRes();
      const manyKeys = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]));
      // force many failures by validating a strict object
      const schema = adminPasskeySchema.extend({ passkey: totpCodeField });
      parseBody(schema, reqWith({ ...manyKeys, passkey: 'nope' }), res);
      const body = state.body as { issues: unknown[] };
      expect(body.issues.length).toBeLessThanOrEqual(10);
    });
  });

  describe('parseQuery', () => {
    it('validates query objects', () => {
      const { res } = mockRes();
      const result = parseQuery(
        loginSchema,
        { query: { email: 'a@b.co', password: 'p' } } as unknown as Request,
        res
      );
      expect(result.ok).toBe(true);
    });
  });
});
