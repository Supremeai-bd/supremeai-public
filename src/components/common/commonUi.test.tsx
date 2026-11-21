import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DangerConfirmModal } from './DangerConfirmModal';
import { OfflineIndicator } from './OfflineIndicator';
import { PWAInstallButton } from './PWAInstallButton';

const pwaHookMock = vi.hoisted(() => ({
  isInstallable: false,
  isInstalled: false,
  isIOS: false,
  install: vi.fn(async () => true),
}));

const onlineHookMock = vi.hoisted(() => ({
  online: true,
}));

vi.mock('../../hooks/usePWAInstall', () => ({
  usePWAInstall: () => pwaHookMock,
}));

vi.mock('../../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => onlineHookMock.online,
}));

describe('Common UI components (PWAInstallButton, OfflineIndicator, DangerConfirmModal)', () => {
  afterEach(() => {
    cleanup();
    pwaHookMock.isInstallable = false;
    pwaHookMock.isInstalled = false;
    pwaHookMock.isIOS = false;
    pwaHookMock.install.mockClear();
    onlineHookMock.online = true;
  });

  it('renders Install App button when browser install prompt is available and triggers install()', () => {
    pwaHookMock.isInstallable = true;
    render(<PWAInstallButton />);
    const btn = screen.getByRole('button', { name: /Install App/i });
    fireEvent.click(btn);
    expect(pwaHookMock.install).toHaveBeenCalledTimes(1);
  });

  it('hides PWAInstallButton when already installed and shows iOS guide on iOS', () => {
    pwaHookMock.isInstalled = true;
    const { container, rerender } = render(<PWAInstallButton />);
    expect(container.firstChild).toBeNull();

    pwaHookMock.isInstalled = false;
    pwaHookMock.isIOS = true;
    rerender(<PWAInstallButton />);
    fireEvent.click(screen.getByRole('button', { name: /Install/i }));
    expect(screen.getByText(/Install on iPhone \/ iPad/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Close$/i }));
    expect(screen.queryByText(/Install on iPhone \/ iPad/i)).toBeNull();
  });

  it('renders OfflineIndicator only when navigator is offline', () => {
    onlineHookMock.online = true;
    const { container, rerender } = render(<OfflineIndicator />);
    expect(container.firstChild).toBeNull();

    onlineHookMock.online = false;
    rerender(<OfflineIndicator />);
    expect(screen.getByRole('status').textContent).toContain('Offline Mode');
  });

  it('handles DangerConfirmModal cancel, confirm, and executing states', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    const { rerender } = render(
      <DangerConfirmModal
        dangerConfirm={{
          action: 'flush_dlq',
          title: 'Flush Dead-Letter Queue?',
          description: 'Re-queues failed jobs.',
        }}
        isRunning={false}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByText('Flush Dead-Letter Queue?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Confirm Action/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <DangerConfirmModal
        dangerConfirm={{
          action: 'flush_dlq',
          title: 'Flush Dead-Letter Queue?',
          description: 'Re-queues failed jobs.',
        }}
        isRunning={true}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
    const executingBtn = screen.getByRole('button', { name: /Executing\.\.\./i });
    expect((executingBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
