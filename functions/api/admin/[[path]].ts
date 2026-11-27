import {
  PagesContext,
  applyCorsHeaders,
  handleCorsPreflight,
  isSafeGitHubRepoSlug,
  jsonEdgeResponse,
  resolveUpstreamOrigin,
  forwardRawUpstream,
  fetchWithTimeout,
  timingSafeEqualStrings,
  authorizeAdminRequest,
} from '../../_lib/edgeHelpers';
import { extractCiErrorSnippet } from '../../../src/utils/githubPipelineMetrics';
import { handleAdminRealDataRoute } from '../../_lib/adminRealDataRoutes';
import { handleAdminTeamRoute } from '../../_lib/adminTeam';
import {
  handleAdminAuditLogRoute,
  withAdminAudit,
  type AdminAuditContext,
} from '../../_lib/adminAudit';

// বাংলা মন্তব্য: ফ্রন্টএন্ডের SchemaParityTable এবং LlmGatewayRoute ইন্টারফেসের সাথে শতভাগ সামঞ্জস্যপূর্ণ এজ প্যারিটি ডেটা।
const DEFAULT_SCHEMA_TABLES = [
  {
    tableName: 'users',
    name: 'users',
    localColumns: 12,
    stagingColumns: 12,
    prodColumns: 12,
    rlsEnabled: true,
    driftDetected: false,
    lastMigrated: 'Head',
  },
  {
    tableName: 'user_preferences',
    name: 'user_preferences',
    localColumns: 10,
    stagingColumns: 10,
    prodColumns: 10,
    rlsEnabled: true,
    driftDetected: false,
    lastMigrated: 'Head',
  },
  {
    tableName: 'conversations',
    name: 'conversations',
    localColumns: 8,
    stagingColumns: 8,
    prodColumns: 8,
    rlsEnabled: true,
    driftDetected: false,
    lastMigrated: 'Head',
  },
  {
    tableName: 'api_keys',
    name: 'api_keys',
    localColumns: 9,
    stagingColumns: 9,
    prodColumns: 9,
    rlsEnabled: true,
    driftDetected: false,
    lastMigrated: 'Head',
  },
  {
    tableName: 'system_audit_logs',
    name: 'system_audit_logs',
    localColumns: 7,
    stagingColumns: 7,
    prodColumns: 7,
    rlsEnabled: true,
    driftDetected: false,
    lastMigrated: 'Head',
  },
];

const DEFAULT_GATEWAY_ROUTES = [
  {
    id: 'route-spark',
    modelId: 'supreme-spark',
    displayName: 'SupremeAI Spark',
    primaryProvider: 'Gemini Web Relay',
    fallbackProvider: 'OpenRouter Free',
    autoFailoverActive: true,
    requestsPerMin: 0,
    errorRatePercent: 0,
    costPer1MIn: 0.0,
    costPer1MOut: 0.0,
    customerPricePer1M: 0.0,
  },
  {
    id: 'route-core',
    modelId: 'supreme-core',
    displayName: 'SupremeAI Core',
    primaryProvider: 'Gemini Flash',
    fallbackProvider: 'OpenRouter Standard',
    autoFailoverActive: true,
    requestsPerMin: 0,
    errorRatePercent: 0,
    costPer1MIn: 0.08,
    costPer1MOut: 0.24,
    customerPricePer1M: 0.35,
  },
  {
    id: 'route-reason',
    modelId: 'supreme-reason',
    displayName: 'SupremeAI Reason',
    primaryProvider: 'Gemini Pro Thinking',
    fallbackProvider: 'DeepSeek R1',
    autoFailoverActive: true,
    requestsPerMin: 0,
    errorRatePercent: 0,
    costPer1MIn: 0.4,
    costPer1MOut: 0.9,
    customerPricePer1M: 1.25,
  },
  {
    id: 'route-deep',
    modelId: 'supreme-deep',
    displayName: 'SupremeAI Deep',
    primaryProvider: 'Deep Research Pipeline',
    fallbackProvider: 'Web + LLM Synthesis',
    autoFailoverActive: true,
    requestsPerMin: 0,
    errorRatePercent: 0,
    costPer1MIn: 0.6,
    costPer1MOut: 1.2,
    customerPricePer1M: 1.75,
  },
];

/**
 * বাংলা মন্তব্য (Admin Step 1): প্রতিটি অ্যাডমিন write — সফল/ব্যর্থ/প্রত্যাখ্যাত —
 * সার্ভার-সাইডে `audit_logs`-এ রেকর্ড হয়।
 */
export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method === 'OPTIONS') {
    return handleCorsPreflight(context.request, context.env);
  }
  return withAdminAudit(context, (audit) => handleAdminRequest(context, audit));
}

/** Fail-honest reply for write routes the backend has not implemented yet. */
function notWired(request: Request, what: string): Response {
  return jsonEdgeResponse(
    {
      success: false,
      notWired: true,
      error: `${what} is not available yet — the backend does not implement it.`,
    },
    501,
    request
  );
}

async function handleAdminRequest(
  context: PagesContext,
  audit: AdminAuditContext
): Promise<Response> {
  const { request, env } = context;

  const incomingUrl = new URL(request.url);
  const path = incomingUrl.pathname;
  const upstreamOrigin = resolveUpstreamOrigin(env);

  // বাংলা মন্তব্য: অ্যাডমিন-যাচাই এখন edgeHelpers.authorizeAdminRequest-এ (control-plane ও mcp-tower একই নিয়ম)
  const auth = await authorizeAdminRequest(request, env, upstreamOrigin);
  if (auth.actor) audit.actor = auth.actor;
  const effectiveToken = auth.hasToken;
  const hasAdminCredential = auth.isAdmin;

  if (path !== '/api/admin/auth/verify') {
    if (!effectiveToken) {
      return jsonEdgeResponse(
        { error: 'Administrator authentication is required.' },
        401,
        request,
        undefined,
        env
      );
    }
    if (!hasAdminCredential) {
      return jsonEdgeResponse(
        { error: 'Administrator elevation is required.' },
        403,
        request,
        undefined,
        env
      );
    }
  }

  // Handle /api/admin/auth/verify on edge
  if (path === '/api/admin/auth/verify' && request.method === 'POST') {
    const adminPasskey = env?.ADMIN_PASSKEY?.trim();
    if (!adminPasskey) {
      return jsonEdgeResponse(
        {
          success: false,
          authenticated: false,
          error: 'Admin access is not configured. Set ADMIN_PASSKEY in the environment.',
        },
        503,
        request,
        undefined,
        env
      );
    }

    const body = (await request.json().catch(() => ({}))) as { passkey?: string };
    const passkey = String(body.passkey || '').trim();
    if (!passkey) {
      return jsonEdgeResponse(
        {
          success: false,
          authenticated: false,
          error: 'Invalid request body: passkey — Passkey is required.',
          issues: [{ path: 'passkey', message: 'Passkey is required.' }],
        },
        400,
        request,
        undefined,
        env
      );
    }

    if (timingSafeEqualStrings(passkey, adminPasskey)) {
      return jsonEdgeResponse(
        {
          success: true,
          authenticated: true,
          role: 'admin',
          operator: 'Admin Operator',
        },
        200,
        request,
        undefined,
        env
      );
    } else {
      return jsonEdgeResponse(
        {
          success: false,
          authenticated: false,
          error: 'Invalid administrator passkey. Access denied.',
        },
        401,
        request,
        undefined,
        env
      );
    }
  }

  // 1. Live GitHub Runs & Pulls via GitHub API on Edge
  if (path.startsWith('/api/admin/github/')) {
    const repo = incomingUrl.searchParams.get('repo')?.trim() || 'Supremeai-bd/supremeai';
    if (!isSafeGitHubRepoSlug(repo)) {
      return jsonEdgeResponse(
        { error: 'Invalid GitHub repository slug.' },
        400,
        request,
        undefined,
        env
      );
    }
    const token = env?.GITHUB_TOKEN?.trim() || env?.GITHUB_READONLY_TOKEN?.trim() || '';
    const ghHeaders: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'SupremeAI-Studio-Edge-Admin',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    if (path === '/api/admin/github/runs' && request.method === 'GET') {
      try {
        const res = await fetchWithTimeout(
          `https://api.github.com/repos/${repo}/actions/runs?per_page=10`,
          { headers: ghHeaders },
          5500
        );
        const data = (await res.json().catch(() => ({}))) as any;
        const runs = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
        return jsonEdgeResponse(
          { runs, tokenConfigured: Boolean(token) },
          200,
          request,
          undefined,
          env
        );
      } catch {
        return jsonEdgeResponse(
          { runs: [], tokenConfigured: Boolean(token) },
          200,
          request,
          undefined,
          env
        );
      }
    }

    const logMatch = path.match(/^\/api\/admin\/github\/runs\/(\d{1,20})\/logs$/);
    if (logMatch && request.method === 'GET') {
      const runId = logMatch[1];
      try {
        const jobsRes = await fetchWithTimeout(
          `https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs?per_page=30`,
          { headers: ghHeaders },
          6000
        );
        if (!jobsRes.ok) {
          return jsonEdgeResponse(
            {
              runId,
              repo,
              available: false,
              reason: `GitHub jobs API returned HTTP ${jobsRes.status}.`,
              failedJobs: [],
              annotations: [],
              stderrSnippet: '',
              truncated: false,
            },
            200,
            request,
            undefined,
            env
          );
        }
        const jobsPayload = (await jobsRes.json().catch(() => ({}))) as {
          jobs?: Array<Record<string, unknown>>;
        };
        const allJobs = Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : [];
        const failedSet = new Set([
          'failure',
          'timed_out',
          'startup_failure',
          'action_required',
          'stale',
        ]);
        const failedJobs = allJobs
          .filter((j) => failedSet.has(String(j.conclusion || '').toLowerCase()))
          .slice(0, 5)
          .map((j) => ({
            id: Number(j.id || 0),
            name: String(j.name || 'Workflow job'),
            conclusion: (j.conclusion as string | null) ?? null,
            html_url: typeof j.html_url === 'string' ? j.html_url : null,
            failedSteps: (Array.isArray(j.steps) ? (j.steps as Array<Record<string, unknown>>) : [])
              .filter((s) => failedSet.has(String(s.conclusion || '').toLowerCase()))
              .map((s) => ({
                name: String(s.name || 'Failed step'),
                number: Number(s.number || 0),
                conclusion: (s.conclusion as string | null) ?? null,
              })),
          }));

        const annotations: Array<{
          path: string;
          startLine: number;
          annotationLevel: string;
          title: string | null;
          message: string;
        }> = [];
        const snippetParts: string[] = [];
        let truncated = false;
        let reason: string | undefined;

        for (const job of failedJobs.filter((j) => j.id > 0).slice(0, 2)) {
          const [annRes, logRes] = await Promise.allSettled([
            fetchWithTimeout(
              `https://api.github.com/repos/${repo}/check-runs/${job.id}/annotations?per_page=15`,
              { headers: ghHeaders },
              5000
            ),
            fetchWithTimeout(
              `https://api.github.com/repos/${repo}/actions/jobs/${job.id}/logs`,
              { headers: ghHeaders },
              7000
            ),
          ]);
          if (annRes.status === 'fulfilled' && annRes.value.ok) {
            const annJson = (await annRes.value.json().catch(() => [])) as Array<
              Record<string, unknown>
            >;
            if (Array.isArray(annJson)) {
              for (const item of annJson) {
                const msg = String(item.message || '').trim();
                if (!msg) continue;
                annotations.push({
                  path: String(item.path || ''),
                  startLine: Number(item.start_line || 0),
                  annotationLevel: String(item.annotation_level || 'failure'),
                  title: typeof item.title === 'string' && item.title ? item.title : null,
                  message: msg,
                });
              }
            }
          }
          if (logRes.status === 'fulfilled') {
            if (logRes.value.ok) {
              const rawText = await logRes.value.text();
              const bounded = rawText.length > 300_000 ? rawText.slice(-300_000) : rawText;
              const extracted = extractCiErrorSnippet(bounded, 40, 5000);
              if (extracted.truncated || rawText.length > 300_000) truncated = true;
              if (extracted.snippet) snippetParts.push(extracted.snippet);
            } else if (!reason) {
              reason = `Raw job log download returned HTTP ${logRes.value.status}.`;
            }
          }
        }

        const stderrSnippet = snippetParts.join('\n\n');
        const available = Boolean(stderrSnippet || annotations.length > 0);
        return jsonEdgeResponse(
          {
            runId,
            repo,
            available,
            reason,
            failedJobs,
            annotations: annotations.slice(0, 12),
            stderrSnippet,
            truncated,
          },
          200,
          request,
          undefined,
          env
        );
      } catch {
        return jsonEdgeResponse(
          {
            runId,
            repo,
            available: false,
            reason: 'Unable to fetch GitHub job logs.',
            failedJobs: [],
            annotations: [],
            stderrSnippet: '',
            truncated: false,
          },
          200,
          request,
          undefined,
          env
        );
      }
    }

    if (path === '/api/admin/github/pulls' && request.method === 'GET') {
      try {
        const res = await fetchWithTimeout(
          `https://api.github.com/repos/${repo}/pulls?state=open&per_page=10`,
          { headers: ghHeaders },
          5500
        );
        const data = (await res.json().catch(() => [])) as any[];
        const pulls = Array.isArray(data) ? data : [];
        return jsonEdgeResponse(
          { pulls, tokenConfigured: Boolean(token) },
          200,
          request,
          undefined,
          env
        );
      } catch {
        return jsonEdgeResponse(
          { pulls: [], tokenConfigured: Boolean(token) },
          200,
          request,
          undefined,
          env
        );
      }
    }
  }

  // 1b. বাংলা মন্তব্য: Render-এ যেগুলো স্টাব (providers, vault, customers, connections) —
  // সেগুলো edge-এ আসল উৎস (Infisical, Supabase Auth, লাইভ প্রোব) থেকে।
  const auditLog = await handleAdminAuditLogRoute(path, request, env);
  if (auditLog) return auditLog;

  const team = await handleAdminTeamRoute(path, request, env, audit);
  if (team) return team;

  const realData = await handleAdminRealDataRoute(path, request, env, upstreamOrigin);
  if (realData) return realData;

  // 2. Try Render Gateway upstream first for any /api/admin/* route
  try {
    const upRes = await forwardRawUpstream(
      request,
      upstreamOrigin,
      `${path}${incomingUrl.search}`,
      8000
    );
    if (upRes.status !== 404 && upRes.status !== 405 && upRes.status !== 501) {
      const contentType = upRes.headers.get('content-type') || 'application/json';
      const rawText = await upRes.text();
      const respHeaders = new Headers({ 'Content-Type': contentType });
      applyCorsHeaders(respHeaders, request.headers.get('Origin'), incomingUrl.origin, env);
      return new Response(rawText, {
        status: upRes.status,
        headers: respHeaders,
      });
    }
  } catch {
    // Fall through to Edge parity adapters below
  }

  // 3. Edge parity adapters for routes missing (404) on Render Gateway
  if (path === '/api/admin/schema-parity') {
    return jsonEdgeResponse({ tables: DEFAULT_SCHEMA_TABLES, source: 'edge-parity' }, 200, request);
  }
  // বাংলা মন্তব্য (fail-honest): আগে এই write-গুলো কিছু না করেই success: true বলত।
  if (path === '/api/admin/schema-parity/sync' && request.method === 'POST') {
    return notWired(request, 'Schema sync');
  }
  if (path === '/api/admin/llm-gateway') {
    return jsonEdgeResponse(
      {
        routes: DEFAULT_GATEWAY_ROUTES,
        gatewayStatus: 'healthy',
        traffic: { totalRequests: 0, rpm: 0, errorRatePercent: 0 },
      },
      200,
      request
    );
  }
  const isWrite = request.method !== 'GET' && request.method !== 'HEAD';
  if (isWrite && path.startsWith('/api/admin/llm-gateway/')) {
    return notWired(request, 'Changing gateway routing or pricing');
  }
  if (path.startsWith('/api/admin/customers/')) {
    if (isWrite) return notWired(request, 'This customer action');
    return jsonEdgeResponse({ success: true, customers: [] }, 200, request);
  }
  if (path.startsWith('/api/admin/security/block-ip/')) {
    if (isWrite) return notWired(request, 'Blocking or unblocking an IP');
    return jsonEdgeResponse({ success: true, blockedIps: [] }, 200, request);
  }
  if (path.startsWith('/api/admin/providers/')) {
    if (isWrite) return notWired(request, 'This provider action');
    return jsonEdgeResponse({ success: true, providers: [] }, 200, request);
  }
  if (isWrite && path.startsWith('/api/admin/swarm/')) {
    return notWired(request, 'This agent worker action');
  }
  if (isWrite && path.startsWith('/api/admin/queue/')) {
    return notWired(request, 'This task queue action');
  }

  return jsonEdgeResponse({ error: `Admin endpoint ${path} unavailable upstream.` }, 404, request);
}
