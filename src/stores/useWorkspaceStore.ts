import { create } from 'zustand';
import { toast } from './useToastStore';
import { resolveDomainSessionCookieHeader } from '../services/browserVaultService';
import {
  getDomainLiveCookies,
  isGoogleStrictAuthUrl,
  mergeCookieHeaders,
  setDomainLiveCookies,
} from '../services/browserSessionJar';
import { notifyGmailBrowserRefresh } from '../services/gmailOAuthService';
import { schedulePreferencesPatch } from '../services/userPreferencesSyncBus';
import {
  inferLangFromProjectPath,
  pickProjectEntryFile,
  type ProjectRuntime,
  type VirtualProjectFile,
} from '../utils/artifactStreamParser';
import type { ServerProjectRunResult } from '../utils/projectBundler';
import { getWorkspaceAuthHeaders } from '../utils/workspaceAuth';

export type WorkspaceTab =
  'sandbox' | 'preview' | 'terminal' | 'browser' | 'schedule' | 'code' | 'graph';
export type ViewportDevice = 'desktop' | 'tablet' | 'mobile';

export const LIVE_ARTIFACT_SYNC_STORAGE_KEY = 'supremeai_live_artifact_sync_v1';
export const WORKSPACE_BROWSER_STATE_STORAGE_KEY = 'supremeai_workspace_browser_state_v1';

const VALID_WORKSPACE_TABS = new Set<WorkspaceTab>([
  'sandbox',
  'preview',
  'terminal',
  'browser',
  'schedule',
  'code',
  'graph',
]);

export function loadLiveArtifactSyncPref(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    const raw = localStorage.getItem(LIVE_ARTIFACT_SYNC_STORAGE_KEY);
    if (raw === 'false') return false;
    return true;
  } catch {
    return true;
  }
}

export function saveLiveArtifactSyncPref(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LIVE_ARTIFACT_SYNC_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage quota errors
  }
}

export interface BrowserLink {
  href: string;
  text: string;
}

export interface BrowserAgentEvent {
  id: string;
  timestamp: string;
  action: string;
  target: string;
  status: 'ok' | 'pending' | 'error';
}

export interface BrowserTabSession {
  id: string;
  url: string;
  title: string;
  status: 'idle' | 'loading' | 'loaded' | 'error';
  html: string;
  rawSource: string;
  contentType: string;
  headers: Record<string, string>;
  error: string | null;
  latencyMs: number | null;
  statusCode: number | null;
  links: BrowserLink[];
  textPreview: string;
  historyStack: string[];
  historyIndex: number;
  capturedCookies: string;
  activeVaultId: string | null;
}

function createEmptyBrowserTab(id?: string): BrowserTabSession {
  return {
    id: id || `btab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    url: '',
    title: 'New Tab',
    status: 'idle',
    html: '',
    rawSource: '',
    contentType: '',
    headers: {},
    error: null,
    latencyMs: null,
    statusCode: null,
    links: [],
    textPreview: '',
    historyStack: [],
    historyIndex: -1,
    capturedCookies: '',
    activeVaultId: null,
  };
}

function mirrorTabToTopLevel(tab: BrowserTabSession) {
  return {
    browserUrl: tab.url,
    browserTitle: tab.title,
    browserStatus: tab.status,
    browserHtml: tab.html,
    browserRawSource: tab.rawSource,
    browserContentType: tab.contentType,
    browserHeaders: tab.headers,
    browserError: tab.error,
    browserLatencyMs: tab.latencyMs,
    browserStatusCode: tab.statusCode,
    browserLinks: tab.links,
    browserTextPreview: tab.textPreview,
    browserHistoryStack: tab.historyStack,
    browserHistoryIndex: tab.historyIndex,
    browserCapturedCookies: tab.capturedCookies,
    browserActiveVaultId: tab.activeVaultId,
  };
}

interface PersistedWorkspaceBrowserTab {
  id: string;
  url: string;
  title: string;
  historyStack: string[];
  historyIndex: number;
  activeVaultId: string | null;
}

interface PersistedWorkspaceBrowserState {
  isDockOpen: boolean;
  activeDockTab: WorkspaceTab;
  activeBrowserTabId: string;
  tabs: PersistedWorkspaceBrowserTab[];
}

export function loadPersistedWorkspaceBrowserState(): {
  isDockOpen: boolean;
  activeDockTab: WorkspaceTab;
  browserTabs: BrowserTabSession[];
  activeBrowserTabId: string;
} {
  const fallbackTab = createEmptyBrowserTab('btab-1');
  const fallback = {
    isDockOpen: false,
    activeDockTab: 'preview' as WorkspaceTab,
    browserTabs: [fallbackTab],
    activeBrowserTabId: fallbackTab.id,
  };
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(WORKSPACE_BROWSER_STATE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceBrowserState>;
    const rawTabs = Array.isArray(parsed.tabs) ? parsed.tabs : [];
    const hydratedTabs: BrowserTabSession[] = rawTabs
      .filter((item): item is PersistedWorkspaceBrowserTab =>
        Boolean(item && typeof item.id === 'string')
      )
      .map((item) => {
        const cleanUrl = typeof item.url === 'string' ? item.url : '';
        const strictAuth = Boolean(cleanUrl && isGoogleStrictAuthUrl(cleanUrl));
        const stack = Array.isArray(item.historyStack)
          ? item.historyStack.filter((u): u is string => typeof u === 'string' && u.length > 0)
          : cleanUrl
            ? [cleanUrl]
            : [];
        const rawIdx = typeof item.historyIndex === 'number' ? item.historyIndex : stack.length - 1;
        const clampedIdx = stack.length > 0 ? Math.max(0, Math.min(rawIdx, stack.length - 1)) : -1;
        return {
          ...createEmptyBrowserTab(item.id),
          url: cleanUrl,
          title:
            typeof item.title === 'string' && item.title.trim()
              ? item.title
              : cleanUrl || 'New Tab',
          status: strictAuth ? 'loaded' : 'idle',
          statusCode: strictAuth ? 200 : null,
          latencyMs: strictAuth ? 0 : null,
          historyStack: stack,
          historyIndex: clampedIdx,
          activeVaultId: typeof item.activeVaultId === 'string' ? item.activeVaultId : null,
        };
      });

    const tabs = hydratedTabs.length > 0 ? hydratedTabs : [fallbackTab];
    const activeTab = tabs.find((t) => t.id === parsed.activeBrowserTabId) || tabs[0];
    const activeDockTab =
      parsed.activeDockTab && VALID_WORKSPACE_TABS.has(parsed.activeDockTab)
        ? parsed.activeDockTab
        : 'preview';

    return {
      isDockOpen: Boolean(parsed.isDockOpen),
      activeDockTab,
      browserTabs: tabs,
      activeBrowserTabId: activeTab.id,
    };
  } catch {
    return fallback;
  }
}

function persistWorkspaceBrowserState(state: {
  isDockOpen: boolean;
  activeDockTab: WorkspaceTab;
  activeBrowserTabId: string;
  browserTabs: BrowserTabSession[];
}): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const payload: PersistedWorkspaceBrowserState = {
      isDockOpen: state.isDockOpen,
      activeDockTab: state.activeDockTab,
      activeBrowserTabId: state.activeBrowserTabId,
      tabs: state.browserTabs.map((tab) => ({
        id: tab.id,
        url: tab.url,
        title: tab.title,
        historyStack: tab.historyStack,
        historyIndex: tab.historyIndex,
        activeVaultId: tab.activeVaultId,
      })),
    };
    localStorage.setItem(WORKSPACE_BROWSER_STATE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors
  }
}

export function normalizeProxyInputUrl(rawUrl: string): string {
  const cleanUrl = rawUrl.trim();
  if (!cleanUrl) return '';
  if (cleanUrl.startsWith('/') && !cleanUrl.startsWith('//')) {
    return cleanUrl;
  }
  if (cleanUrl.startsWith('//')) {
    return `https:${cleanUrl}`;
  }
  if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) {
    return cleanUrl;
  }
  const hasSpaces = /\s/.test(cleanUrl);
  const looksLikeDomainOrHost =
    cleanUrl.includes('.') || cleanUrl.includes(':') || /^localhost(?:\/|$)/i.test(cleanUrl);
  if (hasSpaces || !looksLikeDomainOrHost) {
    return `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(cleanUrl)}`;
  }
  return `https://${cleanUrl}`;
}

interface WorkspaceState {
  isDockOpen: boolean;
  dockWidthPercent: number;
  activeDockTab: WorkspaceTab;

  // Preview & Code Editor (isolated from Sandbox buffer)
  previewCode: string;
  previousPreviewCode: string;
  previewLang: string;
  previewTitle: string;
  viewportDevice: ViewportDevice;
  browserViewportDevice: 'desktop' | 'mobile';
  mobileOrientation: 'portrait' | 'landscape';
  previewDarkMode: boolean;
  previewRefreshKey: number;
  isSharedArtifactView: boolean;

  // Multi-File Generated Virtual Project
  projectTitle: string;
  projectRuntime: ProjectRuntime;
  projectEntryFile: string;
  projectFiles: VirtualProjectFile[];
  previousProjectFiles: VirtualProjectFile[];
  activeProjectFilePath: string;
  projectServerRunResult: ServerProjectRunResult | null;
  isRunningServerProject: boolean;

  // Isolated Sandbox Buffer
  sandboxCode: string;
  sandboxLang: string;
  sandboxRevision: number;
  sandboxAutoRunNonce: number;

  // Optional Mermaid source synced from chat/code for Graph tab
  mermaidGraphSource: string;

  // Automatic Live Artifact Sync (v0 / Claude Artifacts-style streaming)
  liveArtifactSync: boolean;
  isArtifactStreaming: boolean;

  // Terminal Stream State (disabled by default to avoid interrupting typing)
  isAgentStreamEnabled: boolean;

  // Virtual Browser (Active Tab + Multi-Tab Sessions)
  browserTabs: BrowserTabSession[];
  activeBrowserTabId: string;
  browserUrl: string;
  browserTitle: string;
  browserStatus: 'idle' | 'loading' | 'loaded' | 'error';
  browserHtml: string;
  browserRawSource: string;
  browserContentType: string;
  browserHeaders: Record<string, string>;
  browserError: string | null;
  browserLatencyMs: number | null;
  browserStatusCode: number | null;
  browserLinks: BrowserLink[];
  browserTextPreview: string;
  browserHistoryStack: string[];
  browserHistoryIndex: number;
  browserAgentLogs: BrowserAgentEvent[];
  browserCapturedCookies: string;
  browserActiveVaultId: string | null;

  // Actions
  setDockOpen: (open: boolean) => void;
  toggleDock: () => void;
  setDockWidthPercent: (pct: number) => void;
  setActiveDockTab: (tab: WorkspaceTab) => void;

  // Preview, Code & Sandbox Actions
  loadCodeIntoWorkspace: (
    code: string,
    lang?: string,
    openTab?: WorkspaceTab,
    autoRun?: boolean
  ) => void;
  openSharedArtifact: (code: string, lang?: string, title?: string) => void;
  syncStreamingArtifact: (
    code: string,
    lang: string,
    options?: {
      targetTab?: 'preview' | 'sandbox';
      autoOpenDock?: boolean;
      isFinal?: boolean;
      captureDiffBaseline?: boolean;
    }
  ) => void;
  syncVirtualProject: (
    project: {
      title: string;
      runtime: ProjectRuntime;
      entryFile: string;
      files: VirtualProjectFile[];
    },
    options?: {
      autoOpenDock?: boolean;
      isFinal?: boolean;
      captureDiffBaseline?: boolean;
    }
  ) => void;
  selectProjectFile: (filePath: string) => void;
  updateProjectFileContent: (filePath: string, content: string) => void;
  createProjectFile: (filePath: string, content?: string) => void;
  deleteProjectFile: (filePath: string) => void;
  clearVirtualProject: () => void;
  runCurrentServerProject: () => Promise<void>;
  setLiveArtifactSync: (enabled: boolean) => void;
  toggleLiveArtifactSync: () => void;
  setArtifactStreaming: (streaming: boolean) => void;
  updatePreviewCode: (code: string, lang?: string) => void;
  acceptPreviewDiff: () => void;
  revertPreviewDiff: () => void;
  clearPreviewCode: () => void;
  updateSandboxCode: (code: string, lang?: string) => void;
  clearSandboxCode: () => void;
  setViewportDevice: (device: ViewportDevice) => void;
  setBrowserViewportDevice: (device: 'desktop' | 'mobile') => void;
  toggleMobileOrientation: () => void;
  togglePreviewDarkMode: () => void;
  reloadPreview: () => void;
  triggerSandboxRun: () => void;

  // Terminal Actions
  toggleAgentStream: () => void;

  // Browser Actions
  createBrowserTab: (initialUrl?: string) => void;
  switchBrowserTab: (tabId: string) => void;
  closeBrowserTab: (tabId: string) => void;
  navigateBrowser: (url: string, pushHistory?: boolean) => Promise<void>;
  submitBrowserForm: (params: {
    action: string;
    method: string;
    contentType?: string;
    body?: string;
  }) => Promise<void>;
  executeBrowserProxyRpc: (params: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string;
  }) => Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    finalUrl: string;
    headers: Record<string, string>;
    body: string;
    error?: string;
  }>;
  browserBack: () => void;
  browserForward: () => void;
  refreshBrowser: () => void;
  resetBrowserHome: () => void;
  setBrowserActiveVaultId: (id: string | null) => void;
}

const hydratedBrowserState = loadPersistedWorkspaceBrowserState();
const initialBrowserTab =
  hydratedBrowserState.browserTabs.find((t) => t.id === hydratedBrowserState.activeBrowserTabId) ||
  hydratedBrowserState.browserTabs[0];

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  isDockOpen: hydratedBrowserState.isDockOpen,
  dockWidthPercent: 52,
  activeDockTab: hydratedBrowserState.activeDockTab,

  previewCode: '',
  previousPreviewCode: '',
  previewLang: 'html',
  previewTitle: 'Preview Buffer',
  viewportDevice: 'desktop',
  browserViewportDevice: 'desktop',
  mobileOrientation: 'portrait',
  previewDarkMode: true,
  previewRefreshKey: 1,
  isSharedArtifactView: false,

  projectTitle: '',
  projectRuntime: 'web',
  projectEntryFile: '',
  projectFiles: [],
  previousProjectFiles: [],
  activeProjectFilePath: '',
  projectServerRunResult: null,
  isRunningServerProject: false,

  sandboxCode: '',
  sandboxLang: 'javascript',
  sandboxRevision: 0,
  sandboxAutoRunNonce: 0,

  mermaidGraphSource: '',

  liveArtifactSync: loadLiveArtifactSyncPref(),
  isArtifactStreaming: false,

  isAgentStreamEnabled: false,

  browserTabs: hydratedBrowserState.browserTabs,
  activeBrowserTabId: initialBrowserTab.id,
  ...mirrorTabToTopLevel(initialBrowserTab),
  browserAgentLogs: [
    {
      id: 'ba-init',
      timestamp: new Date().toLocaleTimeString(),
      action: 'INIT',
      target: 'Web Proxy & DOM Inspector Ready',
      status: 'ok',
    },
  ],

  setDockOpen: (open) => {
    set((s) => ({
      isDockOpen: open,
      isSharedArtifactView: open ? s.isSharedArtifactView : false,
    }));
    persistWorkspaceBrowserState(get());
  },
  toggleDock: () => {
    set((s) => ({
      isDockOpen: !s.isDockOpen,
      isSharedArtifactView: !s.isDockOpen ? s.isSharedArtifactView : false,
    }));
    persistWorkspaceBrowserState(get());
  },
  setDockWidthPercent: (pct) => set({ dockWidthPercent: Math.max(32, Math.min(72, pct)) }),
  setActiveDockTab: (tab) => {
    set({ activeDockTab: tab });
    persistWorkspaceBrowserState(get());
  },

  loadCodeIntoWorkspace: (code, lang = 'html', openTab = 'preview', autoRun = false) => {
    const cleanLang = (lang || 'html').toLowerCase().trim();
    if (openTab === 'sandbox') {
      set((s) => ({
        sandboxCode: code,
        sandboxLang: cleanLang,
        sandboxRevision: s.sandboxRevision + 1,
        activeDockTab: 'sandbox',
        isDockOpen: true,
        sandboxAutoRunNonce: autoRun ? s.sandboxAutoRunNonce + 1 : s.sandboxAutoRunNonce,
      }));
      persistWorkspaceBrowserState(get());
      toast.info('Loaded in Sandbox', `Opened ${String(cleanLang || 'code').toUpperCase()} snippet in sandbox tab.`);
      return;
    }

    set((s) => ({
      previousPreviewCode:
        s.previewCode && s.previewCode !== code ? s.previewCode : s.previousPreviewCode,
      previewCode: code,
      previewLang: cleanLang,
      previewTitle: `${String(cleanLang || 'code').toUpperCase()} Buffer`,
      mermaidGraphSource: cleanLang === 'mermaid' ? code : s.mermaidGraphSource,
      activeDockTab: openTab,
      isDockOpen: true,
      previewRefreshKey: s.previewRefreshKey + 1,
    }));
    persistWorkspaceBrowserState(get());
    toast.info(
      'Loaded in Workspace',
      `Opened ${String(cleanLang || 'code').toUpperCase()} snippet in ${openTab} tab.`
    );
  },

  openSharedArtifact: (code, lang = 'html', title) => {
    const cleanLang = (lang || 'html').toLowerCase().trim();
    set((s) => ({
      previousPreviewCode: '',
      previewCode: code,
      previewLang: cleanLang,
      previewTitle: title?.trim() || `${String(cleanLang || 'app').toUpperCase()} Shared App`,
      mermaidGraphSource: cleanLang === 'mermaid' ? code : s.mermaidGraphSource,
      activeDockTab: 'preview',
      isDockOpen: true,
      isSharedArtifactView: true,
      previewRefreshKey: s.previewRefreshKey + 1,
    }));
    persistWorkspaceBrowserState(get());
  },

  syncStreamingArtifact: (code, lang = 'html', options = {}) => {
    const cleanLang = (lang || 'html').toLowerCase().trim();
    const targetTab = options.targetTab || 'preview';
    const isFinal = Boolean(options.isFinal);
    const autoOpenDock = Boolean(options.autoOpenDock);
    const captureDiffBaseline = Boolean(options.captureDiffBaseline);

    if (targetTab === 'sandbox') {
      set((s) => ({
        sandboxCode: code,
        sandboxLang: cleanLang,
        sandboxRevision: s.sandboxRevision + 1,
        isArtifactStreaming: !isFinal,
        sandboxAutoRunNonce:
          isFinal && code.trim().length > 0 ? s.sandboxAutoRunNonce + 1 : s.sandboxAutoRunNonce,
        ...(autoOpenDock ? { isDockOpen: true, activeDockTab: 'sandbox' as const } : {}),
      }));
      return;
    }

    set((s) => ({
      previousPreviewCode:
        captureDiffBaseline && s.previewCode && s.previewCode !== code
          ? s.previewCode
          : s.previousPreviewCode,
      previewCode: code,
      previewLang: cleanLang,
      previewTitle: `${String(cleanLang || 'code').toUpperCase()} Buffer`,
      mermaidGraphSource: cleanLang === 'mermaid' ? code : s.mermaidGraphSource,
      isArtifactStreaming: !isFinal,
      ...(autoOpenDock
        ? {
            isDockOpen: true,
            activeDockTab:
              cleanLang === 'mermaid' && s.activeDockTab === 'graph'
                ? ('graph' as const)
                : ('preview' as const),
          }
        : {}),
    }));
  },

  syncVirtualProject: (project, options = {}) => {
    const isFinal = Boolean(options.isFinal);
    const autoOpenDock = Boolean(options.autoOpenDock);
    const captureDiffBaseline = Boolean(options.captureDiffBaseline);
    const entry = project.files.find((f) => f.path === project.entryFile) || project.files[0];

    set((s) => {
      const hasPrev = s.projectFiles.length > 0;
      const keepActive =
        s.activeProjectFilePath && project.files.some((f) => f.path === s.activeProjectFilePath);
      const nextActivePath = keepActive
        ? s.activeProjectFilePath
        : entry?.path || project.files[0]?.path || '';

      return {
        previousProjectFiles:
          captureDiffBaseline && hasPrev ? s.projectFiles : s.previousProjectFiles,
        projectTitle: project.title,
        projectRuntime: project.runtime,
        projectEntryFile: project.entryFile,
        projectFiles: project.files,
        activeProjectFilePath: nextActivePath,
        projectServerRunResult: captureDiffBaseline ? null : s.projectServerRunResult,
        ...(entry
          ? {
              previousPreviewCode:
                captureDiffBaseline && s.previewCode && s.previewCode !== entry.content
                  ? s.previewCode
                  : s.previousPreviewCode,
              previewCode: entry.content,
              previewLang: entry.lang,
              previewTitle: project.title || `${String(project.runtime || 'app').toUpperCase()} Project`,
            }
          : {}),
        isArtifactStreaming: !isFinal,
        previewRefreshKey: isFinal ? s.previewRefreshKey + 1 : s.previewRefreshKey,
        ...(autoOpenDock
          ? {
              isDockOpen: true,
              activeDockTab: 'preview' as const,
            }
          : {}),
      };
    });

    if (autoOpenDock || isFinal) {
      persistWorkspaceBrowserState(get());
    }
  },

  selectProjectFile: (filePath) =>
    set((s) => {
      const target = s.projectFiles.find((f) => f.path === filePath);
      if (!target) return s;
      return {
        activeProjectFilePath: target.path,
      };
    }),

  updateProjectFileContent: (filePath, content) =>
    set((s) => {
      const nextFiles = s.projectFiles.map((f) => (f.path === filePath ? { ...f, content } : f));
      const isEntry = filePath === s.projectEntryFile;
      return {
        projectFiles: nextFiles,
        projectServerRunResult: null,
        ...(isEntry ? { previewCode: content } : {}),
        previewRefreshKey: s.previewRefreshKey + 1,
      };
    }),

  createProjectFile: (rawPath, content = '') => {
    const cleanPath = rawPath
      .trim()
      .replace(/^(\.\/|\/)+/, '')
      .replace(/\\/g, '/');
    if (!cleanPath || cleanPath.includes('..')) return;
    set((s) => {
      if (s.projectFiles.some((f) => f.path.toLowerCase() === cleanPath.toLowerCase())) {
        return { activeProjectFilePath: cleanPath };
      }
      const nextFile: VirtualProjectFile = {
        path: cleanPath,
        lang: inferLangFromProjectPath(cleanPath, 'text'),
        content,
      };
      const nextFiles = [...s.projectFiles, nextFile];
      return {
        projectFiles: nextFiles,
        activeProjectFilePath: cleanPath,
        previewRefreshKey: s.previewRefreshKey + 1,
      };
    });
  },

  deleteProjectFile: (filePath) =>
    set((s) => {
      const nextFiles = s.projectFiles.filter((f) => f.path !== filePath);
      if (nextFiles.length === 0) {
        return {
          projectTitle: '',
          projectEntryFile: '',
          projectFiles: [],
          activeProjectFilePath: '',
          projectServerRunResult: null,
          previewRefreshKey: s.previewRefreshKey + 1,
        };
      }
      const nextEntry =
        s.projectEntryFile === filePath
          ? pickProjectEntryFile(nextFiles, s.projectRuntime)
          : s.projectEntryFile;
      const nextActive =
        s.activeProjectFilePath === filePath
          ? nextEntry || nextFiles[0].path
          : s.activeProjectFilePath;
      return {
        projectFiles: nextFiles.map((f) => ({ ...f, isEntry: f.path === nextEntry })),
        projectEntryFile: nextEntry,
        activeProjectFilePath: nextActive,
        projectServerRunResult: null,
        previewRefreshKey: s.previewRefreshKey + 1,
      };
    }),

  clearVirtualProject: () =>
    set((s) => ({
      projectTitle: '',
      projectRuntime: 'web',
      projectEntryFile: '',
      projectFiles: [],
      previousProjectFiles: [],
      activeProjectFilePath: '',
      projectServerRunResult: null,
      isRunningServerProject: false,
      previewRefreshKey: s.previewRefreshKey + 1,
    })),

  runCurrentServerProject: async () => {
    const { projectRuntime, projectEntryFile, projectFiles, isRunningServerProject } = get();
    if (isRunningServerProject || projectFiles.length === 0) return;
    if (projectRuntime !== 'python' && projectRuntime !== 'node') return;

    set({ isRunningServerProject: true });
    try {
      const res = await fetch('/api/workspace/project-run', {
        method: 'POST',
        headers: getWorkspaceAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          runtime: projectRuntime,
          entryFile: projectEntryFile,
          files: projectFiles.map((f) => ({ path: f.path, content: f.content })),
        }),
      });
      const data = (await res.json()) as ServerProjectRunResult & {
        error?: string;
        supported?: boolean;
      };
      set((s) => ({
        isRunningServerProject: false,
        projectServerRunResult: {
          exitCode:
            data.supported === false || data.exitCode === null
              ? null
              : typeof data.exitCode === 'number'
                ? data.exitCode
                : res.ok
                  ? 0
                  : 1,
          stdout: typeof data.stdout === 'string' ? data.stdout : '',
          stderr: typeof data.stderr === 'string' ? data.stderr : data.error || '',
          runtime: projectRuntime,
          entryFile: data.entryFile || projectEntryFile,
          durationMs: typeof data.durationMs === 'number' ? data.durationMs : 0,
          ...(data.error ? { error: data.error } : {}),
        },
        previewRefreshKey: s.previewRefreshKey + 1,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to run project';
      set((s) => ({
        isRunningServerProject: false,
        projectServerRunResult: {
          exitCode: 1,
          stdout: '',
          stderr: message,
          runtime: projectRuntime,
          entryFile: projectEntryFile,
          durationMs: 0,
          error: message,
        },
        previewRefreshKey: s.previewRefreshKey + 1,
      }));
    }
  },

  setLiveArtifactSync: (enabled) => {
    saveLiveArtifactSyncPref(enabled);
    set((s) => ({
      liveArtifactSync: enabled,
      isArtifactStreaming: enabled ? s.isArtifactStreaming : false,
    }));
    schedulePreferencesPatch({ workspace_prefs: { liveArtifactSync: enabled } });
  },

  toggleLiveArtifactSync: () => {
    const next = !get().liveArtifactSync;
    saveLiveArtifactSyncPref(next);
    set((s) => ({
      liveArtifactSync: next,
      isArtifactStreaming: next ? s.isArtifactStreaming : false,
    }));
    schedulePreferencesPatch({ workspace_prefs: { liveArtifactSync: next } });
  },

  setArtifactStreaming: (streaming) => set({ isArtifactStreaming: streaming }),

  updatePreviewCode: (code, lang) =>
    set((s) => {
      const nextLang = lang ? lang.toLowerCase().trim() : s.previewLang;
      return {
        previousPreviewCode:
          s.previewCode && s.previewCode !== code && !s.isArtifactStreaming
            ? s.previewCode
            : s.previousPreviewCode,
        previewCode: code,
        previewLang: nextLang,
        mermaidGraphSource: nextLang === 'mermaid' ? code : s.mermaidGraphSource,
        previewRefreshKey: s.previewRefreshKey + 1,
      };
    }),

  acceptPreviewDiff: () =>
    set((s) => ({
      previousPreviewCode: s.previewCode,
      previousProjectFiles: s.projectFiles,
    })),

  revertPreviewDiff: () =>
    set((s) => {
      if (s.previousProjectFiles.length > 0) {
        const restoredFiles = s.previousProjectFiles;
        const entry = restoredFiles.find((f) => f.path === s.projectEntryFile) || restoredFiles[0];
        return {
          projectFiles: restoredFiles,
          previousProjectFiles: [],
          activeProjectFilePath: entry?.path || '',
          ...(entry ? { previewCode: entry.content, previewLang: entry.lang } : {}),
          previousPreviewCode: '',
          previewRefreshKey: s.previewRefreshKey + 1,
        };
      }
      if (!s.previousPreviewCode) return s;
      const restored = s.previousPreviewCode;
      return {
        previewCode: restored,
        previousPreviewCode: '',
        previewRefreshKey: s.previewRefreshKey + 1,
      };
    }),

  clearPreviewCode: () =>
    set((s) => ({
      previewCode: '',
      previousPreviewCode: '',
      previewTitle: 'Preview Buffer',
      projectTitle: '',
      projectRuntime: 'web',
      projectEntryFile: '',
      projectFiles: [],
      previousProjectFiles: [],
      activeProjectFilePath: '',
      projectServerRunResult: null,
      isRunningServerProject: false,
      isArtifactStreaming: false,
      isSharedArtifactView: false,
      previewRefreshKey: s.previewRefreshKey + 1,
    })),

  updateSandboxCode: (code, lang) =>
    set((s) => ({
      sandboxCode: code,
      sandboxLang: lang ? lang.toLowerCase().trim() : s.sandboxLang,
    })),

  clearSandboxCode: () =>
    set((s) => ({
      sandboxCode: '',
      sandboxRevision: s.sandboxRevision + 1,
    })),

  setViewportDevice: (device) => set({ viewportDevice: device }),
  setBrowserViewportDevice: (device) => set({ browserViewportDevice: device }),
  toggleMobileOrientation: () =>
    set((s) => ({
      mobileOrientation: s.mobileOrientation === 'portrait' ? 'landscape' : 'portrait',
    })),
  togglePreviewDarkMode: () => set((s) => ({ previewDarkMode: !s.previewDarkMode })),
  reloadPreview: () => set((s) => ({ previewRefreshKey: s.previewRefreshKey + 1 })),
  triggerSandboxRun: () => set((s) => ({ sandboxAutoRunNonce: s.sandboxAutoRunNonce + 1 })),

  toggleAgentStream: () => set((s) => ({ isAgentStreamEnabled: !s.isAgentStreamEnabled })),

  createBrowserTab: (initialUrl) => {
    const newTab = createEmptyBrowserTab();
    set((s) => ({
      browserTabs: [...s.browserTabs, newTab],
      activeBrowserTabId: newTab.id,
      ...mirrorTabToTopLevel(newTab),
    }));
    persistWorkspaceBrowserState(get());
    if (initialUrl && initialUrl.trim()) {
      void get().navigateBrowser(initialUrl);
    }
  },

  switchBrowserTab: (tabId) => {
    set((s) => {
      const target = s.browserTabs.find((t) => t.id === tabId);
      if (!target || s.activeBrowserTabId === tabId) return s;
      return {
        activeBrowserTabId: target.id,
        ...mirrorTabToTopLevel(target),
      };
    });
    persistWorkspaceBrowserState(get());
  },

  closeBrowserTab: (tabId) => {
    set((s) => {
      if (s.browserTabs.length <= 1) {
        const fresh = createEmptyBrowserTab(s.browserTabs[0]?.id || 'btab-1');
        return {
          browserTabs: [fresh],
          activeBrowserTabId: fresh.id,
          ...mirrorTabToTopLevel(fresh),
        };
      }
      const closingIdx = s.browserTabs.findIndex((t) => t.id === tabId);
      if (closingIdx === -1) return s;
      const nextTabs = s.browserTabs.filter((t) => t.id !== tabId);
      if (s.activeBrowserTabId !== tabId) {
        return { browserTabs: nextTabs };
      }
      const fallbackTab = nextTabs[Math.min(closingIdx, nextTabs.length - 1)];
      return {
        browserTabs: nextTabs,
        activeBrowserTabId: fallbackTab.id,
        ...mirrorTabToTopLevel(fallbackTab),
      };
    });
    persistWorkspaceBrowserState(get());
  },

  navigateBrowser: async (rawUrl, pushHistory = true) => {
    const formattedUrl = normalizeProxyInputUrl(rawUrl);
    if (!formattedUrl) return;

    const targetTabId = get().activeBrowserTabId;

    // Google/Gmail strict-auth URLs are served by our native OAuth bridge (<GmailInboxPanel />)
    // rather than scraping accounts.google.com through the HTML proxy.
    if (isGoogleStrictAuthUrl(formattedUrl)) {
      const isAccountUrl = /accounts\.google\.com/i.test(formattedUrl);
      const strictTitle = isAccountUrl ? 'Google Account' : 'Gmail';
      set((s) => {
        let updatedTargetTab: BrowserTabSession | null = null;
        const nextTabs = s.browserTabs.map((t) => {
          if (t.id !== targetTabId) return t;
          const nextStack = pushHistory
            ? [...t.historyStack.slice(0, t.historyIndex + 1), formattedUrl]
            : t.historyStack.length > 0
              ? t.historyStack
              : [formattedUrl];
          const nextIndex = pushHistory
            ? nextStack.length - 1
            : t.historyIndex >= 0
              ? t.historyIndex
              : nextStack.length - 1;
          updatedTargetTab = {
            ...t,
            url: formattedUrl,
            title: strictTitle,
            status: 'loaded',
            html: '',
            rawSource: '',
            contentType: 'text/html',
            headers: {},
            error: null,
            latencyMs: 0,
            statusCode: 200,
            links: [],
            textPreview: '',
            capturedCookies: '',
            historyStack: nextStack,
            historyIndex: nextIndex,
          };
          return updatedTargetTab;
        });

        return {
          browserTabs: nextTabs,
          ...(s.activeBrowserTabId === targetTabId && updatedTargetTab
            ? mirrorTabToTopLevel(updatedTargetTab)
            : {}),
          browserAgentLogs: [
            {
              id: `ba-oauth-${Date.now()}`,
              timestamp: new Date().toLocaleTimeString(),
              action: 'OAUTH_BRIDGE',
              target: formattedUrl,
              status: 'ok' as const,
            },
            ...s.browserAgentLogs.slice(0, 19),
          ],
        };
      });
      persistWorkspaceBrowserState(get());
      if (!pushHistory) {
        notifyGmailBrowserRefresh();
      }
      return;
    }

    const targetVaultId =
      get().browserTabs.find((t) => t.id === targetTabId)?.activeVaultId ??
      get().browserActiveVaultId;

    const navLog: BrowserAgentEvent = {
      id: `ba-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      action: 'NAVIGATE',
      target: formattedUrl,
      status: 'pending',
    };

    set((s) => {
      const nextTabs = s.browserTabs.map((t) =>
        t.id === targetTabId
          ? { ...t, url: formattedUrl, status: 'loading' as const, error: null }
          : t
      );
      return {
        browserTabs: nextTabs,
        ...(s.activeBrowserTabId === targetTabId
          ? {
              browserUrl: formattedUrl,
              browserStatus: 'loading' as const,
              browserError: null,
            }
          : {}),
        browserAgentLogs: [navLog, ...s.browserAgentLogs.slice(0, 19)],
      };
    });

    const startedAt = Date.now();
    try {
      let vaultCookieHeader: string | null = null;
      try {
        vaultCookieHeader = await resolveDomainSessionCookieHeader(formattedUrl, targetVaultId);
      } catch {
        vaultCookieHeader = null;
      }
      const liveCookies = getDomainLiveCookies(formattedUrl);
      const mergedOutboundCookies = mergeCookieHeaders(vaultCookieHeader, liveCookies);

      const proxyHeaders = getWorkspaceAuthHeaders(
        mergedOutboundCookies ? { 'X-Vault-Cookie': mergedOutboundCookies } : undefined
      );
      const res = await fetch(
        `/api/workspace/browser-proxy?url=${encodeURIComponent(formattedUrl)}`,
        {
          headers: Object.keys(proxyHeaders).length > 0 ? proxyHeaders : undefined,
        }
      );
      const rawResponseText = await res.text();
      let data: Record<string, unknown> = {};
      try {
        data = rawResponseText ? (JSON.parse(rawResponseText) as Record<string, unknown>) : {};
      } catch {
        throw new Error(
          res.ok
            ? 'Browser proxy returned an unexpected non-JSON response.'
            : `HTTP ${res.status} ${res.statusText}`
        );
      }

      if (!res.ok) {
        throw new Error((typeof data.error === 'string' && data.error) || `HTTP ${res.status}`);
      }

      const hasHtml = typeof data.html === 'string' && data.html.trim().length > 0;
      const hasRawSource = typeof data.rawSource === 'string' && data.rawSource.trim().length > 0;
      const hasPreview = typeof data.textPreview === 'string' && data.textPreview.trim().length > 0;

      if (!hasHtml && !hasRawSource && !hasPreview) {
        throw new Error(
          `Web proxy endpoint returned empty page content for ${formattedUrl}. Ensure the Edge browser proxy function is deployed.`
        );
      }

      const fallbackHtml = hasHtml
        ? (data.html as string)
        : `<!doctype html><html><head><meta charset="utf-8"><style>body{background:#090d16;color:#e2e8f0;font-family:ui-monospace,monospace;padding:20px;font-size:13px;line-height:1.6;}pre{white-space:pre-wrap;word-break:break-word;}</style></head><body><pre>${String(
            data.rawSource || data.textPreview || ''
          )
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')}</pre></body></html>`;

      const resolvedUrl = typeof data.url === 'string' && data.url.trim() ? data.url : formattedUrl;
      const resolvedStatusCode = typeof data.statusCode === 'number' ? data.statusCode : res.status;
      const resolvedLatencyMs =
        typeof data.latencyMs === 'number' ? data.latencyMs : Date.now() - startedAt;
      const resolvedLinks = Array.isArray(data.extractedLinks)
        ? (data.extractedLinks as BrowserLink[])
        : [];
      const resolvedTitle = (typeof data.title === 'string' && data.title) || resolvedUrl;
      const resolvedRawSource =
        (typeof data.rawSource === 'string' && data.rawSource) || fallbackHtml;
      const resolvedContentType =
        (typeof data.contentType === 'string' && data.contentType) || 'text/html';
      const resolvedHeaders =
        data.headers && typeof data.headers === 'object'
          ? (data.headers as Record<string, string>)
          : {};
      const resolvedTextPreview = typeof data.textPreview === 'string' ? data.textPreview : '';
      const resolvedCapturedCookies =
        typeof data.capturedCookieHeader === 'string' ? data.capturedCookieHeader : '';
      const updatedJarCookies = setDomainLiveCookies(resolvedUrl, resolvedCapturedCookies);
      const combinedTabCookies = mergeCookieHeaders(updatedJarCookies, resolvedCapturedCookies);

      set((s) => {
        let updatedTargetTab: BrowserTabSession | null = null;
        const nextTabs = s.browserTabs.map((t) => {
          if (t.id !== targetTabId) return t;
          const nextStack = pushHistory
            ? [...t.historyStack.slice(0, t.historyIndex + 1), resolvedUrl]
            : t.historyStack;
          const nextIndex = pushHistory ? nextStack.length - 1 : t.historyIndex;
          updatedTargetTab = {
            ...t,
            url: resolvedUrl,
            title: resolvedTitle,
            status: 'loaded',
            html: fallbackHtml,
            rawSource: resolvedRawSource,
            contentType: resolvedContentType,
            headers: resolvedHeaders,
            error: null,
            latencyMs: resolvedLatencyMs,
            statusCode: resolvedStatusCode,
            links: resolvedLinks,
            textPreview: resolvedTextPreview,
            capturedCookies: combinedTabCookies,
            historyStack: nextStack,
            historyIndex: nextIndex,
          };
          return updatedTargetTab;
        });

        return {
          browserTabs: nextTabs,
          ...(s.activeBrowserTabId === targetTabId && updatedTargetTab
            ? mirrorTabToTopLevel(updatedTargetTab)
            : {}),
          browserAgentLogs: [
            {
              id: `ba-ok-${Date.now()}`,
              timestamp: new Date().toLocaleTimeString(),
              action: `DOM_SYNC (${resolvedStatusCode})`,
              target: `${resolvedLinks.length} links · ${resolvedLatencyMs}ms`,
              status: 'ok',
            },
            ...s.browserAgentLogs.slice(0, 19),
          ],
        };
      });
      persistWorkspaceBrowserState(get());
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Failed to load URL';
      set((s) => {
        const nextTabs = s.browserTabs.map((t) =>
          t.id === targetTabId ? { ...t, status: 'error' as const, error: errMsg } : t
        );
        return {
          browserTabs: nextTabs,
          ...(s.activeBrowserTabId === targetTabId
            ? {
                browserStatus: 'error' as const,
                browserError: errMsg,
              }
            : {}),
          browserAgentLogs: [
            {
              id: `ba-err-${Date.now()}`,
              timestamp: new Date().toLocaleTimeString(),
              action: 'ERROR',
              target: errMsg,
              status: 'error',
            },
            ...s.browserAgentLogs.slice(0, 19),
          ],
        };
      });
    }
  },

  submitBrowserForm: async ({ action, method, contentType, body }) => {
    const formattedUrl = normalizeProxyInputUrl(action);
    if (!formattedUrl) return;

    const targetTabId = get().activeBrowserTabId;
    const targetVaultId =
      get().browserTabs.find((t) => t.id === targetTabId)?.activeVaultId ??
      get().browserActiveVaultId;

    set((s) => ({
      browserTabs: s.browserTabs.map((t) =>
        t.id === targetTabId
          ? { ...t, url: formattedUrl, status: 'loading' as const, error: null }
          : t
      ),
      ...(s.activeBrowserTabId === targetTabId
        ? { browserUrl: formattedUrl, browserStatus: 'loading' as const, browserError: null }
        : {}),
    }));

    const startedAt = Date.now();
    try {
      let vaultCookieHeader: string | null = null;
      try {
        vaultCookieHeader = await resolveDomainSessionCookieHeader(formattedUrl, targetVaultId);
      } catch {
        vaultCookieHeader = null;
      }
      const mergedOutboundCookies = mergeCookieHeaders(
        vaultCookieHeader,
        getDomainLiveCookies(formattedUrl)
      );

      const res = await fetch('/api/workspace/browser-proxy', {
        method: 'POST',
        headers: getWorkspaceAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          url: formattedUrl,
          method: method || 'POST',
          contentType,
          body,
          cookie: mergedOutboundCookies,
          mode: 'navigate',
        }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error((typeof data.error === 'string' && data.error) || `HTTP ${res.status}`);
      }

      const resolvedUrl = typeof data.url === 'string' && data.url.trim() ? data.url : formattedUrl;
      const resolvedStatusCode = typeof data.statusCode === 'number' ? data.statusCode : res.status;
      const resolvedLatencyMs =
        typeof data.latencyMs === 'number' ? data.latencyMs : Date.now() - startedAt;
      const resolvedLinks = Array.isArray(data.extractedLinks)
        ? (data.extractedLinks as BrowserLink[])
        : [];
      const resolvedTitle = (typeof data.title === 'string' && data.title) || resolvedUrl;
      const resolvedHtml = typeof data.html === 'string' ? data.html : '';
      const resolvedRawSource =
        (typeof data.rawSource === 'string' && data.rawSource) || resolvedHtml;
      const resolvedContentType =
        (typeof data.contentType === 'string' && data.contentType) || 'text/html';
      const resolvedHeaders =
        data.headers && typeof data.headers === 'object'
          ? (data.headers as Record<string, string>)
          : {};
      const resolvedTextPreview = typeof data.textPreview === 'string' ? data.textPreview : '';
      const resolvedCapturedCookies =
        typeof data.capturedCookieHeader === 'string' ? data.capturedCookieHeader : '';
      const updatedJarCookies = setDomainLiveCookies(resolvedUrl, resolvedCapturedCookies);
      const combinedTabCookies = mergeCookieHeaders(updatedJarCookies, resolvedCapturedCookies);

      set((s) => {
        let updatedTargetTab: BrowserTabSession | null = null;
        const nextTabs = s.browserTabs.map((t) => {
          if (t.id !== targetTabId) return t;
          const nextStack = [...t.historyStack.slice(0, t.historyIndex + 1), resolvedUrl];
          updatedTargetTab = {
            ...t,
            url: resolvedUrl,
            title: resolvedTitle,
            status: 'loaded',
            html: resolvedHtml,
            rawSource: resolvedRawSource,
            contentType: resolvedContentType,
            headers: resolvedHeaders,
            error: null,
            latencyMs: resolvedLatencyMs,
            statusCode: resolvedStatusCode,
            links: resolvedLinks,
            textPreview: resolvedTextPreview,
            capturedCookies: combinedTabCookies,
            historyStack: nextStack,
            historyIndex: nextStack.length - 1,
          };
          return updatedTargetTab;
        });

        return {
          browserTabs: nextTabs,
          ...(s.activeBrowserTabId === targetTabId && updatedTargetTab
            ? mirrorTabToTopLevel(updatedTargetTab)
            : {}),
          browserAgentLogs: [
            {
              id: `ba-post-${Date.now()}`,
              timestamp: new Date().toLocaleTimeString(),
              action: `FORM_${(method || 'POST').toUpperCase()} (${resolvedStatusCode})`,
              target: `${resolvedUrl} · ${resolvedLatencyMs}ms`,
              status: 'ok',
            },
            ...s.browserAgentLogs.slice(0, 19),
          ],
        };
      });
      persistWorkspaceBrowserState(get());
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Form submission failed';
      set((s) => ({
        browserTabs: s.browserTabs.map((t) =>
          t.id === targetTabId ? { ...t, status: 'error' as const, error: errMsg } : t
        ),
        ...(s.activeBrowserTabId === targetTabId
          ? { browserStatus: 'error' as const, browserError: errMsg }
          : {}),
      }));
    }
  },

  executeBrowserProxyRpc: async ({ url, method, headers, body }) => {
    const formattedUrl = normalizeProxyInputUrl(url);
    if (!formattedUrl) {
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        finalUrl: url,
        headers: {},
        body: '',
        error: 'Invalid proxy RPC URL',
      };
    }

    const targetTabId = get().activeBrowserTabId;
    const targetVaultId =
      get().browserTabs.find((t) => t.id === targetTabId)?.activeVaultId ??
      get().browserActiveVaultId;

    let vaultCookieHeader: string | null = null;
    try {
      vaultCookieHeader = await resolveDomainSessionCookieHeader(formattedUrl, targetVaultId);
    } catch {
      vaultCookieHeader = null;
    }
    const mergedOutboundCookies = mergeCookieHeaders(
      vaultCookieHeader,
      getDomainLiveCookies(formattedUrl)
    );

    const res = await fetch('/api/workspace/browser-proxy', {
      method: 'POST',
      headers: getWorkspaceAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        url: formattedUrl,
        method: (method || 'GET').toUpperCase(),
        headers: headers || {},
        body,
        cookie: mergedOutboundCookies,
        mode: 'rpc',
      }),
    });

    const data = (await res.json()) as {
      ok?: boolean;
      status?: number;
      statusText?: string;
      finalUrl?: string;
      headers?: Record<string, string>;
      body?: string;
      capturedCookieHeader?: string;
      error?: string;
    };

    const resolvedFinalUrl = data.finalUrl || formattedUrl;
    if (data.capturedCookieHeader) {
      const updatedJar = setDomainLiveCookies(resolvedFinalUrl, data.capturedCookieHeader);
      const combined = mergeCookieHeaders(updatedJar, data.capturedCookieHeader);
      set((s) => ({
        browserTabs: s.browserTabs.map((t) =>
          t.id === targetTabId ? { ...t, capturedCookies: combined } : t
        ),
        ...(s.activeBrowserTabId === targetTabId ? { browserCapturedCookies: combined } : {}),
      }));
    }

    return {
      ok: Boolean(data.ok ?? res.ok),
      status: typeof data.status === 'number' ? data.status : res.status,
      statusText: data.statusText || res.statusText || 'OK',
      finalUrl: resolvedFinalUrl,
      headers: data.headers && typeof data.headers === 'object' ? data.headers : {},
      body: typeof data.body === 'string' ? data.body : '',
      ...(data.error ? { error: data.error } : {}),
    };
  },

  browserBack: () => {
    const { browserHistoryStack, browserHistoryIndex, activeBrowserTabId, navigateBrowser } = get();
    if (browserHistoryIndex > 0) {
      const prevIndex = browserHistoryIndex - 1;
      const prevUrl = browserHistoryStack[prevIndex];
      set((s) => ({
        browserHistoryIndex: prevIndex,
        browserTabs: s.browserTabs.map((t) =>
          t.id === activeBrowserTabId ? { ...t, historyIndex: prevIndex } : t
        ),
      }));
      navigateBrowser(prevUrl, false);
    }
  },

  browserForward: () => {
    const { browserHistoryStack, browserHistoryIndex, activeBrowserTabId, navigateBrowser } = get();
    if (browserHistoryIndex < browserHistoryStack.length - 1) {
      const nextIndex = browserHistoryIndex + 1;
      const nextUrl = browserHistoryStack[nextIndex];
      set((s) => ({
        browserHistoryIndex: nextIndex,
        browserTabs: s.browserTabs.map((t) =>
          t.id === activeBrowserTabId ? { ...t, historyIndex: nextIndex } : t
        ),
      }));
      navigateBrowser(nextUrl, false);
    }
  },

  refreshBrowser: () => {
    const { browserUrl, navigateBrowser } = get();
    if (!browserUrl) return;
    navigateBrowser(browserUrl, false);
  },

  resetBrowserHome: () => {
    set((s) => {
      const nextTabs = s.browserTabs.map((t) =>
        t.id === s.activeBrowserTabId
          ? {
              ...t,
              url: '',
              title: 'New Tab',
              status: 'idle' as const,
              html: '',
              rawSource: '',
              contentType: '',
              headers: {},
              error: null,
              latencyMs: null,
              statusCode: null,
              links: [],
              textPreview: '',
              capturedCookies: '',
            }
          : t
      );
      return {
        browserTabs: nextTabs,
        browserUrl: '',
        browserTitle: 'New Tab',
        browserStatus: 'idle',
        browserHtml: '',
        browserRawSource: '',
        browserContentType: '',
        browserHeaders: {},
        browserError: null,
        browserLatencyMs: null,
        browserStatusCode: null,
        browserLinks: [],
        browserTextPreview: '',
        browserCapturedCookies: '',
      };
    });
    persistWorkspaceBrowserState(get());
  },
  setBrowserActiveVaultId: (id) => {
    set((s) => ({
      browserActiveVaultId: id,
      browserTabs: s.browserTabs.map((t) =>
        t.id === s.activeBrowserTabId ? { ...t, activeVaultId: id } : t
      ),
    }));
    persistWorkspaceBrowserState(get());
  },
}));
