import { describe, expect, it } from 'vitest';
import { adminService } from './adminService';

describe('adminService.mapTowerService (untyped Tower telemetry)', () => {
  it('keeps well-typed Tower values', () => {
    const svc = adminService.mapTowerService({
      id: 'gateway',
      name: 'Gateway',
      category: 'ai',
      port: 8080,
      status: 'degraded',
      latencyMs: 42,
      cpuPercent: 12.5,
      deployStatus: 'live',
      monthlyBuildMinutes: 90,
      freeLimitExhausted: false,
      commitSha: 'abc1234',
      freshness: 'live-stale',
      logs: [{ id: 'l1' }],
    });
    expect(svc).toMatchObject({
      id: 'gateway',
      name: 'Gateway',
      displayName: 'Gateway',
      category: 'ai',
      port: 8080,
      status: 'degraded',
      latencyMs: 42,
      cpuPercent: 12.5,
      memoryMb: null,
      version: 'live',
      monthlyBuildMinutes: 90,
      freeLimitExhausted: false,
      commitSha: 'abc1234',
      freshness: 'live-stale',
    });
    expect(svc.logs).toHaveLength(1);
  });

  it('falls back to honest defaults for missing or wrongly-typed fields', () => {
    const svc = adminService.mapTowerService({
      id: 7,
      port: '8080',
      cpuPercent: '12',
      monthlyBuildMinutes: '90',
      freeLimitExhausted: 'yes',
      logs: 'none',
    });
    expect(svc).toMatchObject({
      id: '7',
      name: '7',
      category: 'core',
      status: 'healthy',
      port: 0,
      uptime: '—',
      cpuPercent: null,
      lastChecked: 'Just now',
      endpoint: '',
      errorCount: 0,
      logs: [],
    });
    expect(svc.monthlyBuildMinutes).toBeUndefined();
    expect(svc.freeLimitExhausted).toBeUndefined();
  });
});
