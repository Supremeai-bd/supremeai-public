import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GitHubPipelineStatusIndicator } from './GitHubPipelineStatusIndicator';
import type { GitHubWorkflowRun } from '../../utils/githubPipelineMetrics';
import type { DataSourceState } from '../../hooks/useDataSource';

afterEach(() => {
  cleanup();
});

const liveSource: DataSourceState = {
  source: 'live',
  isMock: false,
  reason: 'Loaded from GitHub Actions API',
  ageMs: 2000,
};

const makeRun = (overrides: Partial<GitHubWorkflowRun> = {}): GitHubWorkflowRun => ({
  id: 1,
  name: 'Deploy Production',
  status: 'completed',
  conclusion: 'success',
  html_url: 'https://github.com/Supremeai-bd/supremeai/actions/runs/1',
  created_at: '2026-11-24T10:00:00Z',
  run_started_at: '2026-11-24T10:00:00Z',
  updated_at: '2026-11-24T10:02:00Z',
  head_branch: 'main',
  run_number: 1,
  ...overrides,
});

describe('GitHubPipelineStatusIndicator', () => {
  it('renders live elapsed job duration, mini-line chart, and active status when a deployment is running', () => {
    const nowMs = Date.parse('2026-11-24T10:01:15Z');
    const runs: GitHubWorkflowRun[] = [
      makeRun({
        id: 50,
        run_number: 50,
        name: 'Build & Deploy Edge',
        status: 'in_progress',
        conclusion: null,
        run_started_at: '2026-11-24T10:00:00Z',
        updated_at: '2026-11-24T10:00:10Z',
      }),
      makeRun({ id: 49, run_number: 49, conclusion: 'success' }),
      makeRun({ id: 48, run_number: 48, conclusion: 'success' }),
      makeRun({ id: 47, run_number: 47, conclusion: 'failure' }),
      makeRun({ id: 46, run_number: 46, conclusion: 'success' }),
    ];

    render(
      <GitHubPipelineStatusIndicator
        runs={runs}
        nowMs={nowMs}
        isLoading={false}
        lastUpdatedMs={nowMs}
        dataSource={liveSource}
        repo="Supremeai-bd/supremeai"
        durationThresholdMs={180_000}
        onChangeDurationThreshold={vi.fn()}
        alertAcknowledged={false}
        onToggleAcknowledgeAlert={vi.fn()}
      />
    );

    expect(screen.getByTestId('pipeline-health-status')).toHaveTextContent('Live Run Active');
    expect(screen.getByTestId('active-job-duration-readout')).toHaveTextContent('Elapsed 1m 15s');
    expect(screen.getByTestId('pipeline-success-rate')).toHaveTextContent('75%');
    expect(screen.getByTestId('data-source-badge')).toHaveAttribute('data-source', 'live');
    expect(screen.getByTestId('success-rate-mini-line-chart')).toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: /Success rate trend mini-line chart for the last 10 deployments/i,
      })
    ).toBeInTheDocument();
  });

  it('triggers a threshold notification badge when average duration exceeds the limit and supports acknowledge + threshold change', () => {
    const nowMs = Date.parse('2026-11-24T10:10:00Z');
    const onChangeThreshold = vi.fn();
    const onToggleAck = vi.fn();
    const runs: GitHubWorkflowRun[] = [
      makeRun({
        id: 10,
        run_number: 10,
        head_branch: 'main',
        conclusion: 'success',
        run_started_at: '2026-11-24T10:00:00Z',
        updated_at: '2026-11-24T10:04:00Z', // 4m 00s
      }),
      makeRun({
        id: 9,
        run_number: 9,
        head_branch: 'feat/sync',
        conclusion: 'failure',
        run_started_at: '2026-11-24T09:50:00Z',
        updated_at: '2026-11-24T09:54:00Z', // 4m 00s
      }),
    ];

    const { rerender } = render(
      <GitHubPipelineStatusIndicator
        runs={runs}
        nowMs={nowMs}
        isLoading={false}
        lastUpdatedMs={nowMs}
        dataSource={liveSource}
        repo="Supremeai-bd/supremeai"
        durationThresholdMs={180_000} // 3m 00s limit; avg is 4m 00s (+33%)
        onChangeDurationThreshold={onChangeThreshold}
        alertAcknowledged={false}
        onToggleAcknowledgeAlert={onToggleAck}
      />
    );

    const badge = screen.getByTestId('duration-threshold-alert-badge');
    expect(badge).toHaveAttribute('data-severity', 'warning');
    expect(badge).toHaveTextContent('Duration Alert: Avg 4m 00s > 3m 00s (+33%)');
    expect(screen.getByTestId('duration-threshold-line')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    expect(onToggleAck).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByTestId('duration-threshold-select'), {
      target: { value: '300000' },
    });
    expect(onChangeThreshold).toHaveBeenCalledWith(300_000);

    // Raising the threshold above 4m 00s clears the alert badge
    rerender(
      <GitHubPipelineStatusIndicator
        runs={runs}
        nowMs={nowMs}
        isLoading={false}
        lastUpdatedMs={nowMs}
        dataSource={liveSource}
        repo="Supremeai-bd/supremeai"
        durationThresholdMs={300_000}
        onChangeDurationThreshold={onChangeThreshold}
        alertAcknowledged={false}
        onToggleAcknowledgeAlert={onToggleAck}
      />
    );
    expect(screen.queryByTestId('duration-threshold-alert-badge')).not.toBeInTheDocument();
  });

  it('allows inspecting individual runs across the mini-line and duration charts with commit links', () => {
    const nowMs = Date.parse('2026-11-24T10:10:00Z');
    const runs: GitHubWorkflowRun[] = [
      makeRun({
        id: 10,
        run_number: 10,
        head_branch: 'main',
        head_sha: '1111111222222233333334444444555555566666',
        conclusion: 'success',
        run_started_at: '2026-11-24T10:00:00Z',
        updated_at: '2026-11-24T10:01:00Z',
      }),
      makeRun({
        id: 9,
        run_number: 9,
        head_branch: 'feat/sync',
        head_sha: '9999999abcdef0123456789abcdef01234567890',
        conclusion: 'failure',
        run_started_at: '2026-11-24T09:50:00Z',
        updated_at: '2026-11-24T09:53:20Z',
      }),
    ];

    render(
      <GitHubPipelineStatusIndicator
        runs={runs}
        nowMs={nowMs}
        isLoading={false}
        lastUpdatedMs={nowMs}
        dataSource={liveSource}
        repo="Supremeai-bd/supremeai"
        durationThresholdMs={300_000}
        onChangeDurationThreshold={vi.fn()}
        alertAcknowledged={false}
        onToggleAcknowledgeAlert={vi.fn()}
      />
    );

    expect(screen.getByTestId('pipeline-avg-duration')).toHaveTextContent('2m 10s');

    const failedBar = screen.getByRole('button', { name: /Deploy Production \(failure\)/i });
    fireEvent.click(failedBar);

    expect(screen.getByTestId('inspected-deployment-readout')).toHaveTextContent(
      '#9 · feat/sync · failure'
    );
    expect(screen.getByTestId('inspected-deployment-readout')).toHaveTextContent('3m 20s');
    const commitLink = screen.getByTestId('inspected-commit-link');
    expect(commitLink).toHaveTextContent('9999999');
    expect(commitLink).toHaveAttribute(
      'href',
      'https://github.com/Supremeai-bd/supremeai/commit/9999999abcdef0123456789abcdef01234567890'
    );
    expect(commitLink).toHaveAttribute('target', '_blank');
  });

  it('renders honest empty state when no runs are available', () => {
    render(
      <GitHubPipelineStatusIndicator
        runs={[]}
        nowMs={Date.now()}
        isLoading={false}
        lastUpdatedMs={Date.now()}
        dataSource={{ ...liveSource, source: 'degraded', reason: 'API returned 404' }}
        repo="Supremeai-bd/supremeai"
        durationThresholdMs={180_000}
        onChangeDurationThreshold={vi.fn()}
        alertAcknowledged={false}
        onToggleAcknowledgeAlert={vi.fn()}
      />
    );

    expect(screen.getByTestId('pipeline-health-status')).toHaveTextContent('No Deployments');
    expect(screen.getByTestId('pipeline-success-rate')).toHaveTextContent('—');
    expect(screen.getByTestId('pipeline-avg-duration')).toHaveTextContent('—');
  });
});
