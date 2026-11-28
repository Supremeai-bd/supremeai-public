import {
  PagesContext,
  handleCorsPreflight,
  jsonEdgeResponse,
  resolveUpstreamOrigin,
  mintOrExtractAuthHeaders,
  extractLlmCompletionText,
} from '../_lib/edgeHelpers';

type Attachment = { name?: string; mimeType?: string; data?: string };
interface ChatMessage {
  role?: string;
  content: string | Record<string, unknown>[];
  attachment?: Attachment;
  attachments?: Attachment[];
  parts?: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAttachment(value: unknown): value is Attachment {
  return (
    isRecord(value) &&
    ['name', 'mimeType', 'data'].every(
      (key) => value[key] === undefined || typeof value[key] === 'string'
    )
  );
}

function isChatMessage(value: unknown): value is ChatMessage {
  return (
    isRecord(value) &&
    (value.role === undefined || typeof value.role === 'string') &&
    (typeof value.content === 'string' ||
      (Array.isArray(value.content) && value.content.every(isRecord))) &&
    (value.attachment === undefined || isAttachment(value.attachment)) &&
    (value.attachments === undefined ||
      (Array.isArray(value.attachments) && value.attachments.every(isAttachment))) &&
    (value.parts === undefined || Array.isArray(value.parts))
  );
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);
  if (request.method !== 'POST') {
    return jsonEdgeResponse({ error: 'Method not allowed' }, 405, request, undefined, env);
  }

  const body: unknown = await request.json().catch(() => null);
  if (
    !isRecord(body) ||
    !Array.isArray(body.messages) ||
    !body.messages.length ||
    !body.messages.every(isChatMessage) ||
    !['model', 'systemInstruction', 'groundingContext'].every(
      (key) => body[key] === undefined || typeof body[key] === 'string'
    ) ||
    (body.language !== undefined && body.language !== 'en' && body.language !== 'bn') ||
    !['temperature', 'top_p', 'max_tokens', 'thinking_budget'].every(
      (key) => body[key] === undefined || Number.isFinite(body[key])
    ) ||
    (body.run_config !== undefined && !isRecord(body.run_config))
  ) {
    return jsonEdgeResponse(
      {
        error:
          'Invalid chat request: expected a non-empty array of valid messages and valid chat options.',
      },
      400,
      request,
      undefined,
      env
    );
  }
  const rawMessages = body.messages as ChatMessage[];
  const systemInstruction =
    typeof body.systemInstruction === 'string' ? body.systemInstruction.trim() : '';
  const groundingContext =
    typeof body.groundingContext === 'string' ? body.groundingContext.trim() : '';
  const model = (typeof body.model === 'string' && body.model) || 'supreme-spark';

  const upstreamMessages: ChatMessage[] = [];
  if (systemInstruction) upstreamMessages.push({ role: 'system', content: systemInstruction });
  if (groundingContext) {
    upstreamMessages.push({ role: 'system', content: `Grounding Context:\n${groundingContext}` });
  }
  for (const { role, content, attachment, attachments, parts } of rawMessages) {
    upstreamMessages.push({ role: role || 'user', content, attachment, attachments, parts });
  }

  try {
    const upstreamOrigin = resolveUpstreamOrigin(env);
    const authHeaders = await mintOrExtractAuthHeaders(request, upstreamOrigin);
    const text = await extractLlmCompletionText(
      upstreamOrigin,
      authHeaders,
      {
        model,
        messages: upstreamMessages,
        language: body.language || 'en',
        ...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}),
        ...(typeof body.top_p === 'number' ? { top_p: body.top_p } : {}),
        ...(typeof body.max_tokens === 'number' ? { max_tokens: body.max_tokens } : {}),
        ...(typeof body.thinking_budget === 'number'
          ? { thinking_budget: body.thinking_budget }
          : {}),
        ...(body.run_config ? { run_config: body.run_config } : {}),
      },
      18000
    );

    if (!text) {
      return jsonEdgeResponse(
        { error: 'Upstream gateway returned an empty completion response.' },
        502,
        request,
        undefined,
        env
      );
    }

    return jsonEdgeResponse({ text, model, source: 'edge-chat' }, 200, request, undefined, env);
  } catch (err: unknown) {
    return jsonEdgeResponse(
      { error: err instanceof Error ? err.message : 'Synchronous chat fallback failed.' },
      502,
      request,
      undefined,
      env
    );
  }
}
