import {
  PagesContext,
  handleCorsPreflight,
  jsonEdgeResponse,
  resolveUpstreamOrigin,
  mintOrExtractAuthHeaders,
  extractLlmCompletionText,
} from '../../_lib/edgeHelpers';

function heuristicTitle(message: string, attachmentName?: string): string {
  const raw = (message || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) {
    return attachmentName ? `Analysis: ${attachmentName.slice(0, 30)}` : 'New Conversation';
  }
  const clean = raw
    .replace(
      /^(?:hey|hi|hello|please|can you|could you|help me|tell me|explain|go to|visit|open)\s+/i,
      ''
    )
    .replace(/https?:\/\/([^\s/]+)[^\s]*/gi, (_m, host: string) => host.replace(/^www\./i, ''))
    .replace(/[`*_~"?!.:,;]+/g, ' ')
    .trim();
  const words = clean.split(/\s+/).filter(Boolean).slice(0, 6);
  const title = words.join(' ').trim();
  return title ? title.slice(0, 44) : 'New Conversation';
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);
  if (request.method !== 'POST') {
    return jsonEdgeResponse({ error: 'Method not allowed' }, 405, request, undefined, env);
  }

  const body = (await request.json().catch(() => ({}))) as {
    message?: string;
    attachmentName?: string;
    attachmentMimeType?: string;
    messages?: Array<{ role?: string; content?: string | Array<{ type?: string; text?: string }> }>;
  };

  const lastRawContent = Array.isArray(body.messages)
    ? body.messages[body.messages.length - 1]?.content
    : '';
  const extractedLastText = Array.isArray(lastRawContent)
    ? lastRawContent
        .map((p) => (p?.type === 'text' && typeof p.text === 'string' ? p.text : ''))
        .filter(Boolean)
        .join(' ')
    : String(lastRawContent || '');

  const userMsg =
    typeof body.message === 'string' && body.message.trim()
      ? body.message.trim()
      : extractedLastText.trim();

  const fallback = heuristicTitle(userMsg, body.attachmentName);
  if (!userMsg) {
    return jsonEdgeResponse({ title: fallback, source: 'heuristic' }, 200, request, undefined, env);
  }

  try {
    const upstreamOrigin = resolveUpstreamOrigin(env);
    const authHeaders = await mintOrExtractAuthHeaders(request, upstreamOrigin);
    const llmTitle = await extractLlmCompletionText(
      upstreamOrigin,
      authHeaders,
      {
        model: 'supreme-spark',
        max_tokens: 24,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'Return ONLY a concise 3 to 5 word conversation title matching the language of the user message (Bengali or English). No quotes, no punctuation, no markdown.',
          },
          {
            role: 'user',
            content: userMsg.slice(0, 320),
          },
        ],
      },
      5500
    );

    const cleaned = llmTitle
      .split(/\r?\n/)[0]
      ?.replace(/^(?:title|topic)\s*[:\-–—]\s*/i, '')
      .replace(/[`*_~"'.!?]+$/g, '')
      .trim()
      .slice(0, 46);

    if (cleaned && cleaned.length >= 3) {
      return jsonEdgeResponse({ title: cleaned, source: 'edge-llm' }, 200, request, undefined, env);
    }
  } catch {
    // Fall back cleanly to heuristic title
  }

  return jsonEdgeResponse({ title: fallback, source: 'heuristic' }, 200, request, undefined, env);
}
