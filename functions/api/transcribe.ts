import {
  PagesContext,
  handleCorsPreflight,
  jsonEdgeResponse,
  resolveUpstreamOrigin,
  fetchWithTimeout,
} from '../_lib/edgeHelpers';

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);
  if (request.method !== 'POST') {
    return jsonEdgeResponse({ error: 'Method not allowed' }, 405, request, undefined, env);
  }

  const body = (await request.json().catch(() => ({}))) as {
    audioData?: string;
    mimeType?: string;
  };
  const audioData = typeof body.audioData === 'string' ? body.audioData.trim() : '';
  const mimeType =
    typeof body.mimeType === 'string' && body.mimeType.trim() ? body.mimeType.trim() : 'audio/webm';

  if (!audioData) {
    return jsonEdgeResponse({ error: 'audioData base64 string is required.' }, 400, request, undefined, env);
  }

  // 1. Try upstream gateway /api/transcribe if a real Whisper/Gemini STT backend is active
  const upstreamOrigin = resolveUpstreamOrigin(env);
  try {
    const authHeader = request.headers.get('Authorization');
    const upstreamRes = await fetchWithTimeout(
      `${upstreamOrigin}/api/transcribe`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: JSON.stringify({ audioData, mimeType }),
      },
      7500
    );
    if (upstreamRes.ok) {
      const data = (await upstreamRes.json().catch(() => null)) as {
        transcript?: string;
        text?: string;
      } | null;
      const resolved = String(data?.transcript || data?.text || '').trim();
      if (resolved) {
        return jsonEdgeResponse({ transcript: resolved, source: 'upstream-stt' }, 200, request, undefined, env);
      }
    }
  } catch {
    // Continue to Gemini Audio fallback if GEMINI_API_KEY is bound on Pages
  }

  // 2. If Cloudflare Pages env.GEMINI_API_KEY is configured, transcribe using Gemini 3.5 Transcribe
  const geminiKey = env?.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    try {
      const geminiRes = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe:generateContent?key=${encodeURIComponent(
          geminiKey
        )}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: 'Transcribe the spoken audio accurately in its original language (Bengali or English). Return ONLY the transcript text with no explanation.',
                  },
                  {
                    inlineData: {
                      mimeType,
                      data: audioData,
                    },
                  },
                ],
              },
            ],
          }),
        },
        14000
      );
      if (geminiRes.ok) {
        const gJson = (await geminiRes.json().catch(() => null)) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        } | null;
        const transcript = String(gJson?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
        if (transcript) {
          return jsonEdgeResponse({ transcript, source: 'edge-gemini-stt' }, 200, request, undefined, env);
        }
      }
    } catch {
      // Fall through cleanly
    }
  }

  return jsonEdgeResponse(
    {
      error:
        'Server-side speech transcription requires GEMINI_API_KEY or live Whisper backend; please use your browser voice dictation.',
    },
    503,
    request,
    undefined,
    env
  );
}
