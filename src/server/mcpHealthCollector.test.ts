// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TOWER = 'https://tower.test';
const BACKEND = 'https://backend.test';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

const mcpStatusPayload = {
  timestamp: '2026-11-26T10:00:00.000Z',
  health: {
    groq: {
      status: 'ok',
      latencyMs: 120,
      checkedAt: '2026-11-26T09:59:00.000Z',
      consecutiveFailures: 0,
      evidence: { summary: 'chat completion probe ok' },
    },
    junk: null,
  },
  system: {
    services: [
      { id: 'render', displayName: 'Render Core', provider: 'render', available: true },
      null,
      'not-a-service',
    ],
  },
};

function installFetchMock() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const origin = new URL(url).origin;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    if (url === `${TOWER}/health`) {
      return jsonResponse({
        status: 'ok',
        services: { healthy: 4, total: 5 },
        sweepCompletions: 17,
        lastCompletedSweepAt: '2026-11-26T09:58:00.000Z',
      });
    }
    if (url === `${BACKEND}/healthz`) {
      return jsonResponse({ status: 'ok', version: '9.9.9', chat_ready: true });
    }
    if (origin === 'https://api.github.com') {
      return jsonResponse({ sha: 'abc123' });
    }
    if (origin === TOWER && body?.method === 'initialize') {
      return jsonResponse(
        { jsonrpc: '2.0', id: 1, result: {} },
        { headers: { 'mcp-session-id': 'sess-1' } }
      );
    }
    if (origin === TOWER && body?.method === 'notifications/initialized') {
      return new Response(null, { status: 202 });
    }
    if (origin === TOWER && body?.method === 'tools/call') {
      // Streamable HTTP transport answers with an SSE frame.
      const frame = {
        jsonrpc: '2.0',
        id: body.id,
        result: { content: [{ type: 'text', text: JSON.stringify(mcpStatusPayload) }] },
      };
      return new Response(`event: message\ndata: ${JSON.stringify(frame)}\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('collectLiveServiceHealth', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('SUPREMEAI_MCP_TOWER_URL', `${TOWER}/mcp`);
    vi.stubEnv('SUPREMEAI_MCP_TOWER_ORIGIN', TOWER);
    vi.stubEnv('SUPREMEAI_MCP_HEALTH_URL', `${TOWER}/health`);
    vi.stubEnv('SUPREMEAI_BACKEND_URL', BACKEND);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('maps tower, backend and MCP status payloads into service metrics', async () => {
    installFetchMock();
    const { collectLiveServiceHealth } = await import('./mcpHealthCollector');

    const snapshot = await collectLiveServiceHealth(true);

    expect(snapshot.sweepCompletions).toBe(17);
    expect(snapshot.lastTowerSweepAt).toBe('2026-11-26T09:58:00.000Z');

    const ids = snapshot.services.map((svc) => svc.id);
    // Non-object rows in `health` / `system.services` are skipped instead of crashing.
    expect(ids).not.toContain('junk');
    expect(snapshot.services.every((svc) => typeof svc.id === 'string' && svc.id)).toBe(true);

    const groq = snapshot.services.find(
      (svc) => svc.evidenceSummary === 'chat completion probe ok'
    );
    expect(groq).toBeDefined();
    expect(groq?.latencyMs).toBe(120);
    expect(groq?.status).toBe('healthy');

    const render = snapshot.services.find((svc) => svc.displayName === 'Render Core');
    expect(render).toBeDefined();
  });

  it('survives a tower that returns non-JSON bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 }))
    );
    const { collectLiveServiceHealth } = await import('./mcpHealthCollector');

    const snapshot = await collectLiveServiceHealth(true);

    expect(Array.isArray(snapshot.services)).toBe(true);
    expect(
      snapshot.services.some((svc) => svc.evidenceSummary === 'chat completion probe ok')
    ).toBe(false);
  });
});
