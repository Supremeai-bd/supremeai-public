import { PagesContext, handleCorsPreflight, jsonEdgeResponse } from '../../_lib/edgeHelpers';

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);
  if (request.method !== 'POST') {
    return jsonEdgeResponse({ error: 'Method not allowed' }, 405, request, undefined, env);
  }

  const body = (await request.json().catch(() => ({}))) as {
    runtime?: string;
    entryFile?: string;
    files?: Array<{ path?: string; content?: string }>;
  };

  const runtime = body.runtime === 'python' ? 'python' : body.runtime === 'node' ? 'node' : null;
  if (!runtime) {
    return jsonEdgeResponse(
      { error: 'Supported runtime must be "python" or "node".' },
      400,
      request,
      undefined,
      env
    );
  }

  const files = Array.isArray(body.files) ? body.files : [];
  if (files.length === 0) {
    return jsonEdgeResponse({ error: 'Project files array must not be empty.' }, 400, request, undefined, env);
  }

  return jsonEdgeResponse(
    {
      supported: false,
      runtimeEnv: 'cloudflare-pages-edge',
      runtime,
      entryFile: body.entryFile || files[0]?.path || '',
      exitCode: null,
      stdout: '',
      stderr: `OS ${runtime === 'python' ? 'Python 3' : 'Node.js'} subprocess execution requires the Node.js Studio Server. Browser HTML/CSS/React/JS projects run directly in Preview & Sandbox.`,
      durationMs: 0,
    },
    200,
    request,
    undefined,
    env
  );
}
