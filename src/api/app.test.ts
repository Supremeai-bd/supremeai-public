// @vitest-environment node
// বাংলা মন্তব্য: unified Hono API — রানটাইম-নিরপেক্ষ হ্যান্ডলার টেস্ট (app.request দিয়ে, নেটওয়ার্ক ছাড়া)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiApp, listApiPaths } from './app';
import { DEFAULT_RELEASE_MANIFEST } from '../config/releaseDownloads';
import { CLIENT_ERROR_MAX_BODY_BYTES } from './routes/telemetry';

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** URL-substring → response ম্যাপ; মেলে না এমন সব URL-এ 404। */
function routedFetch(routes: Record<string, unknown>) {
  return vi.fn(async (...[input]: FetchArgs) => {
    const url = String(input instanceof Request ? input.url : input);
    for (const [needle, body] of Object.entries(routes)) {
      if (url.includes(needle)) return jsonResponse(body);
    }
    return new Response('not found', { status: 404 });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createApiApp — route registry', () => {
  it('lists every concrete migrated path (used by the Express mount)', () => {
    expect(listApiPaths(createApiApp())).toEqual([
      '/api/auth/captcha-config',
      '/api/health',
      '/api/i18n/:lang',
      '/api/internal/alerts',
      '/api/models',
      '/api/packages',
      '/api/platform/config',
      '/api/releases/latest',
      '/api/share/:id',
      '/api/share/artifact',
      '/api/share/generate',
      '/api/telemetry/client-error',
    ]);
  });

  it('returns 404 for paths that are not migrated yet', async () => {
    const res = await createApiApp().request('/api/not-migrated');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/releases/latest', () => {
  it('serves the direct rolling manifest and caches it for 3 minutes', async () => {
    const fetchMock = routedFetch({
      'releases/download/latest/latest-release.json': { version: '9.1.0', tag: 'v9.1.0' },
    });
    let clock = 1_000_000;
    const app = createApiApp({ fetch: fetchMock as unknown as typeof fetch, now: () => clock });

    const first = await app.request('/api/releases/latest');
    expect(first.status).toBe(200);
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=180');
    const body = (await first.json()) as { version: string };
    expect(body.version).toBe('9.1.0');
    const callsAfterFirst = fetchMock.mock.calls.length;

    clock += 60_000;
    await app.request('/api/releases/latest');
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);

    clock += 3 * 60_000;
    await app.request('/api/releases/latest');
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('falls back to the GitHub REST release and maps platform assets', async () => {
    const fetchMock = routedFetch({
      'api.github.com/repos/': {
        tag_name: 'v3.4.5',
        published_at: '2026-11-20T00:00:00Z',
        html_url: 'https://github.com/x/y/releases/tag/v3.4.5',
        assets: [
          {
            name: 'SupremeAI_3.4.5_x64-setup.exe',
            browser_download_url: 'https://dl/exe',
            size: 10,
          },
          { name: 'SupremeAI-universal.apk', browser_download_url: 'https://dl/apk', size: 20 },
          { name: 'SupremeAI-armv7.apk', browser_download_url: 'https://dl/armv7' },
          { name: 'notes.txt', browser_download_url: 'https://dl/notes' },
        ],
      },
    });
    const app = createApiApp({ fetch: fetchMock as unknown as typeof fetch });

    const res = await app.request('/api/releases/latest', {}, { GITHUB_READONLY_TOKEN: ' tok ' });
    const body = (await res.json()) as {
      version: string;
      provenance: string;
      windowsExeUrl: string;
      androidApkUrl: string;
      androidArmv7ApkUrl: string;
      assets: Array<{ platform: string }>;
    };
    expect(body.version).toBe('3.4.5');
    expect(body.provenance).toBe('live-github');
    expect(body.windowsExeUrl).toBe('https://dl/exe');
    expect(body.androidApkUrl).toBe('https://dl/apk');
    expect(body.androidArmv7ApkUrl).toBe('https://dl/armv7');
    expect(body.assets.map((a) => a.platform)).toEqual([
      'windows-exe',
      'android-apk-arm64',
      'android-apk-armv7',
    ]);

    // বাংলা মন্তব্য: env-এর টোকেন (trim করা) শুধু GitHub REST কলে যায়
    const restCall = fetchMock.mock.calls.find(([u]) => String(u).includes('api.github.com'));
    const headers = (restCall?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('serves the bundled manifest with a shorter cache when GitHub is unreachable', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('offline');
    });
    const app = createApiApp({ fetch: fetchMock as unknown as typeof fetch });
    const res = await app.request('/api/releases/latest');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=120');
    expect(await res.json()).toEqual(DEFAULT_RELEASE_MANIFEST);
  });
});

describe('POST /api/telemetry/client-error', () => {
  const post = (body: string) =>
    createApiApp().request('/api/telemetry/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

  it('acknowledges with 204 and logs only a scrubbed summary', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post(
      JSON.stringify({
        message: 'x'.repeat(500),
        source: 'chat',
        release: 'v2.5.0',
        context: { a: 1, b: 2 },
        token: 'secret-should-not-be-logged',
      })
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const logged = JSON.parse(String(warn.mock.calls[0][1])) as Record<string, unknown>;
    expect(String(logged.message)).toHaveLength(300);
    expect(logged.release).toBe('v2.5.0');
    expect(logged.contextKeys).toEqual(['a', 'b']);
    expect(JSON.stringify(logged)).not.toContain('secret-should-not-be-logged');
  });

  it('rejects oversized reports with 413', async () => {
    const res = await post(JSON.stringify({ message: 'x'.repeat(CLIENT_ERROR_MAX_BODY_BYTES) }));
    expect(res.status).toBe(413);
  });

  it('still answers 204 for malformed JSON so the client never retries', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post('{not json');
    expect(res.status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });

  it('answers other methods with 405 + Allow: POST', async () => {
    const res = await createApiApp().request('/api/telemetry/client-error');
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');
  });
});

describe('GET /api/auth/captcha-config & GET /api/platform/config', () => {
  it('enables Turnstile only when both site and secret keys exist and rejects POST with 405', async () => {
    const app = createApiApp();
    const disabled = await app.request('/api/auth/captcha-config', {}, { TURNSTILE_SITE_KEY: 'site' });
    expect(disabled.status).toBe(200);
    await expect(disabled.json()).resolves.toEqual({
      provider: 'turnstile',
      enabled: false,
      siteKey: '',
    });

    const enabled = await app.request(
      '/api/auth/captcha-config',
      {},
      { TURNSTILE_SITE_KEY: '0xSITE', TURNSTILE_SECRET_KEY: '0xSEC' }
    );
    expect(enabled.status).toBe(200);
    expect(enabled.headers.get('Cache-Control')).toBe('public, max-age=300');
    await expect(enabled.json()).resolves.toEqual({
      provider: 'turnstile',
      enabled: true,
      siteKey: '0xSITE',
    });

    const badMethod = await app.request('/api/auth/captcha-config', { method: 'POST' });
    expect(badMethod.status).toBe(405);
  });

  it('serves canonical Edge platform config by default and live Node platform state when injected', async () => {
    const edgeApp = createApiApp();
    const edgeRes = await edgeApp.request('/api/platform/config');
    expect(edgeRes.status).toBe(200);
    const edgeJson = (await edgeRes.json()) as {
      maintenanceMode: boolean;
      plans: Record<string, unknown>;
      topupPackages: unknown[];
      modelPolicies: Record<string, { enabled: boolean }>;
    };
    expect(edgeJson.maintenanceMode).toBe(false);
    expect(Boolean(edgeJson.plans && typeof edgeJson.plans === 'object')).toBe(true);
    expect(Array.isArray(edgeJson.topupPackages)).toBe(true);
    expect(edgeJson.modelPolicies['supreme-core']?.enabled).toBe(true);

    const nodeApp = createApiApp({
      getPlatformConfig: () => ({
        status: 'maintenance',
        maintenanceMode: true,
        featureFlags: { maintenance_mode: true },
      }),
    });
    const nodeRes = await nodeApp.request('/api/platform/config');
    const nodeJson = (await nodeRes.json()) as {
      maintenanceMode: boolean;
      featureFlags: Record<string, boolean>;
      plans: Record<string, unknown>;
    };
    expect(nodeJson.maintenanceMode).toBe(true);
    expect(nodeJson.featureFlags.maintenance_mode).toBe(true);
    expect(Boolean(nodeJson.plans && typeof nodeJson.plans === 'object')).toBe(true);
  });

  it('serves GET /api/packages via unified Hono (503 when unlinked, 200 when Supabase responds)', async () => {
    const unlinked = await createApiApp().request('/api/packages');
    expect(unlinked.status).toBe(503);

    const fetchMock = routedFetch({
      '/rest/v1/credit_packages': [
        {
          id: 'pkg_starter',
          name: 'Starter',
          credits: 500,
          price_bdt: 199,
          price_usd: 2,
          active: true,
          featured: false,
          sort_order: 1,
        },
      ],
    });
    const linked = createApiApp({ fetch: fetchMock as unknown as typeof fetch });
    const res = await linked.request(
      '/api/packages',
      {},
      { SUPABASE_URL: 'https://db.example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srv-key' }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; packages: Array<{ id: string }> };
    expect(body.success).toBe(true);
    expect(body.packages[0]?.id).toBe('pkg_starter');
  });

  it('enforces Bearer ALERT_INGEST_TOKEN on POST /api/internal/alerts with timing-safe verification', async () => {
    const app = createApiApp();
    const missingAuth = await app.request('/api/internal/alerts', { method: 'POST' });
    expect(missingAuth.status).toBe(401);

    const unconfigured = await app.request('/api/internal/alerts', {
      method: 'POST',
      headers: { Authorization: 'Bearer probe-token' },
    });
    expect(unconfigured.status).toBe(503);

    const forbidden = await app.request(
      '/api/internal/alerts',
      { method: 'POST', headers: { Authorization: 'Bearer wrong-token' } },
      { ALERT_INGEST_TOKEN: 'expected-secret' }
    );
    expect(forbidden.status).toBe(403);
  });
});
