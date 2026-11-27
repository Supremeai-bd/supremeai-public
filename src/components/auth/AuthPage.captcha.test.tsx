import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const siteKeyMock = vi.fn<() => Promise<string>>();
vi.mock('../../utils/turnstile', () => ({
  fetchTurnstileSiteKey: () => siteKeyMock(),
}));

// The real widget needs Cloudflare's script; this stub hands out a token immediately.
vi.mock('./TurnstileWidget', () => ({
  TurnstileWidget: ({ onToken }: { onToken: (t: string | null) => void }) => (
    <button type="button" data-testid="turnstile-widget" onClick={() => onToken('tok-123')}>
      solve
    </button>
  ),
}));

vi.mock('../theme/LiveScreenBackdrop', () => ({ LiveScreenBackdrop: () => null }));
vi.mock('../theme/ThemeControlPopover', () => ({ ThemeControlPopover: () => null }));

const loginMock = vi.fn(async () => false);
vi.mock('../../stores/useAuthStore', () => {
  const state = {
    login: (...args: unknown[]) => loginMock(...(args as [])),
    signup: vi.fn(async () => false),
    clearAuthError: vi.fn(),
    authUser: null,
    authError: 'nope',
  };
  const useAuthStore = Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
    getState: () => state,
  });
  return { useAuthStore };
});

vi.mock('../../stores/usePlatformStore', () => {
  const state = { config: { allowNewSignups: true }, fetchConfig: vi.fn() };
  return {
    usePlatformStore: (selector: (s: typeof state) => unknown) => selector(state),
  };
});

import { AuthPage } from './AuthPage';

function fillAndSubmit(container: HTMLElement) {
  fireEvent.change(container.querySelector('input[type="email"]') as HTMLInputElement, {
    target: { value: 'a@b.co' },
  });
  fireEvent.change(container.querySelector('input[type="password"]') as HTMLInputElement, {
    target: { value: 'secret-pass' },
  });
  fireEvent.submit(container.querySelector('form') as HTMLFormElement);
}

describe('AuthPage Turnstile wiring', () => {
  afterEach(() => {
    cleanup();
    loginMock.mockClear();
  });

  it('does not render the widget and logs in normally when captcha is disabled', async () => {
    siteKeyMock.mockResolvedValue('');
    const { container } = render(<AuthPage onLoginSuccess={vi.fn()} />);
    await waitFor(() => expect(siteKeyMock).toHaveBeenCalled());
    expect(screen.queryByTestId('turnstile-widget')).toBeNull();
    fillAndSubmit(container);
    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('a@b.co', 'secret-pass', null));
  });

  it('waits for a token, then sends it with the login request', async () => {
    siteKeyMock.mockResolvedValue('0xSITE');
    const { container } = render(<AuthPage onLoginSuccess={vi.fn()} />);
    const widget = await screen.findByTestId('turnstile-widget');

    fillAndSubmit(container);
    expect(loginMock).not.toHaveBeenCalled();

    fireEvent.click(widget);
    fillAndSubmit(container);
    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('a@b.co', 'secret-pass', 'tok-123'));
  });
});
