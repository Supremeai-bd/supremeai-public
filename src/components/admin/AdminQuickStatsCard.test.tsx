import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdminQuickStatsCard, computeMcpQuickStats } from './AdminQuickStatsCard';
import type { McpHealthMonitorSnapshot } from '../../types/controlCenter';
import type { McpTowerService } from '../../types';

const makeService = (overrides: Partial<McpTowerService> = {}): McpTowerService => ({
  id: 'svc_api',
  name: 'supremeai-api',
  displayName: 'Gateway API',
  category: 'core',
  port: 443,
  status: 'healthy',
  uptime: '99.9%',
  latencyMs: 92,
  cpuPercent: 18,
  memoryMb: 240,
  lastChecked: '2026-11-19T11:00:00Z',
  version: '2.5.0',
  endpoint: 'https://supremeai-api-ulw0.onrender.com',
  errorCount: 0,
  logs: [],
  ...overrides,
});

const makeHealthSnapshot = (
  overrides: Partial<McpHealthMonitorSnapshot> = {}
): McpHealthMonitorSnapshot => ({
  provenance: 'live-mcp',
  collectedAt: '2026-11-19T11:25:00Z',
  mcpTowerStatus: 'healthy',
  sweepCompletions: 14,
  host: {
    hostname: 'render-mcp-01',
    platform: 'linux',
    nodeVersion: 'v22.0.0',
    cpuCores: 4,
    cpuPercent: 31.4,
    loadAvg1m: 0.85,
    loadAvg5m: 0.72,
    totalMemMb: 4096,
    freeMemMb: 2100,
    systemMemUsedPct: 48.7,
    processRssMb: 312,
    processHeapUsedMb: 140,
    processHeapTotalMb: 210,
    uptimeSec: 90060,
    sampledAt: '2026-11-19T11:25:00Z',
  },
  thresholds: {
    cpuWarnPct: 75,
    cpuCritPct: 90,
    memWarnPct: 80,
    memCritPct: 92,
    latencyWarnMs: 800,
    latencyCritMs: 2000,
  },
  summary: {
    total: 5,
    healthy: 4,
    degraded: 1,
    critical: 0,
    unreachable: 0,
    avgLatencyMs: 128,
    p95LatencyMs: 340,
    activeAlertCount: 1,
  },
  services: [
    {
      id: 'mcp-tower',
      name: 'mcp-tower',
      displayName: 'MCP Control Tower',
      category: 'gateway',
      source: 'render-api',
      status: 'healthy',
      cpuPercent: 14,
      memoryMb: 192,
      memoryPercent: 18,
      latencyMs: 102,
      p50LatencyMs: 95,
      p95LatencyMs: 140,
      consecutiveFailures: 0,
      checkedAt: '2026-11-19T11:25:00Z',
      history: [],
    },
    {
      id: 'qdrant',
      name: 'qdrant',
      displayName: 'Qdrant Vector DB',
      category: 'database',
      source: 'http-probe',
      status: 'degraded',
      cpuPercent: 62,
      memoryMb: 512,
      memoryPercent: 60,
      latencyMs: 340,
      p50LatencyMs: 280,
      p95LatencyMs: 410,
      consecutiveFailures: 1,
      checkedAt: '2026-11-19T11:25:00Z',
      history: [],
    },
  ],
  alerts: [
    {
      id: 'alt_1',
      serviceId: 'qdrant',
      displayName: 'Qdrant Vector DB',
      metric: 'latency',
      severity: 'warning',
      valueLabel: '340ms',
      thresholdLabel: '300ms',
      message: 'Elevated latency',
      detectedAt: '2026-11-19T11:25:00Z',
    },
  ],
  hostHistory: [],
  ...overrides,
});

describe('AdminQuickStatsCard & computeMcpQuickStats', () => {
  it('computes telemetry metrics accurately from live MCP healthSnapshot and trafficSummary', () => {
    const result = computeMcpQuickStats({
      healthSnapshot: makeHealthSnapshot(),
      trafficSummary: {
        rpm: 145,
        avgLatencyMs: 112,
        errorRatePercent: 0.42,
        totalRequests: 18420,
      },
      services: [makeService()],
    });

    expect(result.overallStatus).toBe('degraded');
    expect(result.healthyNodes).toBe(4);
    expect(result.totalNodes).toBe(5);
    expect(result.p95LatencyMs).toBe(340);
    expect(result.avgLatencyMs).toBe(128);
    expect(result.cpuPercent).toBe(31.4);
    expect(result.memoryPercent).toBe(48.7);
    expect(result.rpm).toBe(145);
    expect(result.totalRequests).toBe(18420);
    expect(result.activeAlerts).toBe(1);
    expect(result.sweepCompletions).toBe(14);
    expect(result.topNodes[0].name).toBe('Qdrant Vector DB');
  });

  it('falls back cleanly to McpTowerService array when healthSnapshot is not yet loaded', () => {
    const result = computeMcpQuickStats({
      healthSnapshot: null,
      trafficSummary: null,
      services: [
        makeService({
          id: 'a',
          displayName: 'Node A',
          latencyMs: 80,
          cpuPercent: 10,
          memoryMb: 120,
        }),
        makeService({
          id: 'b',
          displayName: 'Node B',
          latencyMs: 220,
          cpuPercent: 30,
          memoryMb: 280,
        }),
      ],
    });

    expect(result.overallStatus).toBe('healthy');
    expect(result.totalNodes).toBe(2);
    expect(result.healthyNodes).toBe(2);
    expect(result.avgLatencyMs).toBe(150);
    expect(result.p95LatencyMs).toBe(220);
    expect(result.clusterMemoryMb).toBe(400);
    expect(result.topNodes[0].name).toBe('Node B');
  });

  it('renders Quick Stats card with live metrics and interactive pulse/navigation controls', () => {
    const onPulseRefresh = vi.fn();
    const onNavigateTab = vi.fn();

    render(
      <AdminQuickStatsCard
        healthSnapshot={makeHealthSnapshot()}
        trafficSummary={{ rpm: 88, avgLatencyMs: 105, errorRatePercent: 0.25, totalRequests: 5120 }}
        services={[makeService()]}
        onPulseRefresh={onPulseRefresh}
        onNavigateTab={onNavigateTab}
      />
    );

    expect(screen.getByText('Quick Stats')).toBeTruthy();
    expect(screen.getByText('4/5')).toBeTruthy();
    expect(screen.getAllByText('340ms').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('88 RPM')).toBeTruthy();
    expect(screen.getByText('Qdrant Vector DB')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Pulse Check/i }));
    expect(onPulseRefresh).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Telemetry/i }));
    expect(onNavigateTab).toHaveBeenCalledWith('health-monitor');
  });
});
