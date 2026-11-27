import type { ChatMessage } from '../types';
import { extractStreamingArtifact, extractVirtualProject } from './artifactStreamParser';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';

export type RunLatestCodeResult = 'project' | 'preview' | 'sandbox' | 'none';

/**
 * বাংলা মন্তব্য: চ্যাটে আর কোনো Run/Preview বাটন নেই। ইউজার "চালাও / run it" বললে
 * সবশেষ অ্যাসিস্ট্যান্ট উত্তর থেকে কোড বা প্রজেক্ট খুঁজে নিজে থেকেই ঠিক ট্যাবে চালানো হয়।
 * ভাষা (HTML/JS/TS/Python…) কোড-ব্লক থেকেই অনুমান করা হয় — ইউজারকে কিছু বাছতে হয় না।
 */
export function runLatestCodeFromMessages(
  messages: ChatMessage[] | undefined
): RunLatestCodeResult {
  if (!messages || messages.length === 0) return 'none';
  const ws = useWorkspaceStore.getState();

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !msg.content || !msg.content.includes('```')) continue;

    const project = extractVirtualProject(msg.content);
    if (project && project.files.length > 0) {
      ws.syncVirtualProject(project, { autoOpenDock: true, isFinal: true });
      if (project.runtime === 'python' || project.runtime === 'node') {
        void useWorkspaceStore.getState().runCurrentServerProject();
      }
      return 'project';
    }

    const artifact = extractStreamingArtifact(msg.content);
    if (artifact && artifact.code.trim()) {
      if (artifact.targetTab === 'sandbox') {
        ws.loadCodeIntoWorkspace(artifact.code, artifact.lang, 'sandbox', true);
        return 'sandbox';
      }
      ws.loadCodeIntoWorkspace(artifact.code, artifact.lang, 'preview');
      return 'preview';
    }
  }
  return 'none';
}
