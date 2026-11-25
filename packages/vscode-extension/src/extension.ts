/**
 * বাংলা মন্তব্য: SupremeAI VS Code Extension — মূল অ্যাক্টিভেশন ও রিয়েল-টাইম ৪-প্ল্যাটফর্ম সিঙ্ক সমন্বয়কারী।
 */
import * as vscode from 'vscode';
import { ensureCommandAvailable } from './commandAvailability';
import { DEFAULT_LIVE_MCP_TOWER_URL, McpBridge } from './mcp_bridge';
import { FederationStatusBar } from './status_bar';
import { SupremeAIChatViewProvider } from './chat_view';
import { inlineChatCommand } from './commands/inline_chat';
import { registerCodeActions } from './code_actions';
import { submitTaskCommand } from './commands/submit_task';
import { runwayStatusCommand } from './commands/runway_status';
import {
  AppLanguage,
  DEFAULT_MODEL_ID,
  MODEL_TIERS,
  SYSTEM_ROLES,
  ThemeMode,
  ThinkingLevel,
  tierToModel,
} from './models';
import { VsCodeSyncEngine } from './sync_client';

const UNIFIED_RELEASE_MANIFEST_URL =
  'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/latest-release.json';
const WEB_STUDIO_URL = 'https://supremeai-studio.pages.dev';
const DEFAULT_GATEWAY_URL = 'https://supremeai-api-ulw0.onrender.com';

let statusBar: FederationStatusBar | null = null;
let bridge: McpBridge | null = null;
let syncEngine: VsCodeSyncEngine | null = null;

interface UnifiedReleaseManifest {
  version?: string;
  downloads?: {
    webUrl?: string;
    releasePageUrl?: string;
    windowsExeUrl?: string;
    androidApkUrl?: string;
    vscodeVsixUrl?: string;
  };
}

function isNewerSemver(remote: string, current: string): boolean {
  const a = remote
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const b = current
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    if (va > vb) return true;
    if (va < vb) return false;
  }
  return false;
}

async function fetchUnifiedManifest(): Promise<UnifiedReleaseManifest | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(UNIFIED_RELEASE_MANIFEST_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as UnifiedReleaseManifest | null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration('supremeai');
  const towerUrl = config.get<string>('towerUrl', DEFAULT_LIVE_MCP_TOWER_URL);
  const refreshSeconds = config.get<number>('autoRefreshSeconds', 30);
  const currentVersion = String(context.extension.packageJSON?.version || '2.5.0');

  const storedDeviceId = context.globalState.get<string>('supremeai.deviceId');
  const rawConfiguredModel = config.get<string>('model', 'auto');
  const initialConcreteModel =
    tierToModel(rawConfiguredModel) === 'auto'
      ? DEFAULT_MODEL_ID
      : tierToModel(rawConfiguredModel);

  syncEngine = new VsCodeSyncEngine(
    {
      syncUrl: config.get<string>('syncUrl', WEB_STUDIO_URL),
      gatewayUrl: config.get<string>('gatewayUrl', DEFAULT_GATEWAY_URL),
      apiKey: config.get<string>('apiKey', '') || process.env.SUPREMEAI_API_KEY || '',
      syncEnabled: config.get<boolean>('syncEnabled', true),
      deviceId: storedDeviceId,
    },
    {
      selectedModelId: initialConcreteModel,
      autoModelRouting:
        rawConfiguredModel === 'auto' ? config.get<boolean>('autoModelRouting', true) : false,
      activeRoleId: config.get<string>('role', 'supreme-general'),
      customInstruction: config.get<string>('customInstructions', ''),
      language: (config.get<string>('language', 'en') === 'bn' ? 'bn' : 'en') as AppLanguage,
      thinkingLevel: config.get<string>('thinkingLevel', 'MEDIUM') as ThinkingLevel,
      temperature: config.get<number>('temperature', 0.7),
      maxOutputTokens: config.get<number>('maxTokens', 8192),
      enableSearchGrounding: config.get<boolean>('enableSearchGrounding', true),
      themeMode: config.get<string>('themeMode', 'system') as ThemeMode,
      liveTheme: config.get<string>('liveTheme', 'alpine-dunes'),
    }
  );
  if (!storedDeviceId) {
    void context.globalState.update('supremeai.deviceId', syncEngine.deviceId);
  }

  bridge = new McpBridge(towerUrl);
  statusBar = new FederationStatusBar(bridge);
  statusBar.updateSyncedState(syncEngine.getState());
  statusBar.startPolling(refreshSeconds);
  context.subscriptions.push(statusBar);

  let writingVsCodeConfig = false;
  const unsubSync = syncEngine.onDidChangeState((nextState, source) => {
    statusBar?.updateSyncedState(nextState);
    if (source === 'remote') {
      writingVsCodeConfig = true;
      const cfg = vscode.workspace.getConfiguration('supremeai');
      const targetModelSetting = nextState.autoModelRouting ? 'auto' : nextState.selectedModelId;
      void Promise.allSettled([
        cfg.update('model', targetModelSetting, vscode.ConfigurationTarget.Global),
        cfg.update('autoModelRouting', nextState.autoModelRouting, vscode.ConfigurationTarget.Global),
        cfg.update('role', nextState.activeRoleId, vscode.ConfigurationTarget.Global),
        cfg.update(
          'customInstructions',
          nextState.customInstruction,
          vscode.ConfigurationTarget.Global
        ),
        cfg.update('language', nextState.language, vscode.ConfigurationTarget.Global),
        cfg.update('thinkingLevel', nextState.thinkingLevel, vscode.ConfigurationTarget.Global),
        cfg.update('temperature', nextState.temperature, vscode.ConfigurationTarget.Global),
        cfg.update('maxTokens', nextState.maxOutputTokens, vscode.ConfigurationTarget.Global),
        cfg.update(
          'enableSearchGrounding',
          nextState.enableSearchGrounding,
          vscode.ConfigurationTarget.Global
        ),
        cfg.update('themeMode', nextState.themeMode, vscode.ConfigurationTarget.Global),
        cfg.update('liveTheme', nextState.liveTheme, vscode.ConfigurationTarget.Global),
      ]).finally(() => {
        writingVsCodeConfig = false;
      });
    }
  });
  context.subscriptions.push({
    dispose: () => {
      unsubSync();
      syncEngine?.dispose();
    },
  });
  void syncEngine.start();

  const chatProvider = new SupremeAIChatViewProvider(context, syncEngine);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SupremeAIChatViewProvider.viewType, chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  const dispatchDisposable = vscode.commands.registerCommand('supremeai.dispatchTask', () => {
    if (bridge) {
      void submitTaskCommand(bridge);
    }
  });

  const runwayDisposable = vscode.commands.registerCommand('supremeai.viewRunway', () => {
    if (bridge) {
      void runwayStatusCommand(bridge);
    }
  });

  const killSwitchDisposable = vscode.commands.registerCommand(
    'supremeai.emergencyStop',
    async () => {
      const pin = await vscode.window.showInputBox({
        prompt: 'Enter Superadmin Emergency PIN to halt all autonomous execution',
        password: true,
        placeHolder: 'PIN (minimum 4 digits)',
        validateInput: (text) => (text.length < 4 ? 'PIN must be at least 4 digits' : null),
      });
      if (!pin || !bridge) return;
      const confirmed = await vscode.window.showWarningMessage(
        'Are you sure you want to trigger the EMERGENCY KILL-SWITCH across the entire federation?',
        { modal: true },
        'HALT ALL AUTONOMY'
      );
      if (confirmed === 'HALT ALL AUTONOMY') {
        const ok = await bridge.triggerEmergencyKill(pin);
        if (ok) {
          vscode.window.showErrorMessage(
            'EMERGENCY KILL-SWITCH ACTIVATED: All autonomous agent runs paused.'
          );
          if (statusBar) void statusBar.refresh();
        } else {
          vscode.window.showErrorMessage(
            'Kill-switch request rejected (invalid PIN or server error).'
          );
        }
      }
    }
  );

  const askSelectionDisposable = vscode.commands.registerCommand('supremeai.askSelection', () => {
    void inlineChatCommand(syncEngine ?? undefined);
  });

  const openChatDisposable = vscode.commands.registerCommand('supremeai.openChat', async () => {
    if (await ensureCommandAvailable('supremeai.chat.focus', { source: 'SupremeAI' })) {
      await vscode.commands.executeCommand('supremeai.chat.focus');
    }
  });

  const selectModelDisposable = vscode.commands.registerCommand(
    'supremeai.selectModel',
    async () => {
      if (!syncEngine) return;
      const cur = syncEngine.getState();
      const picked = await vscode.window.showQuickPick(
        MODEL_TIERS.map((t) => ({
          label: `${(cur.autoModelRouting ? t.id === 'auto' : t.id === cur.selectedModelId) ? '$(check) ' : ''}${t.name}`,
          description: `${t.badge} · ${t.latencyRating}`,
          detail: t.tagline,
          modelId: t.id,
        })),
        {
          title: 'Select SupremeAI Model (Synced Across Web, Desktop, Mobile & VS Code)',
          placeHolder: 'Choose Auto Smart Routing or a dedicated SupremeAI foundation model',
        }
      );
      if (!picked) return;
      await syncEngine.updateOptions(
        picked.modelId === 'auto'
          ? { autoModelRouting: true }
          : { selectedModelId: picked.modelId, autoModelRouting: false }
      );
      await vscode.workspace
        .getConfiguration('supremeai')
        .update('model', picked.modelId, vscode.ConfigurationTarget.Global);
    }
  );

  const selectRoleDisposable = vscode.commands.registerCommand(
    'supremeai.selectRole',
    async () => {
      if (!syncEngine) return;
      const cur = syncEngine.getState();
      const picked = await vscode.window.showQuickPick(
        SYSTEM_ROLES.map((r) => ({
          label: `${r.id === cur.activeRoleId ? '$(check) ' : ''}${r.name}`,
          description: r.badge,
          detail: r.tagline,
          roleId: r.id,
        })),
        {
          title: 'Select System Persona (Synced Across Web, Desktop, Mobile & VS Code)',
          placeHolder: 'Choose active engineering persona',
        }
      );
      if (!picked) return;
      await syncEngine.updateOptions({ activeRoleId: picked.roleId });
      await vscode.workspace
        .getConfiguration('supremeai')
        .update('role', picked.roleId, vscode.ConfigurationTarget.Global);
    }
  );

  const syncNowDisposable = vscode.commands.registerCommand('supremeai.syncNow', async () => {
    if (!syncEngine) return;
    const ok = await syncEngine.pullNow();
    if (ok) {
      vscode.window.showInformationMessage(
        'SupremeAI: Models, personas, options & chats synchronized across platforms.'
      );
    } else {
      vscode.window.showWarningMessage(
        'SupremeAI: Configure supremeai.apiKey to enable live cloud sync across devices.'
      );
    }
  });

  const checkUpdatesDisposable = vscode.commands.registerCommand(
    'supremeai.checkUpdates',
    async () => {
      const manifest = await fetchUnifiedManifest();
      const latestVersion = manifest?.version || currentVersion;
      const downloads = manifest?.downloads || {};
      const pick = await vscode.window.showQuickPick(
        [
          {
            label: `$(extensions) Download VS Code VSIX (v${latestVersion})`,
            description: isNewerSemver(latestVersion, currentVersion)
              ? `Update available (installed v${currentVersion})`
              : 'Up to date',
            url:
              downloads.vscodeVsixUrl ||
              `https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/supremeai-vscode-${latestVersion}.vsix`,
          },
          {
            label: '$(globe) Open SupremeAI Web Studio',
            description: downloads.webUrl || WEB_STUDIO_URL,
            url: downloads.webUrl || WEB_STUDIO_URL,
          },
          {
            label: '$(device-mobile) Download Android APK',
            description: 'SupremeAI-Studio-app-universal-release.apk',
            url:
              downloads.androidApkUrl ||
              'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/SupremeAI-Studio-app-universal-release.apk',
          },
          {
            label: '$(desktop-download) Download Windows Desktop (.exe)',
            description: `SupremeAI.Desktop_${latestVersion}_x64-setup.exe`,
            url:
              downloads.windowsExeUrl ||
              `https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/SupremeAI.Desktop_${latestVersion}_x64-setup.exe`,
          },
        ],
        {
          title: `SupremeAI Unified Releases (v${latestVersion})`,
          placeHolder: 'Open Web Studio or download VSIX / APK / EXE installers',
        }
      );
      if (pick?.url) {
        await vscode.env.openExternal(vscode.Uri.parse(pick.url));
      }
    }
  );

  registerCodeActions(context);

  const configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('supremeai')) {
      const updatedConfig = vscode.workspace.getConfiguration('supremeai');
      const newUrl = updatedConfig.get<string>('towerUrl', DEFAULT_LIVE_MCP_TOWER_URL);
      const newRefresh = updatedConfig.get<number>('autoRefreshSeconds', 30);
      if (bridge) bridge.updateConfig(newUrl);
      if (statusBar) statusBar.startPolling(newRefresh);

      if (syncEngine && !writingVsCodeConfig) {
        syncEngine.updateConfig({
          syncUrl: updatedConfig.get<string>('syncUrl', WEB_STUDIO_URL),
          gatewayUrl: updatedConfig.get<string>('gatewayUrl', DEFAULT_GATEWAY_URL),
          apiKey: updatedConfig.get<string>('apiKey', '') || process.env.SUPREMEAI_API_KEY || '',
          syncEnabled: updatedConfig.get<boolean>('syncEnabled', true),
        });
        const cfgModel = updatedConfig.get<string>('model', 'auto');
        void syncEngine.updateOptions({
          ...(cfgModel === 'auto'
            ? { autoModelRouting: true }
            : { selectedModelId: cfgModel, autoModelRouting: false }),
          activeRoleId: updatedConfig.get<string>('role', 'supreme-general'),
          customInstruction: updatedConfig.get<string>('customInstructions', ''),
          language: (updatedConfig.get<string>('language', 'en') === 'bn'
            ? 'bn'
            : 'en') as AppLanguage,
          thinkingLevel: updatedConfig.get<string>('thinkingLevel', 'MEDIUM') as ThinkingLevel,
          temperature: updatedConfig.get<number>('temperature', 0.7),
          maxOutputTokens: updatedConfig.get<number>('maxTokens', 8192),
          enableSearchGrounding: updatedConfig.get<boolean>('enableSearchGrounding', true),
          themeMode: updatedConfig.get<string>('themeMode', 'system') as ThemeMode,
          liveTheme: updatedConfig.get<string>('liveTheme', 'alpine-dunes'),
        });
      }
    }
  });

  if (config.get<boolean>('autoCheckUpdates', true)) {
    const updateTimer = setTimeout(() => {
      void fetchUnifiedManifest().then((manifest) => {
        if (!manifest?.version || !isNewerSemver(manifest.version, currentVersion)) return;
        const vsixUrl =
          manifest.downloads?.vscodeVsixUrl ||
          `https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/supremeai-vscode-${manifest.version}.vsix`;
        void vscode.window
          .showInformationMessage(
            `SupremeAI Extension v${manifest.version} is available (installed v${currentVersion}).`,
            'Download VSIX'
          )
          .then((choice) => {
            if (choice === 'Download VSIX') {
              void vscode.env.openExternal(vscode.Uri.parse(vsixUrl));
            }
          });
      });
    }, 6000);
    context.subscriptions.push({ dispose: () => clearTimeout(updateTimer) });
  }

  context.subscriptions.push(
    dispatchDisposable,
    runwayDisposable,
    killSwitchDisposable,
    askSelectionDisposable,
    openChatDisposable,
    selectModelDisposable,
    selectRoleDisposable,
    syncNowDisposable,
    checkUpdatesDisposable,
    configDisposable
  );
}

export function deactivate(): void {
  if (syncEngine) {
    syncEngine.dispose();
    syncEngine = null;
  }
  if (statusBar) {
    statusBar.dispose();
    statusBar = null;
  }
  bridge = null;
}
