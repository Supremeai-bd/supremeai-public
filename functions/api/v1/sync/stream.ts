/**
 * বাংলা মন্তব্য: Cloudflare Pages Edge-এ `/api/v1/sync/stream` SSE এন্ডপয়েন্ট।
 * আপস্ট্রিম SSE স্ট্রিম সচল থাকলে সরাসরি স্ট্রিম প্রক্সি করে; অন্যথায় তাৎক্ষণিক স্ন্যাপশট ইভেন্ট পাঠায়
 * যাতে ক্লায়েন্ট এরর ছাড়াই কানেক্টেড থাকে।
 */
import {
  PagesContext,
  applyCorsHeaders,
  fetchWithTimeout,
  handleCorsPreflight,
  resolveUpstreamOrigin,
} from '../../../_lib/edgeHelpers';

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);

  const incomingUrl = new URL(request.url);
  const upstreamOrigin = resolveUpstreamOrigin(env);
  const authHeader = (request.headers.get('Authorization') || '').trim();
  const queryToken = (incomingUrl.searchParams.get('token') || '').trim();
  const bearer = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : (request.headers.get('X-SupremeAI-Key') || queryToken).trim();

  if (bearer && !bearer.startsWith('tok_guest_') && !bearer.startsWith('sk-supreme-guest')) {
    try {
      const upstreamUrl = new URL(`${upstreamOrigin}/api/v1/sync/stream`);
      incomingUrl.searchParams.forEach((v, k) => {
        if (k !== 'token') upstreamUrl.searchParams.set(k, v);
      });
      const upstreamRes = await fetchWithTimeout(
        upstreamUrl.toString(),
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${bearer}`,
            'X-SupremeAI-Key': bearer,
            Accept: 'text/event-stream',
          },
        },
        4500
      );
      if (upstreamRes.ok && upstreamRes.body) {
        const headers = new Headers({
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        });
        applyCorsHeaders(headers, request.headers.get('Origin'), incomingUrl.origin, env);
        return new Response(upstreamRes.body, { status: 200, headers });
      }
    } catch {
      // Fallback to Edge SSE snapshot stream below
    }
  }

  // বাংলা মন্তব্য: আপস্ট্রিম স্ট্রিম অনুপলব্ধ হলে বৈধ SSE ইভেন্ট স্ট্রিম প্রদান করে যাতে EventSource/fetch ত্রুটি না দেয়
  const headers = new Headers({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
  });
  applyCorsHeaders(headers, request.headers.get('Origin'), incomingUrl.origin, env);

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          `event: connected\ndata: ${JSON.stringify({
            status: bearer ? 'edge-bridge' : 'guest',
            serverTimestamp: Date.now(),
          })}\n\n`
        )
      );

      if (bearer && !bearer.startsWith('tok_guest_') && !bearer.startsWith('sk-supreme-guest')) {
        try {
          const prefRes = await fetchWithTimeout(
            `${upstreamOrigin}/api/v1/user/preferences`,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${bearer}`,
                'X-SupremeAI-Key': bearer,
                Accept: 'application/json',
              },
            },
            4500
          );
          if (prefRes.ok) {
            const prefJson = (await prefRes.json().catch(() => null)) as {
              preferences?: Record<string, unknown>;
            } | null;
            const domains = prefJson?.preferences?.__sync_domains;
            if (domains && typeof domains === 'object') {
              for (const envItem of Object.values(domains as Record<string, unknown>)) {
                if (envItem && typeof envItem === 'object') {
                  controller.enqueue(
                    encoder.encode(`event: sync\ndata: ${JSON.stringify(envItem)}\n\n`)
                  );
                }
              }
            }
          }
        } catch {
          // Ignore snapshot fetch failure
        }
      }
      controller.close();
    },
  });

  return new Response(body, { status: 200, headers });
}
