/**
 * Command: SupremeAI: Ask about Selection
 */
import * as vscode from 'vscode';
import { getEditorContext, buildPrompt } from '../context';
import { tierToModel } from '../models';

const DEFAULT_GATEWAY_URL = 'https://supremeai-api-ulw0.onrender.com';

export async function inlineChatCommand(): Promise<void> {
  const ctx = getEditorContext();
  const question = await vscode.window.showInputBox({
    prompt: 'Ask SupremeAI about the current selection/file',
    placeHolder: 'e.g. Explain this code / Fix the bug / Refactor for clarity',
  });
  if (!question) return;

  const prompt = buildPrompt(question, ctx);
  const config = vscode.workspace.getConfiguration('supremeai');
  const gatewayUrl = config.get<string>('gatewayUrl', DEFAULT_GATEWAY_URL);
  const apiKey = config.get<string>('apiKey', '') || process.env.SUPREMEAI_API_KEY || '';
  const model = tierToModel(config.get<string>('model', 'auto'));

  const channel = vscode.window.createOutputChannel('SupremeAI');
  channel.show(true);
  channel.appendLine(`> ${question}\n`);

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
          headers: { 'Content-Type': 'application/json', 'X-SupremeAI-Key': apiKey },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
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
