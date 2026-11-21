import React from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Cpu,
  Gauge,
  HardDrive,
  Radio,
  RefreshCw,
  Server,
} from 'lucide-react';
import type { McpTowerService } from '../../types';
import type { McpHealthMonitorSnapshot } from '../../types/controlCenter';

export interface TrafficSummaryTelemetry {
  rpm: number;
  avgLatencyMs: number;
  errorRatePercent: number;
  totalRequests: number;
}

export interface ComputedMcpQuickStats {
  overallStatus: 'healthy' | 'degraded' | 'critical';
  statusLabel: string;
  totalNodes: number;
  healthyNodes: number;
  issueNodes: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  cpuPercent: number;
  loadAvg1m: number;
  cpuCores: number;
  memoryPercent: number;
  processRssMb: number;
  clusterMemoryMb: number;
  rpm: number;
  totalRequests: number;
  errorRatePercent: number;
  activeAlerts: number;
  sweepCompletions: number | null;
  uptimeLabel: string;
  lastUpdatedLabel: string;
  topNodes: Array<{
    id: string;
    name: string;
    status: string;
    latencyMs: number | null;
    cpuPercent: number | null;
  }>;
}

function formatUptime(uptimeSec?: number): string {
  if (!uptimeSec || !Number.isFinite(uptimeSec) || uptimeSec <= 0) return '—';
  const days = Math.floor(uptimeSec / 86400);
  const hours = Math.floor((uptimeSec % 86400) / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function computeMcpQuickStats(params: {
  healthSnapshot: McpHealthMonitorSnapshot | null;
  trafficSummary: TrafficSummaryTelemetry | null;
  services: McpTowerService[];
}): ComputedMcpQuickStats {
  const { healthSnapshot, trafficSummary, services } = params;

  const fallbackTotal = services.length;
  const fallbackHealthy = services.filter((s) => s.status === 'healthy').length;
  const fallbackIssues = services.filter((s) => s.status !== 'healthy').length;
  const fallbackAvgLatency =
    fallbackTotal > 0
      ? Math.round(services.reduce((sum, s) => sum + (s.latencyMs || 0), 0) / fallbackTotal)
      : 0;
  const sortedLatencies = services.map((s) => s.latencyMs || 0).sort((a, b) => a - b);
  const fallbackP95 =
    sortedLatencies.length > 0
      ? sortedLatencies[
          Math.min(sortedLatencies.length - 1, Math.floor(sortedLatencies.length * 0.95))
        ]
      : 0;
  const fallbackAvgCpu =
    fallbackTotal > 0
      ? Number(
          (services.reduce((sum, s) => sum + (s.cpuPercent || 0), 0) / fallbackTotal).toFixed(1)
        )
      : 0;
  const clusterMemoryMb = Math.round(services.reduce((sum, s) => sum + (s.memoryMb || 0), 0));

  const totalNodes = healthSnapshot?.summary.total ?? fallbackTotal;
  const healthyNodes = healthSnapshot?.summary.healthy ?? fallbackHealthy;
  const degraded = healthSnapshot?.summary.degraded ?? 0;
  const critical = healthSnapshot?.summary.critical ?? 0;
  const unreachable = healthSnapshot?.summary.unreachable ?? 0;
  const issueNodes = healthSnapshot ? degraded + critical + unreachable : fallbackIssues;

  const avgLatencyMs = Math.round(
    healthSnapshot?.summary.avgLatencyMs ?? trafficSummary?.avgLatencyMs ?? fallbackAvgLatency
  );
  const p95LatencyMs = Math.round(healthSnapshot?.summary.p95LatencyMs ?? fallbackP95);

  const cpuPercent = Number((healthSnapshot?.host?.cpuPercent ?? fallbackAvgCpu).toFixed(1));
  const loadAvg1m = Number((healthSnapshot?.host?.loadAvg1m ?? 0).toFixed(2));
  const cpuCores = healthSnapshot?.host?.cpuCores ?? 1;
  const memoryPercent = Number((healthSnapshot?.host?.systemMemUsedPct ?? 0).toFixed(1));
  const processRssMb = Math.round(healthSnapshot?.host?.processRssMb ?? clusterMemoryMb);

  const rpm = Math.round(trafficSummary?.rpm ?? 0);
  const totalRequests = trafficSummary?.totalRequests ?? 0;
  const errorRatePercent = Number((trafficSummary?.errorRatePercent ?? 0).toFixed(2));
  const activeAlerts =
    healthSnapshot?.summary.activeAlertCount ?? healthSnapshot?.alerts.length ?? fallbackIssues;

  let overallStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';
  if (critical > 0 || unreachable > 0 || errorRatePercent > 5) {
    overallStatus = 'critical';
  } else if (issueNodes > 0 || activeAlerts > 0 || cpuPercent >= 85 || memoryPercent >= 88) {
    overallStatus = 'degraded';
  }

  const statusLabel =
    overallStatus === 'critical'
      ? 'Attention Required'
      : overallStatus === 'degraded'
        ? 'Degraded Pulse'
        : 'Healthy Pulse';

  const snapshotNodes = (healthSnapshot?.services || []).map((svc) => ({
    id: svc.id,
    name: svc.displayName || svc.name,
    status: svc.status,
    latencyMs: svc.latencyMs,
    cpuPercent: svc.cpuPercent,
  }));

  const serviceFallbackNodes = services.map((svc) => ({
    id: svc.id,
    name: svc.displayName || svc.name,
    status: svc.status,
    latencyMs: svc.latencyMs ?? null,
    cpuPercent: svc.cpuPercent ?? null,
  }));

  const combinedNodes = snapshotNodes.length > 0 ? snapshotNodes : serviceFallbackNodes;
  const topNodes = [...combinedNodes]
    .sort((a, b) => {
      const aIssue = a.status === 'healthy' ? 0 : 1;
      const bIssue = b.status === 'healthy' ? 0 : 1;
      if (bIssue !== aIssue) return bIssue - aIssue;
      return (b.latencyMs ?? 0) - (a.latencyMs ?? 0);
    })
    .slice(0, 4);

  const rawTime = healthSnapshot?.collectedAt || healthSnapshot?.host?.sampledAt || '';
  const lastUpdatedLabel = rawTime
    ? new Date(rawTime).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : 'Live stream';

  return {
    overallStatus,
    statusLabel,
    totalNodes,
    healthyNodes,
    issueNodes,
    avgLatencyMs,
    p95LatencyMs,
    cpuPercent,
    loadAvg1m,
    cpuCores,
    memoryPercent,
    processRssMb,
    clusterMemoryMb,
    rpm,
    totalRequests,
    errorRatePercent,
    activeAlerts,
    sweepCompletions:
      typeof healthSnapshot?.sweepCompletions === 'number' ? healthSnapshot.sweepCompletions : null,
    uptimeLabel: formatUptime(healthSnapshot?.host?.uptimeSec),
    lastUpdatedLabel,
    topNodes,
  };
}

interface AdminQuickStatsCardProps {
  healthSnapshot: McpHealthMonitorSnapshot | null;
  trafficSummary: TrafficSummaryTelemetry | null;
  services: McpTowerService[];
  isRefreshing?: boolean;
  onPulseRefresh: () => void;
  onNavigateTab: (tab: string) => void;
}

export const AdminQuickStatsCard: React.FC<AdminQuickStatsCardProps> = ({
  healthSnapshot,
  trafficSummary,
  services,
  isRefreshing = false,
  onPulseRefresh,
  onNavigateTab,
}) => {
  const stats = computeMcpQuickStats({ healthSnapshot, trafficSummary, services });

  const statusTone =
    stats.overallStatus === 'critical'
      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30'
      : stats.overallStatus === 'degraded'
        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
        : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30';

  const statusDot =
    stats.overallStatus === 'critical'
      ? 'bg-rose-500'
      : stats.overallStatus === 'degraded'
        ? 'bg-amber-500'
        : 'bg-emerald-500';

  return (
    <section
      aria-label="Quick Stats MCP Tower Telemetry"
      className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 shadow-xs"
    >
      {/* Card Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <Gauge className="w-4 h-4 text-cyan-500 shrink-0" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Quick Stats</h2>
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-mono font-semibold ${statusTone}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${statusDot} animate-pulse`} />
              {stats.statusLabel}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
            MCP Tower telemetry · updated {stats.lastUpdatedLabel}
            {stats.uptimeLabel !== '—' ? ` · host uptime ${stats.uptimeLabel}` : ''}
            {stats.sweepCompletions !== null ? ` · ${stats.sweepCompletions} sweeps` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onPulseRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium cursor-pointer disabled:opacity-60 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Probing...' : 'Pulse Check'}</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigateTab('health-monitor')}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-cyan-500 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
          >
            <span>Telemetry</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
          </button>
        </div>
      </div>

      {/* 6 Core Pulse Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* 1. MCP Nodes */}
        <button
          type="button"
          onClick={() => onNavigateTab('mcp-tower')}
          className="text-left p-3 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 hover:border-cyan-500/50 transition-colors cursor-pointer space-y-1"
        >
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>MCP Nodes</span>
            <Radio className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {stats.healthyNodes}/{stats.totalNodes}
          </div>
          <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate">
            {stats.issueNodes > 0 ? (
              <span className="text-amber-600 dark:text-amber-400 font-semibold">
                {stats.issueNodes} degraded/down
              </span>
            ) : (
              'All nodes healthy'
            )}
          </div>
        </button>

        {/* 2. Latency P95 / Avg */}
        <button
          type="button"
          onClick={() => onNavigateTab('health-monitor')}
          className="text-left p-3 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 hover:border-cyan-500/50 transition-colors cursor-pointer space-y-1"
        >
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Latency P95</span>
            <Activity className="w-3.5 h-3.5 text-indigo-500" />
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {stats.p95LatencyMs}ms
          </div>
          <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate">
            avg {stats.avgLatencyMs}ms response
          </div>
        </button>

        {/* 3. Host CPU */}
        <div className="p-3 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Host CPU</span>
            <Cpu className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {stats.cpuPercent}%
          </div>
          <div className="w-full h-1 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                stats.cpuPercent >= 85
                  ? 'bg-rose-500'
                  : stats.cpuPercent >= 65
                    ? 'bg-amber-500'
                    : 'bg-blue-500'
              }`}
              style={{ width: `${Math.min(100, Math.max(4, stats.cpuPercent))}%` }}
            />
          </div>
          <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate">
            {stats.cpuCores} cores · load {stats.loadAvg1m}
          </div>
        </div>

        {/* 4. Memory Usage */}
        <div className="p-3 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Memory</span>
            <HardDrive className="w-3.5 h-3.5 text-purple-500" />
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {stats.memoryPercent > 0 ? `${stats.memoryPercent}%` : `${stats.processRssMb} MB`}
          </div>
          <div className="w-full h-1 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                stats.memoryPercent >= 88
                  ? 'bg-rose-500'
                  : stats.memoryPercent >= 70
                    ? 'bg-amber-500'
                    : 'bg-purple-500'
              }`}
              style={{
                width: `${Math.min(100, Math.max(4, stats.memoryPercent > 0 ? stats.memoryPercent : 25))}%`,
              }}
            />
          </div>
          <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate">
            RSS {stats.processRssMb} MB
          </div>
        </div>

        {/* 5. Gateway Usage */}
        <div className="p-3 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Usage Rate</span>
            <Server className="w-3.5 h-3.5 text-cyan-500" />
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {stats.rpm} RPM
          </div>
          <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate">
            {stats.totalRequests.toLocaleString()} req · {stats.errorRatePercent}% err
          </div>
        </div>

        {/* 6. Active Alerts */}
        <button
          type="button"
          onClick={() => onNavigateTab('health-monitor')}
          className="text-left p-3 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 hover:border-amber-500/50 transition-colors cursor-pointer space-y-1"
        >
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Active Alerts</span>
            <AlertTriangle
              className={`w-3.5 h-3.5 ${stats.activeAlerts > 0 ? 'text-amber-500' : 'text-emerald-500'}`}
            />
          </div>
          <div
            className={`text-lg font-bold font-mono tabular-nums ${
              stats.activeAlerts > 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {stats.activeAlerts}
          </div>
          <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate">
            {stats.activeAlerts > 0 ? 'Review threshold alerts' : 'Zero active alerts'}
          </div>
        </button>
      </div>

      {/* Top Monitored Nodes Strip */}
      {stats.topNodes.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 pt-1 border-t border-slate-100 dark:border-slate-800/80 text-[11px] font-mono text-slate-600 dark:text-slate-300">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
            Node Pulse:
          </span>
          {stats.topNodes.map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => onNavigateTab('mcp-tower')}
              className="inline-flex items-center gap-1.5 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors cursor-pointer"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  node.status === 'healthy'
                    ? 'bg-emerald-500'
                    : node.status === 'degraded'
                      ? 'bg-amber-500'
                      : 'bg-rose-500'
                }`}
              />
              <span className="truncate max-w-[160px]">{node.name}</span>
              <span className="text-slate-400 tabular-nums">
                {node.latencyMs !== null ? `${node.latencyMs}ms` : '—'}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};
