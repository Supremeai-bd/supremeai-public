/**
 * Cloudflare Pages adapter — unified Hono API (`src/api/app.ts`) চালানো।
 *
 * কোনো রুট Hono-তে সরানো হলে তার Pages Function ফাইলটা শুধু এক লাইনের হয়:
 *   export { onRequestViaHono as onRequest } from '../../_lib/honoAdapter';
 *
 * রানটাইম-নির্দিষ্ট কাজ এখানে: CORS preflight আর allowlist-ভিত্তিক CORS
 * হেডার (আগে প্রতিটা ফাইল `jsonEdgeResponse`/`handleCorsPreflight` দিয়ে
 * আলাদা করে করত)। Security header `functions/_middleware.ts` দেয়।
 */

import { createApiApp } from '../../src/api/app';
import { applyCorsHeaders, handleCorsPreflight, type PagesContext } from './edgeHelpers';

// বাংলা মন্তব্য: isolate প্রতি একবার তৈরি — রুট-লেভেল ক্যাশ (যেমন releases) টিকে থাকে
const api = createApiApp();

export async function onRequestViaHono(context: PagesContext): Promise<Response> {
  const { request, env = {} } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);

  const response = await api.fetch(request, env);
  const headers = new Headers(response.headers);
  applyCorsHeaders(headers, request.headers.get('Origin'), new URL(request.url).origin, env);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
