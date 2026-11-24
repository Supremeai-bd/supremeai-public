import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdminGitHubPipelineView } from './AdminGitHubPipelineView';
import { adminService } from '../../services/adminService';

vi.mock('../../services/adminService', () => ({
  adminService: {
    fetchGitHubRuns: vi.fn(),
    fetchGitHubRunErrorLogs: vi.fn(),
    fetchGitHubPulls: vi.fn(),
    triggerGitHubRunAction: vi.fn(),
    triggerGitHubPullAction: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AdminGitHubPipelineView', () => {
  it('renders clickable commit hash links for deployments and omits links when head_sha is absent', async () => {
    const validSha = 'f4e3d2c1b0a9876543210fedcba9876543210abc';
    vi.mocked(adminService.fetchGitHubRuns).mockResolvedValue({
      tokenConfigured: true,
      runs: [
        {
          id: 701,
          name: 'Deploy Edge',
          status: 'completed',
          conclusion: 'success',
          html_url: 'https://github.com/Supremeai-bd/supremeai/actions/runs/701',
          created_at: '2026-11-24T10:00:00Z',
          run_started_at: '2026-11-24T10:00:00Z',
          updated_at: '2026-11-24T10:01:30Z',
          head_branch: 'main',
          head_sha: validSha,
          run_number: 701,
        },
        {
          id: 700,
          name: 'Legacy Run Without SHA',
          status: 'completed',
          conclusion: 'failure',
          html_url: 'https://github.com/Supremeai-bd/supremeai/actions/runs/700',
          created_at: '2026-11-24T09:00:00Z',
          run_started_at: '2026-11-24T09:00:00Z',
          updated_at: '2026-11-24T09:01:00Z',
          head_branch: 'fix/hotfix',
          head_sha: null,
          run_number: 700,
        },
      ],
    });
    vi.mocked(adminService.fetchGitHubPulls).mockResolvedValue({
      tokenConfigured: true,
      pulls: [],
    });

    render(<AdminGitHubPipelineView />);

    const link = await screen.findByTestId('run-commit-link-701');
    expect(link).toHaveTextContent('f4e3d2c');
    expect(link).toHaveAttribute(
      'href',
      `https://github.com/Supremeai-bd/supremeai/commit/${validSha}`
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');

    await waitFor(() => {
      expect(screen.getByText('Legacy Run Without SHA')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('run-commit-link-700')).not.toBeInTheDocument();
    expect(screen.queryByTestId('toggle-error-log-701')).not.toBeInTheDocument();
    expect(screen.getByTestId('toggle-error-log-700')).toBeInTheDocument();
  });

  it('expands failed deployment error logs inline, displays stderr and annotations safely, and caches toggles', async () => {
    vi.mocked(adminService.fetchGitHubRuns).mockResolvedValue({
      tokenConfigured: true,
      runs: [
        {
          id: 801,
          name: 'CI Test & Build',
          status: 'completed',
          conclusion: 'failure',
          html_url: 'https://github.com/Supremeai-bd/supremeai/actions/runs/801',
          created_at: '2026-11-24T10:00:00Z',
          run_started_at: '2026-11-24T10:00:00Z',
          updated_at: '2026-11-24T10:02:00Z',
          head_branch: 'feat/pipeline-logs',
          head_sha: 'abcdef1234567890abcdef1234567890abcdef12',
          run_number: 801,
        },
      ],
    });
    vi.mocked(adminService.fetchGitHubPulls).mockResolvedValue({
      tokenConfigured: true,
      pulls: [],
    });
    vi.mocked(adminService.fetchGitHubRunErrorLogs).mockResolvedValue({
      runId: '801',
      repo: 'Supremeai-bd/supremeai',
      available: true,
      failedJobs: [
        {
          id: 9001,
          name: 'unit-tests',
          conclusion: 'failure',
          html_url: 'https://github.com/Supremeai-bd/supremeai/actions/runs/801/job/9001',
          failedSteps: [{ name: 'Run Vitest', number: 4, conclusion: 'failure' }],
        },
      ],
      annotations: [
        {
          path: 'src/server/routes/admin/system.ts',
          startLine: 512,
          annotationLevel: 'failure',
          title: 'Vitest Assertion',
          message: 'Expected status 200 but received 500',
        },
      ],
      stderrSnippet:
        'stderr: FAIL src/app.test.ts\n<script>window.__xss=1</script>\n##[error]Process completed with exit code 1.',
      truncated: true,
    });

    render(<AdminGitHubPipelineView />);

    const toggleBtn = await screen.findByTestId('toggle-error-log-801');
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');

    const panel = await screen.findByTestId('error-log-panel-801');
    expect(panel).toHaveTextContent('unit-tests');
    expect(panel).toHaveTextContent('Failed step: Run Vitest');

    const annotations = await screen.findByTestId('error-log-annotations-801');
    expect(annotations).toHaveTextContent(
      'src/server/routes/admin/system.ts:512 (Vitest Assertion): Expected status 200 but received 500'
    );

    const snippet = await screen.findByTestId('error-log-snippet-801');
    expect(snippet).toHaveTextContent('stderr: FAIL src/app.test.ts');
    expect(snippet).toHaveTextContent('<script>window.__xss=1</script>');
    expect(snippet.querySelector('script')).toBeNull();
    expect(adminService.fetchGitHubRunErrorLogs).toHaveBeenCalledTimes(1);
    expect(adminService.fetchGitHubRunErrorLogs).toHaveBeenCalledWith(
      'Supremeai-bd/supremeai',
      801
    );

    // Collapse and reopen uses cached response until Refresh Log is clicked
    fireEvent.click(toggleBtn);
    expect(screen.queryByTestId('error-log-panel-801')).not.toBeInTheDocument();

    fireEvent.click(toggleBtn);
    expect(screen.getByTestId('error-log-panel-801')).toBeInTheDocument();
    expect(adminService.fetchGitHubRunErrorLogs).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Refresh Log/i }));
    await waitFor(() => {
      expect(adminService.fetchGitHubRunErrorLogs).toHaveBeenCalledTimes(2);
    });
  });

  it('shows honest unavailable state when GitHub raw stderr logs cannot be downloaded', async () => {
    vi.mocked(adminService.fetchGitHubRuns).mockResolvedValue({
      tokenConfigured: false,
      runs: [
        {
          id: 802,
          name: 'Deploy Prod',
          status: 'completed',
          conclusion: 'timed_out',
          html_url: 'https://github.com/Supremeai-bd/supremeai/actions/runs/802',
          created_at: '2026-11-24T10:00:00Z',
          run_started_at: '2026-11-24T10:00:00Z',
          updated_at: '2026-11-24T10:05:00Z',
          head_branch: 'main',
          head_sha: '1234567890abcdef1234567890abcdef12345678',
          run_number: 802,
        },
      ],
    });
    vi.mocked(adminService.fetchGitHubPulls).mockResolvedValue({
      tokenConfigured: false,
      pulls: [],
    });
    vi.mocked(adminService.fetchGitHubRunErrorLogs).mockResolvedValue({
      runId: '802',
      repo: 'Supremeai-bd/supremeai',
      available: false,
      reason: 'Raw job log download returned HTTP 403 (configure GITHUB_TOKEN on server).',
      failedJobs: [],
      annotations: [],
      stderrSnippet: '',
      truncated: false,
    });

    render(<AdminGitHubPipelineView />);
    const toggleBtn = await screen.findByTestId('toggle-error-log-802');
    fireEvent.click(toggleBtn);

    const emptyNotice = await screen.findByTestId('error-log-empty-802');
    expect(emptyNotice).toHaveTextContent(
      'Raw job log download returned HTTP 403 (configure GITHUB_TOKEN on server).'
    );
  });
});
