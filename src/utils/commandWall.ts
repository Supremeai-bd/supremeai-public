/**
 * বাংলা মন্তব্য: Command Wall (অ্যাডমিন Step 7) — Mission Control-এর ড্রিল-ডাউন মডেল।
 *
 *   L0 পুরো প্ল্যাটফর্ম (ব্যানার + স্কোর)   → আগে থেকেই আছে
 *   L1 এরিয়া টাইল (Services, AI, Agents…)   → ক্লিক করলে পেজ না বদলে নিচে L2 খোলে
 *   L2 ওই এরিয়ার নোড (সার্ভিস, কী, ডিপ্লয়, ওয়ার্কার…) — আসল স্টোর ডেটা থেকে
 *   L3 একটা নোডের বিস্তারিত (ল্যাটেন্সি গ্রাফ, ত্রুটি, অ্যালার্ট, সম্পর্কিত সমস্যা ও লগ)
 *
 * পুরনো InteractiveMeshGraph-এর মতো হাতে-লেখা নকল ডেটা নেই — সবই লাইভ স্টোর থেকে।
 * এই ফাইল খাঁটি (pure); UI `AdminCommandWall.tsx`-এ।
 */

import type {
  AdminAreaId,
  AdminAreaStatus,
  AdminConnectionStatus,
  AdminIssue,
  AdminServiceRow,
  DeploymentStatus,
} from './adminHealthSummary';
import { CONNECTION_AREA } from './adminHealthSummary';
import type { McpHealthMonitorSnapshot, McpServiceHealthMetric } from '../types/controlCenter';
import type {
  CustomerRecord,
  ProviderKeyItem,
  SchemaParityTable,
  SecurityEventLog,
  SwarmWorker,
  TaskQueueJob,
} from '../types';

export type WallNodeKind =
  | 'service'
  | 'connection'
  | 'provider'
  | 'worker'
  | 'queue'
  | 'security'
  | 'approvals'
  | 'deployment'
  | 'schema'
  | 'customers'
  | 'setting';

export interface WallNode {
  /** `<kind>:<source id>` — stable across refreshes. */
  id: string;
  kind: WallNodeKind;
  label: string;
  sublabel: string;
  status: AdminAreaStatus;
  /** Short headline number, e.g. "142 ms" or "3 failed". */
  metric?: string;
  targetTab: string;
}

export interface WallInput {
  services: AdminServiceRow[];
  healthSnapshot: McpHealthMonitorSnapshot | null;
  connections: AdminConnectionStatus[] | null;
  providers: ProviderKeyItem[] | null;
  workers: SwarmWorker[];
  jobs: TaskQueueJob[];
  securityEvents: SecurityEventLog[];
  pendingHitlCount: number;
  deployments: DeploymentStatus[] | null;
  schemaTables: SchemaParityTable[];
  customers: CustomerRecord[];
  maintenanceMode: boolean;
  allowNewSignups: boolean;
  issues: AdminIssue[];
  now?: number;
}

const STATUS_RANK: Record<AdminAreaStatus, number> = { critical: 0, warning: 1, unknown: 2, ok: 3 };
const FAILED_DEPLOY = new Set(['failure', 'failed', 'error', 'crashed', 'timed_out', 'canceled']);
const OK_DEPLOY = new Set(['success', 'live', 'active', 'deployed', 'completed']);
const DAY_MS = 86_400_000;

function providerStatus(s: ProviderKeyItem['status']): AdminAreaStatus {
  if (s === 'healthy') return 'ok';
  if (s === 'degraded') return 'warning';
  if (s === 'unhealthy') return 'critical';
  return 'unknown';
}

function workerStatus(s: SwarmWorker['status']): AdminAreaStatus {
  if (s === 'error') return 'critical';
  if (s === 'paused') return 'warning';
  return 'ok';
}

function deployStatus(s: string): AdminAreaStatus {
  const v = s.toLowerCase();
  if (FAILED_DEPLOY.has(v)) return 'critical';
  if (OK_DEPLOY.has(v)) return 'ok';
  return 'warning';
}

function connectionNodes(area: AdminAreaId, input: WallInput): WallNode[] {
  return (input.connections ?? [])
    .filter((c) => CONNECTION_AREA[c.id] === area)
    .map((c) => ({
      id: `connection:${c.id}`,
      kind: 'connection' as const,
      label: c.name,
      sublabel: c.detail,
      status: c.status === 'connected' ? 'ok' : c.status === 'missing' ? 'warning' : 'critical',
      metric: c.status === 'connected' ? 'connected' : c.status,
      targetTab: c.targetTab,
    }));
}

function sortNodes(nodes: WallNode[]): WallNode[] {
  return [...nodes].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.label.localeCompare(b.label)
  );
}

/** L2: every node that belongs to an area, worst status first. */
export function buildWallNodes(area: AdminAreaId, input: WallInput): WallNode[] {
  const now = input.now ?? Date.now();
  const nodes: WallNode[] = [];

  if (area === 'services') {
    for (const s of input.services) {
      nodes.push({
        id: `service:${s.id}`,
        kind: 'service',
        label: s.name,
        sublabel: `${s.provider} · ${s.detail}`,
        status: s.status,
        metric: s.latencyMs !== null ? `${s.latencyMs} ms` : s.statusLabel,
        targetTab: s.targetTab,
      });
    }
  }

  if (area === 'ai') {
    for (const p of input.providers ?? []) {
      nodes.push({
        id: `provider:${p.id}`,
        kind: 'provider',
        label: p.displayName || String(p.provider),
        sublabel: `${p.provider} · ${p.maskedKey}`,
        status: providerStatus(p.status),
        metric: p.latencyMs > 0 ? `${p.latencyMs} ms` : p.status,
        targetTab: 'provider-keys',
      });
    }
  }

  if (area === 'agents') {
    const failed = input.jobs.filter((j) => j.status === 'failed' || j.status === 'dlq').length;
    const waiting = input.jobs.filter((j) => j.status === 'waiting').length;
    nodes.push({
      id: 'queue:all',
      kind: 'queue',
      label: 'Task queue',
      sublabel: `${waiting} waiting · ${input.jobs.length} total`,
      status: failed > 0 ? 'warning' : 'ok',
      metric: `${failed} failed`,
      targetTab: 'task-queue',
    });
    for (const w of input.workers) {
      nodes.push({
        id: `worker:${w.id}`,
        kind: 'worker',
        label: w.name,
        sublabel: w.currentTask || w.type,
        status: workerStatus(w.status),
        metric: w.status,
        targetTab: 'agent-swarm',
      });
    }
  }

  if (area === 'security') {
    const recent = input.securityEvents.filter((e) => now - Date.parse(e.timestamp) < DAY_MS);
    const severe = recent.filter(
      (e) => (e.severity === 'critical' || e.severity === 'high') && !e.blocked
    );
    nodes.push({
      id: 'security:firewall',
      kind: 'security',
      label: 'Threats & firewall',
      sublabel: `${recent.filter((e) => e.blocked).length} blocked in 24h`,
      status: severe.length > 0 ? 'critical' : recent.length > 0 ? 'warning' : 'ok',
      metric: `${recent.length} events`,
      targetTab: 'security',
    });
    nodes.push({
      id: 'approvals:hitl',
      kind: 'approvals',
      label: 'Pending approvals',
      sublabel: 'Human-in-the-loop gates',
      status: input.pendingHitlCount > 0 ? 'warning' : 'ok',
      metric: String(input.pendingHitlCount),
      targetTab: 'hitl-policies',
    });
  }

  if (area === 'deploy') {
    for (const d of input.deployments ?? []) {
      nodes.push({
        id: `deployment:${d.id}`,
        kind: 'deployment',
        label: d.service,
        sublabel: `${d.provider}${d.commit ? ` · ${d.commit.slice(0, 7)}` : ''}`,
        status: deployStatus(d.status),
        metric: d.status,
        targetTab: 'github-pipeline',
      });
    }
    const drift = input.schemaTables.filter((t) => t.driftDetected).length;
    nodes.push({
      id: 'schema:all',
      kind: 'schema',
      label: 'Database schema',
      sublabel: `${input.schemaTables.length} tables tracked`,
      status: input.schemaTables.length === 0 ? 'unknown' : drift > 0 ? 'warning' : 'ok',
      metric: `${drift} drift`,
      targetTab: 'schema-parity',
    });
  }

  if (area === 'users') {
    const active = input.customers.filter((c) => c.status === 'active').length;
    nodes.push({
      id: 'customers:all',
      kind: 'customers',
      label: 'Customers',
      sublabel: `${active} active`,
      status: 'ok',
      metric: String(input.customers.length),
      targetTab: 'customers',
    });
  }

  if (area === 'settings') {
    nodes.push(
      {
        id: 'setting:maintenance',
        kind: 'setting',
        label: 'Maintenance lock',
        sublabel: input.maintenanceMode ? 'Users are locked out' : 'Open to users',
        status: input.maintenanceMode ? 'warning' : 'ok',
        metric: input.maintenanceMode ? 'ON' : 'off',
        targetTab: 'platform-settings',
      },
      {
        id: 'setting:signups',
        kind: 'setting',
        label: 'New signups',
        sublabel: input.allowNewSignups ? 'Anyone can sign up' : 'Signups are closed',
        status: 'ok',
        metric: input.allowNewSignups ? 'open' : 'closed',
        targetTab: 'platform-settings',
      }
    );
  }

  nodes.push(...connectionNodes(area, input));
  return sortNodes(nodes);
}

// ── L3 ────────────────────────────────────────────────────────────────────────

export interface WallField {
  label: string;
  value: string;
  tone?: 'good' | 'bad' | 'warn';
}

export type WallNodeAction = 'recheck-services' | 'test-provider' | 'retry-failed-jobs';

export interface WallNodeDetail {
  node: WallNode;
  fields: WallField[];
  /** Latency (ms) over time, oldest → newest, for the sparkline. */
  latencySeries: number[];
  /** Plain-language problems found on this node (errors, alerts, failing jobs). */
  problems: string[];
  /** Recent log lines for this node, newest first. */
  logs: string[];
  relatedIssues: AdminIssue[];
  action?: WallNodeAction;
}

const fmt = (n: number | null | undefined, unit = '') =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : `${Math.round(n)}${unit}`;

/** Snapshot metric for a `service:svc-<id>` node (also tolerates bare ids). */
export function findServiceMetric(
  node: WallNode,
  snapshot: McpHealthMonitorSnapshot | null
): McpServiceHealthMetric | null {
  if (node.kind !== 'service' || !snapshot) return null;
  const raw = node.id.slice('service:'.length).replace(/^svc-/, '');
  return snapshot.services.find((s) => s.id === raw) ?? null;
}

function relatedIssues(node: WallNode, issues: AdminIssue[]): AdminIssue[] {
  const needle = node.label.toLowerCase();
  return issues.filter(
    (i) =>
      i.severity !== 'info' &&
      (i.title.toLowerCase().includes(needle) || i.detail.toLowerCase().includes(needle))
  );
}

export function describeWallNode(
  node: WallNode,
  input: WallInput,
  freshSnapshot?: McpHealthMonitorSnapshot | null
): WallNodeDetail {
  const detail: WallNodeDetail = {
    node,
    fields: [],
    latencySeries: [],
    problems: [],
    logs: [],
    relatedIssues: relatedIssues(node, input.issues),
  };
  const sourceId = node.id.slice(node.id.indexOf(':') + 1);

  if (node.kind === 'service') {
    const m = findServiceMetric(node, freshSnapshot ?? input.healthSnapshot);
    detail.action = 'recheck-services';
    if (m) {
      detail.fields.push(
        { label: 'Status', value: m.status, tone: m.status === 'healthy' ? 'good' : 'bad' },
        { label: 'Latency', value: fmt(m.latencyMs, ' ms') },
        { label: 'p50 / p95', value: `${fmt(m.p50LatencyMs)} / ${fmt(m.p95LatencyMs, ' ms')}` },
        { label: 'CPU', value: fmt(m.cpuPercent, '%') },
        { label: 'Memory', value: m.memoryMb !== null ? fmt(m.memoryMb, ' MB') : '—' },
        {
          label: 'Failures in a row',
          value: String(m.consecutiveFailures),
          tone: m.consecutiveFailures > 0 ? 'bad' : undefined,
        },
        { label: 'Provider', value: m.provider || m.category },
        { label: 'Checked', value: m.checkedAt || '—' }
      );
      detail.latencySeries = m.history
        .map((p) => p.latencyMs)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      if (m.errorMessage) detail.problems.push(m.errorMessage);
      for (const a of (freshSnapshot ?? input.healthSnapshot)?.alerts ?? []) {
        if (a.serviceId === m.id)
          detail.problems.push(`${a.message} (${a.valueLabel} > ${a.thresholdLabel})`);
      }
      if (m.evidenceSummary) detail.logs.push(m.evidenceSummary);
    } else {
      detail.fields.push({ label: 'Status', value: node.metric || node.status });
    }
  }

  if (node.kind === 'provider') {
    const p = (input.providers ?? []).find((x) => x.id === sourceId);
    detail.action = 'test-provider';
    if (p) {
      detail.fields.push(
        {
          label: 'Status',
          value: p.status,
          tone: p.status === 'healthy' ? 'good' : p.status === 'untested' ? undefined : 'bad',
        },
        { label: 'Key', value: p.maskedKey },
        { label: 'Latency', value: fmt(p.latencyMs, ' ms') },
        { label: 'avg / p95', value: `${fmt(p.avgLatencyMs)} / ${fmt(p.p95LatencyMs, ' ms')}` },
        { label: 'Priority', value: String(p.priority) },
        { label: 'Rate limit', value: p.rateLimitTpm || '—' },
        { label: 'Last checked', value: p.lastChecked || '—' }
      );
      if (p.status === 'unhealthy') detail.problems.push('The last test of this key failed.');
    }
  }

  if (node.kind === 'worker') {
    const w = input.workers.find((x) => x.id === sourceId);
    if (w) {
      detail.fields.push(
        { label: 'Status', value: w.status, tone: w.status === 'error' ? 'bad' : 'good' },
        { label: 'Task', value: w.currentTask || '—' },
        { label: 'Processed', value: String(w.processedCount) },
        { label: 'Success rate', value: `${Math.round(w.successRate)}%` },
        { label: 'CPU / Memory', value: `${fmt(w.cpuPercent, '%')} / ${fmt(w.memoryMb, ' MB')}` },
        { label: 'Uptime', value: w.uptime || '—' }
      );
      detail.logs = [...(w.logs ?? [])].slice(-8).reverse();
    }
  }

  if (node.kind === 'queue') {
    const failed = input.jobs.filter((j) => j.status === 'failed' || j.status === 'dlq');
    const count = (s: TaskQueueJob['status']) =>
      String(input.jobs.filter((j) => j.status === s).length);
    detail.fields.push(
      { label: 'Active', value: count('active') },
      { label: 'Waiting', value: count('waiting') },
      { label: 'Failed', value: String(failed.length), tone: failed.length ? 'bad' : undefined },
      { label: 'Completed', value: count('completed') }
    );
    detail.problems = failed
      .slice(0, 6)
      .map((j) => `${j.taskType}: ${j.errorDetails || 'failed'} (${j.attempts}/${j.maxAttempts})`);
    if (failed.length) detail.action = 'retry-failed-jobs';
  }

  if (node.kind === 'deployment') {
    const d = (input.deployments ?? []).find((x) => x.id === sourceId);
    if (d) {
      detail.fields.push(
        {
          label: 'Status',
          value: d.status,
          tone: deployStatus(d.status) === 'critical' ? 'bad' : 'good',
        },
        { label: 'Provider', value: d.provider },
        { label: 'Commit', value: d.commit ? d.commit.slice(0, 12) : '—' },
        { label: 'Deployed', value: d.deployedAt || '—' }
      );
      if (deployStatus(d.status) === 'critical') detail.problems.push(`Last deploy ${d.status}.`);
    }
  }

  if (node.kind === 'connection') {
    const c = (input.connections ?? []).find((x) => x.id === sourceId);
    if (c) {
      detail.fields.push(
        { label: 'Status', value: c.status, tone: c.status === 'connected' ? 'good' : 'bad' },
        { label: 'Detail', value: c.detail || '—' }
      );
      if (c.missingEnv.length) detail.problems.push(`Missing settings: ${c.missingEnv.join(', ')}`);
    }
  }

  if (node.kind === 'security') {
    const events = [...input.securityEvents]
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, 8);
    detail.logs = events.map(
      (e) =>
        `${e.blocked ? 'BLOCKED' : e.severity.toUpperCase()} · ${e.category} · ${e.sourceIp} — ${e.description}`
    );
    detail.fields.push({ label: '24h', value: node.sublabel });
  }

  if (node.kind === 'schema') {
    const drift = input.schemaTables.filter((t) => t.driftDetected);
    detail.fields.push(
      { label: 'Tables', value: String(input.schemaTables.length) },
      { label: 'Drifted', value: String(drift.length), tone: drift.length ? 'warn' : 'good' },
      { label: 'RLS off', value: String(input.schemaTables.filter((t) => !t.rlsEnabled).length) }
    );
    detail.problems = drift
      .slice(0, 6)
      .map((t) => `${t.tableName}: ${t.driftSummary || 'columns differ'}`);
  }

  if (node.kind === 'approvals' || node.kind === 'customers' || node.kind === 'setting') {
    detail.fields.push(
      { label: node.label, value: node.metric || '—' },
      { label: 'Now', value: node.sublabel }
    );
  }

  return detail;
}

/** SVG polyline points for a sparkline (0,0 top-left). */
export function sparklinePoints(values: number[], width = 240, height = 48): string {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  return values
    .map(
      (v, i) =>
        `${(i * step).toFixed(1)},${(height - ((v - min) / span) * (height - 4) - 2).toFixed(1)}`
    )
    .join(' ');
}
