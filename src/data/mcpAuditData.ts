import { DEFAULT_MCP_TOWER_ORIGIN, DEFAULT_MCP_AGENT_KEY } from '../config/platformEndpoints';

export const REPO = 'Supremeai-bd/supremeai';
export const REPO_URL = `https://github.com/${REPO}`;
export const REVISION = 'acbdc50045fa1162f444a2a84a8ea50a37d21602';
export const SHORT_REVISION = REVISION.slice(0, 7);
export const SNAPSHOT_DATE = 'Nov 17, 2026';
export const SNAPSHOT_TIME = '22:21 UTC';
export const TOWER_URL = DEFAULT_MCP_TOWER_ORIGIN;
const TOWER_ENDPOINT = `${TOWER_URL}/agents/${DEFAULT_MCP_AGENT_KEY}/mcp`;
const MCP_PROTOCOL = '2025-11-25';
const MCP_REFERENCE = `https://modelcontextprotocol.io/specification/${MCP_PROTOCOL}/basic/transports`;

const towerFile = 'infrastructure/mcp-control-plane';
export const fileUrl = (path: string, lines = '') =>
  `${REPO_URL}/blob/${REVISION}/${path}${lines ? `#${lines}` : ''}`;
export const issueUrl = (number: number) => `${REPO_URL}/issues/${number}`;

export type Priority = 'High' | 'Medium' | 'Low';
export type Surface = 'MCP Tower' | 'CI/CD' | 'Gateway' | 'Operations' | 'Docs' | 'Repository';
export type EvidenceKind = 'Live observation' | 'Source review' | 'Tracked work';
export type Evidence = { label: string; href: string; detail?: string };
export type Finding = {
  id: string;
  title: string;
  priority: Priority;
  surface: Surface;
  kind: EvidenceKind;
  summary: string;
  recommendation: string;
  validation: string;
  sources: Evidence[];
};

export const federationFindings: Finding[] = [
  {
    id: 'MCP-01',
    title: 'Restrict unauthenticated tool discovery',
    priority: 'High',
    surface: 'MCP Tower',
    kind: 'Live observation',
    summary:
      'The endpoint returned 176 tool descriptors without a credential. Of those, 65 explicitly set read-only hint to false and 19 marked themselves destructive. This verifies catalog visibility, not permission to execute.',
    recommendation:
      'Publish a small explicit public catalog. Verify the deployed discovery filter is enabled and unauthenticated slot route and canonical MCP route share the same role/tool-profile policy.',
    validation:
      'In owner-controlled CI, assert that only public allowlisted descriptors are returned with no credential, and that protected tool calls fail closed under mocked dependencies.',
    sources: [
      {
        label: 'MCP endpoint',
        href: TOWER_ENDPOINT,
        detail: 'Reproduced by standard MCP discovery; protocol client required.',
      },
      {
        label: 'Tool exposure policy',
        href: fileUrl(`${towerFile}/docs/TOOL-EXPOSURE.md`, 'L20-L48'),
        detail: 'Separates discovery from authorization.',
      },
      {
        label: 'Discovery filter source',
        href: fileUrl(`${towerFile}/src/policy/tool-visibility.ts`, 'L270-L307'),
      },
    ],
  },
  {
    id: 'CI-01',
    title: 'Isolate PR tests from credentialed CI',
    priority: 'High',
    surface: 'CI/CD',
    kind: 'Source review',
    summary:
      'The heavy gate excludes forks and disables persisted checkout credentials, but same-repository PR code still runs on a persistent local-PC runner alongside credentialed verifiers.',
    recommendation:
      'Run PR tests on ephemeral, unprivileged workers. Move secret-bearing verification and publishing into separate trusted jobs with fresh workspaces and restricted permissions.',
    validation:
      'Verify job separation with CI policy checks. Confirm the PR worker has no production credentials and no reusable privileged workspace.',
    sources: [
      {
        label: 'Local-PC gate and fork restriction',
        href: fileUrl('.github/workflows/unified-pipeline.yml', 'L213-L240'),
      },
      {
        label: 'Base-ref verifier step',
        href: fileUrl('.github/workflows/unified-pipeline.yml', 'L280-L298'),
      },
    ],
  },
  {
    id: 'GW-01',
    title: 'Enforce end-to-end Gateway deadlines',
    priority: 'High',
    surface: 'Gateway',
    kind: 'Source review',
    summary:
      'The route checks deadline before starting another provider attempt, but non-streaming calls are not explicitly bounded by remaining time. Streaming passes fixed timeouts rather than route budget.',
    recommendation:
      'Pass remaining route budget down to provider attempts and first-token waits. Close upstream streams on timeout or client disconnect.',
    validation:
      'Use slow provider mocks in CI: fallback attempts must not exceed total budget, and disconnected clients must not leak upstream streams.',
    sources: [
      {
        label: 'Non-streaming provider loop',
        href: fileUrl('gateway/service/app.py', 'L2414-L2428'),
      },
      {
        label: 'Streaming connection and token waits',
        href: fileUrl('gateway/service/app.py', 'L2242-L2269'),
      },
      { label: 'Gateway follow-up #630', href: issueUrl(630) },
    ],
  },
  {
    id: 'OPS-01',
    title: 'Investigate Cloudflare unknown probe status',
    priority: 'Medium',
    surface: 'Operations',
    kind: 'Live observation',
    summary:
      'The Tower cached MCP health resource reported Cloudflare as unknown at check time. The HTTP summary classified the adapter as configured.',
    recommendation:
      'Check Cloudflare adapter configured permissions and sanitized probe output. Differentiate missing evidence, permission errors, and confirmed upstream failure in telemetry.',
    validation:
      'An authorized sweep produces either a fresh healthy result or a clear, non-sensitive reason for the unknown state.',
    sources: [
      { label: 'Tower health summary', href: `${TOWER_URL}/health/summary` },
      {
        label: 'MCP health resource implementation',
        href: fileUrl(`${towerFile}/src/index.ts`, 'L238-L255'),
      },
    ],
  },
  {
    id: 'MCP-02',
    title: 'Align Tower health counters across endpoints',
    priority: 'Medium',
    surface: 'MCP Tower',
    kind: 'Live observation',
    summary:
      '/health reported 11 healthy and 1 degraded, while /health/summary showed 10 healthy and 2 non-healthy states. Liveness aggregate excludes optional providers from unhealthy counts.',
    recommendation:
      'Define one health classification shared by HTTP endpoints and MCP resources. Return required, optional, unconfigured, and unknown counts explicitly.',
    validation:
      'Feed the same cache fixtures to all responses and verify matching per-state counts and documented readiness semantics.',
    sources: [
      {
        label: 'Tower liveness aggregate',
        href: fileUrl(`${towerFile}/src/http_server.ts`, 'L399-L441'),
      },
      {
        label: 'Tower summary aggregate',
        href: fileUrl(`${towerFile}/src/http_server.ts`, 'L568-L590'),
      },
    ],
  },
  {
    id: 'MCP-03',
    title: 'Cancel work when an MCP deadline expires',
    priority: 'Medium',
    surface: 'MCP Tower',
    kind: 'Source review',
    summary:
      'The central handler races the tool promise against a timeout. It releases the caller, but the background handler can continue consuming resources after deadline.',
    recommendation:
      'Propagate cooperative cancellation into provider requests. Protect non-cancellable operations with bounded concurrency and explicit completion states.',
    validation:
      'Unit test with cancellable mock confirms work halts on timeout and releases execution slot.',
    sources: [
      {
        label: 'Governed MCP handler timeout',
        href: fileUrl(`${towerFile}/src/index.ts`, 'L137-L167'),
      },
    ],
  },
  {
    id: 'MCP-04',
    title: 'Complete browser transport CORS headers',
    priority: 'Medium',
    surface: 'MCP Tower',
    kind: 'Source review',
    summary:
      'CORS block in reviewed source did not allow MCP-Protocol-Version request header or expose Mcp-Session-Id response header to cross-origin browsers.',
    recommendation:
      'For supported browser origins, allow the protocol version header and explicitly expose session ID header. Validate disallowed Origin headers fail closed.',
    validation:
      'Test handshake and follow-up request from approved cross-origin client, asserting proper headers and rejection of disallowed origins.',
    sources: [
      {
        label: 'HTTP CORS configuration',
        href: fileUrl(`${towerFile}/src/http_server.ts`, 'L310-L329'),
      },
      { label: 'Streamable HTTP specification', href: MCP_REFERENCE },
    ],
  },
  {
    id: 'CI-02',
    title: 'Cover service-level dependency manifests',
    priority: 'Medium',
    surface: 'CI/CD',
    kind: 'Source review',
    summary:
      'Dependabot targets /core for pip and root for npm, missing the nested Tower npm lockfile and separate Gateway and Browser Python requirements.',
    recommendation:
      'Add update coverage at actual manifest roots. Scan installed lockfiles and built container images in CI.',
    validation:
      'Dependency inventory maps each deployed service to a lockfile and update job, verified by test update runs.',
    sources: [
      {
        label: 'Dependabot update configuration',
        href: fileUrl('.github/dependabot.yml', 'L8-L59'),
      },
      { label: 'Tower npm lockfile', href: fileUrl(`${towerFile}/package-lock.json`) },
      { label: 'Gateway requirements', href: fileUrl('gateway/requirements.txt') },
    ],
  },
  {
    id: 'OPS-02',
    title: 'Make health monitoring status-aware',
    priority: 'Medium',
    surface: 'Operations',
    kind: 'Source review',
    summary:
      'The keepwarm workflow checks HTTP reachability; a degraded HTTP 200 still passes, making reachability alone insufficient to prove readiness.',
    recommendation:
      'Keep warmup best-effort, but add a separate readiness monitor that evaluates state and freshness and alerts on consecutive failures.',
    validation:
      'Test that degraded HTTP 200 raises a readiness signal without triggering false-positive alerts on transient warmup misses.',
    sources: [
      {
        label: 'Render keepwarm workflow',
        href: fileUrl('.github/workflows/keepwarm.yml', 'L9-L19'),
      },
      { label: 'Gateway liveness contract', href: fileUrl('gateway/service/app.py', 'L985-L1006') },
    ],
  },
  {
    id: 'DOC-01',
    title: 'Sync documented MCP tool names with discovery',
    priority: 'Medium',
    surface: 'Docs',
    kind: 'Live observation',
    summary:
      'README documented dotted names (e.g. github.read_file), while the deployed endpoint advertised snake_case names (github_read_file).',
    recommendation:
      'Generate public client tool reference from release artifacts and make discovery the source of truth. Document aliases only when contract tests verify them.',
    validation:
      'In release CI, compare README examples with discovery output and fail on unmapped aliases.',
    sources: [
      { label: 'README call conventions', href: fileUrl('README.md', 'L16-L18') },
      { label: 'Tool name normalization', href: fileUrl(`${towerFile}/src/index.ts`, 'L198-L211') },
    ],
  },
  {
    id: 'OPS-03',
    title: 'Separate unconfigured integrations from failures',
    priority: 'Low',
    surface: 'Operations',
    kind: 'Live observation',
    summary:
      'Firecrawl was circuit-open in cached MCP resource and marked unconfigured in summary. Neither signal alone indicates production failure if optional.',
    recommendation:
      'If Firecrawl is unused, classify as not configured in health contract and omit from readiness scores.',
    validation:
      'Intentionally disabled optional adapter displays as unconfigured rather than an outage.',
    sources: [{ label: 'Tower provider summary', href: `${TOWER_URL}/health/summary` }],
  },
  {
    id: 'DOC-02',
    title: 'Remove retired topology from active onboarding',
    priority: 'Low',
    surface: 'Docs',
    kind: 'Source review',
    summary:
      'README declares monorepo single source of truth, yet older diagrams still depict satellite ingestion pipelines.',
    recommendation:
      'Replace primary diagrams with the current monorepo release path and move legacy bridge diagrams to historical documentation.',
    validation:
      'New contributor onboarding path references only active workflows and monorepo structure.',
    sources: [
      { label: 'Current topology statement', href: fileUrl('README.md', 'L23-L26') },
      { label: 'Legacy deploy diagrams', href: fileUrl('README.md', 'L83-L112') },
    ],
  },
  {
    id: 'REP-01',
    title: 'Verify dev lockfile reproducibility & repo hygiene',
    priority: 'Low',
    surface: 'Repository',
    kind: 'Tracked work',
    summary:
      'Issue #652 tracks lockfile reproducibility, canonical license references, and pre-push hook configuration.',
    recommendation:
      'Reproduce lockfiles in clean pinned containers and verify fresh-clone hook setup before closing upstream tracker.',
    validation:
      'Two clean builds produce identical lockfiles and repository checks validate licenses.',
    sources: [{ label: 'Upstream hygiene work #652', href: issueUrl(652) }],
  },
];

export const surfaces: Surface[] = [
  'MCP Tower',
  'CI/CD',
  'Gateway',
  'Operations',
  'Docs',
  'Repository',
];

export function buildMarkdownAuditReport(reviewedIds: string[] = []): string {
  const highCount = federationFindings.filter((f) => f.priority === 'High').length;
  const mediumCount = federationFindings.filter((f) => f.priority === 'Medium').length;
  const lowCount = federationFindings.filter((f) => f.priority === 'Low').length;

  return [
    '# SupremeAI Federation & Security Audit Report',
    '',
    `**Generated:** ${new Date().toUTCString()} · **Repository:** [${REPO}](${REPO_URL})`,
    `**Baseline Snapshot:** ${SNAPSHOT_DATE} (${SNAPSHOT_TIME}) · **Commit:** \`${SHORT_REVISION}\``,
    '',
    `**Summary:** ${federationFindings.length} Findings (${highCount} High, ${mediumCount} Medium, ${lowCount} Low)`,
    `**Reviewed Locally:** ${reviewedIds.length} of ${federationFindings.length}`,
    '',
    '---',
    '',
    '## Scope & Authority',
    '- Review of MCP Control Tower endpoint, Tool descriptors, and Gateway health probe.',
    '- GitHub CI/CD workflows and repository integrity checks.',
    '- Read-only inspection; no remote persistent mutations.',
    '',
    '## Audit Findings & Recommended Remediation',
    '',
    ...federationFindings.flatMap((f) => [
      `### [${f.id}] ${f.title}`,
      `**Priority:** ${f.priority} | **Surface:** ${f.surface} | **Kind:** ${f.kind} ${reviewedIds.includes(f.id) ? '*(Marked Reviewed)*' : ''}`,
      '',
      `**Observation:** ${f.summary}`,
      '',
      `**Recommendation:** ${f.recommendation}`,
      '',
      `**Validation Step:** ${f.validation}`,
      '',
      '**References:**',
      ...f.sources.map((s) => `- [${s.label}](${s.href})${s.detail ? ` — ${s.detail}` : ''}`),
      '',
      '---',
      '',
    ]),
  ].join('\n');
}
