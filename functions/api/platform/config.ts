import { PagesContext, handleCorsPreflight, jsonEdgeResponse } from '../../_lib/edgeHelpers';
import { DEFAULT_MODEL_ID, DEFAULT_MODEL_POLICIES } from '../../../src/shared/platformCatalog';

// বাংলা মন্তব্য: Cloudflare Pages Edge-এর প্ল্যাটফর্ম কনফিগ এখন ক্যানোনিকাল মডেল পলিসি ব্যবহার করে
export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonEdgeResponse({ error: 'Method not allowed' }, 405, request, undefined, env);
  }

  return jsonEdgeResponse(
    {
      status: 'ok',
      maintenanceMode: false,
      maintenanceMessage:
        'SupremeAI Studio is undergoing scheduled database maintenance. Administrators remain online.',
      announcementBanner: {
        active: false,
        message: 'All SupremeAI Core and SupremeAI Reason routes are operating normally.',
        level: 'info',
      },
      allowNewSignups: true,
      defaultModelId: DEFAULT_MODEL_ID,
      featureFlags: {
        enable_supreme_reason: true,
        enable_multimodal_vision: true,
        enable_rag_grounding: true,
        enable_continuous_agent_swarm: true,
        enforce_strict_rate_limits: false,
        maintenance_mode: false,
      },
      modelPolicies: DEFAULT_MODEL_POLICIES,
    },
    200,
    request,
    undefined,
    env
  );
}
