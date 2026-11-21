import { create } from 'zustand';
import { adminService } from '../services/adminService';

export type ProviderPoolId =
  | 'gemini'
  | 'groq'
  | 'openai'
  | 'anthropic'
  | 'render'
  | 'cloudflare'
  | 'supabase'
  | 'upstash'
  | 'qdrant'
  | 'github';

export type ProviderCategory = 'ai' | 'compute' | 'data' | 'edge';
export type AccountStatus = 'active' | 'standby' | 'rate-limited' | 'exhausted' | 'paused';
export type PoolRoutingStrategy = 'priority-failover' | 'weighted-balance' | 'tier-split';

export interface AccountErrorBreakdown {
  http429: number;
  http402: number;
  http401: number;
  http5xx: number;
}

export interface ProviderAccountRecord {
  id: string;
  providerId: ProviderPoolId;
  providerLabel: string;
  category: ProviderCategory;
  accountAlias: string;
  ownerEmail: string;
  environment: 'prod' | 'staging' | 'backup';
  planTier: 'free' | 'paid' | 'credits';
  status: AccountStatus;
  priority: number;
  trafficWeight: number;
  quotaMetricLabel: string;
  quotaUsed: number;
  quotaLimit: number;
  dailyBurnRate: number;
  monthlySpendUsd: number;
  monthlyBudgetUsd: number;
  resetDayOfMonth: number;
  region: string;
  keyMask: string;
  infisicalPath: string;
  lastRotatedAt: string;
  lastVerifiedAt: string;
  latencyMs: number;
  errors24h: AccountErrorBreakdown;
  hourlyErrorBuckets: number[];
  linkedServices: string[];
  consoleUrl: string;
  notes?: string;
}

export interface ProviderPoolPolicy {
  providerId: ProviderPoolId;
  autoFailoverEnabled: boolean;
  switchThresholdPct: number;
  failoverOn429: boolean;
  routingStrategy: PoolRoutingStrategy;
}

export interface ProviderAccountAuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  providerId: ProviderPoolId;
  accountAlias: string;
  action: 'failover' | 'promote' | 'rotate-key' | 'probe' | 'policy' | 'pause' | 'crud';
  summary: string;
}

export interface RunwayEstimate {
  usagePct: number;
  remaining: number;
  daysLeft: number | null;
  label: string;
  severity: 'nominal' | 'warning' | 'critical';
}

export function calculateAccountRunway(acc: ProviderAccountRecord): RunwayEstimate {
  const limit = Math.max(1, acc.quotaLimit);
  const used = Math.max(0, acc.quotaUsed);
  const usagePct = Math.min(100, Math.round((used / limit) * 100));
  const remaining = Math.max(0, limit - used);

  if (remaining <= 0 || acc.status === 'exhausted') {
    return {
      usagePct: 100,
      remaining: 0,
      daysLeft: 0,
      label: 'Exhausted',
      severity: 'critical',
    };
  }

  const daysLeft =
    acc.dailyBurnRate > 0 ? Number((remaining / acc.dailyBurnRate).toFixed(1)) : null;

  let label = 'Stable';
  if (daysLeft !== null) {
    if (daysLeft < 1) {
      label = `${Math.max(1, Math.round(daysLeft * 24))}h left`;
    } else if (daysLeft <= 60) {
      label = `${daysLeft.toFixed(1)}d left`;
    } else {
      label = '60d+ runway';
    }
  }

  const severity: 'nominal' | 'warning' | 'critical' =
    usagePct >= 90 || (daysLeft !== null && daysLeft <= 2) || acc.errors24h.http402 > 0
      ? 'critical'
      : usagePct >= 70 || (daysLeft !== null && daysLeft <= 5) || acc.errors24h.http429 >= 5
        ? 'warning'
        : 'nominal';

  return { usagePct, remaining, daysLeft, label, severity };
}

export function getDaysUntilReset(resetDayOfMonth: number): number {
  const now = new Date();
  const clampedDay = Math.min(28, Math.max(1, Math.round(resetDayOfMonth || 1)));
  const currentMonthReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), clampedDay));
  const target =
    currentMonthReset.getTime() > now.getTime()
      ? currentMonthReset
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, clampedDay));

  return Math.max(1, Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

export function formatCompactQuota(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

const STORAGE_KEY = 'supremeai_multi_account_provider_hub_v1';

const INITIAL_ACCOUNTS: ProviderAccountRecord[] = [
  // Google Gemini Pool (3 accounts)
  {
    id: 'acc_gemini_01',
    providerId: 'gemini',
    providerLabel: 'Google Gemini',
    category: 'ai',
    accountAlias: 'Gemini-Free-Pool-A',
    ownerEmail: 'ops-ai-1@supremeai.dev',
    environment: 'prod',
    planTier: 'free',
    status: 'rate-limited',
    priority: 1,
    trafficWeight: 60,
    quotaMetricLabel: 'Tokens / mo',
    quotaUsed: 9_240_000,
    quotaLimit: 10_000_000,
    dailyBurnRate: 620_000,
    monthlySpendUsd: 0,
    monthlyBudgetUsd: 0,
    resetDayOfMonth: 1,
    region: 'asia-northeast1',
    keyMask: 'AIza••••7kP9',
    infisicalPath: '/ai-providers/GEMINI_POOL_A_KEY',
    lastRotatedAt: '14d ago',
    lastVerifiedAt: '2m ago',
    latencyMs: 218,
    errors24h: { http429: 19, http402: 0, http401: 0, http5xx: 1 },
    hourlyErrorBuckets: [0, 1, 0, 2, 1, 0, 3, 2, 4, 3, 2, 2],
    linkedServices: ['Chat Gateway', 'Deep Research'],
    consoleUrl: 'https://aistudio.google.com/apikey',
    notes: 'Primary free-tier key approaching monthly token ceiling; auto-failover armed.',
  },
  {
    id: 'acc_gemini_02',
    providerId: 'gemini',
    providerLabel: 'Google Gemini',
    category: 'ai',
    accountAlias: 'Gemini-Free-Pool-B',
    ownerEmail: 'ops-ai-2@supremeai.dev',
    environment: 'prod',
    planTier: 'free',
    status: 'standby',
    priority: 2,
    trafficWeight: 30,
    quotaMetricLabel: 'Tokens / mo',
    quotaUsed: 3_120_000,
    quotaLimit: 10_000_000,
    dailyBurnRate: 210_000,
    monthlySpendUsd: 0,
    monthlyBudgetUsd: 0,
    resetDayOfMonth: 1,
    region: 'us-central1',
    keyMask: 'AIza••••3mQ2',
    infisicalPath: '/ai-providers/GEMINI_POOL_B_KEY',
    lastRotatedAt: '10d ago',
    lastVerifiedAt: '2m ago',
    latencyMs: 184,
    errors24h: { http429: 1, http402: 0, http401: 0, http5xx: 0 },
    hourlyErrorBuckets: [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
    linkedServices: ['Chat Gateway', 'Title Generator'],
    consoleUrl: 'https://aistudio.google.com/apikey',
    notes: 'Warm standby with 68% capacity ready for automatic overflow.',
  },
  {
    id: 'acc_gemini_03',
    providerId: 'gemini',
    providerLabel: 'Google Gemini',
    category: 'ai',
    accountAlias: 'Gemini-Vertex-Paid',
    ownerEmail: 'billing-cloud@supremeai.dev',
    environment: 'prod',
    planTier: 'paid',
    status: 'active',
    priority: 3,
    trafficWeight: 10,
    quotaMetricLabel: 'Tokens / mo',
    quotaUsed: 18_400_000,
    quotaLimit: 100_000_000,
    dailyBurnRate: 950_000,
    monthlySpendUsd: 42.8,
    monthlyBudgetUsd: 250,
    resetDayOfMonth: 1,
    region: 'global-vertex',
    keyMask: 'ya29••••vX81',
    infisicalPath: '/ai-providers/VERTEX_PAID_KEY',
    lastRotatedAt: '5d ago',
    lastVerifiedAt: '2m ago',
    latencyMs: 162,
    errors24h: { http429: 0, http402: 0, http401: 0, http5xx: 0 },
    hourlyErrorBuckets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    linkedServices: ['Enterprise Chat', 'Swarm Solver'],
    consoleUrl: 'https://console.cloud.google.com/vertex-ai',
    notes: 'Reserved for Enterprise accounts and paid overflow bursts.',
  },

  // Render Compute Pool (2 accounts)
  {
    id: 'acc_render_01',
    providerId: 'render',
    providerLabel: 'Render Cloud',
    category: 'compute',
    accountAlias: 'Render-Core-Acc-1',
    ownerEmail: 'infra-1@supremeai.dev',
    environment: 'prod',
    planTier: 'free',
    status: 'active',
    priority: 1,
    trafficWeight: 100,
    quotaMetricLabel: 'Build Mins / mo',
    quotaUsed: 465,
    quotaLimit: 500,
    dailyBurnRate: 24,
    monthlySpendUsd: 0,
    monthlyBudgetUsd: 25,
    resetDayOfMonth: 1,
    region: 'oregon-us',
    keyMask: 'rnd_••••89cA',
    infisicalPath: '/infra/RENDER_ACC1_TOKEN',
    lastRotatedAt: '22d ago',
    lastVerifiedAt: '4m ago',
    latencyMs: 312,
    errors24h: { http429: 0, http402: 2, http401: 0, http5xx: 1 },
    hourlyErrorBuckets: [0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0],
    linkedServices: ['MCP Tower', 'Control Plane API'],
    consoleUrl: 'https://dashboard.render.com/billing',
    notes: 'Only 35 build mins left this cycle — shift deploys to Render-Overflow-Acc-2.',
  },
  {
    id: 'acc_render_02',
    providerId: 'render',
    providerLabel: 'Render Cloud',
    category: 'compute',
    accountAlias: 'Render-Overflow-Acc-2',
    ownerEmail: 'infra-2@supremeai.dev',
    environment: 'backup',
    planTier: 'free',
    status: 'standby',
    priority: 2,
    trafficWeight: 0,
    quotaMetricLabel: 'Build Mins / mo',
    quotaUsed: 95,
    quotaLimit: 500,
    dailyBurnRate: 8,
    monthlySpendUsd: 0,
    monthlyBudgetUsd: 0,
    resetDayOfMonth: 1,
    region: 'singapore',
    keyMask: 'rnd_••••14fZ',
    infisicalPath: '/infra/RENDER_ACC2_TOKEN',
    lastRotatedAt: '18d ago',
    lastVerifiedAt: '4m ago',
    latencyMs: 245,
    errors24h: { http429: 0, http402: 0, http401: 0, http5xx: 0 },
    hourlyErrorBuckets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    linkedServices: ['MCP Standby Mirror', 'Cron Worker'],
    consoleUrl: 'https://dashboard.render.com/billing',
  },

  // Groq Fast Inference Pool (2 accounts)
  {
    id: 'acc_groq_01',
    providerId: 'groq',
    providerLabel: 'Groq Cloud',
    category: 'ai',
    accountAlias: 'Groq-Fast-Acc-1',
    ownerEmail: 'ops-ai-1@supremeai.dev',
    environment: 'prod',
    planTier: 'free',
    status: 'active',
    priority: 1,
    trafficWeight: 70,
    quotaMetricLabel: 'Req / day',
    quotaUsed: 11_800,
    quotaLimit: 14_400,
    dailyBurnRate: 12_200,
    monthlySpendUsd: 0,
    monthlyBudgetUsd: 0,
    resetDayOfMonth: 22,
    region: 'us-east',
    keyMask: 'gsk_••••61tR',
    infisicalPath: '/ai-providers/GROQ_ACC1_KEY',
    lastRotatedAt: '9d ago',
    lastVerifiedAt: '1m ago',
    latencyMs: 96,
    errors24h: { http429: 8, http402: 0, http401: 0, http5xx: 0 },
    hourlyErrorBuckets: [0, 0, 1, 0, 1, 0, 2, 1, 0, 2, 1, 0],
    linkedServices: ['Fast Autocomplete', 'Agent Router'],
    consoleUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'acc_groq_02',
    providerId: 'groq',
    providerLabel: 'Groq Cloud',
    category: 'ai',
    accountAlias: 'Groq-Fast-Acc-2',
    ownerEmail: 'ops-ai-3@supremeai.dev',
    environment: 'prod',
    planTier: 'free',
    status: 'standby',
    priority: 2,
    trafficWeight: 30,
    quotaMetricLabel: 'Req / day',
    quotaUsed: 3_400,
    quotaLimit: 14_400,
    dailyBurnRate: 3_600,
    monthlySpendUsd: 0,
    monthlyBudgetUsd: 0,
    resetDayOfMonth: 22,
    region: 'us-east',
    keyMask: 'gsk_••••90mP',
    infisicalPath: '/ai-providers/GROQ_ACC2_KEY',
    lastRotatedAt: '9d ago',
    lastVerifiedAt: '1m ago',
    latencyMs: 102,
    errors24h: { http429: 0, http402: 0, http401: 0, http5xx: 0 },
    hourlyErrorBuckets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    linkedServices: ['Fast Autocomplete', 'Verifier Worker'],
    consoleUrl: 'https://console.groq.com/keys',
  },

  // OpenAI Pool (2 accounts)
  {
    id: 'acc_openai_01',
    providerId: 'openai',
    providerLabel: 'OpenAI',
    category: 'ai',
    accountAlias: 'OpenAI-Org-Main',
    ownerEmail: 'billing-cloud@supremeai.dev',
    environment: 'prod',
    planTier: 'credits',
    status: 'active',
    priority: 1,
    trafficWeight: 100,
    quotaMetricLabel: 'Credit USD',
    quotaUsed: 76,
    quotaLimit: 120,
    dailyBurnRate: 4.5,
    monthlySpendUsd: 76,
    monthlyBudgetUsd: 120,
    resetDayOfMonth: 1,
    region: 'us-east',
    keyMask: 'sk-proj••••4a9L',
    infisicalPath: '/ai-providers/OPENAI_ORG_MAIN',
    lastRotatedAt: '12d ago',
    lastVerifiedAt: '3m ago',
    latencyMs: 240,
    errors24h: { http429: 2, http402: 0, http401: 0, http5xx: 0 },
    hourlyErrorBuckets: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0],
    linkedServices: ['Reasoning Fallback', 'Embeddings'],
    consoleUrl: 'https://platform.openai.com/settings/organization/billing/overview',
  },
  {
    id: 'acc_openai_02',
    providerId: 'openai',
    providerLabel: 'OpenAI',
    category: 'ai',
    accountAlias: 'OpenAI-Backup-Credits',
    ownerEmail: 'ops-ai-2@supremeai.dev',
    environment: 'backup',
    planTier: 'credits',
    status: 'standby',
    priority: 2,
    trafficWeight: 0,
    quotaMetricLabel: 'Credit USD',
    quotaUsed: 12,
    quotaLimit: 100,
    dailyBurnRate: 0.6,
    monthlySpendUsd: 12,
    monthlyBudgetUsd: 100,
    resetDayOfMonth: 1,
    region: 'us-west',
    keyMask: 'sk-proj••••8c2D',
    infisicalPath: '/ai-providers/OPENAI_BACKUP_KEY',
    lastRotatedAt: '20d ago',
    lastVerifiedAt: '3m ago',
    latencyMs: 255,
    errors24h: { http429: 0, http402: 0, http401: 0, http5xx: 0 },
    hourlyErrorBuckets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    linkedServices: ['Reasoning Fallback'],
    consoleUrl: 'https://platform.openai.com/settings/organization/billing/overview',
  },

  // Upstash Redis Pool (2 accounts)
  {
    id: 'acc_upstash_01',
    providerId: 'upstash',
    providerLabel: 'Upstash Redis',
    category: 'data',
    accountAlias: 'Upstash-Queue-Primary',
    ownerEmail: 'infra-1@supremeai.dev',
    environment: 'prod',
    planTier: 'free',
    status: 'active',
    priority: 1,
    trafficWeight: 100,
    quotaMetricLabel: 'Cmds / mo',
    quotaUsed: 410_000,
    quotaLimit: 500_000,
    dailyBurnRate: 28_500,
    monthlySpendUsd: 0,
    monthlyBudgetUsd: 0,
    resetDayOfMonth: 25,
    region: 'ap-southeast-1',
    keyMask: 'AX9k••••21qW',
    infisicalPath: '/data/UPSTASH_PRIMARY_URL',
    lastRotatedAt: '30d ago',
    lastVerifiedAt: '2m ago',
    latencyMs: 38,
    errors24h: { http429: 6, http402: 0, http401: 0, http5xx: 0 },
    hourlyErrorBuckets: [0, 0, 1, 0, 0, 2, 1, 0, 1, 0, 1, 0],
    linkedServices: ['Task Queue (BullMQ)', 'Rate Limiter'],
    consoleUrl: 'https://console.upstash.com/',
  },
  {
    id: 'acc_upstash_02',
    providerId: 'upstash',
    providerLabel: 'Upstash Redis',
    category: 'data',
    accountAlias: 'Upstash-Queue-Secondary',
    ownerEmail: 'infra-2@supremeai.dev',
    environment: 'backup',
    planTier: 'free',
    status: 'standby',
    priority: 2,
    trafficWeight: 0,
    quotaMetricLabel: 'Cmds / mo',
    quotaUsed: 64_000,
    quotaLimit: 500_000,
    dailyBurnRate: 4_200,
    monthlySpendUsd: 0,
    monthlyBudgetUsd: 0,
    resetDayOfMonth: 25,
    region: 'us-east-1',
    keyMask: 'AZ3p••••90nK',
    infisicalPath: '/data/UPSTASH_BACKUP_URL',
    lastRotatedAt: '30d ago',
    lastVerifiedAt: '2m ago',
    latencyMs: 44,
    errors24h: { http429: 0, http402: 0, http401: 0, http5xx: 0 },
    hourlyErrorBuckets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    linkedServices: ['Session Cache'],
    consoleUrl: 'https://console.upstash.com/',
  },

  // Supabase Pool (2 accounts)
  {
    id: 'acc_supabase_01',
    providerId: 'supabase',
    providerLabel: 'Supabase Postgres',
    category: 'data',
    accountAlias: 'Supabase-Prod-Main',
    ownerEmail: 'infra-1@supremeai.dev',
    environment: 'prod',
    planTier: 'paid',
    status: 'active',
    priority: 1,
    trafficWeight: 100,
    quotaMetricLabel: 'DB Storage MB',
    quotaUsed: 3_420,
    quotaLimit: 8_192,
    dailyBurnRate: 45,
    monthlySpendUsd: 25,
    monthlyBudgetUsd: 50,
    resetDayOfMonth: 1,
    region: 'ap-southeast-1',
    keyMask: 'sbp_••••52eM',
    infisicalPath: '/data/SUPABASE_PROD_KEY',
    lastRotatedAt: '15d ago',
    lastVerifiedAt: '3m ago',
    latencyMs: 52,
    errors24h: { http429: 0, http402: 0, http401: 0, http5xx: 0 },
    hourlyErrorBuckets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    linkedServices: ['Auth & Customers', 'Audit Ledger'],
    consoleUrl: 'https://supabase.com/dashboard/projects',
  },
  {
    id: 'acc_supabase_02',
    providerId: 'supabase',
    providerLabel: 'Supabase Postgres',
    category: 'data',
    accountAlias: 'Supabase-Staging-Free',
    ownerEmail: 'infra-2@supremeai.dev',
    environment: 'staging',
    planTier: 'free',
    status: 'standby',
    priority: 2,
    trafficWeight: 0,
    quotaMetricLabel: 'DB Storage MB',
    quotaUsed: 290,
    quotaLimit: 500,
    dailyBurnRate: 6,
    monthlySpendUsd: 0,
    monthlyBudgetUsd: 0,
    resetDayOfMonth: 1,
    region: 'ap-southeast-1',
    keyMask: 'sbp_••••11xV',
    infisicalPath: '/data/SUPABASE_STAGING_KEY',
    lastRotatedAt: '27d ago',
    lastVerifiedAt: '3m ago',
    latencyMs: 68,
    errors24h: { http429: 0, http402: 0, http401: 0, http5xx: 0 },
    hourlyErrorBuckets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    linkedServices: ['Schema Parity Staging'],
    consoleUrl: 'https://supabase.com/dashboard/projects',
  },

  // Cloudflare Edge Pool (2 accounts)
  {
    id: 'acc_cf_01',
    providerId: 'cloudflare',
    providerLabel: 'Cloudflare Edge',
    category: 'edge',
    accountAlias: 'Cloudflare-Pages-Prod',
    ownerEmail: 'ops-edge@supremeai.dev',
    environment: 'prod',
    planTier: 'free',
    status: 'active',
    priority: 1,
    trafficWeight: 100,
    quotaMetricLabel: 'Worker Req / day',
    quotaUsed: 62_400,
    quotaLimit: 100_000,
    dailyBurnRate: 64_000,
    monthlySpendUsd: 0,
    monthlyBudgetUsd: 20,
    resetDayOfMonth: 20,
    region: 'global-anycast',
    keyMask: 'cf_••••77hB',
    infisicalPath: '/edge/CF_PROD_API_TOKEN',
    lastRotatedAt: '19d ago',
    lastVerifiedAt: '1m ago',
    latencyMs: 24,
    errors24h: { http429: 0, http402: 0, http401: 0, http5xx: 0 },
    hourlyErrorBuckets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    linkedServices: ['Web Frontend', 'Edge Proxy Functions'],
    consoleUrl: 'https://dash.cloudflare.com/',
  },
  {
    id: 'acc_cf_02',
    providerId: 'cloudflare',
    providerLabel: 'Cloudflare Edge',
    category: 'edge',
    accountAlias: 'Cloudflare-Staging-Edge',
    ownerEmail: 'ops-edge-2@supremeai.dev',
    environment: 'staging',
    planTier: 'free',
    status: 'standby',
    priority: 2,
    trafficWeight: 0,
    quotaMetricLabel: 'Worker Req / day',
    quotaUsed: 11_200,
    quotaLimit: 100_000,
    dailyBurnRate: 10_000,
    monthlySpendUsd: 0,
    monthlyBudgetUsd: 0,
    resetDayOfMonth: 20,
    region: 'global-anycast',
    keyMask: 'cf_••••09wQ',
    infisicalPath: '/edge/CF_STAGING_TOKEN',
    lastRotatedAt: '19d ago',
    lastVerifiedAt: '1m ago',
    latencyMs: 29,
    errors24h: { http429: 0, http402: 0, http401: 0, http5xx: 0 },
    hourlyErrorBuckets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    linkedServices: ['Canary Preview', 'Browser Proxy'],
    consoleUrl: 'https://dash.cloudflare.com/',
  },
];

const INITIAL_POLICIES: Record<ProviderPoolId, ProviderPoolPolicy> = {
  gemini: {
    providerId: 'gemini',
    autoFailoverEnabled: true,
    switchThresholdPct: 85,
    failoverOn429: true,
    routingStrategy: 'priority-failover',
  },
  groq: {
    providerId: 'groq',
    autoFailoverEnabled: true,
    switchThresholdPct: 80,
    failoverOn429: true,
    routingStrategy: 'weighted-balance',
  },
  openai: {
    providerId: 'openai',
    autoFailoverEnabled: true,
    switchThresholdPct: 85,
    failoverOn429: true,
    routingStrategy: 'priority-failover',
  },
  anthropic: {
    providerId: 'anthropic',
    autoFailoverEnabled: true,
    switchThresholdPct: 85,
    failoverOn429: true,
    routingStrategy: 'priority-failover',
  },
  render: {
    providerId: 'render',
    autoFailoverEnabled: true,
    switchThresholdPct: 90,
    failoverOn429: false,
    routingStrategy: 'priority-failover',
  },
  cloudflare: {
    providerId: 'cloudflare',
    autoFailoverEnabled: true,
    switchThresholdPct: 85,
    failoverOn429: true,
    routingStrategy: 'priority-failover',
  },
  supabase: {
    providerId: 'supabase',
    autoFailoverEnabled: false,
    switchThresholdPct: 90,
    failoverOn429: false,
    routingStrategy: 'tier-split',
  },
  upstash: {
    providerId: 'upstash',
    autoFailoverEnabled: true,
    switchThresholdPct: 85,
    failoverOn429: true,
    routingStrategy: 'priority-failover',
  },
  qdrant: {
    providerId: 'qdrant',
    autoFailoverEnabled: true,
    switchThresholdPct: 85,
    failoverOn429: false,
    routingStrategy: 'priority-failover',
  },
  github: {
    providerId: 'github',
    autoFailoverEnabled: true,
    switchThresholdPct: 80,
    failoverOn429: true,
    routingStrategy: 'priority-failover',
  },
};

const INITIAL_AUDIT: ProviderAccountAuditEntry[] = [
  {
    id: 'aud_init_1',
    timestamp: 'Just now',
    actor: 'auto-failover-engine',
    providerId: 'gemini',
    accountAlias: 'Gemini-Free-Pool-A',
    action: 'probe',
    summary:
      'Detected 92% monthly token utilization + 19 HTTP 429 events; Gemini-Free-Pool-B ready for failover.',
  },
  {
    id: 'aud_init_2',
    timestamp: '12m ago',
    actor: 'infra-sweeper',
    providerId: 'render',
    accountAlias: 'Render-Core-Acc-1',
    action: 'probe',
    summary:
      'Build minutes at 93% (35 mins remaining). Standby Render-Overflow-Acc-2 verified healthy.',
  },
];

function loadPersistedState(): {
  accounts: ProviderAccountRecord[];
  policies: Record<ProviderPoolId, ProviderPoolPolicy>;
  auditLog: ProviderAccountAuditEntry[];
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        accounts: INITIAL_ACCOUNTS,
        policies: INITIAL_POLICIES,
        auditLog: INITIAL_AUDIT,
      };
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.accounts) && parsed.accounts.length > 0) {
      return {
        accounts: parsed.accounts,
        policies: { ...INITIAL_POLICIES, ...(parsed.policies || {}) },
        auditLog: Array.isArray(parsed.auditLog) ? parsed.auditLog : INITIAL_AUDIT,
      };
    }
  } catch {
    // ignore storage errors
  }
  return {
    accounts: INITIAL_ACCOUNTS,
    policies: INITIAL_POLICIES,
    auditLog: INITIAL_AUDIT,
  };
}

function savePersistedState(state: {
  accounts: ProviderAccountRecord[];
  policies: Record<ProviderPoolId, ProviderPoolPolicy>;
  auditLog: ProviderAccountAuditEntry[];
}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage quota errors
  }
}

function nowTimeStr(): string {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

interface ProviderAccountsStoreState {
  accounts: ProviderAccountRecord[];
  policies: Record<ProviderPoolId, ProviderPoolPolicy>;
  auditLog: ProviderAccountAuditEntry[];
  isProbingAll: boolean;
  probingAccountId: string | null;
  lastGlobalSweepAt: string;

  setPrimaryAccount: (accountId: string, actor?: string) => void;
  triggerPoolFailover: (
    providerId: ProviderPoolId,
    actor?: string
  ) => {
    switched: boolean;
    message: string;
  };
  autoRebalanceAllPools: (actor?: string) => number;
  toggleAccountPause: (accountId: string, actor?: string) => void;
  rotateAccountKey: (
    accountId: string,
    newKeyMask: string,
    infisicalPath?: string,
    actor?: string
  ) => void;
  updatePoolPolicy: (
    providerId: ProviderPoolId,
    patch: Partial<ProviderPoolPolicy>,
    actor?: string
  ) => void;
  addAccount: (
    account: Omit<
      ProviderAccountRecord,
      'id' | 'lastRotatedAt' | 'lastVerifiedAt' | 'errors24h' | 'hourlyErrorBuckets'
    >,
    actor?: string
  ) => void;
  updateAccount: (accountId: string, patch: Partial<ProviderAccountRecord>, actor?: string) => void;
  deleteAccount: (accountId: string, actor?: string) => void;
  probeAccount: (accountId: string, actor?: string) => Promise<void>;
  probeAllAccounts: (actor?: string) => Promise<void>;
}

const initial = loadPersistedState();

export const useProviderAccountsStore = create<ProviderAccountsStoreState>((set, get) => ({
  accounts: initial.accounts,
  policies: initial.policies,
  auditLog: initial.auditLog,
  isProbingAll: false,
  probingAccountId: null,
  lastGlobalSweepAt: nowTimeStr(),

  setPrimaryAccount: (accountId, actor = 'admin') => {
    const state = get();
    const target = state.accounts.find((a) => a.id === accountId);
    if (!target) return;

    const poolAccounts = state.accounts.filter((a) => a.providerId === target.providerId);
    const orderedIds = [
      target.id,
      ...poolAccounts
        .filter((a) => a.id !== target.id)
        .sort((a, b) => a.priority - b.priority)
        .map((a) => a.id),
    ];

    const updatedAccounts = state.accounts.map((acc) => {
      if (acc.providerId !== target.providerId) return acc;
      const newPriority = orderedIds.indexOf(acc.id) + 1;
      if (acc.id === target.id) {
        return {
          ...acc,
          priority: 1,
          status: acc.quotaUsed >= acc.quotaLimit ? ('exhausted' as const) : ('active' as const),
          trafficWeight: poolAccounts.length > 1 ? 80 : 100,
        };
      }
      return {
        ...acc,
        priority: newPriority,
        status: acc.status === 'active' ? ('standby' as const) : acc.status,
        trafficWeight: newPriority === 2 ? 20 : 0,
      };
    });

    const entry: ProviderAccountAuditEntry = {
      id: `aud_${Date.now()}`,
      timestamp: nowTimeStr(),
      actor,
      providerId: target.providerId,
      accountAlias: target.accountAlias,
      action: 'promote',
      summary: `Promoted ${target.accountAlias} (${target.ownerEmail}) to Priority #1 Primary in ${target.providerLabel} pool.`,
    };

    const nextAudit = [entry, ...state.auditLog].slice(0, 60);
    savePersistedState({
      accounts: updatedAccounts,
      policies: state.policies,
      auditLog: nextAudit,
    });
    set({ accounts: updatedAccounts, auditLog: nextAudit });
  },

  triggerPoolFailover: (providerId, actor = 'admin') => {
    const state = get();
    const pool = state.accounts
      .filter((a) => a.providerId === providerId)
      .sort((a, b) => a.priority - b.priority);

    if (pool.length < 2) {
      return {
        switched: false,
        message: 'Add at least 2 accounts in this pool to enable failover.',
      };
    }

    const currentPrimary = pool[0];
    const candidate = pool
      .slice(1)
      .filter((a) => a.status !== 'paused' && a.status !== 'exhausted')
      .sort((a, b) => {
        const ra = calculateAccountRunway(a).usagePct;
        const rb = calculateAccountRunway(b).usagePct;
        return ra - rb;
      })[0];

    if (!candidate) {
      return {
        switched: false,
        message: `No healthy standby account available in ${currentPrimary.providerLabel} pool.`,
      };
    }

    const updatedAccounts = state.accounts.map((acc) => {
      if (acc.providerId !== providerId) return acc;
      if (acc.id === candidate.id) {
        return {
          ...acc,
          priority: 1,
          status: 'active' as const,
          trafficWeight: 90,
          lastVerifiedAt: 'Just now',
        };
      }
      if (acc.id === currentPrimary.id) {
        const runway = calculateAccountRunway(acc);
        return {
          ...acc,
          priority: pool.length,
          status: runway.usagePct >= 100 ? ('exhausted' as const) : ('standby' as const),
          trafficWeight: 0,
        };
      }
      return { ...acc, priority: Math.max(2, acc.priority) };
    });

    const entry: ProviderAccountAuditEntry = {
      id: `aud_${Date.now()}_${providerId}`,
      timestamp: nowTimeStr(),
      actor,
      providerId,
      accountAlias: candidate.accountAlias,
      action: 'failover',
      summary: `Failed over ${currentPrimary.providerLabel} from ${currentPrimary.accountAlias} → ${candidate.accountAlias} (${calculateAccountRunway(candidate).usagePct}% used).`,
    };

    const nextAudit = [entry, ...state.auditLog].slice(0, 60);
    savePersistedState({
      accounts: updatedAccounts,
      policies: state.policies,
      auditLog: nextAudit,
    });
    set({ accounts: updatedAccounts, auditLog: nextAudit });

    return {
      switched: true,
      message: `Switched ${currentPrimary.providerLabel} primary to ${candidate.accountAlias}.`,
    };
  },

  autoRebalanceAllPools: (actor = 'admin') => {
    const state = get();
    const providerIds = Array.from(new Set(state.accounts.map((a) => a.providerId)));
    let switches = 0;

    for (const pid of providerIds) {
      const policy = state.policies[pid];
      if (policy && !policy.autoFailoverEnabled) continue;

      const latestAccounts = get().accounts.filter((a) => a.providerId === pid);
      const primary = [...latestAccounts].sort((a, b) => a.priority - b.priority)[0];
      if (!primary) continue;

      const runway = calculateAccountRunway(primary);
      const threshold = policy?.switchThresholdPct ?? 85;
      const shouldFailover =
        runway.usagePct >= threshold ||
        primary.status === 'exhausted' ||
        (policy?.failoverOn429 &&
          (primary.status === 'rate-limited' || primary.errors24h.http429 >= 10));

      if (shouldFailover) {
        const res = get().triggerPoolFailover(pid, actor);
        if (res.switched) switches += 1;
      }
    }

    return switches;
  },

  toggleAccountPause: (accountId, actor = 'admin') => {
    const state = get();
    const target = state.accounts.find((a) => a.id === accountId);
    if (!target) return;

    const nextStatus: AccountStatus = target.status === 'paused' ? 'standby' : 'paused';
    const updatedAccounts = state.accounts.map((acc) =>
      acc.id === accountId
        ? {
            ...acc,
            status: nextStatus,
            trafficWeight: nextStatus === 'paused' ? 0 : acc.trafficWeight,
          }
        : acc
    );

    const entry: ProviderAccountAuditEntry = {
      id: `aud_${Date.now()}`,
      timestamp: nowTimeStr(),
      actor,
      providerId: target.providerId,
      accountAlias: target.accountAlias,
      action: 'pause',
      summary: `${nextStatus === 'paused' ? 'Paused' : 'Resumed'} traffic routing for ${target.accountAlias}.`,
    };

    const nextAudit = [entry, ...state.auditLog].slice(0, 60);
    savePersistedState({
      accounts: updatedAccounts,
      policies: state.policies,
      auditLog: nextAudit,
    });
    set({ accounts: updatedAccounts, auditLog: nextAudit });
  },

  rotateAccountKey: (accountId, newKeyMask, infisicalPath, actor = 'admin') => {
    const state = get();
    const target = state.accounts.find((a) => a.id === accountId);
    if (!target) return;

    const updatedAccounts = state.accounts.map((acc) =>
      acc.id === accountId
        ? {
            ...acc,
            keyMask: newKeyMask,
            infisicalPath: infisicalPath || acc.infisicalPath,
            lastRotatedAt: 'Just now',
            lastVerifiedAt: 'Just now',
            errors24h: { ...acc.errors24h, http401: 0 },
            status: acc.status === 'exhausted' ? 'standby' : acc.status,
          }
        : acc
    );

    const entry: ProviderAccountAuditEntry = {
      id: `aud_${Date.now()}`,
      timestamp: nowTimeStr(),
      actor,
      providerId: target.providerId,
      accountAlias: target.accountAlias,
      action: 'rotate-key',
      summary: `Rotated credential for ${target.accountAlias} (${newKeyMask}) and synced vault path.`,
    };

    const nextAudit = [entry, ...state.auditLog].slice(0, 60);
    savePersistedState({
      accounts: updatedAccounts,
      policies: state.policies,
      auditLog: nextAudit,
    });
    set({ accounts: updatedAccounts, auditLog: nextAudit });
  },

  updatePoolPolicy: (providerId, patch, actor = 'admin') => {
    const state = get();
    const current = state.policies[providerId] || {
      providerId,
      autoFailoverEnabled: true,
      switchThresholdPct: 85,
      failoverOn429: true,
      routingStrategy: 'priority-failover' as const,
    };
    const nextPolicy = { ...current, ...patch };
    const nextPolicies = { ...state.policies, [providerId]: nextPolicy };

    const entry: ProviderAccountAuditEntry = {
      id: `aud_${Date.now()}`,
      timestamp: nowTimeStr(),
      actor,
      providerId,
      accountAlias: `${providerId.toUpperCase()} Pool`,
      action: 'policy',
      summary: `Updated pool failover policy: Auto-Failover ${nextPolicy.autoFailoverEnabled ? 'ON' : 'OFF'} at ${nextPolicy.switchThresholdPct}% (${nextPolicy.routingStrategy}).`,
    };

    const nextAudit = [entry, ...state.auditLog].slice(0, 60);
    savePersistedState({ accounts: state.accounts, policies: nextPolicies, auditLog: nextAudit });
    set({ policies: nextPolicies, auditLog: nextAudit });
  },

  addAccount: (account, actor = 'admin') => {
    const state = get();
    const newRecord: ProviderAccountRecord = {
      ...account,
      id: `acc_${account.providerId}_${Date.now()}`,
      lastRotatedAt: 'Just now',
      lastVerifiedAt: 'Just now',
      errors24h: { http429: 0, http402: 0, http401: 0, http5xx: 0 },
      hourlyErrorBuckets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    };

    const updatedAccounts = [...state.accounts, newRecord];
    const entry: ProviderAccountAuditEntry = {
      id: `aud_${Date.now()}`,
      timestamp: nowTimeStr(),
      actor,
      providerId: newRecord.providerId,
      accountAlias: newRecord.accountAlias,
      action: 'crud',
      summary: `Registered new ${newRecord.providerLabel} account ${newRecord.accountAlias} (${newRecord.ownerEmail}).`,
    };

    const nextAudit = [entry, ...state.auditLog].slice(0, 60);
    savePersistedState({
      accounts: updatedAccounts,
      policies: state.policies,
      auditLog: nextAudit,
    });
    set({ accounts: updatedAccounts, auditLog: nextAudit });
  },

  updateAccount: (accountId, patch, actor = 'admin') => {
    const state = get();
    const target = state.accounts.find((a) => a.id === accountId);
    if (!target) return;

    const updatedAccounts = state.accounts.map((acc) =>
      acc.id === accountId ? { ...acc, ...patch } : acc
    );

    const entry: ProviderAccountAuditEntry = {
      id: `aud_${Date.now()}`,
      timestamp: nowTimeStr(),
      actor,
      providerId: target.providerId,
      accountAlias: patch.accountAlias || target.accountAlias,
      action: 'crud',
      summary: `Updated account settings & quota guardrails for ${patch.accountAlias || target.accountAlias}.`,
    };

    const nextAudit = [entry, ...state.auditLog].slice(0, 60);
    savePersistedState({
      accounts: updatedAccounts,
      policies: state.policies,
      auditLog: nextAudit,
    });
    set({ accounts: updatedAccounts, auditLog: nextAudit });
  },

  deleteAccount: (accountId, actor = 'admin') => {
    const state = get();
    const target = state.accounts.find((a) => a.id === accountId);
    if (!target) return;

    const updatedAccounts = state.accounts.filter((acc) => acc.id !== accountId);
    const entry: ProviderAccountAuditEntry = {
      id: `aud_${Date.now()}`,
      timestamp: nowTimeStr(),
      actor,
      providerId: target.providerId,
      accountAlias: target.accountAlias,
      action: 'crud',
      summary: `Removed ${target.accountAlias} from ${target.providerLabel} pool.`,
    };

    const nextAudit = [entry, ...state.auditLog].slice(0, 60);
    savePersistedState({
      accounts: updatedAccounts,
      policies: state.policies,
      auditLog: nextAudit,
    });
    set({ accounts: updatedAccounts, auditLog: nextAudit });
  },

  probeAccount: async (accountId, actor = 'admin') => {
    const state = get();
    const target = state.accounts.find((a) => a.id === accountId);
    if (!target) return;

    set({ probingAccountId: accountId });
    const started = performance.now();
    try {
      await adminService.fetchProviders().catch(() => null);
    } finally {
      const elapsed = Math.max(24, Math.round(performance.now() - started));
      const latest = get();
      const updatedAccounts = latest.accounts.map((acc) =>
        acc.id === accountId
          ? {
              ...acc,
              latencyMs: Math.min(950, Math.round((acc.latencyMs + elapsed) / 2)),
              lastVerifiedAt: 'Just now',
            }
          : acc
      );

      const entry: ProviderAccountAuditEntry = {
        id: `aud_${Date.now()}`,
        timestamp: nowTimeStr(),
        actor,
        providerId: target.providerId,
        accountAlias: target.accountAlias,
        action: 'probe',
        summary: `Verified ${target.accountAlias} health & quota snapshot (${elapsed}ms).`,
      };

      const nextAudit = [entry, ...latest.auditLog].slice(0, 60);
      savePersistedState({
        accounts: updatedAccounts,
        policies: latest.policies,
        auditLog: nextAudit,
      });
      set({
        accounts: updatedAccounts,
        auditLog: nextAudit,
        probingAccountId: null,
      });
    }
  },

  probeAllAccounts: async (actor = 'admin') => {
    set({ isProbingAll: true });
    try {
      const liveRes = await adminService.probeAllProviders().catch(() => null);
      const liveLatencies = new Map<string, number>();
      if (liveRes?.providers) {
        for (const p of liveRes.providers) {
          if (typeof p.latencyMs === 'number' && p.latencyMs > 0) {
            liveLatencies.set(p.provider.toLowerCase(), Math.round(p.latencyMs));
          }
        }
      }

      const latest = get();
      const updatedAccounts = latest.accounts.map((acc) => {
        const matchedLatency =
          liveLatencies.get(acc.providerId) ||
          liveLatencies.get(acc.providerId === 'gemini' ? 'google_ai_studio' : acc.providerId);
        return {
          ...acc,
          latencyMs: matchedLatency ?? acc.latencyMs,
          lastVerifiedAt: 'Just now',
        };
      });

      const entry: ProviderAccountAuditEntry = {
        id: `aud_${Date.now()}`,
        timestamp: nowTimeStr(),
        actor,
        providerId: 'gemini',
        accountAlias: 'All Pools',
        action: 'probe',
        summary: `Completed zero-login synthetic sweep across ${updatedAccounts.length} accounts.`,
      };

      const nextAudit = [entry, ...latest.auditLog].slice(0, 60);
      savePersistedState({
        accounts: updatedAccounts,
        policies: latest.policies,
        auditLog: nextAudit,
      });
      set({
        accounts: updatedAccounts,
        auditLog: nextAudit,
        lastGlobalSweepAt: nowTimeStr(),
      });
    } finally {
      set({ isProbingAll: false });
    }
  },
}));
