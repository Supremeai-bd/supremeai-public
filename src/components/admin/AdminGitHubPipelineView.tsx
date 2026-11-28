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
  Layers,
} from 'lucide-react';
import {
  GITHUB_MONOREPO_SLUG,
  GITHUB_PUBLIC_REPO_SLUG,
  MANAGED_GITHUB_REPOS,
} from '../../config/platformEndpoints';
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
  extractRepoFromGitHubUrl,
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

type Run = GitHubWorkflowRun & { repo: string };
type BranchRef = GitHubBranchRef;
type Pull = GitHubPullRequest & { repo: string };
type RepoScope = 'all' | string;

interface RepoSnapshot {
  runs: Run[];
  pulls: Pull[];
  tokenConfigured: boolean;
  warning: string | null;
}

/** GitHub returns `head`/`base` as objects; the gateway returns plain strings. */
export function branchName(ref: BranchRef): string {
  if (!ref) return '';
  if (typeof ref === 'string') return ref;
  return String(ref.ref || ref.label || '');
}

function normalizeRepoSlug(candidate: string | null | undefined, fallback: string): string {
  const raw = (candidate || '').trim();
  if (!raw) return fallback;
  const matched = MANAGED_GITHUB_REPOS.find((m) => m.slug.toLowerCase() === raw.toLowerCase());
  return matched ? matched.slug : raw;
}

export const AdminGitHubPipelineView: React.FC = () => {
  const { t } = useI18n();
  const [scope, setScope] = useState<RepoScope>('all');
  const [snapshots, setSnapshots] = useState<Record<string, RepoSnapshot>>({});
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

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const results = await Promise.all(
        MANAGED_GITHUB_REPOS.map(async (managed) => {
          try {
            const [runsRes, pullsRes] = await Promise.all([
              adminService.fetchGitHubRuns(managed.slug),
              adminService.fetchGitHubPulls(managed.slug),
            ]);
            const runs: Run[] = (Array.isArray(runsRes?.runs) ? runsRes.runs : []).map((r) => ({
              ...r,
              repo: normalizeRepoSlug(
                r.repo || extractRepoFromGitHubUrl(r.html_url),
                managed.slug
              ),
            }));
            const pulls: Pull[] = (Array.isArray(pullsRes?.pulls) ? pullsRes.pulls : []).map(
              (p) => ({
                ...p,
                repo: normalizeRepoSlug(
                  p.repo || extractRepoFromGitHubUrl(p.html_url),
                  managed.slug
                ),
              })
            );
            return {
              slug: managed.slug,
              ok: true,
              snapshot: {
                runs,
                pulls,
                tokenConfigured:
                  runsRes?.tokenConfigured !== false && pullsRes?.tokenConfigured !== false,
                warning: runsRes?.warning || pullsRes?.warning || null,
              } satisfies RepoSnapshot,
            };
          } catch {
            return {
              slug: managed.slug,
              ok: false,
              snapshot: {
                runs: [],
                pulls: [],
                tokenConfigured: true,
                warning: `Unable to reach GitHub pipeline proxy for ${managed.slug}.`,
              } satisfies RepoSnapshot,
            };
          }
        })
      );

      const nextSnapshots: Record<string, RepoSnapshot> = {};
      let anyOk = false;
      for (const item of results) {
        nextSnapshots[item.slug] = item.snapshot;
        if (item.ok) anyOk = true;
      }
      setSnapshots(nextSnapshots);
      setHasLoaded(anyOk);
      if (anyOk) {
        setLastUpdatedMs(Date.now());
      }
      setNowMs(Date.now());
    } finally {
      setIsLoading(false);
    }
  }, []);

  const { runs, pulls, tokenOk, warning } = useMemo(() => {
    if (scope !== 'all') {
      const snap = snapshots[scope];
      return {
        runs: snap?.runs ?? [],
        pulls: snap?.pulls ?? [],
        tokenOk: snap ? snap.tokenConfigured : true,
        warning: snap?.warning ?? null,
      };
    }

    const seenRuns = new Set<string>();
    const mergedRuns: Run[] = [];
    const seenPulls = new Set<string>();
    const mergedPulls: Pull[] = [];
    const warnings: string[] = [];
    let anyTokenMissing = false;

    for (const managed of MANAGED_GITHUB_REPOS) {
      const snap = snapshots[managed.slug];
      if (!snap) continue;
      if (!snap.tokenConfigured && managed.visibility === 'private') {
        anyTokenMissing = true;
      }
      if (snap.warning) warnings.push(`${managed.shortName}: ${snap.warning}`);

      for (const r of snap.runs) {
        const dedupeKey = r.html_url?.trim() || `${r.repo}:${r.id}`;
        if (seenRuns.has(dedupeKey)) continue;
        seenRuns.add(dedupeKey);
        mergedRuns.push(r);
      }
      for (const p of snap.pulls) {
        const dedupeKey = p.html_url?.trim() || `${p.repo}#${p.number}`;
        if (seenPulls.has(dedupeKey)) continue;
        seenPulls.add(dedupeKey);
        mergedPulls.push(p);
      }
    }

    mergedRuns.sort(
      (a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)
    );
    mergedPulls.sort(
      (a, b) => (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0)
    );

    return {
      runs: mergedRuns,
      pulls: mergedPulls,
      tokenOk: !anyTokenMissing,
      warning: warnings.length > 0 ? warnings.join(' · ') : null,
    };
  }, [scope, snapshots]);

  const activeScopeLabel =
    scope === 'all' ? `${GITHUB_MONOREPO_SLUG} + ${GITHUB_PUBLIC_REPO_SLUG}` : scope;

  const hasActiveRun = useMemo(() => runs.some((r) => isRunActive(r)), [runs]);

  const trendsSummary = useMemo(
    () => computeDeploymentTrends(runs, nowMs, scope === 'all' ? '' : scope),
    [runs, nowMs, scope]
  );
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

  useEffect(() => {
    void load();
    const pollMs = hasActiveRun ? 8000 : 30000;
    const timer = setInterval(() => {
      void load();
    }, pollMs);
    return () => clearInterval(timer);
  }, [load, hasActiveRun]);

  useEffect(() => {
    if (!hasActiveRun) return;
    setNowMs(Date.now());
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [hasActiveRun]);

  useEffect(() => {
    if (!durationAlert.exceeded) {
      lastAlertedKeyRef.current = null;
      return;
    }
    const alertKey = `${scope}:${durationAlert.thresholdMs}`;
    if (lastAlertedKeyRef.current === alertKey) return;
    lastAlertedKeyRef.current = alertKey;
    setAlertAcknowledged(false);
    toast.warning(
      'Deployment Duration Threshold Exceeded',
      `${activeScopeLabel} average (${formatPipelineDuration(durationAlert.avgDurationMs)}) exceeds ${formatPipelineDuration(durationAlert.thresholdMs)} limit.`,
      6000
    );
  }, [
    durationAlert.exceeded,
    durationAlert.avgDurationMs,
    durationAlert.thresholdMs,
    scope,
    activeScopeLabel,
  ]);

  const dataSource = useDataSource({
    loaded: hasLoaded,
    lastUpdatedMs,
    error: warning,
  });

  const handleRunAction = async (
    targetRepo: string,
    id: number | string,
    action: 'rerun' | 'cancel'
  ) => {
    setActionMsg(`Executing ${action} on ${targetRepo} run #${id}...`);
    try {
      await adminService.triggerGitHubRunAction(targetRepo, id, action);
      setActionMsg(`Action "${action}" dispatched for ${targetRepo} run #${id}.`);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : `Failed to ${action} run #${id}.`);
    }
    setTimeout(() => setActionMsg(null), 4000);
    void load();
  };

  const handlePullAction = async (
    targetRepo: string,
    number: number,
    action: 'approve' | 'merge'
  ) => {
    setActionMsg(`Executing ${action} on ${targetRepo} PR #${number}...`);
    try {
      await adminService.triggerGitHubPullAction(targetRepo, number, action);
      setActionMsg(`${targetRepo} PR #${number} ${action} completed.`);
      toast.success(
        `${targetRepo} PR #${number}`,
        action === 'approve' ? 'Approved on GitHub.' : 'Merged on GitHub.'
      );
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

  const loadRunErrorLogs = useCallback(async (targetRepo: string, runId: number | string) => {
    const cacheKey = `${targetRepo}:${runId}`;
    setErrorLogsByKey((prev) => ({
      ...prev,
      [cacheKey]: { ...prev[cacheKey], loading: true, error: null },
    }));
    try {
      const data = await adminService.fetchGitHubRunErrorLogs(targetRepo, runId);
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
  }, []);

  const handleToggleErrorLog = useCallback(
    (targetRepo: string, runId: number | string) => {
      const cacheKey = `${targetRepo}:${runId}`;
      const currentlyExpanded = Boolean(expandedErrorRuns[cacheKey]);
      setExpandedErrorRuns((prev) => ({ ...prev, [cacheKey]: !currentlyExpanded }));
      if (!currentlyExpanded) {
        const existing = errorLogsByKey[cacheKey];
        if (!existing || (!existing.loading && !existing.data)) {
          void loadRunErrorLogs(targetRepo, runId);
        }
      }
    },
    [expandedErrorRuns, errorLogsByKey, loadRunErrorLogs]
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
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
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
            Trigger workflow reruns, approve pull requests, and auto-merge code across{' '}
            <span className="font-mono text-slate-700 dark:text-slate-300">
              {GITHUB_MONOREPO_SLUG}
            </span>{' '}
            and{' '}
            <span className="font-mono text-slate-700 dark:text-slate-300">
              {GITHUB_PUBLIC_REPO_SLUG}
            </span>
            .
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="GitHub repository scope"
            className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900/90"
          >
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'all'}
              data-testid="repo-tab-all"
              onClick={() => {
                setScope('all');
                setAlertAcknowledged(false);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                scope === 'all'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold shadow-xs border border-slate-200/80 dark:border-slate-700'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
              <span>All Repos ({MANAGED_GITHUB_REPOS.length})</span>
            </button>
            {MANAGED_GITHUB_REPOS.map((managed) => {
              const selected = scope === managed.slug;
              return (
                <button
                  key={managed.slug}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  data-testid={`repo-tab-${managed.slug}`}
                  onClick={() => {
                    setScope(managed.slug);
                    setAlertAcknowledged(false);
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                    selected
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold shadow-xs border border-slate-200/80 dark:border-slate-700'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <span>{managed.slug}</span>
                </button>
              );
            })}
          </div>

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

      {/* Dual-Repository Overview Strip (always displays both Supremeai-bd/supremeai and Supremeai-bd/supremeai-public) */}
      <div
        data-testid="managed-repos-overview"
        className="grid grid-cols-1 md:grid-cols-2 gap-3"
      >
        {MANAGED_GITHUB_REPOS.map((managed) => {
          const snap = snapshots[managed.slug];
          const repoRuns = (snap?.runs ?? []).filter(
            (r) => r.repo.toLowerCase() === managed.slug.toLowerCase()
          );
          const repoPulls = (snap?.pulls ?? []).filter(
            (p) => p.repo.toLowerCase() === managed.slug.toLowerCase()
          );
          const repoTrends = computeDeploymentTrends(repoRuns, nowMs, managed.slug);
          const isSelected = scope === managed.slug;

          const statusDotClass =
            repoTrends.overallHealth === 'active'
              ? 'bg-cyan-400 animate-pulse'
              : repoTrends.overallHealth === 'healthy'
                ? 'bg-emerald-500'
                : repoTrends.overallHealth === 'degraded'
                  ? 'bg-amber-500'
                  : repoTrends.overallHealth === 'failing'
                    ? 'bg-rose-500'
                    : 'bg-slate-400';

          return (
            <div
              key={managed.slug}
              data-testid={`repo-card-${managed.slug}`}
              onClick={() => {
                setScope((curr) => (curr === managed.slug ? 'all' : managed.slug));
                setAlertAcknowledged(false);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setScope((curr) => (curr === managed.slug ? 'all' : managed.slug));
                  setAlertAcknowledged(false);
                }
              }}
              className={`p-3.5 rounded-xl border transition-colors cursor-pointer flex items-center justify-between gap-3 ${
                isSelected
                  ? 'border-cyan-500/70 bg-cyan-50/40 dark:bg-cyan-950/25 shadow-xs'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotClass}`} />
                  <span className="font-mono text-xs font-bold text-slate-900 dark:text-white truncate">
                    {managed.slug}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700">
                    {managed.roleLabel}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-2 tabular-nums">
                  <span>
                    {repoTrends.successRatePercent !== null
                      ? `${repoTrends.successRatePercent}% pass`
                      : 'No completed runs'}
                  </span>
                  <span>·</span>
                  <span>{repoRuns.length} runs</span>
                  <span>·</span>
                  <span
                    className={
                      repoPulls.length > 0 ? 'text-purple-600 dark:text-purple-400 font-semibold' : ''
                    }
                  >
                    {repoPulls.length} open {repoPulls.length === 1 ? 'PR' : 'PRs'}
                  </span>
                </div>
              </div>

              <a
                href={managed.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={`Open ${managed.slug} on GitHub`}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              >
                <span>GitHub</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          );
        })}
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
        repo={scope === 'all' ? '' : scope}
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
            const runRepo = run.repo || GITHUB_MONOREPO_SLUG;
            const isPublicRepo =
              runRepo.toLowerCase() === GITHUB_PUBLIC_REPO_SLUG.toLowerCase();
            const isSuccess = run.conclusion === 'success';
            const isFailed = classifyRunOutcome(run) === 'failure';
            const active = isRunActive(run);
            const durationLabel = formatPipelineDuration(computeRunDurationMs(run, nowMs));
            const shortSha = formatShortCommitSha(run.head_sha);
            const commitUrl = buildGitHubCommitUrl(runRepo, run.head_sha, run.html_url);
            const runCacheKey = `${runRepo}:${run.id}`;
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
                key={runCacheKey}
                data-testid={`workflow-run-row-${run.id}`}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 flex flex-col gap-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-slate-900 dark:text-white flex flex-wrap items-center gap-2">
                      <span
                        data-testid={`run-repo-badge-${run.id}`}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border shrink-0 ${
                          isPublicRepo
                            ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/70'
                            : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/70'
                        }`}
                      >
                        {runRepo}
                      </span>
                      <span className="truncate">{run.name}</span>
                      <span className="text-xs font-mono tabular-nums text-slate-400 shrink-0">
                        #{run.id}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-1 flex flex-wrap items-center gap-2">
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
                        onClick={() => handleToggleErrorLog(runRepo, run.id)}
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
                      onClick={() => handleRunAction(runRepo, run.id, 'rerun')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer shadow-sm whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Rerun</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRunAction(runRepo, run.id, 'cancel')}
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
                            <span>{logData.failedJobs.map((j) => j.name).join(', ')}</span>
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
                          onClick={() => void loadRunErrorLogs(runRepo, run.id)}
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
              No workflow runs found for {activeScopeLabel}.
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
          {pulls.map((pr) => {
            const prRepo = pr.repo || GITHUB_MONOREPO_SLUG;
            const isPublicRepo =
              prRepo.toLowerCase() === GITHUB_PUBLIC_REPO_SLUG.toLowerCase();
            return (
              <div
                key={`${prRepo}#${pr.number}`}
                data-testid={`pull-request-row-${prRepo}-${pr.number}`}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-sm text-slate-900 dark:text-white flex flex-wrap items-center gap-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border shrink-0 ${
                          isPublicRepo
                            ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/70'
                            : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/70'
                        }`}
                      >
                        {prRepo}
                      </span>
                      <span>
                        PR #{pr.number}: {pr.title}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 font-mono mt-1">
                      {branchName(pr.head) && branchName(pr.base)
                        ? `${branchName(pr.head)} -> ${branchName(pr.base)} · `
                        : ''}
                      requested by {getPullAuthor(pr.user)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handlePullAction(prRepo, pr.number, 'approve')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer shadow-sm"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{t.approvePrBtn}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePullAction(prRepo, pr.number, 'merge')}
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
            );
          })}
          {pulls.length === 0 && (
            <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-800 text-center text-xs text-slate-500">
              No open pull requests pending review across {activeScopeLabel}.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminGitHubPipelineView;
