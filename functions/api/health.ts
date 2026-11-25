import { PagesContext, handleCorsPreflight, jsonEdgeResponse } from '../_lib/edgeHelpers';
import { PLAN_CATALOG } from '../../src/config/plans';
import { CANONICAL_SERVER_MODELS } from '../../src/shared/platformCatalog';

// বাংলা মন্তব্য: Cloudflare Pages Edge-এর জন্য স্থানীয় Studio health এন্ডপয়েন্ট (যাতে Render আপস্ট্রিমে অযথা প্রক্সি না হয়ে শূন্য ল্যাটেন্সিতে 200 OK দেয়)
export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonEdgeResponse({ error: 'Method not allowed' }, 405, request, undefined, env);
  }

  // বাংলা মন্তব্য: SA-02 ফিক্স — /api/models-এর ক্যানোনিকাল ক্যাটালগ থেকে modelsCount গণনা
  // এবং সিক্রেট উপস্থিতি সরাসরি লিক না করে aggregate providerReadiness পাঠানো হচ্ছে।
  const providerReadiness = env?.GEMINI_API_KEY?.trim() ? 'ready' : 'relay-only';
  return jsonEdgeResponse(
    {
      status: 'healthy',
      app: 'SupremeAI Studio',
      organization: 'Supremeai-bd',
      version: 'v2.5.0',
      modelsCount: Object.keys(CANONICAL_SERVER_MODELS).length,
      plans: PLAN_CATALOG,
      repositories: {
        primary: 'https://github.com/Supremeai-bd/supremeai',
        studio: 'https://github.com/Supremeai-bd/supremeai-public',
      },
      providerReadiness,
    },
    200,
    request,
    undefined,
    env
  );
}
