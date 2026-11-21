import { create } from 'zustand';
import {
  AgentExecutionStep,
  ChatAttachment,
  ChatMessage,
  ChatRouteMeta,
  ChatSession,
  GroundingSource,
  KnowledgeDoc,
  ModelDetail,
  RolePersona,
  TokenUsageSummary,
  WorkbenchRunSettings,
} from '../types';
import { SYSTEM_ROLES } from '../data/roles';
import { SUPREMEAI_MODELS } from '../data/models';
import { chatService, VisionRequestError } from '../services/chatService';
import type { ClassifiedVisionError } from '../shared/visionRouting';
import { conversationService } from '../services/conversationService';
import { researchService } from '../services/researchService';
import { useAuthStore } from './useAuthStore';
import { useCustomerStore } from './useCustomerStore';
import { usePlatformStore } from './usePlatformStore';
import { toast } from './useToastStore';
import {
  generateHeuristicChatTitle,
  isDefaultSessionTitle,
  requestAutoChatTitle,
} from '../utils/chatTitleGenerator';
import {
  extractStreamingArtifact,
  extractVirtualProject,
  inferLangFromProjectPath,
  pickProjectEntryFile,
} from '../utils/artifactStreamParser';
import { useWorkspaceStore } from './useWorkspaceStore';
import {
  hasSchedulingIntent,
  parseAiScheduleBlocks,
  parseNaturalLanguageSchedule,
  saveScheduledTask,
} from '../services/browserVaultService';
import {
  buildBrowserSystemContext,
  detectBrowserNavigationIntent,
  rewriteBrowserRefusalIfNeeded,
  toBrowserNavigationMetadata,
} from '../utils/chatBrowserIntent';
import { schedulePreferencesPatch } from '../services/userPreferencesSyncBus';
import { parseSmartIntent, resolveAutoModel, resolveThinkingParams } from '../utils/chatAutoIntent';
import {
  buildMemoryContextPrompt,
  loadUserMemory,
  type IntentOrchestrationResult,
} from '../services/intentOrchestrator';
import { getTranslation } from '../utils/i18n';
import { DEFAULT_WORKBENCH_RUN_SETTINGS } from '../utils/workbenchUtils';
import {
  buildAutoRepairPrompt,
  runSandboxVerificationStep,
  shouldVerifyProjectInAgentLoop,
} from '../utils/chatAgentLoop';
import {
  getMessageAttachments,
  isImageAttachment,
  normalizeAttachmentPayload,
  pruneSessionsForStorage,
} from '../utils/imageAttachmentUtils';
import { logger } from '../utils/logger';
import { executeAutonomousTask } from '../services/agentExecutionService';
import {
  shouldRouteToAutonomousAgent,
  type AgentToolAction,
  type PendingTaskApproval,
} from '../shared/agentTypes';

const STORAGE_KEY = 'supremeai_studio_sessions_v1';
const RUN_SETTINGS_STORAGE_KEY = 'supremeai_workbench_run_settings_v1';

function persistSessionsSafely(sessions: ChatSession[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    try {
      const pruned = pruneSessionsForStorage(sessions);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
    } catch {
      // Ignore storage errors in private/restricted browser modes
    }
  }
}

const VISION_ANALYSIS_GUIDANCE = `

[MULTIMODAL VISION ANALYSIS PROTOCOL]
The user has attached one or more images for analysis:
1. Inspect every relevant visual detail systematically (foreground, background, layout, labels, tables, small text, code, numbers, and spatial relationships).
2. Transcribe visible text, numbers, equations, or error messages verbatim before interpreting them.
3. Never fabricate or guess details that are blurry, occluded, or cropped out — state clearly what cannot be verified from the image.
4. Answer the user's question directly with clean, structured formatting in their preferred language (without generating unrelated boilerplate code projects unless explicitly requested).`;

function loadSavedRunSettings(): WorkbenchRunSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_WORKBENCH_RUN_SETTINGS;
  try {
    const raw = localStorage.getItem(RUN_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_WORKBENCH_RUN_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<WorkbenchRunSettings>;
    return {
      ...DEFAULT_WORKBENCH_RUN_SETTINGS,
      ...parsed,
    };
  } catch {
    return DEFAULT_WORKBENCH_RUN_SETTINGS;
  }
}

interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string;
  activeModel: ModelDetail;
  activeRole: RolePersona;
  customInstruction: string;
  runSettings: WorkbenchRunSettings;
  isStreaming: boolean;
  streamingContent: string;
  streamingAgentSteps: AgentExecutionStep[];
  streamingGroundingSources: GroundingSource[];
  streamingTokenUsage: TokenUsageSummary | null;
  streamingRouteMeta: ChatRouteMeta | null;
  lastPlanSummary: string | null;
  pendingTaskApproval: PendingTaskApproval | null;
  inferenceError: string | null;
  inferenceErrorMeta: ClassifiedVisionError | null;
  generatingTitleIds: string[];
  remotePinnedSessionIds: string[];
  isPromptModalOpen: boolean;
  isRoleModalOpen: boolean;

  // Session Management Actions
  selectSession: (id: string) => Promise<void> | void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, newTitle: string) => void;
  togglePinSession: (id: string) => void;
  createNewSession: () => void;
  branchSession: (sourceSessionId?: string, upToMessageId?: string) => string;
  clearCurrentThread: () => void;
  exportThread: (format: 'markdown' | 'text' | 'json') => void;
  syncRemoteSessions: () => Promise<void>;
  applyRemoteChatPrefs: (prefs: {
    selectedModelId?: string;
    activeRoleId?: string;
    customInstruction?: string;
    pinnedSessionIds?: string[];
  }) => void;
  resetAccountSessions: () => void;

  // Model & Role Actions
  selectModel: (model: ModelDetail) => void;
  selectRole: (role: RolePersona, customPrompt?: string) => void;
  setCustomInstruction: (instruction: string) => void;
  updateRunSettings: (patch: Partial<WorkbenchRunSettings>) => void;
  setIsPromptModalOpen: (open: boolean) => void;
  setIsRoleModalOpen: (open: boolean) => void;

  // Inference Actions
  sendMessage: (
    text: string,
    attachment?: ChatAttachment,
    groundingDocs?: KnowledgeDoc[],
    deepResearch?: boolean,
    extraAttachments?: ChatAttachment[],
    precomputedIntent?: IntentOrchestrationResult
  ) => Promise<void>;
  appendVoiceTurn: (userText: string, assistantText: string, voiceName?: string) => void;
  stopStreaming: () => void;
  clearInferenceError: () => void;
  approvePendingTask: () => Promise<void>;
  dismissPendingTask: () => void;
  clearPendingTaskApproval: () => void;
}

export const useChatStore = create<ChatState>((set, get) => {
  let abortController: AbortController | null = null;
  let activeArtifactThrottleTimer: ReturnType<typeof setTimeout> | null = null;

  const getInitialSessions = (): ChatSession[] => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (error) {
      logger.debug('useChatStore: suppressed non-fatal error', error);
    }

    const initialSession: ChatSession = {
      id: `session_${Date.now()}`,
      title: 'SupremeAI Chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: 'supreme-spark',
      roleId: SYSTEM_ROLES[0].id,
      messages: [],
    };
    return [initialSession];
  };

  const initialSessions = getInitialSessions();

  const scheduleChatPrefsSync = () => {
    const st = get();
    const pinnedSet = new Set(st.sessions.filter((s) => s.isPinned).map((s) => s.id));
    schedulePreferencesPatch({
      chat_prefs: {
        selectedModelId: st.activeModel?.id,
        activeRoleId: st.activeRole?.id,
        customInstruction: st.customInstruction,
        pinnedSessionIds: Array.from(pinnedSet),
      },
    });
  };

  return {
    sessions: initialSessions,
    activeSessionId: initialSessions[0]?.id || '',
    activeModel: SUPREMEAI_MODELS.find((m) => m.id === 'supreme-spark') || SUPREMEAI_MODELS[0],
    activeRole: SYSTEM_ROLES[0],
    customInstruction: '',
    runSettings: loadSavedRunSettings(),
    isStreaming: false,
    streamingContent: '',
    streamingAgentSteps: [],
    streamingGroundingSources: [],
    streamingTokenUsage: null,
    streamingRouteMeta: null,
    lastPlanSummary: null,
    pendingTaskApproval: null,
    inferenceError: null,
    inferenceErrorMeta: null,
    generatingTitleIds: [],
    remotePinnedSessionIds: [],
    isPromptModalOpen: false,
    isRoleModalOpen: false,

    selectSession: async (id: string) => {
      set({ activeSessionId: id, inferenceError: null, inferenceErrorMeta: null });
      const target = get().sessions.find((s) => s.id === id);
      if (target && target.messages.length === 0) {
        try {
          const remoteMsgs = await conversationService.getMessages(id);
          if (remoteMsgs.length > 0) {
            const updated = get().sessions.map((s) =>
              s.id === id ? { ...s, messages: remoteMsgs } : s
            );
            persistSessionsSafely(updated);
            set({ sessions: updated });
          }
        } catch {
          // Keep current local session state
        }
      }
    },

    deleteSession: (id: string) => {
      const { sessions, activeSessionId, activeModel, activeRole } = get();
      const filtered = sessions.filter((s) => s.id !== id);

      // Asynchronously delete from remote server persistence
      conversationService.deleteConversation(id).catch(() => {});

      if (filtered.length === 0) {
        const fallback: ChatSession = {
          id: `session_${Date.now()}`,
          title: 'New Conversation',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          model: activeModel.id,
          roleId: activeRole.id,
          messages: [],
        };
        persistSessionsSafely([fallback]);
        set({ sessions: [fallback], activeSessionId: fallback.id });
        return;
      }

      persistSessionsSafely(filtered);
      set({
        sessions: filtered,
        activeSessionId: activeSessionId === id ? filtered[0].id : activeSessionId,
      });
      toast.info('Session Deleted', 'Conversation removed from workspace history.');
    },

    renameSession: (id: string, newTitle: string) => {
      const trimmed = newTitle.trim();
      if (!trimmed) return;
      const { sessions, generatingTitleIds } = get();
      const updated = sessions.map((s) => (s.id === id ? { ...s, title: trimmed } : s));
      persistSessionsSafely(updated);
      set({
        sessions: updated,
        generatingTitleIds: generatingTitleIds.filter((gid) => gid !== id),
      });
      if (localStorage.getItem('supremeai_access_token')) {
        conversationService.renameConversation(id, trimmed).catch(() => {});
      }
    },

    togglePinSession: (id: string) => {
      const { sessions, remotePinnedSessionIds } = get();
      const target = sessions.find((s) => s.id === id);
      const nextPinned = target ? !target.isPinned : true;
      const updated = sessions.map((s) => (s.id === id ? { ...s, isPinned: nextPinned } : s));
      const nextRemotePinned = nextPinned
        ? Array.from(new Set([...remotePinnedSessionIds, id]))
        : remotePinnedSessionIds.filter((pid) => pid !== id);
      persistSessionsSafely(updated);
      set({ sessions: updated, remotePinnedSessionIds: nextRemotePinned });
      scheduleChatPrefsSync();
    },

    createNewSession: () => {
      const { sessions, activeModel, activeRole, customInstruction } = get();
      const newSession: ChatSession = {
        id: `session_${Date.now()}`,
        title: 'New Conversation',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        model: activeModel.id,
        roleId: activeRole.id,
        customSystemInstruction: customInstruction || undefined,
        messages: [],
      };

      const updated = [newSession, ...sessions];
      persistSessionsSafely(updated);
      set({
        sessions: updated,
        activeSessionId: newSession.id,
        inferenceError: null,
        inferenceErrorMeta: null,
      });
    },

    branchSession: (sourceSessionId?: string, upToMessageId?: string): string => {
      const { sessions, activeSessionId } = get();
      const targetId = sourceSessionId || activeSessionId;
      const source = sessions.find((s) => s.id === targetId) || sessions[0];
      if (!source) return '';

      let inheritedMessages = [...source.messages];
      if (upToMessageId) {
        const idx = source.messages.findIndex((m) => m.id === upToMessageId);
        if (idx !== -1) {
          inheritedMessages = source.messages.slice(0, idx + 1);
        }
      }

      const newBranch: ChatSession = {
        id: `branch_${Date.now()}`,
        title: `${source.title} (Branch)`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        model: source.model,
        roleId: source.roleId,
        customSystemInstruction: source.customSystemInstruction,
        messages: inheritedMessages,
        projectId: source.projectId,
        parentSessionId: source.id,
      };

      const updated = [newBranch, ...sessions];
      persistSessionsSafely(updated);
      set({
        sessions: updated,
        activeSessionId: newBranch.id,
        inferenceError: null,
        inferenceErrorMeta: null,
      });

      toast.success('Session Branched', `Created new branch "${newBranch.title}".`);
      return newBranch.id;
    },

    clearCurrentThread: () => {
      const { sessions, activeSessionId } = get();
      const updated = sessions.map((s) =>
        s.id === activeSessionId ? { ...s, messages: [], updatedAt: Date.now() } : s
      );
      persistSessionsSafely(updated);
      set({
        sessions: updated,
        streamingContent: '',
        inferenceError: null,
        inferenceErrorMeta: null,
      });
      toast.info('Thread Cleared', 'Messages removed from active conversation.');
    },

    exportThread: (format: 'markdown' | 'text' | 'json') => {
      const { sessions, activeSessionId } = get();
      const current = sessions.find((s) => s.id === activeSessionId) || sessions[0];
      if (!current) return;

      let blob: Blob;
      let filename: string;
      const safeTitle = current.title.toLowerCase().replace(/[^a-z0-9]/g, '_');

      if (format === 'markdown') {
        let md = `# ${current.title}\n`;
        md += `*Exported from SupremeAI Studio · Model: ${current.model} · Date: ${new Date().toLocaleString()}*\n\n---\n\n`;

        current.messages.forEach((msg) => {
          const sender =
            msg.role === 'user' ? '### User' : `### Assistant (${msg.roleName || 'SupremeAI'})`;
          md += `${sender}\n\n${msg.content}\n\n---\n\n`;
        });

        blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        filename = `${safeTitle}_export.md`;
      } else if (format === 'text') {
        let txt = `${current.title}\nExported: ${new Date().toLocaleString()}\n${'='.repeat(48)}\n\n`;
        current.messages.forEach((msg) => {
          const sender = msg.role === 'user' ? 'You' : msg.roleName || 'SupremeAI';
          txt += `${sender}:\n${msg.content}\n\n${'-'.repeat(32)}\n\n`;
        });
        blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
        filename = `${safeTitle}_export.txt`;
      } else {
        const json = JSON.stringify(current, null, 2);
        blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        filename = `${safeTitle}_export.json`;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Thread Exported', `Downloaded as ${filename}`);
    },

    selectModel: (model: ModelDetail) => {
      set({ activeModel: model });
      scheduleChatPrefsSync();
      toast.info('Model Switched', `Active model set to ${model.name}`);
    },

    selectRole: (role: RolePersona, customPrompt?: string) => {
      const matchedModel = SUPREMEAI_MODELS.find((m) => m.id === role.suggestedModel);
      set((state) => ({
        activeRole: role,
        customInstruction: customPrompt || '',
        activeModel: matchedModel || state.activeModel,
      }));
      scheduleChatPrefsSync();
      toast.info('Role Configured', `Persona set to ${role.name}`);
    },

    setCustomInstruction: (instruction: string) => {
      set({ customInstruction: instruction });
      scheduleChatPrefsSync();
    },
    updateRunSettings: (patch: Partial<WorkbenchRunSettings>) => {
      set((state) => {
        const next: WorkbenchRunSettings = { ...state.runSettings, ...patch };
        if (next.responseMimeType === 'application/json') {
          next.enableSearchGrounding = false;
        }
        try {
          localStorage.setItem(RUN_SETTINGS_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Ignore quota errors
        }
        return { runSettings: next };
      });
    },
    setIsPromptModalOpen: (open: boolean) => set({ isPromptModalOpen: open }),
    setIsRoleModalOpen: (open: boolean) => set({ isRoleModalOpen: open }),
    clearInferenceError: () => set({ inferenceError: null, inferenceErrorMeta: null }),
    clearPendingTaskApproval: () => set({ pendingTaskApproval: null }),

    dismissPendingTask: () => {
      const pending = get().pendingTaskApproval;
      if (!pending) return;
      set({ pendingTaskApproval: null });
      if (!pending.draftAnswer.trim()) return;
      const targetId = pending.sessionId || get().activeSessionId;
      const { activeModel, activeRole } = get();
      const assistantMsg: ChatMessage = {
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: `${pending.draftAnswer}\n\n_(Pending actions skipped by user.)_`,
        timestamp: Date.now(),
        model: activeModel.id,
        roleName: activeRole.name,
        ...(pending.groundingSources?.length ? { groundingSources: pending.groundingSources } : {}),
        ...(pending.steps.length ? { agentSteps: pending.steps } : {}),
      };
      const updated = get().sessions.map((s) =>
        s.id === targetId
          ? { ...s, messages: [...s.messages, assistantMsg], updatedAt: Date.now() }
          : s
      );
      persistSessionsSafely(updated);
      set({ sessions: updated });
    },

    approvePendingTask: async () => {
      const pending = get().pendingTaskApproval;
      if (!pending) return;
      set({ pendingTaskApproval: null });

      const wsState = useWorkspaceStore.getState();
      const executedSteps: AgentExecutionStep[] = [...pending.steps];

      for (const action of pending.actions) {
        if (action.type === 'create_schedule') {
          const { created } = await saveScheduledTask({
            title: action.payload.title,
            targetUrl: action.payload.targetUrl,
            cadence: action.payload.cadence,
            cronExpression: action.payload.cronExpression,
            instruction: action.payload.instruction,
          });
          wsState.setActiveDockTab('schedule');
          wsState.setDockOpen(true);
          toast.success('Schedule Added', `${created.title} (${created.cronExpression})`);
          executedSteps.push({
            id: `approved_${action.id}`,
            label: `Activated schedule: ${created.title}`,
            tool: 'create_schedule',
            status: 'done',
            detail: created.cronExpression,
          });
        } else if (action.type === 'open_browser') {
          wsState.setActiveDockTab('browser');
          wsState.setDockOpen(true);
          void wsState.navigateBrowser(action.payload.url);
        } else if (action.type === 'dashboard_action' && typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('supremeai-dashboard-action', {
              detail: { action: action.payload.action, language: pending.language },
            })
          );
        } else if (action.type === 'update_project' && action.payload.files.length > 0) {
          const vFiles = action.payload.files.map((f) => ({
            path: f.path,
            lang: f.lang || inferLangFromProjectPath(f.path),
            content: f.content,
          }));
          const runtime = action.payload.runtime || 'web';
          wsState.syncVirtualProject(
            {
              title: action.payload.title || 'Agent Workspace Project',
              runtime,
              entryFile: action.payload.entryFile || pickProjectEntryFile(vFiles, runtime),
              files: vFiles,
            },
            { autoOpenDock: true, isFinal: true, captureDiffBaseline: true }
          );
        }
      }

      const targetId = pending.sessionId || get().activeSessionId;
      const { activeModel, activeRole } = get();
      const assistantMsg: ChatMessage = {
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: pending.draftAnswer || 'Approved actions have been executed.',
        timestamp: Date.now(),
        model: activeModel.id,
        roleName: activeRole.name,
        ...(pending.groundingSources?.length ? { groundingSources: pending.groundingSources } : {}),
        ...(executedSteps.length ? { agentSteps: executedSteps } : {}),
        routeMeta: {
          servedModel: activeModel.id,
          poolType: 'api-pool',
          engine: 'Autonomous Agent',
        },
      };
      const updated = get().sessions.map((s) =>
        s.id === targetId
          ? { ...s, messages: [...s.messages, assistantMsg], updatedAt: Date.now() }
          : s
      );
      persistSessionsSafely(updated);
      set({ sessions: updated });

      const targetSession = updated.find((s) => s.id === targetId);
      conversationService
        .createConversation(targetSession?.title || 'SupremeAI Chat', targetId, activeModel.id)
        .then(() => {
          conversationService.syncMessage(targetId, 'user', pending.originalPrompt);
          conversationService.syncMessage(targetId, 'assistant', assistantMsg.content);
        })
        .catch(() => {});
    },

    sendMessage: async (
      text: string,
      attachment?: ChatAttachment,
      groundingDocs?: KnowledgeDoc[],
      deepResearch?: boolean,
      extraAttachments?: ChatAttachment[],
      precomputedIntent?: IntentOrchestrationResult
    ) => {
      const { sessions, activeSessionId, activeModel, activeRole, customInstruction, isStreaming } =
        get();
      const attachmentFields = normalizeAttachmentPayload(extraAttachments, attachment);
      const allAttachments = getMessageAttachments(attachmentFields);
      const primaryAttachment = allAttachments[0];
      if ((!text.trim() && allAttachments.length === 0) || isStreaming) return;

      const current = sessions.find((s) => s.id === activeSessionId) || sessions[0];
      if (!current) return;

      set({
        inferenceError: null,
        inferenceErrorMeta: null,
        pendingTaskApproval: null,
        lastPlanSummary: precomputedIntent?.planSummary || null,
      });

      const authStateSnapshot = useAuthStore.getState();
      const customerStateSnapshot = useCustomerStore.getState();
      const customerSettingsSnapshot = customerStateSnapshot.userSettings;
      const platformConfigSnapshot = usePlatformStore.getState().config;
      const candidateKnowledgeDocs =
        groundingDocs && groundingDocs.length > 0
          ? groundingDocs
          : customerStateSnapshot.knowledgeDocs;
      const smartIntent =
        precomputedIntent ||
        parseSmartIntent({
          promptText: text,
          attachment: primaryAttachment,
          knowledgeDocs: candidateKnowledgeDocs,
          enableKnowledgeGroundingPref: true,
        });

      const isDevOrAdmin =
        authStateSnapshot.currentRole === 'admin' ||
        (Boolean(authStateSnapshot.authUser?.isDeveloperEligible) &&
          Boolean(customerSettingsSnapshot.developerMode));
      const useAutoRouting = !isDevOrAdmin || customerSettingsSnapshot.autoModelRouting !== false;

      const semanticRecommendedModel = precomputedIntent?.recommendedModelId
        ? SUPREMEAI_MODELS.find((m) => m.id === precomputedIntent.recommendedModelId)
        : undefined;

      const effectiveModel = useAutoRouting
        ? semanticRecommendedModel ||
          resolveAutoModel({
            promptText: text,
            attachment: primaryAttachment,
            models: SUPREMEAI_MODELS,
            platformConfig: platformConfigSnapshot,
            userTier: authStateSnapshot.authUser?.plan || customerSettingsSnapshot.plan,
            currentRole: authStateSnapshot.currentRole,
            fallbackModel: activeModel,
          })
        : activeModel;
      const effectiveDeepResearch =
        deepResearch !== undefined ? deepResearch : smartIntent.enableDeepResearch;

      // Auto-open the matching Workspace Dock tab on demand so users don't hunt across 7 tabs
      if (
        precomputedIntent?.autoOpenDockTab &&
        precomputedIntent.autoOpenDockTab !== 'none' &&
        precomputedIntent.autoOpenDockTab !== 'preview'
      ) {
        const ws = useWorkspaceStore.getState();
        ws.setActiveDockTab(precomputedIntent.autoOpenDockTab);
        ws.setDockOpen(true);
      }

      const savedRunSettings = get().runSettings;
      const effectiveThinkingLevel =
        isDevOrAdmin && savedRunSettings.thinkingMode === 'manual'
          ? savedRunSettings.thinkingLevel
          : smartIntent.recommendedThinkingLevel;
      const effectiveResponseMimeType: WorkbenchRunSettings['responseMimeType'] =
        isDevOrAdmin && savedRunSettings.responseMimeType === 'application/json'
          ? 'application/json'
          : smartIntent.enableJsonOutput
            ? 'application/json'
            : 'text/plain';
      const effectiveSearchGrounding =
        effectiveResponseMimeType === 'application/json'
          ? false
          : isDevOrAdmin && savedRunSettings.searchMode === 'manual'
            ? savedRunSettings.enableSearchGrounding
            : smartIntent.enableSearchGrounding;
      const effectiveAgentLoopEnabled = isDevOrAdmin ? savedRunSettings.agentLoopEnabled : true;
      const effectiveRunSettings: WorkbenchRunSettings = {
        ...savedRunSettings,
        thinkingLevel: effectiveThinkingLevel,
        enableSearchGrounding: effectiveSearchGrounding,
        responseMimeType: effectiveResponseMimeType,
        jsonSchemaText: isDevOrAdmin ? savedRunSettings.jsonSchemaText : '',
        agentLoopEnabled: effectiveAgentLoopEnabled,
      };

      const userMsg: ChatMessage = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: Date.now(),
        ...attachmentFields,
      };

      const updatedMessages = [...current.messages, userMsg];
      const isFirstUserMessage = current.messages.filter((m) => m.role === 'user').length === 0;
      const shouldAutoTitle = isFirstUserMessage && isDefaultSessionTitle(current.title);
      const sessionTitle = shouldAutoTitle
        ? generateHeuristicChatTitle(text, primaryAttachment)
        : current.title;

      const updatedSessions = sessions.map((s) =>
        s.id === current.id
          ? {
              ...s,
              title: sessionTitle,
              messages: updatedMessages,
              updatedAt: Date.now(),
              model: effectiveModel.id,
              roleId: activeRole.id,
            }
          : s
      );

      persistSessionsSafely(updatedSessions);
      set((state) => ({
        sessions: updatedSessions,
        isStreaming: true,
        streamingContent: '',
        streamingAgentSteps: [],
        streamingGroundingSources: [],
        streamingTokenUsage: null,
        streamingRouteMeta: null,
        generatingTitleIds: shouldAutoTitle
          ? Array.from(new Set([...state.generatingTitleIds, current.id]))
          : state.generatingTitleIds,
      }));

      if (shouldAutoTitle) {
        const targetId = current.id;
        const provisionalTitle = sessionTitle;
        void requestAutoChatTitle({
          message: text,
          attachmentName: primaryAttachment?.name,
          attachmentMimeType: primaryAttachment?.mimeType,
        })
          .then((aiTitle) => {
            if (!aiTitle) return;
            const latestSessions = get().sessions;
            const targetSession = latestSessions.find((s) => s.id === targetId);
            if (!targetSession) return;
            // Respect manual user renames performed before the AI title resolved
            if (
              targetSession.title !== provisionalTitle &&
              !isDefaultSessionTitle(targetSession.title)
            ) {
              return;
            }
            if (targetSession.title === aiTitle) return;

            const nextSessions = latestSessions.map((s) =>
              s.id === targetId ? { ...s, title: aiTitle } : s
            );
            persistSessionsSafely(nextSessions);
            set({ sessions: nextSessions });

            if (localStorage.getItem('supremeai_access_token')) {
              conversationService.renameConversation(targetId, aiTitle).catch(() => {});
            }
          })
          .finally(() => {
            set((state) => ({
              generatingTitleIds: state.generatingTitleIds.filter((gid) => gid !== targetId),
            }));
          });
      }

      // Collect smart-intent + explicitly active RAG grounding documents (never drop auto-matched docs!)
      const activeGrounding =
        smartIntent.matchedDocs.length > 0
          ? smartIntent.matchedDocs
          : (groundingDocs || []).filter((d) => d.isGroundingActive);
      const groundingContext =
        activeGrounding.length > 0
          ? activeGrounding
              .map(
                (d) => `[GROUNDING DOCUMENT: "${d.title}" (Type: ${d.type})]\n${d.contentPreview}`
              )
              .join('\n\n')
          : undefined;

      const preferredLanguage = useCustomerStore.getState().userSettings.language || 'en';

      if (effectiveDeepResearch) {
        set({
          streamingContent:
            'Initializing Deep Research pipeline...\nSynthesizing multi-source empirical intelligence...\n',
        });
        try {
          const res = await researchService.execute(text, 8, preferredLanguage);
          const assistantMsg: ChatMessage = {
            id: `msg_${Date.now()}`,
            role: 'assistant',
            content: `### 🔬 Deep Research Analysis: ${res.report.title}\n\n${res.report.summary}`,
            timestamp: Date.now(),
            model: effectiveModel.id,
            roleName: 'Deep Researcher',
            researchReport: res.report,
          };

          const finalSessions = get().sessions.map((s) =>
            s.id === current.id
              ? {
                  ...s,
                  messages: [...s.messages, assistantMsg],
                  updatedAt: Date.now(),
                }
              : s
          );

          persistSessionsSafely(finalSessions);
          set({
            sessions: finalSessions,
            isStreaming: false,
            streamingContent: '',
          });

          // Ensure remote conversation exists before syncing exchange
          const latestTitle =
            get().sessions.find((s) => s.id === current.id)?.title || sessionTitle;
          conversationService
            .createConversation(latestTitle, current.id, effectiveModel.id)
            .then(() => {
              conversationService.syncMessage(current.id, 'user', text);
              conversationService.syncMessage(current.id, 'assistant', assistantMsg.content);
            })
            .catch(() => {});
          return;
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : 'Deep research execution failed.';
          set({
            isStreaming: false,
            streamingContent: '',
            inferenceError: errorMsg,
            inferenceErrorMeta: null,
          });
          toast.error('Deep Research Error', errorMsg);
          return;
        }
      }

      const controller = new AbortController();
      abortController = controller;

      const authState = authStateSnapshot;
      const customerSettings = customerSettingsSnapshot;
      const userMemoryContext = buildMemoryContextPrompt(loadUserMemory());
      const baseSystemInstruction = `${
        customInstruction.trim() ||
        customerSettings.customInstructions?.trim() ||
        activeRole.systemInstruction
      }${userMemoryContext}`;

      const schedulePrompt = hasSchedulingIntent(text);
      const browserIntent = !schedulePrompt ? detectBrowserNavigationIntent(text) : null;
      let browserSnapshot: {
        status: 'idle' | 'loading' | 'loaded' | 'error';
        url: string;
        title: string;
        statusCode: number | null;
        textPreview: string;
        error: string | null;
      } | null = null;
      const recordedAgentSteps: AgentExecutionStep[] = [];
      const pushAgentStep = (step: AgentExecutionStep) => {
        const idx = recordedAgentSteps.findIndex((s) => s.id === step.id);
        if (idx >= 0) {
          recordedAgentSteps[idx] = step;
        } else {
          recordedAgentSteps.push(step);
        }
        set({ streamingAgentSteps: [...recordedAgentSteps] });
      };

      const tr = getTranslation(preferredLanguage);
      const thinkingParams = resolveThinkingParams(effectiveThinkingLevel);
      const formatPoolLabel = (meta?: ChatRouteMeta | null): string => {
        if (!meta?.poolType) {
          return effectiveModel.id === 'supremeai-web'
            ? tr.routeWebhookLabel
            : tr.routeApiPoolLabel;
        }
        if (meta.poolType === 'webhook') return tr.routeWebhookLabel;
        if (meta.poolType === 'local') return tr.routeLocalEngineLabel;
        return tr.routeApiPoolLabel;
      };

      if (useAutoRouting) {
        pushAgentStep({
          id: 'step_model_intelligence',
          label: `${tr.stepModelIntelligence} · ${effectiveModel.name}`,
          tool: 'model_intelligence',
          status: 'done',
          detail: formatPoolLabel(null),
        });
      }

      if (thinkingParams.highThinkingEnabled) {
        pushAgentStep({
          id: 'step_high_thinking',
          label: tr.stepHighThinking,
          tool: 'high_thinking',
          status: 'done',
          detail: `${effectiveThinkingLevel} (${thinkingParams.reasoningEffort})`,
        });
      } else if (effectiveModel.id === 'supreme-spark' || effectiveThinkingLevel === 'LOW') {
        pushAgentStep({
          id: 'step_low_latency',
          label: tr.stepLowLatency,
          tool: 'low_latency',
          status: 'done',
          detail: effectiveModel.name,
        });
      }

      if (activeGrounding.length > 0) {
        pushAgentStep({
          id: 'step_rag',
          label: `Grounded with ${activeGrounding.length} knowledge doc(s)`,
          tool: 'knowledge_rag',
          status: 'done',
          detail: activeGrounding
            .map((d) => d.title)
            .slice(0, 2)
            .join(', '),
        });
      }

      if (effectiveRunSettings.enableSearchGrounding) {
        pushAgentStep({
          id: 'step_search',
          label:
            preferredLanguage === 'bn'
              ? 'লাইভ ওয়েব সার্চ গ্রাউন্ডিং সক্রিয়'
              : 'Live Web Search Grounding',
          tool: 'google_search',
          status: 'done',
          detail: isDevOrAdmin && savedRunSettings.searchMode === 'manual' ? 'Manual' : 'Auto',
        });
      }

      // Autonomous Multi-Step Task Executor (tool-calling loop + Human-in-the-Loop approval)
      const wsFilesSnapshot = useWorkspaceStore.getState().projectFiles;
      if (
        effectiveRunSettings.agentLoopEnabled &&
        shouldRouteToAutonomousAgent({
          promptText: text,
          intent: precomputedIntent,
          hasAttachments: allAttachments.length > 0,
          deepResearch: effectiveDeepResearch,
          workspaceFileCount: wsFilesSnapshot.length,
        })
      ) {
        const plannerStepId = 'step_agent_planner';
        pushAgentStep({
          id: plannerStepId,
          label:
            preferredLanguage === 'bn'
              ? 'অটোনমাস টাস্ক এক্সিকিউটর চলছে'
              : 'Autonomous Task Executor',
          tool: 'agent_planner',
          status: 'running',
        });

        const agentRes = await executeAutonomousTask({
          prompt: text,
          language: precomputedIntent?.inferredLanguage || preferredLanguage,
          workspaceFiles: wsFilesSnapshot.slice(0, 12).map((f) => ({
            path: f.path,
            lang: f.lang,
            content: f.content.slice(0, 6000),
          })),
          recentTurns: current.messages.slice(-4).map((m) => ({
            role: m.role,
            content: m.content.slice(0, 240),
          })),
          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          return;
        }

        if (agentRes.status === 'completed' || agentRes.status === 'needs_approval') {
          pushAgentStep({
            id: plannerStepId,
            label:
              preferredLanguage === 'bn'
                ? 'অটোনমাস টাস্ক প্ল্যান সম্পন্ন'
                : 'Autonomous Task Plan Ready',
            tool: 'agent_planner',
            status: 'done',
            detail: agentRes.summary,
          });
          for (const st of agentRes.steps || []) {
            pushAgentStep(st);
          }

          const actions = agentRes.actions || [];
          const applyImmediateActions = (list: AgentToolAction[]) => {
            const ws = useWorkspaceStore.getState();
            for (const action of list) {
              if (action.requiresApproval) continue;
              if (action.type === 'open_browser') {
                ws.setActiveDockTab('browser');
                ws.setDockOpen(true);
                void ws.navigateBrowser(action.payload.url);
              } else if (action.type === 'dashboard_action' && typeof window !== 'undefined') {
                window.dispatchEvent(
                  new CustomEvent('supremeai-dashboard-action', {
                    detail: {
                      action: action.payload.action,
                      language: precomputedIntent?.inferredLanguage || preferredLanguage,
                    },
                  })
                );
              } else if (action.type === 'update_project' && action.payload.files.length > 0) {
                const vFiles = action.payload.files.map((f) => ({
                  path: f.path,
                  lang: f.lang || inferLangFromProjectPath(f.path),
                  content: f.content,
                }));
                const runtime = action.payload.runtime || 'web';
                ws.syncVirtualProject(
                  {
                    title: action.payload.title || 'Agent Workspace Project',
                    runtime,
                    entryFile: action.payload.entryFile || pickProjectEntryFile(vFiles, runtime),
                    files: vFiles,
                  },
                  { autoOpenDock: true, isFinal: true, captureDiffBaseline: true }
                );
              }
            }
          };

          applyImmediateActions(actions);

          if (agentRes.status === 'needs_approval') {
            set({
              isStreaming: false,
              streamingContent: '',
              streamingAgentSteps: [],
              streamingGroundingSources: [],
              streamingTokenUsage: null,
              streamingRouteMeta: null,
              pendingTaskApproval: {
                id: `approval_${Date.now()}`,
                sessionId: current.id,
                originalPrompt: text,
                summary: agentRes.summary || 'Confirm pending actions',
                language:
                  precomputedIntent?.inferredLanguage ||
                  (preferredLanguage === 'bn' ? 'bn' : 'en'),
                steps: [...recordedAgentSteps],
                actions,
                draftAnswer: agentRes.answer || '',
                ...(agentRes.groundingSources?.length
                  ? { groundingSources: agentRes.groundingSources }
                  : {}),
              },
            });
            abortController = null;
            return;
          }

          const finalAgentAnswer =
            (agentRes.answer || '').trim() || 'Completed requested autonomous task actions.';
          const assistantMsg: ChatMessage = {
            id: `msg_${Date.now()}`,
            role: 'assistant',
            content: finalAgentAnswer,
            timestamp: Date.now(),
            model: effectiveModel.id,
            roleName: activeRole.name,
            ...(agentRes.groundingSources?.length
              ? { groundingSources: agentRes.groundingSources }
              : {}),
            ...(recordedAgentSteps.length > 0 ? { agentSteps: recordedAgentSteps } : {}),
            routeMeta: {
              servedModel: effectiveModel.id,
              thinkingLevel: effectiveThinkingLevel,
              poolType: 'api-pool',
              engine: 'Autonomous Agent',
            },
          };

          const finalSessions = get().sessions.map((s) =>
            s.id === current.id
              ? {
                  ...s,
                  messages: [...s.messages, assistantMsg],
                  updatedAt: Date.now(),
                }
              : s
          );
          persistSessionsSafely(finalSessions);
          set({
            sessions: finalSessions,
            isStreaming: false,
            streamingContent: '',
            streamingAgentSteps: [],
            streamingGroundingSources: [],
            streamingTokenUsage: null,
            streamingRouteMeta: null,
          });
          abortController = null;

          const latestTitle =
            get().sessions.find((s) => s.id === current.id)?.title || sessionTitle;
          conversationService
            .createConversation(latestTitle, current.id, effectiveModel.id)
            .then(() => {
              conversationService.syncMessage(current.id, 'user', text);
              conversationService.syncMessage(current.id, 'assistant', finalAgentAnswer);
            })
            .catch(() => {});
          return;
        }
      }

      if (browserIntent) {
        const browseStart = Date.now();
        pushAgentStep({
          id: 'step_browser',
          label: `Inspecting ${browserIntent.url}`,
          tool: 'browser_inspect',
          status: 'running',
        });
        const wsState = useWorkspaceStore.getState();
        wsState.setActiveDockTab('browser');
        wsState.setDockOpen(true);
        const navPromise = wsState.navigateBrowser(browserIntent.url).catch(() => {});
        await Promise.race([navPromise, new Promise<void>((resolve) => setTimeout(resolve, 2200))]);
        const latestWs = useWorkspaceStore.getState();
        browserSnapshot = {
          status: latestWs.browserStatus,
          url: latestWs.browserUrl,
          title: latestWs.browserTitle,
          statusCode: latestWs.browserStatusCode,
          textPreview: latestWs.browserTextPreview,
          error: latestWs.browserError,
        };
        pushAgentStep({
          id: 'step_browser',
          label: `Inspected ${latestWs.browserTitle || browserIntent.url}`,
          tool: 'browser_inspect',
          status: latestWs.browserStatus === 'error' ? 'error' : 'done',
          detail: latestWs.browserStatusCode
            ? `HTTP ${latestWs.browserStatusCode}`
            : latestWs.browserStatus,
          durationMs: Date.now() - browseStart,
        });
      }

      const existingProjectFiles = useWorkspaceStore.getState().projectFiles;
      const existingFilesContext =
        existingProjectFiles.length > 0
          ? `\n\n[CURRENT WORKSPACE PROJECT FILES]\nThe user already has this active project in the editor. Update/extend affected files cleanly and return complete runnable file blocks:\n${existingProjectFiles
              .slice(0, 6)
              .map(
                (f) =>
                  `- ${f.path} (${f.lang}):\n\`\`\`${f.lang} file="${f.path}"\n${f.content.slice(0, 1200)}\n\`\`\``
              )
              .join('\n')}`
          : '';

      const studioWorkspaceGuidance = `\n\n[AUTONOMOUS PRODUCTION PROJECT BUILDER]
When the user asks to create, build, design, or fix a project, app, website, dashboard, or backend feature:
1. NEVER output a minimal "hello world" stub, directory tree diagram alone, or manual terminal setup tutorial unless explicitly asked for concepts only. Deliver a complete, production-ready, styled, working product immediately.
2. Put EVERY project file in a fenced code block tagged with its path: e.g. \`\`\`php file="index.php"\`\`\`, \`\`\`css file="styles.css"\`\`\`, \`\`\`html file="index.html"\`\`\`, \`\`\`tsx file="src/App.tsx"\`\`\`, or \`\`\`python file="app.py"\`\`\`.
3. For PHP projects: generate complete interactive PHP+HTML/CSS/Tailwind pages (\`index.php\`, \`includes/header.php\`, \`includes/data.php\`, \`styles.css\`, etc.) with clean modern UI, realistic sample data, working navigation links, and interactive forms (\`$_GET\` / \`$_POST\`) — avoid requiring external database daemons so the project runs immediately.
4. For Web / React apps: build polished responsive layouts with full styling, realistic data, zero placeholder TODOs, and clean interactivity.
5. For Python / Node scripts or APIs: provide a complete runnable entry script (\`main.py\` / \`app.py\` or \`index.js\`) with clear formatted stdout output.${existingFilesContext}`;

      const hasImageInput = allAttachments.some((att) => isImageAttachment(att));
      const imageCount = allAttachments.filter((att) => isImageAttachment(att)).length;
      const visionStart = allAttachments.length > 0 ? Date.now() : 0;
      let visionStepFinalized = allAttachments.length === 0;
      const visionDetailSummary =
        allAttachments.length > 2
          ? `${allAttachments
              .slice(0, 2)
              .map((a) => a.name)
              .join(', ')} +${allAttachments.length - 2}`
          : allAttachments.map((a) => a.name).join(', ');

      if (allAttachments.length > 0) {
        pushAgentStep({
          id: 'step_vision',
          label: hasImageInput
            ? preferredLanguage === 'bn'
              ? `ভিশন মোড · ${imageCount}টি ছবি বিশ্লেষণ হচ্ছে`
              : `Vision Mode · Inspecting ${imageCount} image${imageCount > 1 ? 's' : ''}`
            : preferredLanguage === 'bn'
              ? `ফাইল বিশ্লেষণ · ${allAttachments.length}টি ফাইল পড়া হচ্ছে`
              : `File Inspection · Reading ${allAttachments.length} file${allAttachments.length > 1 ? 's' : ''}`,
          tool: hasImageInput ? 'vision_inspect' : 'file_inspect',
          status: 'running',
          detail: visionDetailSummary,
        });
      }

      const markVisionStepDone = () => {
        if (visionStepFinalized) return;
        visionStepFinalized = true;
        pushAgentStep({
          id: 'step_vision',
          label: hasImageInput
            ? preferredLanguage === 'bn'
              ? `ভিশন মোড · ${imageCount}টি ছবি বিশ্লেষিত`
              : `Vision Mode · Inspected ${imageCount} image${imageCount > 1 ? 's' : ''}`
            : preferredLanguage === 'bn'
              ? `ফাইল বিশ্লেষণ · ${allAttachments.length}টি ফাইল সম্পন্ন`
              : `File Inspection · Read ${allAttachments.length} file${allAttachments.length > 1 ? 's' : ''}`,
          tool: hasImageInput ? 'vision_inspect' : 'file_inspect',
          status: 'done',
          detail: visionDetailSummary,
          durationMs: Math.max(1, Date.now() - visionStart),
        });
      };

      const explicitCodeBuildWithImage =
        /\b(build|create|make|generate|code|implement|convert|recreate|turn\s+(?:this|it)\s+into)\b|(বানাও|তৈরি\s*করো|কোড)/i.test(
          text
        );
      const shouldInjectStudioBuilder =
        !hasImageInput || smartIntent.enableProjectBuilder || explicitCodeBuildWithImage;

      const isTrivialQuery =
        text.trim().length < 20 &&
        !schedulePrompt &&
        !browserIntent &&
        !existingFilesContext &&
        allAttachments.length === 0;

      const effectiveSystemInstruction = schedulePrompt
        ? `${baseSystemInstruction}\n\n[SCHEDULING CAPABILITY]\nIf the user asks to schedule a recurring website check or web automation task, confirm the schedule naturally in their language and append one fenced block:\n\`\`\`supreme-schedule\n{"title":"Short job title","url":"https://example.com","cadence":"hourly|daily|weekly","cron":"0 8 * * *","instruction":"Task instructions"}\n\`\`\`\nNever ask for passwords or secrets.`
        : browserIntent
          ? `${baseSystemInstruction}\n\n${buildBrowserSystemContext(browserIntent, browserSnapshot)}`
          : hasImageInput && !shouldInjectStudioBuilder
            ? `${baseSystemInstruction}${VISION_ANALYSIS_GUIDANCE}`
            : isTrivialQuery
              ? baseSystemInstruction
              : `${baseSystemInstruction}${hasImageInput ? `${VISION_ANALYSIS_GUIDANCE}${studioWorkspaceGuidance}` : studioWorkspaceGuidance}`;

      let accumulatedStreamText = '';
      let hasAutoOpenedDockThisTurn = false;
      let capturedDiffBaselineThisTurn = false;
      let lastSyncedSignature = '';

      const clearArtifactThrottle = () => {
        if (activeArtifactThrottleTimer) {
          clearTimeout(activeArtifactThrottleTimer);
          activeArtifactThrottleTimer = null;
        }
      };

      const shouldAutoSync = () => {
        const wsLiveSync = useWorkspaceStore.getState().liveArtifactSync;
        if (!wsLiveSync) return false;
        if (hasImageInput) {
          return shouldInjectStudioBuilder && smartIntent.enableLiveArtifactSync;
        }
        return smartIntent.enableLiveArtifactSync;
      };

      const syncArtifactSnapshot = (markdownText: string, isFinal: boolean) => {
        clearArtifactThrottle();
        const wsState = useWorkspaceStore.getState();
        if (!shouldAutoSync()) {
          if (isFinal && wsState.isArtifactStreaming) {
            wsState.setArtifactStreaming(false);
          }
          return;
        }

        const virtualProject = extractVirtualProject(markdownText);
        if (virtualProject && virtualProject.files.length > 0) {
          const projSig = `proj:${virtualProject.runtime}:${virtualProject.entryFile}:${virtualProject.files
            .map((f) => `${f.path}:${f.content.length}`)
            .join('|')}`;
          if (!isFinal && projSig === lastSyncedSignature) {
            return;
          }
          lastSyncedSignature = projSig;

          const shouldAutoOpen = !hasAutoOpenedDockThisTurn;
          if (shouldAutoOpen) hasAutoOpenedDockThisTurn = true;
          const captureDiffBaseline = !capturedDiffBaselineThisTurn;
          if (captureDiffBaseline) capturedDiffBaselineThisTurn = true;

          wsState.syncVirtualProject(virtualProject, {
            autoOpenDock: shouldAutoOpen,
            isFinal,
            captureDiffBaseline,
          });

          if (
            isFinal &&
            (virtualProject.runtime === 'python' || virtualProject.runtime === 'node')
          ) {
            void useWorkspaceStore.getState().runCurrentServerProject();
          }
          return;
        }

        const artifact = extractStreamingArtifact(markdownText);
        if (!artifact) {
          if (isFinal && wsState.isArtifactStreaming) {
            wsState.setArtifactStreaming(false);
          }
          return;
        }

        const signature = `${artifact.targetTab}:${artifact.lang}:${artifact.blockIndex}:${artifact.code}`;
        if (!isFinal && signature === lastSyncedSignature) {
          return;
        }
        lastSyncedSignature = signature;

        const shouldAutoOpen = !hasAutoOpenedDockThisTurn;
        if (shouldAutoOpen) {
          hasAutoOpenedDockThisTurn = true;
        }

        const canUseSandboxTab =
          Boolean(authState.authUser) &&
          Boolean(authState.authUser?.isDeveloperEligible) &&
          Boolean(customerSettings.developerMode);
        const resolvedTargetTab =
          artifact.targetTab === 'sandbox' && !canUseSandboxTab ? 'preview' : artifact.targetTab;

        const captureDiffBaseline =
          !capturedDiffBaselineThisTurn && resolvedTargetTab === 'preview';
        if (captureDiffBaseline) {
          capturedDiffBaselineThisTurn = true;
        }

        wsState.syncStreamingArtifact(artifact.code, artifact.lang, {
          targetTab: resolvedTargetTab,
          autoOpenDock: shouldAutoOpen,
          isFinal,
          captureDiffBaseline,
        });
      };

      let streamDoneText: string | null = null;
      let streamFailed = false;
      let latestMetaSources: GroundingSource[] = [];
      let latestMetaUsage: TokenUsageSummary | null = null;
      let latestRouteMeta: ChatRouteMeta = {
        servedModel: effectiveModel.id,
        thinkingLevel: effectiveThinkingLevel,
        reasoningEffort: thinkingParams.reasoningEffort,
        poolType: effectiveModel.id === 'supremeai-web' ? 'webhook' : 'api-pool',
      };

      await chatService.streamChat({
        model: effectiveModel.id,
        messages: updatedMessages,
        sessionId: current.id,
        systemInstruction: effectiveSystemInstruction,
        groundingContext,
        deepResearch: effectiveDeepResearch,
        language: preferredLanguage,
        temperature: customerSettings.temperature,
        topP: customerSettings.topP,
        maxTokens: customerSettings.maxTokens,
        thinkingBudget: customerSettings.thinkingBudget,
        runConfig: effectiveRunSettings,
        userContext: {
          email: authState.authUser?.email || customerSettings.email,
          role: authState.currentRole,
          tier: authState.authUser?.plan || customerSettings.plan,
        },
        signal: controller.signal,
        onChunk: (chunk) => {
          markVisionStepDone();
          accumulatedStreamText += chunk;
          set((state) => ({ streamingContent: state.streamingContent + chunk }));

          if (shouldAutoSync()) {
            const virtualProject = extractVirtualProject(accumulatedStreamText);
            const artifact = !virtualProject
              ? extractStreamingArtifact(accumulatedStreamText)
              : null;
            if (virtualProject || artifact) {
              if (!hasAutoOpenedDockThisTurn || artifact?.isClosed) {
                syncArtifactSnapshot(accumulatedStreamText, false);
              } else if (!activeArtifactThrottleTimer) {
                activeArtifactThrottleTimer = setTimeout(() => {
                  activeArtifactThrottleTimer = null;
                  syncArtifactSnapshot(accumulatedStreamText, false);
                }, 420);
              }
            }
          }
        },
        onMeta: (meta) => {
          if (Array.isArray(meta.groundingSources) && meta.groundingSources.length > 0) {
            latestMetaSources = meta.groundingSources;
            set({ streamingGroundingSources: meta.groundingSources });
          }
          if (meta.tokenUsage) {
            latestMetaUsage = meta.tokenUsage;
            set({ streamingTokenUsage: meta.tokenUsage });
          }
          if (meta.routeMeta) {
            latestRouteMeta = {
              ...latestRouteMeta,
              ...meta.routeMeta,
            };
            set({ streamingRouteMeta: latestRouteMeta });
            if (useAutoRouting) {
              pushAgentStep({
                id: 'step_model_intelligence',
                label: `${tr.stepModelIntelligence} · ${effectiveModel.name}`,
                tool: 'model_intelligence',
                status: 'done',
                detail: [
                  formatPoolLabel(latestRouteMeta),
                  latestRouteMeta.engine && isDevOrAdmin ? latestRouteMeta.engine : '',
                ]
                  .filter(Boolean)
                  .join(' · '),
                ...(typeof latestRouteMeta.firstTokenMs === 'number'
                  ? { durationMs: latestRouteMeta.firstTokenMs }
                  : {}),
              });
            }
            if (
              !thinkingParams.highThinkingEnabled &&
              (effectiveModel.id === 'supreme-spark' || effectiveThinkingLevel === 'LOW') &&
              typeof latestRouteMeta.firstTokenMs === 'number'
            ) {
              pushAgentStep({
                id: 'step_low_latency',
                label: tr.stepLowLatency,
                tool: 'low_latency',
                status: 'done',
                detail: formatPoolLabel(latestRouteMeta),
                durationMs: latestRouteMeta.firstTokenMs,
              });
            }
          }
        },
        onDone: (fullText) => {
          markVisionStepDone();
          streamDoneText = fullText;
        },
        onError: (err) => {
          streamFailed = true;
          clearArtifactThrottle();
          useWorkspaceStore.getState().setArtifactStreaming(false);
          const errorMeta = err instanceof VisionRequestError ? err.meta : null;
          set({
            isStreaming: false,
            streamingContent: '',
            streamingAgentSteps: [],
            streamingGroundingSources: [],
            streamingTokenUsage: null,
            streamingRouteMeta: null,
            inferenceError: err.message,
            inferenceErrorMeta: errorMeta,
          });
          abortController = null;
          toast.error('Inference Error', err.message);
        },
      });

      if (streamFailed || controller.signal.aborted || streamDoneText === null) {
        return;
      }

      let finalContent: string = streamDoneText;
      syncArtifactSnapshot(finalContent, true);

      // Autonomous Agent Loop post-step: verify runnable Python/Node projects & attempt 1x self-healing repair
      const generatedProject = extractVirtualProject(finalContent);
      if (
        shouldVerifyProjectInAgentLoop(generatedProject, effectiveRunSettings.agentLoopEnabled) &&
        generatedProject
      ) {
        const verifyStepId = `step_verify_${Date.now()}`;
        pushAgentStep({
          id: verifyStepId,
          label: `Verifying ${generatedProject.entryFile} (${generatedProject.runtime})`,
          tool: 'sandbox_verify',
          status: 'running',
        });

        const verification = await runSandboxVerificationStep(generatedProject);
        pushAgentStep({ ...verification.step, id: verifyStepId });

        if (verification.needsRepair && !controller.signal.aborted) {
          const healStart = Date.now();
          const healStepId = `step_heal_${Date.now()}`;
          pushAgentStep({
            id: healStepId,
            label: `Auto-repairing ${generatedProject.entryFile}`,
            tool: 'self_heal',
            status: 'running',
            detail: verification.stderr.split('\n')[0]?.slice(0, 100),
          });

          const repairPrompt = buildAutoRepairPrompt(
            text,
            generatedProject,
            verification.stderr,
            verification.stdout
          );
          let repairedText = '';
          set({ streamingContent: '' });
          await chatService.streamChat({
            model: effectiveModel.id,
            messages: [
              ...updatedMessages,
              {
                id: `msg_draft_${Date.now()}`,
                role: 'assistant',
                content: finalContent,
                timestamp: Date.now(),
              },
              {
                id: `msg_repair_${Date.now()}`,
                role: 'user',
                content: repairPrompt,
                timestamp: Date.now(),
              },
            ],
            sessionId: current.id,
            systemInstruction: effectiveSystemInstruction,
            groundingContext,
            language: preferredLanguage,
            temperature: customerSettings.temperature,
            topP: customerSettings.topP,
            maxTokens: customerSettings.maxTokens,
            thinkingBudget: customerSettings.thinkingBudget,
            runConfig: effectiveRunSettings,
            userContext: {
              email: authState.authUser?.email || customerSettings.email,
              role: authState.currentRole,
              tier: authState.authUser?.plan || customerSettings.plan,
            },
            signal: controller.signal,
            onChunk: (chunk) => {
              repairedText += chunk;
              set((state) => ({ streamingContent: state.streamingContent + chunk }));
            },
            onMeta: (meta) => {
              if (meta.tokenUsage) {
                latestMetaUsage = meta.tokenUsage;
              }
            },
            onDone: (fullRepaired) => {
              if (fullRepaired.trim()) {
                finalContent = fullRepaired;
              }
            },
            onError: () => {
              // Keep initial response gracefully if repair stream fails
            },
          });

          if (repairedText.trim()) {
            syncArtifactSnapshot(finalContent, true);
            const repairedProj = extractVirtualProject(finalContent);
            const postVerify = repairedProj ? await runSandboxVerificationStep(repairedProj) : null;
            pushAgentStep({
              id: healStepId,
              label: postVerify?.verified
                ? `Auto-repaired & verified ${repairedProj?.entryFile}`
                : 'Applied runtime repair patch',
              tool: 'self_heal',
              status: postVerify?.needsRepair ? 'error' : 'done',
              detail: postVerify?.step.detail,
              durationMs: Date.now() - healStart,
            });
          } else {
            pushAgentStep({
              id: healStepId,
              label: 'Auto-repair skipped (empty patch)',
              tool: 'self_heal',
              status: 'error',
              durationMs: Date.now() - healStart,
            });
          }
        }
      }

      const aiSchedules = parseAiScheduleBlocks(finalContent);
      if (aiSchedules.length > 0) {
        for (const sched of aiSchedules) {
          void saveScheduledTask(sched).then(({ created }) => {
            toast.success('Schedule Added', `${created.title} (${created.cronExpression})`);
          });
        }
      } else {
        const inferred = parseNaturalLanguageSchedule(
          text,
          useWorkspaceStore.getState().browserUrl
        );
        if (inferred) {
          void saveScheduledTask(inferred).then(({ created }) => {
            toast.success('Schedule Added', `${created.title} (${created.cronExpression})`);
          });
          finalContent = `${finalContent.trim()}\n\n\`\`\`supreme-schedule\n${JSON.stringify({
            title: inferred.title,
            url: inferred.targetUrl,
            cadence: inferred.cadence,
            cron: inferred.cronExpression,
            instruction: inferred.instruction,
          })}\n\`\`\``;
        }
      }

      if (browserIntent) {
        const latestWs = useWorkspaceStore.getState();
        const finalBrowserSnapshot = {
          status: latestWs.browserStatus,
          url: latestWs.browserUrl,
          title: latestWs.browserTitle,
          statusCode: latestWs.browserStatusCode,
          textPreview: latestWs.browserTextPreview,
          error: latestWs.browserError,
        };
        finalContent = rewriteBrowserRefusalIfNeeded(
          finalContent,
          browserIntent,
          finalBrowserSnapshot,
          preferredLanguage
        );
        browserSnapshot = finalBrowserSnapshot;
      }

      const assistantMsg: ChatMessage = {
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: finalContent,
        timestamp: Date.now(),
        model: effectiveModel.id,
        roleName: activeRole.name,
        ...(browserIntent
          ? {
              browserNavigation: toBrowserNavigationMetadata(browserIntent, browserSnapshot),
            }
          : {}),
        ...(latestMetaSources.length > 0 ? { groundingSources: latestMetaSources } : {}),
        ...(latestMetaUsage ? { tokenUsage: latestMetaUsage } : {}),
        ...(recordedAgentSteps.length > 0 ? { agentSteps: recordedAgentSteps } : {}),
        routeMeta: latestRouteMeta,
      };

      const finalSessions = get().sessions.map((s) =>
        s.id === current.id
          ? {
              ...s,
              messages: [...s.messages, assistantMsg],
              updatedAt: Date.now(),
            }
          : s
      );

      persistSessionsSafely(finalSessions);
      set({
        sessions: finalSessions,
        isStreaming: false,
        streamingContent: '',
        streamingAgentSteps: [],
        streamingGroundingSources: [],
        streamingTokenUsage: null,
        streamingRouteMeta: null,
      });
      abortController = null;

      // Ensure remote conversation exists before syncing exchange
      const latestTitle = get().sessions.find((s) => s.id === current.id)?.title || sessionTitle;
      const syncUserText =
        text.trim() ||
        (allAttachments.length > 0
          ? `[Attached: ${allAttachments.map((a) => a.name).join(', ')}]`
          : '');
      conversationService
        .createConversation(latestTitle, current.id, effectiveModel.id)
        .then(() => {
          if (syncUserText) {
            conversationService.syncMessage(current.id, 'user', syncUserText);
          }
          conversationService.syncMessage(current.id, 'assistant', finalContent);
        })
        .catch(() => {});
    },

    stopStreaming: () => {
      if (activeArtifactThrottleTimer) {
        clearTimeout(activeArtifactThrottleTimer);
        activeArtifactThrottleTimer = null;
      }

      if (abortController) {
        abortController.abort();
        abortController = null;
      }

      const { streamingContent, sessions, activeSessionId, activeModel, activeRole } = get();
      if (streamingContent.trim()) {
        const wsState = useWorkspaceStore.getState();
        const partialProject = extractVirtualProject(streamingContent);
        if (partialProject && partialProject.files.length > 0) {
          wsState.syncVirtualProject(partialProject, {
            autoOpenDock: false,
            isFinal: true,
          });
        } else if (wsState.liveArtifactSync) {
          const partialArtifact = extractStreamingArtifact(streamingContent);
          if (partialArtifact) {
            wsState.syncStreamingArtifact(partialArtifact.code, partialArtifact.lang, {
              targetTab: partialArtifact.targetTab,
              autoOpenDock: false,
              isFinal: true,
            });
          } else {
            wsState.setArtifactStreaming(false);
          }
        } else {
          wsState.setArtifactStreaming(false);
        }

        const assistantMsg: ChatMessage = {
          id: `msg_${Date.now()}`,
          role: 'assistant',
          content: streamingContent,
          timestamp: Date.now(),
          model: activeModel.id,
          roleName: activeRole.name,
        };

        const updated = sessions.map((s) =>
          s.id === activeSessionId
            ? { ...s, messages: [...s.messages, assistantMsg], updatedAt: Date.now() }
            : s
        );

        persistSessionsSafely(updated);
        set({ sessions: updated });
      } else {
        useWorkspaceStore.getState().setArtifactStreaming(false);
      }

      set({
        isStreaming: false,
        streamingContent: '',
        streamingAgentSteps: [],
        streamingGroundingSources: [],
        streamingTokenUsage: null,
        streamingRouteMeta: null,
      });
      toast.info('Generation Stopped', 'Model inference paused by user.');
    },

    appendVoiceTurn: (userText: string, assistantText: string, voiceName?: string) => {
      const cleanUser = userText.trim();
      const cleanAssistant = assistantText.trim();
      if (!cleanUser && !cleanAssistant) return;

      const { sessions, activeSessionId, activeRole } = get();
      const current = sessions.find((s) => s.id === activeSessionId) || sessions[0];
      if (!current) return;

      const newMessages: ChatMessage[] = [];
      const now = Date.now();
      if (cleanUser) {
        newMessages.push({
          id: `voice_u_${now}`,
          role: 'user',
          content: cleanUser,
          timestamp: now,
        });
      }
      if (cleanAssistant) {
        newMessages.push({
          id: `voice_a_${now + 1}`,
          role: 'assistant',
          content: cleanAssistant,
          timestamp: now + 1,
          model: 'gemini-3.8-live',
          roleName: voiceName ? `${activeRole.name} (${voiceName} Voice)` : 'SupremeAI Live',
        });
      }

      const isFirstUserMessage = current.messages.filter((m) => m.role === 'user').length === 0;
      const shouldAutoTitle =
        isFirstUserMessage && Boolean(cleanUser) && isDefaultSessionTitle(current.title);
      const sessionTitle = shouldAutoTitle ? generateHeuristicChatTitle(cleanUser) : current.title;

      const updatedSessions = sessions.map((s) =>
        s.id === current.id
          ? {
              ...s,
              title: sessionTitle,
              messages: [...s.messages, ...newMessages],
              updatedAt: now,
            }
          : s
      );

      persistSessionsSafely(updatedSessions);
      set((state) => ({
        sessions: updatedSessions,
        generatingTitleIds: shouldAutoTitle
          ? Array.from(new Set([...state.generatingTitleIds, current.id]))
          : state.generatingTitleIds,
      }));

      if (shouldAutoTitle) {
        const targetId = current.id;
        const provisionalTitle = sessionTitle;
        void requestAutoChatTitle({ message: cleanUser })
          .then((aiTitle) => {
            if (!aiTitle) return;
            const latestSessions = get().sessions;
            const targetSession = latestSessions.find((s) => s.id === targetId);
            if (!targetSession) return;
            if (
              targetSession.title !== provisionalTitle &&
              !isDefaultSessionTitle(targetSession.title)
            ) {
              return;
            }
            if (targetSession.title === aiTitle) return;

            const nextSessions = latestSessions.map((s) =>
              s.id === targetId ? { ...s, title: aiTitle } : s
            );
            persistSessionsSafely(nextSessions);
            set({ sessions: nextSessions });
          })
          .finally(() => {
            set((state) => ({
              generatingTitleIds: state.generatingTitleIds.filter((gid) => gid !== targetId),
            }));
          });
      }
    },

    syncRemoteSessions: async () => {
      const token = localStorage.getItem('supremeai_access_token');
      if (!token) return;
      try {
        const remoteList = await conversationService.listConversations();
        if (remoteList && remoteList.length > 0) {
          const { sessions: localSessions, remotePinnedSessionIds } = get();
          const pinnedSet = new Set(remotePinnedSessionIds);
          const merged = localSessions.map((s) =>
            pinnedSet.has(s.id) && !s.isPinned ? { ...s, isPinned: true } : s
          );
          for (const rem of remoteList) {
            if (!merged.some((s) => s.id === rem.id)) {
              merged.push({
                id: rem.id,
                title: rem.title || 'Conversation',
                createdAt: new Date(rem.created_at).getTime(),
                updatedAt: new Date(rem.updated_at).getTime(),
                model: 'supreme-spark',
                roleId: SYSTEM_ROLES[0].id,
                isPinned: pinnedSet.has(rem.id),
                messages: [],
              });
            }
          }
          persistSessionsSafely(merged);
          set({ sessions: merged });
        }
      } catch (err) {
        logger.warn('[SyncRemoteSessions] Remote conversation load failed:', err);
      }
    },

    applyRemoteChatPrefs: (prefs) => {
      if (!prefs || typeof prefs !== 'object') return;
      set((state) => {
        const nextModel =
          typeof prefs.selectedModelId === 'string'
            ? SUPREMEAI_MODELS.find((m) => m.id === prefs.selectedModelId) || state.activeModel
            : state.activeModel;
        const nextRole =
          typeof prefs.activeRoleId === 'string'
            ? SYSTEM_ROLES.find((r) => r.id === prefs.activeRoleId) || state.activeRole
            : state.activeRole;
        const nextInstruction =
          typeof prefs.customInstruction === 'string'
            ? prefs.customInstruction
            : state.customInstruction;
        const nextPinnedIds = Array.isArray(prefs.pinnedSessionIds)
          ? prefs.pinnedSessionIds.filter((id): id is string => typeof id === 'string')
          : state.remotePinnedSessionIds;
        const pinnedSet = new Set(nextPinnedIds);
        const nextSessions = state.sessions.map((s) => ({
          ...s,
          isPinned: pinnedSet.has(s.id) ? true : s.isPinned,
        }));
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSessions));
        } catch {
          // ignore storage errors
        }
        return {
          activeModel: nextModel,
          activeRole: nextRole,
          customInstruction: nextInstruction,
          remotePinnedSessionIds: nextPinnedIds,
          sessions: nextSessions,
        };
      });
    },

    resetAccountSessions: () => {
      const freshSession: ChatSession = {
        id: `session_${Date.now()}`,
        title: 'SupremeAI Chat',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        model: 'supreme-spark',
        roleId: SYSTEM_ROLES[0].id,
        messages: [],
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([freshSession]));
      } catch {
        // ignore storage errors
      }
      set({
        sessions: [freshSession],
        activeSessionId: freshSession.id,
        customInstruction: '',
        remotePinnedSessionIds: [],
        streamingContent: '',
        inferenceError: null,
        inferenceErrorMeta: null,
      });
    },
  };
});
