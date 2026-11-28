import { Hono } from 'hono';
import { handleAlertIngest } from '../../../functions/_lib/adminAlerts';
import type { ApiDeps, ApiEnv } from '../app';

export function createInternalAlertsRoutes(deps: ApiDeps = {}): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const fetchImpl = deps.fetch ?? fetch;

  app.all('/api/internal/alerts', (c) => handleAlertIngest(c.req.raw, c.env ?? {}, fetchImpl));

  return app;
}
