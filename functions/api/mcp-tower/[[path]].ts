import {
  PagesContext,
  handleCorsPreflight,
  jsonEdgeResponse,
  resolveUpstreamOrigin,
  resolveMcpTowerOrigin,
  fetchWithTimeout,
  callMcpTowerRpc,
  authorizeAdminRequest,
} from '../../_lib/edgeHelpers';

/**
 * বাংলা মন্তব্য: শুধু-পড়ার (GET) এই সাব-পাথগুলো সবার জন্য খোলা — Express ডেভ সার্ভারের মতোই।
 * বাকি সব (probe, reboot, reboot-all, এবং টাওয়ারে ফরোয়ার্ড হওয়া অন্য যেকোনো পাথ) অ্যাডমিন ছাড়া চলবে না।
 * আগে এই রাউটে কোনো যাচাই ছিল না — যে কেউ reboot/probe চালাতে বা টাওয়ারের যেকোনো পাথে
 * যেকোনো মেথডে অনুরোধ পাঠাতে পারত।
 */
const PUBLIC_READ_ONLY = new Set(['health', 'services', 'deployments', 'stream', 'release']);

export function isPublicTowerRequest(method: string, sub: string): boolean {
  return (method === 'GET' || method === 'HEAD') && PUBLIC_READ_ONLY.has(sub);
}

async function probeTargetHealth(
  id: string,
  name: string,
  displayName: string,
  category: string,
  url: string
) {
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(
      url,
      { method: 'GET', headers: { Accept: 'application/json' } },
      5000
    );
    const latencyMs = Date.now() - started;
    const ok = res.ok;
    return {
      id,
      name,
      displayName,
      category,
      port: 443,
      status: ok ? (latencyMs > 2500 ? 'degraded' : 'healthy') : 'degraded',
      // বাংলা মন্তব্য: edge থেকে রিমোট সার্ভিসের CPU/মেমরি/আপটাইম মাপা যায় না — আগে বানানো সংখ্যা
      // (4.2%, 192MB, 99.9%) দেখাত; এখন সৎভাবে "মাপা হয়নি" (null / '—')।
      uptime: '—',
      latencyMs,
      cpuPercent: null,
      memoryMb: null,
      lastChecked: new Date().toISOString(),
      version: 'live',
      endpoint: url,
      errorCount: ok ? 0 : 1,
      logs: [`HTTP ${res.status} from ${url} in ${latencyMs}ms`],
    };
  } catch (err: unknown) {
    return {
      id,
      name,
      displayName,
      category,
      port: 443,
      status: 'down',
      uptime: '—',
      latencyMs: Date.now() - started,
      cpuPercent: null,
      memoryMb: null,
      lastChecked: new Date().toISOString(),
      version: 'unreachable',
      endpoint: url,
      errorCount: 1,
      logs: [err instanceof Error ? err.message : 'Probe timed out'],
    };
  }
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request);

  const incomingUrl = new URL(request.url);
  const sub = incomingUrl.pathname.replace(/^\/api\/mcp-tower\/?/, '').trim();
  const upstreamOrigin = resolveUpstreamOrigin(env);
  const mcpOrigin = resolveMcpTowerOrigin(env);

  if (!isPublicTowerRequest(request.method, sub)) {
    const auth = await authorizeAdminRequest(request, env, upstreamOrigin);
    if (!auth.isAdmin) {
      return jsonEdgeResponse(
        {
          error: auth.hasToken
            ? 'Administrator elevation is required.'
            : 'Administrator authentication is required.',
        },
        auth.hasToken ? 403 : 401,
        request
      );
    }
  }

  if (sub === 'health') {
    const towerProbe = await probeTargetHealth(
      'mcp-tower',
      'supremeai-mcp-tower',
      'SupremeAI MCP Control Tower',
      'control-plane',
      `${mcpOrigin}/health`
    );
    return jsonEdgeResponse(
      {
        status: towerProbe.status === 'healthy' ? 'ok' : towerProbe.status,
        latencyMs: towerProbe.latencyMs,
        endpoint: mcpOrigin,
        checkedAt: new Date().toISOString(),
      },
      200,
      request
    );
  }

  if (sub === 'deployments') {
    const cfToken = typeof env?.CLOUDFLARE_API_TOKEN === 'string' ? env.CLOUDFLARE_API_TOKEN.trim() : '';
    const cfAccountId = typeof env?.CLOUDFLARE_ACCOUNT_ID === 'string' ? env.CLOUDFLARE_ACCOUNT_ID.trim() : '';
    const ghHeaders: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'SupremeAI-Admin-Dashboard',
    };
    const ghToken = typeof env?.GITHUB_TOKEN === 'string' ? env.GITHUB_TOKEN.trim() : '';
    if (ghToken) ghHeaders.Authorization = `Bearer ${ghToken}`;

    const [cfRes, ghPubRes, ghCoreRes, towerRelRes, gwRes] = await Promise.allSettled([
      cfToken && cfAccountId
        ? fetchWithTimeout(
            `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/pages/projects/supremeai-studio/deployments?per_page=1`,
            { headers: { Authorization: `Bearer ${cfToken}` } },
            4500
          ).then((r) => (r.ok ? r.json() : null))
        : Promise.resolve(null),
      fetchWithTimeout(
        'https://api.github.com/repos/Supremeai-bd/supremeai-public/actions/runs?branch=main&per_page=1',
        { headers: ghHeaders },
        4500
      ).then((r) => (r.ok ? r.json() : null)),
      fetchWithTimeout(
        'https://api.github.com/repos/Supremeai-bd/supremeai/actions/runs?branch=main&per_page=1',
        { headers: ghHeaders },
        4500
      ).then((r) => (r.ok ? r.json() : null)),
      fetchWithTimeout(`${mcpOrigin}/release`, { headers: { Accept: 'application/json' } }, 4500).then((r) =>
        r.ok ? r.json() : null
      ),
      fetchWithTimeout(`${upstreamOrigin}/api/health`, { headers: { Accept: 'application/json' } }, 4500).then((r) =>
        r.ok ? r.json() : null
      ),
    ]);

    const cfData = cfRes.status === 'fulfilled' ? (cfRes.value as { result?: Array<{ created_on?: string; latest_stage?: { status?: string }; deployment_trigger?: { metadata?: { commit_hash?: string } } }> } | null) : null;
    const cfLatest = cfData?.result?.[0];
    const ghPub = ghPubRes.status === 'fulfilled' ? (ghPubRes.value as { workflow_runs?: Array<{ updated_at?: string; conclusion?: string; head_sha?: string }> } | null)?.workflow_runs?.[0] : null;
    const ghCore = ghCoreRes.status === 'fulfilled' ? (ghCoreRes.value as { workflow_runs?: Array<{ updated_at?: string; conclusion?: string; head_sha?: string }> } | null)?.workflow_runs?.[0] : null;
    const towerRel = towerRelRes.status === 'fulfilled' ? (towerRelRes.value as { deployedAt?: string; buildTime?: string; commit?: string } | null) : null;
    const gwData = gwRes.status === 'fulfilled' ? (gwRes.value as { deployedAt?: string; timestamp?: string; version?: string } | null) : null;

    return jsonEdgeResponse(
      {
        checkedAt: new Date().toISOString(),
        deployments: [
          {
            id: 'cloudflare-studio',
            provider: 'Cloudflare Pages',
            service: 'supremeai-studio',
            deployedAt: cfLatest?.created_on || null,
            status: cfLatest?.latest_stage?.status || (cfToken ? 'unknown' : 'unconfigured'),
            commit: cfLatest?.deployment_trigger?.metadata?.commit_hash?.slice(0, 7) || null,
          },
          {
            id: 'github-public',
            provider: 'GitHub Actions',
            service: 'supremeai-public (main)',
            deployedAt: ghPub?.updated_at || null,
            status: ghPub?.conclusion || 'unknown',
            commit: ghPub?.head_sha?.slice(0, 7) || null,
          },
          {
            id: 'github-core',
            provider: 'GitHub Actions',
            service: 'supremeai (main)',
            deployedAt: ghCore?.updated_at || null,
            status: ghCore?.conclusion || 'unknown',
            commit: ghCore?.head_sha?.slice(0, 7) || null,
          },
          {
            id: 'render-tower',
            provider: 'Render',
            service: 'supremeai-mcp-tower-live',
            deployedAt: towerRel?.deployedAt || towerRel?.buildTime || null,
            status: towerRel ? 'live' : 'unreachable',
            commit: towerRel?.commit?.slice(0, 7) || null,
          },
          {
            id: 'render-gateway',
            provider: 'Render',
            service: 'supremeai-api (Gateway)',
            deployedAt: gwData?.deployedAt || gwData?.timestamp || null,
            status: gwData ? 'live' : 'unreachable',
            commit: gwData?.version || null,
          },
        ],
      },
      200,
      request
    );
  }

  if (sub === 'services' || sub === 'probe' || sub === 'reboot-all') {
    const [gatewaySvc, towerSvc, studioSvc, mcpToolsResult] = await Promise.all([
      probeTargetHealth(
        'api',
        'supremeai-api',
        'SupremeAI Federation Gateway',
        'gateway',
        `${upstreamOrigin}/health`
      ),
      probeTargetHealth(
        'mcp-tower',
        'supremeai-mcp-tower',
        'MCP Control Tower',
        'control-plane',
        `${mcpOrigin}/health`
      ),
      probeTargetHealth(
        'studio-edge',
        'supremeai-studio',
        'Studio Cloudflare Edge',
        'frontend',
        `${incomingUrl.origin}/`
      ),
      callMcpTowerRpc(env, 'tools/list', {}, 6000).catch(() => null),
    ]);

    const toolCount = Array.isArray(mcpToolsResult?.tools) ? mcpToolsResult.tools.length : 0;
    if (toolCount > 0) {
      towerSvc.logs.push(`Discovered ${toolCount} live MCP tools via JSON-RPC 2.0`);
      towerSvc.version = `${toolCount} tools live`;
    }

    return jsonEdgeResponse(
      {
        services: [gatewaySvc, towerSvc, studioSvc],
        probedAt: new Date().toISOString(),
        source: 'edge-live-probe',
      },
      200,
      request
    );
  }

  if (sub === 'reboot' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { serviceId?: string };
    const serviceId = body.serviceId || 'api';
    await callMcpTowerRpc(
      env,
      'tools/call',
      {
        name: 'status',
        arguments: {},
      },
      5500
    ).catch(() => null);
    const refreshed = await probeTargetHealth(
      serviceId,
      serviceId,
      serviceId,
      'gateway',
      serviceId === 'mcp-tower' ? `${mcpOrigin}/health` : `${upstreamOrigin}/health`
    );
    return jsonEdgeResponse({ service: refreshed, source: 'edge-live-probe' }, 200, request);
  }

  // Forward unknown sub-paths directly to MCP Tower origin
  try {
    const res = await fetchWithTimeout(`${mcpOrigin}/${sub}${incomingUrl.search}`, {
      method: request.method,
      headers: { Accept: request.headers.get('Accept') || 'application/json' },
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'application/json',
        'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
      },
    });
  } catch (err: unknown) {
    return jsonEdgeResponse(
      { error: err instanceof Error ? err.message : 'MCP Tower unreachable' },
      502,
      request
    );
  }
}
