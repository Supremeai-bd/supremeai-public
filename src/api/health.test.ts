// @vitest-environment node
// বাংলা মন্তব্য: একই health contract — Hono, Pages ও Express-এ নিরাপত্তা ও HEAD যাচাই।
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createApiApp } from './app';
import { mountApiOnExpress } from './node';
import { onRequest } from '../../functions/api/health';
import { CANONICAL_SERVER_MODELS } from '../shared/platformCatalog';
import { PLAN_CATALOG } from '../config/plans';
import { version } from '../../package.json';

const URL = 'https://supremeai-studio.pages.dev/api/health';

describe('একীভূত health contract', () => {
  it.each([undefined, '', '   ', 'configured-test-value'])(
    'env %j অনুযায়ী নিরাপদ metadata দেয়',
    async (key) => {
      const response = await createApiApp().request(URL, {}, { GEMINI_API_KEY: key });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        status: 'healthy',
        version: `v${version}`,
        modelsCount: Object.keys(CANONICAL_SERVER_MODELS).length,
        plans: PLAN_CATALOG,
        repositories: { studio: 'https://github.com/Supremeai-bd/supremeai-public' },
        providerReadiness: key?.trim() ? 'ready' : 'relay-only',
      });
      expect(body).not.toHaveProperty('hasApiKey');
      expect(JSON.stringify(body)).not.toContain('configured-test-value');
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  );

  it('HEAD-এ body নেই এবং অননুমোদিত method-এ 405 দেয়', async () => {
    const app = createApiApp();
    const head = await app.request(URL, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const post = await app.request(URL, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });

  it('Pages wrapper একই payload ও allowlisted CORS রাখে', async () => {
    const request = new Request(URL, { headers: { Origin: 'http://localhost:5173' } });
    const env = { GEMINI_API_KEY: 'configured-test-value' };
    const edge = await onRequest({ request, env });
    const hono = await createApiApp().request(URL, {}, env);
    expect(await edge.json()).toEqual(await hono.json());
    expect(edge.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    const preflight = await onRequest({ request: new Request(URL, { method: 'OPTIONS' }), env });
    expect(preflight.status).toBe(204);
  });

  it('Express adapter একই metadata দেয় এবং HEAD-এ body বাদ দেয়', async () => {
    const app = express();
    mountApiOnExpress(app, { env: { GEMINI_API_KEY: 'configured-test-value' } });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`;
    try {
      const response = await fetch(base);
      const expected = await createApiApp().request(
        URL,
        {},
        { GEMINI_API_KEY: 'configured-test-value' }
      );
      expect(await response.json()).toEqual(await expected.json());
      expect(response.headers.get('cache-control')).toBe('no-store');
      const head = await fetch(base, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
