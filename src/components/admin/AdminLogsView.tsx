import React, { useMemo, useState } from 'react';
import { ArrowRight, Download, RefreshCw, Search } from 'lucide-react';
import { useAdminStore } from '../../stores/useAdminStore';
import { useControlCenterStore } from '../../stores/useControlCenterStore';
import { useAdminHealthStore } from '../../stores/useAdminHealthStore';
import {
  buildUnifiedAdminLogs,
  filterAdminLogs,
  type AdminLogLevel,
  type AdminLogSource,
} from '../../utils/adminLogs';
import { formatRelativeTime } from './AdminMissionControlView';

/**
 * বাংলা মন্তব্য: সব প্রোভাইডার ও সার্ভিসের লগ এক জায়গায় — লেভেল (Error/Warning/Info), সোর্স,
 * প্রোভাইডার আর সার্চ দিয়ে ফিল্টার। প্রতিটা লাইনের "Open" বাটন সংশ্লিষ্ট ট্যাবে নিয়ে যায়।
 */

interface AdminLogsViewProps {
  onNavigateTab: (tab: string) => void;
}

const LEVELS: Array<{ id: AdminLogLevel | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'error', label: 'Errors' },
  { id: 'warn', label: 'Warnings' },
  { id: 'info', label: 'Info' },
];

const SOURCES: Array<{ id: AdminLogSource | 'all'; label: string }> = [
  { id: 'all', label: 'All sources' },
  { id: 'service', label: 'Service logs' },
  { id: 'alert', label: 'Health alerts' },
  { id: 'deploy', label: 'Deploys' },
  { id: 'provider', label: 'AI provider keys' },
  { id: 'security', label: 'Security' },
  { id: 'audit', label: 'Audit trail' },
  { id: 'agent', label: 'Agent workers' },
];

const LEVEL_STYLE: Record<AdminLogLevel, string> = {
  error: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  info: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

export const AdminLogsView: React.FC<AdminLogsViewProps> = ({ onNavigateTab }) => {
  const { mcpServices, securityEvents, auditRecords, swarmWorkers } = useAdminStore();
  const healthSnapshot = useControlCenterStore((s) => s.healthSnapshot);
  const { providers, deployments, isRefreshing, refreshAll, lastRefreshedAt } =
    useAdminHealthStore();

  const [level, setLevel] = useState<AdminLogLevel | 'all'>('all');
  const [source, setSource] = useState<AdminLogSource | 'all'>('all');
  const [provider, setProvider] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const allLogs = useMemo(
    () =>
      buildUnifiedAdminLogs({
        mcpServices,
        alerts: healthSnapshot?.alerts ?? [],
        deployments,
        providers,
        securityEvents,
        auditRecords,
        workers: swarmWorkers,
      }),
    [
      mcpServices,
      healthSnapshot,
      deployments,
      providers,
      securityEvents,
      auditRecords,
      swarmWorkers,
    ]
  );

  const providerOptions = useMemo(
    () => Array.from(new Set(allLogs.map((l) => l.provider))).sort(),
    [allLogs]
  );
  const logs = useMemo(
    () => filterAdminLogs(allLogs, { level, source, provider, query }),
    [allLogs, level, source, provider, query]
  );
  const errorCount = allLogs.filter((l) => l.level === 'error').length;
  const warnCount = allLogs.filter((l) => l.level === 'warn').length;

  const downloadLogs = () => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `supremeai-admin-logs-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      data-testid="admin-logs-view"
      className="flex-1 overflow-y-auto bg-[#f6f8fb] dark:bg-slate-950 px-4 sm:px-6 py-5 text-slate-800 dark:text-slate-200"
    >
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
            {errorCount} errors
          </span>
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            {warnCount} warnings
          </span>
          <span className="text-xs text-slate-500">
            {allLogs.length} entries · updated {formatRelativeTime(lastRefreshedAt)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={downloadLogs}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
            <button
              type="button"
              onClick={() => void refreshAll({ force: true })}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs font-semibold cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col lg:flex-row gap-2 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden shrink-0">
            {LEVELS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLevel(l.id)}
                aria-pressed={level === l.id}
                className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${
                  level === l.id
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'bg-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as AdminLogSource | 'all')}
            aria-label="Log source"
            className="px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            {SOURCES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            aria-label="Provider"
            className="px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            <option value="all">All providers</option>
            {providerOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <label className="flex-1 flex items-center gap-2 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search logs…"
              aria-label="Search logs"
              className="w-full py-1.5 bg-transparent text-xs focus:outline-none"
            />
          </label>
        </div>

        {/* Log list */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          {logs.length === 0 ? (
            <p className="p-10 text-center text-xs text-slate-500">
              {allLogs.length === 0
                ? 'No logs yet — sources will appear here as soon as they report.'
                : 'No logs match these filters.'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {logs.slice(0, 500).map((log) => {
                const isOpen = expanded === log.id;
                return (
                  <li key={log.id} className="px-3 sm:px-4 py-2.5">
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${LEVEL_STYLE[log.level]}`}
                      >
                        {log.level}
                      </span>
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : log.id)}
                        className="min-w-0 flex-1 text-left cursor-pointer"
                        aria-expanded={isOpen}
                      >
                        <div
                          className={`text-xs text-slate-800 dark:text-slate-200 ${isOpen ? 'break-words' : 'truncate'}`}
                        >
                          {log.message}
                        </div>
                        <div className="text-[10.5px] text-slate-500 truncate">
                          {log.provider} · {log.source} ·{' '}
                          {log.ts ? new Date(log.ts).toLocaleString() : 'no timestamp'}
                        </div>
                        {isOpen && log.details && (
                          <pre className="mt-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-950 text-[11px] font-mono whitespace-pre-wrap break-words text-slate-600 dark:text-slate-300">
                            {log.details}
                          </pre>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigateTab(log.targetTab)}
                        className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        Open
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminLogsView;
