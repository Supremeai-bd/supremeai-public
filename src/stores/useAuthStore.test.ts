import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from './useAuthStore';
import { authService } from '../services/authService';

describe('useAuthStore error surfacing on sign-in & sign-up', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({
      authUser: null,
      authError: null,
      isLoading: false,
      currentRole: 'user',
    });
  });

  it('records exact server error message in authError when login fails', async () => {
    vi.spyOn(authService, 'login').mockRejectedValue(
      new Error('Upstream auth gateway temporarily unavailable (504)')
    );

    const ok = await useAuthStore.getState().login('user@example.com', 'secret123');
    expect(ok).toBe(false);
    expect(useAuthStore.getState().authError).toBe(
      'Upstream auth gateway temporarily unavailable (504)'
    );
    expect(useAuthStore.getState().isLoading).toBe(false);

    useAuthStore.getState().clearAuthError();
    expect(useAuthStore.getState().authError).toBeNull();
  });

  it('records exact error message in authError when signup fails', async () => {
    vi.spyOn(authService, 'signup').mockRejectedValue(
      new Error('An account with this email already exists.')
    );

    const ok = await useAuthStore.getState().signup('Test User', 'taken@example.com', 'secret123');
    expect(ok).toBe(false);
    expect(useAuthStore.getState().authError).toBe('An account with this email already exists.');
    expect(useAuthStore.getState().isLoading).toBe(false);
  });
});
