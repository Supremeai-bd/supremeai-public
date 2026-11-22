import { describe, expect, it, vi } from 'vitest';
import {
  FEDERATION_SOURCES,
  FederationSource,
  resolveFederationUrl,
} from '../config/federationSources';
import { FederationSyncEngine, FetchLike } from './federationSyncService';

const SOURCE: FederationSource = {
  id: 'test-source',
  tier: 1,
  feature: 'Test Feature',
  label: 'Test',
  description: 'Test endpoint',
  group: 'pulse',
  path: '/api/v1/health',
  origin: 'federation',
  intervalMs: 10_000,
  timeoutMs: 5_000,
  auth: 'public',
  collectionKeys: ['items'],
  metrics: [{ path: 'uptime_seconds', label: 'Uptime', unit: 's' }],
  backendModule: 'core/api/server.py',
};

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

interface MockResponseInit {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  contentType?: string;
}

function jsonResponse({
  status = 200,
  body = {},
  headers = {},
  contentType = 'application/json',
}: MockResponseInit) {
  const map = new Map<string, string>(Object.entries({ 'content-type': contentType, ...headers }));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function createEngine(options: {
  fetcher: FetchLike;
  sources?: FederationSource[];
  storage?: MemoryStorage | null;
  now?: () => number;
  credentialMissing?: (source: FederationSource) => boolean;
}) {
  const clock = { value: 1_000_000 };
  return new FederationSyncEngine({
    sources: options.sources ?? [SOURCE],
    fetcher: options.fetcher,
    storage: options.storage ?? null,
    now: options.now ?? (() => clock.value),
    random: () => 0.5,
    autoSchedule: false,
    credentialMissing: options.credentialMissing ?? (() => false),
    authResolver: () => ({}),
    maxBackoffMs: 120_000,
  });
}

describe('federation source registry', () => {
  it('has unique ids and same-origin API paths', () => {
    const ids = FEDERATION_SOURCES.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const source of FEDERATION_SOURCES) {
      expect(source.path.startsWith('/api/')).toBe(true);
      expect(source.path.includes('://')).toBe(false);
      expect(source.intervalMs).toBeGreaterThanOrEqual(5_000);
      expect(source.timeoutMs).toBeLessThanOrEqual(source.intervalMs * 2);
      expect(source.feature.length).toBeGreaterThan(0);
      expect(source.backendModule.length).toBeGreaterThan(0);
    }
  });

  it('never hardcodes provider-specific model identifiers in request paths', () => {
    for (const source of FEDERATION_SOURCES) {
      expect(source.path).not.toMatch(/gemini-|gpt-|claude-|openrouter/i);
    }
  });

  it('covers every federation domain', () => {
    const groups = new Set(FEDERATION_SOURCES.map((source) => source.group));
    for (const group of [
      'pulse',
      'gateway',
      'ecosystem',
      'agents',
      'memory',
      'infrastructure',
      'workspace',
    ]) {
      expect(groups.has(group as never)).toBe(true);
    }
  });

  it('covers all 4 importance tiers', () => {
    const tiers = new Set(FEDERATION_SOURCES.map((source) => source.tier));
    for (const tier of [1, 2, 3, 4]) {
      expect(tiers.has(tier as never)).toBe(true);
    }
  });

  it('resolves same-origin URLs with an optional base', () => {
    expect(resolveFederationUrl(SOURCE)).toBe('/api/v1/health');
    expect(resolveFederationUrl(SOURCE, 'https://api.example.com/')).toBe(
      'https://api.example.com/api/v1/health'
    );
  });
});

describe('FederationSyncEngine', () => {
  it('syncs a payload, summarises records and exposes metrics', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        body: { status: 'healthy', uptime_seconds: 42, items: [1, 2, 3] },
        headers: { etag: '"abc"' },
      })
    ) as unknown as FetchLike;

    const engine = createEngine({ fetcher });
    await engine.syncSource(SOURCE.id);

    const snapshot = engine.getSnapshot(SOURCE.id)!;
    expect(snapshot.state).toBe('ok');
    expect(snapshot.transport).toBe('network');
    expect(snapshot.httpStatus).toBe(200);
    expect(snapshot.summary.records).toBe(3);
    expect(snapshot.summary.metrics).toEqual([{ label: 'Uptime', value: 42, unit: 's' }]);
    expect(snapshot.etag).toBe('"abc"');
    expect(snapshot.latencyHistory).toHaveLength(1);
    expect(engine.getEvents().at(-1)?.state).toBe('ok');
  });

  it('sends conditional requests and keeps data on 304', async () => {
    const calls: Array<Record<string, string> | undefined> = [];
    let first = true;
    const fetcher = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
      calls.push(init?.headers);
      if (first) {
        first = false;
        return jsonResponse({ body: { items: [1, 2] }, headers: { etag: '"v1"' } });
      }
      return jsonResponse({ status: 304, body: {} });
    }) as unknown as FetchLike;

    const engine = createEngine({ fetcher });
    await engine.syncSource(SOURCE.id);
    await engine.syncSource(SOURCE.id);

    expect(calls[1]?.['If-None-Match']).toBe('"v1"');
    const snapshot = engine.getSnapshot(SOURCE.id)!;
    expect(snapshot.state).toBe('ok');
    expect(snapshot.httpStatus).toBe(304);
    expect(snapshot.summary.records).toBe(2);
    expect(snapshot.latencyHistory).toHaveLength(1);
  });

  it('single-flights concurrent syncs for the same source', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn(async () => {
      await gate;
      return jsonResponse({ body: { items: [] } });
    }) as unknown as FetchLike;

    const engine = createEngine({ fetcher });
    const a = engine.syncSource(SOURCE.id);
    const b = engine.syncSource(SOURCE.id);
    release!();
    await Promise.all([a, b]);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially after failures while keeping cached data', async () => {
    let clock = 1_000_000;
    const engineState = { fail: true };
    const fetcher = vi.fn(async () => {
      if (engineState.fail) throw new Error('Failed to fetch');
      return jsonResponse({ body: { items: [1] } });
    }) as unknown as FetchLike;

    const engine = createEngine({ fetcher, now: () => clock });
    // Seed data with an initial success.
    engineState.fail = false;
    await engine.syncSource(SOURCE.id);
    expect(engine.getSnapshot(SOURCE.id)!.state).toBe('ok');

    engineState.fail = true;
    clock += 20_000;
    await engine.syncSource(SOURCE.id);
    let snapshot = engine.getSnapshot(SOURCE.id)!;
    expect(snapshot.state).toBe('offline');
    expect(snapshot.consecutiveFailures).toBe(1);
    expect(snapshot.data).toEqual({ items: [1] });
    expect(snapshot.nextSyncAt).toBeGreaterThan(clock);

    clock += 20_000;
    await engine.syncSource(SOURCE.id);
    snapshot = engine.getSnapshot(SOURCE.id)!;
    expect(snapshot.consecutiveFailures).toBe(2);
    const firstDelay = 20_000 + 10_000 * 2;
    expect(snapshot.nextSyncAt).toBeGreaterThanOrEqual(clock + firstDelay);
  });

  it('marks sources as restricted without a network call when credentials are missing', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ body: {} })) as unknown as FetchLike;
    const engine = createEngine({ fetcher, credentialMissing: () => true });

    await engine.syncSource(SOURCE.id);

    expect(fetcher).not.toHaveBeenCalled();
    expect(engine.getSnapshot(SOURCE.id)!.state).toBe('restricted');
    expect(engine.getSnapshot(SOURCE.id)!.error).toBe('Credential required');
  });

  it('rejects HTML fallbacks instead of rendering them', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ body: '<!DOCTYPE html><html></html>', contentType: 'text/html' })
    ) as unknown as FetchLike;

    const engine = createEngine({ fetcher });
    await engine.syncSource(SOURCE.id);

    const snapshot = engine.getSnapshot(SOURCE.id)!;
    expect(snapshot.state).toBe('error');
    expect(snapshot.error).toContain('HTML');
  });

  it('classifies unmounted endpoints separately from failures', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ status: 404, body: {} })
    ) as unknown as FetchLike;
    const engine = createEngine({ fetcher });
    await engine.syncSource(SOURCE.id);
    expect(engine.getSnapshot(SOURCE.id)!.state).toBe('unsupported');
  });

  it('classifies 403 as restricted, not degraded', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ status: 403, body: {} })
    ) as unknown as FetchLike;
    const engine = createEngine({ fetcher });
    await engine.syncSource(SOURCE.id);
    expect(engine.getSnapshot(SOURCE.id)!.state).toBe('restricted');
    expect(engine.getPulse().degraded).toBe(0);
  });

  it('marks data stale once the freshness budget is exceeded', async () => {
    let clock = 1_000_000;
    const fetcher = vi.fn(async () =>
      jsonResponse({ body: { items: [1, 2] } })
    ) as unknown as FetchLike;
    const engine = createEngine({ fetcher, now: () => clock });

    await engine.syncSource(SOURCE.id);
    expect(engine.getSnapshot(SOURCE.id)!.state).toBe('ok');

    clock += SOURCE.intervalMs * 4;
    expect(engine.getSnapshot(SOURCE.id)!.state).toBe('stale');
  });

  it('hydrates cached snapshots so the UI paints before the first request', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'supremeai.federation.sync.cache.v1',
      JSON.stringify({
        version: 1,
        savedAt: 999_000,
        entries: {
          [SOURCE.id]: {
            data: { items: [1, 2, 3, 4] },
            fetchedAt: 999_000,
            latencyMs: 21,
            httpStatus: 200,
            etag: '"cached"',
            latencyHistory: [22, 21],
          },
        },
      })
    );

    const engine = new FederationSyncEngine({
      sources: [SOURCE],
      fetcher: (async () => jsonResponse({ body: {} })) as unknown as FetchLike,
      storage,
      now: () => 1_400_000,
      autoSchedule: false,
      authResolver: () => ({}),
      credentialMissing: () => true,
    });

    const snapshot = engine.getSnapshot(SOURCE.id)!;
    expect(snapshot.state).toBe('stale');
    expect(snapshot.transport).toBe('cache');
    expect(snapshot.summary.records).toBe(4);
    expect(snapshot.latencyHistory).toEqual([22, 21]);
  });

  it('persists successful syncs to storage', async () => {
    const storage = new MemoryStorage();
    const fetcher = vi.fn(async () =>
      jsonResponse({ body: { items: [1] } })
    ) as unknown as FetchLike;

    const engine = new FederationSyncEngine({
      sources: [SOURCE],
      fetcher,
      storage,
      random: () => 0.5,
      autoSchedule: false,
      authResolver: () => ({}),
      credentialMissing: () => false,
    });

    await engine.syncSource(SOURCE.id);
    // Flush the debounced persist timer.
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const cached = storage.getItem('supremeai.federation.sync.cache.v1');
    expect(cached).toBeTruthy();
    expect(cached).toContain('test-source');
  });

  it('aggregates a pulse across mixed source states', async () => {
    const failing: FederationSource = { ...SOURCE, id: 'failing', path: '/api/v1/status' };
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('/status')) return jsonResponse({ status: 500, body: {} });
      return jsonResponse({ body: { items: [1, 2] } });
    }) as unknown as FetchLike;

    const engine = createEngine({ fetcher, sources: [SOURCE, failing] });
    await engine.syncAll();

    const pulse = engine.getPulse();
    expect(pulse.total).toBe(2);
    expect(pulse.online).toBe(1);
    expect(pulse.degraded).toBe(1);
    expect(pulse.totalRecords).toBe(2);
    expect(pulse.successRate).toBe(50);
    expect(engine.getOverallStatus()).toBe('degraded');
  });

  it('does not resurrect a paused source when a late response lands', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn(async () => {
      await gate;
      return jsonResponse({ body: { items: [1] } });
    }) as unknown as FetchLike;

    const engine = createEngine({ fetcher });
    const inFlight = engine.syncSource(SOURCE.id);
    engine.pauseSource(SOURCE.id);
    release!();
    await inFlight;

    expect(engine.getSnapshot(SOURCE.id)!.state).toBe('paused');
    expect(engine.getPulse().online).toBe(0);
    expect(engine.getPulse().paused).toBe(1);
  });

  it('exports a diagnostic bundle with payloads and events', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ body: { items: [1, 2] } })
    ) as unknown as FetchLike;
    const engine = createEngine({ fetcher });
    await engine.syncSource(SOURCE.id);

    const bundle = engine.exportBundle();
    expect(bundle.repository).toBe('Supremeai-bd/supremeai');
    expect(bundle.sources[0].path).toBe('/api/v1/health');
    expect(bundle.sources[0].records).toBe(2);
    expect(bundle.events.length).toBeGreaterThan(0);
  });

  it('invokes global fetch without binding `this` to the engine instance', async () => {
    const strictFetch = vi.fn(async function (this: unknown) {
      // বাংলা মন্তব্য: ব্রাউজারের Window.fetch-এর মতো `this` ইঞ্জিন ইনস্ট্যান্স হলে Illegal invocation ছুঁড়ে দেবে।
      if (this instanceof FederationSyncEngine) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return jsonResponse({ body: { status: 'ok' } });
    });

    vi.stubGlobal('fetch', strictFetch);
    try {
      const engine = new FederationSyncEngine({
        sources: [SOURCE],
        storage: null,
        autoSchedule: false,
        credentialMissing: () => false,
        authResolver: () => ({}),
      });
      await engine.syncSource(SOURCE.id);

      const snapshot = engine.getSnapshot(SOURCE.id)!;
      expect(snapshot.state).toBe('ok');
      expect(snapshot.error).toBeNull();
      expect(strictFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
