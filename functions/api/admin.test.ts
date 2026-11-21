// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { onRequest } from './admin/[[path]]';

describe('functions/api/admin/[[path]] Edge validation & auth gates', () => {
  it('returns 401 when no admin credentials are provided', async () => {
    const response = await onRequest({
      env: { ADMIN_PASSKEY: 'secret123' },
      request: new Request('https://example.test/api/admin/schema-parity', {
        method: 'GET',
      }),
    });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'Administrator authentication is required.' });
  });

  it('returns 403 when invalid admin credentials are provided', async () => {
    const response = await onRequest({
      env: { ADMIN_PASSKEY: 'secret123' },
      request: new Request('https://example.test/api/admin/schema-parity', {
        method: 'GET',
        headers: { 'X-Admin-Token': 'wrong-token' },
      }),
    });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'Administrator elevation is required.' });
  });

  it('returns 503 fail-closed on /api/admin/auth/verify when ADMIN_PASSKEY is not configured', async () => {
    const response = await onRequest({
      env: {},
      request: new Request('https://example.test/api/admin/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passkey: 'some-passkey' }),
      }),
    });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({
      success: false,
      authenticated: false,
      error: 'Admin access is not configured. Set ADMIN_PASSKEY in the environment.',
    });
  });

  it('returns 400 when passkey is empty on /api/admin/auth/verify', async () => {
    const response = await onRequest({
      env: { ADMIN_PASSKEY: 'secret123' },
      request: new Request('https://example.test/api/admin/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passkey: '' }),
      }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      success: false,
      error: expect.stringContaining('Passkey is required'),
    });
  });

  it('returns 401 when passkey is incorrect on /api/admin/auth/verify', async () => {
    const response = await onRequest({
      env: { ADMIN_PASSKEY: 'secret123' },
      request: new Request('https://example.test/api/admin/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passkey: 'wrong-passkey' }),
      }),
    });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({
      success: false,
      error: 'Invalid administrator passkey. Access denied.',
    });
  });

  it('returns 200 when passkey is correct on /api/admin/auth/verify', async () => {
    const response = await onRequest({
      env: { ADMIN_PASSKEY: 'secret123' },
      request: new Request('https://example.test/api/admin/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passkey: 'secret123' }),
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      authenticated: true,
      role: 'admin',
    });
  });
});
