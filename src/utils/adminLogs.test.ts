import { describe, expect, it } from 'vitest';
import { buildUnifiedAdminLogs, filterAdminLogs } from './adminLogs';

const input = {
  mcpServices: [
    {
      id: 'api',
      name: 'api',
      displayName: 'Gateway',
      category: 'core' as const,
      port: 0,
      status: 'healthy' as const,
      uptime: '',
      latencyMs: 1,
      cpuPercent: 0,
      memoryMb: 0,
      lastChecked: '',
      version: '',
      endpoint: '',
      errorCount: 1,
      logs: [
        {
          id: 'l1',
          timestamp: '2026-11-27T08:00:00Z',
          level: 'ERROR' as const,
          message: 'DB timeout',
          stackTrace: 'at x',
        },
      ],
    },
  ],
  alerts: [],
  deployments: [
    {
      id: 'core',
      provider: 'GitHub Actions',
      service: 'main',
      deployedAt: '2026-11-27T09:00:00Z',
      status: 'failure',
      commit: 'abc1234',
    },
  ],
  providers: [
    {
      id: 'openai',
      provider: 'openai',
      displayName: 'OpenAI',
      maskedKey: 'sk-***',
      status: 'degraded' as const,
      latencyMs: 900,
      priority: 1,
      lastChecked: '2026-11-27T07:00:00Z',
      rateLimitTpm: '',
    },
  ],
  securityEvents: [],
  auditRecords: [
    {
      id: 'a1',
      timestamp: '2026-11-27T06:00:00Z',
      actor: 'admin',
      action: 'UPDATE',
      resource: 'config',
      details: 'maintenance off',
      ipAddress: '',
    },
  ],
  workers: [],
};

describe('buildUnifiedAdminLogs', () => {
  it('merges every source newest-first with levels and fix tabs', () => {
    const logs = buildUnifiedAdminLogs(input);
    expect(logs.map((l) => l.source)).toEqual(['deploy', 'service', 'provider', 'audit']);
    expect(logs[0]).toMatchObject({
      level: 'error',
      provider: 'GitHub Actions',
      targetTab: 'github-pipeline',
    });
    expect(logs[1]).toMatchObject({ level: 'error', details: 'at x', targetTab: 'mcp-tower' });
    expect(logs[2]).toMatchObject({ level: 'warn', targetTab: 'provider-keys' });
  });

  it('filters by level, provider, source and text', () => {
    const logs = buildUnifiedAdminLogs(input);
    expect(filterAdminLogs(logs, { level: 'error' })).toHaveLength(2);
    expect(filterAdminLogs(logs, { provider: 'OpenAI' })).toHaveLength(1);
    expect(filterAdminLogs(logs, { source: 'audit' })[0].message).toContain('UPDATE');
    expect(filterAdminLogs(logs, { query: 'timeout' })[0].provider).toBe('Gateway');
    expect(filterAdminLogs(logs, { level: 'all', source: 'all', provider: 'all' })).toHaveLength(4);
  });

  it('handles missing providers/deployments (unknown) without crashing', () => {
    const logs = buildUnifiedAdminLogs({ ...input, providers: null, deployments: null });
    expect(logs.some((l) => l.source === 'provider')).toBe(false);
  });
});
