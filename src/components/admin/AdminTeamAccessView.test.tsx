import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AdminTeamAccessView } from './AdminTeamAccessView';
import { adminTeamService, type TeamMember } from '../../services/adminTeamService';
import { useControlCenterStore } from '../../stores/useControlCenterStore';

const member = (over: Partial<TeamMember>): TeamMember => ({
  id: 'id',
  email: 'a@x.com',
  name: 'A',
  role: 'user',
  status: 'active',
  isOwner: false,
  isSelf: false,
  createdAt: null,
  lastSignInAt: null,
  provider: 'email',
  ...over,
});

const MEMBERS = [
  member({ id: 'owner', email: 'owner@x.com', name: 'Owner', role: 'admin', isOwner: true }),
  member({ id: 'me', email: 'me@x.com', name: 'Me', role: 'admin', isSelf: true }),
  member({ id: 'm1', email: 'member@x.com', name: 'Member' }),
];

afterEach(() => {
  cleanup();
  useControlCenterStore.setState({ pendingGate: null, isExecutingGate: false });
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(adminTeamService, 'list').mockResolvedValue({
    members: MEMBERS,
    summary: { total: 3, admins: 2, users: 1, invited: 0, suspended: 0 },
  });
});

describe('AdminTeamAccessView', () => {
  it('lists real members and locks owner + self rows', async () => {
    render(<AdminTeamAccessView />);
    const ownerRow = await screen.findByTestId('team-member-owner');
    expect(within(ownerRow).queryByRole('radiogroup')).toBeNull();
    expect(within(screen.getByTestId('team-member-me')).queryByRole('radiogroup')).toBeNull();
    expect(within(screen.getByTestId('team-member-m1')).getByRole('radiogroup')).toBeTruthy();
  });

  it('a role change goes through the SafetyGate and only runs on live execute', async () => {
    const setRole = vi.spyOn(adminTeamService, 'setRole').mockResolvedValue(MEMBERS[2]);
    render(<AdminTeamAccessView />);
    const row = await screen.findByTestId('team-member-m1');
    const radios = within(row).getAllByRole('radio');
    fireEvent.click(radios[1]); // Admin
    expect(setRole).not.toHaveBeenCalled();
    const gate = useControlCenterStore.getState().pendingGate;
    expect(gate?.riskLevel).toBe('critical');
    await useControlCenterStore.getState().executeGuardedAction({ dryRun: true });
    expect(setRole).not.toHaveBeenCalled();
  });

  it('shows an honest error when the team cannot load', async () => {
    vi.spyOn(adminTeamService, 'list').mockRejectedValue(new Error('Team store not linked'));
    render(<AdminTeamAccessView />);
    expect((await screen.findByRole('alert')).textContent).toContain('Team store not linked');
  });
});
