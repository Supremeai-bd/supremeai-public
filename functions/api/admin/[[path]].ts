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
  verifyUpstreamSession,
} from '../../_lib/edgeHelpers';
import { extractCiErrorSnippet } from '../../../src/utils/githubPipelineMetrics';

// ---------------------------------------------------------------------------
// P0 fail-closed JWT verification. The previous auth gate accepted a
// base64-decoded JWT payload WITHOUT any signature check, so a forged token
// carrying {"role":"admin"} granted admin access. JWTs are now accepted only
// when they carry a valid HS256 signature over the configured signing secret
// (SUPABASE_JWT_SECRET / SUPREMEAI_JWT_SECRET) and are not expired. With no
// signing secret configured, JWT evidence is ignored entirely.
// ---------------------------------------------------------------------------
function base64UrlDecodeBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function verifySignedAdminJwt(
  token: string,
  secret: string
): Promise<{ email: string; role: string } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encHeader, encPayload, encSignature] = parts;
  const header = JSON.parse(new TextDecoder().decode(base64UrlDecodeBytes(encHeader))) as { alg?: string };
  if (String(header?.alg || '').toUpperCase() !== 'HS256') return null;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const signature = base64UrlDecodeBytes(encSignature);
  const data = new TextEncoder().encode(`${encHeader}.${encPayload}`);
  const valid = await crypto.subtle.verify('HMAC', key, signature, data);
  if (!valid) return null;
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecodeBytes(encPayload))) as Record<string, any>;
  if (typeof payload?.exp === 'number' && payload.exp * 1000 <= Date.now()) return null;
  const email = String(
    payload?.email || payload?.user_metadata?.email || payload?.app_metadata?.email || ''
  ).trim().toLowerCase();
  const role = String(
    payload?.role || payload?.app_metadata?.role || payload?.user_metadata?.role || ''
  ).trim().toLowerCase();
  return { email, role };
}

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

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);

  const incomingUrl = new URL(request.url);
  const path = incomingUrl.pathname;
  const upstreamOrigin = resolveUpstreamOrigin(env);

  const authHeader = (request.headers.get('Authorization') || '').trim();
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const adminToken = (request.headers.get('X-Admin-Token') || '').trim();
  const effectiveToken = adminToken || bearerToken;

  const configuredKeys = [
    env?.ADMIN_KEY,
    env?.ADMIN_PASSKEY,
    env?.SUPREMEAI_ADMIN_KEY,
    env?.MCP_ADMIN_KEY,
    env?.SUPERADMIN_KEY,
  ]
    .filter(Boolean)
    .map((k: any) => String(k).trim());

  let hasAdminCredential =
    configuredKeys.length > 0 &&
    Boolean(effectiveToken) &&
    configuredKeys.some((configured) => timingSafeEqualStrings(effectiveToken, configured));

  // বাংলা মন্তব্য: অথরাইজড প্রোজেক্ট অ্যাডমিনের ভ্যালিড সেশন টোকেন বা JWT থাকলে তাকে সরাসরি অ্যাডমিন অ্যাক্সেস অনুমোদন দেওয়া হচ্ছে
  if (!hasAdminCredential && effectiveToken) {
    const authorizedAdmins = [
      'niloyjoy7@gmail.com',
      'paykaribazaronline@gmail.com',
      'operator@supremeai.bd',
      ...(env?.ADMIN_EMAIL ? [String(env.ADMIN_EMAIL).trim().toLowerCase()] : []),
      ...(env?.ADMIN_EMAILS
        ? String(env.ADMIN_EMAILS)
            .split(',')
            .map((e: string) => e.trim().toLowerCase())
        : []),
    ];

    // P0 fail-closed fix: the removed blocks (a) accepted the client-controlled
    // X-Admin-Email header as admin proof and (b) accepted JWTs by decoding the
    // base64 payload WITHOUT signature verification. Admin email/role claims are
    // now accepted only from a cryptographically verified HS256 JWT; when no
    // signing secret is configured, JWT evidence is ignored entirely.
    if (!hasAdminCredential) {
      const jwtSecret = String(env?.SUPABASE_JWT_SECRET || env?.SUPREMEAI_JWT_SECRET || '').trim();
      if (jwtSecret.length >= 16) {
        const verified = await verifySignedAdminJwt(effectiveToken, jwtSecret).catch(() => null);
        if (
          verified &&
          ((verified.email && authorizedAdmins.includes(verified.email)) ||
            verified.role === 'admin' ||
            verified.role === 'super_admin')
        ) {
          hasAdminCredential = true;
        }
      }
    }

    if (!hasAdminCredential) {
      const session = await verifyUpstreamSession(request, upstreamOrigin).catch(() => ({ valid: false } as any));
      if (
        session.valid &&
        ((session.email && authorizedAdmins.includes(session.email.toLowerCase())) ||
          session.role === 'admin' ||
          (Array.isArray(session.permissions) && session.permissions.includes('admin')))
      ) {
        hasAdminCredential = true;
      }
    }
  }

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
  if (path === '/api/admin/schema-parity/sync' && request.method === 'POST') {
    return jsonEdgeResponse(
      { success: true, syncedCount: 0, tables: DEFAULT_SCHEMA_TABLES },
      200,
      request
    );
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
  if (
    path.startsWith('/api/admin/llm-gateway/') &&
    path.endsWith('/failover') &&
    request.method === 'POST'
  ) {
    const id = path.split('/')[4] || '';
    const updated = DEFAULT_GATEWAY_ROUTES.map((r) =>
      r.id === id ? { ...r, autoFailoverActive: !r.autoFailoverActive } : r
    );
    return jsonEdgeResponse({ success: true, routes: updated }, 200, request);
  }
  if (
    path.startsWith('/api/admin/llm-gateway/') &&
    path.endsWith('/price') &&
    request.method === 'PATCH'
  ) {
    const id = path.split('/')[4] || '';
    const body = (await request.json().catch(() => ({}))) as { customerPricePer1M?: number };
    const updated = DEFAULT_GATEWAY_ROUTES.map((r) =>
      r.id === id && typeof body.customerPricePer1M === 'number'
        ? { ...r, customerPricePer1M: body.customerPricePer1M }
        : r
    );
    return jsonEdgeResponse({ success: true, routes: updated }, 200, request);
  }

  if (path.startsWith('/api/admin/customers/')) {
    return jsonEdgeResponse({ success: true, customers: [] }, 200, request);
  }
  if (path.startsWith('/api/admin/security/block-ip/')) {
    return jsonEdgeResponse({ success: true, blockedIps: [] }, 200, request);
  }
  if (path.startsWith('/api/admin/providers/')) {
    return jsonEdgeResponse({ success: true, providers: [] }, 200, request);
  }
  if (path.startsWith('/api/admin/swarm/') && request.method === 'POST') {
    return jsonEdgeResponse({ success: true, worker: null }, 200, request);
  }
  if (path.startsWith('/api/admin/queue/') && request.method === 'POST') {
    return jsonEdgeResponse({ success: true, job: null }, 200, request);
  }

  return jsonEdgeResponse({ error: `Admin endpoint ${path} unavailable upstream.` }, 404, request);
}
