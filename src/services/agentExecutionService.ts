import type { AgentExecuteResponse } from '../shared/agentTypes';
import { getWorkspaceAuthHeaders } from '../utils/workspaceAuth';

export interface ExecuteAutonomousTaskParams {
  prompt: string;
  language?: string;
  workspaceFiles?: Array<{ path: string; lang: string; content: string }>;
  recentTurns?: Array<{ role: string; content: string }>;
  approvedActionIds?: string[];
  signal?: AbortSignal;
}

export async function executeAutonomousTask(
  params: ExecuteAutonomousTaskParams
): Promise<AgentExecuteResponse> {
  if (typeof fetch === 'undefined') {
    return { status: 'fallback_chat', reason: 'fetch_unavailable' };
  }

  try {
    const res = await fetch('/api/agent/execute', {
      method: 'POST',
      headers: getWorkspaceAuthHeaders({ 'Content-Type': 'application/json' }),
      signal: params.signal,
      body: JSON.stringify({
        prompt: params.prompt,
        language: params.language || 'en',
        workspaceFiles: params.workspaceFiles || [],
        recentTurns: params.recentTurns || [],
        approvedActionIds: params.approvedActionIds || [],
      }),
    });

    if (!res.ok) {
      return { status: 'fallback_chat', reason: `http_${res.status}` };
    }

    const data = (await res.json().catch(() => null)) as AgentExecuteResponse | null;
    if (!data || !data.status) {
      return { status: 'fallback_chat', reason: 'invalid_agent_response' };
    }
    return data;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { status: 'fallback_chat', reason: 'aborted' };
    }
    return {
      status: 'fallback_chat',
      reason: err instanceof Error ? err.message : 'network_error',
    };
  }
}
