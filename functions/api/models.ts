import { PagesContext, handleCorsPreflight, jsonEdgeResponse } from '../_lib/edgeHelpers';
import { CANONICAL_SERVER_MODELS, DEFAULT_MODEL_ID } from '../../src/shared/platformCatalog';

// বাংলা মন্তব্য: Cloudflare Pages Edge-এ ক্যানোনিকাল মডেল ক্যাটালগ (`auto` + সব ৬টি মডেল) সরবরাহ করা হচ্ছে যাতে সব প্ল্যাটফর্মে একই তালিকা পাওয়া যায়
export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonEdgeResponse({ error: 'Method not allowed' }, 405, request, undefined, env);
  }

  return jsonEdgeResponse(
    {
      models: CANONICAL_SERVER_MODELS,
      defaultModel: DEFAULT_MODEL_ID,
      source: 'edge-studio',
    },
    200,
    request,
    undefined,
    env
  );
}
