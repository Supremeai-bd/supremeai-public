/**
 * বাংলা মন্তব্য: বর্তমান সিলেকশন/ফাইল সম্পর্কে SupremeAI-কে প্রশ্ন করার কমান্ড —
 * সিঙ্কড মডেল, সিস্টেম রোল (Persona), কাস্টম ইনস্ট্রাকশন ও থিংকিং লেভেল ব্যবহার করে।
 */
import * as vscode from 'vscode';
import { getEditorContext, buildPrompt } from '../context';
import {
  AppLanguage,
  buildEffectiveSystemInstruction,
  thinkingLevelToReasoningEffort,
  tierToModel,
} from '../models';
import { VsCodeSyncEngine } from '../sync_client';

const DEFAULT_GATEWAY_URL = 'https://supremeai-api-ulw0.onrender.com';

export async function inlineChatCommand(syncEngine?: VsCodeSyncEngine): Promise<void> {
  const ctx = getEditorContext();
  const syncedState = syncEngine?.getState();
  const question = await vscode.window.showInputBox({
    prompt:
      syncedState?.language === 'bn'
        ? 'বর্তমান কোড সিলেকশন/ফাইল সম্পর্কে SupremeAI-কে জিজ্ঞাসা করুন'
        : 'Ask SupremeAI about the current selection/file',
    placeHolder: 'e.g. Explain this code / Fix the bug / Refactor for clarity',
  });
  if (!question) return;

  const prompt = buildPrompt(question, ctx);
  const config = vscode.workspace.getConfiguration('supremeai');
  const gatewayUrl = config.get<string>('gatewayUrl', DEFAULT_GATEWAY_URL);
  const apiKey = config.get<string>('apiKey', '') || process.env.SUPREMEAI_API_KEY || '';
  const autoRouting = syncedState
    ? syncedState.autoModelRouting
    : config.get<boolean>('autoModelRouting', true);
  const configuredModel = syncedState
    ? syncedState.selectedModelId
    : config.get<string>('model', 'auto');
  const model = autoRouting ? 'auto' : tierToModel(configuredModel);
  const roleId = syncedState ? syncedState.activeRoleId : config.get<string>('role', 'supreme-general');
  const customInstructions = syncedState
    ? syncedState.customInstruction
    : config.get<string>('customInstructions', '');
  const lang = (
    syncedState ? syncedState.language : config.get<string>('language', 'en')
  ) as AppLanguage;
  const thinkingLevel = syncedState
    ? syncedState.thinkingLevel
    : config.get<string>('thinkingLevel', 'MEDIUM');
  const temperature = syncedState ? syncedState.temperature : config.get<number>('temperature', 0.7);

  const systemContent = buildEffectiveSystemInstruction(roleId, customInstructions, lang);

  const channel = vscode.window.createOutputChannel('SupremeAI');
  channel.show(true);
  channel.appendLine(`> [${model}] ${question}\n`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'SupremeAI thinking...',
      cancellable: false,
    },
    async () => {
      try {
        const res = await fetch(gatewayUrl.replace(/\/$/, '') + '/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-SupremeAI-Key': apiKey || 'guest',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemContent },
              { role: 'user', content: prompt },
            ],
            temperature,
            reasoning_effort: thinkingLevelToReasoningEffort(thinkingLevel),
            stream: false,
          }),
        });
        if (!res.ok) {
          channel.appendLine(`Error: HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = data?.choices?.[0]?.message?.content || '(no response)';
        channel.appendLine(content);

        const match = content.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
        if (match && ctx && ctx.selection && vscode.window.activeTextEditor) {
          const editor = vscode.window.activeTextEditor;
          const apply = await vscode.window.showInformationMessage(
            'Apply suggested code to replace current selection?',
            'Apply',
            'Cancel'
          );
          if (apply === 'Apply') {
            await editor.edit((eb) => {
              eb.replace(editor.selection, match[1].replace(/\n$/, ''));
            });
          }
        }
      } catch (err) {
        channel.appendLine(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );
}
