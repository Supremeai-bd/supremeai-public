import {
  PagesContext,
  handleCorsPreflight,
  jsonEdgeResponse,
  resolveUpstreamOrigin,
  resolveMcpTowerOrigin,
  fetchWithTimeout,
} from '../../_lib/edgeHelpers';

interface ProbeResult {
  id: string;
  label: string;
  status: 'online' | 'degraded' | 'offline';
  latencyMs: number;
  httpStatus: number;
  endpoint: string;
  region: string;
}

async function probeTarget(
  id: string,
  label: string,
  url: string,
  region: string
): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(
      url,
      { method: 'GET', headers: { Accept: 'application/json' } },
      5000
    );
    const latencyMs = Date.now() - started;
    return {
      id,
      label,
      status: res.ok ? (latencyMs > 2200 ? 'degraded' : 'online') : 'degraded',
      latencyMs,
      httpStatus: res.status,
      endpoint: url,
      region,
    };
  } catch {
    return {
      id,
      label,
      status: 'offline',
      latencyMs: Date.now() - started,
      httpStatus: 0,
      endpoint: url,
      region,
    };
  }
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  // বাংলা মন্তব্য: এজ রানটাইমে ALLOWED_ORIGINS কার্যকর রাখতে env পাস করা হচ্ছে এবং ApiKeysTable কন্ট্রাক্ট সামঞ্জস্য রাখা হচ্ছে
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);

  const upstreamOrigin = resolveUpstreamOrigin(env);
  const mcpOrigin = resolveMcpTowerOrigin(env);
  const edgeStarted = Date.now();

  const [gatewayProbe, mcpProbe] = await Promise.all([
    probeTarget('supremeai-gateway', 'SupremeAI Gateway', `${upstreamOrigin}/health`, 'render-us'),
    probeTarget('supremeai-mcp-tower', 'MCP Control Tower', `${mcpOrigin}/health`, 'render-us'),
  ]);

  const updatedAt = new Date().toISOString();
  const edgeElapsedMs = Math.max(0, Date.now() - edgeStarted);
  const toProviderMetric = (
    provider: string,
    label: string,
    probeStatus: ProbeResult['status'],
    latencyMs: number,
    httpStatus: number
  ) => {
    const status: 'healthy' | 'degraded' | 'unhealthy' =
      probeStatus === 'online' ? 'healthy' : probeStatus === 'degraded' ? 'degraded' : 'unhealthy';
    return {
      provider,
      label,
      displayName: label,
      status,
      latencyMs,
      avgLatencyMs: latencyMs,
      p95LatencyMs: latencyMs,
      successRate: probeStatus === 'offline' ? 0 : 100,
      sampleCount: 1,
      provenance: 'live-probe' as const,
      lastChecked: updatedAt,
      updatedAt,
      httpStatus,
    };
  };

  const list = [
    toProviderMetric(
      'supremeai',
      'SupremeAI Federation Gateway',
      gatewayProbe.status,
      gatewayProbe.latencyMs,
      gatewayProbe.httpStatus
    ),
    toProviderMetric(
      'mcp-tower',
      'SupremeAI MCP Tower',
      mcpProbe.status,
      mcpProbe.latencyMs,
      mcpProbe.httpStatus
    ),
    toProviderMetric(
      'edge-proxy',
      'Cloudflare Pages Edge Runtime',
      'online',
      edgeElapsedMs,
      200
    ),
  ];

  const providers: Record<string, unknown> = {};
  for (const item of list) {
    providers[item.provider] = item;
  }

  return jsonEdgeResponse(
    {
      gatewayStatus: gatewayProbe.status === 'online' ? 'healthy' : 'degraded',
      fetchedAt: updatedAt,
      providers,
      list,
    },
    200,
    request,
    {},
    env
  );
}
