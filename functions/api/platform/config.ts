import { PagesContext, handleCorsPreflight, jsonEdgeResponse } from '../../_lib/edgeHelpers';

// বাংলা মন্তব্য: Cloudflare Pages Edge-এর জন্য প্ল্যাটফর্ম গভর্ন্যান্স কনফিগ (যাতে গেস্ট বা বুট সময়ে 401/429 এরর ছাড়াই ডিফল্ট পলিসি লোড হয়)
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
        message: 'All SupremeAI Core routes are operating normally.',
        level: 'info',
      },
      allowNewSignups: true,
      defaultModelId: 'supreme-core',
      featureFlags: {
        enable_supreme_reason: true,
        enable_multimodal_vision: true,
        enable_rag_grounding: true,
        enable_continuous_agent_swarm: true,
        enforce_strict_rate_limits: false,
        maintenance_mode: false,
      },
      modelPolicies: {
        'supreme-core': { enabled: true, minTier: 'Free' },
        'supreme-spark': { enabled: false, minTier: 'Free' },
        'supreme-reason': { enabled: false, minTier: 'Pro' },
        'supreme-deep': { enabled: false, minTier: 'Enterprise' },
        'supremeai-web': { enabled: false, minTier: 'Free' },
        'supremeai-api': { enabled: false, minTier: 'Free' },
      },
    },
    200,
    request,
    undefined,
    env
  );
}
