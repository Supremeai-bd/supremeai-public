import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AdminBackupsView, formatBytes } from './AdminBackupsView';
import { adminBackupService, type BackupState } from '../../services/adminBackupService';

const BASE: BackupState = {
  health: 'ok',
  schedule: 'daily 02:30 Asia/Dhaka',
  retentionDays: 30,
  encryption: 'AES-256',
  lastRun: {
    id: 70,
    status: 'completed',
    conclusion: 'success',
    event: 'schedule',
    createdAt: '2026-11-27T20:30:00Z',
    url: 'https://github.com/Supremeai-bd/supremeai/actions/runs/70',
  },
  lastSuccessAt: '2026-11-27T20:31:00Z',
  backups: [
    {
      id: 7,
      sizeBytes: 3_456_789,
      createdAt: '2026-11-27T20:31:00Z',
      expiresAt: '2026-12-27T20:31:00Z',
      runId: 70,
      commit: 'abcdef1',
    },
  ],
  workflowUrl: 'https://github.com/Supremeai-bd/supremeai/actions/workflows/db-backup.yml',
};

afterEach(cleanup);
beforeEach(() => vi.restoreAllMocks());

describe('AdminBackupsView', () => {
  it('shows health, facts and stored backups with a link to the run', async () => {
    vi.spyOn(adminBackupService, 'getState').mockResolvedValue(BASE);
    render(<AdminBackupsView />);
    const badge = await screen.findByTestId('backup-health');
    expect(badge.getAttribute('data-health')).toBe('ok');
    expect(screen.getByText('AES-256')).toBeTruthy();
    const row = screen.getByTestId('backup-row-7');
    expect(row.textContent).toContain('3.3 MB');
    const link = row.querySelector('a');
    expect(link?.getAttribute('href')).toBe(
      'https://github.com/Supremeai-bd/supremeai/actions/runs/70'
    );
    expect(screen.queryByTestId('backup-hint')).toBeNull();
  });

  it('has no run/restore buttons — the system runs it, restore is a runbook', async () => {
    vi.spyOn(adminBackupService, 'getState').mockResolvedValue(BASE);
    render(<AdminBackupsView />);
    await screen.findByTestId('backup-health');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText(/pg_restore/)).toBeTruthy();
  });

  it('explains a failing job and an empty list', async () => {
    vi.spyOn(adminBackupService, 'getState').mockResolvedValue({
      ...BASE,
      health: 'failing',
      backups: [],
      lastSuccessAt: null,
    });
    render(<AdminBackupsView />);
    expect((await screen.findByTestId('backup-hint')).textContent).toContain(
      'BACKUP_ENCRYPTION_KEY'
    );
    expect(screen.getByTestId('backup-health').getAttribute('data-health')).toBe('failing');
  });

  it('shows a load error', async () => {
    vi.spyOn(adminBackupService, 'getState').mockRejectedValue(new Error('boom'));
    render(<AdminBackupsView />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('formatBytes', () => {
  it('formats human sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB');
  });
});
