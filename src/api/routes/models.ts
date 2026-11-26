import { Hono } from 'hono';
import { CANONICAL_SERVER_MODELS, DEFAULT_MODEL_ID } from '../../shared/platformCatalog';
import type { ApiDeps, ApiEnv } from '../app';

// বাংলা মন্তব্য: Node পুরনো cached gateway callback দেয়; Edge callback দেয় না, তাই network ছাড়াই catalog ফেরে।
export function createModelsRoutes(deps: ApiDeps = {}): Hono<ApiEnv> {
  const routes = new Hono<ApiEnv>();
  routes.get('/api/models', async (c) => {
    let remote: Record<string, unknown> | null = null;
    try {
      const data = await deps.fetchGatewayJson?.('/api/v1/models');
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        remote = data as Record<string, unknown>;
      }
    } catch {
      // বাংলা মন্তব্য: পুরনো Node cache helper-ও failure-এ fallback করে; injection ব্যর্থ হলেও একই contract।
    }
    const remoteModels = remote?.models;
    const hasRemoteMap =
      remoteModels && typeof remoteModels === 'object' && !Array.isArray(remoteModels);
    return c.json({
      models: hasRemoteMap
        ? { ...CANONICAL_SERVER_MODELS, ...remoteModels }
        : CANONICAL_SERVER_MODELS,
      defaultModel:
        (hasRemoteMap && (remote?.defaultModel || remote?.default_model)) || DEFAULT_MODEL_ID,
      source: hasRemoteMap
        ? 'gateway+canonical'
        : deps.fetchGatewayJson
          ? 'canonical'
          : 'edge-studio',
    });
  });
  // বাংলা মন্তব্য: Hono GET থেকে HEAD সামলায়; অন্য method-এ Edge-এর বিদ্যমান 405 রাখা।
  routes.all('/api/models', (c) =>
    c.json({ error: 'Method not allowed' }, 405, { Allow: 'GET, HEAD' })
  );
  return routes;
}
