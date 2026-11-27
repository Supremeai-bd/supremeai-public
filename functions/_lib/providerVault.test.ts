// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildProviderKeys,
  collectVault,
  expandMultiKeySecrets,
  maskSecret,
  matchProviderBySecretName,
  missingInfisicalEnv,
  probeProviderKey,
  resetProviderVaultCache,
  PROVIDER_DEFINITIONS,
  type VaultSecret,
} from './providerVault';

const GROQ_VALUE = 'gsk_live_1234567890abcdefXYZ';
const GEMINI_VALUE = 'AIzaSyD-0123456789abcdefghijk';

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  resetProviderVaultCache();
  vi.restoreAllMocks();
});

describe('matchProviderBySecretName', () => {
  it('recognises common secret names', () => {
    expect(matchProviderBySecretName('GROQ_API_KEY')?.id).toBe('groq');
    expect(matchProviderBySecretName('GROQ_API_KEY_2')?.id).toBe('groq');
    expect(matchProviderBySecretName('GEMINI_API_KEY')?.id).toBe('google_ai_studio');
    expect(matchProviderBySecretName('GOOGLE_API_KEY')?.id).toBe('google_ai_studio');
    expect(matchProviderBySecretName('OPENROUTER_API_KEY')?.id).toBe('openrouter');
    expect(matchProviderBySecretName('HF_TOKEN')?.id).toBe('huggingface');
    expect(matchProviderBySecretName('CO_API_KEY')?.id).toBe('cohere');
    expect(matchProviderBySecretName('GROQ_API_KEYS#2')?.id).toBe('groq');
  });

  it('ignores non-provider secrets', () => {
    expect(matchProviderBySecretName('SUPABASE_SERVICE_ROLE_KEY')).toBeNull();
    expect(matchProviderBySecretName('INFISICAL_CLIENT_SECRET')).toBeNull();
    expect(matchProviderBySecretName('DATABASE_URL')).toBeNull();
    expect(matchProviderBySecretName('CONTROL_PLANE_TOKEN')).toBeNull();
    expect(matchProviderBySecretName('GITHUB_TOKEN')).toBeNull();
  });
});

describe('helpers', () => {
  it('masks secrets without leaking the middle', () => {
    expect(maskSecret(GROQ_VALUE)).toBe('gsk_••••fXYZ');
    expect(maskSecret('short')).toBe('••••');
  });

  it('lists missing Infisical env', () => {
    expect(missingInfisicalEnv({})).toEqual([
      'INFISICAL_PROJECT_ID',
      'INFISICAL_CLIENT_ID',
      'INFISICAL_CLIENT_SECRET',
    ]);
    expect(missingInfisicalEnv({ INFISICAL_TOKEN: 't', INFISICAL_PROJECT_ID: 'p' })).toEqual([]);
  });

  it('splits multi-key secrets', () => {
    const base: VaultSecret = {
      name: 'GROQ_API_KEYS',
      value: 'a1111111111, b2222222222',
      source: 'infisical',
      path: '/',
      environment: 'prod',
    };
    const out = expandMultiKeySecrets([base]);
    expect(out.map((s) => s.name)).toEqual(['GROQ_API_KEYS#1', 'GROQ_API_KEYS#2']);
  });
});

describe('collectVault', () => {
  it('reports not-linked with missing env when nothing is configured', async () => {
    const fetchImpl = vi.fn();
    const vault = await collectVault({}, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(vault.summary.connected).toBe(false);
    expect(vault.summary.mode).toBe('not-linked');
    expect(vault.summary.missingEnv).toContain('INFISICAL_CLIENT_ID');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses provider keys found in the edge env', async () => {
    const vault = await collectVault({ GROQ_API_KEY: GROQ_VALUE, SUPABASE_URL: 'x' });
    expect(vault.summary.mode).toBe('edge-env-only');
    expect(vault.secrets.map((s) => s.name)).toEqual(['GROQ_API_KEY']);
  });

  it('logs into Infisical and reads secrets', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/auth/universal-auth/login')) {
        expect(JSON.parse(String(init?.body))).toEqual({ clientId: 'cid', clientSecret: 'csec' });
        return jsonRes({ accessToken: 'tok' });
      }
      if (url.includes('/api/v3/secrets/raw')) {
        expect(url).toContain('workspaceId=proj');
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
        return jsonRes({
          secrets: [
            { secretKey: 'GROQ_API_KEY', secretValue: GROQ_VALUE },
            { secretKey: 'GEMINI_API_KEY', secretValue: GEMINI_VALUE },
            { secretKey: 'DATABASE_URL', secretValue: 'postgres://x' },
          ],
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    const vault = await collectVault(
      { INFISICAL_CLIENT_ID: 'cid', INFISICAL_CLIENT_SECRET: 'csec', INFISICAL_PROJECT_ID: 'proj' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(vault.summary).toMatchObject({
      connected: true,
      mode: 'infisical-live',
      totalSecrets: 3,
      providerSecrets: 2,
      missingEnv: [],
    });
  });

  it('surfaces Infisical login failures instead of saying "no keys"', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ message: 'bad' }, 401));
    const vault = await collectVault(
      { INFISICAL_CLIENT_ID: 'cid', INFISICAL_CLIENT_SECRET: 'bad', INFISICAL_PROJECT_ID: 'proj' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(vault.summary.connected).toBe(false);
    expect(vault.summary.error).toContain('HTTP 401');
  });
});

describe('probe + buildProviderKeys', () => {
  const groq = PROVIDER_DEFINITIONS.find((d) => d.id === 'groq')!;

  it('maps HTTP statuses to health', async () => {
    const ok = await probeProviderKey(groq, GROQ_VALUE, (async () =>
      jsonRes({})) as unknown as typeof fetch);
    expect(ok.status).toBe('healthy');
    const bad = await probeProviderKey(groq, GROQ_VALUE, (async () =>
      jsonRes({}, 401)) as unknown as typeof fetch);
    expect(bad.status).toBe('unhealthy');
    const limited = await probeProviderKey(groq, GROQ_VALUE, (async () =>
      jsonRes({}, 429)) as unknown as typeof fetch);
    expect(limited.status).toBe('degraded');
  });

  it('builds masked admin rows and never returns raw values', async () => {
    const vault = await collectVault({ GROQ_API_KEY: GROQ_VALUE });
    const fetchImpl = vi.fn(async () => jsonRes({ data: [] }));
    const keys = await buildProviderKeys(vault, {
      probe: 'all',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ provider: 'groq', status: 'healthy', source: 'edge-env' });
    expect(JSON.stringify(keys)).not.toContain(GROQ_VALUE);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/models',
      expect.objectContaining({ headers: { Authorization: `Bearer ${GROQ_VALUE}` } })
    );
  });

  it('keeps untested status when probing is disabled', async () => {
    const vault = await collectVault({ GROQ_API_KEY: GROQ_VALUE });
    const keys = await buildProviderKeys(vault, { probe: 'none' });
    expect(keys[0].status).toBe('untested');
  });
});
