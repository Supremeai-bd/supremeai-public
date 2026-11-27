import type { TranslationKeys } from '../locales/en';

export const ADMIN_ONLY_TABS = new Set([
  'admin-overview',
  'admin-logs',
  'platform-settings',
  'hitl-policies',
  'release-gate',
  'external-agents',
  'memory-graph',
  'compute-fleet',
  'finops-omnichannel',
  'health-monitor',
  'architecture-map',
  'github-pipeline',
  'mcp-tower',
  'agent-swarm',
  'task-queue',
  'schema-parity',
  'llm-gateway',
  'provider-keys',
  'security',
  'system-audit',
  'customers',
  'team-access',
  'backups',
]);

// বাংলা মন্তব্য: সব ফিচার সবার জন্য উন্মুক্ত — কোনো ট্যাব কৃত্রিমভাবে লক থাকবে না
export const DEV_ONLY_TABS = new Set<string>();

export const SUBVIEW_TITLES: Record<string, string> = {
  'universal-inbox': 'Universal Inbox',
  'user-projects': 'My Projects',
  'user-api-keys': 'API Keys & Providers',
  'boost-limit': 'Boost Limit — Add Your Free AI Keys',
  'user-team': 'Team & Members',
  'user-billing': 'Plan & Usage',
  'user-settings': 'Account & Workspace Settings',
  'admin-overview': 'Admin Overview',
  'admin-logs': 'Logs',
  'platform-settings': 'Platform Settings',
  'hitl-policies': 'HITL Approvals & Policies',
  'release-gate': 'Release Gate & Render Deploy',
  'external-agents': 'External Agents & Bridge',
  'memory-graph': 'Memory, Qdrant & AST Graph',
  'compute-fleet': 'Kaggle GPU & CDP Browser Audit',
  'finops-omnichannel': 'FinOps Mesh, Telegram & Cron',
  'health-monitor': 'MCP Resource & Latency Monitor',
  'architecture-map': 'Architecture Topology Map',
  'github-pipeline': 'GitHub CI/CD Pipeline',
  'agent-swarm': 'Autonomous Agent Swarm',
  'task-queue': 'Distributed Task Queue',
  'schema-parity': 'Schema Parity Matrix',
  'llm-gateway': 'LLM Gateway & Pricing',
  'provider-keys': 'Provider API Keys & Infisical Vault',
  security: 'Security & Firewall',
  'system-audit': 'System Audit Log',
  customers: 'Customer Directory',
  'team-access': 'Team & Access',
  backups: 'Backups',
  'mcp-tower': 'MCP Service Tower',
};

/**
 * বাংলা মন্তব্য: App.tsx যে ট্যাবগুলো সত্যিই রেন্ডার করে তার একমাত্র উৎস (SSOT)।
 * `chat` + প্রতিটি সাব-ভিউ। এর বাইরে কোনো নাম (পুরনো বুকমার্ক `?tab=repos`,
 * `?tab=models`, `?tab=usage`, অপসারিত `live-sync` ইত্যাদি) এলে App ফাঁকা পেজ
 * না দেখিয়ে `chat`-এ ফিরে যায়। নতুন ট্যাব যোগ করলে SUBVIEW_TITLES-এ যোগ করুন —
 * navigationTabs.test.ts App.tsx-এর রেন্ডার শাখার সাথে এটা মিলিয়ে দেখে।
 */
export const ROUTABLE_TABS: ReadonlySet<string> = new Set(['chat', ...Object.keys(SUBVIEW_TITLES)]);

export function isRoutableTab(tab: string | null | undefined): tab is string {
  return typeof tab === 'string' && ROUTABLE_TABS.has(tab);
}

export function getLocalizedSubviewTitle(
  tab: string,
  t: Record<TranslationKeys, string>
): string {
  const localizedMap: Record<string, string> = {
    'user-projects': t.subviewProjects,
    'user-api-keys': t.subviewApiKeys,
    'boost-limit': t.subviewBoostLimit,
    'user-team': t.subviewTeam,
    'user-billing': t.subviewBilling,
    'user-settings': t.subviewSettings,
    'admin-overview': t.subviewAdminOverview,
    'hitl-policies': t.subviewHitlPolicies,
    'release-gate': t.subviewReleaseGate,
    'external-agents': t.subviewExternalAgents,
    'memory-graph': t.subviewMemoryGraph,
    'compute-fleet': t.subviewComputeFleet,
    'finops-omnichannel': t.subviewFinopsOmnichannel,
    'health-monitor': t.subviewHealthMonitor,
    'architecture-map': t.subviewArchitectureMap,
    'github-pipeline': t.subviewGithubPipeline,
    'agent-swarm': t.subviewAgentSwarm,
    'task-queue': t.subviewTaskQueue,
    'schema-parity': t.subviewSchemaParity,
    'llm-gateway': t.subviewLlmGateway,
    'provider-keys': t.subviewProviderKeys,
    security: t.subviewSecurity,
    'system-audit': t.subviewSystemAudit,
    customers: t.subviewCustomers,
    'team-access': t.teamTitle,
    backups: t.bkTitle,
    'mcp-tower': t.subviewMcpTower,
  };
  return localizedMap[tab] || SUBVIEW_TITLES[tab] || t.workspaceFallbackTitle;
}
