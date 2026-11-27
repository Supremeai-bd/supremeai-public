import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const svc = vi.hoisted(() => ({
  fetchPasskeyDevices: vi.fn(),
  registerPasskey: vi.fn(),
  revokePasskeyDevice: vi.fn(),
}));

vi.mock('../../services/passkeyService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/passkeyService')>();
  return {
    ...actual,
    isPasskeySupported: () => true,
    fetchPasskeyDevices: svc.fetchPasskeyDevices,
    registerPasskey: svc.registerPasskey,
    revokePasskeyDevice: svc.revokePasskeyDevice,
  };
});

import { PersonalMcpHubCard } from './PersonalMcpHubCard';

const device = {
  credential_id: 'cred-1',
  user_id: 'usr-abc',
  role: 'user',
  device_name: 'Windows Hello (Chrome)',
};

describe('PersonalMcpHubCard passkeys', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 }))
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows the saved passkey right after registration', async () => {
    svc.fetchPasskeyDevices
      .mockResolvedValueOnce({ ok: true, devices: [] })
      // Even if the re-list lags, the verified device is merged in.
      .mockResolvedValueOnce({ ok: true, devices: [] });
    svc.registerPasskey.mockResolvedValue({ ok: true, device });

    render(<PersonalMcpHubCard userId="a@b.c" userEmail="a@b.c" userName="A" />);
    await screen.findByText(/No passkey devices registered/);

    fireEvent.click(screen.getByRole('button', { name: /Register Passkey/ }));

    expect(await screen.findByText('Windows Hello (Chrome)')).toBeTruthy();
    expect(screen.getByText('Passkey saved for this account.')).toBeTruthy();
    expect(screen.queryByText(/No passkey devices registered/)).toBeNull();
    expect(svc.registerPasskey).toHaveBeenCalledTimes(1);
  });

  it('shows the real error when the device list cannot be loaded', async () => {
    svc.fetchPasskeyDevices.mockResolvedValue({
      ok: false,
      devices: [],
      error: 'Your session expired. Sign in again to manage passkeys.',
    });
    render(<PersonalMcpHubCard userId="a@b.c" userEmail="a@b.c" />);
    expect(await screen.findByText(/Sign in again to manage passkeys/)).toBeTruthy();
  });

  it('shows the registration error instead of an empty success', async () => {
    svc.fetchPasskeyDevices.mockResolvedValue({ ok: true, devices: [] });
    svc.registerPasskey.mockResolvedValue({
      ok: false,
      error: 'Passkey setup was cancelled or timed out.',
    });
    render(<PersonalMcpHubCard userId="a@b.c" userEmail="a@b.c" />);
    await waitFor(() => expect(svc.fetchPasskeyDevices).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Register Passkey/ }));
    expect(await screen.findByText('Passkey setup was cancelled or timed out.')).toBeTruthy();
  });
});
