import { PagesContext, handleCorsPreflight, jsonEdgeResponse } from '../_lib/edgeHelpers';

// বাংলা মন্তব্য: Cloudflare Pages Edge-এর জন্য ইউনিফাইড মডেল ক্যাটালগ (যাতে আপস্ট্রিম 404/429 ছাড়াই মডেল ম্যাট্রিক্স ও ফেডারেশন সিঙ্ক তৎক্ষণাৎ লোড হয়)
const EDGE_SUPPORTED_MODELS: Record<
  string,
  { name: string; description: string; tier: 'standard' | 'advanced' }
> = {
  'supreme-core': {
    name: 'SupremeAI Core',
    description: 'Flagship multimodal foundation model for general tasks, synthesis & coding',
    tier: 'standard',
  },
};

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonEdgeResponse({ error: 'Method not allowed' }, 405, request, undefined, env);
  }

  return jsonEdgeResponse(
    {
      models: EDGE_SUPPORTED_MODELS,
      defaultModel: 'supreme-core',
      source: 'edge-studio',
    },
    200,
    request,
    undefined,
    env
  );
}
