// @vitest-environment node
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { onRequest as verify2faOnRequest } from './auth/verify-2fa';
import { onRequest as totpOnRequest } from './auth/totp/[[path]]';
import {
  decodeBase32ToBytes,
  generateEdgeHotp,
  resetEdgeTotpReplayCache,
} from '../_lib/edgeHelpers';
import { processProxiedHtml } from '../../src/shared/browserProxyHtml';

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

    it('rejects replayed 6-digit TOTP codes within the same 30-second step window', async () => {
      resetEdgeTotpReplayCache();
      using _fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ preferences: {} }), { status: 200 }));
      const secret = 'JBSWY3DPEHPK3PXP';
      const currentStep = Math.floor(Date.now() / 1000 / 30);
      const liveCode = await generateEdgeHotp(decodeBase32ToBytes(secret), currentStep, 6);

      const firstRes = await verify2faOnRequest({
        env: { ADMIN_TOTP_SECRET: secret },
        request: new Request('https://example.test/api/auth/verify-2fa', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-user-session',
          },
          body: JSON.stringify({ token: liveCode }),
        }),
      });
      expect(firstRes.status).toBe(200);

      const replayRes = await verify2faOnRequest({
        env: { ADMIN_TOTP_SECRET: secret },
        request: new Request('https://example.test/api/auth/verify-2fa', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-user-session',
          },
          body: JSON.stringify({ token: liveCode }),
        }),
      });
      expect(replayRes.status).toBe(401);
      const replayBody = await replayRes.json();
      expect(replayBody).toMatchObject({
        success: false,
        error: expect.stringContaining('already been used'),
      });
    });
  });

  describe('browserProxyHtml targetOrigin hardening', () => {
    beforeEach(() => {
      resetEdgeTotpReplayCache();
    });

    it('scopes postToHost targetOrigin to parentOrigin and guards window.parent === window.top', () => {
      const result = processProxiedHtml(
        '<html><head><title>Login</title></head><body><input type="password" /></body></html>',
        'https://target.example.com/login',
        'target.example.com',
        'https://supremeai-studio.pages.dev'
      );
      expect(result.html).toContain('var _hostOrigin="https://supremeai-studio.pages.dev"');
      expect(result.html).toContain('if(window.parent!==window.top||window.parent===window)return;');
      expect(result.html).not.toContain("postMessage({channel:'supremeai-browser'");
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
