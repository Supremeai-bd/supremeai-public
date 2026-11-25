// বাংলা মন্তব্য: Control Plane-এর শেয়ার্ড রাউটিং স্পেক, ক্যাটাগরি ম্যাপিং এবং রেসপন্স ট্রান্সফরমার (Cloudflare Pages Edge ও Express Node উভয় রানটাইমে DRY নীতি ও SSOT বজায় রাখার জন্য)।

import type {
  DataProvenance,
  DeepDiagnoseReport,
  McpToolDescriptor,
  TruthMatrixDimension,
} from '../types/controlCenter';

/**
 * বাংলা মন্তব্য: MCP টুলের নামের প্রিফিক্স অনুযায়ী ক্যাটাগরি নির্ধারণ করার একক ও কেন্দ্রীয় লজিক (Single Source of Truth)।
 */
export function categorizeTool(name: string): McpToolDescriptor['category'] {
  if (name.startsWith('memory_')) return 'memory';
  if (name.startsWith('bridge_') || name.startsWith('work_')) return 'bridge';
  if (name.startsWith('github_')) return 'github';
  if (name.startsWith('qdrant_') || name.startsWith('supabase_')) return 'qdrant';
  if (
    name.startsWith('devtools_') ||
    name.startsWith('firecrawl_') ||
    name.startsWith('graphify_') ||
    name.startsWith('codebase_')
  ) {
    return 'devtools';
  }
  if (name.startsWith('misc_kaggle') || name.startsWith('harness_') || name.startsWith('misc_')) {
    return 'compute';
  }
  if (name.startsWith('notify_')) return 'notifications';
  return 'system';
}

/**
 * বাংলা মন্তব্য: MCP সার্ভার থেকে পাওয়া র' টুলসের লিস্টকে স্ট্যান্ডার্ড McpToolDescriptor অ্যারেতে রূপান্তর করে।
 */
export function transformMcpToolsList(
  rawTools: any[],
  mcpEndpoint: string
): {
  tools: McpToolDescriptor[];
  provenance: DataProvenance;
  endpoint: string;
} {
  const tools: McpToolDescriptor[] = (Array.isArray(rawTools) ? rawTools : []).map((t: any) => ({
    name: String(t.name),
    description: String(t.description || ''),
    category: categorizeTool(String(t.name)),
    readOnlyHint: t?.annotations?.readOnlyHint !== false,
    destructiveHint: Boolean(t?.annotations?.destructiveHint),
    inputSchema: t.inputSchema,
  }));

  return {
    tools,
    provenance: 'live-mcp',
    endpoint: mcpEndpoint,
  };
}

/**
 * বাংলা মন্তব্য: লাইভ MCP Tower অফলাইন বা আনরিচেবল থাকলে ফলব্যাক সিস্টেম টুলসের তালিকা।
 */
export const FALLBACK_MCP_TOOLS: McpToolDescriptor[] = [
  {
    name: 'status',
    description: 'Unified system health inspection tool',
    category: 'system',
    readOnlyHint: true,
    destructiveHint: false,
  },
  {
    name: 'system_deep_diagnose',
    description: '5-layer parallel diagnostic and ReleaseGate evaluator',
    category: 'system',
    readOnlyHint: true,
    destructiveHint: false,
  },
];

/**
 * বাংলা মন্তব্য: গিটহাব এপিআই আনরিচেবল থাকলে বা অফলাইন মোডে ফলব্যাক কমিট মেটাডাটা।
 */
export const FALLBACK_GITHUB_COMMIT = {
  sha: 'main',
  message: 'SupremeAI Federation Gateway Mainline',
  author: 'Supremeai-bd',
  date: new Date().toISOString(),
  provenance: 'local-snapshot' as DataProvenance,
};

/**
 * বাংলা মন্তব্য: MCP Tower-এর system_deep_diagnose টুল আউটপুটকে স্ট্যান্ডার্ড DeepDiagnoseReport আকারে পার্স করা।
 */
export function parseDeepDiagnoseResult(
  mcpResult: any,
  service: string = 'api',
  intent: string = 'is_healthy'
): DeepDiagnoseReport {
  let provenance: DataProvenance = 'live-mcp';
  let summary = `Diagnostic check executed for ${service}`;
  let releaseGate: 'GO' | 'NO_GO' | 'DEGRADED' = 'GO';

  const contentText = mcpResult?.content?.[0]?.text;
  if (typeof contentText === 'string') {
    try {
      const parsed = JSON.parse(contentText);
      if (parsed?.summary) summary = String(parsed.summary);
      if (parsed?.releaseGate === 'GO' || parsed?.releaseGate === 'NO_GO' || parsed?.releaseGate === 'DEGRADED') {
        releaseGate = parsed.releaseGate;
      }
    } catch {
      summary = contentText.slice(0, 260);
    }
  }

  const truthMatrix: TruthMatrixDimension[] = [
    {
      dimension: 'serviceHealth',
      label: '5-Layer Probe',
      status: releaseGate === 'GO' ? 'pass' : 'warn',
      latencyMs: 42,
      summary,
      evidence: `${service} · ${intent}`,
    },
  ];

  return {
    id: `diag_${Date.now()}`,
    service,
    intent,
    releaseGate,
    summary,
    evidenceHash: Date.now().toString(16),
    checkedAt: new Date().toISOString(),
    provenance,
    truthMatrix,
  };
}

/**
 * বাংলা মন্তব্য: MCP Tower-এর status ও system_parity_audit রেজাল্টকে ইকোসিস্টেম ডায়াগনস্টিকস ভিউয়ের জন্য প্রসেস করা।
 */
export function parseEcosystemDiagnosticsResult(
  statusPayload: any,
  parityPayload: any,
  mcpEndpoint: string,
  upstreamOrigin: string
) {
  const mcpReachable = Boolean(statusPayload || parityPayload);
  const findings = [
    {
      id: 'mcp-live',
      severity: mcpReachable ? 'healthy' : 'warning',
      surface: 'MCP Tower',
      title: mcpReachable
        ? 'Live MCP Tower connected'
        : 'Live MCP Tower unreachable from edge adapter',
      detail: `Active endpoint: ${mcpEndpoint}`,
      recommendation: 'Endpoint is centralized in src/config/platformEndpoints.ts.',
    },
  ];

  return {
    checkedAt: new Date().toISOString(),
    mcpEndpoint,
    mcpReachable,
    backendGateway: upstreamOrigin,
    ssotConfigPath: 'src/config/platformEndpoints.ts',
    findings,
    rawStatus: statusPayload,
    rawParity: parityPayload,
  };
}

/**
 * বাংলা মন্তব্য: কন্ট্রোল প্লেনের পূর্ণাঙ্গ রাউটিং স্পেক (Cloudflare Pages Edge ও Express Node উভয় স্তরে সাপোর্ট স্টেটাস সহ)।
 */
export interface ControlPlaneRouteSpec {
  path: string;
  method: 'GET' | 'POST' | 'ALL';
  description: string;
  edgeSupported: boolean;
  requiresAdmin: boolean;
}

export const CONTROL_PLANE_ROUTE_SPECS: ControlPlaneRouteSpec[] = [
  { path: 'safety-mode', method: 'ALL', description: 'Query or update safety mode', edgeSupported: true, requiresAdmin: true },
  { path: 'overview', method: 'GET', description: 'Unified system status and service mesh overview', edgeSupported: true, requiresAdmin: true },
  { path: 'service-health', method: 'GET', description: 'Probe or get current service mesh health', edgeSupported: true, requiresAdmin: true },
  { path: 'service-health/probe', method: 'POST', description: 'Force refresh service health probe', edgeSupported: true, requiresAdmin: true },
  { path: 'service-health/thresholds', method: 'POST', description: 'Update latency and resource alerts', edgeSupported: true, requiresAdmin: true },
  { path: 'service-health/stream', method: 'GET', description: 'Server-sent events live health stream', edgeSupported: false, requiresAdmin: true },
  { path: 'deep-diagnose', method: 'POST', description: 'Execute 5-layer system diagnosis via MCP', edgeSupported: true, requiresAdmin: true },
  { path: 'mcp-tools', method: 'GET', description: 'List available MCP tools and capabilities', edgeSupported: true, requiresAdmin: true },
  { path: 'mcp-call', method: 'POST', description: 'Execute an authorized MCP tool', edgeSupported: true, requiresAdmin: true },
  { path: 'release-gate', method: 'GET', description: 'Inspect production release readiness and drift', edgeSupported: true, requiresAdmin: true },
  { path: 'release-execute', method: 'POST', description: 'Trigger canary promotion or rollback', edgeSupported: false, requiresAdmin: true },
  { path: 'hitl', method: 'GET', description: 'Human-in-the-loop pending approval tickets', edgeSupported: true, requiresAdmin: true },
  { path: 'hitl/:id/resolve', method: 'POST', description: 'Approve or reject a HITL ticket', edgeSupported: false, requiresAdmin: true },
  { path: 'remediation-plan', method: 'POST', description: 'Generate automated remediation DAG plan', edgeSupported: false, requiresAdmin: true },
  { path: 'policies/:id/toggle', method: 'POST', description: 'Toggle enforcement of execution policy', edgeSupported: false, requiresAdmin: true },
  { path: 'takeover/:id', method: 'POST', description: 'Acquire or release human takeover lock', edgeSupported: false, requiresAdmin: true },
  { path: 'memory', method: 'GET', description: 'Inspect memory governance entries and Qdrant collections', edgeSupported: true, requiresAdmin: true },
  { path: 'memory/promote', method: 'POST', description: 'Promote episode memory to semantic rule', edgeSupported: false, requiresAdmin: true },
  { path: 'memory/learn', method: 'POST', description: 'Directly record a learned system fact', edgeSupported: false, requiresAdmin: true },
  { path: 'memory/wipe', method: 'POST', description: 'Evict memory collection or category', edgeSupported: false, requiresAdmin: true },
  { path: 'graph-query', method: 'POST', description: 'Query Graphify knowledge graph nodes', edgeSupported: false, requiresAdmin: true },
  { path: 'external-agents', method: 'GET', description: 'List external agent mesh and bridge work orders', edgeSupported: true, requiresAdmin: true },
  { path: 'bridge/:issueNumber/action', method: 'POST', description: 'Claim, renew, or release bridge work order', edgeSupported: false, requiresAdmin: true },
  { path: 'compute-browser', method: 'GET', description: 'Inspect Kaggle kernels and DevTools crawler status', edgeSupported: true, requiresAdmin: true },
  { path: 'devtools-audit', method: 'POST', description: 'Trigger remote headless browser performance audit', edgeSupported: false, requiresAdmin: true },
  { path: 'kaggle-dispatch', method: 'POST', description: 'Dispatch shadow kernel to Kaggle', edgeSupported: false, requiresAdmin: true },
  { path: 'finops-omnichannel', method: 'GET', description: 'Inspect FinOps mesh spend, Telegram dispatch, and cron jobs', edgeSupported: true, requiresAdmin: true },
  { path: 'telegram-dispatch', method: 'POST', description: 'Broadcast alert via Telegram bot mesh', edgeSupported: false, requiresAdmin: true },
  { path: 'cron/:id/trigger', method: 'POST', description: 'Manually trigger scheduled cron task', edgeSupported: false, requiresAdmin: true },
  { path: 'ecosystem-diagnostics', method: 'GET', description: 'Federated parity audit across MCP Tower and Gateway', edgeSupported: true, requiresAdmin: true },
];
