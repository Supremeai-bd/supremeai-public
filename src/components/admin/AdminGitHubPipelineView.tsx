import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GitBranch,
  RefreshCw,
  Play,
  RotateCcw,
  XCircle,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  GitPullRequest,
  Check,
  Clock,
  BellRing,
  GitCommitHorizontal,
  Terminal,
  ChevronDown,
  ChevronUp,
  Copy,
} from 'lucide-react';
import { adminService } from '../../services/adminService';
import { useI18n } from '../../utils/i18n';
import { useDataSource } from '../../hooks/useDataSource';
import { toast } from '../../stores/useToastStore';
import { GitHubPipelineStatusIndicator } from './GitHubPipelineStatusIndicator';
import {
  buildGitHubCommitUrl,
  classifyRunOutcome,
  computeDeploymentTrends,
  computeRunDurationMs,
  DEFAULT_DURATION_THRESHOLD_MS,
  evaluateDurationAlert,
  formatPipelineDuration,
  formatShortCommitSha,
  isRunActive,
  type GitHubBranchRef,
  type GitHubPullRequest,
  type GitHubRunErrorLogsResponse,
  type GitHubWorkflowRun,
} from '../../utils/githubPipelineMetrics';

const DURATION_THRESHOLD_STORAGE_KEY = 'supremeai_gh_duration_threshold_ms';

function loadStoredDurationThreshold(): number {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = Number(localStorage.getItem(DURATION_THRESHOLD_STORAGE_KEY));
      if (Number.isFinite(raw) && raw > 0) return raw;
    }
  } catch {
    // Ignore storage access errors in privacy/sandboxed browsers
  }
  return DEFAULT_DURATION_THRESHOLD_MS;
}

type Run = GitHubWorkflowRun;

type BranchRef = GitHubBranchRef;

type Pull = GitHubPullRequest;

/** GitHub returns `head`/`base` as objects; the gateway returns plain strings. */
export function branchName(ref: BranchRef): string {
  if (!ref) return '';
  if (typeof ref === 'string') return ref;
  return String(ref.ref || ref.label || '');
}

export const AdminGitHubPipelineView: React.FC = () => {
  const { t } = useI18n();
  const [repo, setRepo] = useState('Supremeai-bd/supremeai');
  const [runs, setRuns] = useState<Run[]>([]);
  const [pulls, setPulls] = useState<Pull[]>([]);
  const [tokenOk, setTokenOk] = useState<boolean>(true);
  const [warning, setWarning] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState<boolean>(false);
  const [lastUpdatedMs, setLastUpdatedMs] = useState<number | undefined>(undefined);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [durationThresholdMs, setDurationThresholdMs] = useState<number>(
    loadStoredDurationThreshold
  );
  const [alertAcknowledged, setAlertAcknowledged] = useState<boolean>(false);
  const [expandedErrorRuns, setExpandedErrorRuns] = useState<Record<string, boolean>>({});
  const [errorLogsByKey, setErrorLogsByKey] = useState<
    Record<
      string,
      {
        loading: boolean;
        error?: string | null;
        data?: GitHubRunErrorLogsResponse;
      }
    >
  >({});
  const [copiedErrorRunKey, setCopiedErrorRunKey] = useState<string | null>(null);
  const lastAlertedKeyRef = useRef<string | null>(null);

  const hasActiveRun = useMemo(() => runs.some((r) => isRunActive(r)), [runs]);

  const trendsSummary = useMemo(() => computeDeploymentTrends(runs, nowMs), [runs, nowMs]);
  const durationAlert = useMemo(
    () => evaluateDurationAlert(trendsSummary.avgDurationMs, durationThresholdMs),
    [trendsSummary.avgDurationMs, durationThresholdMs]
  );

  const handleChangeDurationThreshold = useCallback((nextMs: number) => {
    if (!Number.isFinite(nextMs) || nextMs <= 0) return;
    setDurationThresholdMs(nextMs);
    setAlertAcknowledged(false);
    lastAlertedKeyRef.current = null;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(DURATION_THRESHOLD_STORAGE_KEY, String(nextMs));
      }
    } catch {
      // Ignore storage persistence errors
    }
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [runsRes, pullsRes] = await Promise.all([
        adminService.fetchGitHubRuns(repo),
        adminService.fetchGitHubPulls(repo),
      ]);
      setRuns(Array.isArray(runsRes?.runs) ? runsRes.runs : []);
      setPulls(Array.isArray(pullsRes?.pulls) ? pullsRes.pulls : []);
      setTokenOk(runsRes?.tokenConfigured !== false && pullsRes?.tokenConfigured !== false);
      setWarning(runsRes?.warning || pullsRes?.warning || null);
      setHasLoaded(true);
      setLastUpdatedMs(Date.now());
      setNowMs(Date.now());
    } catch {
      setRuns([]);
      setPulls([]);
      setWarning('Unable to reach GitHub pipeline proxy.');
      setHasLoaded(false);
    } finally {
      setIsLoading(false);
    }
  }, [repo]);

  // বাংলা মন্তব্য: সক্রিয় ডিপ্লয়মেন্ট চললে দ্রুত ৮ সেকেন্ড পরপর পোল হবে, নাহলে ৩০ সেকেন্ড।
  useEffect(() => {
    void load();
    const pollMs = hasActiveRun ? 8000 : 30000;
    const timer = setInterval(() => {
      void load();
    }, pollMs);
    return () => clearInterval(timer);
  }, [load, hasActiveRun]);

  // বাংলা মন্তব্য: কোনো জব চলমান থাকলে প্রতি ১ সেকেন্ডে রিয়েল-টাইম ডিউরেশন আপডেট।
  useEffect(() => {
    if (!hasActiveRun) return;
    setNowMs(Date.now());
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [hasActiveRun]);

  // বাংলা মন্তব্য: গড় ডিপ্লয়মেন্ট সময়সীমা সীমা ছাড়ালে একবার সতর্কীকরণ টোস্ট ট্রিগার করে।
  useEffect(() => {
    if (!durationAlert.exceeded) {
      lastAlertedKeyRef.current = null;
      return;
    }
    const alertKey = `${repo}:${durationAlert.thresholdMs}`;
    if (lastAlertedKeyRef.current === alertKey) return;
    lastAlertedKeyRef.current = alertKey;
    setAlertAcknowledged(false);
    toast.warning(
      'Deployment Duration Threshold Exceeded',
      `${repo} average (${formatPipelineDuration(durationAlert.avgDurationMs)}) exceeds ${formatPipelineDuration(durationAlert.thresholdMs)} limit.`,
      6000
    );
  }, [
    durationAlert.exceeded,
    durationAlert.avgDurationMs,
    durationAlert.thresholdMs,
    repo,
  ]);

  const dataSource = useDataSource({
    loaded: hasLoaded,
    lastUpdatedMs,
    error: warning,
  });

  const handleRunAction = async (id: number | string, action: 'rerun' | 'cancel') => {
    setActionMsg(`Executing ${action} on run #${id}...`);
    try {
      await adminService.triggerGitHubRunAction(repo, id, action);
      setActionMsg(`Action "${action}" dispatched for run #${id}.`);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : `Failed to ${action} run #${id}.`);
    }
    setTimeout(() => setActionMsg(null), 4000);
    void load();
  };

  const handlePullAction = async (number: number, action: 'approve' | 'merge') => {
    setActionMsg(`Executing ${action} on PR #${number}...`);
    try {
      await adminService.triggerGitHubPullAction(repo, number, action);
      setActionMsg(`PR #${number} ${action} completed.`);
      toast.success(`PR #${number}`, action === 'approve' ? 'Approved on GitHub.' : 'Merged on GitHub.');
    } catch (err) {
      const message = err instanceof Error ? err.message : `Failed to ${action} PR #${number}.`;
      setActionMsg(message);
      toast.error(`PR #${number} ${action} failed`, message, 12000);
    }
    setTimeout(() => setActionMsg(null), 4000);
    void load();
  };

  const getPullAuthor = (user: Pull['user']): string => {
    if (typeof user === 'string') return user;
    return user?.login || 'contributor';
  };

  // বাংলা মন্তব্য: ব্যর্থ ডিপ্লয়মেন্টের সারি এক্সপ্যান্ড করলে API থেকে stderr/CI লগ সংগ্রহ করে এবং ক্যাশ রাখে।
  const loadRunErrorLogs = useCallback(
    async (runId: number | string) => {
      const cacheKey = `${repo}:${runId}`;
      setErrorLogsByKey((prev) => ({
        ...prev,
        [cacheKey]: { ...prev[cacheKey], loading: true, error: null },
      }));
      try {
        const data = await adminService.fetchGitHubRunErrorLogs(repo, runId);
        setErrorLogsByKey((prev) => ({
          ...prev,
          [cacheKey]: { loading: false, error: null, data },
        }));
      } catch (err) {
        setErrorLogsByKey((prev) => ({
          ...prev,
          [cacheKey]: {
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to load CI error logs.',
          },
        }));
      }
    },
    [repo]
  );

  const handleToggleErrorLog = useCallback(
    (runId: number | string) => {
      const cacheKey = `${repo}:${runId}`;
      const currentlyExpanded = Boolean(expandedErrorRuns[cacheKey]);
      setExpandedErrorRuns((prev) => ({ ...prev, [cacheKey]: !currentlyExpanded }));
      if (!currentlyExpanded) {
        const existing = errorLogsByKey[cacheKey];
        if (!existing || (!existing.loading && !existing.data)) {
          void loadRunErrorLogs(runId);
        }
      }
    },
    [repo, expandedErrorRuns, errorLogsByKey, loadRunErrorLogs]
  );

  const handleCopyErrorLog = useCallback(async (cacheKey: string, text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard?.writeText(text);
      setCopiedErrorRunKey(cacheKey);
      setTimeout(() => {
        setCopiedErrorRunKey((curr) => (curr === cacheKey ? null : curr));
      }, 2000);
    } catch {
      // Clipboard API unavailable in restricted contexts
    }
  }, []);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 max-w-7xl mx-auto space-y-6 text-slate-800 dark:text-slate-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-emerald-500" />
              {t.githubPipelineTitle}
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900">
              GitOps Action Gate
            </span>
            {durationAlert.exceeded && (
              <button
                type="button"
                data-testid="header-duration-alert-badge"
                onClick={() => {
                  document
                    .getElementById('github-pipeline-status-indicator')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono tabular-nums font-semibold border cursor-pointer transition-colors ${
                  durationAlert.severity === 'critical'
                    ? 'bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800'
                    : 'bg-amber-50 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                }`}
                title="Average deployment duration exceeds configured threshold"
              >
                <BellRing className="w-3 h-3 shrink-0" />
                <span>
                  1 Duration Alert · {formatPipelineDuration(durationAlert.avgDurationMs)}
                </span>
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Trigger workflow reruns, approve pull requests, and auto-merge code directly from the
            SupremeAI admin cockpit.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={repo}
            onChange={(e) => {
              setRepo(e.target.value);
              setAlertAcknowledged(false);
            }}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
          >
            <option value="Supremeai-bd/supremeai">Supremeai-bd/supremeai (Monorepo SSOT)</option>
            <option value="Supremeai-bd/supremeai-public">
              Supremeai-bd/supremeai-public (Studio Mirror)
            </option>
            <option value="Supremeai-bd/supremeai-frontend">
              Supremeai-bd/supremeai-frontend (Legacy Archived)
            </option>
          </select>
          <button
            type="button"
            onClick={() => void load()}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
            <span>{t.refreshRunsBtn}</span>
          </button>
        </div>
      </div>

      {(!tokenOk || warning) && (
        <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300/60 dark:border-amber-800/60 text-amber-800 dark:text-amber-200 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            {warning ||
              'Server GITHUB_TOKEN / GITHUB_READONLY_TOKEN is not configured. Read rate-limits or mutating actions may require authentication.'}
          </span>
        </div>
      )}

      {actionMsg && (
        <div className="p-3 rounded-xl bg-cyan-950/60 border border-cyan-500/40 text-cyan-200 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-cyan-400" />
          <span>{actionMsg}</span>
        </div>
      )}

      {/* Real-Time Deployment Duration & Success Rate Trend Status Indicator */}
      <GitHubPipelineStatusIndicator
        runs={runs}
        nowMs={nowMs}
        isLoading={isLoading}
        lastUpdatedMs={lastUpdatedMs}
        dataSource={dataSource}
        repo={repo}
        durationThresholdMs={durationThresholdMs}
        onChangeDurationThreshold={handleChangeDurationThreshold}
        alertAcknowledged={alertAcknowledged}
        onToggleAcknowledgeAlert={() => setAlertAcknowledged((prev) => !prev)}
      />

      {/* Workflow Runs Section */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Play className="w-4 h-4 text-cyan-500" />
          Recent GitHub Actions Workflow Runs
        </h3>
        <div className="grid gap-3">
          {runs.map((run) => {
            const isSuccess = run.conclusion === 'success';
            const isFailed = classifyRunOutcome(run) === 'failure';
            const active = isRunActive(run);
            const durationLabel = formatPipelineDuration(computeRunDurationMs(run, nowMs));
            // বাংলা মন্তব্য: বৈধ head_sha থাকলে ডিপ্লয়মেন্টের পাশে ক্লিকেবল GitHub কমিট লিংক দেখানো হবে।
            const shortSha = formatShortCommitSha(run.head_sha);
            const commitUrl = buildGitHubCommitUrl(repo, run.head_sha, run.html_url);
            const runCacheKey = `${repo}:${run.id}`;
            const isErrorLogExpanded = isFailed && Boolean(expandedErrorRuns[runCacheKey]);
            const logEntry = errorLogsByKey[runCacheKey];
            const logData = logEntry?.data;
            const copyPayload = [
              ...(logData?.annotations || []).map(
                (a) => `${a.path}${a.startLine ? `:${a.startLine}` : ''} — ${a.message}`
              ),
              logData?.stderrSnippet || '',
            ]
              .filter(Boolean)
              .join('\n\n');

            return (
              <div
                key={run.id}
                data-testid={`workflow-run-row-${run.id}`}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 flex flex-col gap-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                      <span className="truncate">{run.name}</span>
                      <span className="text-xs font-mono tabular-nums text-slate-400 shrink-0">
                        #{run.id}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5 flex flex-wrap items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-cyan-600 dark:text-cyan-400">
                        {run.head_branch}
                      </span>
                      {shortSha && commitUrl && (
                        <>
                          <span aria-hidden="true">·</span>
                          <a
                            href={commitUrl}
                            target="_blank"
                            rel="noreferrer"
                            data-testid={`run-commit-link-${run.id}`}
                            title={`View commit ${run.head_sha} on GitHub`}
                            className="inline-flex items-center gap-1 font-mono tabular-nums text-cyan-700 dark:text-cyan-400 hover:text-cyan-600 dark:hover:text-cyan-300 hover:underline"
                          >
                            <GitCommitHorizontal className="w-3.5 h-3.5 shrink-0" />
                            <span>{shortSha}</span>
                          </a>
                        </>
                      )}
                      <span>·</span>
                      <span
                        className={`inline-flex items-center gap-1 font-bold ${
                          active
                            ? 'text-cyan-600 dark:text-cyan-400'
                            : isSuccess
                              ? 'text-emerald-500'
                              : isFailed
                                ? 'text-red-500'
                                : 'text-amber-500'
                        }`}
                      >
                        {isSuccess ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
                        {isFailed ? <AlertTriangle className="w-3.5 h-3.5" /> : null}
                        {run.conclusion || run.status}
                      </span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1 tabular-nums text-slate-600 dark:text-slate-300">
                        <Clock className="w-3 h-3 text-slate-400" />
                        {durationLabel}
                      </span>
                      <span>·</span>
                      <span className="tabular-nums">
                        {new Date(run.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {isFailed && (
                      <button
                        type="button"
                        data-testid={`toggle-error-log-${run.id}`}
                        aria-expanded={isErrorLogExpanded}
                        aria-controls={`error-log-panel-${run.id}`}
                        onClick={() => handleToggleErrorLog(run.id)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                          isErrorLogExpanded
                            ? 'bg-rose-600 border-rose-600 text-white hover:bg-rose-500'
                            : 'bg-rose-50 dark:bg-rose-950/50 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60'
                        }`}
                      >
                        <Terminal className="w-3.5 h-3.5 shrink-0" />
                        <span>Error Log</span>
                        {isErrorLogExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRunAction(run.id, 'rerun')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer shadow-sm whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Rerun</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRunAction(run.id, 'cancel')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold cursor-pointer shadow-sm whitespace-nowrap shrink-0"
                    >
                      <XCircle className="w-3 h-3" />
                      <span>Cancel</span>
                    </button>
                    <a
                      href={run.html_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap shrink-0"
                    >
                      <span>View Logs</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>

                {isErrorLogExpanded && (
                  <div
                    id={`error-log-panel-${run.id}`}
                    data-testid={`error-log-panel-${run.id}`}
                    className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-300 font-mono">
                        <span className="font-semibold text-rose-600 dark:text-rose-400 inline-flex items-center gap-1.5">
                          <Terminal className="w-3.5 h-3.5" />
                          CI Failure Output
                        </span>
                        {logData?.failedJobs && logData.failedJobs.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {logData.failedJobs.map((j) => j.name).join(', ')}
                            </span>
                            {logData.failedJobs.some((j) => j.failedSteps.length > 0) && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-slate-500 dark:text-slate-400">
                                  Failed step:{' '}
                                  {logData.failedJobs
                                    .flatMap((j) => j.failedSteps.map((s) => s.name))
                                    .join(', ')}
                                </span>
                              </>
                            )}
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => void loadRunErrorLogs(run.id)}
                          disabled={Boolean(logEntry?.loading)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium cursor-pointer disabled:opacity-50 whitespace-nowrap"
                        >
                          <RefreshCw
                            className={`w-3 h-3 ${logEntry?.loading ? 'animate-spin' : ''}`}
                          />
                          <span>Refresh Log</span>
                        </button>
                        {copyPayload && (
                          <button
                            type="button"
                            onClick={() => void handleCopyErrorLog(runCacheKey, copyPayload)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium cursor-pointer whitespace-nowrap"
                          >
                            {copiedErrorRunKey === runCacheKey ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-500" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy Snippet</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {logEntry?.loading && (
                      <div
                        data-testid={`error-log-loading-${run.id}`}
                        className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2"
                      >
                        <div className="text-xs font-mono text-slate-400">
                          Fetching stderr and failed step annotations from GitHub Actions...
                        </div>
                        <div className="h-3 w-3/4 rounded bg-slate-800 animate-pulse" />
                        <div className="h-3 w-1/2 rounded bg-slate-800 animate-pulse" />
                      </div>
                    )}

                    {!logEntry?.loading && logEntry?.error && (
                      <div className="p-3 rounded-lg border border-rose-300 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-700 dark:text-rose-300 font-mono">
                        {logEntry.error}
                      </div>
                    )}

                    {!logEntry?.loading && !logEntry?.error && logData && (
                      <div className="space-y-2">
                        {logData.annotations.length > 0 && (
                          <div
                            data-testid={`error-log-annotations-${run.id}`}
                            className="p-3 rounded-lg border border-amber-300/70 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/25 space-y-1.5 text-xs font-mono"
                          >
                            {logData.annotations.map((ann, idx) => (
                              <div
                                key={`${ann.path}-${ann.startLine}-${idx}`}
                                className="text-amber-900 dark:text-amber-200 break-words"
                              >
                                <span className="font-semibold">
                                  {ann.path || 'workflow'}
                                  {ann.startLine > 0 ? `:${ann.startLine}` : ''}
                                  {ann.title ? ` (${ann.title})` : ''}:
                                </span>{' '}
                                <span>{ann.message}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {logData.stderrSnippet ? (
                          <div className="space-y-1">
                            <pre
                              data-testid={`error-log-snippet-${run.id}`}
                              className="p-3 rounded-lg bg-slate-950 text-slate-200 border border-slate-800 font-mono text-[11px] leading-relaxed overflow-x-auto max-h-72 whitespace-pre-wrap break-words tabular-nums"
                            >
                              {logData.stderrSnippet.split('\n').map((line, lineIdx) => {
                                const isErrLine =
                                  /(##\[error\]|\bstderr\b|\berror\b[:\s!]|\bERR!|\bfatal:|\bFAIL\b|\bAssertionError\b|\bTypeError\b|\bSyntaxError\b|\bReferenceError\b|\bException\b|exit code [1-9])/i.test(
                                    line
                                  );
                                return (
                                  <span
                                    key={lineIdx}
                                    className={`block ${
                                      isErrLine ? 'text-rose-400 font-medium' : 'text-slate-300'
                                    }`}
                                  >
                                    {line}
                                  </span>
                                );
                              })}
                            </pre>
                            {logData.truncated && (
                              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                Showing extracted failure tail snippet · use View Logs for the
                                complete archive.
                              </div>
                            )}
                          </div>
                        ) : (
                          <div
                            data-testid={`error-log-empty-${run.id}`}
                            className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs font-mono text-slate-600 dark:text-slate-400 flex flex-wrap items-center justify-between gap-2"
                          >
                            <span>
                              {logData.reason ||
                                'Raw stderr output is not available for this workflow run.'}
                            </span>
                            <a
                              href={logData.failedJobs?.[0]?.html_url || run.html_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-cyan-700 dark:text-cyan-400 hover:underline shrink-0"
                            >
                              <span>Open Job Logs</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {runs.length === 0 && (
            <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-800 text-center text-xs text-slate-500">
              No workflow runs found for {repo}.
            </div>
          )}
        </div>
      </div>

      {/* Pull Requests & Auto-Merge Section */}
      <div className="space-y-3 pt-2">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <GitPullRequest className="w-4 h-4 text-purple-500" />
          Active Pull Requests & Merge Gates
        </h3>
        <div className="grid gap-3">
          {pulls.map((pr) => (
            <div
              key={pr.number}
              className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-sm text-slate-900 dark:text-white">
                    PR #{pr.number}: {pr.title}
                  </div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">
                    {branchName(pr.head) && branchName(pr.base)
                      ? `${branchName(pr.head)} -> ${branchName(pr.base)} · `
                      : ''}requested by{' '}
                    {getPullAuthor(pr.user)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handlePullAction(pr.number, 'approve')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer shadow-sm"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{t.approvePrBtn}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePullAction(pr.number, 'merge')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold cursor-pointer shadow-sm"
                  >
                    <GitBranch className="w-3.5 h-3.5" />
                    <span>{t.autoMergeBtn}</span>
                  </button>
                  <a
                    href={pr.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
                  >
                    <span>View Diff</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          ))}
          {pulls.length === 0 && (
            <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-800 text-center text-xs text-slate-500">
              No open pull requests pending review.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminGitHubPipelineView;
