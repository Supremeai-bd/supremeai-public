import React, { useState, useEffect } from 'react';
import {
  Activity,
  Users,
  DollarSign,
  Cpu,
  Radio,
  Bot,
  AlertTriangle,
  RotateCcw,
  GitCompare,
  ArrowUpRight,
  Lock,
  Megaphone,
  UserPlus,
  Wrench,
  Save,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  GitBranch,
  RefreshCw,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { CustomerRecord, McpTowerService, SwarmWorker, TaskQueueJob, PlanTier } from '../../types';
import { SUPREMEAI_MODELS } from '../../data/models';
import { usePlatformStore } from '../../stores/usePlatformStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useControlCenterStore } from '../../stores/useControlCenterStore';
import { ControlCenterSafetyBar } from './ControlCenterSafetyGateModal';
import { AdminQuickStatsCard } from './AdminQuickStatsCard';
import { AdminD3TelemetryWidgets } from './AdminD3TelemetryWidgets';
import { AdminLiveServicesCommandMatrix } from './AdminLiveServicesCommandMatrix';
import { AdminProviderPoolsOverviewCard } from './AdminProviderPoolsOverviewCard';
import { useI18n } from '../../utils/i18n';

interface AdminOverviewViewProps {
  customers: CustomerRecord[];
  services: McpTowerService[];
  workers: SwarmWorker[];
  jobs: TaskQueueJob[];
  onNavigateTab: (tab: string) => void;
  onOpenDangerConfirm: (action: string, title: string, description: string) => void;
}

export const AdminOverviewView: React.FC<AdminOverviewViewProps> = ({
  customers,
  services,
  workers,
  jobs,
  onNavigateTab,
  onOpenDangerConfirm,
}) => {
  const { t } = useI18n();
  const { config, isSaving, updateConfig, updateModelPolicy } = usePlatformStore();
  const authUser = useAuthStore((s) => s.authUser);
  const {
    latestGithubCommit,
    latestDiagnose,
    pendingHitlCount,
    activeTakeoversCount,
    unclaimedBridgeCount,
    healthSnapshot,
    trafficSummary,
    ecosystemDiagnostics,
    healerIncidents,
    pipelines,
    cronTasks,
    isDiagnosing,
    isLoadingDiagnostics,
    isLoadingHealth,
    isProbingHealth,
    loadOverview,
    loadServiceHealth,
    loadEcosystemDiagnostics,
    runServiceHealthProbe,
    runDeepDiagnose,
    generateDagPlan,
  } = useControlCenterStore();

  const [maintenanceMessage, setMaintenanceMessage] = useState(config.maintenanceMessage);
  const [bannerMessage, setBannerMessage] = useState(config.announcementBanner.message);
  const [bannerLevel, setBannerLevel] = useState<'info' | 'warning' | 'critical'>(
    config.announcementBanner.level
  );

  useEffect(() => {
    loadOverview();
    loadServiceHealth(false);
    loadEcosystemDiagnostics();
  }, [loadOverview, loadServiceHealth, loadEcosystemDiagnostics]);

  useEffect(() => {
    setMaintenanceMessage(config.maintenanceMessage);
    setBannerMessage(config.announcementBanner.message);
    setBannerLevel(config.announcementBanner.level);
  }, [
    config.maintenanceMessage,
    config.announcementBanner.message,
    config.announcementBanner.level,
  ]);

  const unhealthyServices = services.filter((s) => s.status !== 'healthy');
  const dlqJobs = jobs.filter((j) => j.status === 'dlq' || j.status === 'failed');
  const activeWorkers = workers.filter((w) => w.status === 'active').length;
  const healthyJobRate =
    jobs.length > 0 ? Math.round(((jobs.length - dlqJobs.length) / jobs.length) * 100) : 100;

  const totalMrr = customers.reduce((sum, c) => sum + (c.mrr || 0), 0);
  const activeCustomers = customers.filter((c) => c.status === 'active').length;
  const suspendedCustomers = customers.filter((c) => c.status === 'suspended').length;

  const observedRpm = trafficSummary?.rpm ?? 0;
  const observedLatencyMs =
    trafficSummary?.avgLatencyMs ?? healthSnapshot?.summary.avgLatencyMs ?? 0;
  const observedErrPct = trafficSummary?.errorRatePercent ?? 0;
  const totalObservedRequests = trafficSummary?.totalRequests ?? 0;
  const trafficSeries: any =
    trafficSummary?.history && trafficSummary.history.length > 0
      ? trafficSummary.history.map((pt) => ({
          time: pt.time,
          rpm: pt.rpm,
          latency: pt.avgLatencyMs,
        }))
      : (healthSnapshot?.hostHistory || []).map((pt) => ({
          time: pt.ts,
          rpm: null,
          cpu: pt.cpuPercent,
          latency: pt.avgLatencyMs,
        }));
  const isUsingHostSeries = !(trafficSummary?.history && trafficSummary.history.length > 0);
  const totalConnectedMcp = healthSnapshot?.summary.total ?? services.length;
  const healthyMcpCount =
    healthSnapshot?.summary.healthy ?? Math.max(0, services.length - unhealthyServices.length);
  const mcpAlertCount = healthSnapshot?.alerts.length ?? unhealthyServices.length;

  const healthPercent =
    totalConnectedMcp > 0 ? Math.round((healthyMcpCount / totalConnectedMcp) * 100) : 100;
  const ringCircumference = 2 * Math.PI * 38;

  return (
    <div className="flex-1 overflow-y-auto bg-[#f6f8fb] dark:bg-slate-950 px-6 py-7 text-slate-800 dark:text-slate-200">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Deep-Navy Executive Command Hero */}
        <section className="relative overflow-hidden rounded-2xl border border-[#233758] bg-gradient-to-br from-[#162238] via-[#1b2942] to-[#22375d] px-7 py-6 text-white shadow-sm">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-20"
            style={{
              backgroundImage:
                'linear-gradient(rgba(199,216,255,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(199,216,255,0.16) 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            }}
          />
          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-3 max-w-2xl">
              <div className="text-[11px] font-mono font-semibold tracking-wider text-[#b5c7e6] uppercase">
                SupremeAI Control Tower / Live Operations
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#f8faff] text-balance">
                {t.ovPageTitle}
              </h1>
              <p className="text-[13px] text-[#c2cfe5] leading-relaxed">
                Unified orchestration over MCP Tower, GitHub release provenance, HITL governance,
                memory, and cluster health.
              </p>
              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => runDeepDiagnose('api', 'is_healthy', authUser?.email)}
                  disabled={isDiagnosing}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-[#162544] hover:bg-[#eef3ff] text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isDiagnosing ? 'animate-spin' : ''}`} />
                  <span>{isDiagnosing ? 'Diagnosing...' : 'Run 5-Layer Diagnose'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateTab('health-monitor')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-white/20 bg-white/[0.06] hover:bg-white/[0.12] text-[#edf2ff] text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Inspect Health Monitor</span>
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs font-mono text-[#a7b8d4]">
                <span>
                  Status:{' '}
                  <strong
                    className={config.maintenanceMode ? 'text-amber-300' : 'text-emerald-300'}
                  >
                    {config.maintenanceMode ? 'MAINTENANCE LOCK' : 'OPERATIONAL'}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Main SHA:{' '}
                  <strong className="text-white tabular-nums">
                    {latestGithubCommit?.sha || 'syncing'}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Operator:{' '}
                  <strong className="text-white">{authUser?.name?.split(' ')[0] || 'Admin'}</strong>
                </span>
              </div>
            </div>

            {/* Live Cluster Health Ring */}
            <div className="flex items-center gap-5 lg:flex-col lg:items-center shrink-0">
              <div className="relative w-28 h-28">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    fill="none"
                    stroke="rgba(191,211,245,0.18)"
                    strokeWidth="7"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    fill="none"
                    stroke={mcpAlertCount > 0 ? '#fbbf24' : '#5eead4'}
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeDasharray={`${(ringCircumference * healthPercent) / 100} ${ringCircumference}`}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-mono text-2xl font-bold tabular-nums text-white">
                    {healthPercent}%
                  </span>
                  <span className="text-[10.5px] text-[#a9bad6]">healthy</span>
                </div>
              </div>
              <div className="text-left lg:text-center font-mono text-[11px] text-[#b5c7e6] tabular-nums">
                {healthyMcpCount}/{totalConnectedMcp} nodes nominal
              </div>
            </div>
          </div>
        </section>

        {/* Control Center Safety Mode & Live Provenance Bar */}
        <ControlCenterSafetyBar
          provenance={
            latestDiagnose?.provenance || latestGithubCommit?.provenance || 'local-snapshot'
          }
          subtitle={`${pendingHitlCount ?? 0} HITL pending · ${activeTakeoversCount ?? 0} takeovers · ${unclaimedBridgeCount ?? 0} unclaimed bridge orders`}
        />

        {/* Quick Stats: Fast MCP Tower Health & Usage Pulse Check */}
        <AdminQuickStatsCard
          healthSnapshot={healthSnapshot}
          trafficSummary={trafficSummary}
          services={services}
          isRefreshing={isLoadingHealth || isProbingHealth}
          onPulseRefresh={() => void runServiceHealthProbe(authUser?.email)}
          onNavigateTab={onNavigateTab}
        />

        {/* Real-Time D3 Telemetry Widgets: Active Users, Monthly Token Usage Trends & System Health */}
        <AdminD3TelemetryWidgets
          customers={customers}
          services={services}
          healthSnapshot={healthSnapshot}
          isRefreshing={isLoadingHealth || isProbingHealth}
          onRefreshTelemetry={() => void loadServiceHealth(true)}
          onNavigateTab={onNavigateTab}
        />

        {/* All Services Real-Time Health, Topology, Load Matrix & Live Activity Feed */}
        <AdminLiveServicesCommandMatrix
          services={services}
          workers={workers}
          jobs={jobs}
          healthSnapshot={healthSnapshot}
          trafficSummary={trafficSummary}
          healerIncidents={healerIncidents}
          pipelines={pipelines}
          cronTasks={cronTasks}
          isRefreshing={isLoadingHealth || isProbingHealth}
          onProbeAll={() => void runServiceHealthProbe(authUser?.email)}
          onRefreshHealth={() => void loadServiceHealth(true)}
          onNavigateTab={onNavigateTab}
        />

        {/* Multi-Account Provider Pools, Quota Runway & 1-Click Failover Watch */}
        <AdminProviderPoolsOverviewCard onNavigateTab={onNavigateTab} />

        {/* Live 5-Layer Deep Diagnose TruthMatrix & ReleaseGate Strip */}
        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <ShieldCheck className="w-4 h-4 text-blue-500 shrink-0" />
                <span className="font-semibold text-sm text-slate-900 dark:text-white">
                  5-Layer Deep Diagnose & ReleaseGate
                </span>
                <span aria-hidden="true">·</span>
                <span
                  className={`font-mono font-bold ${
                    latestDiagnose?.releaseGate === 'GO'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : latestDiagnose?.releaseGate === 'DEGRADED'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {latestDiagnose?.releaseGate || 'GO'}
                </span>
                {latestDiagnose?.evidenceHash && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      evidence #{latestDiagnose.evidenceHash}
                    </span>
                  </>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {latestDiagnose?.summary ||
                  'Run system_deep_diagnose across MCP Tower & backend gateway satellites.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => runDeepDiagnose('api', 'is_healthy', authUser?.email)}
                disabled={isDiagnosing}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg theme-btn-primary text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isDiagnosing ? 'animate-spin' : ''}`} />
                <span>{isDiagnosing ? 'Diagnosing...' : 'Run 5-Layer Diagnose'}</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  await generateDagPlan('api', 'SCHEMA_PARITY_BREACH', authUser?.email);
                  onNavigateTab('hitl-policies');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
              >
                <GitBranch className="w-3.5 h-3.5 text-purple-500" />
                <span>{t.ovSynthesizeDag}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(latestDiagnose?.truthMatrix || []).map((dim) => (
              <div
                key={dim.dimension}
                className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-1"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-900 dark:text-white">{dim.label}</span>
                  <span
                    className={`inline-flex items-center gap-1 font-mono text-[11px] font-medium tabular-nums ${
                      dim.status === 'pass'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : dim.status === 'warn'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {dim.status === 'pass' ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : dim.status === 'warn' ? (
                      <AlertTriangle className="w-3.5 h-3.5" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5" />
                    )}
                    {dim.status.toUpperCase()} · {dim.latencyMs}ms
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                  {dim.summary}
                </p>
                <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                  {dim.evidence}
                </p>
              </div>
            ))}
          </div>

          {/* 1-Click Consolidated Control Center Console Jump Links */}
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            {[
              { tab: 'health-monitor', label: `CPU, Mem & Latency (${mcpAlertCount})` },
              { tab: 'hitl-policies', label: `HITL & Policies (${pendingHitlCount})` },
              { tab: 'release-gate', label: 'Release Gate & Render' },
              { tab: 'external-agents', label: `Bridge Orders (${unclaimedBridgeCount})` },
              { tab: 'memory-graph', label: 'Memory, Qdrant & AST' },
              { tab: 'compute-fleet', label: 'Kaggle & CDP Audit' },
              { tab: 'finops-omnichannel', label: 'FinOps, Telegram & Cron' },
            ].map((link) => (
              <button
                key={link.tab}
                type="button"
                onClick={() => onNavigateTab(link.tab)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-500 text-slate-700 dark:text-slate-200 font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                <span>{link.label}</span>
                <ArrowUpRight className="w-3 h-3 text-slate-400" />
              </button>
            ))}
          </div>
        </div>

        {/* Live MCP Diagnostics & SSOT Maintainability Card */}
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Radio className="w-4 h-4 text-emerald-500" />
                <span>Live MCP Diagnostics & SSOT Maintainability</span>
                {ecosystemDiagnostics && (
                  <>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                      ·
                    </span>
                    <span
                      className={`text-xs font-mono font-semibold ${
                        ecosystemDiagnostics.mcpReachable
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {ecosystemDiagnostics.mcpReachable ? 'MCP Live' : 'MCP Unreachable'}
                    </span>
                  </>
                )}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono truncate">
                {ecosystemDiagnostics?.mcpEndpoint ||
                  'https://supremeai-mcp-tower-live.onrender.com/mcp'}{' '}
                · SSOT: {ecosystemDiagnostics?.ssotConfigPath || 'src/config/platformEndpoints.ts'}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => loadEcosystemDiagnostics()}
                disabled={isLoadingDiagnostics}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium cursor-pointer disabled:opacity-60"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isLoadingDiagnostics ? 'animate-spin' : ''}`}
                />
                <span>{isLoadingDiagnostics ? 'Auditing...' : 'Refresh MCP Audit'}</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('mcp-tower')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold cursor-pointer"
              >
                <span>MCP Tower</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(ecosystemDiagnostics?.findings || []).map((finding) => (
              <div
                key={finding.id}
                className="p-3.5 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {finding.surface}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                      finding.severity === 'healthy'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : finding.severity === 'warning'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {finding.severity === 'healthy' ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : finding.severity === 'warning' ? (
                      <AlertTriangle className="w-3.5 h-3.5" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5" />
                    )}
                    {finding.severity.toUpperCase()}
                  </span>
                </div>
                <div className="text-xs font-semibold text-slate-900 dark:text-white">
                  {finding.title}
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                  {finding.detail}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug pt-0.5">
                  <span className="font-semibold">Action:</span> {finding.recommendation}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Top Telemetry KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div
            onClick={() => onNavigateTab('customers')}
            className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-400 transition-all cursor-pointer space-y-2 group"
          >
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{t.ovCustomersMrr}</span>
              <DollarSign className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              ${totalMrr.toLocaleString()}
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums">
              <span>
                {customers.length} accounts ({activeCustomers} active)
              </span>
              {suspendedCustomers > 0 && (
                <span className="text-rose-500">{suspendedCustomers} suspended</span>
              )}
            </div>
          </div>

          <div
            onClick={() => onNavigateTab('health-monitor')}
            className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-400 transition-all cursor-pointer space-y-2 group"
          >
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{t.ovGatewayLoad}</span>
              <Cpu className="w-4 h-4 text-blue-500" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {observedRpm} RPM
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums">
              <span>
                {observedLatencyMs}ms · CPU {healthSnapshot?.host?.cpuPercent ?? 0}%
              </span>
              <span className={observedErrPct > 2 ? 'text-rose-500' : 'text-emerald-500'}>
                {observedErrPct}% Err ({totalObservedRequests})
              </span>
            </div>
          </div>

          <div
            onClick={() => onNavigateTab('health-monitor')}
            className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-amber-400 transition-all cursor-pointer space-y-2 group"
          >
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{t.ovMcpHealth}</span>
              <Radio className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {healthyMcpCount} / {totalConnectedMcp} Healthy
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums">
              <span>{totalConnectedMcp} Connected Nodes</span>
              {mcpAlertCount > 0 ? (
                <span className="text-rose-500 font-semibold">
                  {mcpAlertCount} Alert{mcpAlertCount > 1 ? 's' : ''}
                </span>
              ) : (
                <span className="text-emerald-500 font-semibold">{t.ovAllNominal}</span>
              )}
            </div>
          </div>

          <div
            onClick={() => onNavigateTab('agent-swarm')}
            className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-purple-400 transition-all cursor-pointer space-y-2 group"
          >
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{t.ovAutonomousSwarm}</span>
              <Bot className="w-4 h-4 text-purple-500" />
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-purple-600 dark:text-purple-400">
              {activeWorkers} Daemons
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums">
              <span>{dlqJobs.length} failed/DLQ jobs</span>
              <span className="text-emerald-500 font-semibold">{healthyJobRate}% Healthy</span>
            </div>
          </div>
        </div>

        {/* Platform Governance & Model Access Matrix */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Global Platform Policy Controls */}
          <div className="p-6 rounded-2xl bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-cyan-500" />
                  <span>{t.ovPlatformGovernance}</span>
                </h2>
                <p className="text-[11px] text-slate-400">{t.ovServerEnforcedHint}</p>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                {isSaving ? 'Saving...' : 'Synced'}
              </span>
            </div>

            {/* Maintenance Mode */}
            <div className="space-y-2.5 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-500" />
                    <span>{t.ovEmergencyLock}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Pauses customer chat & workspace access (HTTP 503) while Admins retain full
                    control.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    updateConfig({
                      maintenanceMode: !config.maintenanceMode,
                      maintenanceMessage,
                    })
                  }
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
                    config.maintenanceMode
                      ? 'bg-amber-500 text-white hover:bg-amber-600'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600'
                  }`}
                >
                  {config.maintenanceMode ? 'Active (Unlock)' : 'Enable Lock'}
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={maintenanceMessage}
                  onChange={(e) => setMaintenanceMessage(e.target.value)}
                  placeholder={t.ovMaintenancePlaceholder}
                  className="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => updateConfig({ maintenanceMessage })}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer flex items-center gap-1"
                >
                  <Save className="w-3 h-3" />
                  <span>{t.commonSave}</span>
                </button>
              </div>
            </div>

            {/* Global System Announcement Banner */}
            <div className="space-y-2.5 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Megaphone className="w-3.5 h-3.5 text-blue-500" />
                    <span>{t.ovGlobalBanner}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{t.ovBannerHint}</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    updateConfig({
                      announcementBanner: {
                        active: !config.announcementBanner.active,
                        message: bannerMessage,
                        level: bannerLevel,
                      },
                    })
                  }
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
                    config.announcementBanner.active
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600'
                  }`}
                >
                  {config.announcementBanner.active ? 'Broadcasting' : 'Publish'}
                </button>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={bannerMessage}
                  onChange={(e) => setBannerMessage(e.target.value)}
                  placeholder={t.ovAnnouncementPlaceholder}
                  className="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none"
                />
                <select
                  value={bannerLevel}
                  onChange={(e) => setBannerLevel(e.target.value as any)}
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none"
                >
                  <option value="info">{t.ovInfo}</option>
                  <option value="warning">{t.ovWarning}</option>
                  <option value="critical">{t.ovCritical}</option>
                </select>
                <button
                  type="button"
                  onClick={() =>
                    updateConfig({
                      announcementBanner: {
                        active: config.announcementBanner.active,
                        message: bannerMessage,
                        level: bannerLevel,
                      },
                    })
                  }
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer flex items-center gap-1"
                >
                  <Save className="w-3 h-3" />
                  <span>{t.commonUpdate}</span>
                </button>
              </div>
            </div>

            {/* Allow New Signups Toggle */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60">
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <UserPlus className="w-3.5 h-3.5 text-emerald-500" />
                  <span>{t.ovAllowSignups}</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{t.ovPausedHint}</p>
              </div>
              <button
                type="button"
                onClick={() => updateConfig({ allowNewSignups: !config.allowNewSignups })}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
                  config.allowNewSignups
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-rose-600 text-white hover:bg-rose-700'
                }`}
              >
                {config.allowNewSignups ? 'Open' : 'Paused'}
              </button>
            </div>
          </div>

          {/* Model Access & Tier Governance */}
          <div className="p-6 rounded-2xl bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-purple-500" />
                  <span>{t.ovModelAccessGovernance}</span>
                </h2>
                <p className="text-[11px] text-slate-400">{t.ovModelGovernanceHint}</p>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab('models')}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                {t.ovModelMatrix}
              </button>
            </div>

            <div className="space-y-2.5">
              {SUPREMEAI_MODELS.map((model) => {
                const policy = config.modelPolicies[model.id] || { enabled: true, minTier: 'Free' };
                return (
                  <div
                    key={model.id}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {model.name}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 truncate">
                        {model.id} · {model.latencyRating}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={policy.minTier}
                        onChange={(e) =>
                          updateModelPolicy(model.id, { minTier: e.target.value as PlanTier })
                        }
                        aria-label={`Minimum tier for ${model.name}`}
                        className="px-2 py-1 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
                      >
                        <option value="Free">{t.ovFreePlus}</option>
                        <option value="Pro">{t.ovProPlus}</option>
                        <option value="Enterprise">Enterprise</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => updateModelPolicy(model.id, { enabled: !policy.enabled })}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                          policy.enabled
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        {policy.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Main Charts & Command Strip */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-600" />
                  <span>{t.ovRealtimeTelemetry}</span>
                </h2>
                <p className="text-[11px] text-slate-400">
                  {isUsingHostSeries
                    ? 'Live measured MCP cluster latency (ms) and runtime host CPU (%)'
                    : 'Observed Express /api requests/min and response latency (ms)'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab('health-monitor')}
                className="text-xs font-mono text-blue-600 dark:text-blue-400 font-semibold hover:underline cursor-pointer"
              >
                Open Full Health Monitor →
              </button>
            </div>

            <div className="h-60 w-full">
              {trafficSeries.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trafficSeries}>
                    <defs>
                      <linearGradient id="qpsGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickLine={false} />
                    <YAxis yAxisId="left" stroke="#94a3b8" fontSize={11} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        borderColor: '#334155',
                        borderRadius: '0.75rem',
                        fontSize: '12px',
                        color: '#f8fafc',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="rpm"
                      yAxisId="left"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="url(#qpsGradient)"
                      name={isUsingHostSeries ? 'Host CPU (%)' : 'Requests/min'}
                    />
                    <Area
                      type="monotone"
                      dataKey="latency"
                      yAxisId="right"
                      stroke="#a855f7"
                      strokeWidth={2}
                      fill="none"
                      name="Latency (ms)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-slate-400 font-mono">
                  {t.ovCollectingSamples}
                </div>
              )}
            </div>
          </div>

          {/* Quick Command Hub & Danger Zone */}
          <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 font-mono">
                  {t.ovCommandActions}
                </h3>
                <span className="text-[10px] text-emerald-500 font-mono">{t.ovCentralConsole}</span>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => onNavigateTab('health-monitor')}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-left text-xs text-slate-800 dark:text-slate-200 flex items-center justify-between transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <Activity className="w-4 h-4 text-emerald-500" />
                    <span>{t.ovCpuMonitor}</span>
                  </div>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
                </button>

                <button
                  type="button"
                  onClick={() => onNavigateTab('mcp-tower')}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-left text-xs text-slate-800 dark:text-slate-200 flex items-center justify-between transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <Radio className="w-4 h-4 text-amber-500" />
                    <span>{t.ovInspectMcp}</span>
                  </div>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
                </button>

                <button
                  type="button"
                  onClick={() => onNavigateTab('schema-parity')}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-left text-xs text-slate-800 dark:text-slate-200 flex items-center justify-between transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <GitCompare className="w-4 h-4 text-emerald-500" />
                    <span>{t.ovSchemaParity}</span>
                  </div>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
                </button>

                <button
                  type="button"
                  onClick={() => onNavigateTab('task-queue')}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-left text-xs text-slate-800 dark:text-slate-200 flex items-center justify-between transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <RotateCcw className="w-4 h-4 text-blue-500" />
                    <span>Task Queue & DLQ ({dlqJobs.length})</span>
                  </div>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
                </button>

                <button
                  type="button"
                  onClick={() => onNavigateTab('customers')}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-left text-xs text-slate-800 dark:text-slate-200 flex items-center justify-between transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <Users className="w-4 h-4 text-purple-500" />
                    <span>{t.ovCustomersImpersonation}</span>
                  </div>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
                </button>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-rose-700 dark:text-rose-300">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                <span>{t.ovDangerZone}</span>
              </div>
              <p className="text-[11px] text-rose-600/80 dark:text-rose-400/80">
                {t.ovDestructiveHint}
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    onOpenDangerConfirm(
                      'reboot-all',
                      'Reboot All MCP Microservices',
                      'This will restart all microservices in the MCP Tower. Active streams may briefly reconnect.'
                    )
                  }
                  className="flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-colors cursor-pointer"
                >
                  {t.ovRebootAll}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onOpenDangerConfirm(
                      'flush-dlq',
                      'Flush Dead-Letter Queue',
                      'This will re-queue all failed and dead-letter tasks back into active processing.'
                    )
                  }
                  className="flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold bg-slate-800 dark:bg-slate-700 text-white hover:bg-slate-900 transition-colors cursor-pointer"
                >
                  {t.ovFlushDlq}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function HomePage() {
  return (
    <AdminOverviewView
      customers={[]}
      services={[]}
      workers={[]}
      jobs={[]}
      onNavigateTab={() => {}}
      onOpenDangerConfirm={() => {}}
    />
  );
}
