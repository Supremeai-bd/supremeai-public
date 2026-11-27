import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AdminCommandWall } from './AdminCommandWall';
import { useAdminHealthStore } from '../../stores/useAdminHealthStore';
import { useAdminStore } from '../../stores/useAdminStore';
import { useControlCenterStore } from '../../stores/useControlCenterStore';
import { controlCenterService } from '../../services/controlCenterService';
import { adminService } from '../../services/adminService';
import type { AdminHealthSummary } from '../../utils/adminHealthSummary';
import type { McpHealthMonitorSnapshot } from '../../types/controlCenter';

const metric = (latencyMs: number) => ({
  id: 'core-api',
  name: 'core-api',
  displayName: 'Core API',
  provider: 'Render',
  category: 'compute',
  status: 'degraded',
  latencyMs,
  p50LatencyMs: 300,
  p95LatencyMs: 900,
  cpuPercent: 50,
  memoryMb: 300,
  memoryPercent: 50,
  consecutiveFailures: 1,
  errorMessage: 'Timeout after 5s',
  checkedAt: 'now',
  history: [{ latencyMs: 200 }, { latencyMs: 400 }, { latencyMs: latencyMs }],
});

const snap = (latencyMs: number) =>
  ({ services: [metric(latencyMs)], alerts: [] }) as unknown as McpHealthMonitorSnapshot;

const SUMMARY: Pick<AdminHealthSummary, 'areas' | 'services' | 'issues'> = {
  areas: [
    {
      id: 'services',
      label: 'Services & Health',
      status: 'warning',
      headline: '1 slow',
      metrics: [],
      targetTab: 'health-monitor',
    },
    {
      id: 'ai',
      label: 'AI & Providers',
      status: 'critical',
      headline: '1 key failing',
      metrics: [],
      targetTab: 'provider-keys',
    },
  ],
  services: [
    {
      id: 'svc-core-api',
      name: 'Core API',
      provider: 'Render',
      status: 'warning',
      statusLabel: 'degraded',
      latencyMs: 820,
      detail: 'compute',
      targetTab: 'health-monitor',
    },
  ],
  issues: [],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  useAdminHealthStore.setState({
    providers: [
      {
        id: 'k1',
        provider: 'openai',
        displayName: 'OpenAI',
        maskedKey: 'sk-…abcd',
        status: 'unhealthy',
        latencyMs: 0,
        priority: 1,
        lastChecked: '',
        rateLimitTpm: '',
      },
    ],
    deployments: [],
    connections: [],
    refreshAll: vi.fn().mockResolvedValue(undefined),
  });
  useAdminStore.setState({ swarmWorkers: [], queueJobs: [], securityEvents: [], customers: [] });
  useControlCenterStore.setState({ healthSnapshot: snap(820), pendingHitlCount: 0 });
});

const renderWall = (onNavigateTab = vi.fn()) => {
  render(<AdminCommandWall summary={SUMMARY} areaIcon={{}} onNavigateTab={onNavigateTab} />);
  return onNavigateTab;
};

describe('AdminCommandWall', () => {
  it('L1 → L2: an area opens its nodes in place and toggles closed', () => {
    renderWall();
    expect(screen.queryByTestId('wall-area-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('admin-area-services'));
    const panel = screen.getByTestId('wall-area-panel');
    expect(within(panel).getByTestId('wall-node-service:svc-core-api')).toBeTruthy();
    fireEvent.click(screen.getByTestId('admin-area-services'));
    expect(screen.queryByTestId('wall-area-panel')).toBeNull();
  });

  it('L3: opening a service fetches fresh data and shows the sparkline and errors', async () => {
    const fetchSpy = vi
      .spyOn(controlCenterService, 'fetchServiceHealth')
      .mockResolvedValue({ snapshot: snap(150) } as never);
    renderWall();
    fireEvent.click(screen.getByTestId('admin-area-services'));
    fireEvent.click(screen.getByTestId('wall-node-service:svc-core-api'));

    const detail = screen.getByTestId('wall-node-detail');
    expect(within(detail).getByText('Timeout after 5s')).toBeTruthy();
    expect(within(detail).getByTestId('wall-sparkline')).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledWith(false);
    await waitFor(() => expect(within(detail).getByText('150 ms')).toBeTruthy());

    // Breadcrumb goes back up a level.
    fireEvent.click(screen.getByRole('button', { name: 'Services & Health' }));
    expect(screen.queryByTestId('wall-node-detail')).toBeNull();
  });

  it('L3 action: test a failing provider key', async () => {
    const probe = vi.spyOn(adminService, 'probeProvider').mockResolvedValue({} as never);
    renderWall();
    fireEvent.click(screen.getByTestId('admin-area-ai'));
    fireEvent.click(screen.getByTestId('wall-node-provider:k1'));
    fireEvent.click(screen.getByRole('button', { name: /test this key/i }));
    await waitFor(() => expect(probe).toHaveBeenCalledWith('k1'));
    expect(useAdminHealthStore.getState().refreshAll).toHaveBeenCalledWith({ force: true });
  });

  it('Open page links still reach the full tab', () => {
    const nav = renderWall();
    fireEvent.click(screen.getByTestId('admin-area-ai'));
    fireEvent.click(screen.getByTestId('wall-node-provider:k1'));
    fireEvent.click(screen.getByRole('button', { name: /open page/i }));
    expect(nav).toHaveBeenCalledWith('provider-keys');
  });
});
