import { Hono } from 'hono';
import { PLAN_CATALOG, TOPUP_PACKAGES } from '../../config/plans';
import { DEFAULT_MODEL_ID, DEFAULT_MODEL_POLICIES } from '../../shared/platformCatalog';
import type { ApiDeps, ApiEnv } from '../app';

const DEFAULT_EDGE_FEATURE_FLAGS: Record<string, boolean> = {
  enable_supreme_reason: true,
  enable_multimodal_vision: true,
  enable_rag_grounding: true,
  enable_continuous_agent_swarm: true,
  enforce_strict_rate_limits: false,
  maintenance_mode: false,
};

/**
 * GET /api/platform/config — public runtime governance & model-policy manifest.
 *
 * বাংলা মন্তব্য: Node-এ `deps.getPlatformConfig` মাধ্যমে লাইভ অ্যাডমিন স্টেট ও ফিচার-ফ্ল্যাগ আসে;
 * Edge-এ ক্যানোনিকাল ডিফল্ট মডেল পলিসি ও প্ল্যান ক্যাটালগ সরাসরি পরিবেশন করা হয়।
 */
export function createPlatformConfigRoutes(deps: ApiDeps = {}): Hono<ApiEnv> {
  const routes = new Hono<ApiEnv>();

  routes.get('/api/platform/config', (c) => {
    const runtimeSnapshot = deps.getPlatformConfig?.();
    const base = runtimeSnapshot ?? {
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
      featureFlags: DEFAULT_EDGE_FEATURE_FLAGS,
      modelPolicies: DEFAULT_MODEL_POLICIES,
    };

    return c.json(
      {
        ...base,
        plans: PLAN_CATALOG,
        topupPackages: TOPUP_PACKAGES,
      },
      200,
      { 'Cache-Control': 'no-store' }
    );
  });

  routes.all('/api/platform/config', (c) =>
    c.json({ error: 'Method not allowed' }, 405, { Allow: 'GET, HEAD' })
  );

  return routes;
}
