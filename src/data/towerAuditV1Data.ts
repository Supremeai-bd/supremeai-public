// বাংলা মন্তব্য: ২৫ নভেম্বর ২০২৬-এর SupremeAI Tower Audit v1.0 (ZIP 2) থেকে সংগৃহীত
// ১৭টি ফাইন্ডিং (SA-01..SA-17), রিলিজ ম্যাট্রিক্স, Quick Wins, Guardrails ও ৯০-দিনের রোডম্যাপ।

export type TowerSeverity = 'P0' | 'P1' | 'P2';

export interface TowerFinding {
  id: string;
  severity: TowerSeverity;
  area: string;
  title: string;
  oneLiner: string;
  evidence: string[];
  fix: string[];
  impact: string;
  effort: string;
  owner: string;
  gate: string;
}

export interface TowerDomainScore {
  id: string;
  label: string;
  value: number;
  target: number;
  weight: number;
  summary: string;
  tone: 'good' | 'warn' | 'bad';
}

export interface TowerQuickWin {
  id: string;
  title: string;
  detail: string;
  effort: string;
  gain: string;
  owner: string;
}

export interface TowerGuardrail {
  id: string;
  title: string;
  detail: string;
  snippet: string;
}

export interface TowerPhase {
  id: string;
  window: string;
  label: string;
  theme: string;
  summary: string;
  workstreams: { title: string; items: string[] }[];
  exit: string[];
}

export interface TowerReleaseRow {
  target: string;
  advertised: string;
  actual: string;
  status: 'pass' | 'warn' | 'fail';
}

export const towerAuditMeta = {
  title: 'SupremeAI Tower Audit',
  version: '1.0',
  auditedAt: '25 Nov 2026',
  auditedTime: '16:08 UTC',
  scope: '4 surfaces, 2 repositories, 13–14 services',
  overall: 64,
  grade: 'C+',
  gradeLabel: 'Solid foundation — release gates must close before scale',
};

export const towerDomainScores: TowerDomainScore[] = [
  {
    id: 'platform',
    label: 'Platform availability',
    value: 92,
    target: 99.9,
    weight: 15,
    summary: '13 services answer, 12 healthy. Control Tower self-reports degraded.',
    tone: 'good',
  },
  {
    id: 'security',
    label: 'Security posture',
    value: 58,
    target: 90,
    weight: 20,
    summary: 'Strong baseline headers, but localhost CORS regex & broad CSP eval remain.',
    tone: 'bad',
  },
  {
    id: 'release',
    label: 'Release integrity',
    value: 42,
    target: 95,
    weight: 15,
    summary: 'Studio advertises 2.5.0 while GitHub latest release is v0.1.0 without APK.',
    tone: 'bad',
  },
  {
    id: 'frontend',
    label: 'Frontend performance',
    value: 56,
    target: 90,
    weight: 15,
    summary: '1.44 MB raw JS + 239 KB CSS loaded up front before first prompt.',
    tone: 'bad',
  },
  {
    id: 'observability',
    label: 'Observability',
    value: 74,
    target: 95,
    weight: 10,
    summary: 'HTTP probes only; no synthetic chat journey, SLOs or burn-rate alerts.',
    tone: 'warn',
  },
  {
    id: 'dx',
    label: 'DX & CI',
    value: 58,
    target: 90,
    weight: 10,
    summary: 'Main has red key-health sweep; server.ts monolith & dual lockfiles.',
    tone: 'bad',
  },
  {
    id: 'product',
    label: 'Product & growth',
    value: 52,
    target: 85,
    weight: 10,
    summary: 'Polished shell, empty first-run state and 0-star GitHub front door.',
    tone: 'warn',
  },
  {
    id: 'docs',
    label: 'Docs & transparency',
    value: 76,
    target: 92,
    weight: 5,
    summary: 'Rich bilingual docs, but versioned facts & repo visibility claims drifted.',
    tone: 'warn',
  },
];

export const towerReleaseMatrix: TowerReleaseRow[] = [
  { target: 'Web (Studio)', advertised: '2.5.0', actual: 'Live · 2.5.0 API', status: 'pass' },
  { target: 'Windows · setup.exe', advertised: '2.5.0', actual: 'Only 0.1.0 attached', status: 'fail' },
  { target: 'Windows · .msi', advertised: '2.5.0', actual: 'Only 0.1.0 attached', status: 'fail' },
  { target: 'Android · APK', advertised: '2.5.0', actual: 'No asset found', status: 'fail' },
  { target: 'VS Code extension', advertised: '2.5.0', actual: 'Not in latest release', status: 'warn' },
];

export const towerFindings: TowerFinding[] = [
  {
    id: 'SA-01',
    severity: 'P0',
    area: 'Release engineering',
    title: 'Published download links point at artifacts that do not exist',
    oneLiner: 'App reports 2.5.0, but GitHub newest release is v0.1.0 with no Android APK.',
    evidence: [
      'GET /api/releases/latest -> version 2.5.0 with /latest/ download URLs.',
      'GitHub latest release is v0.1.0 (only 0.1.0 .exe 2.5 MB and .msi 3.4 MB attached).',
    ],
    fix: [
      'Publish immutable v2.5.0 release with Windows, macOS, Linux, Android artifacts + SHA256SUMS.',
      'Resolve /api/releases/latest URLs from GitHub Releases API instead of hardcoded /latest/ strings.',
      'Add a release smoke gate that HEADs every advertised URL before deploy.',
    ],
    impact: 'Install CTAs and auto-updaters resolve to 404s.',
    effort: '1–2 days',
    owner: 'Release / desktop',
    gate: 'Blocked until released',
  },
  {
    id: 'SA-17',
    severity: 'P0',
    area: 'CORS / session security',
    title: 'Localhost origin regex active in production CORS middleware',
    oneLiner: 'Requests with localhost Origin receive Access-Control-Allow-Origin reflection with credentials.',
    evidence: [
      'GET /api/health with Origin: http://localhost:4174 reflected origin with credentials: true.',
      'Core/Gateway CORS fixed in supremeai (gated to local/dev/test); verify Cloudflare edge helper parity.',
    ],
    fix: [
      'Ensure production CORS_ORIGIN_REGEX is empty unless explicitly opted in.',
      'Keep explicit allowlist (studio, pages preview, Tauri) and add negative CORS integration test.',
    ],
    impact: 'Localhost or foreign origins could drive credentialed browser requests.',
    effort: '2–4 hours',
    owner: 'Edge / API security',
    gate: 'Blocked until CORS test green',
  },
  {
    id: 'SA-02',
    severity: 'P0',
    area: 'API contracts',
    title: 'Health and billing metadata contradict the model catalog',
    oneLiner: 'modelsCount is 1 while /api/models serves 7; plan limits say 32k–1M vs 1M–2M+.',
    evidence: [
      'GET /api/health -> modelsCount: 1, hasApiKey: false.',
      'GET /api/models -> 7 models claiming 1,000,000+ to 2,000,000+ context.',
    ],
    fix: [
      'Create single contracts catalog JSON for /api/health, /api/models, and pricing UI.',
      'Replace hasApiKey with aggregate providerReadiness enum.',
    ],
    impact: 'Contradictory limits undermine pricing and support trust.',
    effort: '0.5–1 day',
    owner: 'Platform / billing',
    gate: 'Contract parity test',
  },
  {
    id: 'SA-03',
    severity: 'P0',
    area: 'CI / main branch',
    title: 'Main is red and pipeline-failure queue has unowned holds',
    oneLiner: 'Daily Key Health Sweep is RED on main (#769) with 4 open pipeline holds.',
    evidence: [
      'Work order #769 (Daily Key Health Sweep RED) + #786/#785/#768 PR holds.',
      '15 open work orders; 0 autonomous builders online at audit snapshot.',
    ],
    fix: [
      'Collapse duplicate pipeline failures into one incident per root cause.',
      'Rotate failing key-health provider, add failover path, and require green main checks.',
    ],
    impact: 'Red main blocks surface releases and accumulates hold noise.',
    effort: '1–2 days',
    owner: 'CI owners',
    gate: '7 green days on main',
  },
  {
    id: 'SA-04',
    severity: 'P0',
    area: 'SEO / security discovery',
    title: 'security.txt and sitemap.xml return SPA HTML (soft-404)',
    oneLiner: '/security.txt, /.well-known/security.txt, and /sitemap.xml return 200 text/html.',
    evidence: [
      'GET /.well-known/security.txt -> 200 text/html instead of text/plain.',
      'GET /sitemap.xml -> 200 text/html instead of application/xml.',
    ],
    fix: [
      'Publish static /.well-known/security.txt (Preferred-Languages: en, bn) and real sitemap.xml.',
      'Reference sitemap in robots.txt and assert content-type in CI.',
    ],
    impact: 'Search crawlers penalize soft-404s; researchers cannot find disclosure contact.',
    effort: '2 hours',
    owner: 'Web platform',
    gate: 'Header & discovery check',
  },
  {
    id: 'SA-05',
    severity: 'P0',
    area: 'Frontend performance',
    title: '1.44 MB of raw JS ships before the first prompt',
    oneLiner: 'Main bundle 1,146 KB + vendor-react 223 KB + vendor-icons 74 KB + 239 KB CSS.',
    evidence: [
      'Monaco, Three.js, TensorFlow/MediaPipe, xterm, and recharts are in the tree.',
      'No route-level split on initial empty chat screen.',
    ],
    fix: [
      'Lazy-load Workspace, terminal, hologram, and vision modules with React.lazy + Suspense.',
      'Import lucide-react icons per-symbol or split admin/workspace chunks; enforce < 300 KB gz budget.',
    ],
    impact: 'Mobile users on slower networks experience delayed first paint.',
    effort: '2–4 days',
    owner: 'Frontend guild',
    gate: 'Lighthouse CI budget',
  },
  {
    id: 'SA-06',
    severity: 'P1',
    area: 'Control Tower / MCP',
    title: 'Tower telemetry disagrees across summary, status, and health',
    oneLiner: 'system_summary says 13/13, status says 14/14, health says 12 healthy + 1 degraded.',
    evidence: [
      'render-mcp is degraded (215 ms) while headline reports all-available.',
      'agent-999 probe slot expired at 8h 35m; Redis primary hit 96% soft quota.',
    ],
    fix: [
      'Derive summary/status/health from one registry snapshot and split available vs healthy counts.',
      'Expire idle probe/guest slots and configure Cloudflare deployment identity.',
    ],
    impact: 'Operators cannot fully trust the single-pane telemetry.',
    effort: '2–3 days',
    owner: 'Tower',
    gate: 'SLO contract test',
  },
  {
    id: 'SA-07',
    severity: 'P1',
    area: 'MCP authorization',
    title: 'Work-order queue accessible to unauthenticated MCP guests',
    oneLiner: 'Anonymous MCP callers receive private-repo work orders and guest client IDs.',
    evidence: [
      'bridge_work_queue returned 15 issues from Supremeai-bd/supremeai to guest caller.',
    ],
    fix: [
      'Add tool-level scopes (public read vs authenticated queue vs write) with per-key rate limits.',
      'Redact clientId/tenantId from public agent_status.',
    ],
    impact: 'Internal planning and agent metadata leak to anonymous callers.',
    effort: '2 days',
    owner: 'Tower security',
    gate: 'Threat model + scopes',
  },
  {
    id: 'SA-08',
    severity: 'P1',
    area: 'Content security policy',
    title: 'CSP allows unsafe-inline, unsafe-eval and third-party script CDNs',
    oneLiner: 'script-src permits eval and unpkg/jsdelivr/esm.sh/cdn.tailwindcss.com.',
    evidence: [
      'connect-src allows wildcard https: and wss: instead of exact gateway/Supabase origins.',
    ],
    fix: [
      'Remove unused script CDNs, move to nonce/hash script-src, and allowlist connect-src origins.',
      'Report CSP violations to /api/telemetry/client-error.',
    ],
    impact: 'Increases XSS blast radius on admin and vault sessions.',
    effort: '1–2 days',
    owner: 'Web security',
    gate: 'CSP enforce',
  },
  {
    id: 'SA-09',
    severity: 'P1',
    area: 'Secrets management',
    title: '758 env variables live in one .env.example template',
    oneLiner: 'Admin signing, DB service role, billing, and provider keys are documented in one file.',
    evidence: [
      'Verified in supremeai/.env.example (auto-generated from CONFIG_SPECS with 424 canonical keys).',
    ],
    fix: [
      'Keep Infisical as SSOT and emit surface-scoped templates (core, gateway, tower, worker).',
      'Enforce gitleaks + GitHub push protection and quarterly key rotation.',
    ],
    impact: 'Large blast radius if any local .env is accidentally committed.',
    effort: '1–2 days',
    owner: 'Platform security',
    gate: 'Secret scan = 0',
  },
  {
    id: 'SA-10',
    severity: 'P1',
    area: 'Security policy',
    title: 'SECURITY.md listed 1.x and personal Gmail (Fixed in core)',
    oneLiner: 'Updated in supremeai/SECURITY.md to 2.5.x with security@supremeai.com and SLA.',
    evidence: [
      'Core SECURITY.md updated on 25 Nov 2026; verify supremeai-public SECURITY.md parity.',
    ],
    fix: [
      'Sync SECURITY.md to supremeai-public and publish /.well-known/security.txt.',
    ],
    impact: 'Consistent researcher intake across both repositories.',
    effort: '30 min',
    owner: 'Security lead',
    gate: 'Policy synced',
  },
  {
    id: 'SA-11',
    severity: 'P1',
    area: 'Observability',
    title: 'HTTP probes alone cannot prove end-to-end chat works',
    oneLiner: 'No synthetic chat journey, OTel request-ID tracing, or burn-rate SLO alerts.',
    evidence: [
      'system_health reports ping latency (2–677 ms) without first-token or billing assertions.',
    ],
    fix: [
      'Run 5-minute synthetic journey (guest -> prompt -> first token -> debit) with OTel traces.',
      'Alert on 2% multi-window error budget burn to Telegram.',
    ],
    impact: 'Auth, streaming, or billing regressions can hide behind green HTTP 200s.',
    effort: '3–5 days',
    owner: 'SRE',
    gate: 'SLO + synthetic live',
  },
  {
    id: 'SA-12',
    severity: 'P1',
    area: 'Monorepo hygiene',
    title: '11.7k-line server.ts, 734 ops scripts, and dual lockfiles',
    oneLiner: 'Both bun.lock and package-lock.json exist in supremeai-public; server.ts has 141 routes.',
    evidence: [
      'Core repo has no JS lockfiles; dual lockfiles and server.ts monolith live in supremeai-public.',
    ],
    fix: [
      'Standardize on one lockfile in supremeai-public and split server.ts into modular routers.',
    ],
    impact: 'Increases change blast radius and CI install drift.',
    effort: '2–4 weeks incremental',
    owner: 'Core platform',
    gate: 'Router split phase 1',
  },
  {
    id: 'SA-13',
    severity: 'P2',
    area: 'Product onboarding',
    title: 'Empty first-run canvas without starter prompts or JARVIS guide',
    oneLiner: 'New visitors see a blank center panel and locked nav items before sign-in.',
    evidence: ['No bilingual starter cards or guest demo turn on initial load.'],
    fix: ['Add 3 bilingual starter cards and allow 1 guest demo turn before sign-up prompt.'],
    impact: 'Lower guest-to-prompt conversion.',
    effort: '2–3 days',
    owner: 'Product design',
    gate: 'First-prompt funnel',
  },
  {
    id: 'SA-14',
    severity: 'P2',
    area: 'Localization',
    title: 'Planning docs mix unexpected scripts into Bengali prose',
    oneLiner: 'Mixed Chinese/Cyrillic tokens found in TASK_LIST_SUPREMEAI_PUBLIC.md.',
    evidence: ['API errors remain English-only despite en/bn UI parity goal.'],
    fix: ['Lint docs/i18n for unexpected scripts and map API error codes client-side in en/bn.'],
    impact: 'Reduces polish of bilingual experience.',
    effort: '1–2 days',
    owner: 'Product / DX',
    gate: 'i18n CI check',
  },
  {
    id: 'SA-15',
    severity: 'P2',
    area: 'Open-source growth',
    title: 'GitHub repo descriptions show a raw MCP URL',
    oneLiner: 'Both repos have 0 stars/forks and raw MCP URL as description.',
    evidence: ['No issue templates or 60-second quickstart above the fold in README.'],
    fix: ['Update repo descriptions with product pitch, Studio URL, issue templates, and hero GIF.'],
    impact: 'Undersells the 4-platform ecosystem to external contributors.',
    effort: '1 day',
    owner: 'DevRel',
    gate: 'Front door refresh',
  },
  {
    id: 'SA-16',
    severity: 'P2',
    area: 'Metadata / social',
    title: 'Social preview is a 689 KB PNG without JSON-LD',
    oneLiner: 'og:image is 689 KB PNG; no twitter:image or SoftwareApplication JSON-LD.',
    evidence: ['Third-party font origins are render-blocking on critical path.'],
    fix: ['Ship 1200x630 WebP/AVIF < 200 KB, add JSON-LD, and self-host subset fonts.'],
    impact: 'Slower social unfurls and weaker search rich results.',
    effort: '4 hours',
    owner: 'Web marketing',
    gate: 'Share card QA',
  },
];

export const towerQuickWins: TowerQuickWin[] = [
  { id: 'QW1', title: 'Publish real v2.5.0 release + checksums', detail: 'Attach Windows, macOS, Linux, Android builds; remove dead /latest/ links.', effort: '2–4 h', gain: 'Restores download CTAs', owner: 'Release' },
  { id: 'QW2', title: 'Update GitHub repo descriptions', detail: 'Replace raw MCP URL with product pitch and Studio homepage.', effort: '10 min', gain: 'Credibility on share', owner: 'DevRel' },
  { id: 'QW3', title: 'Ship security.txt + sitemap.xml', detail: 'Serve static files with correct content-type and robots.txt reference.', effort: '30 min', gain: 'Fixes 3 soft-404s', owner: 'Web' },
  { id: 'QW4', title: 'Generate health from model catalog', detail: 'Single contracts JSON for /api/health, /api/models, and pricing.', effort: '4–6 h', gain: 'Ends contradictory limits', owner: 'Platform' },
  { id: 'QW5', title: 'Replace empty first-run state', detail: 'Three bilingual starter prompts + 1 guest demo turn.', effort: '1–2 d', gain: 'Lifts first-prompt rate', owner: 'Product' },
  { id: 'QW6', title: 'Green main + required checks', detail: 'Collapse duplicate failure issues and fix red daily key sweep.', effort: '2 h', gain: 'Unblocks releases', owner: 'CI' },
  { id: 'QW7', title: 'Trim initial JS payload', detail: 'Lazy-load workspace, 3D, terminal, vision; target < 300 KB gz.', effort: '1–2 d', gain: 'Faster first paint', owner: 'Frontend' },
  { id: 'QW8', title: 'Enforce single lockfile', detail: 'Keep one lockfile in supremeai-public and retire dead ops scripts.', effort: '1 d', gain: 'Lower change risk', owner: 'Core' },
];

export const towerGuardrails: TowerGuardrail[] = [
  { id: 'G1', title: 'Contract parity test', detail: 'Assert /api/health, /api/models, and pricing UI agree on counts and limits.', snippet: 'npm run test:contracts' },
  { id: 'G2', title: 'Release URL smoke', detail: 'HEAD every advertised artifact; fail on non-200 or missing checksum.', snippet: 'node scripts/verify-release.mjs' },
  { id: 'G3', title: 'Frontend budget', detail: 'Lighthouse CI hard-fail above 300 KB gz JS or 60 KB gz CSS.', snippet: 'npx lhci autorun' },
  { id: 'G4', title: 'Header & discovery test', detail: 'Assert status code and content-type for security.txt, sitemap.xml, CSP.', snippet: 'curl -sI /.well-known/security.txt' },
  { id: 'G5', title: 'Secret scan', detail: 'gitleaks + GitHub push protection on every PR.', snippet: 'gitleaks detect --redact' },
  { id: 'G6', title: 'Synthetic chat SLO', detail: 'Prompt -> first token -> debit every 5 min; alert on 2% burn.', snippet: 'POST /api/chat (synthetic)' },
];

export const towerPhases: TowerPhase[] = [
  {
    id: 'now',
    window: '0–14 days',
    label: 'Phase 01',
    theme: 'Stop the bleeding',
    summary: 'Close trust-breaking P0s across release links, API contracts, CI main, and web headers.',
    workstreams: [
      { title: 'Release', items: ['Publish v2.5.0 with 4-platform artifacts + SHA256SUMS', 'Resolve download URLs from GitHub API'] },
      { title: 'Truth & CI', items: ['Single model/plan contract for health & models', 'Fix red daily key sweep on main'] },
      { title: 'Web & Security', items: ['Ship security.txt, sitemap.xml, true 404s', 'Remove unsafe-eval and third-party script CDNs'] },
    ],
    exit: ['Main green 7 consecutive days', '0 advertised download URLs 404', 'Contract parity & CORS tests enforced'],
  },
  {
    id: 'next',
    window: '15–45 days',
    label: 'Phase 02',
    theme: 'Make it provable',
    summary: 'Add synthetic chat SLOs, scoped MCP authorization, Infisical-only secrets, and onboarding.',
    workstreams: [
      { title: 'Reliability & Tower', items: ['5-min synthetic chat journey + OTel traces', 'Single registry snapshot & scoped MCP tools'] },
      { title: 'Security & Product', items: ['Nonces/hashes CSP & secret rotation', 'Bilingual starter prompts + model cards'] },
    ],
    exit: ['99.5% synthetic chat availability', 'Secret scan findings = 0', 'First-prompt conversion +15%'],
  },
  {
    id: 'scale',
    window: '46–90 days',
    label: 'Phase 03',
    theme: 'Scale the platform',
    summary: 'Pay down monolith debt and turn the open-source front door into a growth channel.',
    workstreams: [
      { title: 'Architecture', items: ['Split server.ts into modular routers', 'Single lockfile + prune unreferenced ops scripts'] },
      { title: 'Experience & Growth', items: ['< 300 KB gz initial JS', 'Signed 4-platform release train & contributor templates'] },
    ],
    exit: ['All 4 surfaces ship from one tag', 'Initial JS budget permanently green'],
  },
];

export function buildTowerAuditMarkdown(): string {
  const lines: string[] = [
    `# ${towerAuditMeta.title} — v${towerAuditMeta.version}`,
    '',
    `**Audited:** ${towerAuditMeta.auditedAt} · ${towerAuditMeta.auditedTime}`,
    `**Overall:** ${towerAuditMeta.overall}/100 (${towerAuditMeta.grade}) — ${towerAuditMeta.gradeLabel}`,
    '',
    '## Findings',
  ];
  towerFindings.forEach((f) => {
    lines.push('');
    lines.push(`### [${f.severity}] ${f.id} — ${f.title}`);
    lines.push(f.oneLiner);
    lines.push(`- **Impact:** ${f.impact}`);
    lines.push(`- **Fix:** ${f.fix.join(' | ')}`);
    lines.push(`- **Owner:** ${f.owner} · **Effort:** ${f.effort}`);
  });
  lines.push('');
  lines.push('## Quick Wins');
  towerQuickWins.forEach((q) => {
    lines.push(`- [ ] **${q.id}: ${q.title}** (${q.effort}) — ${q.detail}`);
  });
  return lines.join('\n');
}
