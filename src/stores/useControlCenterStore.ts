import { create } from 'zustand';
import { controlCenterService } from '../services/controlCenterService';
import { EXTERNAL_URLS } from '../config/externalUrls';
import { toast } from './useToastStore';
import type {
  ControlPlaneSafetyMode,
  SafetyGateContext,
  DataProvenance,
  DeepDiagnoseReport,
  McpToolDescriptor,
  McpToolExecutionResult,
  ReleaseVerificationItem,
  HarnessPipelineRun,
  HitlTicket,
  RemediationDagPlan,
  ExecutionPolicyRule,
  ActiveTakeoverSession,
  AutoHealerIncident,
  MemoryGovernanceEntry,
  QdrantCollectionStats,
  AstGraphMatch,
  ExternalAgentRecord,
  BridgeWorkOrder,
  KaggleKernelRun,
  DevToolsAuditReport,
  CrawlerJob,
  TelegramDispatchRecord,
  CronTaskItem,
  FinOpsMeshService,
  McpHealthMonitorSnapshot,
  ProactiveHealthThresholds,
  GatewayTrafficPoint,
  EcosystemDiagnosticsReport,
} from '../types/controlCenter';

export interface SafetyGatePrompt {
  title: string;
  description: string;
  impactSummary: string;
  riskLevel: 'medium' | 'high' | 'critical';
  onExecute: (gate: SafetyGateContext) => Promise<void>;
}

const VALID_PROVENANCES = new Set<DataProvenance>([
  'live-mcp',
  'live-gateway',
  'live-github',
  'local-snapshot',
]);

export function normalizeProvenance(
  value: unknown,
  fallback: DataProvenance = 'local-snapshot'
): DataProvenance {
  if (typeof value === 'string' && VALID_PROVENANCES.has(value as DataProvenance)) {
    return value as DataProvenance;
  }
  return fallback;
}

const FALLBACK_MEMORY_ENTRIES: MemoryGovernanceEntry[] = [
  {
    id: 'mem_fallback_01',
    tier: 'procedural',
    status: 'trusted',
    fact: 'Always run infisical_bootstrap.py from repo root relative path ../../scripts/runtime when starting mcp-control-plane.',
    verifiedBy: 'platform-operator',
    source: 'runtime-config audit',
    createdAt: 'Snapshot',
  },
  {
    id: 'mem_fallback_02',
    tier: 'semantic',
    status: 'candidate',
    fact: 'Upstash Redis backpressure spikes above 480 QPS when bullmq concurrency exceeds 12 on free tier.',
    source: 'worker-verifier-02',
    createdAt: 'Snapshot',
  },
  {
    id: 'mem_fallback_03',
    tier: 'episodic',
    status: 'candidate',
    fact: 'Bridge work-order #118 lease renewed twice due to large Graphify AST rebuild.',
    source: 'federated_bridge_agent',
    createdAt: 'Snapshot',
  },
];

const FALLBACK_QDRANT_COLLECTIONS: QdrantCollectionStats[] = [
  {
    name: 'supremeai_codebase_ast',
    vectorsCount: 48_920,
    dimensions: 1536,
    distance: 'Cosine',
    status: 'green',
  },
  {
    name: 'supremeai_knowledge_rag',
    vectorsCount: 19_410,
    dimensions: 1536,
    distance: 'Cosine',
    status: 'green',
  },
  {
    name: 'supremeai_episodic_memory',
    vectorsCount: 6_284,
    dimensions: 768,
    distance: 'Dot',
    status: 'green',
  },
];

const FALLBACK_AST_MATCHES: AstGraphMatch[] = [
  {
    id: 'ast_1',
    symbol: 'core/api/routes/control_plane.py::health',
    modulePath: 'core/api/routes/control_plane.py',
    kind: 'router',
    connections: 14,
    summary:
      'Async httpx fan-out probing all registered ecosystem satellites with latency telemetry.',
  },
  {
    id: 'ast_2',
    symbol: 'core/api/routes/commandcenter/overview.py',
    modulePath: 'gateway/routes/commandcenter/overview.py',
    kind: 'router',
    connections: 9,
    summary: 'Unified admin Command Center metrics aggregator guarded by get_current_admin.',
  },
  {
    id: 'ast_3',
    symbol: 'gateway/services/auto_healer.py::AutoHealer',
    modulePath: 'gateway/services/auto_healer.py',
    kind: 'service',
    connections: 21,
    summary:
      'Monitors failure fingerprints and trips/resets circuit breakers with HITL audit logs.',
  },
  {
    id: 'ast_4',
    symbol: 'core/mcp_policy.py::validate_mcp_allowlist',
    modulePath: 'core/mcp_policy.py',
    kind: 'invariant',
    connections: 17,
    summary: 'Enforces S0.1 atomic lease & destructive tool approval token invariants.',
  },
];

const FALLBACK_KAGGLE_RUNS: KaggleKernelRun[] = [
  {
    id: 'kgl_901',
    title: 'supremeai-embedding-finetune-v4',
    accelerator: 'T4x2',
    status: 'completed',
    durationSec: 412,
    submittedBy: 'platform-operator',
    submittedAt: 'Snapshot',
  },
  {
    id: 'kgl_902',
    title: 'adversarial-redteam-eval-batch',
    accelerator: 'P100',
    status: 'running',
    durationSec: 94,
    submittedBy: 'worker-security-04',
    submittedAt: 'Snapshot',
  },
];

const FALLBACK_DEVTOOLS_AUDITS: DevToolsAuditReport[] = [
  {
    id: 'cdp_01',
    url: '/api/health',
    lcpMs: 310,
    cls: 0.0,
    fcpMs: 145,
    consoleErrors: 0,
    networkFailures: 0,
    verdict: 'healthy',
    auditedAt: 'Snapshot',
    provenance: 'local-snapshot',
  },
];

const FALLBACK_CRAWLER_JOBS: CrawlerJob[] = [
  {
    id: 'crawl_01',
    targetUrl: EXTERNAL_URLS.githubBackendRepo,
    engine: 'firecrawl',
    pagesCrawled: 18,
    status: 'completed',
    latencyMs: 1240,
    ranAt: 'Snapshot',
  },
  {
    id: 'crawl_02',
    targetUrl: '/api/mcp-tower/health',
    engine: 'cdp-playwright',
    pagesCrawled: 1,
    status: 'completed',
    latencyMs: 185,
    ranAt: 'Snapshot',
  },
];

/** Untyped JSON object from an upstream payload; every field is narrowed before use. */
type LooseRecord = Record<string, unknown>;

function isLooseRecord(value: unknown): value is LooseRecord {
  return Boolean(value && typeof value === 'object');
}

function asLooseRecords(list: readonly unknown[]): LooseRecord[] {
  return list.filter(isLooseRecord);
}

export function sanitizeMemoryEntries(raw: unknown): MemoryGovernanceEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isLooseRecord)
    .map((item, idx): MemoryGovernanceEntry => ({
      id: typeof item.id === 'string' && item.id ? item.id : `mem_norm_${idx}`,
      tier:
        item.tier === 'episodic' || item.tier === 'procedural' || item.tier === 'semantic'
          ? item.tier
          : 'semantic',
      status:
        item.status === 'trusted' || item.status === 'quarantined' || item.status === 'candidate'
          ? item.status
          : 'candidate',
      fact: typeof item.fact === 'string' ? item.fact : String(item.content || item.summary || ''),
      verifiedBy: typeof item.verifiedBy === 'string' ? item.verifiedBy : undefined,
      source: typeof item.source === 'string' && item.source ? item.source : 'control-plane',
      createdAt: typeof item.createdAt === 'string' && item.createdAt ? item.createdAt : 'Recently',
    }))
    .filter((item) => item.fact.length > 0);
}

export function sanitizeQdrantCollections(raw: unknown): QdrantCollectionStats[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is LooseRecord => isLooseRecord(item) && Boolean(item.name))
    .map((item) => ({
      name: String(item.name),
      vectorsCount: Number.isFinite(Number(item.vectorsCount)) ? Number(item.vectorsCount) : 0,
      dimensions: Number.isFinite(Number(item.dimensions)) ? Number(item.dimensions) : 1536,
      distance:
        item.distance === 'Dot' || item.distance === 'Euclid' || item.distance === 'Cosine'
          ? item.distance
          : 'Cosine',
      status: item.status === 'yellow' ? 'yellow' : 'green',
    }));
}

export function sanitizeAstMatches(raw: unknown): AstGraphMatch[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isLooseRecord)
    .map((item, idx) => ({
      id: typeof item.id === 'string' && item.id ? item.id : `ast_norm_${idx}`,
      symbol: typeof item.symbol === 'string' ? item.symbol : String(item.name || `node_${idx}`),
      modulePath:
        typeof item.modulePath === 'string' ? item.modulePath : String(item.path || 'unknown'),
      kind:
        item.kind === 'service' ||
        item.kind === 'model' ||
        item.kind === 'invariant' ||
        item.kind === 'router'
          ? item.kind
          : 'router',
      connections: Number.isFinite(Number(item.connections)) ? Number(item.connections) : 0,
      summary: typeof item.summary === 'string' ? item.summary : '',
    }));
}

export function normalizeMemoryGraphPayload(
  raw: unknown,
  current?: {
    memoryEntries?: MemoryGovernanceEntry[];
    qdrantCollections?: QdrantCollectionStats[];
    astMatches?: AstGraphMatch[];
  }
): {
  entries: MemoryGovernanceEntry[];
  provenance: DataProvenance;
  collections: QdrantCollectionStats[];
  astMatches: AstGraphMatch[];
  notice: string | null;
} {
  const payload = raw && typeof raw === 'object' ? (raw as LooseRecord) : {};
  const hasFullSchema =
    Array.isArray(payload.entries) &&
    Array.isArray(payload.collections) &&
    Array.isArray(payload.astMatches);

  if (hasFullSchema) {
    return {
      entries: sanitizeMemoryEntries(payload.entries),
      provenance: normalizeProvenance(payload.provenance, 'local-snapshot'),
      collections: sanitizeQdrantCollections(payload.collections),
      astMatches: sanitizeAstMatches(payload.astMatches),
      notice: null,
    };
  }

  const partialEntries = Array.isArray(payload.entries)
    ? sanitizeMemoryEntries(payload.entries)
    : Array.isArray(payload.memory) && payload.memory.length > 0
      ? sanitizeMemoryEntries(payload.memory)
      : current?.memoryEntries && current.memoryEntries.length > 0
        ? current.memoryEntries
        : FALLBACK_MEMORY_ENTRIES;

  const partialCollections = Array.isArray(payload.collections)
    ? sanitizeQdrantCollections(payload.collections)
    : current?.qdrantCollections && current.qdrantCollections.length > 0
      ? current.qdrantCollections
      : FALLBACK_QDRANT_COLLECTIONS;

  const partialAst = Array.isArray(payload.astMatches)
    ? sanitizeAstMatches(payload.astMatches)
    : current?.astMatches && current.astMatches.length > 0
      ? current.astMatches
      : FALLBACK_AST_MATCHES;

  return {
    entries: partialEntries,
    provenance: 'local-snapshot',
    collections: partialCollections,
    astMatches: partialAst,
    notice:
      'Upstream gateway returned a partial memory payload; showing resilient local governance & Qdrant snapshot.',
  };
}

export function normalizeComputeBrowserPayload(
  raw: unknown,
  current?: {
    kaggleRuns?: KaggleKernelRun[];
    devToolsAudits?: DevToolsAuditReport[];
    crawlerJobs?: CrawlerJob[];
  }
): {
  kaggleRuns: KaggleKernelRun[];
  devToolsAudits: DevToolsAuditReport[];
  crawlerJobs: CrawlerJob[];
  notice: string | null;
} {
  const payload = raw && typeof raw === 'object' ? (raw as LooseRecord) : {};
  const nestedData =
    payload.data && typeof payload.data === 'object' ? (payload.data as LooseRecord) : {};

  const rawKaggle = Array.isArray(payload.kaggleRuns)
    ? payload.kaggleRuns
    : Array.isArray(nestedData.kaggleRuns)
      ? nestedData.kaggleRuns
      : null;
  const rawAudits = Array.isArray(payload.devToolsAudits)
    ? payload.devToolsAudits
    : Array.isArray(nestedData.devToolsAudits)
      ? nestedData.devToolsAudits
      : null;
  const rawCrawlers = Array.isArray(payload.crawlerJobs)
    ? payload.crawlerJobs
    : Array.isArray(nestedData.crawlerJobs)
      ? nestedData.crawlerJobs
      : null;

  const hasFullSchema = Boolean(rawKaggle && rawAudits && rawCrawlers);

  const kaggleRuns: KaggleKernelRun[] = asLooseRecords(
    rawKaggle ??
    (current?.kaggleRuns && current.kaggleRuns.length > 0
      ? current.kaggleRuns
      : FALLBACK_KAGGLE_RUNS)
  ).map((r, idx) => ({
      id: typeof r.id === 'string' && r.id ? r.id : `kgl_norm_${idx}`,
      title: typeof r.title === 'string' && r.title ? r.title : 'unnamed-kernel',
      accelerator:
        r.accelerator === 'P100' || r.accelerator === 'TPU-v3-8' || r.accelerator === 'T4x2'
          ? r.accelerator
          : 'T4x2',
      status:
        r.status === 'running' ||
        r.status === 'completed' ||
        r.status === 'queued' ||
        r.status === 'failed'
          ? r.status
          : 'queued',
      durationSec: Number.isFinite(Number(r.durationSec)) ? Number(r.durationSec) : 0,
      submittedBy:
        typeof r.submittedBy === 'string' && r.submittedBy ? r.submittedBy : 'platform-operator',
      submittedAt: typeof r.submittedAt === 'string' && r.submittedAt ? r.submittedAt : 'Snapshot',
    }));

  const devToolsAudits: DevToolsAuditReport[] = asLooseRecords(
    rawAudits ??
    (current?.devToolsAudits && current.devToolsAudits.length > 0
      ? current.devToolsAudits
      : FALLBACK_DEVTOOLS_AUDITS)
  ).map((a, idx) => ({
      id: typeof a.id === 'string' && a.id ? a.id : `cdp_norm_${idx}`,
      url: typeof a.url === 'string' && a.url ? a.url : '/api/health',
      lcpMs: Number.isFinite(Number(a.lcpMs)) ? Number(a.lcpMs) : 0,
      cls: Number.isFinite(Number(a.cls)) ? Number(a.cls) : 0,
      fcpMs: Number.isFinite(Number(a.fcpMs)) ? Number(a.fcpMs) : 0,
      consoleErrors: Number.isFinite(Number(a.consoleErrors)) ? Number(a.consoleErrors) : 0,
      networkFailures: Number.isFinite(Number(a.networkFailures)) ? Number(a.networkFailures) : 0,
      verdict:
        a.verdict === 'needs-attention' || a.verdict === 'failing' || a.verdict === 'healthy'
          ? a.verdict
          : 'healthy',
      auditedAt: typeof a.auditedAt === 'string' && a.auditedAt ? a.auditedAt : 'Snapshot',
      provenance: normalizeProvenance(a.provenance, 'local-snapshot'),
    }));

  const crawlerJobs: CrawlerJob[] = asLooseRecords(
    rawCrawlers ??
    (current?.crawlerJobs && current.crawlerJobs.length > 0
      ? current.crawlerJobs
      : FALLBACK_CRAWLER_JOBS)
  ).map((j, idx) => ({
      id: typeof j.id === 'string' && j.id ? j.id : `crawl_norm_${idx}`,
      targetUrl:
        typeof j.targetUrl === 'string' && j.targetUrl
          ? j.targetUrl
          : EXTERNAL_URLS.githubBackendRepo,
      engine:
        j.engine === 'firecrawl' || j.engine === 'cdp-playwright' || j.engine === 'microvm-sandbox'
          ? j.engine
          : 'firecrawl',
      pagesCrawled: Number.isFinite(Number(j.pagesCrawled)) ? Number(j.pagesCrawled) : 0,
      status:
        j.status === 'running' || j.status === 'blocked' || j.status === 'completed'
          ? j.status
          : 'completed',
      latencyMs: Number.isFinite(Number(j.latencyMs)) ? Number(j.latencyMs) : 0,
      ranAt: typeof j.ranAt === 'string' && j.ranAt ? j.ranAt : 'Snapshot',
    }));

  return {
    kaggleRuns,
    devToolsAudits,
    crawlerJobs,
    notice: hasFullSchema
      ? null
      : 'Upstream gateway returned a partial compute telemetry payload; displaying resilient local fleet snapshot.',
  };
}

/** বাংলা মন্তব্য: Control Center-এর লাইভ-ডেটা ডোমেইন — প্রতিটির আলাদা provenance ট্র্যাক হয়। */
export type ControlCenterDomain =
  | 'overview'
  | 'diagnostics'
  | 'mcpTools'
  | 'releaseGate'
  | 'hitl'
  | 'memory'
  | 'bridge'
  | 'compute'
  | 'finOps'
  | 'serviceHealth';

export interface DomainProvenanceEntry {
  /** শেষ সফল লাইভ সিঙ্ক (epoch ms) */
  at: number;
  /** শেষ ব্যর্থতার বার্তা — থাকলে ব্যাজ DEGRADED দেখাবে, মিথ্যা LIVE নয় */
  error?: string;
}

interface ControlCenterState {
  safetyMode: ControlPlaneSafetyMode;
  mcpEndpoint: string;
  backendGateway: string;

  /**
   * বাংলা মন্তব্য: প্রতিটি ডোমেইনের লাইভ সার্ভার-সিঙ্ক সত্য — ব্যাজের একমাত্র উৎস।
   * success → { at } (age সহ LIVE), failure → { error } (DEGRADED),
   * এন্ট্রি নেই → এখনো লাইভ সিঙ্ক হয়নি (UNKNOWN)। localStorage/ফলব্যাক ডেটা কখনো
   * "live" গণ্য হয় না।
   */
  domainProvenance: Partial<Record<ControlCenterDomain, DomainProvenanceEntry>>;

  isLoadingOverview: boolean;
  isDiagnosing: boolean;
  latestGithubCommit: {
    sha: string;
    message: string;
    author: string;
    date: string;
    provenance: DataProvenance;
  } | null;
  latestDiagnose: DeepDiagnoseReport | null;
  pendingHitlCount: number;
  activeTakeoversCount: number;
  unclaimedBridgeCount: number;

  // MCP Live Registry
  mcpTools: McpToolDescriptor[];
  mcpToolsProvenance: DataProvenance;
  isLoadingTools: boolean;
  lastToolResult: McpToolExecutionResult | null;

  // Release Gate & CI
  releases: ReleaseVerificationItem[];
  pipelines: HarnessPipelineRun[];
  isLoadingReleases: boolean;

  // HITL, DAG Plans, Policies & Takeover
  hitlTickets: HitlTicket[];
  remediationPlans: RemediationDagPlan[];
  executionPolicies: ExecutionPolicyRule[];
  takeoverSessions: ActiveTakeoverSession[];
  healerIncidents: AutoHealerIncident[];
  isLoadingHitl: boolean;

  // Memory, Qdrant & AST Graph
  memoryEntries: MemoryGovernanceEntry[];
  memoryProvenance: DataProvenance;
  qdrantCollections: QdrantCollectionStats[];
  astMatches: AstGraphMatch[];
  astLiveOutput: string | null;
  astLiveStatus: 'ok' | 'unavailable' | 'error' | null;
  isLoadingMemory: boolean;
  memoryError: string | null;
  memoryNotice: string | null;

  // External Agents & Bridge
  externalAgents: ExternalAgentRecord[];
  bridgeWorkOrders: BridgeWorkOrder[];
  bridgeProvenance: DataProvenance;
  isLoadingBridge: boolean;

  // Compute & Browser Fleet
  kaggleRuns: KaggleKernelRun[];
  devToolsAudits: DevToolsAuditReport[];
  crawlerJobs: CrawlerJob[];
  isLoadingCompute: boolean;
  computeError: string | null;
  computeNotice: string | null;

  // FinOps & Omnichannel
  finOpsMesh: FinOpsMeshService[];
  telegramLogs: TelegramDispatchRecord[];
  cronTasks: CronTaskItem[];
  isLoadingFinOps: boolean;

  // Real-Time MCP Resource & Latency Health Monitor
  healthSnapshot: McpHealthMonitorSnapshot | null;
  trafficSummary: {
    rpm: number;
    avgLatencyMs: number;
    errorRatePercent: number;
    totalRequests: number;
    history: GatewayTrafficPoint[];
  } | null;
  isLoadingHealth: boolean;
  isProbingHealth: boolean;
  ecosystemDiagnostics: EcosystemDiagnosticsReport | null;
  isLoadingDiagnostics: boolean;

  // Safety Gate Modal
  pendingGate: SafetyGatePrompt | null;
  isExecutingGate: boolean;

  // Actions
  loadOverview: () => Promise<void>;
  loadEcosystemDiagnostics: (fresh?: boolean) => Promise<void>;
  setSafetyMode: (mode: ControlPlaneSafetyMode, actor?: string) => Promise<void>;
  runDeepDiagnose: (service?: string, intent?: string, actor?: string) => Promise<void>;
  loadMcpTools: (refresh?: boolean) => Promise<void>;
  runMcpTool: (
    toolName: string,
    args: Record<string, unknown>,
    isMutating: boolean,
    actor?: string
  ) => Promise<void>;
  loadReleaseGate: () => Promise<void>;
  loadHitlAndPolicies: () => Promise<void>;
  generateDagPlan: (service: string, failureLayer: string, actor?: string) => Promise<void>;
  toggleTakeover: (id: string, actor?: string) => Promise<void>;
  loadMemoryAndGraph: () => Promise<void>;
  learnMemory: (
    tier: 'episodic' | 'semantic' | 'procedural',
    fact: string,
    verifiedBy?: string
  ) => Promise<void>;
  queryAstGraph: (query: string) => Promise<void>;
  loadExternalAgentsAndBridge: () => Promise<void>;
  loadComputeAndBrowser: () => Promise<void>;
  runDevToolsAudit: (url: string) => Promise<void>;
  loadFinOpsAndOmnichannel: () => Promise<void>;
  loadServiceHealth: (refresh?: boolean) => Promise<void>;
  runServiceHealthProbe: (actor?: string) => Promise<void>;
  saveHealthThresholds: (
    thresholds: Partial<ProactiveHealthThresholds>,
    actor?: string
  ) => Promise<void>;
  applyHealthStreamSnapshot: (
    snapshot: McpHealthMonitorSnapshot,
    traffic?: ControlCenterState['trafficSummary']
  ) => void;

  requestGuardedAction: (prompt: SafetyGatePrompt) => void;
  closeGuardedAction: () => void;
  executeGuardedAction: (gate: SafetyGateContext) => Promise<void>;
}

export const useControlCenterStore = create<ControlCenterState>((set, get) => ({
  safetyMode: 'dry-run-hitl',
  mcpEndpoint: '',
  backendGateway: '',
  isLoadingOverview: false,
  domainProvenance: {},
  isDiagnosing: false,
  latestGithubCommit: null,
  latestDiagnose: null,
  pendingHitlCount: 0,
  activeTakeoversCount: 0,
  unclaimedBridgeCount: 0,

  mcpTools: [],
  mcpToolsProvenance: 'local-snapshot',
  isLoadingTools: false,
  lastToolResult: null,

  releases: [],
  pipelines: [],
  isLoadingReleases: false,

  hitlTickets: [],
  remediationPlans: [],
  executionPolicies: [],
  takeoverSessions: [],
  healerIncidents: [],
  isLoadingHitl: false,

  memoryEntries: [],
  memoryProvenance: 'local-snapshot',
  qdrantCollections: [],
  astMatches: [],
  astLiveOutput: null,
  astLiveStatus: null,
  isLoadingMemory: false,
  memoryError: null,
  memoryNotice: null,

  externalAgents: [],
  bridgeWorkOrders: [],
  bridgeProvenance: 'local-snapshot',
  isLoadingBridge: false,

  kaggleRuns: [],
  devToolsAudits: [],
  crawlerJobs: [],
  isLoadingCompute: false,
  computeError: null,
  computeNotice: null,

  finOpsMesh: [],
  telegramLogs: [],
  cronTasks: [],
  isLoadingFinOps: false,

  healthSnapshot: null,
  trafficSummary: null,
  isLoadingHealth: false,
  isProbingHealth: false,
  ecosystemDiagnostics: null,
  isLoadingDiagnostics: false,

  pendingGate: null,
  isExecutingGate: false,

  loadOverview: async () => {
    set({ isLoadingOverview: true });
    try {
      const data = await controlCenterService.fetchOverview();
      if (!data || typeof data !== 'object') return;
      set((state) => ({
        safetyMode:
          data.safetyMode === 'read-only' ||
          data.safetyMode === 'dry-run-hitl' ||
          data.safetyMode === 'operator-override'
            ? data.safetyMode
            : state.safetyMode,
        mcpEndpoint:
          typeof data.mcpEndpoint === 'string' && data.mcpEndpoint
            ? data.mcpEndpoint
            : state.mcpEndpoint,
        backendGateway:
          typeof data.backendGateway === 'string' && data.backendGateway
            ? data.backendGateway
            : state.backendGateway,
        latestGithubCommit: data.latestGithubCommit ?? state.latestGithubCommit,
        latestDiagnose: data.latestDiagnose ?? state.latestDiagnose,
        pendingHitlCount:
          typeof data.pendingHitlCount === 'number'
            ? data.pendingHitlCount
            : state.pendingHitlCount,
        activeTakeoversCount:
          typeof data.activeTakeoversCount === 'number'
            ? data.activeTakeoversCount
            : state.activeTakeoversCount,
        unclaimedBridgeCount:
          typeof data.unclaimedBridgeCount === 'number'
            ? data.unclaimedBridgeCount
            : state.unclaimedBridgeCount,
        trafficSummary: data.trafficSummary || state.trafficSummary,
      }));
      markDomain('overview', true);
    } catch (err: unknown) {
      // Keep prior state cleanly — but honestly: badge shows DEGRADED
      markDomain('overview', false, err instanceof Error ? err.message : 'overview fetch failed');
    } finally {
      set({ isLoadingOverview: false });
    }
  },

  loadEcosystemDiagnostics: async (fresh = false) => {
    set({ isLoadingDiagnostics: true });
    try {
      const report = await controlCenterService.fetchEcosystemDiagnostics(fresh);
      if (report && Array.isArray(report.findings)) {
        set({ ecosystemDiagnostics: report });
        markDomain('diagnostics', true);
      }
    } catch (err: unknown) {
      // Keep previous diagnostics snapshot — badge shows DEGRADED
      markDomain('diagnostics', false, err instanceof Error ? err.message : 'diagnostics fetch failed');
    } finally {
      set({ isLoadingDiagnostics: false });
    }
  },

  setSafetyMode: async (mode, actor) => {
    try {
      const res = await controlCenterService.setSafetyMode(mode, actor);
      const nextMode = res?.safetyMode ?? mode;
      set({ safetyMode: nextMode });
      toast.info('Safety Posture Updated', `Control Center safety mode set to "${nextMode}".`);
    } catch (err: unknown) {
      toast.error('Safety Mode Error', err instanceof Error ? err.message : 'Update failed.');
    }
  },

  runDeepDiagnose: async (service = 'api', intent = 'is_healthy', actor) => {
    set({ isDiagnosing: true });
    try {
      const { report } = await controlCenterService.runDeepDiagnose(service, intent, actor);
      if (report) {
        set({ latestDiagnose: report });
        toast.success(
          `Deep Diagnose: ${report.releaseGate}`,
          `5-layer TruthMatrix refreshed (${report.provenance}).`
        );
      }
    } catch (err: unknown) {
      toast.error('Deep Diagnose Error', err instanceof Error ? err.message : 'Probe failed.');
    } finally {
      set({ isDiagnosing: false });
    }
  },

  loadMcpTools: async (refresh = false) => {
    set({ isLoadingTools: true });
    try {
      const res = await controlCenterService.fetchMcpTools(refresh);
      set({
        mcpTools: Array.isArray(res?.tools) ? res.tools : get().mcpTools,
        mcpToolsProvenance: normalizeProvenance(res?.provenance, 'local-snapshot'),
      });
      markDomain('mcpTools', true);
    } catch (err: unknown) {
      markDomain('mcpTools', false, err instanceof Error ? err.message : 'MCP registry unreachable');
      toast.error(
        'MCP Discovery Failed',
        err instanceof Error ? err.message : 'Unable to reach MCP registry.'
      );
    } finally {
      set({ isLoadingTools: false });
    }
  },

  runMcpTool: async (toolName, args, isMutating, actor) => {
    if (!isMutating) {
      try {
        const { result } = await controlCenterService.executeMcpTool(toolName, args, { actor });
        set({ lastToolResult: result });
        if (result?.error) {
          toast.warning(`MCP Tool ${toolName}`, result.error);
        } else if (result) {
          toast.success(
            `Executed ${toolName}`,
            `Completed in ${result.latencyMs}ms (${result.provenance}).`
          );
        }
      } catch (err: unknown) {
        toast.error(
          'MCP Execution Error',
          err instanceof Error ? err.message : 'Failed to call tool.'
        );
      }
      return;
    }

    get().requestGuardedAction({
      title: `Execute MCP Tool: ${toolName}`,
      description: `Invoke live MCP Control Tower tool "${toolName}" with custom JSON payload.`,
      impactSummary: JSON.stringify(args),
      riskLevel: 'high',
      onExecute: async (gate) => {
        const { result } = await controlCenterService.executeMcpTool(toolName, args, {
          ...gate,
          actor,
        });
        set({ lastToolResult: result });
        toast.success(
          result?.dryRun ? `Dry-Run Passed: ${toolName}` : `Executed ${toolName}`,
          result?.dryRun
            ? 'Dry-run simulation validated.'
            : `Completed in ${result?.latencyMs ?? 0}ms.`
        );
      },
    });
  },

  loadReleaseGate: async () => {
    set({ isLoadingReleases: true });
    try {
      const res = await controlCenterService.fetchReleaseGate();
      set((state) => ({
        latestGithubCommit: res?.githubCommit ?? state.latestGithubCommit,
        releases: Array.isArray(res?.releases) ? res.releases : state.releases,
        pipelines: Array.isArray(res?.pipelines) ? res.pipelines : state.pipelines,
      }));
      markDomain('releaseGate', true);
    } catch (err: unknown) {
      markDomain('releaseGate', false, err instanceof Error ? err.message : 'release verification fetch failed');
      toast.error(
        'Release Gate Error',
        err instanceof Error ? err.message : 'Failed to load release verification.'
      );
    } finally {
      set({ isLoadingReleases: false });
    }
  },

  loadHitlAndPolicies: async () => {
    set({ isLoadingHitl: true });
    try {
      const res = await controlCenterService.fetchHitlAndPolicies();
      set((state) => {
        const tickets = Array.isArray(res?.tickets) ? res.tickets : state.hitlTickets;
        return {
          hitlTickets: tickets,
          remediationPlans: Array.isArray(res?.plans) ? res.plans : state.remediationPlans,
          executionPolicies: Array.isArray(res?.policies) ? res.policies : state.executionPolicies,
          takeoverSessions: Array.isArray(res?.takeoverSessions)
            ? res.takeoverSessions
            : state.takeoverSessions,
          healerIncidents: Array.isArray(res?.healerIncidents)
            ? res.healerIncidents
            : state.healerIncidents,
          pendingHitlCount: tickets.filter((t) => t.status === 'pending').length,
        };
      });
      markDomain('hitl', true);
    } catch (err: unknown) {
      markDomain('hitl', false, err instanceof Error ? err.message : 'HITL queue fetch failed');
      toast.error(
        'HITL Queue Error',
        err instanceof Error ? err.message : 'Failed to load HITL approvals.'
      );
    } finally {
      set({ isLoadingHitl: false });
    }
  },

  generateDagPlan: async (service, failureLayer, actor) => {
    try {
      const res = await controlCenterService.generateRemediationPlan(service, failureLayer, actor);
      if (Array.isArray(res?.plans)) {
        set({ remediationPlans: res.plans });
      }
      toast.success('DAG Plan Synthesized', `Generated topological waves for ${failureLayer}.`);
    } catch (err: unknown) {
      toast.error(
        'Planner Error',
        err instanceof Error ? err.message : 'Could not synthesize plan.'
      );
    }
  },

  toggleTakeover: async (id, actor) => {
    try {
      const res = await controlCenterService.toggleTakeoverSession(id, actor);
      if (Array.isArray(res?.takeoverSessions)) {
        set({ takeoverSessions: res.takeoverSessions });
      }
      toast.info('Session Control Updated', 'Live operator takeover state updated.');
    } catch (err: unknown) {
      toast.error(
        'Takeover Failed',
        err instanceof Error ? err.message : 'Unable to switch takeover.'
      );
    }
  },

  loadMemoryAndGraph: async () => {
    set({ isLoadingMemory: true, memoryError: null });
    try {
      const res = await controlCenterService.fetchMemoryAndGraph();
      const state = get();
      const normalized = normalizeMemoryGraphPayload(res, {
        memoryEntries: state.memoryEntries,
        qdrantCollections: state.qdrantCollections,
        astMatches: state.astMatches,
      });
      set({
        memoryEntries: normalized.entries,
        memoryProvenance: normalized.provenance,
        qdrantCollections: normalized.collections,
        astMatches: normalized.astMatches,
        memoryNotice: normalized.notice,
        memoryError: null,
      });
      markDomain('memory', true);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unable to load Memory, Qdrant & AST telemetry.';
      markDomain('memory', false, message);
      const state = get();
      const fallback = normalizeMemoryGraphPayload(
        {},
        {
          memoryEntries: state.memoryEntries,
          qdrantCollections: state.qdrantCollections,
          astMatches: state.astMatches,
        }
      );
      set({
        memoryEntries: fallback.entries,
        memoryProvenance: 'local-snapshot',
        qdrantCollections: fallback.collections,
        astMatches: fallback.astMatches,
        memoryError: message,
      });
    } finally {
      set({ isLoadingMemory: false });
    }
  },

  learnMemory: async (tier, fact, verifiedBy) => {
    try {
      const res = await controlCenterService.learnMemoryFact(tier, fact, verifiedBy);
      if (Array.isArray(res?.entries)) {
        set({ memoryEntries: sanitizeMemoryEntries(res.entries), memoryError: null });
      } else {
        // Optimistically prepend locally if upstream didn't echo entries array
        const localItem: MemoryGovernanceEntry = {
          id: `mem_local_${Date.now().toString(36)}`,
          tier,
          status: verifiedBy ? 'trusted' : 'candidate',
          fact: fact.trim(),
          verifiedBy,
          source: 'admin-control-center',
          createdAt: 'Just now',
        };
        set((state) => ({ memoryEntries: [localItem, ...state.memoryEntries] }));
      }
      toast.success(
        'Memory Recorded',
        `Added ${tier} fact (${verifiedBy ? 'trusted' : 'candidate'}).`
      );
    } catch (err: unknown) {
      toast.error('Memory Error', err instanceof Error ? err.message : 'Failed to store fact.');
    }
  },

  queryAstGraph: async (query) => {
    try {
      const res = await controlCenterService.queryCodebaseGraph(query);
      const q = query.trim().toLowerCase();
      const matches = Array.isArray(res?.matches)
        ? sanitizeAstMatches(res.matches)
        : q
          ? (get().astMatches.length > 0 ? get().astMatches : FALLBACK_AST_MATCHES).filter(
              (m) =>
                m.symbol.toLowerCase().includes(q) ||
                m.modulePath.toLowerCase().includes(q) ||
                m.summary.toLowerCase().includes(q)
            )
          : FALLBACK_AST_MATCHES;

      set({
        astMatches: matches,
        memoryProvenance: normalizeProvenance(res?.provenance, get().memoryProvenance),
        astLiveOutput: typeof res?.liveOutput === 'string' ? res.liveOutput : null,
        astLiveStatus:
          res?.liveStatus === 'ok' ||
          res?.liveStatus === 'unavailable' ||
          res?.liveStatus === 'error'
            ? res.liveStatus
            : res?.liveOutput
              ? 'ok'
              : null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'AST graph query failed.';
      set({ astLiveStatus: 'error', astLiveOutput: message });
      toast.error('AST Query Failed', message);
    }
  },

  loadExternalAgentsAndBridge: async () => {
    set({ isLoadingBridge: true });
    try {
      const res = await controlCenterService.fetchExternalAgentsAndBridge();
      set((state) => {
        const workOrders = Array.isArray(res?.workOrders) ? res.workOrders : state.bridgeWorkOrders;
        return {
          externalAgents: Array.isArray(res?.agents) ? res.agents : state.externalAgents,
          bridgeWorkOrders: workOrders,
          bridgeProvenance: normalizeProvenance(res?.provenance, state.bridgeProvenance),
          unclaimedBridgeCount: workOrders.filter((w) => w.status === 'unclaimed').length,
        };
      });
      markDomain('bridge', true);
    } catch (err: unknown) {
      markDomain('bridge', false, err instanceof Error ? err.message : 'bridge queue fetch failed');
      toast.error(
        'Agent Bridge Error',
        err instanceof Error ? err.message : 'Failed to load bridge work queue.'
      );
    } finally {
      set({ isLoadingBridge: false });
    }
  },

  loadComputeAndBrowser: async () => {
    set({ isLoadingCompute: true, computeError: null });
    try {
      const res = await controlCenterService.fetchComputeAndBrowser();
      const state = get();
      const normalized = normalizeComputeBrowserPayload(res, {
        kaggleRuns: state.kaggleRuns,
        devToolsAudits: state.devToolsAudits,
        crawlerJobs: state.crawlerJobs,
      });
      set({
        kaggleRuns: normalized.kaggleRuns,
        devToolsAudits: normalized.devToolsAudits,
        crawlerJobs: normalized.crawlerJobs,
        computeNotice: normalized.notice,
        computeError: null,
      });
      markDomain('compute', true);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unable to load Kaggle GPU & Browser fleet telemetry.';
      markDomain('compute', false, message);
      const state = get();
      const fallback = normalizeComputeBrowserPayload(
        {},
        {
          kaggleRuns: state.kaggleRuns,
          devToolsAudits: state.devToolsAudits,
          crawlerJobs: state.crawlerJobs,
        }
      );
      set({
        kaggleRuns: fallback.kaggleRuns,
        devToolsAudits: fallback.devToolsAudits,
        crawlerJobs: fallback.crawlerJobs,
        computeError: message,
      });
    } finally {
      set({ isLoadingCompute: false });
    }
  },

  runDevToolsAudit: async (url) => {
    set({ isLoadingCompute: true, computeError: null });
    try {
      const res = await controlCenterService.runDevToolsAudit(url);
      if (Array.isArray(res?.devToolsAudits)) {
        const normalized = normalizeComputeBrowserPayload(
          { devToolsAudits: res.devToolsAudits },
          {
            kaggleRuns: get().kaggleRuns,
            devToolsAudits: get().devToolsAudits,
            crawlerJobs: get().crawlerJobs,
          }
        );
        set({ devToolsAudits: normalized.devToolsAudits });
      }
      if (res?.report) {
        toast.success(
          'Headless CDP Audit Complete',
          `${res.report.url} · LCP ${res.report.lcpMs}ms`
        );
      } else {
        toast.info('Headless CDP Audit Finished', `Probed ${url}.`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Audit failed.';
      set({ computeError: message });
      toast.error('DevTools Audit Error', message);
    } finally {
      set({ isLoadingCompute: false });
    }
  },

  loadFinOpsAndOmnichannel: async () => {
    set({ isLoadingFinOps: true });
    try {
      const res = await controlCenterService.fetchFinOpsAndOmnichannel();
      set((state) => ({
        finOpsMesh: Array.isArray(res?.finOpsMesh) ? res.finOpsMesh : state.finOpsMesh,
        telegramLogs: Array.isArray(res?.telegramLogs) ? res.telegramLogs : state.telegramLogs,
        cronTasks: Array.isArray(res?.cronTasks) ? res.cronTasks : state.cronTasks,
      }));
      markDomain('finOps', true);
    } catch (err: unknown) {
      markDomain('finOps', false, err instanceof Error ? err.message : 'FinOps fetch failed');
      toast.error(
        'FinOps Telemetry Error',
        err instanceof Error ? err.message : 'Failed to load FinOps data.'
      );
    } finally {
      set({ isLoadingFinOps: false });
    }
  },

  loadServiceHealth: async (refresh = false) => {
    set({ isLoadingHealth: true });
    try {
      const res = await controlCenterService.fetchServiceHealth(refresh);
      set((state) => ({
        healthSnapshot: res?.snapshot?.services ? res.snapshot : state.healthSnapshot,
        trafficSummary: res?.traffic ?? state.trafficSummary,
      }));
      markDomain('serviceHealth', true);
    } catch (err: unknown) {
      markDomain('serviceHealth', false, err instanceof Error ? err.message : 'service health probe failed');
      toast.error(
        'Health Monitor Error',
        err instanceof Error ? err.message : 'Unable to probe services.'
      );
    } finally {
      set({ isLoadingHealth: false });
    }
  },

  runServiceHealthProbe: async (actor) => {
    set({ isProbingHealth: true });
    try {
      const res = await controlCenterService.probeServiceHealth(actor);
      if (res?.snapshot) {
        set((state) => ({
          healthSnapshot: res.snapshot,
          trafficSummary: res.traffic ?? state.trafficSummary,
        }));
        toast.success(
          'Live Health Probe Complete',
          `${res.snapshot.summary?.healthy ?? 0}/${res.snapshot.summary?.total ?? 0} healthy · avg ${res.snapshot.summary?.avgLatencyMs ?? 0}ms`
        );
      }
    } catch (err: unknown) {
      toast.error(
        'Live Probe Failed',
        err instanceof Error ? err.message : 'Upstream probe error.'
      );
    } finally {
      set({ isProbingHealth: false });
    }
  },

  saveHealthThresholds: async (thresholds, actor) => {
    try {
      await controlCenterService.updateHealthThresholds(thresholds, actor);
      const res = await controlCenterService.fetchServiceHealth(true);
      set((state) => ({
        healthSnapshot: res?.snapshot ?? state.healthSnapshot,
        trafficSummary: res?.traffic ?? state.trafficSummary,
      }));
      toast.success('Alert Thresholds Saved', 'Proactive health monitor thresholds updated.');
    } catch (err: unknown) {
      toast.error(
        'Threshold Update Error',
        err instanceof Error ? err.message : 'Failed to save thresholds.'
      );
    }
  },

  applyHealthStreamSnapshot: (snapshot, traffic) => {
    set((state) => ({
      healthSnapshot: snapshot,
      trafficSummary: traffic || state.trafficSummary,
    }));
  },

  requestGuardedAction: (prompt) => {
    set({ pendingGate: prompt });
  },

  closeGuardedAction: () => {
    set({ pendingGate: null, isExecutingGate: false });
  },

  executeGuardedAction: async (gate) => {
    const active = get().pendingGate;
    if (!active) return;
    set({ isExecutingGate: true });
    try {
      await active.onExecute(gate);
      set({ pendingGate: null });
    } catch (err: unknown) {
      toast.error('Safety Gate Rejected', err instanceof Error ? err.message : 'Action blocked.');
    } finally {
      set({ isExecutingGate: false });
    }
  },
}));

/** বাংলা মন্তব্য: ডোমেইন provenance মার্কার — লোড অ্যাকশনগুলো থেকে ডাকা হয়। সফল লাইভ
 * সিঙ্কে `at` সেট হয়; ব্যর্থতায় `error` সেট হয় (আগের `at` অটুট থাকে, যাতে পুরনো ডেটা
 * হাওয়ায় না যায় বরং DEGRADED হিসেবে স্বীকার করা হয়)। */
function markDomain(domain: ControlCenterDomain, ok: boolean, error?: string): void {
  useControlCenterStore.setState((state) => ({
    domainProvenance: {
      ...state.domainProvenance,
      [domain]: ok
        ? { at: Date.now() }
        : { at: state.domainProvenance[domain]?.at ?? 0, error: error || 'fetch failed' },
    },
  }));
}
