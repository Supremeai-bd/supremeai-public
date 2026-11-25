/**
 * বাংলা মন্তব্য: SupremeAI Status Bar — সক্রিয় সিঙ্কড মডেল, পার্সোনা এবং ফেডারেশন হেলথ স্ট্যাটাস দেখায়।
 */
import * as vscode from 'vscode';
import { FederationHealth, McpBridge } from './mcp_bridge';
import { UnifiedVsixState } from './sync_client';

export class FederationStatusBar {
  private statusBarItem: vscode.StatusBarItem;
  private bridge: McpBridge;
  private timer: NodeJS.Timeout | null = null;
  private isDisposed = false;
  private latestHealth: FederationHealth;
  private syncedSummary = 'Auto';

  constructor(bridge: McpBridge) {
    this.bridge = bridge;
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'supremeai.selectModel';
    this.latestHealth = {
      status: 'nominal',
      activeAgents: 0,
      openClaims: 0,
      runwayDepth: 0,
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
    };
    this.updateDisplay(this.latestHealth);
    this.statusBarItem.show();
  }

  public get item(): vscode.StatusBarItem {
    return this.statusBarItem;
  }

  public updateSyncedState(state: UnifiedVsixState): void {
    this.syncedSummary = state.autoModelRouting
      ? 'Auto'
      : state.selectedModelId.replace(/^supremeai?-/i, '').toUpperCase();
    this.updateDisplay(this.latestHealth, state);
  }

  public startPolling(intervalSeconds = 30): void {
    this.stopPolling();
    const intervalMs = Math.max(5, intervalSeconds) * 1000;
    void this.refresh();
    this.timer = setInterval(() => {
      if (!this.isDisposed) {
        void this.refresh();
      }
    }, intervalMs);
  }

  public stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async refresh(): Promise<void> {
    const health = await this.bridge.fetchHealth();
    this.latestHealth = health;
    this.updateDisplay(health);
  }

  public updateDisplay(health: FederationHealth, syncState?: UnifiedVsixState): void {
    if (this.isDisposed) return;

    let icon: string;
    let label: string;

    switch (health.status) {
      case 'nominal':
        if (health.activeAgents > 0) {
          icon = '$(sync~spin)';
          label = `${this.syncedSummary} · Agents (${health.activeAgents})`;
        } else {
          icon = '$(cloud)';
          label = this.syncedSummary;
        }
        this.statusBarItem.backgroundColor = undefined;
        break;
      case 'degraded':
        icon = '$(warning)';
        label = `${this.syncedSummary} · Degraded`;
        this.statusBarItem.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.warningBackground'
        );
        break;
      case 'critical':
        icon = '$(error)';
        label = `${this.syncedSummary} · Critical`;
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        break;
      case 'offline':
      default:
        icon = '$(circle-slash)';
        label = `${this.syncedSummary} · Offline`;
        this.statusBarItem.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.warningBackground'
        );
        break;
    }

    this.statusBarItem.text = `${icon} SupremeAI: ${label}`;
    const syncLine = syncState
      ? `- **Synced Model:** \`${syncState.autoModelRouting ? 'auto' : syncState.selectedModelId}\`\n` +
        `- **Persona:** \`${syncState.activeRoleId}\` · **Thinking:** \`${syncState.thinkingLevel}\`\n` +
        `- **Cross-Platform Sync:** \`${syncState.connectionStatus.toUpperCase()}\`\n`
      : '';
    this.statusBarItem.tooltip = new vscode.MarkdownString(
      `**SupremeAI Unified Platform Status**\n\n` +
        syncLine +
        `- **Tower State:** \`${health.status.toUpperCase()}\`\n` +
        `- **Active Agents:** ${health.activeAgents}\n` +
        `- **Open Claims:** ${health.openClaims}\n` +
        `- **Runway Depth:** ${health.runwayDepth} PRs\n` +
        `- **Tower Latency:** ${health.latencyMs}ms\n` +
        `- **Last Polled:** ${new Date(health.lastChecked).toLocaleTimeString()}\n\n` +
        `*Click to switch SupremeAI model (synced across Web, Desktop, Mobile & VS Code).*`
    );
  }

  public dispose(): void {
    this.isDisposed = true;
    this.stopPolling();
    this.statusBarItem.dispose();
  }
}
