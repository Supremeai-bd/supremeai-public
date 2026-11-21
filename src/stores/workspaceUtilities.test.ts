import { mockEdgePreferences, testEdgeEnv, testSessionHeaders } from '../test/edgePreferences';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

const { createMemoryStorage } = vi.hoisted(() => {
  const createMem = (): Storage => {
    const store: Record<string, string> = {};
    return {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
      get length() {
        return Object.keys(store).length;
      },
    };
  };
  if (typeof globalThis.localStorage === 'undefined') {
    (globalThis as unknown as { localStorage: Storage }).localStorage = createMem();
  }
  return { createMemoryStorage: createMem };
});

import {
  normalizeProxyInputUrl,
  useWorkspaceStore,
  loadLiveArtifactSyncPref,
  loadPersistedWorkspaceBrowserState,
  LIVE_ARTIFACT_SYNC_STORAGE_KEY,
  WORKSPACE_BROWSER_STATE_STORAGE_KEY,
} from './useWorkspaceStore';
import {
  extractStreamingArtifact,
  classifyCodeLanguage,
  isPreviewableCodeLanguage,
  isShellCommandLanguage,
} from '../utils/artifactStreamParser';
import {
  clearDomainLiveCookies,
  getDomainLiveCookies,
  isGoogleStrictAuthUrl,
  mergeCookieHeaders,
  setDomainLiveCookies,
} from '../services/browserSessionJar';
import {
  loadBrowserBookmarks,
  removeBrowserBookmark,
  upsertBrowserBookmark,
} from '../components/workspace/WorkspaceBrowserTab';
import {
  loadSavedSandboxSnippets,
  saveSandboxSnippet,
  deleteSandboxSnippet,
} from '../components/workspace/WorkspaceSandboxTab';
import {
  loadLocalScratchpadFiles,
  createLocalScratchpadFile,
  saveLocalScratchpadFile,
  renameLocalScratchpadFile,
  updateLocalScratchpadContent,
  deleteLocalScratchpadFile,
  loadActiveScratchpadId,
  saveActiveScratchpadId,
  inferLanguageFromFilename,
} from '../components/workspace/WorkspaceCodeTab';
import {
  parseTerminalResponse,
  executeClientFallbackCommand,
} from '../components/workspace/WorkspaceTerminalTab';
import {
  computeShortestPathBFS,
  parseMermaidFlowchartToGraph,
  loadCustomGraph,
  saveCustomGraph,
  GraphData,
} from '../services/graphService';
import { getTranslation } from '../utils/i18n';
import { onRequest as browserProxyEdgeHandler } from '../../functions/api/workspace/browser-proxy';
import { onRequest as browserVaultEdgeHandler } from '../../functions/api/workspace/browser-vault';
import { onRequest as browserSchedulesEdgeHandler } from '../../functions/api/workspace/browser-schedules';
import { onRequest as gmailSessionEdgeHandler } from '../../functions/api/workspace/gmail-session';
import {
  buildGmailSessionSetCookie,
  GMAIL_SESSION_COOKIE_NAME,
  parseCookieFromHeader,
  sealGmailSessionCookie,
  unsealGmailSessionCookie,
} from '../shared/gmailSessionCrypto';
import {
  extractVaultDomain,
  parseSessionInputToCookies,
  saveSessionSnapshot,
  saveDomainCredentials,
  decryptVaultPayload,
  getVaultEntriesForUrl,
  resolveDomainSessionCookieHeader,
  resolveDomainCredentialsForAutofill,
  exportEncryptedVaultBackup,
  importEncryptedVaultBackup,
  syncVaultWithCloud,
  loadVaultCloudSyncEnabled,
  setVaultCloudSyncEnabled,
  loadScheduledTasks,
  saveScheduledTask,
  toggleScheduledTask,
  markScheduledTaskRun,
  deleteScheduledTask,
  getDefaultCronForCadence,
  buildScheduledAutomationPrompt,
  deleteVaultEntry,
  shouldPromptSaveSubmittedPassword,
  markDomainNeverSave,
  clearDomainNeverSave,
  isDomainNeverSaved,
  hasSchedulingIntent,
  parseNaturalLanguageSchedule,
  parseAiScheduleBlocks,
  BROWSER_VAULT_STORAGE_KEY,
  BROWSER_NEVER_SAVE_DOMAINS_KEY,
} from '../services/browserVaultService';
import { transformCodeForBrowserPreview } from '../utils/previewCodeTransform';
import { buildSandboxSrcDoc } from '../components/workspace/WorkspacePreviewTab';
import { computeLineDiff, summarizeDiff } from '../utils/lineDiff';
import {
  encodeArtifactSharePayload,
  decodeArtifactSharePayload,
  buildArtifactShareUrl,
} from '../utils/previewShare';
import {
  loadGitTokens,
  saveGitTokens,
  pushToGitHub,
  pushToGitLab,
  fetchGitOAuthStatus,
  isTrustedOAuthMessageOrigin,
} from '../services/gitExportService';

describe('Workspace Browser URL Normalization', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = createMemoryStorage();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('preserves local relative /api paths without prepending https://', () => {
    expect(normalizeProxyInputUrl('/api/health')).toBe('/api/health');
    expect(normalizeProxyInputUrl('  /api/mcp-tower/services  ')).toBe('/api/mcp-tower/services');
  });

  it('normalizes bare domains, protocol-relative URLs, search queries, and full URLs cleanly', () => {
    expect(normalizeProxyInputUrl('example.com')).toBe('https://example.com');
    expect(normalizeProxyInputUrl('//cdn.example.org/app.js')).toBe(
      'https://cdn.example.org/app.js'
    );
    expect(normalizeProxyInputUrl('http://127.0.0.1:3000/api/health')).toBe(
      'http://127.0.0.1:3000/api/health'
    );
    expect(normalizeProxyInputUrl('artificial intelligence')).toBe(
      'https://en.wikipedia.org/w/index.php?search=artificial%20intelligence'
    );
    expect(normalizeProxyInputUrl('   ')).toBe('');
  });

  it('adds, updates, persists, and removes user browser bookmarks without hardcoded links', () => {
    expect(loadBrowserBookmarks()).toEqual([]);

    const added = upsertBrowserBookmark([], 'example.com', 'Example Site');
    expect(added).toHaveLength(1);
    expect(added[0].url).toBe('https://example.com');
    expect(added[0].label).toBe('Example Site');
    expect(loadBrowserBookmarks()).toEqual(added);

    const updated = upsertBrowserBookmark(added, 'https://example.com', 'Updated Example');
    expect(updated).toHaveLength(1);
    expect(updated[0].label).toBe('Updated Example');

    const cleared = removeBrowserBookmark(updated, updated[0].id);
    expect(cleared).toEqual([]);
    expect(loadBrowserBookmarks()).toEqual([]);
  });

  it('flags stubbed proxy responses without page content as error instead of hanging on loading', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ url: 'https://example.com', status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await useWorkspaceStore.getState().navigateBrowser('https://example.com');
    const state = useWorkspaceStore.getState();
    expect(state.browserStatus).toBe('error');
    expect(state.browserError).toContain('empty page content');
  });

  it('renders full HTML responses returned by the edge browser-proxy function', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src none"><title>Example Domain</title></head><body><h1>Example Domain</h1><a href="/about">About</a></body></html>',
        {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }
      );
    }) as typeof fetch;

    const edgeRes = await browserProxyEdgeHandler({
      request: new Request(
        'https://supremeai.pages.dev/api/workspace/browser-proxy?url=https%3A%2F%2Fexample.com',
        { headers: testSessionHeaders }
      ),
    });
    expect(edgeRes.status).toBe(200);
    const payload = (await edgeRes.json()) as {
      title: string;
      statusCode: number;
      latencyMs: number;
      html: string;
      extractedLinks: Array<{ href: string; text: string }>;
    };
    expect(payload.title).toBe('Example Domain');
    expect(payload.statusCode).toBe(200);
    expect(typeof payload.latencyMs).toBe('number');
    expect(payload.html).toContain('<base href="https://example.com/"');
    expect(payload.html).not.toContain('Content-Security-Policy');
    expect(payload.extractedLinks).toEqual([{ href: 'https://example.com/about', text: 'About' }]);

    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await useWorkspaceStore.getState().navigateBrowser('https://example.com');
    const storeState = useWorkspaceStore.getState();
    expect(storeState.browserStatus).toBe('loaded');
    expect(storeState.browserHtml).toContain('<h1>Example Domain</h1>');
    expect(storeState.browserLatencyMs).toBe(payload.latencyMs);

    useWorkspaceStore.getState().resetBrowserHome();
    const homeState = useWorkspaceStore.getState();
    expect(homeState.browserStatus).toBe('idle');
    expect(homeState.browserUrl).toBe('');
    expect(homeState.browserHtml).toBe('');
  });
});

describe('Workspace Isolated Buffers, Snippets & Code Scratchpad', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = createMemoryStorage();
    useWorkspaceStore.getState().clearPreviewCode();
    useWorkspaceStore.getState().clearSandboxCode();
  });

  it('isolates Sandbox buffer from Preview/Code buffer and disables noisy agent stream by default', () => {
    const initial = useWorkspaceStore.getState();
    expect(initial.previewCode).toBe('');
    expect(initial.sandboxCode).toBe('');
    expect(initial.isAgentStreamEnabled).toBe(false);

    initial.loadCodeIntoWorkspace('<h1>Live UI</h1>', 'html', 'preview');
    expect(useWorkspaceStore.getState().previewCode).toBe('<h1>Live UI</h1>');
    expect(useWorkspaceStore.getState().sandboxCode).toBe('');

    initial.loadCodeIntoWorkspace('console.log(42)', 'javascript', 'sandbox', true);
    expect(useWorkspaceStore.getState().sandboxCode).toBe('console.log(42)');
    expect(useWorkspaceStore.getState().previewCode).toBe('<h1>Live UI</h1>');

    initial.updatePreviewCode('graph TD; A-->B;', 'mermaid');
    expect(useWorkspaceStore.getState().mermaidGraphSource).toBe('graph TD; A-->B;');
  });

  it('saves, updates, and deletes Sandbox snippets in localStorage', () => {
    expect(loadSavedSandboxSnippets()).toEqual([]);
    const list1 = saveSandboxSnippet([], 'Prime Check', 'javascript', 'console.log(7)');
    expect(list1).toHaveLength(1);
    expect(loadSavedSandboxSnippets()).toEqual(list1);

    const list2 = saveSandboxSnippet(list1, 'Prime Check', 'typescript', 'console.log(11)');
    expect(list2).toHaveLength(1);
    expect(list2[0].lang).toBe('typescript');

    const cleared = deleteSandboxSnippet(list2, list2[0].id);
    expect(cleared).toEqual([]);
  });

  it('creates, renames, updates, switches, and persists multiple virtual scratchpad files in Code tab', () => {
    expect(loadLocalScratchpadFiles()).toEqual([]);
    expect(inferLanguageFromFilename('App.tsx')).toBe('tsx');
    expect(inferLanguageFromFilename('styles.css')).toBe('css');

    const { files: f1, created: appFile } = createLocalScratchpadFile(
      [],
      'App.tsx',
      'tsx',
      'export default function App(){return <div/>}'
    );
    const { files: f2, created: cssFile } = createLocalScratchpadFile(
      f1,
      'styles.css',
      'css',
      'body { color: cyan; }'
    );
    expect(f2).toHaveLength(2);
    expect(appFile.lang).toBe('tsx');
    expect(cssFile.lang).toBe('css');

    // Persist active virtual file ID across sessions
    saveActiveScratchpadId(cssFile.id);
    expect(loadActiveScratchpadId()).toBe(cssFile.id);

    // Update virtual file content without losing other file
    const f3 = updateLocalScratchpadContent(f2, cssFile.id, 'body { color: #22d3ee; }');
    expect(loadLocalScratchpadFiles().find((f) => f.id === cssFile.id)?.content).toBe(
      'body { color: #22d3ee; }'
    );

    // Rename virtual file and automatically update language from new extension
    const { files: f4, renamed } = renameLocalScratchpadFile(f3, appFile.id, 'diagram.mmd');
    expect(renamed?.name).toBe('diagram.mmd');
    expect(renamed?.lang).toBe('mermaid');

    // Collision-safe save and delete
    const { files: f5, saved } = saveLocalScratchpadFile(
      f4,
      'widget.tsx',
      'tsx',
      'export default function W() { return null; }'
    );
    expect(f5).toHaveLength(3);
    expect(saved.name).toBe('widget.tsx');

    const remaining = deleteLocalScratchpadFile(f5, saved.id);
    expect(remaining).toHaveLength(2);
  });
});

describe('Workspace Terminal Parsing & Edge Fallback', () => {
  it('normalizes stdout, output, and text fields from heterogeneous backend responses', () => {
    expect(parseTerminalResponse({ stdout: 'ok' })).toEqual({ stdout: 'ok', stderr: '' });
    expect(parseTerminalResponse({ output: 'cloud-output', error: 'warn' })).toEqual({
      stdout: 'cloud-output',
      stderr: 'warn',
    });
    expect(parseTerminalResponse({ text: 'plain-text' })).toEqual({
      stdout: 'plain-text',
      stderr: '',
    });
  });

  it('executes client-side diagnostic commands cleanly when host shell is unavailable', async () => {
    const helpRes = await executeClientFallbackCommand('help', [], true);
    expect(helpRes.stdout).toContain('Edge & Local Shell');

    const histRes = await executeClientFallbackCommand('history', ['status', 'date'], true);
    expect(histRes.stdout).toContain('date');
    expect(histRes.stdout).toContain('status');

    const echoRes = await executeClientFallbackCommand('echo hello studio', [], true);
    expect(echoRes.stdout).toBe('hello studio');

    const blockedRes = await executeClientFallbackCommand('git status', [], true);
    expect(blockedRes.stderr).toContain('local Node.js backend');
  });
});

describe('Workspace Graph BFS & Mermaid Parser', () => {
  const sampleGraph: GraphData = {
    nodes: [
      { id: 'ui', data: { label: 'Studio UI' } },
      { id: 'gw', data: { label: 'Express Gateway' } },
      { id: 'rag', data: { label: 'Knowledge RAG' } },
      { id: 'browser', data: { label: 'Browser Proxy' } },
      { id: 'isolated', data: { label: 'Isolated Node' } },
    ],
    edges: [
      { id: 'e1', source: 'ui', target: 'gw', label: 'SSE' },
      { id: 'e2', source: 'gw', target: 'rag', label: 'RAG' },
      { id: 'e3', source: 'gw', target: 'browser', label: 'PROXY' },
    ],
  };

  it('computes multi-hop shortest path across studio topology edges', () => {
    expect(computeShortestPathBFS(sampleGraph, 'ui', 'rag')).toEqual(['ui', 'gw', 'rag']);
    expect(computeShortestPathBFS(sampleGraph, 'rag', 'browser')).toEqual(['rag', 'gw', 'browser']);
  });

  it('returns single node for identical source and target and empty for unreachable nodes', () => {
    expect(computeShortestPathBFS(sampleGraph, 'ui', 'ui')).toEqual(['ui']);
    expect(computeShortestPathBFS(sampleGraph, 'ui', 'isolated')).toEqual([]);
  });

  it('parses Mermaid flowchart syntax into interactive GraphData and solves BFS paths', () => {
    const mermaid = `
      flowchart TD
      A[Client App] -->|HTTPS| B(Edge Proxy)
      B --> C[LLM Gateway] --> D[(Vector DB)]
    `;
    const parsed = parseMermaidFlowchartToGraph(mermaid);
    expect(parsed.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(parsed.nodes[0].data.label).toBe('Client App');
    expect(parsed.edges[0].label).toBe('HTTPS');
    expect(computeShortestPathBFS(parsed, 'A', 'D')).toEqual(['A', 'B', 'C', 'D']);

    (globalThis as unknown as { localStorage: Storage }).localStorage = createMemoryStorage();
    saveCustomGraph(parsed, { A: { x: 100, y: 120 } });
    const loaded = loadCustomGraph();
    expect(loaded.graph.nodes).toHaveLength(4);
    expect(loaded.positions.A).toEqual({ x: 100, y: 120 });
  });
});

describe('Workspace Dock Localization Completeness', () => {
  it('contains matching non-empty EN and BN translations for workspace tabs', () => {
    const en = getTranslation('en');
    const bn = getTranslation('bn');
    const keys = [
      'wsIsolatedVm',
      'wsRun',
      'wsStop',
      'wsApplyPreview',
      'wsRunInSandbox',
      'wsBrowserRender',
      'wsBrowserAgentDom',
      'wsBrowserSource',
      'wsBrowserOpenExternal',
      'wsBrowserHome',
      'wsBrowserBookmarksTitle',
      'wsBrowserAddBookmark',
      'wsBrowserBlockedNotice',
      'wsGraphPathSolver',
      'wsNewClear',
      'wsSaveSnippet',
      'wsPreviewEmptyTitle',
      'wsPreviewChatCardTitle',
      'wsPreviewChatCardAction',
      'wsPreviewCodeCardTitle',
      'wsPreviewSupportedFormats',
      'wsOpenCodeTab',
      'wsPopoutPreview',
      'wsRuntimeErrorBanner',
      'wsTerminalFallbackReady',
      'wsCodeLanguageLabel',
      'wsSaveLocalFile',
      'wsRenameFile',
      'wsCreateFilePlaceholder',
      'wsRenameFilePlaceholder',
      'wsCreateBtn',
      'wsAutoSaved',
      'wsDownloadFile',
      'wsGraphModeCustom',
      'wsGraphModeTopology',
      'wsGraphImportMermaid',
      'wsGraphEmptyCustom',
      'wsLiveArtifactSync',
      'wsLiveArtifactSyncOption',
      'wsLiveArtifactSyncDesc',
      'wsLiveSyncStreaming',
      'wsInspectElement',
      'wsInspectElementActive',
      'wsCodeMode',
      'wsDiffMode',
      'wsDiffAccept',
      'wsDiffRevertPrev',
      'wsPublishApp',
      'wsVerifiedBadge',
      'wsAutoFixError',
      'wsExportGit',
      'gitModalTitle',
      'gitPushNowBtn',
      'gitSettingsCardTitle',
      'wsVaultBtn',
      'wsVaultTitle',
      'wsVaultIsolationHint',
      'wsVaultSessionTab',
      'wsVaultCredentialsTab',
      'wsVaultScheduleTab',
      'wsVaultSessionDesc',
      'wsVaultSessionInputLabel',
      'wsVaultSessionInputPlaceholder',
      'wsVaultCapturedHint',
      'wsVaultSaveSessionBtn',
      'wsVaultUsernameLabel',
      'wsVaultPasswordLabel',
      'wsVaultSaveCredsBtn',
      'wsVaultScheduleDesc',
      'wsVaultSchedulePromptPlaceholder',
      'wsVaultSendScheduleBtn',
      'wsVaultSavedEntriesTitle',
      'wsVaultEmptyDomain',
      'wsVaultApplySession',
      'wsVaultActiveSessionBadge',
      'wsVaultNoUrlHint',
      'wsBrowserNewTab',
      'wsBrowserCloseTab',
      'wsAutofillTitle',
      'wsAutofillBtn',
      'wsAutofillApplied',
      'wsAutofillDetectedHint',
      'wsVaultCloudSync',
      'wsVaultCloudSyncing',
      'wsVaultCloudSynced',
      'wsVaultExportBackup',
      'wsVaultImportBackup',
      'wsScheduleTitleLabel',
      'wsScheduleTitlePlaceholder',
      'wsScheduleCadenceLabel',
      'wsScheduleCadenceHourly',
      'wsScheduleCadenceDaily',
      'wsScheduleCadenceWeekly',
      'wsScheduleCadenceCustom',
      'wsScheduleSaveBtn',
      'wsScheduleActiveTitle',
      'wsScheduleEmpty',
      'wsScheduleRunNow',
      'wsSchedulePause',
      'wsScheduleResume',
      'wsScheduleLastRun',
      'wsScheduleNeverRun',
      'gitOAuthConnectGithub',
      'gitOAuthConnectGitlab',
      'gitOAuthConnecting',
      'gitOAuthConnected',
      'gitOAuthCallbackHint',
      'wsBrowserSaveCookiesBtn',
      'wsBrowserSaveCookiesTooltip',
      'wsBrowserSavePasswordBtn',
      'wsBrowserSavePasswordPromptTitle',
      'wsBrowserNoCookiesYet',
      'wsVaultSessionReadyTitle',
      'wsVaultSessionAutoDetected',
      'wsVaultSessionNoneDetected',
      'wsVaultAdvancedRawToggle',
      'dockMoreTools',
      'wsCodeExplorer',
      'wsCodeToggleExplorer',
      'wsCodeFilterFiles',
      'wsCodeActiveBuffer',
      'wsNonBrowserBadge',
      'wsNonBrowserHint',
      'wsOpenInCodeBtn',
      'wsOpenInTerminalBtn',
      'wsScriptRunnerBtn',
      'wsLiveAutoPreviewHint',
      'wsChatTerminalBtn',
    ] as const;

    for (const key of keys) {
      expect(en[key].trim().length).toBeGreaterThan(0);
      expect(bn[key].trim().length).toBeGreaterThan(0);
    }
  });
});

describe('Live Artifact Streaming Parser & Workspace Sync', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = createMemoryStorage();
    useWorkspaceStore.setState({
      isDockOpen: false,
      activeDockTab: 'preview',
      previewCode: '',
      previewLang: 'html',
      previewRefreshKey: 1,
      sandboxCode: '',
      sandboxLang: 'javascript',
      sandboxRevision: 0,
      sandboxAutoRunNonce: 0,
      mermaidGraphSource: '',
      liveArtifactSync: true,
      isArtifactStreaming: false,
    });
  });

  it('extracts incomplete streaming TSX/HTML/Mermaid/JS artifacts and selects the latest block', () => {
    // Plain prose & non-artifact shell blocks are ignored
    expect(extractStreamingArtifact('Hello world!\n```bash\nnpm install\n```')).toBeNull();

    // Unclosed in-progress TSX block triggers once substantial JSX appears
    const partialTsx = [
      'Sure, here is a live card:',
      '```tsx',
      'export default function Card() {',
      '  return <div className="p-4">Hello</div>;',
    ].join('\n');
    const parsedTsx = extractStreamingArtifact(partialTsx);
    expect(parsedTsx).not.toBeNull();
    expect(parsedTsx?.lang).toBe('tsx');
    expect(parsedTsx?.targetTab).toBe('preview');
    expect(parsedTsx?.isClosed).toBe(false);

    // Unclosed Mermaid diagram
    const partialMermaid = '```mermaid\nflowchart TD\nA[Client] --> B[Gateway]';
    const parsedMermaid = extractStreamingArtifact(partialMermaid);
    expect(parsedMermaid?.lang).toBe('mermaid');
    expect(parsedMermaid?.targetTab).toBe('preview');
    expect(parsedMermaid?.isClosed).toBe(false);

    // Multiple blocks pick the latest renderable artifact
    const multiBlock = [
      '```javascript',
      'const helper = (x) => x * 2;',
      'console.log(helper(21));',
      '```',
      'Now here is the UI:',
      '```html',
      '<section class="card"><h1>Ready Dashboard</h1></section>',
      '```',
    ].join('\n');
    const latest = extractStreamingArtifact(multiBlock);
    expect(latest?.lang).toBe('html');
    expect(latest?.targetTab).toBe('preview');
    expect(latest?.isClosed).toBe(true);
    expect(latest?.blockIndex).toBe(1);
  });

  it('persists liveArtifactSync preference and syncs preview/sandbox without iframe flicker mid-stream', () => {
    expect(loadLiveArtifactSyncPref()).toBe(true);
    useWorkspaceStore.getState().toggleLiveArtifactSync();
    expect(useWorkspaceStore.getState().liveArtifactSync).toBe(false);
    expect(localStorage.getItem(LIVE_ARTIFACT_SYNC_STORAGE_KEY)).toBe('false');
    expect(loadLiveArtifactSyncPref()).toBe(false);

    useWorkspaceStore.getState().setLiveArtifactSync(true);
    expect(useWorkspaceStore.getState().liveArtifactSync).toBe(true);
    expect(localStorage.getItem(LIVE_ARTIFACT_SYNC_STORAGE_KEY)).toBe('true');

    // Mid-stream preview update opens dock once without bumping previewRefreshKey
    const initialRefreshKey = useWorkspaceStore.getState().previewRefreshKey;
    useWorkspaceStore.getState().syncStreamingArtifact('flowchart TD\nA-->B', 'mermaid', {
      targetTab: 'preview',
      autoOpenDock: true,
      isFinal: false,
    });
    let st = useWorkspaceStore.getState();
    expect(st.isDockOpen).toBe(true);
    expect(st.activeDockTab).toBe('preview');
    expect(st.mermaidGraphSource).toBe('flowchart TD\nA-->B');
    expect(st.isArtifactStreaming).toBe(true);
    expect(st.previewRefreshKey).toBe(initialRefreshKey);

    // Final preview flush clears streaming indicator
    useWorkspaceStore.getState().syncStreamingArtifact('flowchart TD\nA-->B-->C', 'mermaid', {
      targetTab: 'preview',
      autoOpenDock: false,
      isFinal: true,
    });
    st = useWorkspaceStore.getState();
    expect(st.isArtifactStreaming).toBe(false);
    expect(st.previewCode).toBe('flowchart TD\nA-->B-->C');

    // Sandbox artifact does NOT auto-run mid-stream, only runs once isFinal === true
    const nonceBefore = st.sandboxAutoRunNonce;
    useWorkspaceStore.getState().syncStreamingArtifact('console.log("streaming")', 'javascript', {
      targetTab: 'sandbox',
      autoOpenDock: true,
      isFinal: false,
    });
    expect(useWorkspaceStore.getState().sandboxAutoRunNonce).toBe(nonceBefore);
    expect(useWorkspaceStore.getState().activeDockTab).toBe('sandbox');

    useWorkspaceStore.getState().syncStreamingArtifact('console.log("done")', 'javascript', {
      targetTab: 'sandbox',
      autoOpenDock: false,
      isFinal: true,
    });
    expect(useWorkspaceStore.getState().sandboxAutoRunNonce).toBe(nonceBefore + 1);
    expect(useWorkspaceStore.getState().isArtifactStreaming).toBe(false);
  });
});

describe('Pro Studio Features: esm.sh Transform, Diff, Share & Git Export', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = createMemoryStorage();
    useWorkspaceStore.getState().clearPreviewCode();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('rewrites external NPM imports to esm.sh with unified React 18 importmap and keeps zero-import snippets fast', () => {
    const simple = transformCodeForBrowserPreview(
      `import React, { useState } from 'react';\nexport default function Counter() { const [n] = useState(0); return <div>{n}</div>; }`
    );
    expect(simple.usesEsmImports).toBe(false);
    expect(simple.externalPackages).toEqual([]);
    expect(simple.transformedCode).toContain('const __DefaultExport__ = function Counter');

    const withLibs = transformCodeForBrowserPreview(
      [
        `import React, { useReducer } from 'react';`,
        `import { motion, AnimatePresence } from 'framer-motion';`,
        `import confetti from 'canvas-confetti';`,
        `import * as Icons from 'lucide-react';`,
        `import './styles.css';`,
        `export default function Hero() { return <motion.div />; }`,
      ].join('\n')
    );

    expect(withLibs.usesEsmImports).toBe(true);
    expect(withLibs.externalPackages).toEqual(['framer-motion', 'canvas-confetti', 'lucide-react']);
    expect(withLibs.reactBindings).toContain('useReducer');
    expect(withLibs.transformedCode).toContain(
      'const { motion, AnimatePresence } = await import("https://esm.sh/framer-motion?deps=react@18.3.1,react-dom@18.3.1");'
    );
    expect(withLibs.transformedCode).toContain(
      'const { default: confetti } = await import("https://esm.sh/canvas-confetti?deps=react@18.3.1,react-dom@18.3.1");'
    );
    expect(withLibs.transformedCode).toContain(
      'const Icons = await import("https://esm.sh/lucide-react?deps=react@18.3.1,react-dom@18.3.1");'
    );
    expect(withLibs.transformedCode).not.toContain('./styles.css');

    const srcDoc = buildSandboxSrcDoc(
      `import { Rocket } from 'lucide-react';\nexport default function App() { return <Rocket />; }`,
      'tsx',
      true
    );
    expect(srcDoc).toContain('<script type="importmap">');
    expect(srcDoc).toContain('https://esm.sh/react@18.3.1');
    expect(srcDoc).toContain('supremeai-preview-host');
    expect(srcDoc).toContain('__supremeAiReportVerified');
  });

  it('computes line diffs and tracks previousPreviewCode baseline across edits, accept, and revert', () => {
    const diff = computeLineDiff(
      'const a = 1;\nconst b = 2;',
      'const a = 1;\nconst b = 3;\nconst c = 4;'
    );
    const summary = summarizeDiff(diff);
    expect(summary.additions).toBe(2);
    expect(summary.deletions).toBe(1);
    expect(summary.unchanged).toBe(1);
    expect(summary.hasChanges).toBe(true);

    const store = useWorkspaceStore.getState();
    store.loadCodeIntoWorkspace('const v = 1;', 'tsx', 'preview');
    expect(useWorkspaceStore.getState().previousPreviewCode).toBe('');

    // Streaming updates capture baseline once without clobbering on subsequent chunks
    store.syncStreamingArtifact('const v = 1;\nconst next = 2;', 'tsx', {
      targetTab: 'preview',
      captureDiffBaseline: true,
      isFinal: false,
    });
    expect(useWorkspaceStore.getState().previousPreviewCode).toBe('const v = 1;');

    store.syncStreamingArtifact('const v = 1;\nconst next = 3;', 'tsx', {
      targetTab: 'preview',
      captureDiffBaseline: false,
      isFinal: true,
    });
    expect(useWorkspaceStore.getState().previousPreviewCode).toBe('const v = 1;');
    expect(useWorkspaceStore.getState().previewCode).toBe('const v = 1;\nconst next = 3;');

    store.revertPreviewDiff();
    expect(useWorkspaceStore.getState().previewCode).toBe('const v = 1;');
    expect(useWorkspaceStore.getState().previousPreviewCode).toBe('');

    store.updatePreviewCode('const v = 9;');
    expect(useWorkspaceStore.getState().previousPreviewCode).toBe('const v = 1;');
    store.acceptPreviewDiff();
    expect(useWorkspaceStore.getState().previousPreviewCode).toBe('const v = 9;');
  });

  it('encodes and decodes UTF-8 bilingual share artifact payloads losslessly', () => {
    const payload = {
      code: 'export default function BanglaApp() { return <h1>স্বাগতম SupremeAI</h1>; }',
      lang: 'tsx',
      title: 'Bangla Counter App',
    };
    const token = encodeArtifactSharePayload(payload);
    const url = buildArtifactShareUrl(payload, 'https://supremeai-studio.pages.dev');
    expect(url).toContain('https://supremeai-studio.pages.dev/?artifact=');
    expect(url.endsWith('#chat')).toBe(true);

    const decoded = decodeArtifactSharePayload(token);
    expect(decoded?.code).toBe(payload.code);
    expect(decoded?.lang).toBe('tsx');
    expect(decoded?.title).toBe('Bangla Counter App');
    expect(decodeArtifactSharePayload('!!!invalid-token!!!')).toBeNull();

    useWorkspaceStore.getState().openSharedArtifact(payload.code, payload.lang, payload.title);
    const st = useWorkspaceStore.getState();
    expect(st.isDockOpen).toBe(true);
    expect(st.isSharedArtifactView).toBe(true);
    expect(st.previewCode).toBe(payload.code);
  });

  it('persists Git tokens locally and pushes commits + PR/MR to GitHub and GitLab REST APIs', async () => {
    saveGitTokens({
      githubToken: 'ghp_test123',
      gitlabToken: 'glpat_test456',
      gitlabHost: 'https://gitlab.example.com/',
      defaultGithubRepo: 'Supremeai-bd/demo',
    });
    const loaded = loadGitTokens();
    expect(loaded.githubToken).toBe('ghp_test123');
    expect(loaded.gitlabToken).toBe('glpat_test456');
    expect(loaded.gitlabHost).toBe('https://gitlab.example.com');

    // Mock GitHub branch + file commit + PR creation flow
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/git/ref/heads/main')) {
        return new Response(JSON.stringify({ object: { sha: 'abc123sha' } }), { status: 200 });
      }
      if (url.endsWith('/git/refs') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ref: 'refs/heads/supremeai/export' }), {
          status: 201,
        });
      }
      if (url.includes('/contents/') && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }
      if (url.includes('/contents/') && init?.method === 'PUT') {
        return new Response(
          JSON.stringify({
            commit: { html_url: 'https://github.com/Supremeai-bd/demo/commit/999' },
          }),
          { status: 201 }
        );
      }
      if (url.endsWith('/pulls') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ html_url: 'https://github.com/Supremeai-bd/demo/pull/42' }),
          { status: 201 }
        );
      }
      if (url.includes('/api/v4/projects/') && url.includes('/repository/files/')) {
        return new Response(JSON.stringify({ file_path: 'src/App.tsx' }), { status: 200 });
      }
      if (url.includes('/api/v4/projects/') && url.endsWith('/repository/commits')) {
        return new Response(
          JSON.stringify({ web_url: 'https://gitlab.example.com/team/app/-/commit/777' }),
          { status: 201 }
        );
      }
      if (url.includes('/api/v4/projects/') && url.endsWith('/merge_requests')) {
        return new Response(
          JSON.stringify({ web_url: 'https://gitlab.example.com/team/app/-/merge_requests/9' }),
          { status: 201 }
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const ghRes = await pushToGitHub({
      token: 'ghp_test123',
      repo: 'Supremeai-bd/demo',
      branch: 'main',
      files: [{ path: 'src/App.tsx', content: 'export default () => null;' }],
      commitMessage: 'feat: push studio artifact',
      createPullRequest: true,
    });
    expect(ghRes.provider).toBe('github');
    expect(ghRes.commitUrl).toBe('https://github.com/Supremeai-bd/demo/commit/999');
    expect(ghRes.prUrl).toBe('https://github.com/Supremeai-bd/demo/pull/42');

    const glRes = await pushToGitLab({
      token: 'glpat_test456',
      project: 'team/app',
      host: 'https://gitlab.example.com',
      branch: 'main',
      files: [{ path: 'src/App.tsx', content: 'export default () => null;' }],
      commitMessage: 'feat: push studio artifact to gitlab',
      createMergeRequest: true,
    });
    expect(glRes.provider).toBe('gitlab');
    expect(glRes.commitUrl).toBe('https://gitlab.example.com/team/app/-/commit/777');
    expect(glRes.prUrl).toBe('https://gitlab.example.com/team/app/-/merge_requests/9');
  });
});

describe('Hybrid Web Vault: AES-256-GCM Encryption, Domain Isolation & Zero LLM Prompt Leakage', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = createMemoryStorage();
    useWorkspaceStore.getState().setBrowserActiveVaultId(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('parses HTTP Cookie strings and Playwright storageState JSON cleanly', () => {
    const fromCookieStr = parseSessionInputToCookies(
      'session_id=tok_abc; csrf=xyz_99',
      'github.com'
    );
    expect(fromCookieStr.cookieHeader).toBe('session_id=tok_abc; csrf=xyz_99');
    expect(fromCookieStr.cookies).toHaveLength(2);
    expect(fromCookieStr.cookies[0]).toMatchObject({
      name: 'session_id',
      value: 'tok_abc',
      domain: 'github.com',
    });

    const playwrightState = JSON.stringify({
      cookies: [
        { name: 'auth', value: 'pw_secret_42', domain: 'app.example.com', path: '/' },
        { name: 'theme', value: 'dark' },
      ],
    });
    const fromPlaywright = parseSessionInputToCookies(playwrightState, 'app.example.com');
    expect(fromPlaywright.cookieHeader).toBe('auth=pw_secret_42; theme=dark');
    expect(fromPlaywright.cookies).toHaveLength(2);
  });

  it('encrypts sessions & credentials with AES-256-GCM, enforces strict domain isolation, and prevents LLM prompt leakage', async () => {
    // Allow graceful degradation when /api/workspace/browser-vault is unreachable
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 404 })) as typeof fetch;

    const secretCookie = 'gh_sess=super_secret_cookie_value_991; _octo=GH1.1';
    const secretPassword = 'UltraSecretPassword!2026';

    const { entries: afterSession, created: sessionEntry } = await saveSessionSnapshot({
      url: 'https://github.com/settings/profile',
      rawSessionInput: secretCookie,
      label: 'GitHub Main',
    });
    expect(sessionEntry.domain).toBe('github.com');
    expect(sessionEntry.algorithm).toBe('AES-256-GCM');
    expect(afterSession).toHaveLength(1);

    const { entries: afterCreds, created: credEntry } = await saveDomainCredentials({
      url: 'https://gitlab.com/users/sign_in',
      username: 'engineer@supremeai.bd',
      password: secretPassword,
      label: 'GitLab Account',
    });
    expect(credEntry.domain).toBe('gitlab.com');
    expect(credEntry.usernameHint).toBe('e***@supremeai.bd');
    expect(afterCreds).toHaveLength(2);

    // Ensure raw secrets NEVER appear unencrypted in localStorage
    const rawStorage = localStorage.getItem(BROWSER_VAULT_STORAGE_KEY) || '';
    expect(rawStorage).not.toContain('super_secret_cookie_value_991');
    expect(rawStorage).not.toContain(secretPassword);

    // AES-256-GCM decryption round-trip succeeds
    const decSession = await decryptVaultPayload(sessionEntry);
    expect(decSession.cookieHeader).toBe(secretCookie);
    expect(decSession.storageState?.cookies).toHaveLength(2);

    const decCreds = await decryptVaultPayload(credEntry);
    expect(decCreds.username).toBe('engineer@supremeai.bd');
    expect(decCreds.password).toBe(secretPassword);

    // Strict Domain Isolation check
    expect(extractVaultDomain('https://github.com/orgs/Supremeai-bd')).toBe('github.com');
    expect(
      getVaultEntriesForUrl(afterCreds, 'https://github.com/issues').map((e) => e.domain)
    ).toEqual(['github.com']);
    expect(await resolveDomainSessionCookieHeader('https://github.com/pulls')).toBe(secretCookie);
    expect(await resolveDomainSessionCookieHeader('https://evil-github.com/pulls')).toBeNull();
    expect(await resolveDomainSessionCookieHeader('https://gitlab.com/dashboard')).toBeNull();

    // Zero LLM Prompt Leakage check
    const scheduledPrompt = buildScheduledAutomationPrompt({
      url: 'https://github.com/notifications',
      scheduleInstruction: 'Every midnight check unread alerts',
      entry: sessionEntry,
    });
    expect(scheduledPrompt).toContain(
      `[VAULT_SESSION_REF id="${sessionEntry.id}" domain="github.com" mode="session"]`
    );
    expect(scheduledPrompt).not.toContain('super_secret_cookie_value_991');
    expect(scheduledPrompt).not.toContain(secretPassword);

    // Delete entry works cleanly
    const remaining = await deleteVaultEntry(sessionEntry.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(credEntry.id);
  });

  it('forwards X-Vault-Cookie ONLY on matching isolated domains and captures Set-Cookie via Edge browser-proxy', async () => {
    await saveSessionSnapshot({
      url: 'https://portal.example.com/login',
      rawSessionInput: 'portal_sid=vault_token_123',
      label: 'Portal Session',
    });

    const recordedHeaders: Array<{ url: string; vaultCookie: string | null }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const reqUrl = String(input);
      const headers = new Headers(init?.headers);
      recordedHeaders.push({
        url: reqUrl,
        vaultCookie: headers.get('X-Vault-Cookie'),
      });
      return new Response(
        JSON.stringify({
          url: 'https://portal.example.com/dashboard',
          title: 'Dashboard',
          statusCode: 200,
          latencyMs: 18,
          html: '<html><body><h1>Authenticated</h1></body></html>',
          extractedLinks: [],
          textPreview: 'Authenticated',
          capturedCookieHeader: 'portal_sid=refreshed_777',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    await useWorkspaceStore.getState().navigateBrowser('https://portal.example.com/dashboard');
    expect(recordedHeaders[0]?.vaultCookie).toBe('portal_sid=vault_token_123');
    expect(useWorkspaceStore.getState().browserCapturedCookies).toBe('portal_sid=refreshed_777');

    await useWorkspaceStore.getState().navigateBrowser('https://other-site.org/home');
    expect(recordedHeaders[1]?.vaultCookie).toBeNull();

    // Verify Cloudflare Edge browser-proxy accepts X-Vault-Cookie & forwards Cookie upstream
    let upstreamCookieSeen: string | null = null;
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      upstreamCookieSeen = new Headers(init?.headers).get('Cookie');
      return new Response('<html><title>Vault Ok</title><body><p>Ready</p></body></html>', {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Set-Cookie': 'sid=edge_cookie_88; Path=/; HttpOnly',
        },
      });
    }) as typeof fetch;

    const edgeProxyRes = await browserProxyEdgeHandler({
      request: new Request(
        'https://supremeai.pages.dev/api/workspace/browser-proxy?url=https%3A%2F%2Fportal.example.com%2Fapp',
        { headers: { ...testSessionHeaders, 'X-Vault-Cookie': 'portal_sid=vault_token_123' } }
      ),
    });
    expect(upstreamCookieSeen).toBe('portal_sid=vault_token_123');
    const edgeProxyBody = (await edgeProxyRes.json()) as { capturedCookieHeader?: string };
    expect(edgeProxyBody.capturedCookieHeader).toBe('sid=edge_cookie_88');
  });

  it('stores, filters by domain without returning encrypted payloads, and deletes records in Edge browser-vault API', async () => {
    globalThis.fetch = vi.fn(mockEdgePreferences());
    const postRes = await browserVaultEdgeHandler({
      env: testEdgeEnv,
      request: new Request('https://supremeai.pages.dev/api/workspace/browser-vault', {
        method: 'POST',
        headers: { ...testSessionHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'vault_edge_1',
          domain: 'github.com',
          mode: 'session',
          label: 'GitHub Edge',
          cookieCount: 2,
          encryptedPayload: 'ciphertext_base64',
          iv: 'iv_base64',
          algorithm: 'AES-256-GCM',
        }),
      }),
    });
    expect(postRes.status).toBe(200);

    const getRes = await browserVaultEdgeHandler({
      env: testEdgeEnv,
      request: new Request(
        'https://supremeai.pages.dev/api/workspace/browser-vault?domain=github.com',
        { headers: testSessionHeaders }
      ),
    });
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      entries: Array<Record<string, unknown>>;
    };
    expect(getBody.entries).toHaveLength(1);
    expect(getBody.entries[0].id).toBe('vault_edge_1');
    expect(getBody.entries[0].hasEncryptedSecret).toBe(true);
    expect(getBody.entries[0].encryptedPayload).toBeUndefined();

    const delRes = await browserVaultEdgeHandler({
      env: testEdgeEnv,
      request: new Request(
        'https://supremeai.pages.dev/api/workspace/browser-vault?id=vault_edge_1',
        {
          method: 'DELETE',
          headers: testSessionHeaders,
        }
      ),
    });
    const delBody = (await delRes.json()) as { success: boolean };
    expect(delBody.success).toBe(true);
  });

  it('resolves credentials strictly per domain for In-Page Autofill and injects login bridge into Edge browser-proxy', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 404 })) as typeof fetch;

    const secretPass = 'AutofillSecret#2026';
    await saveDomainCredentials({
      url: 'https://portal.example.com/signin',
      username: 'dev@supremeai.bd',
      password: secretPass,
      label: 'Portal Login',
    });

    const resolved = await resolveDomainCredentialsForAutofill('https://portal.example.com/login');
    expect(resolved?.username).toBe('dev@supremeai.bd');
    expect(resolved?.password).toBe(secretPass);

    // Mismatched domain must be rejected
    expect(
      await resolveDomainCredentialsForAutofill('https://evil-portal.example.com/login')
    ).toBeNull();

    // Verify Edge browser-proxy injects login-form detector and autofill-credentials listener
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        '<html><head><title>Sign In</title></head><body><form><input type="email"/><input type="password"/></form></body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html' } }
      );
    }) as typeof fetch;

    const proxyRes = await browserProxyEdgeHandler({
      request: new Request(
        'https://supremeai.pages.dev/api/workspace/browser-proxy?url=https%3A%2F%2Fportal.example.com%2Flogin',
        { headers: testSessionHeaders }
      ),
    });
    const proxyJson = (await proxyRes.json()) as { html: string };
    expect(proxyJson.html).toContain('login-form-detected');
    expect(proxyJson.html).toContain('cookies-captured');
    expect(proxyJson.html).toContain('autofill-credentials');
    expect(proxyJson.html).toContain('autofill-applied');
  });

  it('supports encrypted vault backup export/import and cloud sync with newest-timestamp merge', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 404 })) as typeof fetch;

    setVaultCloudSyncEnabled(true);
    expect(loadVaultCloudSyncEnabled()).toBe(true);

    const { created } = await saveDomainCredentials({
      url: 'https://sync.example.com/auth',
      username: 'sync@supremeai.bd',
      password: 'SyncPassword!99',
      label: 'Sync Account',
    });

    // Exported JSON contains only ciphertext envelopes, never plaintext password
    const backupJson = exportEncryptedVaultBackup();
    expect(backupJson).not.toContain('SyncPassword!99');
    expect(backupJson).toContain(created.encryptedPayload);

    // Clear localStorage and restore from encrypted backup JSON
    localStorage.removeItem(BROWSER_VAULT_STORAGE_KEY);
    const { entries: importedEntries, importedCount } = importEncryptedVaultBackup(backupJson);
    expect(importedCount).toBe(1);
    expect(importedEntries[0].id).toBe(created.id);

    // Push & pull via Edge browser-vault ?includeEncrypted=1
    localStorage.setItem('supremeai_access_token', testSessionHeaders.Authorization.slice(7));
    const preferencesFetch = mockEdgePreferences();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'https://supremeai.pages.dev');
      if (url.origin === testEdgeEnv.SUPREMEAI_BACKEND_URL) return preferencesFetch(url, init);
      return browserVaultEdgeHandler({ request: new Request(url, init), env: testEdgeEnv });
    });

    const syncRes = await syncVaultWithCloud();
    expect(syncRes.ok).toBe(true);
    expect(syncRes.pushed).toBe(1);
    expect(syncRes.entries.some((e) => e.id === created.id)).toBe(true);
  });

  it('manages BrowserScheduledTask CRUD locally and via Edge browser-schedules API', async () => {
    localStorage.setItem('supremeai_access_token', testSessionHeaders.Authorization.slice(7));
    const preferencesFetch = mockEdgePreferences();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'https://supremeai.pages.dev');
      if (url.origin === testEdgeEnv.SUPREMEAI_BACKEND_URL) return preferencesFetch(url, init);
      return browserSchedulesEdgeHandler({ request: new Request(url, init), env: testEdgeEnv });
    });

    const { created: vaultEntry } = await saveSessionSnapshot({
      url: 'https://analytics.example.com',
      rawSessionInput: 'sid=sched_secret_token',
      label: 'Analytics Session',
    });

    expect(getDefaultCronForCadence('hourly')).toBe('0 * * * *');
    expect(getDefaultCronForCadence('daily')).toBe('0 8 * * *');
    expect(getDefaultCronForCadence('weekly')).toBe('0 9 * * 1');

    const { tasks, created: task } = await saveScheduledTask({
      title: 'Daily KPI Check',
      targetUrl: 'https://analytics.example.com/dashboard',
      entry: vaultEntry,
      cadence: 'daily',
      instruction: 'Summarize daily active users.',
    });
    expect(tasks).toHaveLength(1);
    expect(task.cronExpression).toBe('0 8 * * *');
    expect(task.enabled).toBe(true);

    const paused = await toggleScheduledTask(task.id);
    expect(paused[0].enabled).toBe(false);

    const ran = await markScheduledTaskRun(task.id, 'ok', 'HTTP 200 · Dashboard');
    expect(ran[0].lastRunStatus).toBe('ok');
    expect(ran[0].lastRunAt).not.toBeNull();

    // Verify Edge schedule list has persisted record
    const edgeGet = await browserSchedulesEdgeHandler({
      env: testEdgeEnv,
      request: new Request('https://supremeai.pages.dev/api/workspace/browser-schedules', {
        headers: testSessionHeaders,
      }),
    });
    const edgeList = (await edgeGet.json()) as { schedules: Array<{ id: string }> };
    expect(edgeList.schedules.some((s) => s.id === task.id)).toBe(true);

    const afterDel = await deleteScheduledTask(task.id);
    expect(afterDel).toEqual([]);
    expect(loadScheduledTasks()).toEqual([]);
  });
});

describe('Multi-Tab Virtual Browser & Git OAuth Helpers', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('creates, switches, navigates independently, and closes virtual browser tabs cleanly', async () => {
    const store = useWorkspaceStore.getState();
    // Reset to single fresh tab
    while (useWorkspaceStore.getState().browserTabs.length > 1) {
      useWorkspaceStore.getState().closeBrowserTab(useWorkspaceStore.getState().browserTabs[0].id);
    }
    store.resetBrowserHome();

    const firstTabId = useWorkspaceStore.getState().activeBrowserTabId;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      const isSecond = target.includes('second.example.org');
      return new Response(
        JSON.stringify({
          url: isSecond ? 'https://second.example.org' : 'https://first.example.com',
          title: isSecond ? 'Second Site' : 'First Site',
          statusCode: 200,
          latencyMs: 12,
          html: `<h1>${isSecond ? 'Second' : 'First'}</h1>`,
          extractedLinks: [],
          textPreview: isSecond ? 'Second' : 'First',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    await useWorkspaceStore.getState().navigateBrowser('https://first.example.com');
    expect(useWorkspaceStore.getState().browserTitle).toBe('First Site');

    // Open second tab and navigate
    useWorkspaceStore.getState().createBrowserTab();
    const secondTabId = useWorkspaceStore.getState().activeBrowserTabId;
    expect(secondTabId).not.toBe(firstTabId);
    expect(useWorkspaceStore.getState().browserTabs).toHaveLength(2);
    expect(useWorkspaceStore.getState().browserStatus).toBe('idle');

    await useWorkspaceStore.getState().navigateBrowser('https://second.example.org');
    expect(useWorkspaceStore.getState().browserTitle).toBe('Second Site');

    // Switch back to first tab and verify mirrored fields match first tab
    useWorkspaceStore.getState().switchBrowserTab(firstTabId);
    expect(useWorkspaceStore.getState().browserTitle).toBe('First Site');
    expect(useWorkspaceStore.getState().browserUrl).toBe('https://first.example.com');

    // Close second tab -> stays on first tab
    useWorkspaceStore.getState().closeBrowserTab(secondTabId);
    expect(useWorkspaceStore.getState().browserTabs).toHaveLength(1);
    expect(useWorkspaceStore.getState().browserTitle).toBe('First Site');

    // Closing the last remaining tab resets to clean New Tab instead of empty array
    useWorkspaceStore.getState().closeBrowserTab(firstTabId);
    expect(useWorkspaceStore.getState().browserTabs).toHaveLength(1);
    expect(useWorkspaceStore.getState().browserStatus).toBe('idle');
    expect(useWorkspaceStore.getState().browserUrl).toBe('');
  });

  it('validates OAuth message origins and gracefully degrades when OAuth status endpoint is unavailable', async () => {
    expect(isTrustedOAuthMessageOrigin('https://ais-dev-abc.asia-northeast1.run.app')).toBe(true);
    expect(isTrustedOAuthMessageOrigin('http://localhost:3000')).toBe(true);
    expect(isTrustedOAuthMessageOrigin('https://evil-attacker.com')).toBe(false);

    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 404 })) as typeof fetch;
    const offlineStatus = await fetchGitOAuthStatus();
    expect(offlineStatus.githubConfigured).toBe(false);
    expect(offlineStatus.gitlabConfigured).toBe(false);
    expect(offlineStatus.githubCallbackUrl).toContain('/api/git/oauth/github/callback');
    expect(offlineStatus.gitlabCallbackUrl).toContain('/api/git/oauth/gitlab/callback');
  });

  it('triggers Chrome-style Save Password prompt decisions, respects Never-Save list, and injects form submit capture bridge', async () => {
    localStorage.removeItem(BROWSER_VAULT_STORAGE_KEY);
    localStorage.removeItem(BROWSER_NEVER_SAVE_DOMAINS_KEY);
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 404 })) as typeof fetch;

    // Fresh site login -> prompt 'new'
    expect(
      await shouldPromptSaveSubmittedPassword({
        urlOrDomain: 'https://bank.example.com/login',
        username: 'user@example.com',
        password: 'FirstPassword1!',
      })
    ).toBe('new');

    // Save credentials -> identical submission should 'skip', changed password should 'update'
    await saveDomainCredentials({
      url: 'https://bank.example.com',
      username: 'user@example.com',
      password: 'FirstPassword1!',
    });

    expect(
      await shouldPromptSaveSubmittedPassword({
        urlOrDomain: 'https://bank.example.com',
        username: 'user@example.com',
        password: 'FirstPassword1!',
      })
    ).toBe('skip');

    expect(
      await shouldPromptSaveSubmittedPassword({
        urlOrDomain: 'https://bank.example.com',
        username: 'user@example.com',
        password: 'UpdatedPassword2@',
      })
    ).toBe('update');

    // Mark site as "Never save" -> always 'skip'
    markDomainNeverSave('https://bank.example.com');
    expect(isDomainNeverSaved('bank.example.com')).toBe(true);
    expect(
      await shouldPromptSaveSubmittedPassword({
        urlOrDomain: 'https://bank.example.com',
        username: 'another@example.com',
        password: 'SecretPassword!',
      })
    ).toBe('skip');

    clearDomainNeverSave('bank.example.com');
    expect(isDomainNeverSaved('bank.example.com')).toBe(false);

    // Edge browser-proxy HTML injects login-credentials-submitted bridge
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        '<html><body><form method="post"><input name="email" type="email"/><input type="password"/><button type="submit">Log in</button></form></body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html' } }
      );
    }) as typeof fetch;

    const proxyRes = await browserProxyEdgeHandler({
      request: new Request(
        'https://supremeai.pages.dev/api/workspace/browser-proxy?url=https%3A%2F%2Fbank.example.com%2Flogin',
        { headers: testSessionHeaders }
      ),
    });
    const proxyJson = (await proxyRes.json()) as { html: string };
    expect(proxyJson.html).toContain('login-credentials-submitted');
  });

  it('parses EN/BN natural-language and AI schedule blocks, and saves direct public schedules', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 404 })) as typeof fetch;

    expect(hasSchedulingIntent('Please check github.com daily at 9 AM')).toBe(true);
    expect(hasSchedulingIntent('প্রতিদিন সকাল ৯টায় bbc.com চেক করো')).toBe(true);
    expect(hasSchedulingIntent('Explain photosynthesis briefly')).toBe(false);

    const enParsed = parseNaturalLanguageSchedule(
      'Schedule daily at 9 AM check on github.com/trending'
    );
    expect(enParsed?.domain).toBe('github.com');
    expect(enParsed?.cadence).toBe('daily');
    expect(enParsed?.cronExpression).toBe('0 9 * * *');

    const bnParsed = parseNaturalLanguageSchedule('প্রতিদিন bbc.com এ গিয়ে হেডলাইন সামারি দাও');
    expect(bnParsed?.domain).toBe('bbc.com');
    expect(bnParsed?.cadence).toBe('daily');

    const aiBlocks = parseAiScheduleBlocks(
      'Sure, I scheduled that!\n```supreme-schedule\n{"title":"Morning News","url":"https://news.ycombinator.com","cadence":"hourly","cron":"0 * * * *","instruction":"Summarize top 5 stories"}\n```'
    );
    expect(aiBlocks).toHaveLength(1);
    expect(aiBlocks[0].domain).toBe('news.ycombinator.com');
    expect(aiBlocks[0].cadence).toBe('hourly');

    // Direct saveScheduledTask without requiring an explicit vault entry
    const { created } = await saveScheduledTask({
      title: aiBlocks[0].title,
      targetUrl: aiBlocks[0].targetUrl,
      cadence: aiBlocks[0].cadence,
      cronExpression: aiBlocks[0].cronExpression,
      instruction: aiBlocks[0].instruction,
    });
    expect(created.vaultEntryId).toBe('public');

    // Workspace store supports switching directly to top-level schedule tab
    useWorkspaceStore.getState().setActiveDockTab('schedule');
    expect(useWorkspaceStore.getState().activeDockTab).toBe('schedule');

    // Clean up created task
    await deleteScheduledTask(created.id);
  });

  it('sends Chrome Sec-Fetch navigation headers and falls back to m.facebook.com on Meta 400/403', async () => {
    const capturedCalls: Array<{ url: string; headers: Record<string, string> }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const targetUrl = String(input);
      const headers = (init?.headers || {}) as Record<string, string>;
      capturedCalls.push({ url: targetUrl, headers });
      if (targetUrl.includes('fb.com')) {
        return new Response(
          '<html><title>Error</title><body>Sorry, something went wrong.</body></html>',
          {
            status: 400,
            headers: { 'Content-Type': 'text/html' },
          }
        );
      }
      return new Response(
        '<html><title>Facebook</title><body><form><input name="email"/><input type="password"/></form></body></html>',
        {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }
      );
    }) as typeof fetch;

    const proxyRes = await browserProxyEdgeHandler({
      request: new Request(
        'https://supremeai.pages.dev/api/workspace/browser-proxy?url=https%3A%2F%2Ffb.com%2F',
        { headers: testSessionHeaders }
      ),
    });
    expect(proxyRes.status).toBe(200);
    const body = (await proxyRes.json()) as { statusCode: number; title: string };
    expect(capturedCalls).toHaveLength(2);
    expect(capturedCalls[0].headers['Sec-Fetch-Mode']).toBe('navigate');
    expect(capturedCalls[0].headers['Sec-Fetch-Dest']).toBe('document');
    expect(capturedCalls[0].headers['Upgrade-Insecure-Requests']).toBe('1');
    expect(capturedCalls[1].url).toContain('m.facebook.com');
    expect(body.statusCode).toBe(200);
    expect(body.title).toBe('Facebook');
  });

  it('merges live per-domain session cookies and detects Google/Gmail strict-auth URLs', () => {
    clearDomainLiveCookies();
    expect(mergeCookieHeaders('a=1; b=2', 'b=99; c=3')).toBe('a=1; b=99; c=3');
    expect(mergeCookieHeaders('a=1; b=2', 'a=deleted')).toBe('b=2');

    setDomainLiveCookies('https://example.com/login', 'csrftoken=abc123; theme=dark');
    setDomainLiveCookies('https://app.example.com/auth', 'sessionid=xyz789; csrftoken=def456');
    const appCookies = getDomainLiveCookies('https://app.example.com/dashboard');
    expect(appCookies).toContain('theme=dark');
    expect(appCookies).toContain('sessionid=xyz789');
    expect(appCookies).toContain('csrftoken=def456');

    expect(isGoogleStrictAuthUrl('https://accounts.google.com/v3/signin')).toBe(true);
    expect(isGoogleStrictAuthUrl('https://mail.google.com/mail/u/0')).toBe(true);
    expect(isGoogleStrictAuthUrl('https://gmail.com')).toBe(true);
    expect(isGoogleStrictAuthUrl('https://github.com/login')).toBe(false);
    clearDomainLiveCookies();
  });

  it('proxies POST form submissions and fetch/XHR RPC calls with Set-Cookie capture', async () => {
    const upstreamRequests: Array<{
      url: string;
      method: string;
      cookie: string;
      body?: string;
    }> = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const targetUrl = String(input);
      const headers = (init?.headers || {}) as Record<string, string>;
      upstreamRequests.push({
        url: targetUrl,
        method: String(init?.method || 'GET'),
        cookie: headers.Cookie || headers.cookie || '',
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      if (targetUrl.includes('/api/session')) {
        return new Response(JSON.stringify({ authenticated: true, user: 'demo' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': 'api_tok=sec999; Path=/; HttpOnly',
          },
        });
      }
      return new Response('<html><title>Dashboard</title><body>Welcome back</body></html>', {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Set-Cookie': 'sid=logged_in_42; Path=/; HttpOnly',
        },
      });
    }) as typeof fetch;

    const formRes = await browserProxyEdgeHandler({
      request: new Request('https://supremeai.pages.dev/api/workspace/browser-proxy', {
        method: 'POST',
        headers: { ...testSessionHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://portal.example.com/login',
          method: 'POST',
          contentType: 'application/x-www-form-urlencoded;charset=UTF-8',
          body: 'user=alice&pass=secret',
          cookie: 'csrf=init01',
          mode: 'navigate',
        }),
      }),
    });
    expect(formRes.status).toBe(200);
    const formJson = (await formRes.json()) as {
      title: string;
      html: string;
      capturedCookieHeader?: string;
    };
    expect(formJson.title).toBe('Dashboard');
    expect(formJson.capturedCookieHeader).toContain('sid=logged_in_42');
    expect(formJson.html).toContain('proxy-rpc');
    expect(formJson.html).toContain('submit-form');
    expect(upstreamRequests[0].method).toBe('POST');
    expect(upstreamRequests[0].cookie).toBe('csrf=init01');
    expect(upstreamRequests[0].body).toBe('user=alice&pass=secret');

    const rpcRes = await browserProxyEdgeHandler({
      request: new Request('https://supremeai.pages.dev/api/workspace/browser-proxy', {
        method: 'POST',
        headers: { ...testSessionHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://portal.example.com/api/session',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ping: true }),
          cookie: 'sid=logged_in_42',
          mode: 'rpc',
        }),
      }),
    });
    expect(rpcRes.status).toBe(200);
    const rpcJson = (await rpcRes.json()) as {
      ok: boolean;
      status: number;
      body: string;
      capturedCookieHeader?: string;
    };
    expect(rpcJson.ok).toBe(true);
    expect(rpcJson.status).toBe(200);
    expect(JSON.parse(rpcJson.body)).toEqual({ authenticated: true, user: 'demo' });
    expect(rpcJson.capturedCookieHeader).toContain('api_tok=sec999');
  });

  it('seals Gmail OAuth tokens in HttpOnly cookies and restores sessions across reloads without localStorage tokens', async () => {
    const secret = 'test-gmail-session-secret-key';
    const sealed = await sealGmailSessionCookie(
      {
        accessToken: 'ya29.test_gmail_access_token_xyz',
        uid: 'firebase-uid-123',
        email: 'member@example.com',
        exp: Date.now() + 300_000,
      },
      secret
    );
    expect(sealed).toBeTruthy();

    const unsealed = await unsealGmailSessionCookie(sealed!, secret);
    expect(unsealed).not.toBeNull();
    expect(unsealed?.accessToken).toBe('ya29.test_gmail_access_token_xyz');
    expect(unsealed?.uid).toBe('firebase-uid-123');
    expect(unsealed?.email).toBe('member@example.com');

    // Wrong secret or expired token is rejected cleanly
    expect(await unsealGmailSessionCookie(sealed!, 'wrong-secret')).toBeNull();
    const expiredCookie = await sealGmailSessionCookie(
      {
        accessToken: 'ya29.expired',
        uid: 'u1',
        email: 'a@b.com',
        exp: Date.now() - 10_000,
      },
      secret
    );
    expect(await unsealGmailSessionCookie(expiredCookie!, secret)).toBeNull();

    // HTTPS cross-origin preview uses SameSite=None; Secure; Partitioned while HTTP localhost uses SameSite=Lax
    const httpsCookie = buildGmailSessionSetCookie(sealed!, 300, true);
    expect(httpsCookie).toContain('HttpOnly');
    expect(httpsCookie).toContain('SameSite=None');
    expect(httpsCookie).toContain('Secure');
    expect(httpsCookie).toContain('Partitioned');
    expect(buildGmailSessionSetCookie(sealed!, 300, false)).toContain('SameSite=Lax');

    // Edge /api/workspace/gmail-session POST -> GET -> mismatch UID -> DELETE flow
    const env = { GMAIL_SESSION_SECRET: secret };
    const postRes = await gmailSessionEdgeHandler({
      request: new Request('https://supremeai.pages.dev/api/workspace/gmail-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: 'ya29.restorable_token_999',
          uid: 'user-77',
          email: 'inbox@example.com',
        }),
      }),
      env,
    });
    expect(postRes.status).toBe(200);
    const setCookieHeader = postRes.headers.get('set-cookie') || '';
    expect(setCookieHeader).toContain(`${GMAIL_SESSION_COOKIE_NAME}=`);
    expect(setCookieHeader).toContain('HttpOnly');

    const cookieValue = setCookieHeader.split(';')[0];
    expect(parseCookieFromHeader(cookieValue, GMAIL_SESSION_COOKIE_NAME)).toBeTruthy();

    const getRes = await gmailSessionEdgeHandler({
      request: new Request('https://supremeai.pages.dev/api/workspace/gmail-session?uid=user-77', {
        method: 'GET',
        headers: { cookie: cookieValue },
      }),
      env,
    });
    expect(getRes.status).toBe(200);
    const getJson = (await getRes.json()) as {
      authenticated: boolean;
      accessToken: string;
      email: string;
      uid: string;
    };
    expect(getJson.authenticated).toBe(true);
    expect(getJson.accessToken).toBe('ya29.restorable_token_999');
    expect(getJson.email).toBe('inbox@example.com');

    const wrongUidRes = await gmailSessionEdgeHandler({
      request: new Request(
        'https://supremeai.pages.dev/api/workspace/gmail-session?uid=other-user',
        {
          method: 'GET',
          headers: { cookie: cookieValue },
        }
      ),
      env,
    });
    expect(wrongUidRes.status).toBe(401);

    const delRes = await gmailSessionEdgeHandler({
      request: new Request('https://supremeai.pages.dev/api/workspace/gmail-session', {
        method: 'DELETE',
      }),
      env,
    });
    expect(delRes.status).toBe(200);
    expect(delRes.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('persists workspace browser tabs across reloads and skips proxy requests for Gmail strict-auth URLs', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('browser-proxy should not be called for Gmail strict-auth URLs');
    });
    globalThis.fetch = fetchSpy as typeof fetch;

    localStorage.removeItem(WORKSPACE_BROWSER_STATE_STORAGE_KEY);
    const store = useWorkspaceStore.getState();
    store.setDockOpen(true);
    store.setActiveDockTab('browser');
    await store.navigateBrowser('https://mail.google.com/mail/u/0');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().browserStatus).toBe('loaded');
    expect(useWorkspaceStore.getState().browserTitle).toBe('Gmail');
    expect(useWorkspaceStore.getState().browserUrl).toBe('https://mail.google.com/mail/u/0');

    // Persisted snapshot restores dock + Gmail tab without exposing any OAuth tokens
    const rawSaved = localStorage.getItem(WORKSPACE_BROWSER_STATE_STORAGE_KEY) || '';
    expect(rawSaved).toContain('mail.google.com');
    expect(rawSaved).not.toContain('ya29.');

    const hydrated = loadPersistedWorkspaceBrowserState();
    expect(hydrated.isDockOpen).toBe(true);
    expect(hydrated.activeDockTab).toBe('browser');
    expect(hydrated.browserTabs.some((t) => t.url === 'https://mail.google.com/mail/u/0')).toBe(
      true
    );
    const gmailTab = hydrated.browserTabs.find((t) => t.url === 'https://mail.google.com/mail/u/0');
    expect(gmailTab?.status).toBe('loaded');

    // Clean up store & storage state
    useWorkspaceStore.getState().resetBrowserHome();
    useWorkspaceStore.getState().setDockOpen(false);
    localStorage.removeItem(WORKSPACE_BROWSER_STATE_STORAGE_KEY);
  });

  it('safely renders non-browser languages (bash, java, python), data formats, and TypeScript without JS SyntaxError', () => {
    expect(classifyCodeLanguage('tsx')).toBe('visual');
    expect(classifyCodeLanguage('typescript')).toBe('script');
    expect(classifyCodeLanguage('json')).toBe('data');
    expect(classifyCodeLanguage('bash')).toBe('non-browser');
    expect(classifyCodeLanguage('java')).toBe('non-browser');
    expect(isPreviewableCodeLanguage('html')).toBe(true);
    expect(isPreviewableCodeLanguage('java')).toBe(false);
    expect(isShellCommandLanguage('bash')).toBe(true);
    expect(isShellCommandLanguage('java')).toBe(false);

    // Bash command like javac HelloWorld.java must NEVER be evaluated inside a JS script block
    const bashDoc = buildSandboxSrcDoc('javac HelloWorld.java\njava HelloWorld', 'bash', true);
    expect(bashDoc).toContain('CLI / Server Runtime');
    expect(bashDoc).toContain('javac HelloWorld.java');
    expect(bashDoc).not.toContain('JS Console Output');
    expect(bashDoc).not.toContain('(0, eval)');

    // Java class must render as safe source card rather than browser JS eval
    const javaDoc = buildSandboxSrcDoc(
      'public class HelloWorld { public static void main(String[] a) {} }',
      'java',
      true
    );
    expect(javaDoc).toContain('CLI / Server Runtime');
    expect(javaDoc).toContain('public class HelloWorld');
    expect(javaDoc).not.toContain('(0, eval)');

    // JSON renders formatted inspector without eval
    const jsonDoc = buildSandboxSrcDoc('{"app":"SupremeAI","ok":true}', 'json', false);
    expect(jsonDoc).toContain('JSON INSPECTOR');
    expect(jsonDoc).toContain('Valid JSON');
    expect(jsonDoc).not.toContain('(0, eval)');

    // TypeScript transpiles via Babel typescript preset instead of crashing on type annotations
    const tsDoc = buildSandboxSrcDoc('const count: number = 42;\nconsole.log(count);', 'ts', true);
    expect(tsDoc).toContain('TS Console Output');
    expect(tsDoc).toContain("presets: ['typescript']");
  });

  it('handles Cloudflare Pages HTML SPA fallback safely in browserService and parses proxy status in Terminal ping', async () => {
    const { browserService } = await import('../services/browserService');
    const { executeClientFallbackCommand } =
      await import('../components/workspace/WorkspaceTerminalTab');

    // Simulate Cloudflare Pages returning 200 text/html SPA fallback for /api/workspace/files
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('<!DOCTYPE html><html><body>SPA</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(browserService.listWorkspaceFiles()).resolves.toEqual([]);
    await expect(browserService.readWorkspaceFile('package.json')).rejects.toThrow(
      /local Node backend/i
    );

    // Terminal ping should extract upstream statusCode from JSON proxy response
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ statusCode: 429, latencyMs: 120 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const ping429 = await executeClientFallbackCommand('ping https://example.com', [], false);
    expect(ping429.stdout).toContain('HTTP 429');
    expect(ping429.stderr).toBe('');

    // Verify sandbox tab routing preserves isolated buffers
    useWorkspaceStore.getState().loadCodeIntoWorkspace('<h1>UI</h1>', 'html', 'preview');
    useWorkspaceStore
      .getState()
      .loadCodeIntoWorkspace('console.log("ok")', 'javascript', 'sandbox', true);
    const st = useWorkspaceStore.getState();
    expect(st.activeDockTab).toBe('sandbox');
    expect(st.sandboxCode).toBe('console.log("ok")');
    expect(st.previewCode).toBe('<h1>UI</h1>');
  });
});
