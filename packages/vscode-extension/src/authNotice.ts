/**
 * বাংলা মন্তব্য: সেভ করা API key গেটওয়ে প্রত্যাখ্যান করলে (401) একবার জানানো হয়।
 * চ্যাট থামে না — gatewayFetch সাথে সাথে guest টোকেন দিয়ে আবার চেষ্টা করে।
 */
import * as vscode from 'vscode';

export function warnUserKeyRejected(status: number): void {
  void vscode.window
    .showWarningMessage(
      `SupremeAI: your saved API key was rejected (HTTP ${status}). Continuing in guest mode — update "supremeai.apiKey" to restore your account limits.`,
      'Open Settings'
    )
    .then((choice) => {
      if (choice === 'Open Settings') {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'supremeai.apiKey');
      }
    });
}
