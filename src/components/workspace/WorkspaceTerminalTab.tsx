import React, { useEffect, useRef, useCallback } from 'react';
import { Terminal as TerminalIcon, Trash2, Radio, Play } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useRealtimeStream } from '../../hooks/useRealtimeStream';
import { useI18n } from '../../utils/i18n';
import { normalizeProxyInputUrl } from '../../stores/useWorkspaceStore';
import { logger } from '../../utils/logger';
import { getWorkspaceAuthHeaders } from '../../utils/workspaceAuth';

interface SwarmStreamEvent {
  type: string;
  timestamp: number;
  throughputRps?: number;
  logEvent?: {
    timestamp: string;
    source: string;
    level: string;
    message: string;
  };
}

export interface TerminalParsedOutput {
  stdout: string;
  stderr: string;
}

export function parseTerminalResponse(
  data: Record<string, unknown> | null | undefined
): TerminalParsedOutput {
  if (!data || typeof data !== 'object') {
    return { stdout: '', stderr: '' };
  }
  const stdoutCandidate = data.stdout ?? data.output ?? data.text ?? '';
  const stderrCandidate = data.stderr ?? data.error ?? '';
  return {
    stdout: typeof stdoutCandidate === 'string' ? stdoutCandidate : String(stdoutCandidate || ''),
    stderr: typeof stderrCandidate === 'string' ? stderrCandidate : String(stderrCandidate || ''),
  };
}

export async function executeClientFallbackCommand(
  rawCommand: string,
  history: string[],
  backendUnavailable: boolean
): Promise<TerminalParsedOutput> {
  const trimmed = rawCommand.trim();
  const parts = trimmed.split(/\s+/);
  const cmd = (parts[0] || '').toLowerCase();
  const args = parts.slice(1);

  if (cmd === 'help') {
    return {
      stdout: [
        'SupremeAI Studio · Edge & Local Shell',
        'Client Diagnostics (always available offline & on edge):',
        '  help               Show supported commands',
        '  status             Inspect client runtime, network & studio state',
        '  history            List recent terminal commands',
        '  date               Show current UTC & local timestamp',
        '  echo <text>        Print text to terminal',
        '  ping <url|/api>    Measure HTTP round-trip latency',
        '  clear              Clear terminal output buffer',
        backendUnavailable
          ? 'Note: Local host filesystem commands (ls, cat, git) require the local Node server.'
          : 'Host Sandbox Commands: ls [dir], pwd, cat <file>, git status, git log, node -v',
      ].join('\n'),
      stderr: '',
    };
  }

  if (cmd === 'history') {
    if (history.length === 0) {
      return { stdout: '(command history is empty)', stderr: '' };
    }
    const ordered = [...history].reverse();
    return {
      stdout: ordered.map((item, idx) => `${String(idx + 1).padStart(3, ' ')}  ${item}`).join('\n'),
      stderr: '',
    };
  }

  if (cmd === 'date') {
    return {
      stdout: `UTC:   ${new Date().toUTCString()}\nLocal: ${new Date().toLocaleString()}`,
      stderr: '',
    };
  }

  if (cmd === 'echo') {
    return { stdout: args.join(' '), stderr: '' };
  }

  if (cmd === 'status') {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'offline';
    const perfMemory =
      typeof performance !== 'undefined' && 'memory' in performance
        ? (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory
        : undefined;
    const heapMb = perfMemory?.usedJSHeapSize
      ? `${Math.round(perfMemory.usedJSHeapSize / (1024 * 1024))} MB`
      : 'N/A';

    return {
      stdout: [
        `Origin:      ${origin}`,
        `Online:      ${nav ? String(nav.onLine) : 'unknown'}`,
        `Language:    ${nav?.language || 'en-US'}`,
        `Platform:    ${nav?.platform || 'browser'}`,
        `JS Heap:     ${heapMb}`,
        `Host Shell:  ${backendUnavailable ? 'Edge Client Mode (Node host unavailable)' : 'Connected'}`,
      ].join('\n'),
      stderr: '',
    };
  }

  if (cmd === 'ping') {
    const targetRaw = args[0] || '/api/health';
    const url = targetRaw.startsWith('/') ? targetRaw : normalizeProxyInputUrl(targetRaw);
    const start = Date.now();
    try {
      const targetEndpoint = url.startsWith('/')
        ? url
        : `/api/workspace/browser-proxy?url=${encodeURIComponent(url)}`;
      // বাংলা মন্তব্য: /api/workspace/* এন্ডপয়েন্টের requireAuthMiddleware পাস করতে auth headers পাঠানো হচ্ছে।
      const res = await fetch(targetEndpoint, {
        method: 'GET',
        headers: getWorkspaceAuthHeaders(),
      });
      const elapsed = Date.now() - start;
      const contentType = res.headers.get('content-type') || '';
      if (!url.startsWith('/') && contentType.includes('application/json')) {
        const data = (await res.json().catch(() => ({}))) as {
          statusCode?: number;
          error?: string;
        };
        if (data.error) {
          return {
            stdout: '',
            stderr: `PING ${url} -> HTTP ${data.statusCode || res.status} (${elapsed}ms): ${data.error}`,
          };
        }
        return {
          stdout: `PING ${url} -> HTTP ${data.statusCode || res.status} (${elapsed}ms)`,
          stderr: '',
        };
      }
      return {
        stdout: `PING ${url} -> HTTP ${res.status} (${elapsed}ms)`,
        stderr: '',
      };
    } catch (err: unknown) {
      const elapsed = Date.now() - start;
      const msg = err instanceof Error ? err.message : 'Request failed';
      return {
        stdout: '',
        stderr: `PING ${url} failed after ${elapsed}ms: ${msg}`,
      };
    }
  }

  if (backendUnavailable) {
    return {
      stdout: '',
      stderr: `Command "${trimmed}" requires the local Node.js backend, which is not active on this static deployment. Run "help", "status", "history", "date", "echo", or "ping <url>".`,
    };
  }

  return {
    stdout: '',
    stderr: `Empty response for "${trimmed}". Type "help" for available commands.`,
  };
}

const PROMPT = '\x1b[1;36msupremeai\x1b[0m\x1b[1;32m@studio\x1b[0m:\x1b[1;34m~\x1b[0m$ ';
const QUICK_CMDS = ['help', 'status', 'history', 'date', 'ls -la', 'git status'];

export const WorkspaceTerminalTab: React.FC = () => {
  const { isAgentStreamEnabled, toggleAgentStream } = useWorkspaceStore();
  const { t } = useI18n();

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputBufferRef = useRef<string>('');
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef<number>(-1);
  const isBusyRef = useRef<boolean>(false);
  const initialReadyMsgRef = useRef<string>(t.wsTerminalFallbackReady);
  initialReadyMsgRef.current = t.wsTerminalFallbackReady;

  const writePrompt = useCallback(() => {
    termRef.current?.write(`\r\n${PROMPT}`);
  }, []);

  const writeCommandOutput = useCallback((term: Terminal, result: TerminalParsedOutput) => {
    if (result.stdout) {
      const formatted = result.stdout.replace(/\r?\n/g, '\r\n');
      term.writeln(`\x1b[32m${formatted}\x1b[0m`);
    }
    if (result.stderr) {
      const formatted = result.stderr.replace(/\r?\n/g, '\r\n');
      term.writeln(`\x1b[31m${formatted}\x1b[0m`);
    }
  }, []);

  const runShellCommand = useCallback(
    async (rawCmd: string, echoCommand: boolean = false) => {
      const term = termRef.current;
      const trimmed = rawCmd.trim();
      if (!term) return;

      if (echoCommand) {
        term.write(`\r\n${PROMPT}${trimmed}`);
      }

      if (!trimmed) {
        writePrompt();
        return;
      }

      const prevHistory = historyRef.current;
      historyRef.current = [trimmed, ...prevHistory.slice(0, 40)];
      historyIdxRef.current = -1;

      const lowerCmd = trimmed.split(/\s+/)[0]?.toLowerCase() || '';

      if (lowerCmd === 'clear') {
        term.clear();
        term.write(PROMPT);
        return;
      }

      isBusyRef.current = true;
      term.write('\r\n');

      try {
        // Client-native interactive commands work instantly offline or on Cloudflare Pages
        if (lowerCmd === 'history' || lowerCmd === 'ping') {
          const clientResult = await executeClientFallbackCommand(trimmed, prevHistory, false);
          writeCommandOutput(term, clientResult);
          return;
        }

        let backendResult: TerminalParsedOutput | null = null;
        let backendFailed = false;

        try {
          // বাংলা মন্তব্য: লোকাল টার্মিনাল এন্ডপয়েন্টে auth headers না পাঠালে 401 এসে ফলব্যাকে চলে যেত।
          const res = await fetch('/api/workspace/terminal', {
            method: 'POST',
            headers: getWorkspaceAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ command: trimmed }),
          });
          const rawBody = await res.text();
          let data: Record<string, unknown> = {};
          try {
            data = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
          } catch {
            backendFailed = true;
          }

          if (!res.ok) {
            backendFailed = true;
          } else if (!backendFailed) {
            const parsed = parseTerminalResponse(data);
            if (parsed.stdout || parsed.stderr) {
              backendResult = parsed;
            } else {
              backendFailed = true;
            }
          }
        } catch {
          backendFailed = true;
        }

        if (backendResult) {
          writeCommandOutput(term, backendResult);
        } else {
          const fallback = await executeClientFallbackCommand(trimmed, prevHistory, backendFailed);
          writeCommandOutput(term, fallback);
        }
      } finally {
        isBusyRef.current = false;
        term.write(PROMPT);
      }
    },
    [writeCommandOutput, writePrompt]
  );

  // Initialize XTerm.js + FitAddon
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12,
      lineHeight: 1.45,
      scrollback: 2000,
      theme: {
        background: '#060910',
        foreground: '#e2e8f0',
        cursor: '#00f0ff',
        cursorAccent: '#060910',
        selectionBackground: 'rgba(0, 240, 255, 0.25)',
        black: '#0f172a',
        red: '#fb7185',
        green: '#34d399',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#f8fafc',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.writeln('\x1b[1;36m╔══════════════════════════════════════════════════════════╗\x1b[0m');
    term.writeln('\x1b[1;36m║  SupremeAI Studio · Interactive Workspace Shell          ║\x1b[0m');
    term.writeln('\x1b[1;36m╚══════════════════════════════════════════════════════════╝\x1b[0m');
    term.writeln(`\x1b[90m${initialReadyMsgRef.current}\x1b[0m`);
    term.write(PROMPT);

    const disposable = term.onData((data) => {
      if (isBusyRef.current) return;

      if (data === '\r') {
        const cmd = inputBufferRef.current;
        inputBufferRef.current = '';
        runShellCommand(cmd, false);
        return;
      }

      if (data === '\x03') {
        inputBufferRef.current = '';
        term.write('^C');
        writePrompt();
        return;
      }

      if (data === '\x0c') {
        term.clear();
        term.write(`${PROMPT}${inputBufferRef.current}`);
        return;
      }

      if (data === '\x7f' || data === '\b') {
        if (inputBufferRef.current.length > 0) {
          inputBufferRef.current = inputBufferRef.current.slice(0, -1);
          term.write('\b \b');
        }
        return;
      }

      if (data === '\x1b[A') {
        if (historyRef.current.length === 0) return;
        const nextIdx = Math.min(historyIdxRef.current + 1, historyRef.current.length - 1);
        historyIdxRef.current = nextIdx;
        const prevCmd = historyRef.current[nextIdx];
        term.write('\b \b'.repeat(inputBufferRef.current.length));
        inputBufferRef.current = prevCmd;
        term.write(prevCmd);
        return;
      }

      if (data === '\x1b[B') {
        if (historyIdxRef.current <= 0) {
          term.write('\b \b'.repeat(inputBufferRef.current.length));
          historyIdxRef.current = -1;
          inputBufferRef.current = '';
        } else {
          const nextIdx = historyIdxRef.current - 1;
          historyIdxRef.current = nextIdx;
          const nextCmd = historyRef.current[nextIdx];
          term.write('\b \b'.repeat(inputBufferRef.current.length));
          inputBufferRef.current = nextCmd;
          term.write(nextCmd);
        }
        return;
      }

      if (data >= ' ' && data !== '\x7f') {
        inputBufferRef.current += data;
        term.write(data);
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch (error) {
        logger.debug('WorkspaceTerminalTab: suppressed non-fatal error', error);
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      disposable.dispose();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [runShellCommand, writePrompt]);

  const handleSwarmMessage = useCallback((payload: SwarmStreamEvent) => {
    const term = termRef.current;
    if (!term || !payload?.logEvent) return;

    const time = payload.logEvent.timestamp;
    const msg = payload.logEvent.message;
    const rps = payload.throughputRps || 120;

    term.write(`\r\x1b[K\x1b[35m[${time} · SWARM]\x1b[0m \x1b[37m${msg} (${rps} req/s)\x1b[0m\r\n`);
    term.write(`${PROMPT}${inputBufferRef.current}`);
  }, []);

  const { status: streamStatus } = useRealtimeStream<SwarmStreamEvent>({
    url: '/api/agent-swarm/stream',
    enabled: isAgentStreamEnabled,
    onMessage: handleSwarmMessage,
  });

  const handleClear = () => {
    const term = termRef.current;
    if (!term) return;
    inputBufferRef.current = '';
    term.clear();
    term.write(PROMPT);
    term.focus();
  };

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden bg-[#060910] text-slate-200 font-mono"
      onClick={() => termRef.current?.focus()}
    >
      {/* XTerm Header Toolbar */}
      <div className="px-3 py-2 border-b border-slate-800/90 flex items-center justify-between gap-2 bg-[#0b101b]">
        <div className="flex items-center gap-2 text-[11px]">
          <TerminalIcon className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-semibold text-slate-200">XTerm.js · supremeai-bash</span>
          <span className="text-slate-600">·</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleAgentStream();
            }}
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] transition-colors cursor-pointer ${
              isAgentStreamEnabled
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}
            title="Toggle Live Agent Swarm SSE Stream"
          >
            <Radio
              className={`w-3 h-3 ${
                isAgentStreamEnabled && streamStatus === 'connected'
                  ? 'animate-pulse text-emerald-400'
                  : ''
              }`}
            />
            <span>
              {t.wsAgentSse} {isAgentStreamEnabled ? streamStatus.toUpperCase() : t.wsPaused}
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleClear();
          }}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-slate-400 hover:text-rose-400 hover:bg-slate-800/70 transition-colors cursor-pointer"
          title={t.clear}
        >
          <Trash2 className="w-3 h-3" />
          <span>{t.clear}</span>
        </button>
      </div>

      {/* Quick Command Bar */}
      <div className="px-3 py-1.5 border-b border-slate-800/60 bg-[#080c15] flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        <span className="text-[10px] text-slate-500 uppercase shrink-0 mr-1">
          {t.wsTerminalQuickRun}
        </span>
        {QUICK_CMDS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              runShellCommand(q, true);
              termRef.current?.focus();
            }}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/40 text-[10px] text-slate-300 hover:text-cyan-300 transition-colors shrink-0 cursor-pointer"
          >
            <Play className="w-2.5 h-2.5 text-cyan-500" />
            <span>{q}</span>
          </button>
        ))}
      </div>

      {/* XTerm.js Mounted Canvas */}
      <div className="flex-1 overflow-hidden p-2 bg-[#060910]">
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
};
