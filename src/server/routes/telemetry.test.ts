// @vitest-environment node
// বাংলা মন্তব্য: models ও billing-এর বিদ্যমান shared catalog cache contract।
import { describe, expect, it, vi } from 'vitest';
import { createGatewayCatalogFetcher } from './telemetry';

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });

describe('Node gateway catalog cache', () => {
  it('৬০ সেকেন্ডে cache hit, expiry-তে নতুন fetch এবং path অনুযায়ী আলাদা cache', async () => {
    let time = 0;
    const fetchMock = vi.fn(async () => json({ n: time }));
    const get = createGatewayCatalogFetcher('https://gateway.example', {
      fetch: fetchMock as typeof fetch,
      now: () => time,
    });
    expect(await get('/api/v1/models')).toEqual({ n: 0 });
    time = 59_999;
    expect(await get('/api/v1/models')).toEqual({ n: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await get('/api/v1/plans');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    time = 60_000;
    expect(await get('/api/v1/models')).toEqual({ n: time });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]).toEqual([
      'https://gateway.example/api/v1/models',
      { headers: { Accept: 'application/json' }, signal: expect.any(AbortSignal) },
    ]);
  });

  it.each(['http', 'network', 'json'])(
    'expiry-র পরে %s failure হলে stale data রাখে',
    async (failure) => {
      let time = 0;
      const fetchMock = vi.fn(async () => {
        if (!time) return json({ models: {} });
        if (failure === 'network') throw new Error('offline');
        return failure === 'http'
          ? new Response('', { status: 503 })
          : new Response('invalid-json');
      });
      const get = createGatewayCatalogFetcher('https://gateway.example', {
        fetch: fetchMock as typeof fetch,
        now: () => time,
      });
      await get('/models');
      time = 60_001;
      expect(await get('/models')).toEqual({ models: {} });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  );

  it('cold failure-এ null এবং custom TTL মানে', async () => {
    let time = 0;
    const fetchMock = vi.fn(async () =>
      time === 0 ? new Response('', { status: 503 }) : json({ ok: true })
    );
    const get = createGatewayCatalogFetcher('https://gateway.example', {
      fetch: fetchMock as typeof fetch,
      now: () => time,
    });
    expect(await get('/plans', 100)).toBeNull();
    time = 1;
    await get('/plans', 100);
    time = 100;
    await get('/plans', 100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    time = 101;
    await get('/plans', 100);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('আলাদা server instance-এ cache share হয় না', async () => {
    const a = createGatewayCatalogFetcher('https://one.example', {
      fetch: vi.fn(async () => json('one')) as typeof fetch,
    });
    const b = createGatewayCatalogFetcher('https://two.example', {
      fetch: vi.fn(async () => json('two')) as typeof fetch,
    });
    expect(await a('/models')).toBe('one');
    expect(await b('/models')).toBe('two');
  });
});
