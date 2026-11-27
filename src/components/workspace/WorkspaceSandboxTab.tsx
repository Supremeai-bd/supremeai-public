import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Square,
  RotateCcw,
  Trash2,
  ShieldCheck,
  Terminal,
  Eye,
  Columns,
  Sparkles,
  Copy,
  Check,
  Clock,
  AlertTriangle,
  FilePlus2,
  BookmarkPlus,
  X,
} from 'lucide-react';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { EXTERNAL_URLS } from '../../config/externalUrls';
import { useI18n } from '../../utils/i18n';
import {
  resolveSandboxLanguage as normalizeSandboxLang,
  SANDBOX_RUNTIME_LABELS,
  type SandboxRuntime,
} from '../../utils/sandboxLanguage';

type OutputViewMode = 'console' | 'dom' | 'split';

interface SandboxLogEntry {
  id: string;
  level: 'log' | 'info' | 'warn' | 'error' | 'result' | 'system';
  text: string;
  timestamp: string;
}

export interface SavedSandboxSnippet {
  id: string;
  name: string;
  lang: SandboxRuntime;
  code: string;
  updatedAt: string;
}

export const SANDBOX_SNIPPETS_STORAGE_KEY = 'supremeai_sandbox_snippets_v1';
const SANDBOX_TIMEOUT_MS = 4500;

export function loadSavedSandboxSnippets(): SavedSandboxSnippet[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SANDBOX_SNIPPETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is SavedSandboxSnippet =>
        Boolean(s) &&
        typeof s.id === 'string' &&
        typeof s.name === 'string' &&
        typeof s.code === 'string'
    );
  } catch {
    return [];
  }
}

export function saveSandboxSnippet(
  list: SavedSandboxSnippet[],
  name: string,
  lang: SandboxRuntime,
  code: string
): SavedSandboxSnippet[] {
  const cleanName = name.trim().slice(0, 48) || `Snippet ${list.length + 1}`;
  const existingIdx = list.findIndex((s) => s.name.toLowerCase() === cleanName.toLowerCase());
  const nextItem: SavedSandboxSnippet = {
    id:
      existingIdx >= 0
        ? list[existingIdx].id
        : `sbx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    lang,
    code,
    updatedAt: new Date().toISOString(),
  };
  const next =
    existingIdx >= 0
      ? list.map((item, i) => (i === existingIdx ? nextItem : item))
      : [nextItem, ...list.slice(0, 24)];
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(SANDBOX_SNIPPETS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  }
  return next;
}

export function deleteSandboxSnippet(
  list: SavedSandboxSnippet[],
  id: string
): SavedSandboxSnippet[] {
  const next = list.filter((s) => s.id !== id);
  if (typeof localStorage === 'undefined') return next;
  try {
    localStorage.setItem(SANDBOX_SNIPPETS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
  return next;
}

const STARTER_TEMPLATES: Array<{ label: string; lang: SandboxRuntime; code: string }> = [
  {
    label: 'SupremeJS',
    lang: 'javascript',
    code: `// Isolated sandbox="allow-scripts" VM · Safe local computation
const routes = [
  { slug: 'supreme-spark', tier: 'fast', weight: 1 },
  { slug: 'supreme-core', tier: 'balanced', weight: 2 },
  { slug: 'supreme-reason', tier: 'deep', weight: 3 },
];

const totalWeight = routes.reduce((sum, r) => sum + r.weight, 0);
console.info('Evaluated SupremeAI profiles:', routes.length);
console.log('Total routing weight:', totalWeight);
console.table(routes);`,
  },
  {
    label: 'TypeScript',
    lang: 'typescript',
    code: `interface TaskNode {
  id: string;
  weight: number;
  status: 'ready' | 'done';
}

const queue: TaskNode[] = [
  { id: 'vec-index', weight: 4, status: 'done' },
  { id: 'ast-parse', weight: 7, status: 'ready' },
];

const score = (items: TaskNode[]): number =>
  items.reduce((acc, item) => acc + item.weight, 0);

console.log('Total pipeline weight:', score(queue));
console.log('Pending tasks:', queue.filter((t) => t.status === 'ready'));`,
  },
  {
    label: 'React UI',
    lang: 'tsx',
    code: `export default function EphemeralCounter() {
  const [count, setCount] = useState(0);
  return (
    <div className="p-4 rounded-xl border border-cyan-500/30 bg-slate-900 text-slate-100 space-y-3">
      <div className="text-xs font-mono text-cyan-400">Ephemeral React Sandbox</div>
      <div className="text-lg font-bold">Count: {count}</div>
      <button
        onClick={() => {
          console.log('Incremented counter to', count + 1);
          setCount((c) => c + 1);
        }}
        className="px-3 py-1.5 rounded-lg bg-cyan-500 text-slate-950 font-semibold text-xs cursor-pointer"
      >
        Increment State
      </button>
    </div>
  );
}`,
  },
  {
    label: 'HTML Card',
    lang: 'html',
    code: `<div class="p-4 rounded-xl border border-emerald-500/30 bg-slate-900 text-slate-100 space-y-2">
  <h2 class="text-sm font-bold text-emerald-400">Sandboxed DOM Fragment</h2>
  <p class="text-xs text-slate-300">Rendered with Tailwind inside an isolated ephemeral frame.</p>
  <button onclick="console.log('DOM button clicked at ' + new Date().toLocaleTimeString())"
    class="mt-1 px-3 py-1 rounded-lg bg-emerald-500 text-slate-950 text-xs font-semibold">
    Emit Console Event
  </button>
</div>`,
  },
];

function escapeScriptClose(code: string): string {
  return code.replace(/<\/script>/gi, '<\\/script>');
}

function buildEphemeralSandboxHtml(
  code: string,
  runtime: SandboxRuntime,
  runId: string,
  darkMode: boolean
): string {
  const trimmed = code.trim();
  const escapedCode = escapeScriptClose(trimmed);
  const bodyTone = darkMode
    ? 'background:#070b12;color:#e2e8f0;'
    : 'background:#f8fafc;color:#0f172a;';

  const bridgeScript = `
    <script>
      (function() {
        var RUN_ID = ${JSON.stringify(runId)};
        var START = performance.now();
        function safeSerialize(val, depth) {
          if (depth === void 0) depth = 0;
          if (val === null) return 'null';
          if (val === undefined) return 'undefined';
          if (typeof val === 'string') return val;
          if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') return String(val);
          if (typeof val === 'symbol') return val.toString();
          if (typeof val === 'function') return '[Function: ' + (val.name || 'anonymous') + ']';
          if (val instanceof Error) return val.name + ': ' + val.message;
          if (depth > 3) return '[Object]';
          try {
            return JSON.stringify(val, null, 2);
          } catch (e) {
            return String(val);
          }
        }
        function emit(type, payload) {
          try {
            window.parent.postMessage({
              channel: 'supremeai-sandbox',
              runId: RUN_ID,
              type: type,
              durationMs: Math.round((performance.now() - START) * 100) / 100,
              payload: payload
            }, '*');
          } catch (_) { /* cross-origin frame may be torn down; nothing actionable */ }
        }
        window.__SANDBOX_EMIT__ = emit;
        window.__SANDBOX_SERIALIZE__ = safeSerialize;

        ['log', 'info', 'warn', 'error'].forEach(function(level) {
          var orig = console[level];
          console[level] = function() {
            var parts = [];
            for (var i = 0; i < arguments.length; i++) {
              parts.push(safeSerialize(arguments[i]));
            }
            emit('console', { level: level, text: parts.join(' ') });
            if (typeof orig === 'function') {
              try { orig.apply(console, arguments); } catch (_) { /* cross-origin frame may be torn down; nothing actionable */ }
            }
          };
        });
        console.table = function(data) {
          emit('console', { level: 'log', text: safeSerialize(data) });
        };

        window.addEventListener('error', function(ev) {
          emit('console', {
            level: 'error',
            text: (ev.error && ev.error.stack) ? ev.error.stack : (ev.message || 'Runtime error')
          });
          emit('done', { ok: false });
        });

        window.addEventListener('unhandledrejection', function(ev) {
          emit('console', {
            level: 'error',
            text: 'Unhandled Promise Rejection: ' + safeSerialize(ev.reason)
          });
          emit('done', { ok: false });
        });
      })();
    </script>
  `;

  if (runtime === 'html') {
    const hasDocShell = /^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed);
    if (hasDocShell) {
      // Inject bridge safely right after <head> or at start
      if (/<head[^>]*>/i.test(trimmed)) {
        return (
          trimmed.replace(/<head([^>]*)>/i, `<head$1>${bridgeScript}`) +
          `<script>window.__SANDBOX_EMIT__('done',{ok:true});</script>`
        );
      }
      return `${bridgeScript}${trimmed}<script>window.__SANDBOX_EMIT__('done',{ok:true});</script>`;
    }

    return `<!DOCTYPE html>
<html class="${darkMode ? 'dark' : ''}">
<head>
  <meta charset="UTF-8" />
  <script src="${EXTERNAL_URLS.tailwindCdn}"></script>
  <style>body{margin:0;padding:14px;font-family:system-ui,-apple-system,sans-serif;${bodyTone}}</style>
  ${bridgeScript}
</head>
<body>
  <div id="sandbox-root">${trimmed}</div>
  <script>
    window.addEventListener('load', function() {
      window.__SANDBOX_EMIT__('done', { ok: true });
    });
  </script>
</body>
</html>`;
  }

  if (runtime === 'tsx' || runtime === 'typescript') {
    const cleanedCode = escapeScriptClose(
      trimmed
        .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
        .replace(/^import\s+['"][^'"]+['"];?\s*$/gm, '')
        .replace(/export\s+default\s+/g, 'const __DefaultExport__ = ')
        .replace(/export\s+(const|let|var|function|class|type|interface)\s+/g, '$1 ')
    );

    return `<!DOCTYPE html>
<html class="${darkMode ? 'dark' : ''}">
<head>
  <meta charset="UTF-8" />
  <script src="${EXTERNAL_URLS.tailwindCdn}"></script>
  <script crossorigin src="${EXTERNAL_URLS.umdReact18}"></script>
  <script crossorigin src="${EXTERNAL_URLS.umdReactDom18}"></script>
  <script src="${EXTERNAL_URLS.babelStandaloneCdn}"></script>
  <style>body{margin:0;padding:14px;font-family:system-ui,-apple-system,sans-serif;${bodyTone}}</style>
  ${bridgeScript}
</head>
<body>
  <div id="sandbox-root"></div>
  <script>
    window.addEventListener('load', function() {
      try {
        if (typeof Babel === 'undefined') {
          throw new Error('Transpiler runtime unavailable offline.');
        }
        var rawSource = ${JSON.stringify(cleanedCode)};
        var wrapped = 'const { useState, useEffect, useRef, useMemo, useCallback } = React;\\n' + rawSource + '\\n' +
          'if (typeof __DefaultExport__ !== "undefined" && typeof ReactDOM !== "undefined") { ReactDOM.createRoot(document.getElementById("sandbox-root")).render(React.createElement(__DefaultExport__)); }';
        var compiled = Babel.transform(wrapped, { presets: ['react', 'typescript'] }).code;
        var fn = new Function(compiled);
        var ret = fn();
        if (ret !== undefined) {
          window.__SANDBOX_EMIT__('console', { level: 'result', text: window.__SANDBOX_SERIALIZE__(ret) });
        }
        window.__SANDBOX_EMIT__('done', { ok: true });
      } catch (err) {
        window.__SANDBOX_EMIT__('console', { level: 'error', text: (err && err.stack) ? err.stack : String(err) });
        window.__SANDBOX_EMIT__('done', { ok: false });
      }
    });
  </script>
</body>
</html>`;
  }

  // Plain JavaScript isolated execution
  return `<!DOCTYPE html>
<html class="${darkMode ? 'dark' : ''}">
<head>
  <meta charset="UTF-8" />
  <style>body{margin:0;padding:14px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;${bodyTone}}</style>
  ${bridgeScript}
</head>
<body>
  <div id="sandbox-root"></div>
  <script>
    (async function() {
      try {
        const AsyncFn = Object.getPrototypeOf(async function(){}).constructor;
        const runnable = new AsyncFn('root', ${JSON.stringify(
          escapedCode.replace(/export\s+default\s+/g, '').replace(/export\s+/g, '')
        )});
        const res = await runnable(document.getElementById('sandbox-root'));
        if (res !== undefined) {
          window.__SANDBOX_EMIT__('console', { level: 'result', text: window.__SANDBOX_SERIALIZE__(res) });
        }
        window.__SANDBOX_EMIT__('done', { ok: true });
      } catch (err) {
        window.__SANDBOX_EMIT__('console', { level: 'error', text: (err && err.stack) ? err.stack : String(err) });
        window.__SANDBOX_EMIT__('done', { ok: false });
      }
    })();
  </script>
</body>
</html>`;
}

export const WorkspaceSandboxTab: React.FC = () => {
  const {
    sandboxCode,
    sandboxLang,
    sandboxRevision,
    previewDarkMode,
    sandboxAutoRunNonce,
    updateSandboxCode,
    clearSandboxCode,
  } = useWorkspaceStore();

  const { t } = useI18n();

  const [codeDraft, setCodeDraft] = useState(sandboxCode);
  const [selectedLang, setSelectedLang] = useState<string>(sandboxLang || 'javascript');
  const [viewMode, setViewMode] = useState<OutputViewMode>('split');
  const [logs, setLogs] = useState<SandboxLogEntry[]>([
    {
      id: 'sbx-init',
      level: 'system',
      text: 'Ephemeral VM ready · Strict sandbox="allow-scripts" (no cookies/DOM/storage access).',
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const [isRunning, setIsRunning] = useState(false);
  const [lastDurationMs, setLastDurationMs] = useState<number | null>(null);
  const [vmRevision, setVmRevision] = useState(0);
  const [activeSrcDoc, setActiveSrcDoc] = useState('');
  const [copied, setCopied] = useState(false);
  const [savedSnippets, setSavedSnippets] = useState<SavedSandboxSnippet[]>(() =>
    loadSavedSandboxSnippets()
  );
  const [isSavingSnippet, setIsSavingSnippet] = useState(false);
  const [snippetName, setSnippetName] = useState('');

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const activeRunIdRef = useRef<string>('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHandledAutoRunRef = useRef<number>(0);

  // Sync draft only when external load ("Run in Sandbox") or clear increments sandboxRevision
  useEffect(() => {
    setCodeDraft(sandboxCode);
    setSelectedLang(sandboxLang || 'javascript');
  }, [sandboxRevision, sandboxCode, sandboxLang]);

  const appendLog = useCallback((level: SandboxLogEntry['level'], text: string) => {
    setLogs((prev) => [
      ...prev.slice(-150),
      {
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        level,
        text,
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
  }, []);

  const stopExecution = useCallback(
    (reason?: string) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      activeRunIdRef.current = '';
      setActiveSrcDoc('');
      setIsRunning(false);
      if (reason) {
        appendLog('warn', reason);
      }
    },
    [appendLog]
  );

  // Listen for sandboxed iframe messages strictly matched by iframe source & runId
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.channel !== 'supremeai-sandbox') return;
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      if (data.runId !== activeRunIdRef.current) return;

      if (data.type === 'console' && data.payload) {
        appendLog(data.payload.level || 'log', String(data.payload.text ?? ''));
      } else if (data.type === 'done') {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        setIsRunning(false);
        if (typeof data.durationMs === 'number') {
          setLastDurationMs(data.durationMs);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [appendLog]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const runCode = useCallback(
    (sourceCode: string, langTag: string) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      const trimmed = sourceCode.trim();
      if (!trimmed) {
        appendLog('warn', 'Sandbox buffer is empty. Enter code or pick a template above.');
        return;
      }

      const { runtime, originalLang } = normalizeSandboxLang(langTag, sourceCode);

      if (runtime === 'unsupported') {
        setLogs([
          {
            id: `unsup-${Date.now()}`,
            level: 'warn',
            text: `Language "${originalLang}" requires a server runtime and cannot run inside the browser client-side sandbox. Supported client-side runtimes: JS, TS, TSX/React, HTML/SVG, JSON.`,
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
        setIsRunning(false);
        setActiveSrcDoc('');
        return;
      }

      if (runtime === 'json') {
        const t0 = performance.now();
        try {
          const parsed = JSON.parse(trimmed);
          const keys = Array.isArray(parsed)
            ? `${parsed.length} array items`
            : parsed && typeof parsed === 'object'
              ? `${Object.keys(parsed).length} top-level keys`
              : typeof parsed;
          const dur = Math.round((performance.now() - t0) * 100) / 100;
          setLastDurationMs(dur);
          setLogs([
            {
              id: `json-ok-${Date.now()}`,
              level: 'info',
              text: `Valid JSON (${keys}, ${trimmed.length} bytes)`,
              timestamp: new Date().toLocaleTimeString(),
            },
            {
              id: `json-fmt-${Date.now()}`,
              level: 'result',
              text: JSON.stringify(parsed, null, 2),
              timestamp: new Date().toLocaleTimeString(),
            },
          ]);
        } catch (err) {
          setLogs([
            {
              id: `json-err-${Date.now()}`,
              level: 'error',
              text: err instanceof Error ? err.message : 'Invalid JSON syntax',
              timestamp: new Date().toLocaleTimeString(),
            },
          ]);
        }
        setActiveSrcDoc('');
        setIsRunning(false);
        return;
      }

      // Auto-select helpful output view for UI vs pure script snippets
      if (runtime === 'tsx' || runtime === 'html') {
        setViewMode((prev) => (prev === 'console' ? 'split' : prev));
      }

      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      activeRunIdRef.current = runId;
      setLastDurationMs(null);
      setIsRunning(true);
      setLogs([
        {
          id: `start-${runId}`,
          level: 'system',
          text: `Spawned fresh ephemeral VM (${runtime.toUpperCase()}) · ${runId.slice(0, 14)}`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);

      const doc = buildEphemeralSandboxHtml(sourceCode, runtime, runId, previewDarkMode);
      setVmRevision((r) => r + 1);
      setActiveSrcDoc(doc);

      timeoutRef.current = setTimeout(() => {
        if (activeRunIdRef.current === runId) {
          stopExecution(
            `Execution timed out after ${SANDBOX_TIMEOUT_MS}ms — ephemeral VM terminated.`
          );
        }
      }, SANDBOX_TIMEOUT_MS);
    },
    [appendLog, previewDarkMode, stopExecution]
  );

  // Auto-run when triggered from a chat code block ("Run in Sandbox")
  useEffect(() => {
    if (sandboxAutoRunNonce > 0 && sandboxAutoRunNonce !== lastHandledAutoRunRef.current) {
      lastHandledAutoRunRef.current = sandboxAutoRunNonce;
      runCode(sandboxCode, sandboxLang || 'javascript');
    }
  }, [sandboxAutoRunNonce, sandboxCode, sandboxLang, runCode]);

  const handleResetVm = () => {
    stopExecution();
    setLastDurationMs(null);
    setLogs([
      {
        id: `reset-${Date.now()}`,
        level: 'system',
        text: 'Ephemeral VM destroyed & memory reset. Ready for next execution.',
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
  };

  const handleNewClear = () => {
    stopExecution();
    setLastDurationMs(null);
    setCodeDraft('');
    clearSandboxCode();
    setLogs([
      {
        id: `clear-${Date.now()}`,
        level: 'system',
        text: 'Sandbox cleared. Enter code or choose a starter template.',
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
  };

  const handleSaveSnippetSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeDraft.trim()) return;
    const { runtime } = normalizeSandboxLang(selectedLang, codeDraft);
    const safeRuntime: SandboxRuntime = runtime === 'unsupported' ? 'javascript' : runtime;
    const next = saveSandboxSnippet(savedSnippets, snippetName, safeRuntime, codeDraft);
    setSavedSnippets(next);
    setSnippetName('');
    setIsSavingSnippet(false);
  };

  const detectedRuntime = normalizeSandboxLang(selectedLang, codeDraft);
  const detectedRuntimeLabel =
    detectedRuntime.runtime === 'unsupported'
      ? (detectedRuntime.originalLang || 'code').toUpperCase()
      : SANDBOX_RUNTIME_LABELS[detectedRuntime.runtime];

  const handleCopy = () => {
    navigator.clipboard.writeText(codeDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-[#060910] text-slate-200">
      {/* Top Ephemeral Sandbox Toolbar */}
      <div className="px-3 py-2 border-b border-slate-800/90 flex items-center justify-between gap-2 flex-wrap bg-[#0b101b] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono">
            <ShieldCheck className="w-3 h-3" />
            <span>{t.wsIsolatedVm}</span>
          </span>

          {/* বাংলা মন্তব্য: ভাষা বাছাইয়ের ড্রপডাউন নেই — কোড দেখে সিস্টেম নিজেই রানটাইম ঠিক করে। */}
          <span
            data-testid="sandbox-detected-runtime"
            title={t.wsAutoDetectedRuntime}
            className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-700/80 text-[10px] font-mono text-cyan-300"
          >
            {detectedRuntimeLabel}
          </span>

          {lastDurationMs !== null && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono text-slate-400">
              <Clock className="w-3 h-3 text-cyan-400" />
              {lastDurationMs}ms
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Output View Toggle */}
          <div className="flex items-center p-0.5 rounded-lg bg-slate-900 border border-slate-800">
            <button
              type="button"
              onClick={() => setViewMode('console')}
              title="Console Only"
              className={`p-1 rounded text-[11px] cursor-pointer ${
                viewMode === 'console'
                  ? 'bg-slate-800 text-cyan-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('split')}
              title="Split Console + DOM"
              className={`p-1 rounded text-[11px] cursor-pointer ${
                viewMode === 'split'
                  ? 'bg-slate-800 text-cyan-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('dom')}
              title="Rendered DOM Output"
              className={`p-1 rounded text-[11px] cursor-pointer ${
                viewMode === 'dom'
                  ? 'bg-slate-800 text-cyan-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleNewClear}
            title={t.wsNewClear}
            className="p-1.5 rounded-lg border border-slate-800 hover:border-cyan-500/40 text-slate-400 hover:text-cyan-300 cursor-pointer"
          >
            <FilePlus2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              if (!codeDraft.trim()) return;
              setIsSavingSnippet((prev) => !prev);
            }}
            title={t.wsSaveSnippet}
            disabled={!codeDraft.trim()}
            className="p-1.5 rounded-lg border border-slate-800 hover:border-cyan-500/40 text-slate-400 hover:text-cyan-300 disabled:opacity-40 cursor-pointer"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleCopy}
            title="Copy Sandbox Code"
            className="p-1.5 rounded-lg border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white cursor-pointer"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={handleResetVm}
            title="Destroy & Reset Ephemeral VM"
            className="p-1.5 rounded-lg border border-slate-800 hover:border-amber-500/40 text-slate-400 hover:text-amber-400 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {isRunning ? (
            <button
              type="button"
              onClick={() => stopExecution('Execution manually stopped.')}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500 hover:bg-rose-400 text-white font-semibold text-[11px] cursor-pointer"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>{t.wsStop}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                updateSandboxCode(codeDraft, selectedLang);
                runCode(codeDraft, selectedLang);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-[11px] cursor-pointer"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>{t.wsRun}</span>
            </button>
          )}
        </div>
      </div>

      {/* Inline Save Snippet Bar */}
      {isSavingSnippet && (
        <form
          onSubmit={handleSaveSnippetSubmit}
          className="px-3 py-1.5 border-b border-slate-800/80 bg-[#090e18] flex items-center gap-2 shrink-0"
        >
          <input
            type="text"
            value={snippetName}
            onChange={(e) => setSnippetName(e.target.value)}
            placeholder={t.wsSnippetNamePrompt}
            className="flex-1 min-w-0 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-[11px] font-mono text-white placeholder-slate-500 outline-none focus:border-cyan-500"
          />
          <button
            type="submit"
            className="px-2.5 py-1 rounded-md bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-[11px] cursor-pointer"
          >
            {t.wsBrowserSaveBookmark}
          </button>
          <button
            type="button"
            onClick={() => setIsSavingSnippet(false)}
            className="px-2 py-1 rounded-md bg-slate-800 text-slate-300 text-[11px] cursor-pointer"
          >
            {t.wsBrowserCancel}
          </button>
        </form>
      )}

      {/* Starter Templates & Local Saved Snippets Strip */}
      <div className="px-3 py-1.5 border-b border-slate-800/70 bg-[#080c15] flex items-center gap-1.5 overflow-x-auto shrink-0">
        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 shrink-0 mr-1">
          <Sparkles className="w-3 h-3 text-cyan-500" />
          {t.wsTemplates}
        </span>
        {STARTER_TEMPLATES.map((tpl) => (
          <button
            key={tpl.label}
            type="button"
            onClick={() => {
              setCodeDraft(tpl.code);
              setSelectedLang(tpl.lang);
              updateSandboxCode(tpl.code, tpl.lang);
              runCode(tpl.code, tpl.lang);
            }}
            className="px-2 py-0.5 rounded-md bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/40 text-[10px] font-mono text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer shrink-0"
          >
            {tpl.label}
          </button>
        ))}

        {savedSnippets.length > 0 && (
          <>
            <span className="text-slate-700 mx-1">|</span>
            <span className="text-[10px] font-mono text-emerald-400 shrink-0">
              {t.wsSavedSnippets}
            </span>
            {savedSnippets.map((item) => (
              <div
                key={item.id}
                className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-mono text-emerald-300 shrink-0"
              >
                <button
                  type="button"
                  onClick={() => {
                    setCodeDraft(item.code);
                    setSelectedLang(item.lang);
                    updateSandboxCode(item.code, item.lang);
                    runCode(item.code, item.lang);
                  }}
                  className="hover:text-white cursor-pointer"
                >
                  {item.name}
                </button>
                <button
                  type="button"
                  onClick={() => setSavedSnippets((prev) => deleteSandboxSnippet(prev, item.id))}
                  aria-label="Remove saved snippet"
                  className="p-0.5 rounded hover:bg-rose-500/20 hover:text-rose-300 cursor-pointer"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Main Split Editor + Output */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Editable Code Buffer */}
        <div className="h-[46%] min-h-[140px] border-b border-slate-800/90 flex flex-col overflow-hidden">
          <textarea
            value={codeDraft}
            onChange={(e) => {
              const nextVal = e.target.value;
              setCodeDraft(nextVal);
              updateSandboxCode(nextVal, selectedLang);
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                updateSandboxCode(codeDraft, selectedLang);
                runCode(codeDraft, selectedLang);
                return;
              }
              if (e.key === 'Tab') {
                e.preventDefault();
                const target = e.currentTarget;
                const start = target.selectionStart;
                const end = target.selectionEnd;
                const next = codeDraft.slice(0, start) + '  ' + codeDraft.slice(end);
                setCodeDraft(next);
                updateSandboxCode(next, selectedLang);
                requestAnimationFrame(() => {
                  target.selectionStart = target.selectionEnd = start + 2;
                });
              }
            }}
            spellCheck={false}
            aria-label="Ephemeral sandbox code editor"
            placeholder={t.wsSandboxPlaceholder}
            className="flex-1 w-full p-3 bg-[#060910] text-xs font-mono leading-relaxed text-cyan-100 focus:outline-none resize-none overflow-y-auto"
          />
        </div>

        {/* Output Area (Console Logs + Isolated DOM Frame) */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {(viewMode === 'console' || viewMode === 'split') && (
            <div
              className={`${
                viewMode === 'split' && activeSrcDoc
                  ? 'w-1/2 border-r border-slate-800/90'
                  : 'flex-1'
              } min-w-0 flex flex-col overflow-hidden bg-[#05080f]`}
            >
              <div className="px-3 py-1.5 border-b border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-400 shrink-0">
                <span>{t.wsSandboxConsole}</span>
                <button
                  type="button"
                  onClick={() => setLogs([])}
                  title={t.clear}
                  className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-200 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{t.clear}</span>
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-1.5 font-mono text-[11px]">
                {logs.length === 0 ? (
                  <div className="text-slate-500 italic">{t.wsConsoleEmpty}</div>
                ) : (
                  logs.map((entry) => (
                    <div
                      key={entry.id}
                      className={`px-2 py-1 rounded border leading-relaxed whitespace-pre-wrap break-words ${
                        entry.level === 'error'
                          ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                          : entry.level === 'warn'
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                            : entry.level === 'result'
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                              : entry.level === 'info'
                                ? 'bg-cyan-500/10 border-cyan-500/25 text-cyan-200'
                                : entry.level === 'system'
                                  ? 'bg-slate-900/70 border-slate-800 text-slate-400'
                                  : 'bg-slate-900/40 border-slate-800/60 text-slate-200'
                      }`}
                    >
                      <span className="text-[9px] text-slate-500 mr-2">[{entry.timestamp}]</span>
                      {entry.level === 'error' && (
                        <AlertTriangle className="w-3 h-3 inline mr-1 text-rose-400" />
                      )}
                      {entry.level === 'result' && (
                        <span className="text-[10px] text-emerald-400 font-semibold mr-1.5">
                          =&gt;
                        </span>
                      )}
                      <span>{entry.text}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {(viewMode === 'dom' || (viewMode === 'split' && activeSrcDoc)) && (
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[#070b12]">
              <div className="px-3 py-1.5 border-b border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-400 shrink-0">
                <span>{t.wsDomStage}</span>
                <span className="text-emerald-400">{activeSrcDoc ? t.wsActive : t.wsIdle}</span>
              </div>
              {activeSrcDoc ? (
                <iframe
                  key={vmRevision}
                  ref={iframeRef}
                  title="Ephemeral Client-Side Code Sandbox"
                  sandbox="allow-scripts"
                  srcDoc={activeSrcDoc}
                  className="flex-1 w-full h-full border-0 bg-transparent"
                />
              ) : (
                <div className="flex-1 flex items-center justify-center p-4 text-center text-xs text-slate-500 font-mono">
                  {t.wsDomEmpty}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Hidden isolated execution frame when Console-only view is chosen */}
      {viewMode === 'console' && activeSrcDoc && (
        <iframe
          key={vmRevision}
          ref={iframeRef}
          title="Ephemeral Headless Sandbox Frame"
          sandbox="allow-scripts"
          srcDoc={activeSrcDoc}
          className="hidden"
          aria-hidden="true"
        />
      )}
    </div>
  );
};
