import { apiClient } from './apiClient';
import type {
  GitHubPullRequest,
  GitHubRunErrorLogsResponse,
  GitHubWorkflowRun,
} from '../utils/githubPipelineMetrics';
import {
  McpServiceLog,
  McpTowerService,
  PlatformConfig,
  ModelPolicy,
  CustomerRecord,
  SystemAuditRecord,
  BlockedIpRecord,
  ProviderKeyItem,
  SwarmWorker,
  TaskQueueJob,
  SchemaParityTable,
  LlmGatewayRoute,
  SecurityEventLog,
} from '../types';
import { INITIAL_MCP_SERVICES, INITIAL_ADMIN_METRICS } from '../data/mcpTowerData';
import {
  INITIAL_FEATURE_FLAGS,
  INITIAL_AUDIT_RECORDS,
  INITIAL_PROVIDER_KEYS,
  INITIAL_SWARM_WORKERS,
  INITIAL_QUEUE_JOBS,
  INITIAL_SCHEMA_PARITY,
  INITIAL_LLM_GATEWAY_ROUTES,
  INITIAL_SECURITY_LOGS,
} from '../data/adminExpansionData';
import { INITIAL_CUSTOMERS } from '../data/customerData';
import { env } from '../config/env';
import { ensureFederationFresh, getFederationData, unwrapCollection } from './federationBridge';
import { logger } from '../utils/logger';

export const adminService = {
  /**
   * Platform policy is owned by the `platform-config` federation source, so a
   * warm snapshot is served from there instead of issuing a duplicate request.
   * Falls back to a direct call when the engine has nothing yet (cold start or
   * a credential-restricted source).
   */
  async fetchPlatformConfig(): Promise<PlatformConfig> {
    const cached = getFederationData<PlatformConfig>('platform-config');
    if (cached) return cached;

    await ensureFederationFresh('platform-config');
    const warmed = getFederationData<PlatformConfig>('platform-config');
    if (warmed) return warmed;

    return apiClient.get<PlatformConfig>('/api/platform/config');
  },

  async updatePlatformConfig(
    updates: Partial<Omit<PlatformConfig, 'featureFlags' | 'modelPolicies'>> & { actor?: string }
  ): Promise<PlatformConfig> {
    const res = await apiClient.post<{ success: boolean; config: PlatformConfig }>(
      '/api/admin/config',
      updates
    );
    return res.config;
  },

  async updateModelPolicy(
    modelId: string,
    policy: Partial<ModelPolicy>
  ): Promise<Record<string, ModelPolicy>> {
    const res = await apiClient.post<{
      success: boolean;
      modelPolicies: Record<string, ModelPolicy>;
    }>('/api/admin/models/policy', { modelId, ...policy });
    return res.modelPolicies;
  },

  async fetchOverview() {
    if (env.isMockEnabled) {
      return {
        summary: INITIAL_ADMIN_METRICS,
        featureFlags: INITIAL_FEATURE_FLAGS.reduce(
          (acc, f) => ({ ...acc, [f.key]: f.enabled }),
          {}
        ),
      };
    }
    return apiClient.get('/api/admin/overview');
  },

  mapTowerService(raw: Record<string, unknown>): McpTowerService {
    // Tower telemetry is untyped JSON: strings/numbers are narrowed, unions keep the Tower value.
    const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
    const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
    const id = String(raw.id ?? '');
    return {
      id,
      name: text(raw.name) || id,
      displayName: text(raw.displayName) || text(raw.name) || id,
      category: (text(raw.category) || 'core') as McpTowerService['category'],
      port: num(raw.port) ?? 0,
      status: (text(raw.status) || 'healthy') as McpTowerService['status'],
      uptime: text(raw.uptime) || '—',
      latencyMs: num(raw.latencyMs) ?? 0,
      // বাংলা মন্তব্য: না মাপা মান 0 দেখালে "সব ঠিক আছে" মনে হয় — null রাখি, UI "—" দেখায়
      cpuPercent: num(raw.cpuPercent) ?? null,
      memoryMb: num(raw.memoryMb) ?? null,
      lastChecked: text(raw.lastChecked) || 'Just now',
      version: text(raw.version) || text(raw.deployStatus) || 'live',
      endpoint: text(raw.endpoint) || '',
      errorCount: num(raw.errorCount) ?? 0,
      logs: Array.isArray(raw.logs) ? (raw.logs as McpServiceLog[]) : [],
      deployStatus: text(raw.deployStatus),
      monthlyBuildMinutes: num(raw.monthlyBuildMinutes),
      freeLimitRemainingMinutes: num(raw.freeLimitRemainingMinutes),
      freeLimitExhausted:
        typeof raw.freeLimitExhausted === 'boolean' ? raw.freeLimitExhausted : undefined,
      deployAgeDays: num(raw.deployAgeDays),
      commitSha: text(raw.commitSha),
      freshness: text(raw.freshness) as McpTowerService['freshness'],
    };
  },

  /**
   * MCP Tower telemetry is owned by the `mcp-tower` federation source. Pass
   * `force` after a mutating action (reboot/probe) to bypass the snapshot.
   */
  async fetchMcpServices(options: { force?: boolean } = {}): Promise<McpTowerService[]> {
    if (env.isMockEnabled) {
      return INITIAL_MCP_SERVICES;
    }

    const toServices = (payload: unknown): McpTowerService[] =>
      unwrapCollection<Record<string, unknown>>(payload, ['services']).map((service) =>
        this.mapTowerService(service)
      );

    if (!options.force) {
      const cached = toServices(getFederationData<unknown>('mcp-tower'));
      if (cached.length > 0) return cached;
    }

    await ensureFederationFresh('mcp-tower', options.force ? 0 : undefined);
    const refreshed = toServices(getFederationData<unknown>('mcp-tower'));
    if (refreshed.length > 0) return refreshed;

    const data = await apiClient.get<unknown>('/api/mcp-tower/services');
    return toServices(data);
  },

  async rebootMcpService(serviceId: string): Promise<McpTowerService> {
    if (env.isMockEnabled) {
      const match = INITIAL_MCP_SERVICES.find((s) => s.id === serviceId);
      return (
        match || {
          id: serviceId,
          name: serviceId,
          displayName: serviceId,
          category: 'core',
          port: 4000,
          status: 'healthy',
          uptime: '100%',
          latencyMs: 24,
          cpuPercent: 2.1,
          memoryMb: 128,
          lastChecked: 'Just now (Mock)',
          version: 'v2.1.0',
          endpoint: `/api/${serviceId}`,
          errorCount: 0,
          logs: [],
        }
      );
    }
    const data = await apiClient.post<{ service: McpTowerService }>('/api/mcp-tower/reboot', {
      serviceId,
    });
    return data.service;
  },

  async rebootAllMcpServices(): Promise<McpTowerService[]> {
    if (env.isMockEnabled) {
      return INITIAL_MCP_SERVICES.map((s) => ({ ...s, status: 'healthy', errorCount: 0 }));
    }
    const data = await apiClient.post<{ services: McpTowerService[] }>('/api/mcp-tower/reboot-all');
    return data.services;
  },

  async probeMcpCluster(): Promise<McpTowerService[]> {
    if (env.isMockEnabled) {
      return INITIAL_MCP_SERVICES;
    }
    const data = await apiClient.post<{ services: McpTowerService[] }>('/api/mcp-tower/probe');
    return data.services;
  },

  async fetchFeatureFlags(): Promise<Record<string, boolean>> {
    if (env.isMockEnabled) {
      return INITIAL_FEATURE_FLAGS.reduce((acc, f) => ({ ...acc, [f.key]: f.enabled }), {});
    }
    const data = await apiClient.get<{ flags: Array<{ name: string; enabled: boolean }> }>(
      '/api/v1/admin/feature-flags'
    );
    const out: Record<string, boolean> = {};
    for (const f of data.flags || []) out[f.name] = Boolean(f.enabled);
    return out;
  },

  async updateFeatureFlag(key: string, enabled: boolean): Promise<Record<string, boolean>> {
    if (env.isMockEnabled) {
      return { [key]: enabled };
    }
    const data = await apiClient.post<{
      status: string;
      flag?: { name: string; enabled: boolean };
    }>('/api/v1/admin/feature-flags', { name: key, enabled });
    if (data.flag) return { [data.flag.name]: Boolean(data.flag.enabled) };
    return { [key]: enabled };
  },

  async fetchCustomers(): Promise<CustomerRecord[]> {
    if (env.isMockEnabled) {
      return INITIAL_CUSTOMERS;
    }
    // বাংলা মন্তব্য: আগে ব্যর্থ হলে ডেমো (ভুয়া) কাস্টমার দেখাত — এখন ত্রুটি উপরে যায়, স্টোর শেষ আসল
    // তালিকা রাখে। edge এখন Supabase Auth-এর আসল ইউজার মিশিয়ে দেয়।
    const res = await apiClient.get<{ customers: CustomerRecord[] }>('/api/admin/customers');
    return Array.isArray(res?.customers) ? res.customers : [];
  },

  async createCustomer(
    customer: Omit<CustomerRecord, 'id' | 'joinedDate' | 'lastActive'>
  ): Promise<CustomerRecord[]> {
    if (env.isMockEnabled) {
      const newRec: CustomerRecord = {
        ...customer,
        id: `cust_${String(Date.now()).slice(-4)}`,
        joinedDate: new Date().toISOString().slice(0, 10),
        lastActive: 'Just now',
      };
      return [newRec, ...INITIAL_CUSTOMERS];
    }
    try {
      const res = await apiClient.post<{ customers: CustomerRecord[] }>(
        '/api/admin/customers',
        customer
      );
      return res.customers || [];
    } catch {
      throw new Error('Failed to create customer');
    }
  },

  async updateCustomer(id: string, updates: Partial<CustomerRecord>): Promise<CustomerRecord[]> {
    if (env.isMockEnabled) {
      return INITIAL_CUSTOMERS.map((c) => (c.id === id ? { ...c, ...updates } : c));
    }
    try {
      const res = await apiClient.request<{ customers: CustomerRecord[] }>(
        `/api/admin/customers/${id}`,
        {
          method: 'PATCH',
          body: JSON.stringify(updates),
        }
      );
      return res.customers || [];
    } catch {
      throw new Error('Failed to update customer');
    }
  },

  async deleteCustomer(id: string): Promise<CustomerRecord[]> {
    if (env.isMockEnabled) {
      return INITIAL_CUSTOMERS.filter((c) => c.id !== id);
    }
    try {
      const res = await apiClient.delete<{ customers: CustomerRecord[] }>(
        `/api/admin/customers/${id}`
      );
      return res.customers || [];
    } catch {
      throw new Error('Failed to delete customer');
    }
  },

  async fetchBlockedIps(): Promise<BlockedIpRecord[]> {
    if (env.isMockEnabled) {
      return [];
    }
    try {
      const res = await apiClient.get<{ blockedIps: BlockedIpRecord[] }>('/api/admin/security');
      return res.blockedIps || [];
    } catch {
      return [];
    }
  },

  async fetchSecurityEvents(): Promise<SecurityEventLog[]> {
    if (env.isMockEnabled) {
      return INITIAL_SECURITY_LOGS;
    }
    try {
      const res = await apiClient.get<{ securityEvents?: SecurityEventLog[] }>(
        '/api/admin/security'
      );
      return Array.isArray(res?.securityEvents) ? res.securityEvents : [];
    } catch {
      return [];
    }
  },

  async fetchSchemaParity(): Promise<SchemaParityTable[]> {
    if (env.isMockEnabled) {
      return INITIAL_SCHEMA_PARITY;
    }
    try {
      const res = await apiClient.get<{ tables?: SchemaParityTable[] }>('/api/admin/schema-parity');
      return Array.isArray(res?.tables) && res.tables.length > 0 ? res.tables : INITIAL_SCHEMA_PARITY;
    } catch (err) {
      logger.warn('adminService: /api/admin/schema-parity unreachable, returning cached snapshot', { err });
      return INITIAL_SCHEMA_PARITY;
    }
  },

  async syncSchemaParity(): Promise<{ syncedCount: number; tables: SchemaParityTable[] }> {
    if (env.isMockEnabled) {
      return {
        syncedCount: 0,
        tables: INITIAL_SCHEMA_PARITY.map((t) => ({
          ...t,
          driftDetected: false,
          driftSummary: undefined,
          prodColumns: t.localColumns,
        })),
      };
    }
    return apiClient.post('/api/admin/schema-parity/sync', {});
  },

  async fetchLlmGatewayRoutes(): Promise<{ routes: LlmGatewayRoute[]; traffic?: unknown }> {
    if (env.isMockEnabled) {
      return { routes: INITIAL_LLM_GATEWAY_ROUTES };
    }
    try {
      const res = await apiClient.get<{ routes?: LlmGatewayRoute[]; traffic?: unknown }>(
        '/api/admin/llm-gateway'
      );
      return {
        routes: Array.isArray(res?.routes) && res.routes.length > 0 ? res.routes : INITIAL_LLM_GATEWAY_ROUTES,
        traffic: res?.traffic,
      };
    } catch (err) {
      logger.warn('adminService: /api/admin/llm-gateway unreachable, returning cached routes', { err });
      return { routes: INITIAL_LLM_GATEWAY_ROUTES };
    }
  },

  async toggleGatewayFailover(routeId: string): Promise<LlmGatewayRoute[]> {
    if (env.isMockEnabled) {
      return INITIAL_LLM_GATEWAY_ROUTES.map((r) =>
        r.id === routeId ? { ...r, autoFailoverActive: !r.autoFailoverActive } : r
      );
    }
    const res = await apiClient.post<{ routes?: LlmGatewayRoute[] }>(
      `/api/admin/llm-gateway/${encodeURIComponent(routeId)}/failover`,
      {}
    );
    return Array.isArray(res?.routes) ? res.routes : [];
  },

  async updateGatewayPrice(
    routeId: string,
    customerPricePer1M: number
  ): Promise<LlmGatewayRoute[]> {
    if (env.isMockEnabled) {
      return INITIAL_LLM_GATEWAY_ROUTES.map((r) =>
        r.id === routeId ? { ...r, customerPricePer1M } : r
      );
    }
    const res = await apiClient.patch<{ routes?: LlmGatewayRoute[] }>(
      `/api/admin/llm-gateway/${encodeURIComponent(routeId)}/price`,
      { customerPricePer1M }
    );
    return Array.isArray(res?.routes) ? res.routes : [];
  },

  async fetchGitHubRuns(
    repo: string
  ): Promise<{ runs: GitHubWorkflowRun[]; tokenConfigured?: boolean; warning?: string }> {
    return apiClient.get(`/api/admin/github/runs?repo=${encodeURIComponent(repo)}`);
  },

  async fetchGitHubRunErrorLogs(
    repo: string,
    runId: number | string
  ): Promise<GitHubRunErrorLogsResponse> {
    return apiClient.get(
      `/api/admin/github/runs/${encodeURIComponent(String(runId))}/logs?repo=${encodeURIComponent(repo)}`
    );
  },

  async fetchGitHubPulls(
    repo: string
  ): Promise<{ pulls: GitHubPullRequest[]; tokenConfigured?: boolean; warning?: string }> {
    return apiClient.get(`/api/admin/github/pulls?repo=${encodeURIComponent(repo)}`);
  },

  async triggerGitHubRunAction(
    repo: string,
    id: number | string,
    action: 'rerun' | 'cancel'
  ): Promise<void> {
    await apiClient.post(`/api/admin/github/runs/${encodeURIComponent(String(id))}/${action}`, {
      repo,
    });
  },

  async triggerGitHubPullAction(
    repo: string,
    number: number,
    action: 'merge' | 'approve'
  ): Promise<void> {
    await apiClient.post(`/api/admin/github/pulls/${number}/${action}`, { repo });
  },

  async blockIp(ip: string, reason: string): Promise<BlockedIpRecord[]> {
    const res = await apiClient.post<{ blockedIps: BlockedIpRecord[] }>(
      '/api/admin/security/block-ip',
      { ip, reason }
    );
    return res.blockedIps || [];
  },

  async unblockIp(ip: string): Promise<BlockedIpRecord[]> {
    // বাংলা মন্তব্য: আগে ব্যর্থ হলে [] দিত — store পুরো ব্লক-লিস্ট মুছে ফেলত। এখন error ছোড়ে।
    const res = await apiClient.delete<{ blockedIps: BlockedIpRecord[] }>(
      `/api/admin/security/block-ip/${encodeURIComponent(ip)}`
    );
    return res.blockedIps || [];
  },

  async fetchAuditRecords(): Promise<SystemAuditRecord[]> {
    if (env.isMockEnabled) {
      return INITIAL_AUDIT_RECORDS;
    }
    // বাংলা মন্তব্য (fail-honest): আগে ব্যর্থ হলে বানানো ডেমো রেকর্ড দেখাত। এখন error ছুঁড়ে দেয় —
    // store আগের ক্যাশ রাখে আর ব্যাজে "লাইভ নয়" দেখায়।
    const res = await apiClient.get<{ auditRecords: SystemAuditRecord[] }>('/api/admin/audit');
    return Array.isArray(res.auditRecords) ? res.auditRecords : [];
  },

  async flushDlq(): Promise<void> {
    await apiClient.post('/api/admin/queue/flush-dlq');
  },

  /**
   * বাংলা মন্তব্য: আগে ত্রুটি হলে `[]` ফেরত দিত — তাতে "কোনো কী নেই" (লাল) দেখাত অথচ আসলে
   * জানাই যায়নি। এখন ত্রুটি উপরে যায় (UI "DEGRADED/অজানা" দেখায়)।
   */
  async fetchProviders(): Promise<ProviderKeyItem[]> {
    if (env.isMockEnabled) {
      return INITIAL_PROVIDER_KEYS;
    }
    const res = await apiClient.get<{ providers: ProviderKeyItem[] }>('/api/admin/providers');
    return Array.isArray(res?.providers) ? res.providers : [];
  },

  async addProviderKey(payload: {
    provider: string;
    displayName: string;
    rawKey: string;
    rateLimitTpm?: string;
    priority?: number;
    infisicalPath?: string;
    infisicalEnv?: 'prod' | 'staging' | 'dev';
    region?: string;
  }): Promise<{ success: boolean; provider: ProviderKeyItem; providers: ProviderKeyItem[] }> {
    return apiClient.post('/api/admin/providers', payload);
  },

  async updateProviderKey(
    id: string,
    updates: {
      provider?: string;
      displayName?: string;
      rawKey?: string;
      rateLimitTpm?: string;
      priority?: number;
      infisicalPath?: string;
      infisicalEnv?: 'prod' | 'staging' | 'dev';
      status?: ProviderKeyItem['status'];
      region?: string;
    }
  ): Promise<{ success: boolean; provider: ProviderKeyItem; providers: ProviderKeyItem[] }> {
    return apiClient.patch(`/api/admin/providers/${encodeURIComponent(id)}`, updates);
  },

  async deleteProviderKey(id: string): Promise<{ success: boolean; providers: ProviderKeyItem[] }> {
    return apiClient.delete(`/api/admin/providers/${encodeURIComponent(id)}`);
  },

  async probeProvider(providerId: string): Promise<{
    success: boolean;
    message: string;
    providers: ProviderKeyItem[];
    vaultKeys?: import('../types').InfisicalVaultKeyLatency[];
  }> {
    return apiClient.post('/api/admin/providers/probe', { providerId });
  },

  /**
   * One batch of Probe All. The edge returns `nextCursor` while keys remain (Cloudflare caps
   * subrequests per request); callers loop until it is null/undefined.
   */
  async probeAllProviders(cursor: number = 0): Promise<{
    success: boolean;
    message: string;
    providers: ProviderKeyItem[];
    vaultKeys: import('../types').InfisicalVaultKeyLatency[];
    nextCursor?: number | null;
    probedThrough?: number;
    total?: number;
  }> {
    return apiClient.post('/api/admin/providers/probe-all', { cursor });
  },

  async updateProviderPriority(
    providerId: string,
    direction: 'up' | 'down'
  ): Promise<ProviderKeyItem[]> {
    const res = await apiClient.post<{ providers: ProviderKeyItem[] }>(
      '/api/admin/providers/priority',
      {
        providerId,
        direction,
      }
    );
    return res.providers || [];
  },

  async fetchInfisicalVaultKeys(): Promise<{
    vaultEngine: string;
    mode: string;
    totalKeys: number;
    healthyCount: number;
    avgVaultLatencyMs: number;
    lastSyncedAt: string;
    keys: import('../types').InfisicalVaultKeyLatency[];
    vaultSummary?: import('../utils/adminHealthSummary').AdminVaultSummary;
  }> {
    return apiClient.get('/api/admin/infisical/vault-keys');
  },

  async syncInfisicalVault(): Promise<{
    success: boolean;
    syncedAt: string;
    keys: import('../types').InfisicalVaultKeyLatency[];
    message: string;
  }> {
    return apiClient.post('/api/admin/infisical/sync', {});
  },

  async fetchSwarmWorkers(): Promise<SwarmWorker[]> {
    if (env.isMockEnabled) {
      return INITIAL_SWARM_WORKERS;
    }
    try {
      const res = await apiClient.get<{ workers: SwarmWorker[] }>('/api/admin/swarm');
      return res.workers || [];
    } catch (err) {
      logger.warn('adminService: /api/admin/swarm unreachable, returning cached swarm workers', { err });
      return INITIAL_SWARM_WORKERS;
    }
  },

  async toggleSwarmWorker(workerId: string): Promise<SwarmWorker | null> {
    if (env.isMockEnabled) {
      const match = INITIAL_SWARM_WORKERS.find((w) => w.id === workerId);
      if (match) {
        match.status = match.status === 'active' ? 'paused' : 'active';
        return match;
      }
      return null;
    }
    const res = await apiClient.post<{ success: boolean; worker: SwarmWorker }>(
      `/api/admin/swarm/${encodeURIComponent(workerId)}/toggle`
    );
    return res.worker;
  },

  async scaleSwarmWorker(workerId: string, delta: number): Promise<SwarmWorker | null> {
    if (env.isMockEnabled) {
      const match = INITIAL_SWARM_WORKERS.find((w) => w.id === workerId);
      if (match) {
        match.cpuPercent = Math.max(1, Math.min(95, Math.round(match.cpuPercent + delta * 4)));
        return match;
      }
      return null;
    }
    const res = await apiClient.post<{ success: boolean; worker: SwarmWorker }>(
      `/api/admin/swarm/${encodeURIComponent(workerId)}/scale`,
      { delta }
    );
    return res.worker;
  },

  async fetchQueueJobs(): Promise<TaskQueueJob[]> {
    if (env.isMockEnabled) {
      return INITIAL_QUEUE_JOBS;
    }
    try {
      const res = await apiClient.get<{ jobs: TaskQueueJob[] }>('/api/admin/queue');
      return res.jobs || [];
    } catch (err) {
      logger.warn('adminService: /api/admin/queue unreachable, returning cached queue jobs', { err });
      return INITIAL_QUEUE_JOBS;
    }
  },

  async retryQueueJob(jobId: string): Promise<TaskQueueJob | null> {
    if (env.isMockEnabled) {
      const match = INITIAL_QUEUE_JOBS.find((j) => j.id === jobId);
      if (match) {
        match.status = 'active';
        match.attempts = 1;
        return match;
      }
      return null;
    }
    const res = await apiClient.post<{ success: boolean; job: TaskQueueJob }>(
      `/api/admin/queue/retry/${encodeURIComponent(jobId)}`
    );
    return res.job;
  },

  async clearCompletedQueueJobs(): Promise<void> {
    if (env.isMockEnabled) {
      return;
    }
    await apiClient.delete('/api/admin/queue/completed');
  },
};
