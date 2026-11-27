/**
 * বাংলা মন্তব্য: বিভিন্ন প্রোভাইডার/সার্ভিসের লগ (MCP সার্ভিস লগ, হেলথ অ্যালার্ট, ডিপ্লয়, প্রোভাইডার
 * কী-র প্রোব, সিকিউরিটি ইভেন্ট, অডিট ট্রেইল, এজেন্ট লগ) এক টাইমলাইনে আনে — অ্যাডমিন এক জায়গায়
 * ফিল্টার করে দেখতে পারে, আর প্রতিটা লাইন থেকে সংশ্লিষ্ট ট্যাবে যেতে পারে।
 */
import type {
  McpTowerService,
  ProviderKeyItem,
  SecurityEventLog,
  SwarmWorker,
  SystemAuditRecord,
} from '../types';
import type { ProactiveHealthAlert } from '../types/controlCenter';
import type { DeploymentStatus } from './adminHealthSummary';

export type AdminLogLevel = 'error' | 'warn' | 'info';

export type AdminLogSource =
  'service' | 'alert' | 'deploy' | 'provider' | 'security' | 'audit' | 'agent';

export interface AdminLogEntry {
  id: string;
  /** epoch ms; 0 when the source had no timestamp */
  ts: number;
  level: AdminLogLevel;
  source: AdminLogSource;
  /** Provider / service name used by the "provider" filter */
  provider: string;
  message: string;
  details?: string;
  targetTab: string;
}

export interface AdminLogInput {
  mcpServices: McpTowerService[];
  alerts: ProactiveHealthAlert[];
  deployments: DeploymentStatus[] | null;
  providers: ProviderKeyItem[] | null;
  securityEvents: SecurityEventLog[];
  auditRecords: SystemAuditRecord[];
  workers: SwarmWorker[];
}

const toTs = (value: string | null | undefined): number => {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
};

const DEPLOY_ERROR = /fail|error|crash|unreachable|timed_out|cancel/i;
const DEPLOY_WARN = /unknown|unconfigured|idle|queued|progress/i;

export function buildUnifiedAdminLogs(input: AdminLogInput): AdminLogEntry[] {
  const out: AdminLogEntry[] = [];

  for (const svc of input.mcpServices) {
    for (const log of svc.logs ?? []) {
      out.push({
        id: `svc-${svc.id}-${log.id}`,
        ts: toTs(log.timestamp),
        level: log.level === 'ERROR' ? 'error' : log.level === 'WARN' ? 'warn' : 'info',
        source: 'service',
        provider: svc.displayName || svc.name,
        message: log.message,
        details: log.stackTrace || log.details,
        targetTab: 'mcp-tower',
      });
    }
  }

  for (const alert of input.alerts) {
    out.push({
      id: `alert-${alert.id}`,
      ts: toTs(alert.detectedAt),
      level: alert.severity === 'critical' ? 'error' : 'warn',
      source: 'alert',
      provider: alert.displayName,
      message:
        alert.message || `${alert.metric} ${alert.valueLabel} (limit ${alert.thresholdLabel})`,
      targetTab: 'health-monitor',
    });
  }

  for (const dep of input.deployments ?? []) {
    out.push({
      id: `deploy-${dep.id}`,
      ts: toTs(dep.deployedAt),
      level: DEPLOY_ERROR.test(dep.status)
        ? 'error'
        : DEPLOY_WARN.test(dep.status)
          ? 'warn'
          : 'info',
      source: 'deploy',
      provider: dep.provider,
      message: `${dep.service}: ${dep.status}`,
      details: dep.commit ? `commit ${dep.commit}` : undefined,
      targetTab: dep.provider.toLowerCase().includes('github') ? 'github-pipeline' : 'release-gate',
    });
  }

  for (const p of input.providers ?? []) {
    out.push({
      id: `provider-${p.id}`,
      ts: toTs(p.lastChecked),
      level: p.status === 'unhealthy' ? 'error' : p.status === 'degraded' ? 'warn' : 'info',
      source: 'provider',
      provider: p.displayName,
      message: `Key probe: ${p.status}${p.latencyMs ? ` · ${p.latencyMs} ms` : ''}`,
      details: `${p.maskedKey} · priority ${p.priority}${p.region ? ` · ${p.region}` : ''}`,
      targetTab: 'provider-keys',
    });
  }

  for (const ev of input.securityEvents) {
    out.push({
      id: `sec-${ev.id}`,
      ts: toTs(ev.timestamp),
      level:
        ev.severity === 'critical' || ev.severity === 'high'
          ? 'error'
          : ev.severity === 'medium'
            ? 'warn'
            : 'info',
      source: 'security',
      provider: 'Security',
      message: `${ev.description}${ev.blocked ? ' (blocked)' : ''}`,
      details: `${ev.category} · ${ev.sourceIp}${ev.customerEmail ? ` · ${ev.customerEmail}` : ''}`,
      targetTab: 'security',
    });
  }

  for (const rec of input.auditRecords) {
    out.push({
      id: `audit-${rec.id}`,
      ts: toTs(rec.timestamp),
      level: 'info',
      source: 'audit',
      provider: 'Audit',
      message: `${rec.actor} · ${rec.action} · ${rec.resource}`,
      details: rec.details,
      targetTab: 'system-audit',
    });
  }

  for (const w of input.workers) {
    (w.logs ?? []).slice(-20).forEach((line, idx) => {
      out.push({
        id: `agent-${w.id}-${idx}`,
        ts: 0,
        level: /error|fail/i.test(line) ? 'error' : /warn/i.test(line) ? 'warn' : 'info',
        source: 'agent',
        provider: w.name,
        message: line,
        targetTab: 'agent-swarm',
      });
    });
  }

  // Newest first; entries without a timestamp go last but keep their relative order
  return out
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.ts - a.entry.ts || a.index - b.index)
    .map(({ entry }) => entry);
}

export interface AdminLogFilter {
  level?: AdminLogLevel | 'all';
  source?: AdminLogSource | 'all';
  provider?: string | 'all';
  query?: string;
}

export function filterAdminLogs(logs: AdminLogEntry[], filter: AdminLogFilter): AdminLogEntry[] {
  const q = (filter.query || '').trim().toLowerCase();
  return logs.filter((l) => {
    if (filter.level && filter.level !== 'all' && l.level !== filter.level) return false;
    if (filter.source && filter.source !== 'all' && l.source !== filter.source) return false;
    if (filter.provider && filter.provider !== 'all' && l.provider !== filter.provider)
      return false;
    if (!q) return true;
    return (
      l.message.toLowerCase().includes(q) ||
      l.provider.toLowerCase().includes(q) ||
      (l.details || '').toLowerCase().includes(q)
    );
  });
}
