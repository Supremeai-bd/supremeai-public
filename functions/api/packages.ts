import { PagesContext, handleCorsPreflight, jsonEdgeResponse } from '../_lib/edgeHelpers';
import { handlePublicPackagesRoute } from '../_lib/creditPackages';

/**
 * বাংলা মন্তব্য: `GET /api/packages` — "Boost my limit"-এর পেইড অংশের প্ল্যান/প্যাকেজ তালিকা।
 * লগইন লাগে না (গেস্টও দাম দেখতে পারে); শুধু অ্যাডমিন চালু রাখা প্যাকেজ আসে।
 */
export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const res = await handlePublicPackagesRoute(path, request, env);
  return res ?? jsonEdgeResponse({ success: false, error: 'Not found.' }, 404, request);
}
