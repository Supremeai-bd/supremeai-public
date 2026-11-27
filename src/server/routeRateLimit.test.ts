// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { routeRateLimit } from './routeRateLimit';

async function withServer(app: express.Express, run: (base: string) => Promise<void>) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('routeRateLimit', () => {
  it('route scope: separate buckets per route, 429 with JSON error after the limit', async () => {
    const app = express();
    const limiter = routeRateLimit(2);
    app.get('/a', limiter, (_req, res) => void res.json({ ok: 'a' }));
    app.get('/b', limiter, (_req, res) => void res.json({ ok: 'b' }));
    await withServer(app, async (base) => {
      expect((await fetch(`${base}/a`)).status).toBe(200);
      expect((await fetch(`${base}/a`)).status).toBe(200);
      const blocked = await fetch(`${base}/a`);
      expect(blocked.status).toBe(429);
      expect(await blocked.json()).toEqual({
        error: 'Too many requests. Please wait a moment and retry.',
      });
      expect(blocked.headers.get('ratelimit-policy')).toBeTruthy();
      expect((await fetch(`${base}/b`)).status).toBe(200);
    });
  });

  it('area scope: one shared bucket for the whole mounted prefix', async () => {
    const app = express();
    app.use('/api/admin', routeRateLimit(2, { scope: 'area', message: 'slow down' }));
    app.get('/api/admin/x', (_req, res) => void res.json({ ok: 1 }));
    app.get('/api/admin/y', (_req, res) => void res.json({ ok: 2 }));
    await withServer(app, async (base) => {
      expect((await fetch(`${base}/api/admin/x`)).status).toBe(200);
      expect((await fetch(`${base}/api/admin/y`)).status).toBe(200);
      const blocked = await fetch(`${base}/api/admin/x`);
      expect(blocked.status).toBe(429);
      expect(await blocked.json()).toEqual({ error: 'slow down' });
    });
  });
});
