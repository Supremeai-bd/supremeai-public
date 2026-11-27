// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROBE_BATCH_SIZE,
  PROVIDER_DEFINITIONS,
  buildProviderKeys,
  collectVault,
  probeProviderKey,
  resetProviderVaultCache,
} from './providerVault';
import { mergeProbeRows } from '../../src/utils/mergeProbeRows';

const openrouter = PROVIDER_DEFINITIONS.find((d) => d.id === 'openrouter')!;
const ok = () => new Response('{}', { status: 200 });

function manyOpenRouterKeys(n: number): Record<string, string> {
  const env: Record<string, string> = {};
  for (let i = 1; i <= n; i += 1)
    env[`OPENROUTER_API_KEY_${i}`] = `sk-or-v1-${String(i).padStart(40, 'a')}`;
  return env;
}

afterEach(() => {
  resetProviderVaultCache();
  vi.restoreAllMocks();
});

describe('Probe All — OpenRouter "1 ms unhealthy" false fail', () => {
  it('treats the Cloudflare subrequest limit as retryable/untested, not a dead key', async () => {
    const res = await probeProviderKey(openrouter, 'sk-or-v1-xyz', (async () => {
      throw new Error('Too many subrequests.');
    }) as unknown as typeof fetch);
    expect(res.status).toBe('untested');
    expect(res.retryable).toBe(true);
  });

  it('surfaces the real fetch error instead of a generic message (and never the key)', async () => {
    const res = await probeProviderKey(openrouter, 'sk-or-v1-secretvalue123', (async () => {
      throw new TypeError('fetch failed: ECONNRESET');
    }) as unknown as typeof fetch);
    expect(res.status).toBe('unhealthy');
    expect(res.message).toContain('ECONNRESET');
    expect(res.message).not.toContain('secretvalue123');
  });

  it('caps live probes per invocation at PROBE_BATCH_SIZE', async () => {
    const vault = await collectVault(manyOpenRouterKeys(PROBE_BATCH_SIZE + 15), { force: true });
    const fetchImpl = vi.fn(async () => ok());
    const keys = await buildProviderKeys(vault, {
      probe: 'all',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(keys).toHaveLength(PROBE_BATCH_SIZE + 15);
    expect(fetchImpl).toHaveBeenCalledTimes(PROBE_BATCH_SIZE);
    expect(keys.filter((k) => k.status === 'healthy')).toHaveLength(PROBE_BATCH_SIZE);
  });

  it('probes only the requested batch ids and dedupes identical keys', async () => {
    const env = manyOpenRouterKeys(4);
    env.OPENROUTER_API_KEY_DUP = env.OPENROUTER_API_KEY_1;
    const vault = await collectVault(env, { force: true });
    const listed = await buildProviderKeys(vault, { probe: 'none' });
    const ids = new Set(listed.filter((k) => /_1$|_DUP$/.test(k.secretName)).map((k) => k.id));
    expect(ids.size).toBe(2);
    const fetchImpl = vi.fn(async () => ok());
    const keys = await buildProviderKeys(vault, {
      probe: 'all',
      onlyIds: ids,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(
      keys
        .filter((k) => k.status === 'healthy')
        .map((k) => k.secretName)
        .sort()
    ).toEqual(['OPENROUTER_API_KEY_1', 'OPENROUTER_API_KEY_DUP']);
  });

  it('does not cache a subrequest-limit miss as a verdict', async () => {
    const vault = await collectVault(manyOpenRouterKeys(1), { force: true });
    await buildProviderKeys(vault, {
      probe: 'all',
      fetchImpl: (async () => ok()) as unknown as typeof fetch,
    });
    const keys = await buildProviderKeys(vault, {
      probe: 'all',
      fetchImpl: (async () => {
        throw new Error('Too many subrequests.');
      }) as unknown as typeof fetch,
    });
    expect(keys[0].status).toBe('healthy');
  });
});

describe('mergeProbeRows', () => {
  it('keeps an earlier verdict when a later batch reports untested', () => {
    const prev = [
      { id: 'a', status: 'healthy' },
      { id: 'b', status: 'untested' },
    ];
    const next = [
      { id: 'a', status: 'untested' },
      { id: 'b', status: 'unhealthy' },
    ];
    expect(mergeProbeRows(prev, next)).toEqual([
      { id: 'a', status: 'healthy' },
      { id: 'b', status: 'unhealthy' },
    ]);
    expect(mergeProbeRows(undefined, next)).toBe(next);
  });
});
