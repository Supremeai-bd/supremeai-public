/**
 * বাংলা মন্তব্য: Web, Desktop (Tauri), Mobile (Android/iOS) এবং VS Code Extension-এর মধ্যে
 * মডেল, অটো-রাউটিং, পার্সোনা/রোল, কাস্টম ইনস্ট্রাকশন, রান সেটিংস, ভাষা (EN/বাংলা), থিম, প্লাগইন,
 * ভয়েস/অ্যাভাটার এবং চ্যাট সেশনগুলো একযোগে রিয়েল-টাইমে সিঙ্ক রাখার কেন্দ্রীয় কোঅর্ডিনেটর।
 */
import type { ChatSession, KnowledgeDoc, PluginItem, WorkbenchRunSettings } from '../types';
import {
  RealtimeSyncClient,
  loadSyncEnabled,
  setActiveRealtimeSyncClient,
  type SyncEnvelope,
  type SyncModelsPayload,
  type SyncRoleSelectionPayload,
  type SyncThemePayload,
} from './realtimeSync';
import {
  applyRemotePreferencesBundle,
  buildCurrentPreferencesSnapshot,
} from '../services/userPreferencesHydrator';
import {
  isPreferencesHydrating,
  setPreferencesHydrating,
} from '../services/userPreferencesSyncBus';
import { useThemeStore } from '../stores/useThemeStore';
import { useChatStore } from '../stores/useChatStore';
import { useCustomerStore } from '../stores/useCustomerStore';
import { useAppPreferencesStore } from '../stores/useAppPreferencesStore';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { useAuthStore } from '../stores/useAuthStore';
import { ttsService } from '../services/ttsService';
import { saveAvatarPreference, type AvatarPreference } from '../utils/hologramAvatar';

export const SYNC_ACTIVITY_EVENT = 'supremeai-sync-activity';

let suppressOutgoingDepth = 0;

export function isApplyingRemoteSync(): boolean {
  return suppressOutgoingDepth > 0 || isPreferencesHydrating();
}

function withRemoteSyncGuard(fn: () => void): void {
  suppressOutgoingDepth += 1;
  setPreferencesHydrating(true);
  try {
    fn();
  } finally {
    setPreferencesHydrating(false);
    suppressOutgoingDepth = Math.max(0, suppressOutgoingDepth - 1);
  }
}

/**
 * বাংলা মন্তব্য: যেকোনো প্ল্যাটফর্ম থেকে আগত `SyncEnvelope` লোকাল স্টোরগুলোতে নিরাপদে প্রয়োগ করে।
 */
export function applyIncomingSyncEnvelope(envelope: SyncEnvelope): void {
  if (!envelope || !envelope.domain || envelope.payload === undefined || envelope.payload === null) {
    return;
  }

  withRemoteSyncGuard(() => {
    switch (envelope.domain) {
      case 'theme': {
        if (typeof envelope.payload === 'object') {
          useThemeStore.getState().applyRemoteThemeConfig(envelope.payload as SyncThemePayload);
        }
        break;
      }

      case 'models': {
        const m = envelope.payload as Partial<SyncModelsPayload>;
        if (!m || typeof m !== 'object') break;
        if (typeof m.autoModelRouting === 'boolean' || typeof m.defaultModel === 'string') {
          useCustomerStore.getState().applyRemoteSettings({
            ...(typeof m.autoModelRouting === 'boolean'
              ? { autoModelRouting: m.autoModelRouting }
              : {}),
            ...(typeof m.defaultModel === 'string' ? { defaultModel: m.defaultModel } : {}),
          });
        }
        useChatStore.getState().applyRemoteChatPrefs({
          ...(typeof m.selectedModelId === 'string' ? { selectedModelId: m.selectedModelId } : {}),
          ...(typeof m.autoModelRouting === 'boolean'
            ? { autoModelRouting: m.autoModelRouting }
            : {}),
          ...(m.runSettings && typeof m.runSettings === 'object'
            ? { runSettings: m.runSettings as Partial<WorkbenchRunSettings> }
            : {}),
        });
        break;
      }

      case 'roles': {
        const payload = envelope.payload as Partial<SyncRoleSelectionPayload> | unknown[];
        if (payload && !Array.isArray(payload) && typeof payload === 'object') {
          useChatStore.getState().applyRemoteChatPrefs({
            ...(typeof payload.activeRoleId === 'string'
              ? { activeRoleId: payload.activeRoleId }
              : {}),
            ...(typeof payload.customInstruction === 'string'
              ? { customInstruction: payload.customInstruction }
              : {}),
          });
        }
        break;
      }

      case 'preferences': {
        if (typeof envelope.payload === 'object' && !Array.isArray(envelope.payload)) {
          applyRemotePreferencesBundle(envelope.payload as Record<string, unknown>);
        }
        break;
      }

      case 'chats': {
        const items = Array.isArray(envelope.payload)
          ? (envelope.payload as ChatSession[])
          : Array.isArray((envelope.payload as { items?: unknown[] })?.items)
            ? ((envelope.payload as { items: ChatSession[] }).items)
            : null;
        if (items && items.length > 0) {
          useChatStore.getState().applyRemoteSyncedSessions(items);
        }
        break;
      }

      case 'plugins': {
        const plugins = Array.isArray(envelope.payload)
          ? (envelope.payload as PluginItem[])
          : Array.isArray((envelope.payload as { items?: unknown[] })?.items)
            ? ((envelope.payload as { items: PluginItem[] }).items)
            : null;
        if (plugins) {
          useCustomerStore.getState().applyRemotePlugins(plugins);
        }
        break;
      }

      case 'knowledge': {
        const docs = Array.isArray(envelope.payload)
          ? (envelope.payload as KnowledgeDoc[])
          : Array.isArray((envelope.payload as { items?: unknown[] })?.items)
            ? ((envelope.payload as { items: KnowledgeDoc[] }).items)
            : null;
        if (docs) {
          useCustomerStore.setState({ knowledgeDocs: docs });
        }
        break;
      }

      case 'voice_avatar': {
        const va = envelope.payload as {
          voice?: Record<string, unknown>;
          avatar?: AvatarPreference;
        };
        if (va?.voice && typeof va.voice === 'object') {
          ttsService.updateConfig(
            {
              ...(va.voice.language === 'bn' || va.voice.language === 'en'
                ? { language: va.voice.language }
                : {}),
              ...(typeof va.voice.voicePersona === 'string'
                ? {
                    voicePersona:
                      va.voice.voicePersona as ReturnType<typeof ttsService.getConfig>['voicePersona'],
                  }
                : {}),
              ...(typeof va.voice.pitch === 'number' ? { pitch: va.voice.pitch } : {}),
              ...(va.voice.banglaAccent === 'bn-bd' || va.voice.banglaAccent === 'bn-in'
                ? { banglaAccent: va.voice.banglaAccent }
                : {}),
            },
            { syncRemote: false }
          );
        }
        if (va?.avatar && typeof va.avatar === 'object') {
          saveAvatarPreference(va.avatar, false);
        }
        break;
      }

      default:
        break;
    }
  });
}

/**
 * বাংলা মন্তব্য: অ্যাপ বুট হওয়ার সময় সব স্টোরের সাথে `RealtimeSyncClient` যুক্ত করে এবং আনমাউন্টে পরিষ্কারভাবে বন্ধ করে।
 */
export function startUnifiedPlatformSync(): () => void {
  let chatSessionTimer: ReturnType<typeof setTimeout> | null = null;
  let prefsDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const client = new RealtimeSyncClient({
    onEnvelope: (envelope) => {
      applyIncomingSyncEnvelope(envelope);
    },
    onSyncActivity: (ts) => {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent(SYNC_ACTIVITY_EVENT, { detail: { timestamp: ts } }));
      }
    },
  });

  setActiveRealtimeSyncClient(client);
  if (loadSyncEnabled()) {
    client.start();
  }

  // ১) থিম সিঙ্ক (Web <-> Desktop <-> Mobile <-> VS Code)
  const unsubTheme = useThemeStore.subscribe((state, prev) => {
    if (isApplyingRemoteSync()) return;
    if (
      state.themeMode !== prev.themeMode ||
      state.liveTheme !== prev.liveTheme ||
      state.liveMotion !== prev.liveMotion ||
      state.motionSpeed !== prev.motionSpeed ||
      state.surfaceTone !== prev.surfaceTone ||
      state.scrimIntensity !== prev.scrimIntensity
    ) {
      client.publish<SyncThemePayload>('theme', {
        themeMode: state.themeMode,
        liveTheme: state.liveTheme,
        liveMotion: state.liveMotion,
        motionSpeed: state.motionSpeed,
        surfaceTone: state.surfaceTone,
        scrimIntensity: state.scrimIntensity,
      });
    }
  });

  // ২) মডেল, রান-সেটিংস, রোল/পার্সোনা, কাস্টম ইনস্ট্রাকশন এবং চ্যাট সেশন সিঙ্ক
  const unsubChat = useChatStore.subscribe((state, prev) => {
    if (isApplyingRemoteSync()) return;

    const modelChanged = state.activeModel.id !== prev.activeModel.id;
    const runSettingsChanged = state.runSettings !== prev.runSettings;
    if (modelChanged || runSettingsChanged) {
      const autoRouting = useCustomerStore.getState().userSettings.autoModelRouting !== false;
      client.publish<SyncModelsPayload>('models', {
        selectedModelId: state.activeModel.id,
        autoModelRouting: autoRouting,
        defaultModel: state.activeModel.id,
        runSettings: state.runSettings,
      });
    }

    if (
      state.activeRole.id !== prev.activeRole.id ||
      state.customInstruction !== prev.customInstruction
    ) {
      client.publish<SyncRoleSelectionPayload>('roles', {
        activeRoleId: state.activeRole.id,
        customInstruction: state.customInstruction,
      });
    }

    if (state.sessions !== prev.sessions && !state.isStreaming) {
      if (chatSessionTimer) clearTimeout(chatSessionTimer);
      chatSessionTimer = setTimeout(() => {
        chatSessionTimer = null;
        if (!isApplyingRemoteSync() && !useChatStore.getState().isStreaming) {
          client.publish('chats', useChatStore.getState().sessions.slice(0, 30));
        }
      }, 650);
    }
  });

  // ৩) ইউজার সেটিংস (Auto-Routing, Language EN/বাংলা, Grounding, Layout, Plugins) সিঙ্ক
  const unsubCustomer = useCustomerStore.subscribe((state, prev) => {
    if (isApplyingRemoteSync()) return;

    const autoChanged =
      (state.userSettings.autoModelRouting !== false) !==
      (prev.userSettings.autoModelRouting !== false);
    const defaultModelChanged =
      state.userSettings.defaultModel !== prev.userSettings.defaultModel;

    if (autoChanged || defaultModelChanged) {
      const chatState = useChatStore.getState();
      client.publish<SyncModelsPayload>('models', {
        selectedModelId: state.userSettings.defaultModel || chatState.activeModel.id,
        autoModelRouting: state.userSettings.autoModelRouting !== false,
        defaultModel: state.userSettings.defaultModel,
        runSettings: chatState.runSettings,
      });
    }

    if (state.userSettings !== prev.userSettings) {
      if (prefsDebounceTimer) clearTimeout(prefsDebounceTimer);
      prefsDebounceTimer = setTimeout(() => {
        prefsDebounceTimer = null;
        if (!isApplyingRemoteSync()) {
          client.publish('preferences', buildCurrentPreferencesSnapshot());
        }
      }, 250);
    }

    if (state.userPlugins !== prev.userPlugins) {
      client.publish('plugins', state.userPlugins);
    }
  });

  // ৪) অ্যাপ ভাষা স্টোর সিঙ্ক
  const unsubAppPrefs = useAppPreferencesStore.subscribe((state, prev) => {
    if (isApplyingRemoteSync()) return;
    if (state.language !== prev.language) {
      if (prefsDebounceTimer) clearTimeout(prefsDebounceTimer);
      prefsDebounceTimer = setTimeout(() => {
        prefsDebounceTimer = null;
        if (!isApplyingRemoteSync()) {
          client.publish('preferences', buildCurrentPreferencesSnapshot());
        }
      }, 200);
    }
  });

  // ৫) ওয়ার্কস্পেস লাইভ আর্টিফ্যাক্ট অপশন সিঙ্ক
  const unsubWorkspace = useWorkspaceStore.subscribe((state, prev) => {
    if (isApplyingRemoteSync()) return;
    if (state.liveArtifactSync !== prev.liveArtifactSync) {
      client.publish('preferences', buildCurrentPreferencesSnapshot());
    }
  });

  // ৬) ইউজার লগইন/সেশন রিস্টোর হলে সাথে সাথে ক্লাউড সিঙ্ক পুনঃসংযোগ
  const unsubAuth = useAuthStore.subscribe((state, prev) => {
    if (state.authUser?.email && state.authUser?.email !== prev.authUser?.email) {
      if (loadSyncEnabled()) {
        client.stop();
        client.start();
      }
    }
  });

  return () => {
    if (chatSessionTimer) clearTimeout(chatSessionTimer);
    if (prefsDebounceTimer) clearTimeout(prefsDebounceTimer);
    unsubTheme();
    unsubChat();
    unsubCustomer();
    unsubAppPrefs();
    unsubWorkspace();
    unsubAuth();
    setActiveRealtimeSyncClient(null);
    client.stop();
  };
}
