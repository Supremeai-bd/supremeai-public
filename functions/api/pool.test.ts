// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from './pool/[[path]]';

const GROQ_KEY = 'gsk_' + 'c'.repeat(52);
const STORAGE_ENV = {
  SUPABASE_URL: 'https://db.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  POOL_ENCRYPTION_KEY: 'pool-secret-0123456789',
};

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(handler: Handler) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input instanceof Request ? input.url : input), init)
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('functions/api/pool — লিমিট বাড়ান API', () => {
  it('ব্যাকএন্ডে রাউট না থাকলে edge ম্যানিফেস্ট দেয়', async () => {
    mockFetch(() => json({ detail: 'Not Found' }, 404));
    const res = await onRequest({
      env: {},
      request: new Request('https://app.test/api/pool/providers'),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: Array<{ id: string }>; source: string };
    expect(body.source).toBe('edge');
    expect(body.providers.some((p) => p.id === 'gemini')).toBe(true);
  });

  it('ব্যাকএন্ড চালু থাকলে তার উত্তরই যায় (passthrough)', async () => {
    mockFetch(() => json({ user_id: 'u1', valid_keys_count: 3, daily_bonus_tokens: 300000 }));
    const res = await onRequest({
      env: {},
      request: new Request('https://app.test/api/pool/quota', {
        headers: { Authorization: 'Bearer test-user-session' },
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ daily_bonus_tokens: 300000 });
  });

  it('লগইন ছাড়া 401', async () => {
    mockFetch(() => json({}, 404));
    const res = await onRequest({
      env: STORAGE_ENV,
      request: new Request('https://app.test/api/pool/keys'),
    });
    expect(res.status).toBe(401);
  });

  it('স্টোরেজ কনফিগার না থাকলে স্পষ্ট 503 (ভুয়া সফল নয়)', async () => {
    mockFetch(() => json({}, 404));
    const res = await onRequest({
      env: {},
      request: new Request('https://app.test/api/pool/keys', {
        headers: { Authorization: 'Bearer test-user-session' },
      }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'pool_storage_not_configured' });
  });

  it('কী যোগ: যাচাই → এনক্রিপ্ট করে Supabase-এ রাখে, কাঁচা কী কোথাও যায় না', async () => {
    let inserted: Record<string, unknown> | null = null;
    const spy = mockFetch(async (url, init) => {
      if (url.startsWith('https://db.supabase.test/rest/v1/user_contributed_api_keys')) {
        if (init?.method === 'POST') {
          inserted = JSON.parse(String(init.body));
          return new Response(null, { status: 201 });
        }
        if (url.includes('key_fingerprint=')) return json([]);
        return json(inserted ? [{ ...inserted }] : []);
      }
      if (url.startsWith('https://db.supabase.test/rest/v1/user_bonus_quotas')) {
        return new Response(null, { status: 201 });
      }
      if (url === 'https://api.groq.com/openai/v1/models') return json({ data: [] });
      return json({ detail: 'Not Found' }, 404); // Render upstream
    });

    const res = await onRequest({
      env: STORAGE_ENV,
      request: new Request('https://app.test/api/pool/contribute', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-user-session', 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'groq', api_key: GROQ_KEY }),
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: 'accepted',
      provider: 'groq',
      bonus_earned: 100000,
    });
    expect(inserted).not.toBeNull();
    const row = inserted as unknown as Record<string, string>;
    expect(row.encrypted_key.startsWith('edge-aesgcm:v1:')).toBe(true);
    expect(row.key_hint).toBe('gsk_••••cccc');
    expect(JSON.stringify(row)).not.toContain(GROQ_KEY);
    // কাঁচা কী শুধু প্রোভাইডারের যাচাই-এন্ডপয়েন্টে গেছে, আর কোথাও না
    for (const [input, init] of spy.mock.calls) {
      const target = String(input);
      if (target === 'https://api.groq.com/openai/v1/models') continue;
      if (target.startsWith('https://app.test') || target.includes('/api/pool/contribute'))
        continue;
      expect(String(init?.body ?? '')).not.toContain(GROQ_KEY);
    }
  });

  it('ভুল ফরম্যাট 400, প্রোভাইডার প্রত্যাখ্যান করলে 400', async () => {
    mockFetch((url) => {
      if (url.includes('supabase.test')) return json([]);
      if (url === 'https://api.groq.com/openai/v1/models') return json({}, 401);
      return json({}, 404);
    });
    const send = (key: string) =>
      onRequest({
        env: STORAGE_ENV,
        request: new Request('https://app.test/api/pool/contribute', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-user-session',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ provider: 'groq', api_key: key }),
        }),
      });
    expect((await send('gsk_short')).status).toBe(400);
    const rejected = await send(GROQ_KEY);
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ detail: expect.stringContaining('rejected') });
  });
});
