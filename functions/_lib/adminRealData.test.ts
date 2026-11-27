// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  checkAdminConnections,
  listSupabaseUsers,
  mapAuthUser,
  mergeCustomers,
} from './adminRealData';
import type { VaultSummary } from './providerVault';

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const notLinked: VaultSummary = {
  engine: 'Infisical',
  connected: false,
  mode: 'not-linked',
  environment: 'prod',
  totalSecrets: 0,
  providerSecrets: 0,
  missingEnv: ['INFISICAL_CLIENT_ID'],
  lastSyncedAt: new Date(0).toISOString(),
};

describe('Supabase auth users', () => {
  it('maps an auth user to a customer row', () => {
    const row = mapAuthUser(
      {
        id: 'u1',
        email: 'rahim@example.com',
        created_at: '2026-11-20T10:00:00Z',
        last_sign_in_at: '2026-11-25T09:54:59Z',
        user_metadata: { full_name: 'Rahim' },
        app_metadata: { role: 'admin' },
      },
      0
    );
    expect(row).toMatchObject({
      id: 'u1',
      name: 'Rahim',
      email: 'rahim@example.com',
      tier: 'Free',
      status: 'active',
      joinedDate: '2026-11-20',
      isAdminEligible: true,
      source: 'supabase-auth',
    });
  });

  it('returns null (unknown) when Supabase is not configured', async () => {
    expect(await listSupabaseUsers({})).toBeNull();
  });

  it('reads the admin users API with the service key', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://db.test/auth/v1/admin/users?per_page=200');
      expect((init?.headers as Record<string, string>).apikey).toBe('svc');
      return jsonRes({
        users: [
          { id: 'a', email: 'a@x.io' },
          { id: 'b', email: 'b@x.io' },
        ],
      });
    });
    const users = await listSupabaseUsers(
      { SUPABASE_URL: 'https://db.test/', SUPABASE_SERVICE_ROLE_KEY: 'svc' },
      fetchImpl as unknown as typeof fetch
    );
    expect(users?.map((u) => u.email)).toEqual(['a@x.io', 'b@x.io']);
  });

  it('merges table rows and auth users by email', () => {
    const merged = mergeCustomers(
      [{ email: 'A@x.io', name: 'Table A' }],
      [mapAuthUser({ id: 'a', email: 'a@x.io' }, 0), mapAuthUser({ id: 'b', email: 'b@x.io' }, 1)]
    );
    expect(merged.map((m) => m.email)).toEqual(['A@x.io', 'b@x.io']);
  });
});

describe('checkAdminConnections', () => {
  it('names the exact env vars that are missing', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ status: 'ok' }));
    const list = await checkAdminConnections(
      {},
      {
        vault: notLinked,
        upstreamOrigin: 'https://api.test',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }
    );
    const byId = Object.fromEntries(list.map((c) => [c.id, c]));
    expect(byId.infisical.status).toBe('missing');
    expect(byId.infisical.missingEnv).toEqual(['INFISICAL_CLIENT_ID']);
    expect(byId.supabase.missingEnv).toEqual(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
    expect(byId.github.missingEnv).toEqual(['GITHUB_TOKEN']);
    expect(byId.cloudflare.missingEnv).toEqual(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']);
    expect(byId['mcp-tower'].missingEnv).toEqual(['SUPREMEAI_TOWER_TOKEN']);
    expect(byId['key-pool'].missingEnv).toEqual([
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'POOL_ENCRYPTION_KEY',
    ]);
    expect(byId['render-api'].status).toBe('connected');
  });

  it('marks rejected tokens as errors', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      new URL(url).hostname === 'api.github.com' ? jsonRes({}, 401) : jsonRes({ ok: true })
    );
    const list = await checkAdminConnections(
      { GITHUB_TOKEN: 'bad' },
      {
        vault: notLinked,
        upstreamOrigin: 'https://api.test',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }
    );
    const github = list.find((c) => c.id === 'github')!;
    expect(github.status).toBe('error');
    expect(github.detail).toContain('401');
  });
});
