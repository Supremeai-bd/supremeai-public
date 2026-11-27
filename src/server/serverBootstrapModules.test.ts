// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import {
  buildInfisicalVaultKeys,
  createInfisicalExtraVaultKeys,
  createProviderMesh,
  maskServerSecret,
  probeProviderUpstream,
} from './providerRegistry';
import {
  createAuditSeed,
  createBlockedIpsSeed,
  createPlatformConfig,
  createRuntimeFeatureFlags,
  loadDurablePlatformState,
} from './platformState';
import { createCustomerDirectorySeed } from './userDirectory';
import { FEDERATION_PROXY_HOP_HEADERS, registerFederationProxy } from './federationProxy';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mountFrontend, registerErrorHandler } from './frontendServing';
import { getSessionSigningSecret } from './userDirectory';

describe('server.ts bootstrap modules (split from server.ts)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('provider registry: masks keys, seeds a fresh mesh per call, maps vault rows', () => {
    expect(maskServerSecret('')).toBe('Not configured in server environment');
    expect(maskServerSecret('abcdefghijklmnop')).toBe('abcdef••••••••••••••••mnop');
    vi.stubEnv('GEMINI_API_KEY', 'AIzaSyTESTKEY1234567890');
    const a = createProviderMesh();
    const b = createProviderMesh();
    expect(a).not.toBe(b);
    const gemini = a.find((p) => p.provider === 'google_ai_studio')!;
    expect(gemini.status).toBe('healthy');
    expect(gemini.maskedKey).not.toContain('TESTKEY');
    expect(createInfisicalExtraVaultKeys(true)).toEqual([]);
    const vault = buildInfisicalVaultKeys(a, createInfisicalExtraVaultKeys(false));
    expect(vault.length).toBe(a.length + 3);
    expect(vault[0].secretName).toBe('GEMINI_API_KEY');
  });

  it('provider probe: unknown provider is reported without a network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await probeProviderUpstream('nope', 'k');
    expect(r.status).toBe('unhealthy');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('production seeds are empty; dev seeds are present', () => {
    expect(createAuditSeed(true)).toEqual([]);
    expect(createBlockedIpsSeed(true)).toEqual([]);
    expect(createCustomerDirectorySeed(true)).toEqual([]);
    expect(createAuditSeed(false).length).toBeGreaterThan(0);
    expect(createCustomerDirectorySeed(false).length).toBeGreaterThan(0);
    expect(createRuntimeFeatureFlags().maintenance_mode).toBe(false);
  });

  it('durable loader mutates the live objects IN PLACE (routes hold references)', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body = url.includes('platform_settings')
          ? [
              {
                value: {
                  blockedIps: [{ ip: '1.2.3.4', reason: 'x', date: 'now' }],
                  runtimeFeatureFlags: { maintenance_mode: true },
                  platformConfig: { allowNewSignups: false },
                },
              },
            ]
          : [];
        return new Response(JSON.stringify(body), { status: 200 });
      })
    );
    const state = {
      blockedIps: createBlockedIpsSeed(false),
      runtimeFeatureFlags: createRuntimeFeatureFlags(),
      platformConfig: createPlatformConfig(),
      auditRecords: createAuditSeed(false),
    };
    const refs = { ...state };
    await loadDurablePlatformState(state);
    expect(state.blockedIps).toBe(refs.blockedIps);
    expect(state.blockedIps).toEqual([{ ip: '1.2.3.4', reason: 'x', date: 'now' }]);
    expect(state.runtimeFeatureFlags).toBe(refs.runtimeFeatureFlags);
    expect(state.runtimeFeatureFlags.maintenance_mode).toBe(true);
    expect(state.platformConfig.allowNewSignups).toBe(false);
  });

  it('federation proxy forwards unknown /api paths as JSON 502 (never HTML) and strips hop headers', async () => {
    expect(FEDERATION_PROXY_HOP_HEADERS.has('host')).toBe(true);
    const app = express();
    app.use(express.json());
    registerFederationProxy(app, { gatewayBase: 'http://127.0.0.1:9' });
    registerErrorHandler(app, true);
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/api/unknown-surface`);
      expect(res.status).toBe(502);
      expect(res.headers.get('content-type')).toContain('application/json');
      const json = (await res.json()) as { error: string; upstreamPath: string };
      expect(json.error).toBe('Federation upstream unreachable');
      expect(json.upstreamPath).toBe('/api/unknown-surface');
    } finally {
      server.close();
    }
  });

  it('production SPA fallback serves index.html from memory; missing dist → 404', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-'));
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<!doctype html><title>SPA</title>');
    const serve = async (rootDir: string, url: string) => {
      const app = express();
      mountFrontend(app, { isProduction: true, rootDir });
      registerErrorHandler(app, true);
      const server = app.listen(0);
      try {
        const { port } = server.address() as AddressInfo;
        return await fetch(`http://127.0.0.1:${port}${url}`);
      } finally {
        server.close();
      }
    };
    const ok = await serve(root, '/settings/appearance');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('text/html');
    expect(await ok.text()).toContain('<title>SPA</title>');
    const missing = await serve(path.join(root, 'nope'), '/settings');
    expect(missing.status).toBe(404);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('session signing secret is stable across calls (exclusive create, no TOCTOU)', () => {
    vi.stubEnv('AUTH_TOKEN_SECRET', '');
    vi.stubEnv('SESSION_SECRET', '');
    const a = getSessionSigningSecret();
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(getSessionSigningSecret()).toBe(a);
  });
});
