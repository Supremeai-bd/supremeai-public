import type { PluginItem, UserAccountSettings } from '../types';
import {
  clearPendingPreferences,
  fetchRemotePreferences,
  pushPreferencesNow,
  setPreferencesHydrating,
} from './userPreferencesSyncBus';
import { useCustomerStore } from '../stores/useCustomerStore';
import { useThemeStore, type ThemePersistedConfig } from '../stores/useThemeStore';
import { useAppPreferencesStore } from '../stores/useAppPreferencesStore';
import { ttsService } from './ttsService';
import {
  loadAvatarPreference,
  saveAvatarPreference,
  type AvatarPreference,
} from '../utils/hologramAvatar';
import { loadMicInputGainPreference, saveMicInputGainPreference } from '../utils/speechUtils';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { useChatStore } from '../stores/useChatStore';

const MAX_SYNC_AVATAR_DATA_URL_LEN = 220_000;

export function sanitizeAvatarPrefForSync(pref: AvatarPreference): AvatarPreference {
  if (pref.customImageDataUrl && pref.customImageDataUrl.length > MAX_SYNC_AVATAR_DATA_URL_LEN) {
    return {
      preset: pref.preset === 'custom' ? 'female' : pref.preset,
      customImageDataUrl: null,
      customImageName: pref.customImageName,
      customTraits: pref.customTraits,
    };
  }
  return pref;
}

export function buildCurrentPreferencesSnapshot(): Record<string, unknown> {
  const customerState = useCustomerStore.getState();
  const themeState = useThemeStore.getState();
  const ttsCfg = ttsService.getConfig();
  const avatarPref = sanitizeAvatarPrefForSync(loadAvatarPreference());
  const micGain = loadMicInputGainPreference();
  const workspaceState = useWorkspaceStore.getState();
  const chatState = useChatStore.getState();

  const {
    monthlyTokensUsed: _unusedUsed,
    monthlyTokensLimit: _unusedLimit,
    plan: _unusedPlan,
    ...syncableSettings
  } = customerState.userSettings;

  return {
    studio_settings: syncableSettings,
    theme_config: {
      themeMode: themeState.themeMode,
      liveTheme: themeState.liveTheme,
      liveMotion: themeState.liveMotion,
      overrideReducedMotion: themeState.overrideReducedMotion,
      motionSpeed: themeState.motionSpeed,
      surfaceTone: themeState.surfaceTone,
      scrimIntensity: themeState.scrimIntensity,
      themeOptions: themeState.themeOptions,
    },
    voice_tts_config: {
      language: ttsCfg.language,
      voicePersona: ttsCfg.voicePersona,
      pitch: ttsCfg.pitch,
      banglaAccent: ttsCfg.banglaAccent,
      micGain,
    },
    avatar_pref: avatarPref,
    user_plugins: customerState.userPlugins,
    workspace_prefs: {
      liveArtifactSync: workspaceState.liveArtifactSync,
    },
    chat_prefs: {
      selectedModelId: chatState.activeModel?.id,
      autoModelRouting: customerState.userSettings.autoModelRouting !== false,
      activeRoleId: chatState.activeRole?.id,
      customInstruction: chatState.customInstruction,
      runSettings: chatState.runSettings,
      pinnedSessionIds: chatState.sessions.filter((s) => s.isPinned).map((s) => s.id),
    },
  };
}

/**
 * বাংলা মন্তব্য: রিমোট সার্ভার বা রিয়েল-টাইম SSE স্ট্রিম থেকে আগত প্রেফারেন্সগুলো ইকো-লুপ ছাড়াই সব লোকাল স্টোরে প্রয়োগ করে।
 */
export function applyRemotePreferencesBundle(remotePrefs: Record<string, unknown>): {
  hasRemoteStudio: boolean;
  hasRemoteTheme: boolean;
} {
  const hasRemoteStudio = Boolean(
    remotePrefs.studio_settings && typeof remotePrefs.studio_settings === 'object'
  );
  const hasRemoteTheme = Boolean(
    remotePrefs.theme_config && typeof remotePrefs.theme_config === 'object'
  );
  const hasRemoteVoice = Boolean(
    remotePrefs.voice_tts_config && typeof remotePrefs.voice_tts_config === 'object'
  );
  const hasRemoteAvatar = Boolean(
    remotePrefs.avatar_pref && typeof remotePrefs.avatar_pref === 'object'
  );
  const hasRemotePlugins = Array.isArray(remotePrefs.user_plugins);
  const hasRemoteWorkspace = Boolean(
    remotePrefs.workspace_prefs && typeof remotePrefs.workspace_prefs === 'object'
  );
  const hasRemoteChat = Boolean(
    remotePrefs.chat_prefs && typeof remotePrefs.chat_prefs === 'object'
  );

  clearPendingPreferences();
  setPreferencesHydrating(true);
  try {
    if (hasRemoteStudio) {
      const studio = remotePrefs.studio_settings as Partial<UserAccountSettings>;
      useCustomerStore.getState().applyRemoteSettings(studio);
      if (studio.language === 'bn' || studio.language === 'en') {
        useAppPreferencesStore.setState({ language: studio.language });
      }
    }

    if (hasRemotePlugins) {
      useCustomerStore.getState().applyRemotePlugins(remotePrefs.user_plugins as PluginItem[]);
    }

    if (hasRemoteTheme) {
      useThemeStore
        .getState()
        .applyRemoteThemeConfig(remotePrefs.theme_config as Partial<ThemePersistedConfig>);
    }

    if (hasRemoteVoice) {
      const v = remotePrefs.voice_tts_config as Record<string, unknown>;
      ttsService.updateConfig(
        {
          ...(v.language === 'bn' || v.language === 'en' ? { language: v.language } : {}),
          ...(typeof v.voicePersona === 'string'
            ? { voicePersona: v.voicePersona as ReturnType<typeof ttsService.getConfig>['voicePersona'] }
            : {}),
          ...(typeof v.pitch === 'number' ? { pitch: v.pitch } : {}),
          ...(v.banglaAccent === 'bn-bd' || v.banglaAccent === 'bn-in'
            ? { banglaAccent: v.banglaAccent }
            : {}),
        },
        { syncRemote: false }
      );
      if (typeof v.micGain === 'number') {
        saveMicInputGainPreference(v.micGain, false);
      }
    }

    if (hasRemoteAvatar) {
      saveAvatarPreference(remotePrefs.avatar_pref as AvatarPreference, false);
    }

    if (hasRemoteWorkspace) {
      const wp = remotePrefs.workspace_prefs as Record<string, unknown>;
      if (typeof wp.liveArtifactSync === 'boolean') {
        useWorkspaceStore.getState().setLiveArtifactSync(wp.liveArtifactSync);
      }
    }

    if (hasRemoteChat) {
      const chatPrefs = remotePrefs.chat_prefs as Record<string, unknown>;
      useChatStore.getState().applyRemoteChatPrefs(chatPrefs);
    }
  } finally {
    setPreferencesHydrating(false);
  }

  return { hasRemoteStudio, hasRemoteTheme };
}

let activeHydrationPromise: Promise<boolean> | null = null;

export async function hydrateUserPreferencesFromServer(): Promise<boolean> {
  if (activeHydrationPromise) {
    return activeHydrationPromise;
  }

  const run = (async (): Promise<boolean> => {
    const remotePrefs = await fetchRemotePreferences();
    if (!remotePrefs) return false;

    const { hasRemoteStudio, hasRemoteTheme } = applyRemotePreferencesBundle(remotePrefs);

    // First-time migration: if account has no synced studio/theme prefs on server yet,
    // push current local snapshot once so other devices receive it immediately.
    if (!hasRemoteStudio && !hasRemoteTheme) {
      await pushPreferencesNow(buildCurrentPreferencesSnapshot());
    }

    return true;
  })();

  activeHydrationPromise = run;
  try {
    return await run;
  } finally {
    if (activeHydrationPromise === run) {
      activeHydrationPromise = null;
    }
  }
}
