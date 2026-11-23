import { PagesContext, handleCorsPreflight, jsonEdgeResponse } from '../_lib/edgeHelpers';
import { PLAN_CATALOG } from '../../src/config/plans';

// বাংলা মন্তব্য: Cloudflare Pages Edge-এর জন্য স্থানীয় Studio health এন্ডপয়েন্ট (যাতে Render আপস্ট্রিমে অযথা প্রক্সি না হয়ে শূন্য ল্যাটেন্সিতে 200 OK দেয়)
export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonEdgeResponse({ error: 'Method not allowed' }, 405, request, undefined, env);
  }

  const hasApiKey = Boolean(env?.GEMINI_API_KEY?.trim());
  return jsonEdgeResponse(
    {
      status: 'healthy',
      app: 'SupremeAI Studio',
      organization: 'Supremeai-bd',
      version: 'v2.5.0',
      modelsCount: 1,
      plans: PLAN_CATALOG,
      repositories: {
        primary: 'https://github.com/Supremeai-bd/supremeai',
        studio: 'https://github.com/Supremeai-bd/supremeai-public',
      },
      hasApiKey,
    },
    200,
    request,
    undefined,
    env
  );
}
