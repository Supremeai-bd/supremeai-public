import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest as stateHandler } from './state';
import { onRequest as streamHandler } from './stream';

describe('Cloudflare Edge Cross-Platform Sync (/api/v1/sync/*)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns guest local-only state when unauthenticated', async () => {
    const res = await stateHandler({
      request: new Request('https://supremeai-studio.pages.dev/api/v1/sync/state'),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; envelopes: unknown[] };
    expect(body.status).toBe('guest');
    expect(body.envelopes).toEqual([]);
  });

  it('persists and retrieves cross-platform sync envelopes via preferences fallback when upstream sync route is 404', async () => {
    let savedPreferences: Record<string, unknown> = {};

    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.endsWith('/api/v1/sync/state')) {
        return new Response('Not found', { status: 404 });
      }
      if (url.endsWith('/api/v1/user/preferences') && method === 'GET') {
        return new Response(
          JSON.stringify({ user_id: 'u@test.com', preferences: savedPreferences }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/api/v1/user/preferences') && method === 'POST') {
        const patch = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        savedPreferences = { ...savedPreferences, ...patch };
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const postReq = new Request('https://supremeai-studio.pages.dev/api/v1/sync/state', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok_live_user_sync',
        Origin: 'http://tauri.localhost',
      },
      body: JSON.stringify({
        protocolVersion: '1.0.0',
        domain: 'models',
        deviceId: 'dev-desktop-1',
        platform: 'desktop',
        updatedAt: 1700000000000,
        revision: 1,
        payload: { selectedModelId: 'supreme-deep', autoModelRouting: false },
      }),
    });

    const postRes = await stateHandler({ request: postReq });
    expect(postRes.status).toBe(200);
    expect(postRes.headers.get('Access-Control-Allow-Origin')).toBe('http://tauri.localhost');

    const getReq = new Request('https://supremeai-studio.pages.dev/api/v1/sync/state', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer tok_live_user_sync',
        Origin: 'vscode-webview://supremeai-chat',
      },
    });
    const getRes = await stateHandler({ request: getReq });
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Access-Control-Allow-Origin')).toBe(
      'vscode-webview://supremeai-chat'
    );
    const getJson = (await getRes.json()) as {
      envelopes: Array<{ domain: string; payload: { selectedModelId: string } }>;
    };
    expect(getJson.envelopes).toHaveLength(1);
    expect(getJson.envelopes[0].domain).toBe('models');
    expect(getJson.envelopes[0].payload.selectedModelId).toBe('supreme-deep');

    // Also verify Edge SSE stream emits snapshot frames cleanly
    const streamRes = await streamHandler({
      request: new Request(
        'https://supremeai-studio.pages.dev/api/v1/sync/stream?platform=android&device_id=dev-android-1',
        { headers: { Authorization: 'Bearer tok_live_user_sync' } }
      ),
    });
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get('Content-Type')).toContain('text/event-stream');
    const streamText = await streamRes.text();
    expect(streamText).toContain('event: connected');
    expect(streamText).toContain('supreme-deep');
  });
});
