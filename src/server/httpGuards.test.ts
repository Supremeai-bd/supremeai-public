import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { createRateLimiter, isHttpsRequest, safeFetchWithRedirectCheck } from './httpGuards';
import { createMcpClusterServices } from './mcpClusterServices';

const req = (headers: Record<string, string> = {}, extra: Partial<Request> = {}) =>
  ({
    header: (name: string) => headers[name.toLowerCase()],
    secure: false,
    ip: '1.2.3.4',
    baseUrl: '/api/auth/login',
    path: '/',
    ...extra,
  }) as unknown as Request;

function res() {
  const r = { statusCode: 200, body: null as unknown };
  return Object.assign(r, {
    status(code: number) {
      r.statusCode = code;
      return this;
    },
    json(body: unknown) {
      r.body = body;
      return this;
    },
  }) as unknown as Response & { statusCode: number };
}

describe('isHttpsRequest', () => {
  it('detects HTTPS behind a proxy or from the origin', () => {
    expect(isHttpsRequest(req())).toBe(false);
    expect(isHttpsRequest(req({}, { secure: true }))).toBe(true);
    expect(isHttpsRequest(req({ 'x-forwarded-proto': 'https' }))).toBe(true);
    expect(isHttpsRequest(req({ forwarded: 'for=1.1.1.1;proto=https' }))).toBe(true);
    expect(isHttpsRequest(req({ origin: 'https://studio.test' }))).toBe(true);
  });
});

describe('createRateLimiter', () => {
  it('allows `max` hits per window per IP and route, then answers 429', () => {
    const limit = createRateLimiter()(60_000, 2);
    const next = vi.fn() as unknown as NextFunction;
    const r = res();
    limit(req(), r, next);
    limit(req(), r, next);
    expect(next).toHaveBeenCalledTimes(2);
    limit(req(), r, next);
    expect(r.statusCode).toBe(429);
    expect(next).toHaveBeenCalledTimes(2);
    // a different IP is not affected
    limit(req({}, { ip: '5.6.7.8' }), res(), next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('each limiter owns its own buckets', () => {
    const next = vi.fn() as unknown as NextFunction;
    createRateLimiter()(60_000, 1)(req(), res(), next);
    createRateLimiter()(60_000, 1)(req(), res(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});

describe('safeFetchWithRedirectCheck', () => {
  it('refuses private / loopback targets before any request is made', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(safeFetchWithRedirectCheck('http://127.0.0.1/admin')).rejects.toThrow();
    await expect(safeFetchWithRedirectCheck('http://169.254.169.254/latest')).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('createMcpClusterServices', () => {
  it('returns a fresh, mutable copy for each server', () => {
    const a = createMcpClusterServices();
    const b = createMcpClusterServices();
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
    a[0].status = 'unhealthy';
    expect(b[0].status).not.toBe('unhealthy');
    expect(new Set(a.map((s) => s.id)).size).toBe(a.length);
  });
});
