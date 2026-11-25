/**
 * SupremeAI Federation Live-Data Source Registry
 *
 * Single source of truth for every real backend surface the Studio satellite
 * synchronises with. Paths mirror the live FastAPI mounts in
 * `Supremeai-bd/supremeai` (`core/api/**`, `gateway/**`) exactly — no invented
 * routes, no provider-specific model identifiers, no static catalogue copies.
 *
 * Sync policy (see docs/LIVE_DATA_SYNC.md):
 *  - Every source declares its own cadence, auth class and staleness budget.
 *  - Same-origin only (`/api/*`), so the Cloudflare `functions/api/[[path]].ts`
 *    reverse proxy and the Express dev server can both forward without CORS.
 *  - Sources are fail-open: a missing/unauthorised endpoint never blocks chat,
 *    voice or workspace features, it only marks that row as degraded.
 */

export type FederationSourceGroup =
  'pulse' | 'gateway' | 'ecosystem' | 'agents' | 'memory' | 'infrastructure' | 'workspace';

/** 4-Tier Importance Architecture */
export type FederationImportanceTier = 1 | 2 | 3 | 4;

export interface FederationTierMeta {
  tier: FederationImportanceTier;
  id: string;
  labelKey: string;
  descKey: string;
  badgeKey: string;
  slaKey: string;
  accent: 'emerald' | 'blue' | 'violet' | 'slate';
  icon: 'zap' | 'gauge' | 'bot' | 'server';
}

export const FEDERATION_TIERS: FederationTierMeta[] = [
  {
    tier: 1,
    id: 'tier-1',
    labelKey: 'syncTier1Title',
    descKey: 'syncTier1Desc',
    badgeKey: 'syncTierBadgeCore',
    slaKey: 'syncTier1Sla',
    accent: 'emerald',
    icon: 'zap',
  },
  {
    tier: 2,
    id: 'tier-2',
    labelKey: 'syncTier2Title',
    descKey: 'syncTier2Desc',
    badgeKey: 'syncTierBadgeUx',
    slaKey: 'syncTier2Sla',
    accent: 'blue',
    icon: 'gauge',
  },
  {
    tier: 3,
    id: 'tier-3',
    labelKey: 'syncTier3Title',
    descKey: 'syncTier3Desc',
    badgeKey: 'syncTierBadgeTools',
    slaKey: 'syncTier3Sla',
    accent: 'violet',
    icon: 'bot',
  },
  {
    tier: 4,
    id: 'tier-4',
    labelKey: 'syncTier4Title',
    descKey: 'syncTier4Desc',
    badgeKey: 'syncTierBadgeAutoOps',
    slaKey: 'syncTier4Sla',
    accent: 'slate',
    icon: 'server',
  },
];

/** Auth class required by the upstream route. */
export type FederationAuthClass = 'public' | 'key' | 'user' | 'admin';

/** Where the endpoint is actually served from in this deployment. */
export type FederationOrigin = 'studio' | 'federation';

export interface FederationMetricSpec {
  /** Dot-path into the response payload, e.g. `squad.total_healthy_keys`. */
  path: string;
  label: string;
  unit?: string;
}

export interface FederationSource {
  /** Stable slug used in storage keys, events and URLs. */
  id: string;
  /** Importance tier (1: Core, 2: UX & Speed, 3: Tools & Skills, 4: Auto-Ops). */
  tier: FederationImportanceTier;
  /** Human feature name — also the label used in the feature-coverage matrix. */
  feature: string;
  label: string;
  description: string;
  group: FederationSourceGroup;
  /** Canonical upstream path, always same-origin relative. */
  path: string;
  /** Where the route is mounted today. */
  origin: FederationOrigin;
  /** Preferred polling cadence in milliseconds. */
  intervalMs: number;
  timeoutMs: number;
  auth: FederationAuthClass;
  /**
   * `true` when a 401/403 is an expected state (operator-only surface) rather
   * than a sync failure. The row renders as "Sign-in required" instead of red.
   */
  optional?: boolean;
  /** Keys that may hold a collection inside an object envelope. */
  collectionKeys?: string[];
  /** KPI chips shown on the source card + inspector. */
  metrics?: FederationMetricSpec[];
  /** Backend module that owns the route (shown in the inspector). */
  backendModule: string;
}

export const FEDERATION_REPO = 'Supremeai-bd/supremeai';
export const FEDERATION_STUDIO_REPO = 'Supremeai-bd/supremeai-public';

export const SOURCE_GROUP_META: Record<
  FederationSourceGroup,
  { label: string; description: string; accent: string; icon: string }
> = {
  pulse: {
    label: 'Runtime Pulse',
    description: 'Health, status and platform policy straight from the FastAPI core.',
    accent: 'emerald',
    icon: 'pulse',
  },
  gateway: {
    label: 'Gateway & Models',
    description: 'Live model catalogue, adaptive route latency and provider pool health.',
    accent: 'blue',
    icon: 'cpu',
  },
  ecosystem: {
    label: 'Ecosystem Plane',
    description: 'Capability registry, tasks, resources and deployment provenance.',
    accent: 'violet',
    icon: 'network',
  },
  agents: {
    label: 'Agents & Governance',
    description: 'Registered agents, HITL approval queue and the skill graph.',
    accent: 'amber',
    icon: 'bot',
  },
  memory: {
    label: 'Memory & Evolution',
    description: 'Tiered memory fabric statistics and autonomous evolution cycles.',
    accent: 'fuchsia',
    icon: 'brain',
  },
  infrastructure: {
    label: 'Infrastructure',
    description: 'MCP Tower cluster services and edge telemetry.',
    accent: 'cyan',
    icon: 'server',
  },
  workspace: {
    label: 'Workspace',
    description: 'Conversation archive and user-scoped workspace records.',
    accent: 'slate',
    icon: 'folder',
  },
};

export const FEDERATION_SOURCES: FederationSource[] = [
  // ---------------------------------------------------------------- Tier 1: Core / Pulse
  {
    id: 'health-core',
    tier: 1,
    feature: 'Runtime Health',
    label: 'Core Health',
    description: 'Comprehensive FastAPI health vector with uptime and component state.',
    group: 'pulse',
    path: '/api/v1/health',
    origin: 'federation',
    intervalMs: 12_000,
    timeoutMs: 11_000,
    auth: 'public',
    metrics: [
      { path: 'status', label: 'Status' },
      { path: 'version', label: 'Version' },
      { path: 'uptime_seconds', label: 'Uptime', unit: 's' },
    ],
    backendModule: 'core/api/server.py',
  },
  {
    id: 'health-studio',
    tier: 1,
    feature: 'Edge Runtime',
    label: 'Studio Edge',
    description: 'Satellite edge server identity, version and bundled catalogue counts.',
    group: 'pulse',
    path: '/api/health',
    origin: 'studio',
    intervalMs: 15_000,
    timeoutMs: 6_000,
    auth: 'public',
    metrics: [
      { path: 'status', label: 'Status' },
      { path: 'version', label: 'Version' },
      { path: 'modelsCount', label: 'Models' },
    ],
    backendModule: 'server.ts',
  },
  {
    id: 'health-liveness',
    tier: 1,
    feature: 'Liveness Probe',
    label: 'Liveness',
    description: 'Ultra-cheap liveness probe used for connectivity detection.',
    group: 'pulse',
    path: '/api/v1/health/live',
    origin: 'federation',
    intervalMs: 20_000,
    timeoutMs: 11_000,
    auth: 'public',
    backendModule: 'core/api/routes/health.py',
  },
  {
    id: 'platform-config',
    tier: 2,
    feature: 'Platform Policy',
    label: 'Platform Config',
    description: 'Maintenance mode, announcement banner and feature-flag policy.',
    group: 'pulse',
    path: '/api/platform/config',
    origin: 'federation',
    intervalMs: 60_000,
    timeoutMs: 11_000,
    auth: 'key',
    optional: true,
    backendModule: 'gateway/service/app.py',
  },
  {
    id: 'system-status',
    tier: 2,
    feature: 'System Status',
    label: 'Subsystem Status',
    description: 'Full integrator status across every initialised subsystem.',
    group: 'pulse',
    path: '/api/v1/status',
    origin: 'federation',
    intervalMs: 25_000,
    timeoutMs: 11_000,
    auth: 'user',
    optional: true,
    backendModule: 'core/api/server.py',
  },
  {
    id: 'dashboard',
    tier: 2,
    feature: 'Dashboard Telemetry',
    label: 'Dashboard Snapshot',
    description: 'Authoritative monitoring snapshot for the control-centre KPIs.',
    group: 'pulse',
    path: '/api/v1/dashboard',
    origin: 'federation',
    intervalMs: 30_000,
    timeoutMs: 11_000,
    auth: 'user',
    optional: true,
    collectionKeys: ['services', 'components', 'workers'],
    backendModule: 'core/api/server.py',
  },

  // ---------------------------------------------------------------- Gateway
  {
    id: 'models',
    tier: 1,
    feature: 'Model Catalogue',
    label: 'SupremeAI Models',
    description: 'Native SupremeAI model slugs served by the gateway route arbiter.',
    group: 'gateway',
    path: '/api/models',
    origin: 'studio',
    intervalMs: 90_000,
    timeoutMs: 10_000,
    auth: 'public',
    collectionKeys: ['models'],
    metrics: [
      { path: 'defaultModel', label: 'Default' },
      { path: 'source', label: 'Catalog source' },
    ],
    backendModule: 'server.ts · gateway/main.py',
  },
  {
    id: 'gateway-latency',
    tier: 2,
    feature: 'Gateway Latency',
    label: 'Adaptive Latency',
    description: 'Per-route latency, key-pool health and cache hit telemetry.',
    group: 'gateway',
    path: '/api/v1/telemetry/latency',
    origin: 'federation',
    intervalMs: 15_000,
    timeoutMs: 11_000,
    auth: 'key',
    optional: true,
    collectionKeys: ['routes'],
    metrics: [
      { path: 'squad.total_healthy_keys', label: 'Healthy keys' },
      { path: 'squad.total_keys', label: 'Keys' },
      { path: 'cache.hits', label: 'Cache hits' },
    ],
    backendModule: 'gateway/service/app.py',
  },
  {
    id: 'router-live-state',
    tier: 4,
    feature: 'Route Arbiter',
    label: 'Router Live State',
    description: 'DynamicRouteArbiter live state — active slots, cooldowns and scoring.',
    group: 'gateway',
    path: '/api/v1/admin/router/live-state',
    origin: 'federation',
    intervalMs: 10_000,
    timeoutMs: 11_000,
    auth: 'key',
    optional: true,
    collectionKeys: ['routes', 'slots', 'providers'],
    backendModule: 'gateway/service/app.py',
  },
  {
    id: 'provider-health',
    tier: 2,
    feature: 'Provider Mesh',
    label: 'Provider Health',
    description: 'Aggregated upstream provider probe results and criticality flags.',
    group: 'gateway',
    path: '/api/health-aggregation',
    origin: 'federation',
    intervalMs: 45_000,
    timeoutMs: 11_000,
    auth: 'public',
    collectionKeys: ['providers', 'results', 'checks'],
    backendModule: 'core/api/routes/health_aggregation.py',
  },

  // ---------------------------------------------------------------- Ecosystem
  {
    id: 'ecosystem-health',
    tier: 3,
    feature: 'Ecosystem Health',
    label: 'Composite Health',
    description: 'Composite ecosystem status across resources plus top memory consumers.',
    group: 'ecosystem',
    path: '/api/v1/ecosystem/health',
    origin: 'federation',
    intervalMs: 30_000,
    timeoutMs: 11_000,
    auth: 'public',
    collectionKeys: ['resources', 'top_memory'],
    metrics: [{ path: 'composite', label: 'Composite' }],
    backendModule: 'core/api/routes/ecosystem.py',
  },
  {
    id: 'capabilities',
    tier: 3,
    feature: 'Capability Registry',
    label: 'Capabilities',
    description: 'REUSE > ADAPT > EXTEND > CREATE capability registry with lifecycle state.',
    group: 'ecosystem',
    path: '/api/v1/ecosystem/capabilities',
    origin: 'federation',
    intervalMs: 90_000,
    timeoutMs: 11_000,
    auth: 'public',
    collectionKeys: ['capabilities', 'items'],
    backendModule: 'core/api/routes/ecosystem.py',
  },
  {
    id: 'ecosystem-tasks',
    tier: 3,
    feature: 'Autonomous Tasks',
    label: 'Task Engine',
    description: 'Durable goals with owner, scope, risk level and lifecycle state.',
    group: 'ecosystem',
    path: '/api/v1/ecosystem/tasks',
    origin: 'federation',
    intervalMs: 25_000,
    timeoutMs: 11_000,
    auth: 'public',
    collectionKeys: ['tasks', 'items'],
    backendModule: 'core/api/routes/ecosystem.py',
  },
  {
    id: 'deployments',
    tier: 4,
    feature: 'Deployment Provenance',
    label: 'Deployments',
    description: 'Commit-to-resource deployment trace records from the release tracker.',
    group: 'ecosystem',
    path: '/api/v1/ecosystem/deployments',
    origin: 'federation',
    intervalMs: 90_000,
    timeoutMs: 11_000,
    auth: 'public',
    collectionKeys: ['deployments', 'items'],
    backendModule: 'core/api/routes/ecosystem.py',
  },
  {
    id: 'resources',
    tier: 3,
    feature: 'Resource Registry',
    label: 'Resources',
    description: 'Registered cloud resources, providers, regions and dependencies.',
    group: 'ecosystem',
    path: '/api/v1/ecosystem/resources',
    origin: 'federation',
    intervalMs: 90_000,
    timeoutMs: 11_000,
    auth: 'public',
    collectionKeys: ['resources', 'items'],
    backendModule: 'core/api/routes/ecosystem.py',
  },
  {
    id: 'mcp-manifest',
    tier: 3,
    feature: 'MCP Manifest',
    label: 'MCP Manifest',
    description: 'Ecosystem MCP skeleton manifest — the tool surface exposed to agents.',
    group: 'ecosystem',
    path: '/api/v1/ecosystem/mcp/manifest',
    origin: 'federation',
    intervalMs: 120_000,
    timeoutMs: 11_000,
    auth: 'public',
    collectionKeys: ['tools', 'operations'],
    backendModule: 'core/api/routes/ecosystem.py',
  },

  // ---------------------------------------------------------------- Agents
  {
    id: 'agents',
    tier: 1,
    feature: 'Agent Registry',
    label: 'Registered Agents',
    description: 'Agent role + provider records consumed by every agent dropdown.',
    group: 'agents',
    path: '/api/v1/agents',
    origin: 'federation',
    intervalMs: 30_000,
    timeoutMs: 11_000,
    auth: 'public',
    collectionKeys: ['agents', 'items'],
    backendModule: 'core/api/routes/agent_registry.py',
  },
  {
    id: 'hitl-pending',
    tier: 4,
    feature: 'HITL Approvals',
    label: 'Approval Queue',
    description: 'Human-in-the-loop pending approvals requiring operator sign-off.',
    group: 'agents',
    path: '/api/v1/hitl/pending',
    origin: 'federation',
    intervalMs: 15_000,
    timeoutMs: 11_000,
    auth: 'admin',
    optional: true,
    collectionKeys: ['pending', 'tickets', 'items'],
    metrics: [{ path: 'count', label: 'Pending' }],
    backendModule: 'core/api/routes/hitl_admin.py',
  },
  {
    id: 'skills-graph',
    tier: 3,
    feature: 'Skill Graph',
    label: 'Skill Graph',
    description: 'Skill-to-capability graph edges powering agent capability discovery.',
    group: 'agents',
    path: '/api/v1/graph/skills',
    origin: 'federation',
    intervalMs: 120_000,
    timeoutMs: 11_000,
    auth: 'public',
    backendModule: 'core/api/routes/graph.py',
  },

  // ---------------------------------------------------------------- Memory
  {
    id: 'memory-stats',
    tier: 4,
    feature: 'Memory Fabric',
    label: 'Memory Stats',
    description: 'Working / episodic / semantic tier occupancy and consolidation size.',
    group: 'memory',
    path: '/api/v1/memory/stats',
    origin: 'federation',
    intervalMs: 30_000,
    timeoutMs: 11_000,
    auth: 'user',
    optional: true,
    metrics: [
      { path: 'total_entries', label: 'Blocks' },
      { path: 'working_memory', label: 'Working' },
      { path: 'semantic_nodes', label: 'Semantic' },
    ],
    backendModule: 'core/api/server.py',
  },
  {
    id: 'evolution',
    tier: 4,
    feature: 'Auto-Evolution',
    label: 'Evolution Cycles',
    description: 'Autonomous evolution loop statistics and recent improvement cycles.',
    group: 'memory',
    path: '/api/v1/evolution/status',
    origin: 'federation',
    intervalMs: 60_000,
    timeoutMs: 11_000,
    auth: 'user',
    optional: true,
    collectionKeys: ['recent_cycles'],
    metrics: [
      { path: 'total_cycles', label: 'Cycles' },
      { path: 'successful_cycles', label: 'Successful' },
    ],
    backendModule: 'core/api/server.py',
  },

  // ---------------------------------------------------------------- Infrastructure
  {
    id: 'mcp-tower',
    tier: 4,
    feature: 'MCP Tower Cluster',
    label: 'Tower Services',
    description: 'Federated MCP service mesh health, latency, CPU and memory per node.',
    group: 'infrastructure',
    path: '/api/mcp-tower/services',
    origin: 'studio',
    intervalMs: 12_000,
    timeoutMs: 8_000,
    auth: 'public',
    collectionKeys: ['services'],
    backendModule: 'server.ts · infrastructure/mcp-control-plane',
  },

  // ---------------------------------------------------------------- Workspace
  {
    id: 'conversations',
    tier: 2,
    feature: 'Conversation Archive',
    label: 'Conversations',
    description: 'User-scoped conversation records from the persistence layer.',
    group: 'workspace',
    path: '/api/v1/conversations',
    origin: 'federation',
    intervalMs: 60_000,
    timeoutMs: 11_000,
    auth: 'user',
    optional: true,
    collectionKeys: ['conversations', 'items', 'data'],
    backendModule: 'core/api/routes/conversations.py',
  },
];

export const FEDERATION_SOURCE_MAP: Record<string, FederationSource> = FEDERATION_SOURCES.reduce(
  (acc, source) => {
    acc[source.id] = source;
    return acc;
  },
  {} as Record<string, FederationSource>
);

export const FEDERATION_GROUPS: FederationSourceGroup[] = [
  'pulse',
  'gateway',
  'ecosystem',
  'agents',
  'memory',
  'infrastructure',
  'workspace',
];

export function getSourcesByGroup(group: FederationSourceGroup): FederationSource[] {
  return FEDERATION_SOURCES.filter((source) => source.group === group);
}

export function getSourcesByTier(tier: FederationImportanceTier): FederationSource[] {
  return FEDERATION_SOURCES.filter((source) => source.tier === tier);
}

const ACCESS_TOKEN_KEY = 'supremeai_access_token';
const AUTH_USER_KEY = 'supremeai_auth_user';
const ADMIN_TOKEN_KEY = 'supremeai_admin_token';

function readAccessToken(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const direct = localStorage.getItem(ACCESS_TOKEN_KEY);
    if (direct) return direct;
    const raw = localStorage.getItem(AUTH_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.token === 'string' ? parsed.token : null;
  } catch {
    return null;
  }
}

function readAdminToken(): string | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Resolve auth headers for a source. Returning `null` means the source cannot
 * be polled yet (no credential of the required class) — the engine marks it
 * `restricted` without issuing a doomed network call.
 */
export function resolveFederationAuthHeaders(
  source: FederationSource
): Record<string, string> | null {
  const accessToken = readAccessToken();

  switch (source.auth) {
    case 'public':
      return {};
    case 'key': {
      if (!accessToken) return null;
      return { Authorization: `Bearer ${accessToken}`, 'X-SupremeAI-Key': accessToken };
    }
    case 'user': {
      if (!accessToken) return null;
      return { Authorization: `Bearer ${accessToken}`, 'X-SupremeAI-Key': accessToken };
    }
    case 'admin': {
      const adminToken = readAdminToken();
      if (!accessToken && !adminToken) return null;
      const headers: Record<string, string> = {};
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
        headers['X-SupremeAI-Key'] = accessToken;
      }
      if (adminToken) headers['X-Admin-Token'] = adminToken;
      return headers;
    }
    default:
      return {};
  }
}

/**
 * Resolve the same-origin URL for a source.
 * `apiBaseUrl` is empty by default so paths stay same-origin and flow through
 * the Cloudflare Pages proxy (production) or the Express edge (local/preview).
 */
export function resolveFederationUrl(source: FederationSource, apiBaseUrl = ''): string {
  let base = apiBaseUrl.trim().replace(/\/+$/, '');
  const path = source.path.startsWith('/') ? source.path : `/${source.path}`;
  if (base.endsWith('/api') && path.startsWith('/api/')) {
    base = base.slice(0, -4);
  }
  return `${base}${path}`;
}

/** True when the source needs a credential that is not currently available. */
export function isSourceCredentialMissing(source: FederationSource): boolean {
  if (source.auth === 'public') return false;
  if (source.auth === 'admin') return !readAccessToken() && !readAdminToken();
  return !readAccessToken();
}
