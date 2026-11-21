import React, { useEffect, useState } from 'react';
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
} from 'lucide-react';
import { adminService } from '../../services/adminService';
import { useI18n } from '../../utils/i18n';

interface Run {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  head_branch: string;
}

interface Pull {
  number: number;
  title: string;
  head?: string;
  base?: string;
  html_url: string;
  user: string | { login?: string };
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

  const load = async () => {
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
    } catch {
      setRuns([]);
      setPulls([]);
      setWarning('Unable to reach GitHub pipeline proxy.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [repo]);

  const handleRunAction = async (id: number | string, action: 'rerun' | 'cancel') => {
    setActionMsg(`Executing ${action} on run #${id}...`);
    try {
      await adminService.triggerGitHubRunAction(repo, id, action);
      setActionMsg(`Action "${action}" dispatched for run #${id}.`);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : `Failed to ${action} run #${id}.`);
    }
    setTimeout(() => setActionMsg(null), 4000);
    load();
  };

  const handlePullAction = async (number: number, action: 'approve' | 'merge') => {
    setActionMsg(`Executing ${action} on PR #${number}...`);
    try {
      await adminService.triggerGitHubPullAction(repo, number, action);
      setActionMsg(`PR #${number} ${action} completed.`);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : `Failed to ${action} PR #${number}.`);
    }
    setTimeout(() => setActionMsg(null), 4000);
    load();
  };

  const getPullAuthor = (user: Pull['user']): string => {
    if (typeof user === 'string') return user;
    return user?.login || 'contributor';
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 max-w-7xl mx-auto space-y-6 text-slate-800 dark:text-slate-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-emerald-500" />
              {t.githubPipelineTitle}
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900">
              GitOps Action Gate
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Trigger workflow reruns, approve pull requests, and auto-merge code directly from the
            SupremeAI admin cockpit.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
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
            onClick={load}
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

      {/* Workflow Runs Section */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Play className="w-4 h-4 text-cyan-500" />
          Recent GitHub Actions Workflow Runs
        </h3>
        <div className="grid gap-3">
          {runs.map((run) => {
            const isSuccess = run.conclusion === 'success';
            const isFailed = run.conclusion === 'failure';
            return (
              <div
                key={run.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div>
                  <div className="font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                    {run.name}
                    <span className="text-xs font-mono text-slate-400">#{run.id}</span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5 flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-cyan-600 dark:text-cyan-400">
                      {run.head_branch}
                    </span>
                    <span>·</span>
                    <span
                      className={`inline-flex items-center gap-1 font-bold ${
                        isSuccess
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
                    <span>{new Date(run.created_at).toLocaleTimeString()}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleRunAction(run.id, 'rerun')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer shadow-sm"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Rerun</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRunAction(run.id, 'cancel')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold cursor-pointer shadow-sm"
                  >
                    <XCircle className="w-3 h-3" />
                    <span>Cancel</span>
                  </button>
                  <a
                    href={run.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
                  >
                    <span>View Logs</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
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
                    {pr.head && pr.base ? `${pr.head} -> ${pr.base} · ` : ''}requested by{' '}
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
