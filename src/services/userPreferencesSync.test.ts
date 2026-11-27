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

import {
  clearPendingPreferences,
  flushPendingPreferences,
  schedulePreferencesPatch,
} from './userPreferencesSyncBus';
import { hydrateUserPreferencesFromServer } from './userPreferencesHydrator';
import { useCustomerStore } from '../stores/useCustomerStore';
import { useThemeStore } from '../stores/useThemeStore';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { useChatStore } from '../stores/useChatStore';
import { ttsService } from './ttsService';
import { loadAvatarPreference } from '../utils/hologramAvatar';
import { loadMicInputGainPreference } from '../utils/speechUtils';

describe('Cross-Device User Preferences Sync', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as unknown as { localStorage: Storage }).localStorage = createMemoryStorage();
    (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = createMemoryStorage();
    clearPendingPreferences();
  });

  afterEach(() => {
    clearPendingPreferences();
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('hydrates stores from server on login without triggering a feedback POST echo loop', async () => {
    localStorage.setItem('supremeai_access_token', 'tok_user_device_b');

    const postBodies: Array<Record<string, unknown>> = [];
    let getCount = 0;

    globalThis.fetch = vi.fn(async (url, init) => {
      const urlStr = String(url);
      const method = (init?.method || 'GET').toUpperCase();
      if (urlStr.includes('/api/v1/user/preferences') && method === 'GET') {
        getCount += 1;
        return new Response(
          JSON.stringify({
            user_id: 'device@test.com',
            preferences: {
              studio_settings: {
                language: 'bn',
                defaultModel: 'supreme-deep',
                customInstructions: 'Always answer concisely in Bangla.',
                layoutMode: 'classic',
                contentLayout: 'centered',
              },
              theme_config: {
                themeMode: 'light',
                liveTheme: 'aurora-borealis',
                liveMotion: false,
                motionSpeed: 'calm',
              },
              voice_tts_config: {
                language: 'bn',
                voicePersona: 'Kore',
                pitch: 1.2,
                banglaAccent: 'bn-in',
                micGain: 1.75,
              },
              avatar_pref: {
                preset: 'male',
                customImageDataUrl: null,
              },
              workspace_prefs: {
                liveArtifactSync: false,
              },
              chat_prefs: {
                selectedModelId: 'supreme-reason',
                customInstruction: 'Synced instruction',
              },
            },
            updated_at: '2026-11-16T00:00:00Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (urlStr.includes('/api/v1/user/preferences') && method === 'POST') {
        postBodies.push(JSON.parse(String(init?.body || '{}')));
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const ok = await hydrateUserPreferencesFromServer();
    await vi.runAllTimersAsync();

    expect(ok).toBe(true);
    expect(getCount).toBe(1);
    expect(postBodies).toHaveLength(0);

    const customerSettings = useCustomerStore.getState().userSettings;
    expect(customerSettings.language).toBe('bn');
    expect(customerSettings.defaultModel).toBe('supreme-deep');
    expect(customerSettings.layoutMode).toBe('classic');
    expect(customerSettings.contentLayout).toBe('centered');

    const themeState = useThemeStore.getState();
    // Smart Auto: a legacy 'light' mode from the server collapses to 'system'.
    expect(themeState.themeMode).toBe('system');
    expect(themeState.liveTheme).toBe('aurora-borealis');
    expect(themeState.liveMotion).toBe(false);

    const ttsCfg = ttsService.getConfig();
    expect(ttsCfg.language).toBe('bn');
    expect(ttsCfg.voicePersona).toBe('Kore');
    expect(ttsCfg.pitch).toBe(1.2);
    expect(ttsCfg.banglaAccent).toBe('bn-in');
    expect(loadMicInputGainPreference()).toBe(1.75);
    expect(loadAvatarPreference().preset).toBe('male');
    expect(useWorkspaceStore.getState().liveArtifactSync).toBe(false);
    expect(useChatStore.getState().activeModel.id).toBe('supreme-reason');
    expect(useChatStore.getState().customInstruction).toBe('Synced instruction');
  });

  it('pushes initial snapshot once during first-time account migration when server has no studio/theme prefs', async () => {
    localStorage.setItem('supremeai_access_token', 'tok_user_first_sync');
    const postBodies: Array<Record<string, unknown>> = [];

    globalThis.fetch = vi.fn(async (url, init) => {
      const urlStr = String(url);
      const method = (init?.method || 'GET').toUpperCase();
      if (urlStr.includes('/api/v1/user/preferences') && method === 'GET') {
        return new Response(
          JSON.stringify({
            user_id: 'new@test.com',
            preferences: {},
            updated_at: '2026-11-16T00:00:00Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (urlStr.includes('/api/v1/user/preferences') && method === 'POST') {
        postBodies.push(JSON.parse(String(init?.body || '{}')));
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const ok = await hydrateUserPreferencesFromServer();
    expect(ok).toBe(true);
    expect(postBodies).toHaveLength(1);
    expect(postBodies[0]).toHaveProperty('studio_settings');
    expect(postBodies[0]).toHaveProperty('theme_config');
    expect(postBodies[0]).toHaveProperty('voice_tts_config');
  });

  it('coalesces rapid preference updates into a single debounced POST request', async () => {
    localStorage.setItem('supremeai_access_token', 'tok_user_coalesce');
    const postBodies: Array<Record<string, unknown>> = [];

    globalThis.fetch = vi.fn(async (_url, init) => {
      postBodies.push(JSON.parse(String(init?.body || '{}')));
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    }) as typeof fetch;

    useCustomerStore.getState().updateSettings({ language: 'bn', streamResponses: false });
    useWorkspaceStore.getState().setLiveArtifactSync(true);
    useChatStore.getState().setCustomInstruction('Use crisp Bangla');
    schedulePreferencesPatch({ theme_config: { themeMode: 'dark' } });

    await vi.advanceTimersByTimeAsync(400);
    await flushPendingPreferences();

    expect(postBodies).toHaveLength(1);
    expect(postBodies[0]).toHaveProperty('studio_settings');
    expect(postBodies[0]).toHaveProperty('workspace_prefs', { liveArtifactSync: true });
    expect(postBodies[0]).toHaveProperty('chat_prefs');
    expect(postBodies[0]).toHaveProperty('theme_config', { themeMode: 'dark' });
  });

  it('stays local-only in guest mode when no user access token exists', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;

    useCustomerStore.getState().updateSettings({ language: 'en', showWorkspaceTips: false });
    useWorkspaceStore.getState().setLiveArtifactSync(false);
    await vi.advanceTimersByTimeAsync(500);
    await flushPendingPreferences();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
