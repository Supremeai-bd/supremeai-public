// বাংলা মন্তব্য: File 2 (build-interactive-admin-graphs_(1)) থেকে সংগৃহীত প্ল্যানেটারি অরবিটাল লেআউট ইঞ্জিন
// এবং File 1-এর টেলিমেট্রি মেট্রিক্স (latency, buildMinutes, quota) একত্রিত করে পিওর টাইপস্ক্রিপ্ট মডিউল।

export type MeshNodeKind =
  | 'tower'
  | 'provider'
  | 'repo'
  | 'frontend'
  | 'service'
  | 'agent';

export type MeshNodeStatus = 'healthy' | 'degraded' | 'drift' | 'offline';

export interface MeshNode {
  id: string;
  kind: MeshNodeKind;
  label: string;
  subtitle: string;
  status: MeshNodeStatus;
  provider?: string;
  url?: string;
  latencyMs?: number;
  sha?: string;
  metadata: Record<string, string | number | boolean>;
}

export interface MeshEdge {
  id: string;
  source: string;
  target: string;
  kind: 'control' | 'runtime' | 'data' | 'deploy';
  label?: string;
}

export interface PlacedMeshNode extends MeshNode {
  x: number;
  y: number;
  r: number;
}

export const WORLD = { width: 1200, height: 860 };
export const CENTER = { x: WORLD.width / 2, y: WORLD.height / 2 };

export const KIND_ORDER: MeshNodeKind[] = [
  'tower',
  'provider',
  'repo',
  'frontend',
  'service',
  'agent',
];

export const KIND_META: Record<
  MeshNodeKind,
  {
    label: string;
    ring: number;
    accent: string;
    radius: number;
    description: string;
  }
> = {
  tower: {
    label: 'Control Tower',
    ring: 0,
    accent: '#38bdf8',
    radius: 36,
    description: 'MCP Control Plane at the center of the SupremeAI federation.',
  },
  provider: {
    label: 'Cloud Provider',
    ring: 145,
    accent: '#a78bfa',
    radius: 22,
    description: 'Managed infrastructure & state providers.',
  },
  repo: {
    label: 'Repository',
    ring: 245,
    accent: '#fbbf24',
    radius: 19,
    description: 'Canonical GitHub source-of-truth repositories.',
  },
  frontend: {
    label: 'Client / Edge',
    ring: 245,
    accent: '#34d399',
    radius: 19,
    description: 'User-facing Studio, Desktop, Android & Edge surfaces.',
  },
  service: {
    label: 'Runtime Service',
    ring: 345,
    accent: '#60a5fa',
    radius: 20,
    description: 'Live Render backend fleet & worker nodes.',
  },
  agent: {
    label: 'AI / Agent',
    ring: 395,
    accent: '#f472b6',
    radius: 17,
    description: 'Autonomous CI guards and tiny-brain routers.',
  },
};

export const STATUS_META: Record<
  MeshNodeStatus,
  { label: string; color: string; bg: string; border: string }
> = {
  healthy: {
    label: 'Healthy',
    color: '#34d399',
    bg: 'rgba(52,211,153,0.12)',
    border: 'rgba(52,211,153,0.45)',
  },
  degraded: {
    label: 'Degraded',
    color: '#fbbf24',
    bg: 'rgba(251,191,36,0.12)',
    border: 'rgba(251,191,36,0.45)',
  },
  drift: {
    label: 'SHA Drift',
    color: '#fb7185',
    bg: 'rgba(251,113,133,0.14)',
    border: 'rgba(251,113,133,0.5)',
  },
  offline: {
    label: 'Offline',
    color: '#94a3b8',
    bg: 'rgba(148,163,184,0.12)',
    border: 'rgba(148,163,184,0.35)',
  },
};

export const EDGE_COLORS: Record<MeshEdge['kind'], string> = {
  control: 'rgba(56,189,248,0.42)',
  runtime: 'rgba(96,165,250,0.36)',
  data: 'rgba(167,139,250,0.38)',
  deploy: 'rgba(251,191,36,0.35)',
};

// বাংলা মন্তব্য: সুপ্রিমএআই ফেডারেশনের লাইভ নোড ও এজের ক্যানোনিকাল গ্রাফ ডেটা
export const SUPREMEAI_MESH_NODES: MeshNode[] = [
  {
    id: 'tower-mcp',
    kind: 'tower',
    label: 'MCP Control Tower',
    subtitle: 'v2.5 · Control Plane',
    status: 'healthy',
    provider: 'Render',
    url: 'https://supremeai-mcp-tower-live.onrender.com/mcp',
    latencyMs: 142,
    sha: '98d8cd8',
    metadata: { tools: 135, region: 'Singapore', role: 'Central Orchestrator' },
  },
  // Providers (Ring 1)
  {
    id: 'prov-cloudflare',
    kind: 'provider',
    label: 'Cloudflare Edge',
    subtitle: 'Pages + Workers',
    status: 'healthy',
    latencyMs: 38,
    metadata: { accounts: 5, workerStatus: 200, cdn: 'Global' },
  },
  {
    id: 'prov-supabase',
    kind: 'provider',
    label: 'Supabase Postgres',
    subtitle: '154 tables · Auth',
    status: 'healthy',
    latencyMs: 64,
    metadata: { projectRef: 'xtvkltzmberxekoamala', tables: 154 },
  },
  {
    id: 'prov-redis',
    kind: 'provider',
    label: 'Upstash Redis',
    subtitle: '5-acct chain (secondary)',
    status: 'healthy',
    latencyMs: 29,
    metadata: { activeSlot: 'secondary', quotaUsedPct: 75, failover: true },
  },
  {
    id: 'prov-infisical',
    kind: 'provider',
    label: 'Infisical Secrets',
    subtitle: '4/4 core secrets',
    status: 'healthy',
    latencyMs: 51,
    metadata: { machineIdentity: true, verified: '4/4' },
  },
  {
    id: 'prov-render',
    kind: 'provider',
    label: 'Render Fleet',
    subtitle: '6 services · 177/500m',
    status: 'degraded',
    latencyMs: 180,
    metadata: { buildMinutesUsed: 177.2, buildMinutesLimit: 500, plan: 'free' },
  },
  // Repos & Frontends (Ring 2)
  {
    id: 'repo-core',
    kind: 'repo',
    label: 'supremeai (Core)',
    subtitle: 'main · b5ebd12',
    status: 'healthy',
    url: 'https://github.com/Supremeai-bd/supremeai',
    sha: 'b5ebd12',
    metadata: { modules: 2197, reachable: 1668, ciStatus: 'passing' },
  },
  {
    id: 'repo-public',
    kind: 'repo',
    label: 'supremeai-public',
    subtitle: 'main · 62611a9',
    status: 'healthy',
    url: 'https://github.com/Supremeai-bd/supremeai-public',
    sha: '62611a9',
    metadata: { framework: 'React 19 + Vite', guardrails: '4/4 passing' },
  },
  {
    id: 'fe-studio',
    kind: 'frontend',
    label: 'Studio Web',
    subtitle: 'supremeai-studio.pages.dev',
    status: 'healthy',
    url: 'https://supremeai-studio.pages.dev',
    latencyMs: 44,
    metadata: { modelsCount: 7, cspHardened: true },
  },
  {
    id: 'fe-desktop',
    kind: 'frontend',
    label: 'Desktop + Android',
    subtitle: 'Tauri v2 · Win / APK',
    status: 'healthy',
    metadata: { version: '2.5.0', targets: 'Windows, Android' },
  },
  // Runtime Services (Ring 3)
  {
    id: 'svc-primary',
    kind: 'service',
    label: 'Primary Core Node',
    subtitle: 'core/main.py',
    status: 'drift',
    provider: 'Render',
    url: 'https://supremeai-primary-node-5xso.onrender.com',
    latencyMs: 215,
    sha: '68a1287',
    metadata: { intendedSha: 'b5ebd12', deployedSha: '68a1287', region: 'Singapore' },
  },
  {
    id: 'svc-api',
    kind: 'service',
    label: 'Gateway API Shield',
    subtitle: 'gateway/service/app.py',
    status: 'drift',
    provider: 'Render',
    url: 'https://supremeai-api-ulw0.onrender.com',
    latencyMs: 168,
    sha: '68a1287',
    metadata: { corsHardened: true, intendedSha: 'b5ebd12' },
  },
  {
    id: 'svc-worker',
    kind: 'service',
    label: 'Async Worker Node',
    subtitle: 'Background jobs',
    status: 'drift',
    provider: 'Render',
    url: 'https://supremeai-worker-node.onrender.com',
    latencyMs: 192,
    sha: '68a1287',
    metadata: { role: 'async-worker', intendedSha: 'b5ebd12' },
  },
  {
    id: 'svc-scraper',
    kind: 'service',
    label: 'Scraper Node',
    subtitle: 'Browser / Extraction',
    status: 'drift',
    provider: 'Render',
    url: 'https://supremeai-scraper-node.onrender.com',
    latencyMs: 240,
    sha: '68a1287',
    metadata: { role: 'browser-scraper', intendedSha: 'b5ebd12' },
  },
  {
    id: 'svc-brain',
    kind: 'service',
    label: 'Tiny AI Brain',
    subtitle: 'Fast Router & Guard',
    status: 'drift',
    provider: 'Render',
    url: 'https://supremeai-tiny-brain.onrender.com',
    latencyMs: 134,
    sha: '68a1287',
    metadata: { role: 'micro-ai-brain', intendedSha: 'b5ebd12' },
  },
  // Agents (Ring 4)
  {
    id: 'agent-pr-guard',
    kind: 'agent',
    label: 'PR Landing Guard',
    subtitle: 'Unified CI Gate',
    status: 'healthy',
    latencyMs: 88,
    metadata: { workflow: 'unified-pipeline.yml', status: 'green' },
  },
  {
    id: 'agent-telegram',
    kind: 'agent',
    label: 'Telegram Alert Bot',
    subtitle: 'Quota & Drift Alerts',
    status: 'healthy',
    latencyMs: 95,
    metadata: { lastMsgId: 1973, channel: 'Admin Ops' },
  },
];

export const SUPREMEAI_MESH_EDGES: MeshEdge[] = [
  { id: 'e1', source: 'tower-mcp', target: 'prov-cloudflare', kind: 'control' },
  { id: 'e2', source: 'tower-mcp', target: 'prov-supabase', kind: 'data' },
  { id: 'e3', source: 'tower-mcp', target: 'prov-redis', kind: 'data' },
  { id: 'e4', source: 'tower-mcp', target: 'prov-infisical', kind: 'control' },
  { id: 'e5', source: 'tower-mcp', target: 'prov-render', kind: 'control' },
  { id: 'e6', source: 'repo-core', target: 'prov-render', kind: 'deploy', label: 'b5ebd12' },
  { id: 'e7', source: 'repo-public', target: 'prov-cloudflare', kind: 'deploy', label: '62611a9' },
  { id: 'e8', source: 'fe-studio', target: 'prov-cloudflare', kind: 'runtime' },
  { id: 'e9', source: 'fe-desktop', target: 'svc-api', kind: 'runtime' },
  { id: 'e10', source: 'prov-cloudflare', target: 'svc-api', kind: 'runtime' },
  { id: 'e11', source: 'prov-render', target: 'svc-primary', kind: 'runtime' },
  { id: 'e12', source: 'prov-render', target: 'svc-api', kind: 'runtime' },
  { id: 'e13', source: 'prov-render', target: 'svc-worker', kind: 'runtime' },
  { id: 'e14', source: 'prov-render', target: 'svc-scraper', kind: 'runtime' },
  { id: 'e15', source: 'prov-render', target: 'svc-brain', kind: 'runtime' },
  { id: 'e16', source: 'svc-primary', target: 'prov-supabase', kind: 'data' },
  { id: 'e17', source: 'svc-primary', target: 'prov-redis', kind: 'data' },
  { id: 'e18', source: 'agent-pr-guard', target: 'repo-core', kind: 'control' },
  { id: 'e19', source: 'agent-telegram', target: 'tower-mcp', kind: 'control' },
];

export interface QuotaMetric {
  id: string;
  label: string;
  used: number;
  limit: number;
  unit: string;
  tone: 'emerald' | 'amber' | 'rose';
}

export const SUPREMEAI_QUOTA_METRICS: QuotaMetric[] = [
  { id: 'render-build', label: 'Render Free Build Minutes', used: 177.2, limit: 500, unit: 'min', tone: 'emerald' },
  { id: 'redis-quota', label: 'Upstash Redis Primary Quota', used: 75, limit: 100, unit: '%', tone: 'amber' },
  { id: 'core-reachable', label: 'Core Architecture Reachability', used: 1668, limit: 2197, unit: 'mods', tone: 'emerald' },
  { id: 'sha-parity', label: 'Render Fleet SHA Parity', used: 0, limit: 6, unit: 'svcs', tone: 'rose' },
];

/**
 * বাংলা মন্তব্য: প্রতিটি নোডকে তার রিং অনুযায়ী সমান কৌণিক দূরত্বে (Radial Orbit) পজিশন করে।
 */
export function buildPlanetaryLayout(nodes: MeshNode[]): Map<string, PlacedMeshNode> {
  const placed = new Map<string, PlacedMeshNode>();

  const byRing = new Map<number, MeshNode[]>();
  for (const node of nodes) {
    const ring = KIND_META[node.kind].ring;
    const list = byRing.get(ring) ?? [];
    list.push(node);
    byRing.set(ring, list);
  }

  for (const [ring, group] of byRing.entries()) {
    if (ring === 0) {
      for (const n of group) {
        placed.set(n.id, {
          ...n,
          x: CENTER.x,
          y: CENTER.y,
          r: KIND_META[n.kind].radius,
        });
      }
      continue;
    }

    const angleOffset = (ring % 100) * 0.018;
    group.forEach((n, idx) => {
      const angle = (Math.PI * 2 * idx) / group.length - Math.PI / 2 + angleOffset;
      placed.set(n.id, {
        ...n,
        x: CENTER.x + Math.cos(angle) * ring * 1.18,
        y: CENTER.y + Math.sin(angle) * ring * 0.92,
        r: KIND_META[n.kind].radius,
      });
    });
  }

  return placed;
}

/** দুটি নোডের মধ্যে মসৃণ কোয়াড্রাটিক বেজিয়ার কার্ভ পাথ তৈরি করে */
export function edgePath(a: PlacedMeshNode, b: PlacedMeshNode): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const cx = mx - dy * 0.08;
  const cy = my + dx * 0.08;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}
