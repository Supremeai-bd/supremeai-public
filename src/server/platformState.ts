/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Request } from 'express';
import { DEFAULT_MODEL_ID, DEFAULT_MODEL_POLICIES } from '../shared/platformCatalog';
import { supabaseRestRequest } from './supabaseRest';

/**
 * Central governance state for the Express bootstrap (feature flags, platform
 * config, audit trail seed, WAF blocklist seed) plus its durable Supabase loader
 * and the startup schema probe. Moved verbatim out of `server.ts`
 * (docs/SERVER_TS_SPLIT_PLAN.md). `server.ts` still owns the mutable `let`s, the
 * audit writer and `persistPlatformState`, because route modules receive those
 * by getter/setter and live reference.
 *
 * বাংলা: server.ts ভাগ — শুধু ডেটা/লোডার, রুট নেই; লোড এখনো রুট রেজিস্ট্রেশনের আগেই হয়।
 */

export const createRuntimeFeatureFlags = (): Record<string, boolean> => ({
  enable_supreme_reason: true,
  enable_multimodal_vision: true,
  enable_rag_grounding: true,
  enable_continuous_agent_swarm: true,
  enforce_strict_rate_limits: false,
  maintenance_mode: false,
});

export type PlanTier = 'Free' | 'Pro' | 'Enterprise';
export const TIER_RANK: Record<PlanTier, number> = { Free: 0, Pro: 1, Enterprise: 2 };

export const createPlatformConfig = () => ({
  maintenanceMode: false,
  maintenanceMessage:
    'SupremeAI Studio is undergoing scheduled database maintenance. Administrators remain online.',
  announcementBanner: {
    active: false,
    message: 'All SupremeAI Core and SupremeAI Reason routes are operating normally.',
    level: 'info' as 'info' | 'warning' | 'critical',
  },
  allowNewSignups: true,
  defaultModelId: DEFAULT_MODEL_ID,
  modelPolicies: { ...DEFAULT_MODEL_POLICIES } as Record<
    string,
    { enabled: boolean; minTier: PlanTier }
  >,
});
export type PlatformConfig = ReturnType<typeof createPlatformConfig>;

export interface ServerAuditRecord {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  details: string;
  ipAddress: string;
}

export const createAuditSeed = (isProduction: boolean): ServerAuditRecord[] =>
  isProduction
    ? []
    : [
        {
          id: 'audit_rec_01',
          timestamp: 'Today at 09:40',
          actor: 'platform-admin',
          action: 'SERVICE_REBOOT',
          resource: 'MCP Tower / code-auditor-worker',
          details:
            'Graceful reboot triggered via Admin Dashboard. Memory garbage collected, cold boot latency 28ms.',
          ipAddress: '10.0.4.12',
        },
        {
          id: 'audit_rec_02',
          timestamp: 'Today at 08:15',
          actor: 'platform-admin',
          action: 'RATE_LIMIT_OVERRIDE',
          resource: 'Customer: techcorp_labs (cust_1042)',
          details: 'Increased RPM from 120 to 600 for Enterprise pilot rollout.',
          ipAddress: '10.0.4.12',
        },
        {
          id: 'audit_rec_03',
          timestamp: 'Yesterday at 17:20',
          actor: 'system-agent-scheduler',
          action: 'AUTONOMOUS_SWARM_SCALE',
          resource: 'Swarm Worker: solver-daemon-01',
          details:
            'Auto-scaled worker concurrency to 4 threads during high GitHub issue throughput.',
          ipAddress: '127.0.0.1',
        },
        {
          id: 'audit_rec_04',
          timestamp: 'Apr 10, 2026',
          actor: 'platform-admin',
          action: 'FAILOVER_RULE_UPDATE',
          resource: 'LLM Gateway / supreme-core',
          details: 'Configured automated fallback to supreme-spark on 503 high demand.',
          ipAddress: '10.0.4.12',
        },
      ];

export const getClientIp = (req: Request): string => {
  return String(req.ip || req.socket?.remoteAddress || '127.0.0.1').trim();
};

export type BlockedIpEntry = { ip: string; reason: string; date: string };

export const createBlockedIpsSeed = (isProduction: boolean): BlockedIpEntry[] =>
  isProduction
    ? []
    : [
        { ip: '45.154.255.8', reason: 'Internal MCP Port Scanner', date: '2 days ago' },
        { ip: '198.51.100.44', reason: 'Adversarial Jailbreak Payload Injection', date: 'Today' },
      ];

/**
 * Load durable platform state + recent audit rows from Supabase, mutating the
 * passed live objects IN PLACE (routes/WebSocket bridges hold references).
 */
export const loadDurablePlatformState = async (state: {
  blockedIps: BlockedIpEntry[];
  runtimeFeatureFlags: Record<string, boolean>;
  platformConfig: PlatformConfig;
  auditRecords: ServerAuditRecord[];
}) => {
  const { blockedIps, runtimeFeatureFlags, platformConfig, auditRecords } = state;
  try {
    const rows = await supabaseRestRequest('platform_settings?id=eq.global&select=value', 'GET');
    const value = Array.isArray(rows) ? rows[0]?.value : rows?.value;
    if (value && typeof value === 'object') {
      // বাংলা মন্তব্য: রেফারেন্স-ভাঙা রেস কন্ডিশন ফিক্স — blockedIps/runtimeFeatureFlags/platformConfig
      // রুট মডিউল ও WebSocket ব্রিজে রেজিস্ট্রেশনের সময় রেফারেন্স হিসেবে পাস করা হয়;
      // এখানে নতুন অ্যারে/অবজেক্ট অ্যাসাইন করলে পুরনো রেফারেন্স স্টেল হয়ে যায়।
      // তাই ইন-প্লেস মিউটেশন: অ্যারেতে splice, অবজেক্টে Object.assign।
      if (Array.isArray(value.blockedIps)) {
        blockedIps.splice(0, blockedIps.length, ...value.blockedIps);
      }
      if (value.runtimeFeatureFlags && typeof value.runtimeFeatureFlags === 'object') {
        Object.assign(runtimeFeatureFlags, value.runtimeFeatureFlags);
      }
      if (value.platformConfig && typeof value.platformConfig === 'object') {
        Object.assign(platformConfig, value.platformConfig);
      }
    }
    const logs = await supabaseRestRequest(
      'audit_logs?select=id,actor,action,resource,details,ip_address,created_at&order=created_at.desc&limit=200',
      'GET'
    );
    if (Array.isArray(logs) && logs.length > 0) {
      const mapped = logs.map((l: any) => ({
        id: l.id,
        timestamp: l.created_at
          ? new Date(l.created_at).toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '',
        actor: l.actor,
        action: l.action,
        resource: l.resource,
        details: l.details,
        ipAddress: l.ip_address || '127.0.0.1',
      }));
      auditRecords.splice(0, auditRecords.length, ...mapped);
    }
  } catch {
    /* offline: keep seed/local state */
  }
};

// Startup schema probe. The durable audit + platform-state writers swallow
// errors so they can never break a request, which previously hid the fact
// that `platform_settings` did not exist and that `audit_logs` had no
// partition covering "now". Surface that drift in the logs instead of
// failing silently.
export const verifyGatewaySchema = async () => {
  const checks: Array<{ table: string; path: string; requiredColumns: string[] }> = [
    {
      table: 'platform_settings',
      path: 'platform_settings?select=id&limit=1',
      requiredColumns: ['id', 'value', 'updated_at'],
    },
    {
      table: 'audit_logs',
      path: 'audit_logs?select=id,actor,action,resource,details,ip_address,created_at&limit=1',
      requiredColumns: ['id', 'actor', 'action', 'resource', 'details', 'ip_address', 'created_at'],
    },
  ];
  for (const check of checks) {
    try {
      await supabaseRestRequest(check.path, 'GET');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(
        `[schema] ${check.table} is not usable by the gateway (expected columns: ${check.requiredColumns.join(', ')}). ` +
          `Durable writes to this table will be dropped. Apply supabase/migrations before deploying. Cause: ${detail}`
      );
    }
  }
};
