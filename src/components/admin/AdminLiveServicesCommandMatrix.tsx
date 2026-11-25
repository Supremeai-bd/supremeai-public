import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Cpu,
  Gauge,
  Grid2x2,
  HardDrive,
  Layers,
  Network,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Search,
  Server,
  Terminal,
  Workflow,
  XCircle,
} from 'lucide-react';
import type { McpTowerService, SwarmWorker, TaskQueueJob } from '../../types';
import { DataSourceBadge } from '../common/DataSourceBadge';
import { useAdminCollectionSource } from '../../hooks/useAdminCollectionSource';
import type {
  AutoHealerIncident,
  CronTaskItem,
  HarnessPipelineRun,
  McpHealthMonitorSnapshot,
  McpServiceHealthMetric,
  ProactiveHealthAlert,
} from '../../types/controlCenter';

export interface AdminLiveServicesCommandMatrixProps {
  services: McpTowerService[];
  workers: SwarmWorker[];
  jobs: TaskQueueJob[];
  healthSnapshot: McpHealthMonitorSnapshot | null;
  trafficSummary: {
    rpm: number;
    avgLatencyMs: number;
    errorRatePercent: number;
    totalRequests: number;
  } | null;
  healerIncidents?: AutoHealerIncident[];
  pipelines?: HarnessPipelineRun[];
  cronTasks?: CronTaskItem[];
  isRefreshing: boolean;
  onProbeAll: () => void;
  onRefreshHealth: () => void;
  onNavigateTab: (tab: string) => void;
}

type UnifiedHealthStatus = 'healthy' | 'degraded' | 'critical';

interface TelemetrySample {
  ts: string;
  latencyMs: number;
  cpuPercent: number;
  memoryMb: number;
}

interface UnifiedServiceNode {
  id: string;
  name: string;
  displayName: string;
  category: string;
  provider: string;
  status: UnifiedHealthStatus;
  rawStatus: string;
  latencyMs: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  cpuPercent: number;
  memoryMb: number;
  memoryPercent: number | null;
  uptime: string;
  version: string;
  endpoint: string;
  errorCount: number;
  consecutiveFailures: number;
  checkedAt: string;
  source: string;
  evidenceSummary?: string;
  errorMessage?: string;
  history: TelemetrySample[];
  logs: Array<{ id: string; timestamp: string; level: string; message: string }>;
}

interface LiveActivityEvent {
  id: string;
  kind: 'alert' | 'worker' | 'job' | 'log' | 'ops';
  severity: 'info' | 'success' | 'warning' | 'critical';
  source: string;
  title: string;
  detail: string;
  timestamp: string;
  meta?: string;
}

function normalizeStatus(raw: string): UnifiedHealthStatus {
  const s = (raw || '').toLowerCase();
  if (s === 'healthy' || s === 'live' || s === 'ok' || s === 'nominal') return 'healthy';
  if (s === 'degraded' || s === 'rebooting' || s === 'warning' || s === 'deploying') {
    return 'degraded';
  }
  return 'critical';
}

function statusColorHex(status: UnifiedHealthStatus): string {
  if (status === 'healthy') return '#16a34a';
  if (status === 'degraded') return '#d97706';
  return '#e11d48';
}

function useElementWidth(ref: React.RefObject<HTMLDivElement | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const next = Math.floor(el.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref]);

  return width;
}

/** Compact D3 Sparkline for each service card */
const ServiceMiniSparkline: React.FC<{
  samples: TelemetrySample[];
  color: string;
  serviceId: string;
}> = ({ samples, color, serviceId }) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const width = 128;
    const height = 34;
    const padX = 3;
    const padY = 4;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const pts =
      samples.length >= 2
        ? samples
        : [
            { ts: 't0', latencyMs: samples[0]?.latencyMs ?? 0, cpuPercent: 0, memoryMb: 0 },
            { ts: 't1', latencyMs: samples[0]?.latencyMs ?? 0, cpuPercent: 0, memoryMb: 0 },
          ];

    const gradId = `svc-spark-${serviceId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const defs = svg.append('defs');
    const grad = defs
      .append('linearGradient')
      .attr('id', gradId)
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    grad.append('stop').attr('offset', '0%').attr('stop-color', color).attr('stop-opacity', 0.28);
    grad.append('stop').attr('offset', '100%').attr('stop-color', color).attr('stop-opacity', 0.02);

    const x = d3
      .scaleLinear()
      .domain([0, Math.max(1, pts.length - 1)])
      .range([padX, width - padX]);

    const maxLat = Math.max(20, d3.max(pts, (d) => d.latencyMs) || 20);
    const minLat = Math.max(0, (d3.min(pts, (d) => d.latencyMs) || 0) * 0.75);
    const y = d3
      .scaleLinear()
      .domain([minLat, maxLat * 1.15])
      .range([height - padY, padY]);

    const area = d3
      .area<TelemetrySample>()
      .x((_, i) => x(i))
      .y0(height - padY)
      .y1((d) => y(d.latencyMs))
      .curve(d3.curveMonotoneX);

    const line = d3
      .line<TelemetrySample>()
      .x((_, i) => x(i))
      .y((d) => y(d.latencyMs))
      .curve(d3.curveMonotoneX);

    svg.append('path').datum(pts).attr('fill', `url(#${gradId})`).attr('d', area);
    svg
      .append('path')
      .datum(pts)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 1.75)
      .attr('d', line);

    const lastIdx = pts.length - 1;
    svg
      .append('circle')
      .attr('cx', x(lastIdx))
      .attr('cy', y(pts[lastIdx].latencyMs))
      .attr('r', 2.5)
      .attr('fill', color);
  }, [samples, color, serviceId]);

  return <svg ref={svgRef} className="w-[128px] h-[34px] block shrink-0" aria-hidden="true" />;
};

export const AdminLiveServicesCommandMatrix: React.FC<AdminLiveServicesCommandMatrixProps> = ({
  services,
  workers,
  jobs,
  healthSnapshot,
  trafficSummary,
  healerIncidents = [],
  pipelines = [],
  cronTasks = [],
  isRefreshing,
  onProbeAll,
  onRefreshHealth,
  onNavigateTab,
}) => {
  const [viewMode, setViewMode] = useState<'grid' | 'topology' | 'scatter'>('grid');
  const [rightTab, setRightTab] = useState<'activity' | 'workers' | 'inspector'>('activity');
  const [statusFilter, setStatusFilter] = useState<'all' | UnifiedHealthStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [activityFilter, setActivityFilter] = useState<'all' | 'alert' | 'worker' | 'job' | 'log'>(
    'all'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [isLiveStream, setIsLiveStream] = useState(true);
  const [lastTickAt, setLastTickAt] = useState<Date>(() => new Date());
  const [ringBuffer, setRingBuffer] = useState<Record<string, TelemetrySample[]>>({});

  // বাংলা মন্তব্য: সার্ভিস রেজিস্ট্রি লাইভ সিঙ্ক হয়েছে কি না — ব্যাজ সত্য বলে।
  const dataSource = useAdminCollectionSource(
    'mcpServices',
    'সার্ভিস রেজিস্ট্রি এখনো লাইভ সিঙ্ক হয়নি — localStorage ক্যাশ/ফলব্যাক দেখানো হচ্ছে।'
  );

  // Merge live healthSnapshot.services with MCP Tower services registry so ALL services appear
  const unifiedServices = useMemo<UnifiedServiceNode[]>(() => {
    const byKey = new Map<string, UnifiedServiceNode>();

    const normalizeKey = (idOrName: string) =>
      (idOrName || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // Seed from MCP Tower services
    for (const svc of services) {
      const key = normalizeKey(svc.name || svc.id);
      const status = normalizeStatus(svc.status);
      const buffered = ringBuffer[svc.id] || ringBuffer[key] || [];
      const fallbackSample: TelemetrySample = {
        ts: svc.lastChecked || 'now',
        latencyMs: Math.round(svc.latencyMs || 0),
        cpuPercent: Math.round(svc.cpuPercent || 0),
        memoryMb: Math.round(svc.memoryMb || 0),
      };

      byKey.set(key, {
        id: svc.id,
        name: svc.name,
        displayName: svc.displayName || svc.name,
        category: svc.category || 'core',
        provider: 'MCP Tower',
        status,
        rawStatus: svc.status,
        latencyMs: Math.round(svc.latencyMs || 0),
        p50LatencyMs: null,
        p95LatencyMs: null,
        cpuPercent: Math.round(svc.cpuPercent || 0),
        memoryMb: Math.round(svc.memoryMb || 0),
        memoryPercent: null,
        uptime: svc.uptime || '—',
        version: svc.version || '—',
        endpoint: svc.endpoint || '—',
        errorCount: svc.errorCount || 0,
        consecutiveFailures: status === 'critical' ? Math.max(1, svc.errorCount || 1) : 0,
        checkedAt: svc.lastChecked || 'Recently',
        source: 'mcp-registry',
        history: buffered.length > 0 ? buffered : [fallbackSample],
        logs: (svc.logs || []).map((l) => ({
          id: l.id,
          timestamp: l.timestamp,
          level: l.level,
          message: l.message,
        })),
      });
    }

    // Merge / enrich with live healthSnapshot probes
    const liveList: McpServiceHealthMetric[] = healthSnapshot?.services || [];
    for (const metric of liveList) {
      const key = normalizeKey(metric.name || metric.id);
      const existing = byKey.get(key);
      const status = normalizeStatus(metric.status);

      const metricHistory: TelemetrySample[] = (metric.history || []).map((pt) => ({
        ts: pt.ts,
        latencyMs: Math.round(pt.latencyMs ?? 0),
        cpuPercent: Math.round(pt.cpuPercent ?? 0),
        memoryMb: Math.round(pt.memoryMb ?? 0),
      }));
      const buffered = ringBuffer[metric.id] || ringBuffer[key] || [];
      const mergedHistory =
        metricHistory.length >= 2
          ? metricHistory.slice(-16)
          : buffered.length >= 2
            ? buffered.slice(-16)
            : [
                {
                  ts: metric.checkedAt || 'now',
                  latencyMs: Math.round(metric.latencyMs ?? existing?.latencyMs ?? 0),
                  cpuPercent: Math.round(metric.cpuPercent ?? existing?.cpuPercent ?? 0),
                  memoryMb: Math.round(metric.memoryMb ?? existing?.memoryMb ?? 0),
                },
              ];

      byKey.set(key, {
        id: metric.id || existing?.id || key,
        name: metric.name || existing?.name || key,
        displayName: metric.displayName || existing?.displayName || metric.name,
        category: metric.category || existing?.category || 'runtime',
        provider: metric.provider || existing?.provider || 'Platform',
        status,
        rawStatus: metric.rawStatus || metric.status,
        latencyMs: Math.round(metric.latencyMs ?? existing?.latencyMs ?? 0),
        p50LatencyMs:
          metric.p50LatencyMs != null
            ? Math.round(metric.p50LatencyMs)
            : (existing?.p50LatencyMs ?? null),
        p95LatencyMs:
          metric.p95LatencyMs != null
            ? Math.round(metric.p95LatencyMs)
            : (existing?.p95LatencyMs ?? null),
        cpuPercent: Math.round(metric.cpuPercent ?? existing?.cpuPercent ?? 0),
        memoryMb: Math.round(metric.memoryMb ?? existing?.memoryMb ?? 0),
        memoryPercent:
          metric.memoryPercent != null
            ? Math.round(metric.memoryPercent)
            : (existing?.memoryPercent ?? null),
        uptime: existing?.uptime || 'Live Probe',
        version: existing?.version || metric.source,
        endpoint: existing?.endpoint || metric.provider,
        errorCount: Math.max(existing?.errorCount ?? 0, metric.consecutiveFailures ?? 0),
        consecutiveFailures: metric.consecutiveFailures ?? 0,
        checkedAt: metric.checkedAt || existing?.checkedAt || 'Just now',
        source: metric.source || 'live-probe',
        evidenceSummary: metric.evidenceSummary,
        errorMessage: metric.errorMessage,
        history: mergedHistory,
        logs: existing?.logs || [],
      });
    }

    // Sort: critical first, degraded second, then highest latency first
    const rank = { critical: 0, degraded: 1, healthy: 2 };
    return Array.from(byKey.values()).sort((a, b) => {
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      return b.latencyMs - a.latencyMs;
    });
  }, [services, healthSnapshot, ringBuffer]);

  // Append rolling real-time samples whenever live data updates or 10s heartbeat fires
  useEffect(() => {
    const label = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    setRingBuffer((prev) => {
      const next = { ...prev };
      for (const svc of unifiedServices) {
        const list = next[svc.id] ? [...next[svc.id]] : [];
        const last = list[list.length - 1];
        if (
          !last ||
          last.ts !== label ||
          last.latencyMs !== svc.latencyMs ||
          last.cpuPercent !== svc.cpuPercent
        ) {
          list.push({
            ts: label,
            latencyMs: svc.latencyMs,
            cpuPercent: svc.cpuPercent,
            memoryMb: svc.memoryMb,
          });
          next[svc.id] = list.slice(-16);
        }
      }
      return next;
    });
  }, [healthSnapshot?.collectedAt, services, lastTickAt]);

  // Real-time 10s heartbeat polling
  useEffect(() => {
    if (!isLiveStream) return;
    const timer = window.setInterval(() => {
      onRefreshHealth();
      setLastTickAt(new Date());
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [isLiveStream, onRefreshHealth]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    unifiedServices.forEach((s) => set.add(s.category));
    return ['all', ...Array.from(set).sort()];
  }, [unifiedServices]);

  const filteredServices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return unifiedServices.filter((svc) => {
      if (statusFilter !== 'all' && svc.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && svc.category !== categoryFilter) return false;
      if (
        q &&
        !svc.displayName.toLowerCase().includes(q) &&
        !svc.name.toLowerCase().includes(q) &&
        !svc.category.toLowerCase().includes(q) &&
        !svc.provider.toLowerCase().includes(q) &&
        !svc.endpoint.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [unifiedServices, statusFilter, categoryFilter, searchQuery]);

  const selectedService = useMemo(() => {
    if (selectedServiceId) {
      return unifiedServices.find((s) => s.id === selectedServiceId) || unifiedServices[0] || null;
    }
    return unifiedServices[0] || null;
  }, [unifiedServices, selectedServiceId]);

  // Status totals
  const fleetCounts = useMemo(() => {
    const healthy = unifiedServices.filter((s) => s.status === 'healthy').length;
    const degraded = unifiedServices.filter((s) => s.status === 'degraded').length;
    const critical = unifiedServices.filter((s) => s.status === 'critical').length;
    const avgLatency = unifiedServices.length
      ? Math.round(
          unifiedServices.reduce((sum, s) => sum + s.latencyMs, 0) / unifiedServices.length
        )
      : 0;
    const avgCpu = unifiedServices.length
      ? Math.round(
          unifiedServices.reduce((sum, s) => sum + s.cpuPercent, 0) / unifiedServices.length
        )
      : 0;
    const totalMemMb = unifiedServices.reduce((sum, s) => sum + s.memoryMb, 0);
    return {
      total: unifiedServices.length,
      healthy,
      degraded,
      critical,
      avgLatency,
      avgCpu,
      totalMemMb,
    };
  }, [unifiedServices]);

  // Unified Real-Time Activity Stream (Alerts + Workers + Jobs + Service Logs + Ops)
  const activityFeed = useMemo<LiveActivityEvent[]>(() => {
    const events: LiveActivityEvent[] = [];

    // 1. Live Proactive Health Alerts
    const alerts: ProactiveHealthAlert[] = healthSnapshot?.alerts || [];
    alerts.forEach((a) => {
      events.push({
        id: `alert-${a.id}`,
        kind: 'alert',
        severity: a.severity === 'critical' ? 'critical' : 'warning',
        source: a.displayName,
        title: `${String(a.metric || 'METRIC').toUpperCase()} threshold breach (${a.valueLabel})`,
        detail: a.message,
        timestamp: a.detectedAt || 'Live',
        meta: `Limit ${a.thresholdLabel}`,
      });
    });

    // 2. Unhealthy/Degraded service status signals
    unifiedServices
      .filter((s) => s.status !== 'healthy')
      .forEach((s) => {
        events.push({
          id: `svc-state-${s.id}`,
          kind: 'alert',
          severity: s.status === 'critical' ? 'critical' : 'warning',
          source: s.displayName,
          title: `Service ${String(s.rawStatus || s.status || 'degraded').toUpperCase()} (${s.latencyMs}ms)`,
          detail:
            s.errorMessage ||
            s.evidenceSummary ||
            `${s.consecutiveFailures} consecutive failure(s) on ${s.provider}`,
          timestamp: s.checkedAt,
          meta: s.category,
        });
      });

    // 3. Autonomous Swarm Workers live activity
    workers.forEach((w) => {
      events.push({
        id: `worker-${w.id}`,
        kind: 'worker',
        severity:
          w.status === 'error'
            ? 'critical'
            : w.status === 'paused'
              ? 'warning'
              : w.status === 'active'
                ? 'success'
                : 'info',
        source: w.name,
        title: `${w.type} · ${String(w.status || 'unknown').toUpperCase()}`,
        detail: w.currentTask || w.logs?.[w.logs.length - 1] || 'Awaiting queued tasks',
        timestamp: w.uptime,
        meta: `${w.processedCount} done · ${w.successRate}% ok`,
      });
    });

    // 4. Task Queue Jobs
    jobs.slice(0, 10).forEach((j) => {
      events.push({
        id: `job-${j.id}`,
        kind: 'job',
        severity:
          j.status === 'dlq' || j.status === 'failed'
            ? 'critical'
            : j.status === 'active'
              ? 'info'
              : j.status === 'completed'
                ? 'success'
                : 'warning',
        source: j.queueName,
        title: `${j.taskType} (${String(j.status || 'unknown').toUpperCase()})`,
        detail: j.errorDetails || j.payloadSummary,
        timestamp: j.createdAt,
        meta: `${j.latencyMs}ms · try ${j.attempts}/${j.maxAttempts}`,
      });
    });

    // 5. Recent service logs
    unifiedServices.forEach((s) => {
      s.logs.slice(0, 2).forEach((log) => {
        events.push({
          id: `log-${s.id}-${log.id}`,
          kind: 'log',
          severity: log.level === 'error' ? 'critical' : log.level === 'warn' ? 'warning' : 'info',
          source: s.displayName,
          title: `[${String(log.level || 'INFO').toUpperCase()}] Runtime Event`,
          detail: log.message,
          timestamp: log.timestamp,
          meta: s.category,
        });
      });
    });

    // 6. Auto-Healer, Pipelines & Cron operations
    healerIncidents.slice(0, 3).forEach((inc) => {
      events.push({
        id: `healer-${inc.id}`,
        kind: 'ops',
        severity: inc.recovered ? 'success' : 'warning',
        source: inc.component,
        title: `AutoHealer (${inc.circuitState})`,
        detail: inc.actionTaken,
        timestamp: inc.occurredAt,
      });
    });

    pipelines.slice(0, 2).forEach((p) => {
      events.push({
        id: `pipe-${p.id}`,
        kind: 'ops',
        severity:
          p.status === 'failed'
            ? 'critical'
            : p.status === 'running'
              ? 'info'
              : p.status === 'waiting-approval'
                ? 'warning'
                : 'success',
        source: p.pipelineName,
        title: `${p.environment} deploy · ${p.status}`,
        detail: `Commit ${p.commitSha.slice(0, 7)} triggered by ${p.triggeredBy}`,
        timestamp: p.startedAt,
      });
    });

    cronTasks.slice(0, 2).forEach((c) => {
      events.push({
        id: `cron-${c.id}`,
        kind: 'ops',
        severity: c.lastStatus === 'warning' ? 'warning' : 'success',
        source: c.name,
        title: `Cron (${c.schedule})`,
        detail: `Next run in ${c.nextRunIn}`,
        timestamp: c.lastRunAt,
      });
    });

    return events;
  }, [
    healthSnapshot?.alerts,
    unifiedServices,
    workers,
    jobs,
    healerIncidents,
    pipelines,
    cronTasks,
  ]);

  const filteredActivities = useMemo(() => {
    if (activityFilter === 'all') return activityFeed.slice(0, 18);
    return activityFeed.filter((e) => e.kind === activityFilter).slice(0, 18);
  }, [activityFeed, activityFilter]);

  // Queue breakdown summary
  const queueBreakdown = useMemo(() => {
    const names = ['ai-reasoning', 'github-sync', 'code-audit', 'vector-embedding'] as const;
    return names.map((qName) => {
      const items = jobs.filter((j) => j.queueName === qName);
      return {
        name: qName,
        total: items.length,
        active: items.filter((j) => j.status === 'active').length,
        waiting: items.filter((j) => j.status === 'waiting').length,
        completed: items.filter((j) => j.status === 'completed').length,
        failed: items.filter((j) => j.status === 'failed' || j.status === 'dlq').length,
      };
    });
  }, [jobs]);

  // ─── D3 Topology Map Ref & Renderer ───
  const vizContainerRef = useRef<HTMLDivElement | null>(null);
  const topologySvgRef = useRef<SVGSVGElement | null>(null);
  const scatterSvgRef = useRef<SVGSVGElement | null>(null);
  const inspectorSvgRef = useRef<SVGSVGElement | null>(null);
  const vizWidth = useElementWidth(vizContainerRef, 680);

  useEffect(() => {
    if (viewMode !== 'topology') return;
    const svgEl = topologySvgRef.current;
    if (!svgEl || vizWidth <= 0) return;

    const width = vizWidth;
    const height = 430;
    const cx = width / 2;
    const cy = height / 2;
    const ringRadius = Math.max(105, Math.min(width, height) * 0.36);

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    // Subtle concentric radar rings
    [0.45, 0.78, 1.04].forEach((mult) => {
      svg
        .append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', ringRadius * mult)
        .attr('fill', 'none')
        .attr('stroke', 'currentColor')
        .attr('stroke-opacity', 0.08)
        .attr('stroke-dasharray', mult === 1.04 ? '2 5' : '4 5');
    });

    const nodes = filteredServices;
    const total = Math.max(1, nodes.length);

    // Links from Central Hub to every service
    const linksGroup = svg.append('g');
    const nodesGroup = svg.append('g');

    nodes.forEach((svc, idx) => {
      const angle = (idx / total) * Math.PI * 2 - Math.PI / 2;
      const nx = cx + Math.cos(angle) * ringRadius;
      const ny = cy + Math.sin(angle) * ringRadius;
      const color = statusColorHex(svc.status);
      const isSelected = selectedService?.id === svc.id;
      const isHovered = hoveredNodeId === svc.id;

      // Connection line
      linksGroup
        .append('line')
        .attr('x1', cx)
        .attr('y1', cy)
        .attr('x2', nx)
        .attr('y2', ny)
        .attr('stroke', color)
        .attr(
          'stroke-opacity',
          isSelected || isHovered ? 0.85 : svc.status === 'healthy' ? 0.28 : 0.6
        )
        .attr('stroke-width', isSelected || isHovered ? 2.2 : 1.35)
        .attr('stroke-dasharray', svc.status === 'healthy' ? 'none' : '4 3');

      // Midpoint latency badge on link
      const mx = cx + Math.cos(angle) * (ringRadius * 0.58);
      const my = cy + Math.sin(angle) * (ringRadius * 0.58);
      linksGroup
        .append('text')
        .attr('x', mx)
        .attr('y', my - 3)
        .attr('text-anchor', 'middle')
        .attr('fill', 'currentColor')
        .attr('opacity', isSelected || isHovered ? 0.9 : 0.5)
        .attr('font-size', 9.5)
        .attr('font-family', 'JetBrains Mono, monospace')
        .text(`${svc.latencyMs}ms`);

      // Outer alert halo for non-healthy or selected nodes
      const nodeRadius = Math.max(12, Math.min(20, 12 + svc.cpuPercent / 14));
      if (svc.status !== 'healthy' || isSelected) {
        nodesGroup
          .append('circle')
          .attr('cx', nx)
          .attr('cy', ny)
          .attr('r', nodeRadius + 7)
          .attr('fill', color)
          .attr('fill-opacity', isSelected ? 0.22 : 0.14);
      }

      // Service node circle
      const nodeG = nodesGroup
        .append('g')
        .style('cursor', 'pointer')
        .on('mouseenter', () => setHoveredNodeId(svc.id))
        .on('mouseleave', () => setHoveredNodeId(null))
        .on('click', () => {
          setSelectedServiceId(svc.id);
          setRightTab('inspector');
        });

      nodeG
        .append('circle')
        .attr('cx', nx)
        .attr('cy', ny)
        .attr('r', nodeRadius)
        .attr('fill', color)
        .attr('fill-opacity', 0.92)
        .attr('stroke', isSelected ? '#162238' : '#ffffff')
        .attr('stroke-width', isSelected ? 2.8 : 2);

      // CPU % inside node
      nodeG
        .append('text')
        .attr('x', nx)
        .attr('y', ny + 3.5)
        .attr('text-anchor', 'middle')
        .attr('fill', '#ffffff')
        .attr('font-size', 9)
        .attr('font-weight', 700)
        .attr('font-family', 'JetBrains Mono, monospace')
        .text(`${svc.cpuPercent}%`);

      // Service label placed outside ring
      const labelDist = ringRadius + nodeRadius + 15;
      const lx = cx + Math.cos(angle) * labelDist;
      const ly = cy + Math.sin(angle) * labelDist;
      const anchor = Math.cos(angle) > 0.25 ? 'start' : Math.cos(angle) < -0.25 ? 'end' : 'middle';
      const shortName =
        svc.displayName.length > 18 ? `${svc.displayName.slice(0, 17)}…` : svc.displayName;

      nodeG
        .append('text')
        .attr('x', lx)
        .attr('y', ly + 3)
        .attr('text-anchor', anchor)
        .attr('fill', 'currentColor')
        .attr('font-size', 11)
        .attr('font-weight', isSelected || svc.status !== 'healthy' ? 700 : 500)
        .text(shortName);

      nodeG
        .append('text')
        .attr('x', lx)
        .attr('y', ly + 15)
        .attr('text-anchor', anchor)
        .attr('fill', 'currentColor')
        .attr('opacity', 0.55)
        .attr('font-size', 9.5)
        .attr('font-family', 'JetBrains Mono, monospace')
        .text(`${svc.category} · ${svc.memoryMb}MB`);
    });

    // Central MCP Control Plane Hub
    const hubG = svg.append('g');
    hubG
      .append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', 44)
      .attr('fill', '#162238')
      .attr('stroke', fleetCounts.critical > 0 ? '#e11d48' : '#4a70e8')
      .attr('stroke-width', 2.5);

    hubG
      .append('text')
      .attr('x', cx)
      .attr('y', cy - 6)
      .attr('text-anchor', 'middle')
      .attr('fill', '#f8faff')
      .attr('font-size', 11)
      .attr('font-weight', 700)
      .text('MCP HUB');

    hubG
      .append('text')
      .attr('x', cx)
      .attr('y', cy + 10)
      .attr('text-anchor', 'middle')
      .attr('fill', '#93c5fd')
      .attr('font-size', 10)
      .attr('font-family', 'JetBrains Mono, monospace')
      .text(`${fleetCounts.healthy}/${fleetCounts.total} OK`);

    hubG
      .append('text')
      .attr('x', cx)
      .attr('y', cy + 23)
      .attr('text-anchor', 'middle')
      .attr('fill', '#cbd5e1')
      .attr('font-size', 9)
      .attr('font-family', 'JetBrains Mono, monospace')
      .text(`${trafficSummary?.rpm ?? 0} RPM`);
  }, [
    viewMode,
    filteredServices,
    vizWidth,
    selectedService?.id,
    hoveredNodeId,
    fleetCounts,
    trafficSummary?.rpm,
  ]);

  // ─── D3 Scatter Plot Renderer (Latency ms vs CPU %) ───
  useEffect(() => {
    if (viewMode !== 'scatter') return;
    const svgEl = scatterSvgRef.current;
    if (!svgEl || vizWidth <= 0) return;

    const width = vizWidth;
    const height = 400;
    const margin = { top: 24, right: 26, bottom: 42, left: 52 };
    const innerW = Math.max(120, width - margin.left - margin.right);
    const innerH = Math.max(120, height - margin.top - margin.bottom);

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const maxLat = Math.max(400, (d3.max(filteredServices, (d) => d.latencyMs) || 300) * 1.18);
    const maxCpu = Math.max(100, d3.max(filteredServices, (d) => d.cpuPercent) || 100);

    const x = d3.scaleLinear().domain([0, maxLat]).nice().range([0, innerW]);
    const y = d3.scaleLinear().domain([0, maxCpu]).nice().range([innerH, 0]);

    // Shaded Warning / Critical Latency Zone (> 500ms or > 75% CPU)
    const warnLat = Math.min(maxLat, healthSnapshot?.thresholds?.latencyWarnMs ?? 400);
    const warnCpu = healthSnapshot?.thresholds?.cpuWarnPct ?? 75;

    if (warnLat < maxLat) {
      g.append('rect')
        .attr('x', x(warnLat))
        .attr('y', 0)
        .attr('width', Math.max(0, innerW - x(warnLat)))
        .attr('height', innerH)
        .attr('fill', '#d97706')
        .attr('fill-opacity', 0.06);
    }

    g.append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', innerW)
      .attr('height', Math.max(0, y(warnCpu)))
      .attr('fill', '#e11d48')
      .attr('fill-opacity', 0.05);

    // Gridlines
    y.ticks(5).forEach((t) => {
      g.append('line')
        .attr('x1', 0)
        .attr('x2', innerW)
        .attr('y1', y(t))
        .attr('y2', y(t))
        .attr('stroke', 'currentColor')
        .attr('stroke-opacity', 0.1)
        .attr('stroke-dasharray', '3 4');
      g.append('text')
        .attr('x', -8)
        .attr('y', y(t) + 3.5)
        .attr('text-anchor', 'end')
        .attr('fill', 'currentColor')
        .attr('opacity', 0.6)
        .attr('font-size', 10)
        .attr('font-family', 'JetBrains Mono, monospace')
        .text(`${t}%`);
    });

    x.ticks(5).forEach((t) => {
      g.append('line')
        .attr('x1', x(t))
        .attr('x2', x(t))
        .attr('y1', 0)
        .attr('y2', innerH)
        .attr('stroke', 'currentColor')
        .attr('stroke-opacity', 0.08)
        .attr('stroke-dasharray', '3 4');
      g.append('text')
        .attr('x', x(t))
        .attr('y', innerH + 18)
        .attr('text-anchor', 'middle')
        .attr('fill', 'currentColor')
        .attr('opacity', 0.6)
        .attr('font-size', 10)
        .attr('font-family', 'JetBrains Mono, monospace')
        .text(`${t}ms`);
    });

    // Axis captions
    g.append('text')
      .attr('x', innerW / 2)
      .attr('y', innerH + 35)
      .attr('text-anchor', 'middle')
      .attr('fill', 'currentColor')
      .attr('opacity', 0.6)
      .attr('font-size', 10.5)
      .text('Response Latency (ms)');

    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -innerH / 2)
      .attr('y', -38)
      .attr('text-anchor', 'middle')
      .attr('fill', 'currentColor')
      .attr('opacity', 0.6)
      .attr('font-size', 10.5)
      .text('CPU Utilization (%)');

    // Service bubbles (size scaled by Memory MB)
    const maxMem = Math.max(256, d3.max(filteredServices, (d) => d.memoryMb) || 512);
    const rScale = d3.scaleSqrt().domain([0, maxMem]).range([7, 18]);

    filteredServices.forEach((svc) => {
      const px = x(svc.latencyMs);
      const py = y(svc.cpuPercent);
      const radius = rScale(svc.memoryMb);
      const color = statusColorHex(svc.status);
      const isSelected = selectedService?.id === svc.id;

      const dotG = g
        .append('g')
        .style('cursor', 'pointer')
        .on('click', () => {
          setSelectedServiceId(svc.id);
          setRightTab('inspector');
        });

      dotG
        .append('circle')
        .attr('cx', px)
        .attr('cy', py)
        .attr('r', radius)
        .attr('fill', color)
        .attr('fill-opacity', isSelected ? 0.95 : 0.72)
        .attr('stroke', isSelected ? '#162238' : '#ffffff')
        .attr('stroke-width', isSelected ? 2.5 : 1.5);

      dotG
        .append('text')
        .attr('x', px)
        .attr('y', py - radius - 5)
        .attr('text-anchor', px > innerW * 0.8 ? 'end' : px < innerW * 0.15 ? 'start' : 'middle')
        .attr('fill', 'currentColor')
        .attr('font-size', 10)
        .attr('font-weight', isSelected || svc.status !== 'healthy' ? 700 : 500)
        .text(svc.displayName.length > 16 ? `${svc.displayName.slice(0, 15)}…` : svc.displayName);
    });
  }, [viewMode, filteredServices, vizWidth, selectedService?.id, healthSnapshot?.thresholds]);

  // ─── D3 Selected Service Inspector Dual-Metric Chart ───
  useEffect(() => {
    if (rightTab !== 'inspector' || !selectedService) return;
    const svgEl = inspectorSvgRef.current;
    if (!svgEl) return;

    const width = 320;
    const height = 112;
    const margin = { top: 10, right: 10, bottom: 20, left: 36 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const pts =
      selectedService.history.length >= 2
        ? selectedService.history
        : [
            {
              ts: 'Prev',
              latencyMs: selectedService.latencyMs,
              cpuPercent: selectedService.cpuPercent,
              memoryMb: selectedService.memoryMb,
            },
            {
              ts: 'Now',
              latencyMs: selectedService.latencyMs,
              cpuPercent: selectedService.cpuPercent,
              memoryMb: selectedService.memoryMb,
            },
          ];

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const x = d3
      .scaleLinear()
      .domain([0, Math.max(1, pts.length - 1)])
      .range([0, innerW]);

    const maxLat = Math.max(40, (d3.max(pts, (d) => d.latencyMs) || 40) * 1.2);
    const yLat = d3.scaleLinear().domain([0, maxLat]).nice().range([innerH, 0]);
    const yCpu = d3.scaleLinear().domain([0, 100]).range([innerH, 0]);

    yLat.ticks(3).forEach((t) => {
      g.append('line')
        .attr('x1', 0)
        .attr('x2', innerW)
        .attr('y1', yLat(t))
        .attr('y2', yLat(t))
        .attr('stroke', 'currentColor')
        .attr('stroke-opacity', 0.1)
        .attr('stroke-dasharray', '2 3');
      g.append('text')
        .attr('x', -6)
        .attr('y', yLat(t) + 3)
        .attr('text-anchor', 'end')
        .attr('fill', 'currentColor')
        .attr('opacity', 0.55)
        .attr('font-size', 9.5)
        .attr('font-family', 'JetBrains Mono, monospace')
        .text(`${t}`);
    });

    const latLine = d3
      .line<TelemetrySample>()
      .x((_, i) => x(i))
      .y((d) => yLat(d.latencyMs))
      .curve(d3.curveMonotoneX);

    const cpuLine = d3
      .line<TelemetrySample>()
      .x((_, i) => x(i))
      .y((d) => yCpu(d.cpuPercent))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(pts)
      .attr('fill', 'none')
      .attr('stroke', statusColorHex(selectedService.status))
      .attr('stroke-width', 2)
      .attr('d', latLine);

    g.append('path')
      .datum(pts)
      .attr('fill', 'none')
      .attr('stroke', '#4a70e8')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '3 3')
      .attr('d', cpuLine);

    g.append('text')
      .attr('x', 0)
      .attr('y', innerH + 14)
      .attr('fill', 'currentColor')
      .attr('opacity', 0.55)
      .attr('font-size', 9)
      .attr('font-family', 'JetBrains Mono, monospace')
      .text(pts[0].ts);

    g.append('text')
      .attr('x', innerW)
      .attr('y', innerH + 14)
      .attr('text-anchor', 'end')
      .attr('fill', 'currentColor')
      .attr('opacity', 0.55)
      .attr('font-size', 9)
      .attr('font-family', 'JetBrains Mono, monospace')
      .text(pts[pts.length - 1].ts);
  }, [rightTab, selectedService]);

  const activeWorkerCount = workers.filter((w) => w.status === 'active').length;
  const activeJobCount = jobs.filter((j) => j.status === 'active' || j.status === 'waiting').length;

  return (
    <section
      aria-label="All Services Real-Time Health and Activity Visualization"
      className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4"
    >
      {/* Top Command Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Server className="w-4 h-4 text-[#4a70e8] shrink-0" />
            <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
              All Services — Real-Time Health, Activity & Telemetry
            </h2>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold text-emerald-600 dark:text-emerald-400">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                {isLiveStream && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    isLiveStream ? 'bg-emerald-500' : 'bg-slate-400'
                  }`}
                />
              </span>
              {isLiveStream ? 'LIVE' : 'PAUSED'}
            </span>
            <DataSourceBadge
              source={dataSource.source}
              reason={dataSource.reason}
              ageMs={dataSource.ageMs}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            <span>{fleetCounts.total} services</span>
            <span aria-hidden="true">·</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
              {fleetCounts.healthy} healthy
            </span>
            {fleetCounts.degraded > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-amber-600 dark:text-amber-400 font-semibold">
                  {fleetCounts.degraded} degraded
                </span>
              </>
            )}
            {fleetCounts.critical > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-rose-600 dark:text-rose-400 font-semibold">
                  {fleetCounts.critical} critical
                </span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>Avg {fleetCounts.avgLatency}ms</span>
            <span aria-hidden="true">·</span>
            <span>CPU {fleetCounts.avgCpu}%</span>
            <span aria-hidden="true">·</span>
            <span>{activeWorkerCount} active daemons</span>
            <span aria-hidden="true">·</span>
            <span>{activeJobCount} queued/active jobs</span>
          </div>
        </div>

        {/* Visualization Mode & Live Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800">
            {(
              [
                { id: 'grid', label: 'Matrix', icon: Grid2x2 },
                { id: 'topology', label: 'Topology', icon: Network },
                { id: 'scatter', label: 'Load Map', icon: Gauge },
              ] as const
            ).map((mode) => {
              const Icon = mode.icon;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setViewMode(mode.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                    viewMode === mode.id
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{mode.label}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setIsLiveStream((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${
              isLiveStream
                ? 'border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
            }`}
          >
            {isLiveStream ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isLiveStream ? '10s' : 'Paused'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onProbeAll();
              setLastTickAt(new Date());
            }}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#162238] dark:bg-white text-white dark:text-slate-900 hover:opacity-90 text-xs font-semibold cursor-pointer transition-opacity disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Probe All</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter services, providers..."
              className="pl-8 pr-3 py-1.5 w-56 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-[#4a70e8]"
            />
          </div>

          <div className="inline-flex items-center gap-1 text-xs">
            {(
              [
                { id: 'all', label: `All (${fleetCounts.total})` },
                { id: 'healthy', label: `Healthy (${fleetCounts.healthy})` },
                { id: 'degraded', label: `Degraded (${fleetCounts.degraded})` },
                { id: 'critical', label: `Critical (${fleetCounts.critical})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-2.5 py-1 rounded-md font-medium cursor-pointer transition-colors ${
                  statusFilter === tab.id
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Category Filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono capitalize whitespace-nowrap cursor-pointer transition-colors ${
                categoryFilter === cat
                  ? 'bg-[#4a70e8]/15 text-[#4a70e8] dark:text-[#8aa4ff] font-bold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Main Split Workspace: All Services Canvas (8 cols) + Live Activity & Inspector Rail (4 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* Left: All Services Live Visualization */}
        <div ref={vizContainerRef} className="xl:col-span-8 min-w-0">
          {filteredServices.length === 0 ? (
            <div className="p-10 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
              No services match the current filter criteria.
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredServices.map((svc) => {
                const isSelected = selectedService?.id === svc.id && rightTab === 'inspector';
                const color = statusColorHex(svc.status);
                return (
                  <button
                    key={svc.id}
                    type="button"
                    onClick={() => {
                      setSelectedServiceId(svc.id);
                      setRightTab('inspector');
                    }}
                    className={`text-left p-4 rounded-xl border transition-all cursor-pointer flex flex-col gap-3 ${
                      isSelected
                        ? 'border-[#4a70e8] bg-[#4a70e8]/[0.04] dark:bg-[#4a70e8]/10'
                        : svc.status === 'critical'
                          ? 'border-rose-300/90 dark:border-rose-800/80 bg-rose-50/40 dark:bg-rose-950/20 hover:border-rose-400'
                          : svc.status === 'degraded'
                            ? 'border-amber-300/90 dark:border-amber-800/80 bg-amber-50/40 dark:bg-amber-950/20 hover:border-amber-400'
                            : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    {/* Service Identity + Sparkline */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                            {svc.status !== 'healthy' && (
                              <span
                                className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                                style={{ backgroundColor: color }}
                              />
                            )}
                            <span
                              className="relative inline-flex rounded-full h-2.5 w-2.5"
                              style={{ backgroundColor: color }}
                            />
                          </span>
                          <span className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            {svc.displayName}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                          <span className="uppercase">{svc.category}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{svc.provider}</span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={
                              svc.status === 'healthy'
                                ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                : svc.status === 'degraded'
                                  ? 'text-amber-600 dark:text-amber-400 font-semibold'
                                  : 'text-rose-600 dark:text-rose-400 font-semibold'
                            }
                          >
                            {String(svc.rawStatus || svc.status || 'unknown').toUpperCase()}
                          </span>
                        </div>
                      </div>

                      <ServiceMiniSparkline
                        samples={svc.history}
                        color={color}
                        serviceId={svc.id}
                      />
                    </div>

                    {/* Live Metrics Strip */}
                    <div className="grid grid-cols-4 gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-800 text-[11px] font-mono tabular-nums">
                      <div>
                        <div className="text-[10px] font-sans text-slate-400">Latency</div>
                        <div
                          className={`font-semibold ${
                            svc.latencyMs > 500
                              ? 'text-rose-600 dark:text-rose-400'
                              : svc.latencyMs > 250
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-slate-900 dark:text-white'
                          }`}
                        >
                          {svc.latencyMs}ms
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-sans text-slate-400">CPU</div>
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {svc.cpuPercent}%
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-sans text-slate-400">Memory</div>
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {svc.memoryMb}MB
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-sans text-slate-400">Errors</div>
                        <div
                          className={`font-semibold ${
                            svc.errorCount > 0
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {svc.errorCount}
                        </div>
                      </div>
                    </div>

                    {/* Micro CPU Load Bar */}
                    <div className="space-y-1">
                      <div className="h-1.5 w-full rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.min(100, Math.max(4, svc.cpuPercent))}%`,
                            backgroundColor:
                              svc.cpuPercent >= 80
                                ? '#e11d48'
                                : svc.cpuPercent >= 60
                                  ? '#d97706'
                                  : '#4a70e8',
                          }}
                        />
                      </div>
                      {svc.errorMessage && (
                        <div className="text-[11px] text-rose-600 dark:text-rose-400 truncate">
                          {svc.errorMessage}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : viewMode === 'topology' ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 p-3">
              <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 px-1 mb-1">
                <span>
                  Live MCP Constellation — Node size = CPU load · Click any node to inspect
                </span>
                <span className="font-mono tabular-nums">
                  {filteredServices.length} active nodes
                </span>
              </div>
              <svg
                ref={topologySvgRef}
                className="w-full h-[430px] block text-slate-700 dark:text-slate-300"
                role="img"
                aria-label="D3 real-time service health topology constellation"
              />
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 p-3">
              <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 px-1 mb-1">
                <span>Latency vs CPU Load Matrix — Bubble area = Memory MB · Click to inspect</span>
                <span className="font-mono tabular-nums">
                  Total RAM: {fleetCounts.totalMemMb.toLocaleString()}MB
                </span>
              </div>
              <svg
                ref={scatterSvgRef}
                className="w-full h-[400px] block text-slate-700 dark:text-slate-300"
                role="img"
                aria-label="D3 real-time service latency vs CPU load scatter chart"
              />
            </div>
          )}
        </div>

        {/* Right Rail: Live Activity Stream, Workers/Queues, and Selected Service Inspector */}
        <aside className="xl:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 p-4 flex flex-col gap-3 min-w-0">
          {/* Right Rail Mode Switcher */}
          <div className="grid grid-cols-3 p-0.5 rounded-lg bg-slate-200/70 dark:bg-slate-800 text-xs font-semibold">
            {(
              [
                { id: 'activity', label: 'Activity', icon: Activity },
                { id: 'workers', label: 'Swarm', icon: Workflow },
                { id: 'inspector', label: 'Inspect', icon: Terminal },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setRightTab(tab.id)}
                  className={`inline-flex items-center justify-center gap-1.5 py-1.5 rounded-md cursor-pointer transition-colors ${
                    rightTab === tab.id
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {rightTab === 'activity' && (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 text-[11px] font-mono overflow-x-auto">
                  {(['all', 'alert', 'worker', 'job', 'log'] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setActivityFilter(kind)}
                      className={`px-2 py-0.5 rounded capitalize cursor-pointer transition-colors ${
                        activityFilter === kind
                          ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      {kind}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                  {filteredActivities.length} events
                </span>
              </div>

              <div className="space-y-2 max-h-[410px] overflow-y-auto pr-1">
                {filteredActivities.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    No live activity events in this filter.
                  </div>
                ) : (
                  filteredActivities.map((evt) => (
                    <div
                      key={evt.id}
                      className="p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {evt.severity === 'critical' ? (
                            <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                          ) : evt.severity === 'warning' ? (
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                          ) : evt.severity === 'success' ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          ) : (
                            <Radio className="w-3.5 h-3.5 text-[#4a70e8] shrink-0" />
                          )}
                          <span className="truncate">{evt.source}</span>
                        </span>
                        <span className="font-mono text-[10px] text-slate-400 shrink-0">
                          {evt.timestamp}
                        </span>
                      </div>
                      <div className="text-xs font-medium text-slate-800 dark:text-slate-200 leading-snug">
                        {evt.title}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-snug">
                        {evt.detail}
                      </div>
                      {evt.meta && (
                        <div className="text-[10.5px] font-mono tabular-nums text-slate-400">
                          {evt.meta}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {rightTab === 'workers' && (
            <div className="space-y-3 max-h-[450px] overflow-y-auto pr-1">
              {/* Swarm Daemons */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
                  <span className="inline-flex items-center gap-1.5">
                    <Bot className="w-3.5 h-3.5 text-purple-500" />
                    <span>Autonomous Swarm ({workers.length})</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigateTab('agent-swarm')}
                    className="inline-flex items-center gap-0.5 text-[11px] text-[#4a70e8] dark:text-[#8aa4ff] hover:underline cursor-pointer"
                  >
                    <span>Manage</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>

                {workers.map((w) => (
                  <div
                    key={w.id}
                    className="p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-900 dark:text-white truncate">
                        {w.name}
                      </span>
                      <span
                        className={`font-mono text-[10.5px] font-bold uppercase ${
                          w.status === 'active'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : w.status === 'error'
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {w.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {w.currentTask || 'Idle'}
                    </div>
                    <div className="flex items-center justify-between text-[10.5px] font-mono tabular-nums text-slate-400">
                      <span>
                        CPU {w.cpuPercent}% · {w.memoryMb}MB
                      </span>
                      <span>
                        {w.successRate}% ok ({w.processedCount})
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Queue Throughput Health */}
              <div className="space-y-2 pt-2 border-t border-slate-200/70 dark:border-slate-800">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
                  <span>Task Queues ({jobs.length} jobs)</span>
                  <button
                    type="button"
                    onClick={() => onNavigateTab('task-queue')}
                    className="inline-flex items-center gap-0.5 text-[11px] text-[#4a70e8] dark:text-[#8aa4ff] hover:underline cursor-pointer"
                  >
                    <span>Queues</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>

                {queueBreakdown.map((q) => {
                  const denom = Math.max(1, q.total);
                  return (
                    <div
                      key={q.name}
                      className="p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {q.name}
                        </span>
                        <span className="tabular-nums text-[11px] text-slate-500">
                          {q.active} run · {q.failed} err
                        </span>
                      </div>
                      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          style={{ width: `${(q.completed / denom) * 100}%` }}
                          className="bg-emerald-500"
                        />
                        <div
                          style={{ width: `${(q.active / denom) * 100}%` }}
                          className="bg-[#4a70e8]"
                        />
                        <div
                          style={{ width: `${(q.waiting / denom) * 100}%` }}
                          className="bg-amber-400"
                        />
                        <div
                          style={{ width: `${(q.failed / denom) * 100}%` }}
                          className="bg-rose-500"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {rightTab === 'inspector' && selectedService && (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {selectedService.displayName}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                    {selectedService.provider} · {selectedService.category} ·{' '}
                    {selectedService.version}
                  </div>
                </div>
                <span
                  className={`text-[11px] font-mono font-bold uppercase shrink-0 ${
                    selectedService.status === 'healthy'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : selectedService.status === 'degraded'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {selectedService.rawStatus}
                </span>
              </div>

              {/* Dual-metric D3 live trace */}
              <div className="p-3 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="flex items-center justify-between text-[10.5px] font-mono text-slate-500 dark:text-slate-400 mb-1">
                  <span>Live Trace (Latency solid · CPU dashed)</span>
                  <span>{selectedService.history.length} pts</span>
                </div>
                <svg
                  ref={inspectorSvgRef}
                  className="w-full h-[112px] block text-slate-600 dark:text-slate-400"
                  role="img"
                  aria-label={`D3 live trace for ${selectedService.displayName}`}
                />
              </div>

              {/* Telemetry Specs */}
              <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
                <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                  <div className="text-[10px] font-sans text-slate-400 flex items-center gap-1">
                    <Gauge className="w-3 h-3" /> Latency (P95)
                  </div>
                  <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                    {selectedService.latencyMs}ms{' '}
                    <span className="font-normal text-slate-400">
                      ({selectedService.p95LatencyMs ?? selectedService.latencyMs}ms)
                    </span>
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                  <div className="text-[10px] font-sans text-slate-400 flex items-center gap-1">
                    <Cpu className="w-3 h-3" /> CPU / RAM
                  </div>
                  <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                    {selectedService.cpuPercent}% · {selectedService.memoryMb}MB
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                  <div className="text-[10px] font-sans text-slate-400 flex items-center gap-1">
                    <HardDrive className="w-3 h-3" /> Uptime
                  </div>
                  <div className="font-bold text-slate-900 dark:text-white mt-0.5 truncate">
                    {selectedService.uptime}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                  <div className="text-[10px] font-sans text-slate-400">Failures / Checked</div>
                  <div className="font-bold text-slate-900 dark:text-white mt-0.5 truncate">
                    {selectedService.errorCount} · {selectedService.checkedAt}
                  </div>
                </div>
              </div>

              {/* Endpoint & Evidence */}
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate px-1">
                Endpoint: {selectedService.endpoint}
              </div>

              {/* Recent Logs for Selected Service */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Recent Service Logs ({selectedService.logs.length})
                </div>
                <div className="space-y-1 max-h-[120px] overflow-y-auto">
                  {selectedService.logs.length === 0 ? (
                    <div className="text-[11px] text-slate-400 px-1">
                      {selectedService.evidenceSummary || 'No error logs reported on latest sweep.'}
                    </div>
                  ) : (
                    selectedService.logs.slice(0, 5).map((l) => (
                      <div
                        key={l.id}
                        className="p-2 rounded bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 text-[11px] font-mono"
                      >
                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                          <span className="uppercase font-bold">{l.level}</span>
                          <span>{l.timestamp}</span>
                        </div>
                        <div className="text-slate-700 dark:text-slate-300 mt-0.5 break-words">
                          {l.message}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Quick Navigation Actions */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onNavigateTab('health-monitor')}
                  className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  <span>Health Monitor</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateTab('mcp-tower')}
                  className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 px-2.5 rounded-lg bg-[#162238] dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold cursor-pointer"
                >
                  <span>MCP Tower</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
};
