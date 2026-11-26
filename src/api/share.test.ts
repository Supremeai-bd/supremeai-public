// @vitest-environment node
// বাংলা মন্তব্য: stateless share round-trip, malformed input, সীমা ও দুই adapter-এর parity।
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createApiApp } from './app';
import { mountApiOnExpress } from './node';
import { onRequest as shareEdge } from '../../functions/api/share/[[path]]';
import { onRequest as artifactEdge } from '../../functions/api/share/artifact';

const ORIGIN = 'https://supremeai-studio.pages.dev';
const MAX = 1024 * 1024;
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function unpack(token: string) {
  return JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
}

describe('একীভূত share routes', () => {
  it('বাংলা/emoji conversation round-trip ও public link contract রাখে', async () => {
    const app = createApiApp({ now: () => 1000 });
    const messages = [{ role: 'user', content: 'কেমন আছ? 🌼' }];
    const generated = await app.request(
      `${ORIGIN}/api/share/generate`,
      post({ title: 'আলাপ', content: 'হ্যালো 🌏', messages })
    );
    expect(generated.status).toBe(200);
    expect(generated.headers.get('cache-control')).toBe('no-store');
    const body = await generated.json();
    expect(body.mode).toBe('edge-stateless');
    expect(body.share_url).toBe(`${ORIGIN}/?share=${body.id}#chat`);
    expect(unpack(body.id)).toEqual({
      title: 'আলাপ',
      content: 'হ্যালো 🌏',
      messages,
      createdAt: new Date(1000).toISOString(),
    });
    const read = await app.request(`${ORIGIN}/api/share/${body.id}`);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      id: body.id,
      title: 'আলাপ',
      content: 'হ্যালো 🌏',
      status: 'ok',
    });
  });

  it('খালি object-এ conversation defaults রাখে', async () => {
    const res = await createApiApp().request(`${ORIGIN}/api/share/generate`, post({}));
    expect(unpack((await res.json()).id)).toMatchObject({
      title: 'Shared Conversation',
      content: '',
      messages: [],
    });
  });

  it.each([
    null,
    [],
    'bad',
    { title: 2 },
    { content: {} },
    { messages: 'bad' },
    { conversation_id: 'stored-id' },
  ])('ভুল conversation input %j-এ 400', async (body) => {
    const res = await createApiApp().request(`${ORIGIN}/api/share/generate`, post(body));
    expect(res.status).toBe(400);
  });

  it('malformed JSON-এ 400 এবং oversized request-এ 413 দেয়', async () => {
    const app = createApiApp();
    expect(
      (await app.request(`${ORIGIN}/api/share/generate`, { method: 'POST', body: '{' })).status
    ).toBe(400);
    expect(
      (await app.request(`${ORIGIN}/api/share/generate`, post({ content: 'x'.repeat(MAX) }))).status
    ).toBe(413);
  });

  it('artifact POST-এও একই actual-byte সীমা প্রযোজ্য', async () => {
    const res = await createApiApp().request(
      `${ORIGIN}/api/share/artifact`,
      post({ code: 'x'.repeat(MAX) })
    );
    expect(res.status).toBe(413);
  });

  it('ঠিক 1 MiB JSON body গ্রহণ করে', async () => {
    const content = 'x'.repeat(MAX - JSON.stringify({ content: '' }).length);
    const res = await createApiApp().request(`${ORIGIN}/api/share/generate`, post({ content }));
    expect(res.status).toBe(200);
  });

  it('মিথ্যা ছোট Content-Length দিয়েও byte limit পাশ কাটানো যায় না', async () => {
    const init = post({ content: 'বাংলা'.repeat(MAX / 4) });
    init.headers = { 'Content-Length': '1', 'Content-Type': 'application/json' };
    expect((await createApiApp().request(`${ORIGIN}/api/share/generate`, init)).status).toBe(413);
  });

  it.each([
    '%ZZ',
    '%%%25',
    'not-a-valid-share',
    Buffer.from('null').toString('base64url'),
    Buffer.from('[]').toString('base64url'),
  ])('ভাঙা token %s-এ 404, 500 নয়', async (token) => {
    const res = await createApiApp().request(`${ORIGIN}/api/share/${token}`);
    expect(res.status).toBe(404);
    expect((await res.json()).status).toBe('not_found');
  });

  it('artifact-এর link, timestamp, language ও UTF-8 code অক্ষত থাকে', async () => {
    const res = await createApiApp({ now: () => 1000 }).request(
      `${ORIGIN}/api/share/artifact`,
      post({ code: '<h1>বাংলা 🌼</h1>', lang: 'HTML', title: 'অ্যাপ', createdAt: 123 })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(`art_${(1000).toString(36)}`);
    expect(body.mode).toBe('edge-permalink');
    const token = new URL(body.share_url).searchParams.get('artifact')!;
    expect(unpack(token)).toEqual({
      code: '<h1>বাংলা 🌼</h1>',
      lang: 'html',
      title: 'অ্যাপ',
      createdAt: 123,
    });
  });

  it.each([
    null,
    {},
    { code: ' ' },
    { code: 9 },
    { code: 'ok', lang: 4 },
    { code: 'ok', createdAt: 'bad' },
  ])('ভুল artifact %j-এ 400', async (body) => {
    expect((await createApiApp().request(`${ORIGIN}/api/share/artifact`, post(body))).status).toBe(
      400
    );
  });

  it('readiness/HEAD ও unsupported method-এর স্পষ্ট contract দেয়', async () => {
    const app = createApiApp();
    const get = await app.request(`${ORIGIN}/api/share/artifact`);
    expect(await get.json()).toEqual({ status: 'ok', mode: 'edge-permalink' });
    const head = await app.request(`${ORIGIN}/api/share/artifact`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect((await app.request(`${ORIGIN}/api/share/artifact`, { method: 'DELETE' })).status).toBe(
      405
    );
    expect((await app.request(`${ORIGIN}/api/share/generate`)).status).toBe(405);
  });

  it('Pages wrappers preflight ও custom CORS env allowlist পায়', async () => {
    const env = { ALLOWED_ORIGINS: 'https://client.example' };
    const request = new Request(`${ORIGIN}/api/share/artifact`, {
      headers: { Origin: 'https://client.example' },
    });
    const res = await artifactEdge({ request, env });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://client.example');
    const preflight = await shareEdge({
      request: new Request(`${ORIGIN}/api/share/generate`, { method: 'OPTIONS' }),
      env,
    });
    expect(preflight.status).toBe(204);
  });

  it('Express-এ dynamic token route ও raw JSON body পৌঁছায়', async () => {
    const app = express();
    mountApiOnExpress(app, { api: createApiApp({ now: () => 1000 }), env: {} });
    app.use(express.json());
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const res = await fetch(`${origin}/api/share/generate`, post({ content: 'Node বাংলা' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.share_url).toBe(`${origin}/?share=${body.id}#chat`);
      const read = await fetch(`${origin}/api/share/${body.id}`);
      expect(read.status).toBe(200);
      expect((await read.json()).content).toBe('Node বাংলা');
      const artifact = await fetch(`${origin}/api/share/artifact`, post({ code: '<h1>Hi</h1>' }));
      expect(artifact.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
