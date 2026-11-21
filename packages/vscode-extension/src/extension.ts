/**
 * SupremeAI VS Code Extension — Main Activation Entrypoint
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

const UNIFIED_RELEASE_MANIFEST_URL =
  'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/latest-release.json';
const WEB_STUDIO_URL = 'https://supremeai-studio.pages.dev';

let statusBar: FederationStatusBar | null = null;
let bridge: McpBridge | null = null;

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

  bridge = new McpBridge(towerUrl);
  statusBar = new FederationStatusBar(bridge);
  statusBar.startPolling(refreshSeconds);
  context.subscriptions.push(statusBar);

  const chatProvider = new SupremeAIChatViewProvider(context);
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
    void inlineChatCommand();
  });

  const openChatDisposable = vscode.commands.registerCommand('supremeai.openChat', async () => {
    if (await ensureCommandAvailable('supremeai.chat.focus', { source: 'SupremeAI' })) {
      await vscode.commands.executeCommand('supremeai.chat.focus');
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
    }
  });

  // Non-intrusive startup check for newer unified VSIX build
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
    checkUpdatesDisposable,
    configDisposable
  );
}

export function deactivate(): void {
  if (statusBar) {
    statusBar.dispose();
    statusBar = null;
  }
  bridge = null;
}
