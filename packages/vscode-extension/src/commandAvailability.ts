import * as vscode from 'vscode';

let cachedCommands: Set<string> | null = null;

export async function refreshCommandCache(): Promise<Set<string>> {
  const all = await vscode.commands.getCommands(true);
  cachedCommands = new Set(all);
  return cachedCommands;
}

export function isCommandCached(id: string): boolean {
  return cachedCommands?.has(id) ?? false;
}

export async function ensureCommandAvailable(
  commandId: string,
  opts: { notifyOnMissing?: boolean; source?: string } = {}
): Promise<boolean> {
  if (!cachedCommands) {
    try {
      await refreshCommandCache();
    } catch {
      cachedCommands = null;
    }
  }
  if (cachedCommands?.has(commandId)) return true;

  try {
    const fresh = await vscode.commands.getCommands(true);
    cachedCommands = new Set(fresh);
    if (cachedCommands.has(commandId)) return true;
  } catch {
    /* fall through */
  }

  if (opts.notifyOnMissing !== false) {
    const source = opts.source ?? 'SupremeAI';
    vscode.window
      .showWarningMessage(
        `${source}: command "${commandId}" is not available yet. Reload the window to activate it.`,
        'Reload Window'
      )
      .then((choice) => {
        if (choice === 'Reload Window') {
          void vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      });
  }
  return false;
}

export function _resetCommandCacheForTests(): void {
  cachedCommands = null;
}
