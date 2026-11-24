import type { AgentExecutionStep, ChatAttachment, GroundingSource } from '../types';
import type { IntentOrchestrationResult } from '../services/intentOrchestrator';

export type AgentToolActionType =
  | 'create_schedule'
  | 'dashboard_action'
  | 'open_browser'
  | 'update_project'
  | 'run_terminal';

export interface AgentScheduleActionPayload {
  title: string;
  targetUrl: string;
  cadence: 'hourly' | 'daily' | 'weekly' | 'custom';
  cronExpression: string;
  instruction: string;
}

export interface AgentDashboardActionPayload {
  action:
    | 'toggle_dark_mode'
    | 'toggle_light_mode'
    | 'open_usage'
    | 'open_settings'
    | 'open_knowledge'
    | 'open_history'
    | 'open_admin_health'
    | 'open_admin_ai'
    | 'open_admin_security'
    | 'open_admin_releases'
    | 'toggle_voice';
}

export interface AgentOpenBrowserActionPayload {
  url: string;
}

export interface AgentUpdateProjectActionPayload {
  title?: string;
  runtime?: 'web' | 'react' | 'python' | 'node' | 'php' | 'static';
  entryFile?: string;
  files: Array<{ path: string; lang: string; content: string }>;
}

export interface AgentRunTerminalActionPayload {
  command: string;
}

export type AgentToolAction =
  | {
      id: string;
      type: 'create_schedule';
      label: string;
      requiresApproval: true;
      payload: AgentScheduleActionPayload;
    }
  | {
      id: string;
      type: 'run_terminal';
      label: string;
      requiresApproval: true;
      payload: AgentRunTerminalActionPayload;
    }
  | {
      id: string;
      type: 'dashboard_action';
      label: string;
      requiresApproval: false;
      payload: AgentDashboardActionPayload;
    }
  | {
      id: string;
      type: 'open_browser';
      label: string;
      requiresApproval: false;
      payload: AgentOpenBrowserActionPayload;
    }
  | {
      id: string;
      type: 'update_project';
      label: string;
      requiresApproval: false;
      payload: AgentUpdateProjectActionPayload;
    };

export interface PendingTaskApproval {
  id: string;
  sessionId?: string;
  originalPrompt: string;
  summary: string;
  language: 'en' | 'bn' | 'banglish';
  steps: AgentExecutionStep[];
  actions: AgentToolAction[];
  draftAnswer: string;
  groundingSources?: GroundingSource[];
  attachment?: ChatAttachment;
  attachments?: ChatAttachment[];
}

export interface AgentExecuteResponse {
  status: 'completed' | 'needs_approval' | 'fallback_chat';
  answer?: string;
  summary?: string;
  steps?: AgentExecutionStep[];
  actions?: AgentToolAction[];
  groundingSources?: GroundingSource[];
  reason?: string;
  /**
   * Audit 2026-11-24 (item 2.10): actions that were QUEUED to the client
   * (browser navigation, project sync) but not verified as executed. The UI
   * must surface these instead of presenting a bare "completed".
   */
  pendingVerification?: Array<{
    item: string;
    verifyAt: string;
  }>;
}

const MULTI_STEP_AGENT_ASCII =
  /\b(workspace|package\.json|server\.ts|project\s+files?|inspect\s+files?|read\s+files?|list\s+files?|compare\s+.*\band\b|step[\s-]+by[\s-]+step|end[\s-]+to[\s-]+end|automate|execute\s+this|check\s+.*\band\s+(?:then\s+)?(?:fix|summarize|schedule|open|save|create)|browse\s+.*\band\s+(?:schedule|summarize|compare)|schedule\s+.*\bhttps?:\/\/)\b/i;

const MULTI_STEP_AGENT_BN =
  /(ফাইল\s*(?:দেখে|পড়ে|পড়ে|চেক\s*করে)|প্রজেক্ট\s*(?:চেক|রিভিউ|ঠিক)|নিজে\s*(?:করে|চালিয়ে|চালিয়ে)\s*দাও|ধাপে\s*ধাপে\s*(?:করে|সমাধান)|তুলনা\s*করে\s*(?:দাও|বলো)|শিডিউল\s*(?:করে|বসিয়ে|বসিয়ে)\s*দাও|koro\s+ebong|check\s+kore\s+(?:bolo|dekhao|schedule)|file\s+gulo\s+dekho)/i;

const FILE_PATH_REFERENCE =
  /(?:^|\s)(?:src\/|functions\/|scripts\/|package\.json|tsconfig\.json|server\.ts|index\.html|README\.md)\S*/i;

/**
 * Determines whether a request benefits from the multi-step function-calling
 * Agent Executor instead of single-pass chat streaming.
 */
export function shouldRouteToAutonomousAgent(params: {
  promptText: string;
  intent?: IntentOrchestrationResult;
  hasAttachments: boolean;
  deepResearch: boolean;
  workspaceFileCount: number;
}): boolean {
  const { promptText, intent, hasAttachments, deepResearch, workspaceFileCount } = params;
  const trimmed = (promptText || '').trim();
  if (!trimmed || trimmed.length < 8) return false;
  if (hasAttachments || deepResearch) return false;
  if (intent?.dashboardAction && intent.dashboardAction !== 'none') return false;
  if (intent?.needsClarification) return false;

  const normalized = trimmed.normalize('NFC');
  if (
    MULTI_STEP_AGENT_ASCII.test(trimmed) ||
    MULTI_STEP_AGENT_BN.test(trimmed) ||
    MULTI_STEP_AGENT_BN.test(normalized)
  ) {
    return true;
  }

  if (FILE_PATH_REFERENCE.test(trimmed)) {
    return true;
  }

  // Natural-language schedule + URL/task benefit from structured tool extraction
  if (intent?.primaryGoal === 'schedule_task') {
    return true;
  }

  // Multiple URLs to browse/compare in one prompt
  const urlMatches = trimmed.match(/https?:\/\/[^\s"'<>]+/gi);
  if (urlMatches && urlMatches.length >= 2) {
    return true;
  }

  // Editing or inspecting an active multi-file workspace project
  if (
    workspaceFileCount > 0 &&
    /\b(fix|audit|check|review|inspect|update|refactor|add)\b/i.test(trimmed) &&
    /\b(project|files?|codebase|tab|component|route)\b/i.test(trimmed)
  ) {
    return true;
  }

  return false;
}
