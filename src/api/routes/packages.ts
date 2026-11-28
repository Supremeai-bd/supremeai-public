import { Hono } from 'hono';
import { handlePublicPackagesRoute } from '../../../functions/_lib/creditPackages';
import type { ApiDeps, ApiEnv } from '../app';

export function createPackagesRoutes(deps: ApiDeps = {}): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const fetchImpl = deps.fetch ?? fetch;

  app.all('/api/packages', async (c) => {
    const res = await handlePublicPackagesRoute('/api/packages', c.req.raw, c.env ?? {}, fetchImpl);
    return res ?? c.json({ success: false, error: 'Not found.' }, 404);
  });

  return app;
}
