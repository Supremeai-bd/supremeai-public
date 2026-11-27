import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AdminSessionsView, timeAgo } from './AdminSessionsView';
import { adminSessionService, type AdminSessionsState } from '../../services/adminSessionService';
import { useControlCenterStore } from '../../stores/useControlCenterStore';

const NOW = new Date().toISOString();

const BASE: AdminSessionsState = {
  summary: { liveSessions: 3, usersOnline: 2, pendingCleanup: 198 },
  users: [
    {
      userId: 'u-self',
      email: 'admin@x.com',
      isOwner: true,
      isSelf: true,
      sessions: [
        {
          id: 's-cur',
          createdAt: NOW,
          lastActiveAt: NOW,
          client: 'studio-server',
          device: null,
          ip: null,
          mfa: false,
          current: true,
        },
      ],
    },
    {
      userId: 'u-other',
      email: 'user@x.com',
      isOwner: false,
      isSelf: false,
      sessions: [
        {
          id: 's-a',
          createdAt: NOW,
          lastActiveAt: NOW,
          client: 'browser',
          device: 'Chrome · Windows',
          ip: '203.0.113.9',
          mfa: true,
          current: false,
        },
        {
          id: 's-b',
          createdAt: NOW,
          lastActiveAt: NOW,
          client: 'cli',
          device: null,
          ip: null,
          mfa: false,
          current: false,
        },
      ],
    },
  ],
};

afterEach(cleanup);
beforeEach(() => {
  vi.restoreAllMocks();
  useControlCenterStore.setState({ pendingGate: null, isExecutingGate: false });
});

describe('AdminSessionsView', () => {
  it('shows summary, devices and marks the current session', async () => {
    vi.spyOn(adminSessionService, 'getState').mockResolvedValue(BASE);
    render(<AdminSessionsView />);
    const summary = await screen.findByTestId('sessions-summary');
    expect(summary).toHaveTextContent('198');
    expect(screen.getByText('Chrome · Windows')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.9')).toBeInTheDocument();
    expect(screen.queryByTestId('revoke-s-cur')).toBeNull();
  });

  it('signs out a session only after the safety gate runs', async () => {
    vi.spyOn(adminSessionService, 'getState').mockResolvedValue(BASE);
    const revoke = vi.spyOn(adminSessionService, 'revoke').mockResolvedValue(1);
    render(<AdminSessionsView />);
    fireEvent.click(await screen.findByTestId('revoke-s-a'));
    expect(revoke).not.toHaveBeenCalled();
    const gate = useControlCenterStore.getState().pendingGate;
    expect(gate?.riskLevel).toBe('high');
    await gate!.onExecute({ dryRun: false } as never);
    expect(revoke).toHaveBeenCalledWith('u-other', 's-a');
  });

  it('offers sign-out-everywhere only for users without the current session', async () => {
    vi.spyOn(adminSessionService, 'getState').mockResolvedValue(BASE);
    const revoke = vi.spyOn(adminSessionService, 'revoke').mockResolvedValue(2);
    render(<AdminSessionsView />);
    const other = await screen.findByTestId('session-user-u-other');
    const self = screen.getByTestId('session-user-u-self');
    expect(self.querySelectorAll('header button')).toHaveLength(0);
    fireEvent.click(other.querySelector('header button')!);
    await useControlCenterStore.getState().pendingGate!.onExecute({ dryRun: false } as never);
    expect(revoke).toHaveBeenCalledWith('u-other', undefined);
  });

  it('shows a load error instead of fake data', async () => {
    vi.spyOn(adminSessionService, 'getState').mockRejectedValue(new Error('db down'));
    render(<AdminSessionsView />);
    expect(await screen.findByRole('alert')).toHaveTextContent('db down');
  });
});

describe('timeAgo', () => {
  it('formats relative times', () => {
    const now = Date.parse('2026-11-27T12:00:00Z');
    expect(timeAgo('2026-11-27T11:59:30Z', now)).toBe('30s');
    expect(timeAgo('2026-11-27T11:00:00Z', now)).toBe('1h');
    expect(timeAgo('2026-11-25T12:00:00Z', now)).toBe('2d');
    expect(timeAgo('nope', now)).toBe('—');
  });
});
