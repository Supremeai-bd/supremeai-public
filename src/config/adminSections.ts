/**
 * বাংলা মন্তব্য: অ্যাডমিন কনসোলের একমাত্র কাঠামো (SSOT)। আগে ১৯টা ছড়ানো ট্যাব ছিল — এখন ৯টা
 * পরিষ্কার সেকশন, প্রতিটার ভেতরে দরকারি সাব-ট্যাব। পুরনো ট্যাব আইডিগুলো সাব-ট্যাব হিসেবেই থাকে,
 * তাই পুরনো লিংক/বাটন (onNavigateTab('task-queue') ইত্যাদি) ভাঙে না।
 */

export type AdminSectionId =
  'overview' | 'services' | 'logs' | 'users' | 'ai' | 'agents' | 'security' | 'deploy' | 'settings';

export interface AdminSubTab {
  /** Routable tab id rendered by App.tsx */
  id: string;
  label: string;
}

export interface AdminSection {
  id: AdminSectionId;
  label: string;
  /** One-line plain description shown under the page title */
  description: string;
  group: 'Monitor' | 'Manage' | 'Protect & Ship' | 'Configure';
  tabs: AdminSubTab[];
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Everything at a glance — red means it needs you.',
    group: 'Monitor',
    tabs: [{ id: 'admin-overview', label: 'Overview' }],
  },
  {
    id: 'services',
    label: 'Services & Health',
    description: 'Live status, latency and resources of every service.',
    group: 'Monitor',
    tabs: [
      { id: 'health-monitor', label: 'Service Health' },
      { id: 'mcp-tower', label: 'MCP Tower' },
      { id: 'architecture-map', label: 'Topology' },
    ],
  },
  {
    id: 'logs',
    label: 'Logs',
    description: 'One timeline of logs from every provider and service.',
    group: 'Monitor',
    tabs: [{ id: 'admin-logs', label: 'All Logs' }],
  },
  {
    id: 'users',
    label: 'Users',
    description: 'Customers, team roles, plans, usage and account actions.',
    group: 'Manage',
    tabs: [
      { id: 'customers', label: 'Customers' },
      { id: 'team-access', label: 'Team & Access' },
    ],
  },
  {
    id: 'ai',
    label: 'AI & Providers',
    description: 'Provider keys, health, routing, failover and pricing.',
    group: 'Manage',
    tabs: [
      { id: 'provider-keys', label: 'Provider Keys' },
      { id: 'llm-gateway', label: 'Routing & Pricing' },
    ],
  },
  {
    id: 'agents',
    label: 'Agents & Queue',
    description: 'Background jobs, failed tasks and agent workers.',
    group: 'Manage',
    tabs: [
      { id: 'task-queue', label: 'Task Queue' },
      { id: 'agent-swarm', label: 'Agent Workers' },
      { id: 'external-agents', label: 'External Agents' },
    ],
  },
  {
    id: 'security',
    label: 'Security & Audit',
    description: 'Threats, blocked IPs, approvals and the audit trail.',
    group: 'Protect & Ship',
    tabs: [
      { id: 'security', label: 'Threats & Firewall' },
      { id: 'hitl-policies', label: 'Approvals & Policies' },
      { id: 'system-audit', label: 'Audit Trail' },
    ],
  },
  {
    id: 'deploy',
    label: 'Deploy & CI',
    description: 'GitHub pipelines, release gate and database schema.',
    group: 'Protect & Ship',
    tabs: [
      { id: 'github-pipeline', label: 'GitHub Pipeline' },
      { id: 'release-gate', label: 'Release Gate' },
      { id: 'schema-parity', label: 'Database Schema' },
    ],
  },
  {
    id: 'settings',
    label: 'Platform Settings',
    description: 'Maintenance lock, announcements, signups, features and model access.',
    group: 'Configure',
    tabs: [{ id: 'platform-settings', label: 'Platform Settings' }],
  },
];

/**
 * Tabs that still exist for old deep links but are hidden from navigation because their
 * backend returns no real data yet. They fall under the closest section for highlighting.
 */
const LEGACY_TAB_SECTION: Record<string, AdminSectionId> = {
  'compute-fleet': 'agents',
  'memory-graph': 'agents',
  'finops-omnichannel': 'settings',
};

const TAB_TO_SECTION = new Map<string, AdminSectionId>();
for (const section of ADMIN_SECTIONS) {
  for (const tab of section.tabs) TAB_TO_SECTION.set(tab.id, section.id);
}

export function findAdminSection(tabId: string | null | undefined): AdminSection | null {
  if (!tabId) return null;
  const id = TAB_TO_SECTION.get(tabId) ?? LEGACY_TAB_SECTION[tabId];
  return id ? (ADMIN_SECTIONS.find((s) => s.id === id) ?? null) : null;
}

export function getAdminSectionById(id: AdminSectionId): AdminSection {
  return ADMIN_SECTIONS.find((s) => s.id === id)!;
}

/** Every tab id reachable from the admin navigation. */
export const ADMIN_NAV_TAB_IDS: readonly string[] = ADMIN_SECTIONS.flatMap((s) =>
  s.tabs.map((t) => t.id)
);
