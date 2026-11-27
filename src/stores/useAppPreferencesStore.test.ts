import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createMemoryStorage = vi.hoisted(() => {
  const factory = (): Storage => {
    const store: Record<string, string> = {};
    return {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
      get length() {
        return Object.keys(store).length;
      },
    };
  };
  if (typeof globalThis.localStorage === 'undefined') {
    (globalThis as unknown as { localStorage: Storage }).localStorage = factory();
  }
  if (typeof globalThis.sessionStorage === 'undefined') {
    (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = factory();
  }
  return factory;
});

import { useAppPreferencesStore } from './useAppPreferencesStore';
import { useAuthStore } from './useAuthStore';
import { useCustomerStore } from './useCustomerStore';
import { ttsService } from '../services/ttsService';

describe('useAppPreferencesStore (centralized language & role state)', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = createMemoryStorage();
    (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = createMemoryStorage();
    useAppPreferencesStore.getState().setLanguage('en', { silent: true });
    useAuthStore.setState({
      authUser: null,
      currentRole: 'user',
      trustedBrowserUntil: null,
      isTwoFactorModalOpen: false,
      impersonatedCustomer: null,
    });
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('synchronizes centralized language with useCustomerStore and ttsService', () => {
    useAppPreferencesStore.getState().setLanguage('bn', { silent: true });

    expect(useAppPreferencesStore.getState().language).toBe('bn');
    expect(useCustomerStore.getState().userSettings.language).toBe('bn');
    expect(ttsService.getConfig().language).toBe('bn');

    useCustomerStore.getState().applyRemoteSettings({ language: 'en' });
    expect(useAppPreferencesStore.getState().language).toBe('en');
    expect(ttsService.getConfig().language).toBe('en');
  });

  it('keeps a Bangla regional dialect instead of snapping back to English', () => {
    for (const dialect of ['bn-ctg', 'bn-syl', 'bn-raj', 'bn-nkh'] as const) {
      useAppPreferencesStore.getState().setLanguage(dialect, { silent: true });
      expect(useAppPreferencesStore.getState().language).toBe(dialect);
      expect(useCustomerStore.getState().userSettings.language).toBe(dialect);
      expect(
        JSON.parse(localStorage.getItem('supremeai_studio_user_settings') || '{}').language
      ).toBe(dialect);
      // TTS has only Bangla/English voices — every dialect speaks Bangla.
      expect(ttsService.getConfig().language).toBe('bn');
    }
  });

  it('accepts a dialect from cross-device sync and ignores unknown codes', () => {
    useCustomerStore.getState().applyRemoteSettings({ language: 'bn-syl' });
    expect(useAppPreferencesStore.getState().language).toBe('bn-syl');

    useCustomerStore.getState().applyRemoteSettings({ language: 'xx-unknown' });
    expect(useAppPreferencesStore.getState().language).toBe('bn-syl');

    useCustomerStore.getState().applyRemoteSettings({ language: 'fr' });
    expect(useAppPreferencesStore.getState().language).toBe('fr');
  });

  it('enforces RBAC and 2FA trust when switching role via centralized store', () => {
    useAppPreferencesStore.getState().setRole('admin');
    expect(useAppPreferencesStore.getState().role).toBe('user');
    expect(useAuthStore.getState().currentRole).toBe('user');

    useAuthStore.setState({
      authUser: {
        id: 'admin-1',
        name: 'Admin User',
        email: 'admin@example.com',
        avatar: 'A',
        role: 'admin',
        isAdminEligible: true,
        isDeveloperEligible: true,
        plan: 'Enterprise',
        createdAt: '2026-01-01',
      },
      trustedBrowserUntil: Date.now() + 60_000,
    });

    useAppPreferencesStore.getState().setRole('admin');
    expect(useAppPreferencesStore.getState().role).toBe('admin');
    expect(useAuthStore.getState().currentRole).toBe('admin');

    useAppPreferencesStore.getState().setRole('user');
    expect(useAppPreferencesStore.getState().role).toBe('user');
    expect(useAuthStore.getState().currentRole).toBe('user');
  });
});
