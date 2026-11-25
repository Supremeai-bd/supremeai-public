/**
 * বাংলা মন্তব্য: Web, Desktop (Tauri), Mobile (Android/iOS) এবং VS Code Extension-এর মধ্যে
 * মডেল, পার্সোনা, থিম, ভাষা ও চ্যাট সেশন অভিন্নতা এবং রিয়েল-টাইম সিঙ্ক যাচাইয়ের ইউনিট টেস্ট।
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import modelsContract from '../../packages/contracts/models.json';
import rolesContract from '../../packages/contracts/roles.json';
import syncContract from '../../packages/contracts/sync-protocol.json';
import { SUPREMEAI_MODELS } from '../data/models';
import { SYSTEM_ROLES } from '../data/roles';
import {
  CANONICAL_SERVER_MODELS,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_POLICIES,
  normalizeConcreteModelId,
  normalizeModelSelection,
} from '../shared/platformCatalog';
import { isEmbeddedAppOrigin } from '../config/env';
import { detectSyncPlatform, mergeSyncedSessions, type SyncEnvelope } from './realtimeSync';
import { applyIncomingSyncEnvelope } from './unifiedSyncCoordinator';
import { useChatStore } from '../stores/useChatStore';
import { useCustomerStore } from '../stores/useCustomerStore';
import { useThemeStore } from '../stores/useThemeStore';
import { useAppPreferencesStore } from '../stores/useAppPreferencesStore';
import { onRequest as edgeModelsHandler } from '../../functions/api/models';
import { onRequest as edgePlatformConfigHandler } from '../../functions/api/platform/config';

describe('4-Platform Canonical Feature & Real-Time Sync Parity', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps Web, Desktop, Mobile, Edge, Server, and VS Code models & roles 100% identical to packages/contracts', async () => {
    expect(SUPREMEAI_MODELS.map((m) => m.id)).toEqual(modelsContract.models.map((m) => m.id));
    expect(SUPREMEAI_MODELS[0].id).toBe('supreme-spark');
    expect(SUPREMEAI_MODELS[1].id).toBe('supreme-core');
    expect(SUPREMEAI_MODELS).toHaveLength(6);

    expect(SYSTEM_ROLES.map((r) => r.id)).toEqual(rolesContract.roles.map((r) => r.id));
    expect(SYSTEM_ROLES).toHaveLength(5);

    expect(syncContract.platforms).toEqual(['web', 'desktop', 'android', 'ios', 'vsix']);
    expect(syncContract.domains).toContain('models');
    expect(syncContract.domains).toContain('preferences');
    expect(syncContract.domains).toContain('roles');

    // Verify all 6 foundation models are enabled by default in platform policies
    for (const model of SUPREMEAI_MODELS) {
      expect(DEFAULT_MODEL_POLICIES[model.id]?.enabled).toBe(true);
      expect(CANONICAL_SERVER_MODELS[model.id]?.name).toBe(model.name);
    }
    expect(CANONICAL_SERVER_MODELS.auto.name).toBe('SupremeAI Auto');

    // Verify Cloudflare Edge /api/models and /api/platform/config match canonical catalog
    const edgeModelsRes = await edgeModelsHandler({
      request: new Request('https://supremeai-studio.pages.dev/api/models'),
    });
    const edgeModelsJson = (await edgeModelsRes.json()) as {
      models: Record<string, unknown>;
      defaultModel: string;
    };
    expect(edgeModelsJson.defaultModel).toBe(DEFAULT_MODEL_ID);
    expect(Object.keys(edgeModelsJson.models)).toEqual(Object.keys(CANONICAL_SERVER_MODELS));

    const edgeCfgRes = await edgePlatformConfigHandler({
      request: new Request('https://supremeai-studio.pages.dev/api/platform/config'),
    });
    const edgeCfgJson = (await edgeCfgRes.json()) as {
      modelPolicies: Record<string, { enabled: boolean }>;
    };
    for (const model of SUPREMEAI_MODELS) {
      expect(edgeCfgJson.modelPolicies[model.id]?.enabled).toBe(true);
    }

    // Verify Tauri Rust native IPC supports all 6 canonical model IDs
    const rustSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src-tauri/src/lib.rs'),
      'utf8'
    );
    for (const model of SUPREMEAI_MODELS) {
      expect(rustSource).toContain(`"${model.id}"`);
    }
  });

  it('normalizes legacy and cross-surface model aliases cleanly', () => {
    expect(normalizeModelSelection('auto')).toBe('auto');
    expect(normalizeModelSelection('supreme-web')).toBe('supremeai-web');
    expect(normalizeModelSelection('supreme-api')).toBe('supremeai-api');
    expect(normalizeModelSelection('fast')).toBe('supreme-spark');
    expect(normalizeModelSelection('balanced')).toBe('supreme-core');
    expect(normalizeModelSelection('pro')).toBe('supreme-reason');
    expect(normalizeConcreteModelId('auto')).toBe(DEFAULT_MODEL_ID);
  });

  it('correctly identifies Android/iOS inside Tauri v2 and embedded app origins', () => {
    expect(
      detectSyncPlatform({
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36',
        isTauriRuntime: true,
        isVsCodeRuntime: false,
      })
    ).toBe('android');

    expect(
      detectSyncPlatform({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        isTauriRuntime: true,
        isVsCodeRuntime: false,
      })
    ).toBe('desktop');

    expect(
      detectSyncPlatform({
        userAgent: 'Mozilla/5.0 Code/1.95.0',
        isTauriRuntime: false,
        isVsCodeRuntime: true,
      })
    ).toBe('vsix');

    expect(isEmbeddedAppOrigin({ protocol: 'http:', hostname: 'tauri.localhost' })).toBe(true);
    expect(isEmbeddedAppOrigin({ protocol: 'tauri:', hostname: 'localhost' })).toBe(true);
    expect(isEmbeddedAppOrigin({ protocol: 'vscode-webview:', hostname: 'abc' })).toBe(true);
    expect(
      isEmbeddedAppOrigin({ protocol: 'https:', hostname: 'supremeai-studio.pages.dev' })
    ).toBe(false);
  });

  it('applies incoming real-time envelopes across models, roles, preferences, theme, and chats', () => {
    const modelEnv: SyncEnvelope = {
      protocolVersion: '1.0.0',
      deviceId: 'dev-vsix-remote',
      platform: 'vsix',
      domain: 'models',
      updatedAt: Date.now(),
      revision: 1,
      payload: {
        selectedModelId: 'supremeai-api',
        autoModelRouting: false,
        runSettings: {
          thinkingLevel: 'XHIGH',
          temperature: 0.25,
          enableSearchGrounding: false,
        },
      },
    };
    applyIncomingSyncEnvelope(modelEnv);

    expect(useChatStore.getState().activeModel.id).toBe('supremeai-api');
    expect(useCustomerStore.getState().userSettings.autoModelRouting).toBe(false);
    expect(useChatStore.getState().runSettings.thinkingLevel).toBe('XHIGH');
    expect(useChatStore.getState().runSettings.temperature).toBe(0.25);
    expect(useChatStore.getState().runSettings.enableSearchGrounding).toBe(false);

    const roleEnv: SyncEnvelope = {
      protocolVersion: '1.0.0',
      deviceId: 'dev-android-remote',
      platform: 'android',
      domain: 'roles',
      updatedAt: Date.now() + 10,
      revision: 2,
      payload: {
        activeRoleId: 'supreme-security',
        customInstruction: 'Check SSRF and RBAC invariants',
      },
    };
    applyIncomingSyncEnvelope(roleEnv);
    expect(useChatStore.getState().activeRole.id).toBe('supreme-security');
    expect(useChatStore.getState().customInstruction).toBe('Check SSRF and RBAC invariants');

    const prefEnv: SyncEnvelope = {
      protocolVersion: '1.0.0',
      deviceId: 'dev-desktop-remote',
      platform: 'desktop',
      domain: 'preferences',
      updatedAt: Date.now() + 20,
      revision: 3,
      payload: {
        studio_settings: {
          language: 'bn',
          contentLayout: 'centered',
        },
        theme_config: {
          themeMode: 'dark',
          liveTheme: 'midnight-peaks',
        },
      },
    };
    applyIncomingSyncEnvelope(prefEnv);
    expect(useCustomerStore.getState().userSettings.language).toBe('bn');
    expect(useAppPreferencesStore.getState().language).toBe('bn');
    expect(useThemeStore.getState().themeMode).toBe('dark');
    expect(useThemeStore.getState().liveTheme).toBe('midnight-peaks');

    const merged = mergeSyncedSessions(
      [
        {
          id: 'sess_1',
          title: 'Old Title',
          createdAt: 100,
          updatedAt: 100,
          model: 'supreme-core',
          roleId: 'supreme-general',
          messages: [],
        },
      ],
      [
        {
          id: 'sess_1',
          title: 'Synced From Mobile',
          createdAt: 100,
          updatedAt: 500,
          model: 'supreme-reason',
          roleId: 'supreme-architect',
          messages: [
            { id: 'm1', role: 'user', content: 'Hello from Android', timestamp: 499 },
          ],
        },
      ]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('Synced From Mobile');
    expect(merged[0].messages).toHaveLength(1);
  });
});
