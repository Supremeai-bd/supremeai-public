import { Hono } from 'hono';
import { version } from '../../../package.json';
import { PLAN_CATALOG } from '../../config/plans';
import { CANONICAL_SERVER_MODELS } from '../../shared/platformCatalog';
import { readEnv, type ApiEnv } from '../app';

// বাংলা মন্তব্য: Edge ও Node-এর জন্য একই metadata; health মানে স্থানীয় liveness, upstream probe নয়।
export function createHealthRoutes(): Hono<ApiEnv> {
  const routes = new Hono<ApiEnv>();
  routes.get('/api/health', (c) =>
    c.json(
      {
        status: 'healthy',
        app: 'SupremeAI Studio',
        organization: 'Supremeai-bd',
        version: `v${version}`,
        modelsCount: Object.keys(CANONICAL_SERVER_MODELS).length,
        plans: PLAN_CATALOG,
        repositories: {
          primary: 'https://github.com/Supremeai-bd/supremeai',
          studio: 'https://github.com/Supremeai-bd/supremeai-public',
        },
        // বাংলা মন্তব্য: পুরনো Node-এর secret-presence field বাদ; Edge-এর বিদ্যমান aggregate contract রাখা।
        providerReadiness: readEnv(c, 'GEMINI_API_KEY') ? 'ready' : 'relay-only',
      },
      200,
      { 'Cache-Control': 'no-store' }
    )
  );
  // বাংলা মন্তব্য: GET থেকে Hono স্বয়ংক্রিয়ভাবে HEAD সামলায় এবং body বাদ দেয়।
  routes.all('/api/health', (c) =>
    c.json({ error: 'Method not allowed' }, 405, {
      Allow: 'GET, HEAD',
      'Cache-Control': 'no-store',
    })
  );
  return routes;
}
