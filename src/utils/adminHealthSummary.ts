/**
 * বাংলা মন্তব্য: অ্যাডমিন ওভারভিউয়ের "মস্তিষ্ক" — সব স্টোরের লাইভ ডেটা থেকে এক নজরে বোঝার মতো
 * সারাংশ বানায়: কোন এরিয়া সবুজ/হলুদ/লাল, কী সমস্যা, আর কোন ট্যাবে গিয়ে ঠিক করতে হবে।
 * কোনো নকল সংখ্যা নেই — ডেটা না এলে "unknown" দেখায়। সম্পূর্ণ pure ফাংশন, তাই টেস্টযোগ্য।
 */
import type {
  CustomerRecord,
  McpTowerService,
  ProviderKeyItem,
  SchemaParityTable,
  SecurityEventLog,
  SwarmWorker,
  TaskQueueJob,
} from '../types';
import type {
  EcosystemFinding,
  McpHealthMonitorSnapshot,
  McpServiceHealthMetric,
} from '../types/controlCenter';
import { findAdminSection, type AdminSectionId } from '../config/adminSections';

export type AdminSeverity = 'critical' | 'warning' | 'info';
export type AdminAreaStatus = 'ok' | 'warning' | 'critical' | 'unknown';
export type AdminAreaId =
  'users' | 'services' | 'ai' | 'agents' | 'security' | 'deploy' | 'settings';

export interface DeploymentStatus {
  id: string;
  provider: string;
  service: string;
  deployedAt: string | null;
  status: string;
  commit: string | null;
}

export interface AdminIssue {
  id: string;
  severity: AdminSeverity;
  area: AdminAreaId;
  title: string;
  detail: string;
  actionLabel: string;
  /** Tab that lets the admin fix it */
  targetTab: string;
}

export interface AdminAreaMetric {
  label: string;
  value: string;
  tone?: 'good' | 'bad' | 'warn' | 'muted';
}

export interface AdminAreaSummary {
  id: AdminAreaId;
  label: string;
  status: AdminAreaStatus;
  headline: string;
  metrics: AdminAreaMetric[];
  targetTab: string;
}

export interface AdminServiceRow {
  id: string;
  name: string;
  provider: string;
  status: 'ok' | 'warning' | 'critical' | 'unknown';
  statusLabel: string;
  latencyMs: number | null;
  detail: string;
  targetTab: string;
}

export interface AdminHealthSummary {
  overall: AdminAreaStatus;
  score: number;
  counts: { critical: number; warning: number; info: number };
  issues: AdminIssue[];
  areas: AdminAreaSummary[];
  services: AdminServiceRow[];
}

export interface AdminHealthInput {
  customers: CustomerRecord[];
  mcpServices: McpTowerService[];
  healthSnapshot: McpHealthMonitorSnapshot | null;
  ecosystemFindings?: EcosystemFinding[] | null;
  mcpReachable?: boolean | null;
  deployments: DeploymentStatus[] | null;
  /** null = could not load (unknown), [] = loaded but none configured */
  providers: ProviderKeyItem[] | null;
  jobs: TaskQueueJob[];
  workers: SwarmWorker[];
  securityEvents: SecurityEventLog[];
  pendingHitlCount: number;
  releaseGate?: string | null;
  schemaTables: SchemaParityTable[];
  maintenanceMode: boolean;
  allowNewSignups: boolean;
  domainErrors?: Array<{ domain: string; error: string }>;
  now?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVERITY_RANK: Record<AdminSeverity, number> = { critical: 0, warning: 1, info: 2 };

const FAILED_DEPLOY = new Set(['failure', 'failed', 'error', 'crashed', 'timed_out', 'canceled']);
const OK_DEPLOY = new Set(['success', 'live', 'active', 'deployed', 'completed']);
const PENDING_DEPLOY = new Set(['in_progress', 'queued', 'building', 'deploying', 'idle']);

const DOMAIN_TARGET: Record<string, { area: AdminAreaId; tab: string; label: string }> = {
  overview: { area: 'services', tab: 'health-monitor', label: 'Control-plane overview' },
  diagnostics: { area: 'services', tab: 'mcp-tower', label: 'MCP diagnostics' },
  mcpTools: { area: 'services', tab: 'mcp-tower', label: 'MCP tools registry' },
  serviceHealth: { area: 'services', tab: 'health-monitor', label: 'Service health monitor' },
  releaseGate: { area: 'deploy', tab: 'release-gate', label: 'Release gate' },
  hitl: { area: 'security', tab: 'hitl-policies', label: 'Approvals & policies' },
  bridge: { area: 'agents', tab: 'external-agents', label: 'External agents' },
};

function parseTime(value: string | undefined | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function worstStatus(statuses: AdminAreaStatus[]): AdminAreaStatus {
  if (statuses.includes('critical')) return 'critical';
  if (statuses.includes('warning')) return 'warning';
  if (statuses.length > 0 && statuses.every((s) => s === 'unknown')) return 'unknown';
  return 'ok';
}

function metricStatusToRow(status: McpServiceHealthMetric['status']): AdminServiceRow['status'] {
  if (status === 'healthy') return 'ok';
  if (status === 'degraded') return 'warning';
  return 'critical';
}

function towerStatusToRow(status: McpTowerService['status']): AdminServiceRow['status'] {
  if (status === 'healthy') return 'ok';
  if (status === 'degraded' || status === 'rebooting') return 'warning';
  return 'critical';
}

function deployStatusToRow(status: string): AdminServiceRow['status'] {
  const s = status.toLowerCase();
  if (OK_DEPLOY.has(s)) return 'ok';
  if (FAILED_DEPLOY.has(s) || s === 'unreachable') return 'critical';
  if (PENDING_DEPLOY.has(s)) return 'ok';
  return 'unknown';
}

function deployTargetTab(dep: DeploymentStatus): string {
  const provider = dep.provider.toLowerCase();
  if (provider.includes('github')) return 'github-pipeline';
  if (provider.includes('cloudflare')) return 'release-gate';
  return 'health-monitor';
}

export function buildAdminHealthSummary(input: AdminHealthInput): AdminHealthSummary {
  const now = input.now ?? Date.now();
  const issues: AdminIssue[] = [];
  const add = (issue: AdminIssue) => {
    if (!issues.some((i) => i.id === issue.id)) issues.push(issue);
  };

  // ---------------- Services & deployments ----------------
  const services: AdminServiceRow[] = [];
  const snapshotServices = input.healthSnapshot?.services ?? [];
  if (snapshotServices.length > 0) {
    for (const svc of snapshotServices) {
      services.push({
        id: `svc-${svc.id}`,
        name: svc.displayName || svc.name,
        provider: svc.provider || svc.category,
        status: metricStatusToRow(svc.status),
        statusLabel: svc.status,
        latencyMs: svc.latencyMs,
        detail: svc.rawStatus || svc.category,
        targetTab: 'health-monitor',
      });
    }
  } else {
    for (const svc of input.mcpServices) {
      services.push({
        id: `svc-${svc.id}`,
        name: svc.displayName || svc.name,
        provider: svc.category,
        status: towerStatusToRow(svc.status),
        statusLabel: svc.status,
        latencyMs: Number.isFinite(svc.latencyMs) ? svc.latencyMs : null,
        detail: svc.errorCount > 0 ? plural(svc.errorCount, 'error') : svc.endpoint,
        targetTab: 'mcp-tower',
      });
    }
  }
  for (const dep of input.deployments ?? []) {
    services.push({
      id: `dep-${dep.id}`,
      name: dep.service,
      provider: dep.provider,
      status: deployStatusToRow(dep.status),
      statusLabel: dep.status,
      latencyMs: null,
      detail: dep.commit ? `commit ${dep.commit}` : 'deployment',
      targetTab: deployTargetTab(dep),
    });
  }

  for (const row of services) {
    if (row.status === 'critical') {
      const isDeploy = row.id.startsWith('dep-');
      add({
        id: `issue-${row.id}`,
        severity: 'critical',
        area: isDeploy && row.targetTab !== 'health-monitor' ? 'deploy' : 'services',
        title: `${row.name} is ${row.statusLabel}`,
        detail: `${row.provider} reports "${row.statusLabel}". Users may be affected.`,
        actionLabel: isDeploy ? 'Open pipeline' : 'Inspect service',
        targetTab: row.targetTab,
      });
    } else if (row.status === 'warning') {
      add({
        id: `issue-${row.id}`,
        severity: 'warning',
        area: 'services',
        title: `${row.name} is ${row.statusLabel}`,
        detail: `${row.provider} is responding slowly or partially.`,
        actionLabel: 'Inspect service',
        targetTab: row.targetTab,
      });
    }
  }

  for (const dep of input.deployments ?? []) {
    if (dep.status.toLowerCase() === 'unconfigured') {
      add({
        id: `issue-dep-config-${dep.id}`,
        severity: 'warning',
        area: 'deploy',
        title: `${dep.provider} status is not connected`,
        detail: `The dashboard cannot read ${dep.service} deploys — add its API token in the hosting environment.`,
        actionLabel: 'Open release gate',
        targetTab: deployTargetTab(dep),
      });
    }
  }

  for (const alert of input.healthSnapshot?.alerts ?? []) {
    add({
      id: `issue-alert-${alert.id}`,
      severity: alert.severity === 'critical' ? 'critical' : 'warning',
      area: 'services',
      title: `${alert.displayName}: ${alert.metric} ${alert.valueLabel}`,
      detail: alert.message || `Threshold ${alert.thresholdLabel}`,
      actionLabel: 'Open health monitor',
      targetTab: 'health-monitor',
    });
  }

  if (input.mcpReachable === false) {
    add({
      id: 'issue-mcp-unreachable',
      severity: 'critical',
      area: 'services',
      title: 'MCP Tower is unreachable',
      detail: 'Automations and tools that depend on the tower will fail.',
      actionLabel: 'Open MCP Tower',
      targetTab: 'mcp-tower',
    });
  }
  for (const finding of input.ecosystemFindings ?? []) {
    if (finding.severity === 'healthy') continue;
    add({
      id: `issue-finding-${finding.id}`,
      severity: finding.severity === 'critical' ? 'critical' : 'warning',
      area: 'services',
      title: finding.title,
      detail: finding.recommendation || finding.detail,
      actionLabel: 'Open MCP Tower',
      targetTab: 'mcp-tower',
    });
  }

  // ---------------- AI providers ----------------
  const providers = input.providers;
  if (providers === null) {
    add({
      id: 'issue-providers-unknown',
      severity: 'warning',
      area: 'ai',
      title: 'Provider keys could not be loaded',
      detail: 'The admin API did not answer — key health is unknown.',
      actionLabel: 'Open provider keys',
      targetTab: 'provider-keys',
    });
  } else if (providers.length === 0) {
    add({
      id: 'issue-providers-none',
      severity: 'critical',
      area: 'ai',
      title: 'No AI provider key is configured',
      detail: 'Chat and code generation need at least one working provider key.',
      actionLabel: 'Add a key',
      targetTab: 'provider-keys',
    });
  } else {
    for (const p of providers) {
      if (p.status === 'unhealthy') {
        add({
          id: `issue-provider-${p.id}`,
          severity: 'critical',
          area: 'ai',
          title: `${p.displayName} key is failing`,
          detail: 'Requests fall back to other providers. Replace or re-test the key.',
          actionLabel: 'Fix key',
          targetTab: 'provider-keys',
        });
      } else if (p.status === 'degraded') {
        add({
          id: `issue-provider-${p.id}`,
          severity: 'warning',
          area: 'ai',
          title: `${p.displayName} is slow or rate-limited`,
          detail: `Last latency ${p.latencyMs} ms.`,
          actionLabel: 'Check key',
          targetTab: 'provider-keys',
        });
      }
    }
    if (providers.length > 0 && providers.every((p) => p.status === 'unhealthy')) {
      add({
        id: 'issue-providers-all-down',
        severity: 'critical',
        area: 'ai',
        title: 'All AI providers are failing',
        detail: 'Users cannot get AI answers right now.',
        actionLabel: 'Fix keys',
        targetTab: 'provider-keys',
      });
    }
  }

  // ---------------- Agents & queue ----------------
  const failedJobs = input.jobs.filter((j) => j.status === 'dlq' || j.status === 'failed');
  const waitingJobs = input.jobs.filter((j) => j.status === 'waiting').length;
  const activeWorkers = input.workers.filter((w) => w.status === 'active').length;
  const erroredWorkers = input.workers.filter((w) => w.status === 'error');
  if (failedJobs.length > 0) {
    add({
      id: 'issue-queue-failed',
      severity: failedJobs.length >= 10 ? 'critical' : 'warning',
      area: 'agents',
      title: `${plural(failedJobs.length, 'background job')} failed`,
      detail: failedJobs[0]?.errorDetails || 'Retry them or check the error details.',
      actionLabel: 'Open task queue',
      targetTab: 'task-queue',
    });
  }
  if (erroredWorkers.length > 0) {
    add({
      id: 'issue-workers-error',
      severity: 'warning',
      area: 'agents',
      title: `${plural(erroredWorkers.length, 'agent worker')} in error state`,
      detail: erroredWorkers.map((w) => w.name).join(', '),
      actionLabel: 'Open agent workers',
      targetTab: 'agent-swarm',
    });
  }
  if (waitingJobs > 0 && input.workers.length > 0 && activeWorkers === 0) {
    add({
      id: 'issue-workers-none-active',
      severity: 'warning',
      area: 'agents',
      title: `${plural(waitingJobs, 'job')} waiting with no active worker`,
      detail: 'Resume at least one agent worker so the queue keeps moving.',
      actionLabel: 'Open agent workers',
      targetTab: 'agent-swarm',
    });
  }

  // ---------------- Security ----------------
  const recentThreats = input.securityEvents.filter((e) => {
    const t = parseTime(e.timestamp);
    return (
      (e.severity === 'critical' || e.severity === 'high') &&
      !e.blocked &&
      (t === null || now - t <= DAY_MS)
    );
  });
  if (recentThreats.length > 0) {
    add({
      id: 'issue-security-threats',
      severity: 'critical',
      area: 'security',
      title: `${plural(recentThreats.length, 'unblocked high-risk event')} in 24h`,
      detail: recentThreats[0]?.description || 'Review and block the source.',
      actionLabel: 'Review threats',
      targetTab: 'security',
    });
  }
  if (input.pendingHitlCount > 0) {
    add({
      id: 'issue-hitl-pending',
      severity: 'warning',
      area: 'security',
      title: `${plural(input.pendingHitlCount, 'action')} waiting for your approval`,
      detail: 'Automations are paused until an admin approves or rejects them.',
      actionLabel: 'Review approvals',
      targetTab: 'hitl-policies',
    });
  }

  // ---------------- Deploy & CI ----------------
  const gate = (input.releaseGate || '').toUpperCase();
  if (gate === 'NO_GO' || gate === 'NO-GO' || gate === 'BLOCKED') {
    add({
      id: 'issue-release-gate',
      severity: 'critical',
      area: 'deploy',
      title: 'Release gate is blocked',
      detail: 'The last diagnose found a failing layer — new releases should wait.',
      actionLabel: 'Open release gate',
      targetTab: 'release-gate',
    });
  } else if (gate === 'DEGRADED') {
    add({
      id: 'issue-release-gate',
      severity: 'warning',
      area: 'deploy',
      title: 'Release gate is degraded',
      detail: 'Some checks are not fully green.',
      actionLabel: 'Open release gate',
      targetTab: 'release-gate',
    });
  }
  const drifted = input.schemaTables.filter((t) => t.driftDetected);
  if (drifted.length > 0) {
    add({
      id: 'issue-schema-drift',
      severity: 'warning',
      area: 'deploy',
      title: `${plural(drifted.length, 'database table')} out of sync`,
      detail: drifted
        .slice(0, 3)
        .map((t) => t.tableName)
        .join(', '),
      actionLabel: 'Open schema',
      targetTab: 'schema-parity',
    });
  }
  const noRls = input.schemaTables.filter((t) => !t.rlsEnabled);
  if (noRls.length > 0) {
    add({
      id: 'issue-schema-rls',
      severity: 'warning',
      area: 'security',
      title: `${plural(noRls.length, 'table')} without row-level security`,
      detail: noRls
        .slice(0, 3)
        .map((t) => t.tableName)
        .join(', '),
      actionLabel: 'Open schema',
      targetTab: 'schema-parity',
    });
  }

  // ---------------- Users ----------------
  const pastDue = input.customers.filter((c) => c.status === 'past_due');
  const nearLimit = input.customers.filter(
    (c) => c.tokenLimit > 0 && c.tokensUsed / c.tokenLimit >= 0.9
  );
  if (pastDue.length > 0) {
    add({
      id: 'issue-users-past-due',
      severity: 'warning',
      area: 'users',
      title: `${plural(pastDue.length, 'customer')} with overdue payment`,
      detail: pastDue
        .slice(0, 3)
        .map((c) => c.email)
        .join(', '),
      actionLabel: 'Open users',
      targetTab: 'customers',
    });
  }
  if (nearLimit.length > 0) {
    add({
      id: 'issue-users-near-limit',
      severity: 'info',
      area: 'users',
      title: `${plural(nearLimit.length, 'user')} near the token limit`,
      detail: 'They will be blocked soon — consider an upgrade or a higher limit.',
      actionLabel: 'Open users',
      targetTab: 'customers',
    });
  }

  // ---------------- Settings ----------------
  if (input.maintenanceMode) {
    add({
      id: 'issue-maintenance',
      severity: 'warning',
      area: 'settings',
      title: 'Maintenance lock is ON',
      detail: 'Customers cannot use chat or workspaces until you turn it off.',
      actionLabel: 'Open settings',
      targetTab: 'platform-settings',
    });
  }
  if (!input.allowNewSignups) {
    add({
      id: 'issue-signups-paused',
      severity: 'info',
      area: 'settings',
      title: 'New signups are paused',
      detail: 'New users cannot create accounts.',
      actionLabel: 'Open settings',
      targetTab: 'platform-settings',
    });
  }

  // ---------------- Data freshness (honest unknowns) ----------------
  for (const err of input.domainErrors ?? []) {
    const target = DOMAIN_TARGET[err.domain];
    if (!target) continue;
    add({
      id: `issue-domain-${err.domain}`,
      severity: 'warning',
      area: target.area,
      title: `${target.label}: live data unavailable`,
      detail: err.error,
      actionLabel: 'Open',
      targetTab: target.tab,
    });
  }

  issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  // ---------------- Area tiles ----------------
  const areaStatus = (area: AdminAreaId, hasData: boolean): AdminAreaStatus => {
    const own = issues.filter((i) => i.area === area);
    if (own.some((i) => i.severity === 'critical')) return 'critical';
    if (own.some((i) => i.severity === 'warning')) return 'warning';
    return hasData ? 'ok' : 'unknown';
  };
  const areaHeadline = (area: AdminAreaId, okText: string, unknownText: string): string => {
    const own = issues.filter((i) => i.area === area && i.severity !== 'info');
    if (own.length === 0) return areaStatus(area, true) === 'ok' ? okText : unknownText;
    return own.length === 1 ? own[0].title : `${own.length} problems need attention`;
  };

  const okServices = services.filter((s) => s.status === 'ok').length;
  const badServices = services.filter((s) => s.status === 'critical').length;
  const latencies = services
    .map((s) => s.latencyMs)
    .filter((v): v is number => v !== null && v > 0);
  const avgLatency =
    latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null;

  const activeCustomers = input.customers.filter((c) => c.status === 'active').length;
  const newThisWeek = input.customers.filter((c) => {
    const t = parseTime(c.joinedDate);
    return t !== null && now - t <= 7 * DAY_MS;
  }).length;
  const mrr = input.customers.reduce((sum, c) => sum + (c.mrr || 0), 0);

  const healthyProviders = (providers ?? []).filter((p) => p.status === 'healthy').length;
  const threats24h = input.securityEvents.filter((e) => {
    const t = parseTime(e.timestamp);
    return t === null || now - t <= DAY_MS;
  }).length;
  const blockedCount = input.securityEvents.filter((e) => e.blocked).length;

  const areas: AdminAreaSummary[] = [
    {
      id: 'users',
      label: 'Users',
      status: areaStatus('users', input.customers.length > 0),
      headline: areaHeadline(
        'users',
        `${plural(input.customers.length, 'account')}, all in good standing`,
        'No customer data yet'
      ),
      metrics: [
        { label: 'Total', value: String(input.customers.length) },
        { label: 'Active', value: String(activeCustomers), tone: 'good' },
        { label: 'New (7d)', value: String(newThisWeek) },
        { label: 'MRR', value: `$${mrr.toLocaleString()}` },
      ],
      targetTab: 'customers',
    },
    {
      id: 'services',
      label: 'Services & Health',
      status: areaStatus('services', services.length > 0),
      headline: areaHeadline(
        'services',
        `All ${plural(services.length, 'service')} running`,
        'Waiting for the first health check'
      ),
      metrics: [
        { label: 'Healthy', value: `${okServices}/${services.length}`, tone: 'good' },
        { label: 'Down', value: String(badServices), tone: badServices > 0 ? 'bad' : 'muted' },
        { label: 'Avg latency', value: avgLatency !== null ? `${avgLatency} ms` : '—' },
      ],
      targetTab: 'health-monitor',
    },
    {
      id: 'ai',
      label: 'AI & Providers',
      status: areaStatus('ai', providers !== null),
      headline: areaHeadline(
        'ai',
        `${plural(healthyProviders, 'provider')} healthy`,
        'Provider health unknown'
      ),
      metrics: [
        { label: 'Keys', value: providers === null ? '—' : String(providers.length) },
        {
          label: 'Healthy',
          value: providers === null ? '—' : String(healthyProviders),
          tone: 'good',
        },
        {
          label: 'Failing',
          value:
            providers === null
              ? '—'
              : String(providers.filter((p) => p.status === 'unhealthy').length),
          tone: (providers ?? []).some((p) => p.status === 'unhealthy') ? 'bad' : 'muted',
        },
      ],
      targetTab: 'provider-keys',
    },
    {
      id: 'agents',
      label: 'Agents & Queue',
      status: areaStatus('agents', input.jobs.length > 0 || input.workers.length > 0),
      headline: areaHeadline('agents', 'Queue is flowing normally', 'No queue activity yet'),
      metrics: [
        { label: 'Waiting', value: String(waitingJobs) },
        {
          label: 'Failed',
          value: String(failedJobs.length),
          tone: failedJobs.length > 0 ? 'bad' : 'muted',
        },
        { label: 'Workers on', value: `${activeWorkers}/${input.workers.length}` },
      ],
      targetTab: 'task-queue',
    },
    {
      id: 'security',
      label: 'Security & Audit',
      status: areaStatus('security', true),
      headline: areaHeadline('security', 'No open threats', 'No security data yet'),
      metrics: [
        { label: 'Events (24h)', value: String(threats24h) },
        { label: 'Blocked', value: String(blockedCount), tone: 'good' },
        {
          label: 'Approvals',
          value: String(input.pendingHitlCount),
          tone: input.pendingHitlCount > 0 ? 'warn' : 'muted',
        },
      ],
      targetTab: 'security',
    },
    {
      id: 'deploy',
      label: 'Deploy & CI',
      status: areaStatus('deploy', (input.deployments ?? []).length > 0 || Boolean(gate)),
      headline: areaHeadline('deploy', 'Latest builds and deploys are green', 'No deploy data yet'),
      metrics: [
        { label: 'Release gate', value: gate || '—', tone: gate === 'GO' ? 'good' : 'muted' },
        {
          label: 'Schema drift',
          value: String(drifted.length),
          tone: drifted.length > 0 ? 'warn' : 'muted',
        },
      ],
      targetTab: 'github-pipeline',
    },
    {
      id: 'settings',
      label: 'Platform Settings',
      status: areaStatus('settings', true),
      headline: areaHeadline('settings', 'Platform open for everyone', 'Settings not loaded'),
      metrics: [
        {
          label: 'Maintenance',
          value: input.maintenanceMode ? 'ON' : 'Off',
          tone: input.maintenanceMode ? 'warn' : 'muted',
        },
        {
          label: 'Signups',
          value: input.allowNewSignups ? 'Open' : 'Paused',
          tone: input.allowNewSignups ? 'good' : 'warn',
        },
      ],
      targetTab: 'platform-settings',
    },
  ];

  const counts = {
    critical: issues.filter((i) => i.severity === 'critical').length,
    warning: issues.filter((i) => i.severity === 'warning').length,
    info: issues.filter((i) => i.severity === 'info').length,
  };
  const score = Math.max(0, Math.min(100, 100 - counts.critical * 15 - counts.warning * 5));

  return {
    overall: worstStatus(areas.map((a) => a.status)),
    score,
    counts,
    issues,
    areas,
    services,
  };
}

/** Counts non-info issues per navigation section so the sidebar can turn red/amber. */
export function countIssuesBySection(
  issues: AdminIssue[]
): Partial<Record<AdminSectionId, { critical: number; warning: number }>> {
  const out: Partial<Record<AdminSectionId, { critical: number; warning: number }>> = {};
  for (const issue of issues) {
    if (issue.severity === 'info') continue;
    const section = findAdminSection(issue.targetTab);
    if (!section) continue;
    const entry = (out[section.id] ??= { critical: 0, warning: 0 });
    entry[issue.severity] += 1;
  }
  return out;
}
