import React, { useId, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  BellRing,
  CheckCircle2,
  Clock,
  GitCommitHorizontal,
  Minus,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { DataSourceBadge } from '../common/DataSourceBadge';
import type { DataSourceState } from '../../hooks/useDataSource';
import {
  computeDeploymentTrends,
  DURATION_THRESHOLD_PRESETS_MS,
  evaluateDurationAlert,
  formatPipelineDuration,
  type DeploymentTimelinePoint,
  type GitHubWorkflowRun,
  type PipelineHealthStatus,
} from '../../utils/githubPipelineMetrics';

// বাংলা মন্তব্য: শেষ ১০টি ডিপ্লয়মেন্টের রিয়েল-টাইম ডিউরেশন, সাফল্যের মিনি-লাইন চার্ট এবং থ্রেশহোল্ড অ্যালার্ট ব্যাজ।
export interface GitHubPipelineStatusIndicatorProps {
  runs: GitHubWorkflowRun[];
  nowMs: number;
  isLoading: boolean;
  lastUpdatedMs?: number;
  dataSource: DataSourceState;
  repo: string;
  durationThresholdMs: number;
  onChangeDurationThreshold: (nextMs: number) => void;
  alertAcknowledged: boolean;
  onToggleAcknowledgeAlert: () => void;
}

interface HealthAppearance {
  label: string;
  badgeClass: string;
  icon: React.ReactNode;
}

function getHealthAppearance(
  status: PipelineHealthStatus,
  activeCount: number
): HealthAppearance {
  switch (status) {
    case 'active':
      return {
        label: activeCount > 1 ? `Running (${activeCount} active)` : 'Live Run Active',
        badgeClass:
          'text-cyan-700 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-950/60 border-cyan-200 dark:border-cyan-800/70',
        icon: <Activity className="w-3.5 h-3.5 text-cyan-500" />,
      };
    case 'healthy':
      return {
        label: 'Nominal',
        badgeClass:
          'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800/70',
        icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
      };
    case 'degraded':
      return {
        label: 'Degraded',
        badgeClass:
          'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800/70',
        icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />,
      };
    case 'failing':
      return {
        label: 'Failing',
        badgeClass:
          'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800/70',
        icon: <XCircle className="w-3.5 h-3.5 text-rose-500" />,
      };
    case 'empty':
      return {
        label: 'No Deployments',
        badgeClass:
          'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700',
        icon: <Clock className="w-3.5 h-3.5 text-slate-400" />,
      };
    default:
      return {
        label: 'Pending Signal',
        badgeClass:
          'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700',
        icon: <Clock className="w-3.5 h-3.5 text-slate-400" />,
      };
  }
}

function getBarColorClass(outcome: DeploymentTimelinePoint['outcome'], isSelected: boolean): string {
  if (outcome === 'active') {
    return isSelected ? 'bg-cyan-400 dark:bg-cyan-300' : 'bg-cyan-500/85 hover:bg-cyan-400';
  }
  if (outcome === 'success') {
    return isSelected
      ? 'bg-emerald-500 dark:bg-emerald-400'
      : 'bg-emerald-500/80 hover:bg-emerald-500';
  }
  if (outcome === 'failure') {
    return isSelected ? 'bg-rose-500 dark:bg-rose-400' : 'bg-rose-500/85 hover:bg-rose-500';
  }
  if (outcome === 'cancelled') {
    return isSelected ? 'bg-amber-500 dark:bg-amber-400' : 'bg-amber-500/80 hover:bg-amber-500';
  }
  return isSelected ? 'bg-slate-500 dark:bg-slate-400' : 'bg-slate-400/70 hover:bg-slate-500';
}

function getPointDotColorClass(outcome: DeploymentTimelinePoint['outcome']): string {
  if (outcome === 'active') return 'fill-cyan-500 stroke-white dark:stroke-slate-900';
  if (outcome === 'success') return 'fill-emerald-500 stroke-white dark:stroke-slate-900';
  if (outcome === 'failure') return 'fill-rose-500 stroke-white dark:stroke-slate-900';
  if (outcome === 'cancelled') return 'fill-amber-500 stroke-white dark:stroke-slate-900';
  return 'fill-slate-400 stroke-white dark:stroke-slate-900';
}

export const GitHubPipelineStatusIndicator: React.FC<GitHubPipelineStatusIndicatorProps> = ({
  runs,
  nowMs,
  isLoading,
  lastUpdatedMs,
  dataSource,
  repo,
  durationThresholdMs,
  onChangeDurationThreshold,
  alertAcknowledged,
  onToggleAcknowledgeAlert,
}) => {
  // বাংলা মন্তব্য: রিপোর নামসহ ট্রেন্ড ও প্রতিটি ডিপ্লয়মেন্টের কমিট লিংক তৈরি করা হচ্ছে।
  const trends = useMemo(() => computeDeploymentTrends(runs, nowMs, repo), [runs, nowMs, repo]);
  const durationAlert = useMemo(
    () => evaluateDurationAlert(trends.avgDurationMs, durationThresholdMs),
    [trends.avgDurationMs, durationThresholdMs]
  );
  const [inspectedRunId, setInspectedRunId] = useState<number | string | null>(null);
  const gradientId = useId();

  const appearance = getHealthAppearance(trends.overallHealth, trends.activeCount);

  const inspectedPoint = useMemo(() => {
    if (trends.timeline.length === 0) return null;
    if (inspectedRunId !== null) {
      const found = trends.timeline.find((p) => p.id === inspectedRunId);
      if (found) return found;
    }
    return trends.timeline[trends.timeline.length - 1];
  }, [trends.timeline, inspectedRunId]);

  const maxBarDurationMs = useMemo(() => {
    const valid = trends.timeline
      .map((t) => t.durationMs)
      .filter((d): d is number => typeof d === 'number' && d > 0);
    const maxData = valid.length > 0 ? Math.max(...valid) : 1000;
    return Math.max(maxData, durationThresholdMs);
  }, [trends.timeline, durationThresholdMs]);

  const thresholdLineBottomPct = useMemo(() => {
    if (maxBarDurationMs <= 0) return null;
    return Math.min(96, Math.max(8, Math.round((durationThresholdMs / maxBarDurationMs) * 100)));
  }, [durationThresholdMs, maxBarDurationMs]);

  // বাংলা মন্তব্য: শেষ ১০টি ডিপ্লয়মেন্টের সাফল্যের হারের মিনি-লাইন চার্টের কোঅর্ডিনেট (SVG 220x56)।
  const miniLineGeometry = useMemo(() => {
    const W = 220;
    const H = 56;
    const padX = 10;
    const padTop = 7;
    const padBottom = 7;
    const usableW = W - padX * 2;
    const usableH = H - padTop - padBottom;

    const validPoints: Array<{
      point: DeploymentTimelinePoint;
      x: number;
      y: number;
      rate: number;
    }> = [];

    const count = trends.timeline.length;
    trends.timeline.forEach((pt, idx) => {
      if (pt.rollingSuccessRate === null) return;
      const x = count === 1 ? W / 2 : padX + (idx / (count - 1)) * usableW;
      const y = padTop + (1 - pt.rollingSuccessRate / 100) * usableH;
      validPoints.push({ point: pt, x, y, rate: pt.rollingSuccessRate });
    });

    const linePath =
      validPoints.length > 0
        ? validPoints
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
            .join(' ')
        : '';

    const areaPath =
      validPoints.length >= 2
        ? `${linePath} L ${validPoints[validPoints.length - 1].x.toFixed(1)} ${(
            H - padBottom
          ).toFixed(1)} L ${validPoints[0].x.toFixed(1)} ${(H - padBottom).toFixed(1)} Z`
        : '';

    return { W, H, padTop, padBottom, usableH, validPoints, linePath, areaPath };
  }, [trends.timeline]);

  const latestCompletedDelta = useMemo(() => {
    if (
      trends.latestDurationMs === null ||
      trends.avgDurationMs === null ||
      trends.avgDurationMs <= 0
    ) {
      return null;
    }
    return Math.round(
      ((trends.latestDurationMs - trends.avgDurationMs) / trends.avgDurationMs) * 100
    );
  }, [trends.latestDurationMs, trends.avgDurationMs]);

  const updatedLabel = lastUpdatedMs
    ? new Date(lastUpdatedMs).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : 'Syncing';

  const pollIntervalLabel = trends.activeCount > 0 ? '8s live poll' : '30s poll';

  const lineStrokeClass =
    trends.successRatePercent === null
      ? 'text-slate-400'
      : trends.successRatePercent >= 80
        ? 'text-emerald-500'
        : trends.successRatePercent >= 50
          ? 'text-amber-500'
          : 'text-rose-500';

  const thresholdChoices = useMemo(() => {
    const set = new Set<number>(DURATION_THRESHOLD_PRESETS_MS);
    set.add(durationThresholdMs);
    return Array.from(set).sort((a, b) => a - b);
  }, [durationThresholdMs]);

  return (
    <section
      id="github-pipeline-status-indicator"
      aria-label="GitHub Deployment Status & Trend Indicator"
      data-testid="github-pipeline-status-indicator"
      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 overflow-hidden"
    >
      {/* Top Status Strip + Threshold Alert Notification Badge */}
      <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div
            data-testid="pipeline-health-status"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-semibold whitespace-nowrap shrink-0 ${appearance.badgeClass}`}
          >
            {appearance.icon}
            <span>{appearance.label}</span>
          </div>

          {durationAlert.exceeded && (
            <div
              role="status"
              aria-live="polite"
              data-testid="duration-threshold-alert-badge"
              data-severity={durationAlert.severity}
              className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-md border text-xs font-medium ${
                durationAlert.severity === 'critical'
                  ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                  : 'bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300'
              }`}
            >
              {alertAcknowledged ? (
                <Bell className="w-3.5 h-3.5 shrink-0 opacity-75" />
              ) : (
                <BellRing className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="font-mono tabular-nums whitespace-nowrap">
                Duration Alert: Avg {formatPipelineDuration(durationAlert.avgDurationMs)} &gt;{' '}
                {formatPipelineDuration(durationAlert.thresholdMs)} (+
                {durationAlert.overagePercent}%)
              </span>
              <button
                type="button"
                onClick={onToggleAcknowledgeAlert}
                aria-pressed={alertAcknowledged}
                className="ml-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border border-current/25 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer transition-colors whitespace-nowrap shrink-0"
              >
                {alertAcknowledged ? 'Acknowledged' : 'Acknowledge'}
              </button>
            </div>
          )}

          {trends.activeLeadRun ? (
            <div
              data-testid="active-job-duration-readout"
              className="flex flex-wrap items-center gap-2 text-xs text-slate-700 dark:text-slate-200"
            >
              <span className="font-semibold truncate max-w-[220px]">
                {trends.activeLeadRun.name}
              </span>
              <span aria-hidden="true" className="text-slate-400">
                ·
              </span>
              <span className="font-mono text-cyan-600 dark:text-cyan-400">
                {trends.activeLeadRun.branch}
              </span>
              <span aria-hidden="true" className="text-slate-400">
                ·
              </span>
              <span className="font-mono tabular-nums font-semibold text-cyan-700 dark:text-cyan-300">
                Elapsed {trends.activeLeadRun.durationLabel}
              </span>
            </div>
          ) : (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {trends.totalRuns > 0
                ? `Monitoring last ${trends.totalRuns} deployment${trends.totalRuns === 1 ? '' : 's'} on ${repo}`
                : `Awaiting workflow telemetry for ${repo}`}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-[11px] font-mono text-slate-500 dark:text-slate-400">
          <DataSourceBadge
            source={dataSource.source}
            reason={dataSource.reason}
            ageMs={dataSource.ageMs}
          />
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{pollIntervalLabel}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">
            Updated {isLoading && !lastUpdatedMs ? '...' : updatedLabel}
          </span>
        </div>
      </div>

      {/* 3-Column Metrics & Visual Performance Summary */}
      {isLoading && trends.totalRuns === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
          {[0, 1, 2].map((idx) => (
            <div key={idx} className="p-5 space-y-2.5 animate-pulse">
              <div className="h-3 w-28 rounded bg-slate-200 dark:bg-slate-800" />
              <div className="h-7 w-20 rounded bg-slate-200 dark:bg-slate-800" />
              <div className="h-12 w-full rounded bg-slate-100 dark:bg-slate-800/60" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
          {/* Column 1: Success Rate + Dedicated Mini-Line Chart */}
          <div className="p-5 flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Success Rate Trend (Last {trends.totalRuns || 10})
              </span>
              {trends.trendDirection === 'improving' && (
                <span className="inline-flex items-center gap-1 text-[11px] font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                  <TrendingUp className="w-3.5 h-3.5" />+{trends.successRateDelta}%
                </span>
              )}
              {trends.trendDirection === 'declining' && (
                <span className="inline-flex items-center gap-1 text-[11px] font-mono tabular-nums font-semibold text-rose-600 dark:text-rose-400">
                  <TrendingDown className="w-3.5 h-3.5" />
                  {trends.successRateDelta}%
                </span>
              )}
              {trends.trendDirection === 'stable' && (
                <span className="inline-flex items-center gap-1 text-[11px] font-mono tabular-nums font-medium text-slate-500 dark:text-slate-400">
                  <Minus className="w-3.5 h-3.5" />
                  Steady
                </span>
              )}
            </div>

            <div className="flex items-baseline gap-3">
              <span
                data-testid="pipeline-success-rate"
                className={`text-2xl font-bold font-mono tabular-nums ${
                  trends.successRatePercent === null
                    ? 'text-slate-400'
                    : trends.successRatePercent >= 80
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : trends.successRatePercent >= 50
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {trends.successRatePercent !== null ? `${trends.successRatePercent}%` : '—'}
              </span>
              <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {trends.finishedCount > 0
                  ? `${trends.succeededCount}/${trends.finishedCount} passed${
                      trends.failedCount > 0 ? ` · ${trends.failedCount} failed` : ''
                    }${trends.cancelledCount > 0 ? ` · ${trends.cancelledCount} cancelled` : ''}`
                  : trends.activeCount > 0
                    ? `${trends.activeCount} running`
                    : 'No completed runs'}
              </span>
            </div>

            {/* Dedicated SVG Mini-Line Chart of Success Rate Trends */}
            <div data-testid="success-rate-mini-line-chart" className="pt-1">
              {miniLineGeometry.validPoints.length > 0 ? (
                <div className="flex items-center gap-2">
                  <div className="flex flex-col justify-between h-14 text-[9px] font-mono tabular-nums text-slate-400 select-none">
                    <span>100%</span>
                    <span>0%</span>
                  </div>
                  <svg
                    role="img"
                    aria-label="Success rate trend mini-line chart for the last 10 deployments"
                    viewBox={`0 0 ${miniLineGeometry.W} ${miniLineGeometry.H}`}
                    className={`flex-1 h-14 overflow-visible ${lineStrokeClass}`}
                  >
                    <defs>
                      <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
                        <stop offset="100%" stopColor="currentColor" stopOpacity="0.01" />
                      </linearGradient>
                    </defs>

                    {/* 100%, 50%, 0% reference lines */}
                    <line
                      x1="6"
                      y1={miniLineGeometry.padTop}
                      x2={miniLineGeometry.W - 6}
                      y2={miniLineGeometry.padTop}
                      stroke="currentColor"
                      strokeOpacity="0.12"
                      strokeDasharray="2 2"
                    />
                    <line
                      x1="6"
                      y1={miniLineGeometry.padTop + miniLineGeometry.usableH / 2}
                      x2={miniLineGeometry.W - 6}
                      y2={miniLineGeometry.padTop + miniLineGeometry.usableH / 2}
                      stroke="currentColor"
                      strokeOpacity="0.14"
                      strokeDasharray="2 3"
                    />
                    <line
                      x1="6"
                      y1={miniLineGeometry.H - miniLineGeometry.padBottom}
                      x2={miniLineGeometry.W - 6}
                      y2={miniLineGeometry.H - miniLineGeometry.padBottom}
                      stroke="currentColor"
                      strokeOpacity="0.12"
                    />

                    {miniLineGeometry.areaPath && (
                      <path d={miniLineGeometry.areaPath} fill={`url(#${gradientId})`} />
                    )}

                    {miniLineGeometry.linePath && (
                      <path
                        d={miniLineGeometry.linePath}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}

                    {miniLineGeometry.validPoints.map(({ point, x, y, rate }) => {
                      const isSelected = inspectedPoint?.id === point.id;
                      return (
                        <circle
                          key={point.id}
                          cx={x}
                          cy={y}
                          r={isSelected ? 4.2 : 2.8}
                          strokeWidth="1.5"
                          tabIndex={0}
                          role="button"
                          aria-label={`${point.name} cumulative success rate ${rate}%`}
                          onMouseEnter={() => setInspectedRunId(point.id)}
                          onFocus={() => setInspectedRunId(point.id)}
                          onClick={() => setInspectedRunId(point.id)}
                          className={`cursor-pointer transition-all focus:outline-none ${getPointDotColorClass(
                            point.outcome
                          )}`}
                        >
                          <title>
                            {point.runNumber ? `#${point.runNumber}` : `#${point.id}`} ·{' '}
                            {point.branch} · {rate}% cumulative ({point.conclusion || point.status})
                          </title>
                        </circle>
                      );
                    })}
                  </svg>
                </div>
              ) : (
                <div className="h-14 flex items-center text-[11px] font-mono text-slate-400">
                  {trends.trendDirection === 'insufficient'
                    ? 'Awaiting completed runs for success trend line.'
                    : 'No completed runs'}
                </div>
              )}
            </div>
          </div>

          {/* Column 2: Real-Time Job Duration + Alert Threshold Config */}
          <div className="p-5 flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {trends.activeLeadRun ? 'Live & Average Duration' : 'Average Job Duration'}
              </span>
              <label className="inline-flex items-center gap-1.5 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                <span>Limit</span>
                <select
                  aria-label="Average duration alert threshold"
                  data-testid="duration-threshold-select"
                  value={durationThresholdMs}
                  onChange={(e) => onChangeDurationThreshold(Number(e.target.value))}
                  className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-mono tabular-nums text-[11px] cursor-pointer"
                >
                  {thresholdChoices.map((ms) => (
                    <option key={ms} value={ms}>
                      {formatPipelineDuration(ms)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex items-baseline gap-3">
              <span
                data-testid="pipeline-avg-duration"
                className={`text-2xl font-bold font-mono tabular-nums ${
                  durationAlert.exceeded
                    ? durationAlert.severity === 'critical'
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-amber-600 dark:text-amber-400'
                    : 'text-slate-900 dark:text-white'
                }`}
              >
                {formatPipelineDuration(trends.avgDurationMs)}
              </span>
              <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {trends.activeLeadRun
                  ? `Active ${trends.activeLeadRun.durationLabel}`
                  : trends.latestDurationMs !== null
                    ? `Latest ${formatPipelineDuration(trends.latestDurationMs)}`
                    : 'No timing data'}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              <span>
                Min {formatPipelineDuration(trends.minDurationMs)} · Max{' '}
                {formatPipelineDuration(trends.maxDurationMs)}
              </span>
              {durationAlert.exceeded ? (
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  +{formatPipelineDuration(durationAlert.overageMs)} over limit
                </span>
              ) : latestCompletedDelta !== null && trends.totalRuns >= 2 ? (
                <span
                  className={
                    latestCompletedDelta <= -10
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }
                >
                  Latest {latestCompletedDelta > 0 ? `+${latestCompletedDelta}%` : `${latestCompletedDelta}%`} vs avg
                </span>
              ) : null}
            </div>
          </div>

          {/* Column 3: Last 10 Deployments Duration Bars with Threshold Line */}
          <div className="p-5 flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Deployment Durations (Last 10)
              </span>
              <span className="text-[10px] font-mono text-slate-400">Oldest → Newest</span>
            </div>

            {trends.timeline.length > 0 ? (
              <>
                <div className="relative h-14 flex items-end gap-1.5 pt-2">
                  {/* Threshold dashed reference line */}
                  {thresholdLineBottomPct !== null && (
                    <div
                      data-testid="duration-threshold-line"
                      aria-hidden="true"
                      style={{ bottom: `${thresholdLineBottomPct}%` }}
                      className={`absolute inset-x-0 border-t border-dashed pointer-events-none z-20 ${
                        durationAlert.exceeded
                          ? 'border-amber-500/80 dark:border-amber-400/80'
                          : 'border-slate-400/50 dark:border-slate-500/50'
                      }`}
                    />
                  )}

                  {trends.timeline.map((point) => {
                    const heightPct =
                      point.durationMs !== null && maxBarDurationMs > 0
                        ? Math.max(14, Math.round((point.durationMs / maxBarDurationMs) * 100))
                        : 20;
                    const isSelected = inspectedPoint?.id === point.id;
                    return (
                      <button
                        key={point.id}
                        type="button"
                        onMouseEnter={() => setInspectedRunId(point.id)}
                        onFocus={() => setInspectedRunId(point.id)}
                        onClick={() => setInspectedRunId(point.id)}
                        aria-label={`${point.name} (${point.outcome}), duration ${point.durationLabel}`}
                        title={`${point.name} · ${point.branch} · ${point.outcome} · ${point.durationLabel}`}
                        className={`relative z-10 flex-1 h-full flex items-end justify-center group cursor-pointer focus-visible:outline-none ${
                          isSelected ? 'opacity-100' : 'opacity-85 hover:opacity-100'
                        }`}
                      >
                        <span
                          className={`w-full rounded-t-sm transition-transform duration-150 ${getBarColorClass(
                            point.outcome,
                            isSelected
                          )} ${
                            isSelected
                              ? 'ring-1 ring-slate-900/40 dark:ring-white/60 scale-y-105 origin-bottom'
                              : ''
                          }`}
                          style={{ height: `${heightPct}%` }}
                        />
                      </button>
                    );
                  })}
                </div>

                {inspectedPoint && (
                  <div
                    data-testid="inspected-deployment-readout"
                    className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300"
                  >
                    <span className="flex items-center gap-1.5 min-w-0 truncate">
                      <span className="truncate">
                        {inspectedPoint.runNumber
                          ? `#${inspectedPoint.runNumber}`
                          : `#${inspectedPoint.id}`}{' '}
                        · {inspectedPoint.branch} · {inspectedPoint.conclusion || inspectedPoint.status}
                      </span>
                      {inspectedPoint.shortSha && inspectedPoint.commitUrl && (
                        <>
                          <span aria-hidden="true">·</span>
                          <a
                            href={inspectedPoint.commitUrl}
                            target="_blank"
                            rel="noreferrer"
                            data-testid="inspected-commit-link"
                            title={`View commit ${inspectedPoint.headSha} on GitHub`}
                            className="inline-flex items-center gap-1 shrink-0 text-cyan-700 dark:text-cyan-400 hover:text-cyan-600 dark:hover:text-cyan-300 hover:underline"
                          >
                            <GitCommitHorizontal className="w-3 h-3 shrink-0" />
                            <span>{inspectedPoint.shortSha}</span>
                          </a>
                        </>
                      )}
                    </span>
                    <span className="shrink-0 font-semibold text-slate-900 dark:text-white">
                      {inspectedPoint.durationLabel}
                      {inspectedPoint.rollingSuccessRate !== null
                        ? ` · ${inspectedPoint.rollingSuccessRate}%`
                        : ''}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="h-14 flex items-center text-xs text-slate-400 font-mono">
                No deployment history available.
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export default GitHubPipelineStatusIndicator;
