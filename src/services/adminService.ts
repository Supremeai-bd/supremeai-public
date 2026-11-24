import { apiClient } from './apiClient';
import type { GitHubRunErrorLogsResponse } from '../utils/githubPipelineMetrics';
import {
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

  mapTowerService(raw: any): McpTowerService {
    return {
      id: raw.id,
      name: raw.name || raw.id,
      displayName: raw.displayName || raw.name || raw.id,
      category: raw.category || 'core',
      port: typeof raw.port === 'number' ? raw.port : 0,
      status: raw.status || 'healthy',
      uptime: raw.uptime || '—',
      latencyMs: typeof raw.latencyMs === 'number' ? raw.latencyMs : 0,
      cpuPercent: typeof raw.cpuPercent === 'number' ? raw.cpuPercent : 0,
      memoryMb: typeof raw.memoryMb === 'number' ? raw.memoryMb : 0,
      lastChecked: raw.lastChecked || 'Just now',
      version: raw.version || raw.deployStatus || 'live',
      endpoint: raw.endpoint || '',
      errorCount: typeof raw.errorCount === 'number' ? raw.errorCount : 0,
      logs: Array.isArray(raw.logs) ? raw.logs : [],
      deployStatus: raw.deployStatus,
      monthlyBuildMinutes: raw.monthlyBuildMinutes,
      freeLimitRemainingMinutes: raw.freeLimitRemainingMinutes,
      freeLimitExhausted: raw.freeLimitExhausted,
      deployAgeDays: raw.deployAgeDays,
      commitSha: raw.commitSha,
      freshness: raw.freshness,
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

    const data = await apiClient.get<{ services: any[] }>('/api/mcp-tower/services');
    return (data.services || []).map((s) => this.mapTowerService(s));
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
    try {
      const res = await apiClient.get<{ customers: CustomerRecord[] }>('/api/admin/customers');
      return res.customers || [];
    } catch (err) {
      logger.warn('adminService: /api/admin/customers unreachable, returning fallback snapshot', { err });
      return INITIAL_CUSTOMERS;
    }
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

  async fetchLlmGatewayRoutes(): Promise<{ routes: LlmGatewayRoute[]; traffic?: any }> {
    if (env.isMockEnabled) {
      return { routes: INITIAL_LLM_GATEWAY_ROUTES };
    }
    try {
      const res = await apiClient.get<{ routes?: LlmGatewayRoute[]; traffic?: any }>(
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
  ): Promise<{ runs: any[]; tokenConfigured?: boolean; warning?: string }> {
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
  ): Promise<{ pulls: any[]; tokenConfigured?: boolean; warning?: string }> {
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
    try {
      const res = await apiClient.post<{ blockedIps: BlockedIpRecord[] }>(
        '/api/admin/security/block-ip',
        {
          ip,
          reason,
        }
      );
      return res.blockedIps || [];
    } catch {
      throw new Error('Failed to block IP');
    }
  },

  async unblockIp(ip: string): Promise<BlockedIpRecord[]> {
    try {
      const res = await apiClient.delete<{ blockedIps: BlockedIpRecord[] }>(
        `/api/admin/security/block-ip/${encodeURIComponent(ip)}`
      );
      return res.blockedIps || [];
    } catch {
      return [];
    }
  },

  async fetchAuditRecords(): Promise<SystemAuditRecord[]> {
    if (env.isMockEnabled) {
      return INITIAL_AUDIT_RECORDS;
    }
    try {
      const res = await apiClient.get<{ auditRecords: SystemAuditRecord[] }>('/api/admin/audit');
      return res.auditRecords || [];
    } catch (err) {
      logger.warn('adminService: /api/admin/audit unreachable, returning cached audit records', { err });
      return INITIAL_AUDIT_RECORDS;
    }
  },

  async flushDlq(): Promise<void> {
    try {
      await apiClient.post('/api/admin/queue/flush-dlq');
    } catch (error) {
      logger.debug('adminService: suppressed non-fatal error', error);
    }
  },

  async fetchProviders(): Promise<ProviderKeyItem[]> {
    if (env.isMockEnabled) {
      return INITIAL_PROVIDER_KEYS;
    }
    try {
      const res = await apiClient.get<{ providers: ProviderKeyItem[] }>('/api/admin/providers');
      return res.providers || [];
    } catch {
      return [];
    }
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

  async probeAllProviders(): Promise<{
    success: boolean;
    message: string;
    providers: ProviderKeyItem[];
    vaultKeys: import('../types').InfisicalVaultKeyLatency[];
  }> {
    return apiClient.post('/api/admin/providers/probe-all', {});
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
    try {
      const res = await apiClient.post<{ success: boolean; worker: SwarmWorker }>(
        `/api/admin/swarm/${encodeURIComponent(workerId)}/toggle`
      );
      return res.worker;
    } catch {
      return null;
    }
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
    try {
      const res = await apiClient.post<{ success: boolean; worker: SwarmWorker }>(
        `/api/admin/swarm/${encodeURIComponent(workerId)}/scale`,
        { delta }
      );
      return res.worker;
    } catch {
      return null;
    }
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
    try {
      const res = await apiClient.post<{ success: boolean; job: TaskQueueJob }>(
        `/api/admin/queue/retry/${encodeURIComponent(jobId)}`
      );
      return res.job;
    } catch {
      return null;
    }
  },

  async clearCompletedQueueJobs(): Promise<void> {
    if (env.isMockEnabled) {
      return;
    }
    try {
      await apiClient.delete('/api/admin/queue/completed');
    } catch (error) {
      logger.debug('adminService: suppressed non-fatal error', error);
    }
  },
};
