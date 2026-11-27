import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AdminMissionControlView, formatRelativeTime } from './AdminMissionControlView';
import { AdminConsoleNav } from './AdminConsoleNav';
import { AdminSectionTabs } from './AdminSectionTabs';
import { useAdminHealthStore } from '../../stores/useAdminHealthStore';
import { useAdminStore } from '../../stores/useAdminStore';
import { usePlatformStore } from '../../stores/usePlatformStore';

afterEach(() => cleanup());

beforeEach(() => {
  useAdminHealthStore.setState({
    providers: [
      {
        id: 'openai',
        provider: 'openai',
        displayName: 'OpenAI',
        maskedKey: 'sk-***',
        status: 'unhealthy',
        latencyMs: 0,
        priority: 1,
        lastChecked: new Date().toISOString(),
        rateLimitTpm: '',
      },
    ],
    deployments: [
      {
        id: 'render-gateway',
        provider: 'Render',
        service: 'supremeai-api (Gateway)',
        deployedAt: null,
        status: 'live',
        commit: null,
      },
    ],
    lastRefreshedAt: Date.now(),
    isRefreshing: false,
    // never hit the network from tests
    refreshAll: vi.fn().mockResolvedValue(undefined),
  });
  useAdminStore.setState({ mcpServices: [], customers: [], queueJobs: [], swarmWorkers: [] });
  usePlatformStore.setState((s) => ({ config: { ...s.config, maintenanceMode: false } }));
});

describe('AdminMissionControlView', () => {
  it('shows a red overall status and sends the admin to the fix tab', () => {
    const onNavigate = vi.fn();
    render(<AdminMissionControlView onNavigateTab={onNavigate} />);

    expect(screen.getByTestId('admin-overall-status').getAttribute('data-status')).toBe('critical');
    expect(screen.getByTestId('admin-area-ai').getAttribute('data-status')).toBe('critical');

    const list = screen.getByTestId('admin-issue-list');
    const row = within(list).getByText('OpenAI key is failing').closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: /fix key/i }));
    expect(onNavigate).toHaveBeenCalledWith('provider-keys');

    fireEvent.click(screen.getByTestId('admin-area-users'));
    expect(onNavigate).toHaveBeenCalledWith('customers');
  });

  it('marks the failing section red in the sidebar and section header', () => {
    const onSelect = vi.fn();
    render(<AdminConsoleNav activeTab="llm-gateway" onSelectTab={onSelect} />);
    const aiNav = screen.getByTestId('admin-nav-ai');
    expect(aiNav.getAttribute('aria-current')).toBe('page');
    expect(within(aiNav).getByTitle(/critical/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('admin-nav-deploy'));
    expect(onSelect).toHaveBeenCalledWith('github-pipeline');
    cleanup();

    render(<AdminSectionTabs activeTab="llm-gateway" onSelectTab={onSelect} />);
    expect(
      screen.getByRole('tab', { name: 'Routing & Pricing' }).getAttribute('aria-selected')
    ).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Provider Keys' }));
    expect(onSelect).toHaveBeenCalledWith('provider-keys');
  });

  it('formats relative time', () => {
    const now = 1_000_000_000;
    expect(formatRelativeTime(null, now)).toBe('never');
    expect(formatRelativeTime(now - 5_000, now)).toBe('just now');
    expect(formatRelativeTime(now - 120_000, now)).toBe('2m ago');
    expect(formatRelativeTime(now - 3 * 3600_000, now)).toBe('3h ago');
  });
});
