import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Cpu,
  GitBranch,
  HelpCircle,
  Info,
  KeyRound,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Settings2,
  ShieldCheck,
  Stethoscope,
  Users,
  XCircle,
} from 'lucide-react';
import { useAdminHealthSummary } from '../../hooks/useAdminHealthSummary';
import { useAdminHealthStore } from '../../stores/useAdminHealthStore';
import { useAdminStore } from '../../stores/useAdminStore';
import { useControlCenterStore } from '../../stores/useControlCenterStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { toast } from '../../stores/useToastStore';
import { adminService } from '../../services/adminService';
import { buildUnifiedAdminLogs } from '../../utils/adminLogs';
import type {
  AdminAreaId,
  AdminAreaStatus,
  AdminIssue,
  AdminSeverity,
} from '../../utils/adminHealthSummary';

/**
 * বাংলা মন্তব্য: নতুন অ্যাডমিন ওভারভিউ ("Mission Control")। এক নজরে পুরো প্ল্যাটফর্ম:
 * ১) ওপরে বড় স্ট্যাটাস — সব ঠিক থাকলে সবুজ, সমস্যা থাকলে লাল/হলুদ।
 * ২) "Needs attention" — প্রতিটা সমস্যার পাশে বাটন, ক্লিক করলে ঠিক যেখানে ঠিক করা যায় সেই ট্যাবে যায়।
 * ৩) ৭টা এরিয়া টাইল (ইউজার, সার্ভিস, AI প্রোভাইডার, এজেন্ট, সিকিউরিটি, ডিপ্লয়, সেটিং)।
 * ৪) সব সার্ভিসের স্ট্যাটাস বোর্ড + সাম্প্রতিক লগ + সরাসরি ঠিক করার কুইক অ্যাকশন।
 * প্রতি মিনিটে নিজে থেকেই রিফ্রেশ হয় — কোনো বাটন চাপা বাধ্যতামূলক নয়।
 */

interface AdminMissionControlViewProps {
  onNavigateTab: (tab: string) => void;
}

const STATUS_STYLE: Record<
  AdminAreaStatus,
  { ring: string; dot: string; text: string; pill: string; label: string }
> = {
  ok: {
    ring: 'border-emerald-200 dark:border-emerald-500/25 hover:border-emerald-400',
    dot: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-300',
    pill: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
    label: 'Healthy',
  },
  warning: {
    ring: 'border-amber-300 dark:border-amber-500/40 hover:border-amber-500',
    dot: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-300',
    pill: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    label: 'Warning',
  },
  critical: {
    ring: 'border-rose-400 dark:border-rose-500/60 hover:border-rose-500 shadow-[0_0_0_1px_rgba(244,63,94,0.25)]',
    dot: 'bg-rose-500 animate-pulse',
    text: 'text-rose-700 dark:text-rose-300',
    pill: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
    label: 'Problem',
  },
  unknown: {
    ring: 'border-slate-200 dark:border-slate-800 hover:border-slate-400',
    dot: 'bg-slate-400',
    text: 'text-slate-500 dark:text-slate-400',
    pill: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    label: 'No data',
  },
};

const AREA_ICON: Record<AdminAreaId, React.ReactNode> = {
  users: <Users className="w-4 h-4" />,
  services: <Activity className="w-4 h-4" />,
  ai: <Cpu className="w-4 h-4" />,
  agents: <Bot className="w-4 h-4" />,
  security: <ShieldCheck className="w-4 h-4" />,
  deploy: <GitBranch className="w-4 h-4" />,
  settings: <Settings2 className="w-4 h-4" />,
};

const SEVERITY_ICON: Record<AdminSeverity, React.ReactNode> = {
  critical: <XCircle className="w-4 h-4 text-rose-500 shrink-0" />,
  warning: <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />,
  info: <Info className="w-4 h-4 text-sky-500 shrink-0" />,
};

const TONE_CLASS = {
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-rose-600 dark:text-rose-400',
  warn: 'text-amber-600 dark:text-amber-400',
  muted: 'text-slate-700 dark:text-slate-200',
} as const;

const LOG_DOT = {
  error: 'bg-rose-500',
  warn: 'bg-amber-500',
  info: 'bg-slate-400',
} as const;

export function formatRelativeTime(ts: number | null, now = Date.now()): string {
  if (!ts) return 'never';
  const diff = Math.max(0, Math.round((now - ts) / 1000));
  if (diff < 10) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export const AdminMissionControlView: React.FC<AdminMissionControlViewProps> = ({
  onNavigateTab,
}) => {
  const summary = useAdminHealthSummary();
  const { lastRefreshedAt, isRefreshing, refreshAll, providers, deployments } =
    useAdminHealthStore();
  const { mcpServices, securityEvents, auditRecords, swarmWorkers, retryAllDlq } = useAdminStore();
  const { healthSnapshot, runServiceHealthProbe, runDeepDiagnose, isDiagnosing, isProbingHealth } =
    useControlCenterStore();
  const authUser = useAuthStore((s) => s.authUser);
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const recentLogs = useMemo(
    () =>
      buildUnifiedAdminLogs({
        mcpServices,
        alerts: healthSnapshot?.alerts ?? [],
        deployments,
        providers,
        securityEvents,
        auditRecords,
        workers: swarmWorkers,
      })
        .filter((l) => l.ts > 0)
        .slice(0, 8),
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

  const { overall, counts, issues, areas, services, score } = summary;
  const actionable = issues.filter((i) => i.severity !== 'info');
  const visibleIssues = showAllIssues ? issues : issues.slice(0, 6);

  const hero =
    overall === 'critical'
      ? {
          bg: 'from-rose-600 to-rose-700',
          icon: <XCircle className="w-9 h-9" />,
          title: `${counts.critical} critical problem${counts.critical === 1 ? '' : 's'} need${counts.critical === 1 ? 's' : ''} attention`,
        }
      : overall === 'warning'
        ? {
            bg: 'from-amber-500 to-orange-600',
            icon: <AlertTriangle className="w-9 h-9" />,
            title: `${counts.warning} warning${counts.warning === 1 ? '' : 's'} to review`,
          }
        : overall === 'unknown'
          ? {
              bg: 'from-slate-600 to-slate-700',
              icon: <HelpCircle className="w-9 h-9" />,
              title: 'Collecting live data…',
            }
          : {
              bg: 'from-emerald-600 to-teal-600',
              icon: <CheckCircle2 className="w-9 h-9" />,
              title: 'All systems normal',
            };

  const runAction = async (id: string, fn: () => Promise<unknown> | unknown, done: string) => {
    setBusyAction(id);
    try {
      await fn();
      toast.success(done);
      await refreshAll({ force: true });
    } catch (error) {
      toast.error('Action failed', error instanceof Error ? error.message : undefined);
    } finally {
      setBusyAction(null);
    }
  };

  const quickActions = [
    {
      id: 'probe',
      label: 'Re-check all services',
      icon: <Stethoscope className="w-4 h-4" />,
      busy: isProbingHealth || busyAction === 'probe',
      run: () =>
        runAction('probe', () => runServiceHealthProbe(authUser?.email), 'Health check finished'),
    },
    {
      id: 'keys',
      label: 'Test all provider keys',
      icon: <KeyRound className="w-4 h-4" />,
      busy: busyAction === 'keys',
      run: () => runAction('keys', () => adminService.probeAllProviders(), 'Provider keys tested'),
    },
    {
      id: 'dlq',
      label: 'Retry failed jobs',
      icon: <RotateCcw className="w-4 h-4" />,
      busy: busyAction === 'dlq',
      run: () => runAction('dlq', () => retryAllDlq(), 'Failed jobs sent for retry'),
    },
    {
      id: 'diagnose',
      label: 'Run full diagnose',
      icon: <Activity className="w-4 h-4" />,
      busy: isDiagnosing || busyAction === 'diagnose',
      run: () =>
        runAction(
          'diagnose',
          () => runDeepDiagnose('api', 'is_healthy', authUser?.email),
          'Diagnose finished'
        ),
    },
  ];

  const renderIssue = (issue: AdminIssue) => (
    <li
      key={issue.id}
      className={`flex items-start gap-3 p-3 rounded-xl border ${
        issue.severity === 'critical'
          ? 'border-rose-200 bg-rose-50/70 dark:border-rose-500/30 dark:bg-rose-500/[0.07]'
          : issue.severity === 'warning'
            ? 'border-amber-200 bg-amber-50/60 dark:border-amber-500/25 dark:bg-amber-500/[0.06]'
            : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
      }`}
    >
      <span className="mt-0.5">{SEVERITY_ICON[issue.severity]}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-slate-900 dark:text-white">
          {issue.title}
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 break-words">
          {issue.detail}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onNavigateTab(issue.targetTab)}
        className={`shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
          issue.severity === 'critical'
            ? 'bg-rose-600 text-white hover:bg-rose-700'
            : 'bg-slate-900 text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200'
        }`}
      >
        <span>{issue.actionLabel}</span>
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </li>
  );

  return (
    <div
      data-testid="admin-mission-control"
      className="flex-1 overflow-y-auto bg-[#f6f8fb] dark:bg-slate-950 px-4 sm:px-6 py-5 text-slate-800 dark:text-slate-200"
    >
      <div className="max-w-7xl mx-auto space-y-5">
        {/* 1. Big status banner */}
        <section
          data-testid="admin-overall-status"
          data-status={overall}
          className={`rounded-2xl bg-gradient-to-br ${hero.bg} text-white px-5 sm:px-7 py-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4`}
        >
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
              {hero.icon}
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{hero.title}</h1>
              <p className="text-[12.5px] text-white/85 mt-0.5">
                {services.length} services · {counts.critical} critical · {counts.warning} warnings
                · updated {formatRelativeTime(lastRefreshedAt)} · auto-refresh every minute
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <div className="text-right">
              <div className="text-3xl font-bold font-mono tabular-nums leading-none">{score}</div>
              <div className="text-[11px] text-white/80">health score</div>
            </div>
            <button
              type="button"
              onClick={() => void refreshAll({ force: true })}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-semibold cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? 'Refreshing…' : 'Refresh now'}</span>
            </button>
          </div>
        </section>

        {/* 2. Needs attention */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Needs attention{' '}
              <span className="font-mono text-slate-400 font-normal">({actionable.length})</span>
            </h2>
            {issues.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAllIssues((v) => !v)}
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                {showAllIssues ? 'Show less' : `Show all ${issues.length}`}
              </button>
            )}
          </div>
          {issues.length === 0 ? (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/[0.07] text-emerald-700 dark:text-emerald-300 text-[13px] font-medium">
              <CheckCircle2 className="w-4 h-4" />
              Nothing needs your attention right now.
            </div>
          ) : (
            <ul className="space-y-2" data-testid="admin-issue-list">
              {visibleIssues.map(renderIssue)}
            </ul>
          )}
        </section>

        {/* 3. Area tiles */}
        <section
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3"
          aria-label="Platform areas"
        >
          {areas.map((area) => {
            const style = STATUS_STYLE[area.status];
            return (
              <button
                key={area.id}
                type="button"
                data-testid={`admin-area-${area.id}`}
                data-status={area.status}
                onClick={() => onNavigateTab(area.targetTab)}
                className={`text-left p-4 rounded-2xl border-2 bg-white dark:bg-slate-900 transition-colors cursor-pointer space-y-2.5 ${style.ring}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-900 dark:text-white">
                    <span className={style.text}>{AREA_ICON[area.id]}</span>
                    {area.label}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${style.pill}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                    {style.label}
                  </span>
                </div>
                <p className={`text-xs font-medium leading-snug ${style.text}`}>{area.headline}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
                  {area.metrics.map((m) => (
                    <div key={m.label} className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">
                        {m.label}
                      </div>
                      <div
                        className={`text-sm font-bold font-mono tabular-nums ${TONE_CLASS[m.tone ?? 'muted']}`}
                      >
                        {m.value}
                      </div>
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </section>

        {/* 4. Quick fixes */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Quick fixes</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {quickActions.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={a.run}
                disabled={a.busy}
                className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-slate-800 text-xs font-semibold cursor-pointer disabled:opacity-60"
              >
                {a.busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : a.icon}
                <span>{a.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* 5. Services board + recent logs */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <section className="lg:col-span-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Service status</h2>
              <button
                type="button"
                onClick={() => onNavigateTab('health-monitor')}
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Open health monitor →
              </button>
            </div>
            {services.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">
                Waiting for the first health check…
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {services.map((svc) => {
                  const style =
                    STATUS_STYLE[svc.status === 'ok' ? 'ok' : (svc.status as AdminAreaStatus)];
                  return (
                    <li key={svc.id}>
                      <button
                        type="button"
                        onClick={() => onNavigateTab(svc.targetTab)}
                        className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg px-2 -mx-2 cursor-pointer"
                      >
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${style.dot}`} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-slate-900 dark:text-white truncate">
                            {svc.name}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {svc.provider} · {svc.detail}
                          </div>
                        </div>
                        <span className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0">
                          {svc.latencyMs !== null ? `${svc.latencyMs} ms` : ''}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold shrink-0 ${style.pill}`}
                        >
                          {svc.statusLabel}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <ScrollText className="w-4 h-4 text-slate-400" />
                Recent activity
              </h2>
              <button
                type="button"
                onClick={() => onNavigateTab('admin-logs')}
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                All logs →
              </button>
            </div>
            {recentLogs.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">No recent activity.</p>
            ) : (
              <ul className="space-y-2">
                {recentLogs.map((log) => (
                  <li key={log.id}>
                    <button
                      type="button"
                      onClick={() => onNavigateTab(log.targetTab)}
                      className="w-full flex items-start gap-2.5 text-left cursor-pointer group"
                    >
                      <span
                        className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${LOG_DOT[log.level]}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-slate-800 dark:text-slate-200 truncate group-hover:underline">
                          {log.message}
                        </div>
                        <div className="text-[10.5px] text-slate-500 truncate">
                          {log.provider} · {formatRelativeTime(log.ts)}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default AdminMissionControlView;
