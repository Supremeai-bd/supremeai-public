import {
  PagesContext,
  handleCorsPreflight,
  jsonEdgeResponse,
  resolveUpstreamOrigin,
  forwardRawUpstream,
} from '../../_lib/edgeHelpers';

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);

  const incomingUrl = new URL(request.url);
  const path = incomingUrl.pathname;
  const upstreamOrigin = resolveUpstreamOrigin(env);

  try {
    const res = await forwardRawUpstream(
      request,
      upstreamOrigin,
      `${path}${incomingUrl.search}`,
      6000
    );
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (path === '/api/research/history' && Array.isArray(data)) {
        return jsonEdgeResponse(data, 200, request, undefined, env);
      }
      if (
        data &&
        typeof data === 'object' &&
        Boolean((data as { report?: { sections?: unknown } }).report?.sections)
      ) {
        return jsonEdgeResponse(data, 200, request, undefined, env);
      }
    }
  } catch {
    // Graceful fallback
  }

  if (path === '/api/research/history') {
    return jsonEdgeResponse([], 200, request, undefined, env);
  }

  return jsonEdgeResponse(
    { error: 'Research detail is only retained for live completed sessions.', status: 'not_found' },
    404,
    request,
    undefined,
    env
  );
}
