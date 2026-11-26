// @vitest-environment node
// বাংলা মন্তব্য: Express-এর ভেতরে Hono mount — পাথ রাউটিং, body অক্ষত থাকা, আর পুরনো Express রুট অক্ষত থাকা
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountApiOnExpress } from './node';

async function withServer(
  setup: (app: express.Express) => void,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const app = express();
  setup(app);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mountApiOnExpress', () => {
  it('routes migrated paths to Hono and leaves everything else to Express', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let mounted: string[] = [];

    await withServer(
      (app) => {
        // বাংলা মন্তব্য: server.ts-এর মতো — আগের middleware-এর হেডার Hono response-এ টিকে থাকবে
        app.use((_req, res, next) => {
          res.setHeader('X-Content-Type-Options', 'nosniff');
          next();
        });
        mounted = mountApiOnExpress(app, { env: {} });
        app.use(express.json());
        app.post('/api/legacy/echo', (req, res) => {
          res.json({ got: req.body });
        });
      },
      async (baseUrl) => {
        expect(mounted).toContain('/api/telemetry/client-error');

        // Hono রুট: express.json()-এর আগে mount বলে body অক্ষত পৌঁছায়
        const sink = await fetch(`${baseUrl}/api/telemetry/client-error`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'boom-from-node', source: 'test' }),
        });
        expect(sink.status).toBe(204);
        expect(sink.headers.get('x-content-type-options')).toBe('nosniff');
        expect(String(warn.mock.calls[0]?.[1])).toContain('boom-from-node');

        const wrongMethod = await fetch(`${baseUrl}/api/telemetry/client-error`);
        expect(wrongMethod.status).toBe(405);

        // পুরনো Express রুট আগের মতোই JSON body পায়
        const legacy = await fetch(`${baseUrl}/api/legacy/echo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ok: 1 }),
        });
        expect(await legacy.json()).toEqual({ got: { ok: 1 } });

        // অজানা পাথ Hono ধরে না — Express-এর ডিফল্ট 404
        const unknown = await fetch(`${baseUrl}/api/not-migrated`);
        expect(unknown.status).toBe(404);
        expect(await unknown.text()).toContain('Cannot GET');
      }
    );
  });
});
