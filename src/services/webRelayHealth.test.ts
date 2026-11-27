import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatService } from './chatService';
import {
  WEB_RELAY_COOLDOWN_MS,
  isWebRelayDown,
  isWebRelayFailure,
  markWebRelayDown,
  resetWebRelayHealth,
} from './webRelayHealth';

function sse(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(f));
      c.close();
    },
  });
}

const okStream = (text: string) =>
  new Response(
    sse([`data: {"choices":[{"delta":{"content":"${text}"}}]}\n\n`, 'data: [DONE]\n\n']),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }
  );

const relayDown = () =>
  new Response(JSON.stringify({ detail: 'Stealth Webhook relay is unavailable' }), {
    status: 502,
    headers: { 'Content-Type': 'application/json' },
  });

const baseOptions = () => ({
  model: 'supremeai-web',
  messages: [{ id: 'm1', role: 'user' as const, content: 'today news', timestamp: 1 }],
});

describe('webRelayHealth', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    resetWebRelayHealth();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('recognises the gateway relay-down messages only', () => {
    expect(isWebRelayFailure('Stealth Webhook relay is unavailable')).toBe(true);
    expect(isWebRelayFailure('Stealth Webhook relay is currently unconfigured')).toBe(true);
    expect(isWebRelayFailure('Webhook relay is currently offline or unreachable.')).toBe(true);
    expect(isWebRelayFailure('Server is temporarily rate-limited (429).')).toBe(false);
    expect(isWebRelayFailure('')).toBe(false);
  });

  it('opens the circuit for the cooldown window', () => {
    const now = 1_000_000;
    expect(isWebRelayDown(now)).toBe(false);
    markWebRelayDown(now);
    expect(isWebRelayDown(now + 1000)).toBe(true);
    expect(isWebRelayDown(now + WEB_RELAY_COOLDOWN_MS + 1)).toBe(false);
  });

  it('retries a failed relay request once on the API pool — the user sees the answer, not the error', async () => {
    const models: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('/api/health')) return new Response('{}', { status: 200 });
      const body = JSON.parse(String(init?.body || '{}'));
      models.push(body.model);
      return body.model === 'supremeai-web' ? relayDown() : okStream('pool answer');
    });

    const onError = vi.fn();
    const metas: unknown[] = [];
    let done = '';
    await chatService.streamChat({
      ...baseOptions(),
      onChunk: () => {},
      onMeta: (m) => metas.push(m.routeMeta),
      onDone: (t) => {
        done = t;
      },
      onError,
    });

    expect(onError).not.toHaveBeenCalled();
    expect(done).toBe('pool answer');
    expect(models[0]).toBe('supremeai-web');
    expect(models.at(-1)).toBe('supremeai-api');
    expect(metas).toContainEqual(expect.objectContaining({ poolType: 'api-pool' }));
    expect(isWebRelayDown()).toBe(true);
  });

  it('skips the relay entirely while the circuit is open', async () => {
    markWebRelayDown();
    const models: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      models.push(JSON.parse(String(init?.body || '{}')).model);
      return okStream('fast');
    });
    let done = '';
    await chatService.streamChat({
      ...baseOptions(),
      onChunk: () => {},
      onDone: (t) => {
        done = t;
      },
      onError: (e) => {
        throw e;
      },
    });
    expect(models).toEqual(['supremeai-api']);
    expect(done).toBe('fast');
  });

  it('still surfaces non-relay errors unchanged', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ detail: 'Quota exceeded for this account' }), { status: 402 })
    );
    const onError = vi.fn();
    await chatService.streamChat({
      ...baseOptions(),
      onChunk: () => {},
      onDone: () => {},
      onError,
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0].message)).toContain('Quota exceeded');
    expect(isWebRelayDown()).toBe(false);
  });
});
