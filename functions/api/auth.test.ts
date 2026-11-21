// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { onRequest as verify2faOnRequest } from './auth/verify-2fa';
import { onRequest as totpOnRequest } from './auth/totp/[[path]]';

describe('functions/api/auth Edge validation gates', () => {
  describe('/api/auth/verify-2fa', () => {
    it('returns 401 when no auth session is provided', async () => {
      const response = await verify2faOnRequest({
        env: {},
        request: new Request('https://example.test/api/auth/verify-2fa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: '123456' }),
        }),
      });
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toMatchObject({
        error: 'Authentication is required for 2FA verification.',
      });
    });

    it('returns 400 when TOTP code is not a 6-digit code', async () => {
      const response = await verify2faOnRequest({
        env: {},
        request: new Request('https://example.test/api/auth/verify-2fa', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-user-session',
          },
          body: JSON.stringify({ token: 'bad-code' }),
        }),
      });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toMatchObject({
        success: false,
        error: expect.stringContaining('6-digit code'),
      });
    });

    it('returns 400 when TOTP code is less than 6 digits', async () => {
      const response = await verify2faOnRequest({
        env: {},
        request: new Request('https://example.test/api/auth/verify-2fa', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-user-session',
          },
          body: JSON.stringify({ token: '12345' }),
        }),
      });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toMatchObject({
        success: false,
        error: expect.stringContaining('6-digit code'),
      });
    });
  });

  describe('/api/auth/totp/confirm', () => {
    it('returns 401 when unauthenticated session calls confirm', async () => {
      const response = await totpOnRequest({
        env: {},
        request: new Request('https://example.test/api/auth/totp/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: '123456' }),
        }),
      });
      expect(response.status).toBe(401);
    });

    it('returns 400 when TOTP code is invalid on confirm', async () => {
      const response = await totpOnRequest({
        env: {},
        request: new Request('https://example.test/api/auth/totp/confirm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-admin-session',
          },
          body: JSON.stringify({ token: '123' }),
        }),
      });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toMatchObject({
        success: false,
        error: expect.stringContaining('6-digit code'),
      });
    });
  });
});
