import type { Express, Request, Response } from 'express';
import { getLiveMcpTowerServices } from '../mcpHealthCollector';
import { DEFAULT_MCP_TOWER_ORIGIN } from '../../config/platformEndpoints';

/**
 * MCP Tower proxy routes — the first group extracted from the `server.ts`
 * monolith (11.7k lines, 149 inline route registrations).
 *
 * WHY THIS FILE EXISTS
 *   `server.ts` had every route for web, desktop and Android in one function
 *   scope, so nobody could see the MCP Tower surface without reading 247 lines
 *   inside a 11.7k-line file. The group is genuinely cohesive: it proxies the
 *   Tower's health/services/reboot/probe/stream surface and nothing else.
 *
 * CONTRACT WITH server.ts
 *   Only five names were ever closed over by this group (verified by scope
 *   analysis over the enclosing function): `app`, `mcpClusterServices`,
 *   `resolveAuditActor`, `recordAudit` and `verifyAdminAuthorization`. They are
 *   passed in as `ctx` — the module imports nothing else from the monolith,
 *   which is what makes the split safe and reviewable.
 *
 *   Route registration ORDER is unchanged: server.ts calls this exactly where
 *   the inline block used to sit, so Express matching precedence is identical.
 */

/** Shape of the curated cluster descriptor list built in server.ts. */
export interface McpClusterService {
  id: string;
  name: string;
  displayName: string;
  category: string;
  port: number;
  status: string;
  [key: string]: unknown;
}

export interface McpTowerRoutesContext {
  mcpClusterServices: readonly McpClusterService[];
  resolveAuditActor: (req?: Request, explicitActor?: unknown) => string;
  recordAudit: (
    actor: string,
    action: string,
    resource: string,
    details: string,
    req?: Request,
  ) => unknown;
  verifyAdminAuthorization: (
    req: Request,
  ) => Promise<{ ok: true; email: string } | { ok: false; status: number; error: string }>;
}

export function registerMcpTowerRoutes(app: Express, ctx: McpTowerRoutesContext): void {
  const { mcpClusterServices, resolveAuditActor, recordAudit, verifyAdminAuthorization } = ctx;

  app.get('/api/mcp-tower/health', async (_req: Request, res: Response) => {
    const mcpOrigin = (process.env.MCP_TOWER_URL || DEFAULT_MCP_TOWER_ORIGIN)
      .trim()
      .replace(/\/agents\/[^/]+\/mcp$/i, '')
      .replace(/\/mcp$/i, '')
      .replace(/\/+$/, '');
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const probe = await fetch(`${mcpOrigin}/health`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        const latencyMs = Date.now() - started;
        res.json({
          status: probe.ok ? (latencyMs > 2500 ? 'degraded' : 'ok') : 'degraded',
          httpStatus: probe.status,
          latencyMs,
          endpoint: mcpOrigin,
          checkedAt: new Date().toISOString(),
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (err: unknown) {
      res.status(200).json({
        status: 'unreachable',
        latencyMs: Date.now() - started,
        endpoint: mcpOrigin,
        error: err instanceof Error ? err.message : 'Probe timed out',
        checkedAt: new Date().toISOString(),
      });
    }
  });

  // GET /api/mcp-tower/services - Live services from MCP Tower & HTTP health probes
  app.get('/api/mcp-tower/services', async (req: Request, res: Response) => {
    try {
      const force = req.query.refresh === '1';
      const liveServices = await getLiveMcpTowerServices(force);
      const total = liveServices.length;
      const healthy = liveServices.filter((s) => s.status === 'healthy').length;
      const degraded = liveServices.filter((s) => s.status === 'degraded').length;
      const unhealthy = liveServices.filter((s) => s.status === 'unhealthy').length;
      const totalLatency = liveServices.reduce((sum, s) => sum + s.latencyMs, 0);
      const avgLatency = total > 0 ? Math.round(totalLatency / total) : 0;
      const healthScore = total > 0 ? Math.round((healthy / total) * 100) : 100;

      res.json({
        summary: {
          total,
          healthy,
          degraded,
          unhealthy,
          avgLatency,
          healthScore,
          lastClusterAudit: new Date().toISOString(),
        },
        services: liveServices,
      });
    } catch (err: unknown) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to reach MCP Tower',
        services: [],
      });
    }
  });

  // POST /api/mcp-tower/reboot - Guarded live container restart & probe via Render API & MCP Tower
  app.post(
    '/api/mcp-tower/reboot',
    async (
      req: Request<Record<string, never>, Record<string, never>, { serviceId: string }>,
      res: Response
    ) => {
      const adminAuth = await verifyAdminAuthorization(req);
      if (!adminAuth.ok) {
        res.status(adminAuth.status).json({ error: adminAuth.error });
        return;
      }

      const { serviceId } = req.body;
      if (!serviceId) {
        res.status(400).json({ error: 'serviceId is required' });
        return;
      }

      const liveServices = await getLiveMcpTowerServices(true);
      const matched =
        liveServices.find((s) => s.id === serviceId) ||
        mcpClusterServices.find((s) => s.id === serviceId);
      if (!matched) {
        res.status(404).json({ error: `Service '${serviceId}' not found in MCP Tower cluster` });
        return;
      }

      let renderActionNote = '';
      const renderApiKey = process.env.RENDER_API_KEY?.trim();
      if (renderApiKey) {
        let renderSvcId = '';
        const sId = serviceId.toLowerCase();
        if (sId.includes('api') || sId.includes('primary') || sId.includes('gateway')) {
          renderSvcId = process.env.RENDER_SERVICE_ID_API?.trim() || '';
        } else if (sId.includes('mcp') || sId.includes('tower')) {
          renderSvcId = process.env.RENDER_SERVICE_ID_MCP?.trim() || '';
        } else if (sId.includes('browser')) {
          renderSvcId = process.env.RENDER_SERVICE_ID_BROWSER?.trim() || '';
        }

        if (renderSvcId) {
          try {
            const renderRes = await fetch(
              `https://api.render.com/v1/services/${renderSvcId}/restart`,
              {
                method: 'POST',
                headers: { Authorization: `Bearer ${renderApiKey}`, Accept: 'application/json' },
                signal: AbortSignal.timeout(8000),
              }
            );
            renderActionNote = renderRes.ok
              ? ` Live container restart dispatched via Render API (HTTP ${renderRes.status}).`
              : ` Render restart returned HTTP ${renderRes.status}.`;
          } catch (err: unknown) {
            renderActionNote = ` Render restart attempt timed out.`;
          }
        }
      }

      recordAudit(
        resolveAuditActor(req),
        'MCP_SERVICE_REBOOT',
        matched.displayName,
        `Triggered active service probe.${renderActionNote}`,
        req
      );

      res.json({
        success: true,
        message: `Service '${matched.displayName}' re-probed.${renderActionNote}`,
        service: matched,
      });
    }
  );

  // POST /api/mcp-tower/reboot-all - Active cluster recovery sweep
  app.post('/api/mcp-tower/reboot-all', async (req: Request, res: Response) => {
    const adminAuth = await verifyAdminAuthorization(req);
    if (!adminAuth.ok) {
      res.status(adminAuth.status).json({ error: adminAuth.error });
      return;
    }

    const liveServices = await getLiveMcpTowerServices(true);
    const renderApiKey = process.env.RENDER_API_KEY?.trim();
    const serviceMap: Array<{ name: string; envVar: string }> = [
      { name: 'supremeai-api', envVar: 'RENDER_SERVICE_ID_API' },
      { name: 'supremeai-mcp-tower', envVar: 'RENDER_SERVICE_ID_MCP' },
      { name: 'supremeai-browser', envVar: 'RENDER_SERVICE_ID_BROWSER' },
    ];

    const actions: Array<{ service: string; ok: boolean; detail: string }> = [];
    if (renderApiKey) {
      for (const svc of serviceMap) {
        const svcId = process.env[svc.envVar]?.trim() || '';
        if (!svcId) {
          actions.push({ service: svc.name, ok: false, detail: 'No Render service id configured' });
          continue;
        }
        try {
          const r = await fetch(`https://api.render.com/v1/services/${svcId}/restart`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${renderApiKey}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(8000),
          });
          actions.push({ service: svc.name, ok: r.ok, detail: `Render restart HTTP ${r.status}` });
        } catch {
          actions.push({ service: svc.name, ok: false, detail: 'Render restart request failed' });
        }
      }
    }

    const restartedCount = actions.filter((a) => a.ok).length;
    recordAudit(
      resolveAuditActor(req),
      'MCP_CLUSTER_SWEEP',
      'MCP Tower Mesh',
      renderApiKey
        ? `Cluster restart dispatched: ${restartedCount}/${actions.length} services restarted`
        : 'Render not configured; ran live health probe only',
      req
    );

    res.json({
      success: true,
      renderConfigured: Boolean(renderApiKey),
      restartedCount,
      actions,
      message: renderApiKey
        ? `Dispatched Render restart to ${restartedCount}/${actions.length} configured service(s); refreshed live health.`
        : 'RENDER_API_KEY not configured; executed live health probe only (no restarts dispatched).',
      services: liveServices,
    });
  });

  // POST /api/mcp-tower/probe - Force an immediate live health check probe
  app.post('/api/mcp-tower/probe', async (_req: Request, res: Response) => {
    const liveServices = await getLiveMcpTowerServices(true);
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      services: liveServices,
    });
  });

  // GET /api/mcp-tower/stream - Live Server-Sent Events (SSE) using real MCP Tower & HTTP probes
  app.get('/api/mcp-tower/stream', async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const pushLiveServices = async (force: boolean) => {
      try {
        const services = await getLiveMcpTowerServices(force);
        res.write(
          `data: ${JSON.stringify({ type: force ? 'live_tick' : 'init', timestamp: Date.now(), services })}\n\n`
        );
      } catch {
        // Keep SSE socket open on transient upstream errors
      }
    };

    await pushLiveServices(false);

    const interval = setInterval(() => {
      void pushLiveServices(true);
    }, 6000);

    req.on('close', () => {
      clearInterval(interval);
    });
  });
}
