import type { Express, Request, Response } from 'express';
import { getRealGatewayTrafficSummary } from '../../mcpHealthCollector';

/**
 * Admin System — schema parity + LLM gateway + GitHub pipeline
 *
 * WHY THIS FILE EXISTS
 *   The final island of `api/admin/*` (9 handlers) lives far from the first
 *   island — after billing/workspace/projects/preferences. It was left behind
 *   because it depends on three exclusive stores (schemaParityTables,
 *   llmGatewayRoutes) and three exclusive helpers (fetchSupabaseLiveSchema,
 *   isSupabaseConfigured, getGithubAuthHeaders). Moving them together
 *   removes ~450 lines from server.ts and completes the `api/admin/*`
 *   extraction (39/39 handlers now in `src/server/routes/admin/`).
 *
 * CONTRACT WITH server.ts
 *   Stores and helpers are owned here — they were defined immediately before
 *   or inside the handlers and have no other consumer. Only audit helpers
 *   and the live traffic summary are injected via ctx. Registration order
 *   is preserved — server.ts calls this where the inline block sat.
 */

export interface AdminSystemContext {
  resolveAuditActor: (req?: Request, explicitActor?: unknown) => string;
  recordAudit: (
    actor: string,
    action: string,
    resource: string,
    details: string,
    req?: Request,
  ) => unknown;
}

export function registerAdminSystemRoutes(app: Express, ctx: AdminSystemContext): void {
  let schemaParityTables = [
    {
      id: 'tbl_01',
      tableName: 'customers',
      localColumns: 14,
      stagingColumns: 14,
      prodColumns: 14,
      driftDetected: false,
      rlsEnabled: true,
      lastMigrated: new Date().toISOString().slice(0, 16).replace('T', ' '),
    },
    {
      id: 'tbl_02',
      tableName: 'chat_sessions',
      localColumns: 11,
      stagingColumns: 11,
      prodColumns: 11,
      driftDetected: false,
      rlsEnabled: true,
      lastMigrated: new Date().toISOString().slice(0, 16).replace('T', ' '),
    },
    {
      id: 'tbl_03',
      tableName: 'chat_messages',
      localColumns: 9,
      stagingColumns: 9,
      prodColumns: 9,
      driftDetected: false,
      rlsEnabled: true,
      lastMigrated: new Date().toISOString().slice(0, 16).replace('T', ' '),
    },
    {
      id: 'tbl_04',
      tableName: 'api_keys',
      localColumns: 10,
      stagingColumns: 10,
      prodColumns: 9,
      driftDetected: true,
      driftSummary: 'Production missing column "permissions_jsonb". Migration pending.',
      rlsEnabled: true,
      lastMigrated: 'Pending parity sync',
    },
    {
      id: 'tbl_05',
      tableName: 'vector_embeddings',
      localColumns: 8,
      stagingColumns: 8,
      prodColumns: 8,
      driftDetected: false,
      rlsEnabled: true,
      lastMigrated: new Date().toISOString().slice(0, 16).replace('T', ' '),
    },
    {
      id: 'tbl_06',
      tableName: 'audit_logs',
      localColumns: 8,
      stagingColumns: 8,
      prodColumns: 8,
      driftDetected: false,
      rlsEnabled: true,
      lastMigrated: new Date().toISOString().slice(0, 16).replace('T', ' '),
    },
  ];

  const llmGatewayRoutes = [
    {
      id: 'route_core_primary',
      modelId: 'supreme-core',
      displayName: 'SupremeAI Core (Primary Engine)',
      primaryProvider: 'SupremeAI Mesh (Primary)',
      fallbackProvider: 'SupremeAI Edge Cluster (Global)',
      currentLatencyMs: 24,
      errorRatePercent: 0.02,
      requestsPerMin: 0,
      costPer1MIn: 0.1,
      costPer1MOut: 0.4,
      customerPricePer1M: 0.75,
      autoFailoverActive: true,
    },
    {
      id: 'route_spark_fast',
      modelId: 'supreme-spark',
      displayName: 'SupremeAI Spark (High-Speed Fallback)',
      primaryProvider: 'SupremeAI Edge Cluster (Global)',
      fallbackProvider: 'SupremeAI Mesh (Backup)',
      currentLatencyMs: 14,
      errorRatePercent: 0.0,
      requestsPerMin: 0,
      costPer1MIn: 0.05,
      costPer1MOut: 0.15,
      customerPricePer1M: 0.35,
      autoFailoverActive: true,
    },
    {
      id: 'route_reason_deep',
      modelId: 'supreme-reason',
      displayName: 'SupremeAI Reason (Deep Reasoning Compute)',
      primaryProvider: 'SupremeAI Reasoning Cluster (Primary)',
      fallbackProvider: 'SupremeAI Mesh (Tier 1)',
      currentLatencyMs: 140,
      errorRatePercent: 0.12,
      requestsPerMin: 0,
      costPer1MIn: 1.25,
      costPer1MOut: 5.0,
      customerPricePer1M: 8.5,
      autoFailoverActive: true,
    },
    {
      id: 'route_deep_agent',
      modelId: 'supreme-deep',
      displayName: 'SupremeAI Deep (Complex Code Synthesis)',
      primaryProvider: 'SupremeAI Swarm Engine (Primary)',
      fallbackProvider: 'SupremeAI Mesh (Backup Pool)',
      currentLatencyMs: 110,
      errorRatePercent: 0.08,
      requestsPerMin: 0,
      costPer1MIn: 2.0,
      costPer1MOut: 8.0,
      customerPricePer1M: 12.0,
      autoFailoverActive: false,
    },
  ];

  const fetchSupabaseLiveSchema = async (): Promise<Record<string, number> | null> => {
    const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
      .trim()
      .replace(/\/$/, '');
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !key) return null;
    try {
      const res = await fetch(`${url}/rest/v1/`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: 'application/openapi+json, application/json',
        },
        signal: AbortSignal.timeout(6500),
      });
      if (!res.ok) return null;
      const spec: unknown = await res.json();
      const tables: Record<string, number> = {};
      const defs =
        (spec as { definitions?: Record<string, unknown> })?.definitions ||
        (spec as { components?: { schemas?: Record<string, unknown> } })?.components?.schemas ||
        {};
      for (const [name, schema] of Object.entries(defs)) {
        const props = (schema as { properties?: Record<string, unknown> })?.properties;
        if (props && typeof props === 'object') {
          tables[name] = Object.keys(props).length;
        }
      }
      return tables;
    } catch {
      return null;
    }
  };

  const isSupabaseConfigured = () =>
    Boolean(
      (process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()) &&
        process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    );

  const getGithubAuthHeaders = () => {
    const token =
      process.env.GITHUB_TOKEN?.trim() || process.env.GITHUB_READONLY_TOKEN?.trim() || '';
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'SupremeAI-Studio-Admin',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return { headers, hasToken: Boolean(token) };
  };

  // Admin Schema Parity Endpoints
  app.get(
    ['/api/admin/schema-parity', '/api/schema-parity'],
    async (_req: Request, res: Response) => {
      const configured = isSupabaseConfigured();
      if (!configured) {
        const tables = schemaParityTables.map((t) => ({
          ...t,
          prodColumns: t.localColumns,
          stagingColumns: t.localColumns,
          driftDetected: false,
          driftSummary: undefined,
          lastMigrated: 'Not verified (Supabase not configured)',
        }));
        res.json({
          tables,
          configured: false,
          message: 'Supabase is not configured on this server; schema parity is unverified.',
        });
        return;
      }

      const liveSchema = await fetchSupabaseLiveSchema();
      if (liveSchema) {
        const tables = schemaParityTables.map((t) => {
          const prodCount = liveSchema[t.tableName] ?? liveSchema[t.tableName.toLowerCase()] ?? 0;
          const exists = t.tableName in liveSchema || t.tableName.toLowerCase() in liveSchema;
          const drift = !exists || prodCount !== t.localColumns;
          let summary: string | undefined = undefined;
          if (!exists) {
            summary = `Table "${t.tableName}" not found in Supabase schema.`;
          } else if (prodCount !== t.localColumns) {
            summary = `Column count mismatch: Supabase has ${prodCount}, local expected ${t.localColumns}.`;
          }
          return {
            ...t,
            prodColumns: prodCount,
            stagingColumns: t.localColumns,
            driftDetected: drift,
            driftSummary: summary,
            lastMigrated: exists ? `Verified live (Supabase PostgREST)` : 'Missing in production',
          };
        });
        res.json({ tables, configured: true, provenance: 'live-supabase' });
        return;
      }

      res.json({ tables: schemaParityTables, configured: true, provenance: 'local-snapshot' });
    },
  );

  app.post(
    ['/api/admin/schema-parity/sync', '/api/schema-parity/sync'],
    async (req: Request, res: Response) => {
      if (!isSupabaseConfigured()) {
        ctx.recordAudit(
          ctx.resolveAuditActor(req, (req.body as Record<string, unknown>)?.actor),
          'SCHEMA_PARITY_SYNC',
          'Supabase Schema Parity',
          'Blocked: Supabase not configured, no DDL executed',
          req,
        );
        res.status(400).json({
          success: false,
          syncedCount: 0,
          tables: schemaParityTables,
          message: 'Supabase is not configured; no schema sync was executed.',
        });
        return;
      }

      const liveSchema = await fetchSupabaseLiveSchema();
      if (!liveSchema) {
        ctx.recordAudit(
          ctx.resolveAuditActor(req, (req.body as Record<string, unknown>)?.actor),
          'SCHEMA_PARITY_SYNC',
          'Supabase Schema Parity',
          'Introspection failed; no changes made',
          req,
        );
        res.status(502).json({
          success: false,
          syncedCount: 0,
          tables: schemaParityTables,
          configured: true,
          message: 'Supabase schema introspection failed; no changes were made.',
        });
        return;
      }

      let driftedCount = 0;
      const tables = schemaParityTables.map((t) => {
        const exists = t.tableName in liveSchema || t.tableName.toLowerCase() in liveSchema;
        const prodCount = liveSchema[t.tableName] ?? liveSchema[t.tableName.toLowerCase()] ?? 0;
        const drift = !exists || prodCount !== t.localColumns;
        if (drift) driftedCount += 1;
        return {
          ...t,
          prodColumns: prodCount,
          stagingColumns: t.localColumns,
          driftDetected: drift,
          driftSummary: drift
            ? exists
              ? `Column mismatch: production has ${prodCount}, local expects ${t.localColumns}.`
              : `Table "${t.tableName}" missing in production.`
            : undefined,
          lastMigrated: 'Verified live (auto-DDL not executed)',
        };
      });
      schemaParityTables = tables;

      ctx.recordAudit(
        ctx.resolveAuditActor(req, (req.body as Record<string, unknown>)?.actor),
        'SCHEMA_PARITY_SYNC',
        'Supabase Schema Parity',
        `Re-verified live schema: ${driftedCount} table(s) still drifted (no auto-DDL)`,
        req,
      );

      res.json({
        success: true,
        syncedCount: 0,
        driftedCount,
        tables,
        configured: true,
        message:
          driftedCount === 0
            ? 'Live schema verified: all tables match local definitions.'
            : `Live schema verified: ${driftedCount} table(s) still drifted. Automatic DDL migration requires a direct Postgres connection (not available via PostgREST).`,
      });
    },
  );

  // Admin LLM Gateway Routes Endpoints
  app.get('/api/admin/llm-gateway', (_req: Request, res: Response) => {
    const traffic = getRealGatewayTrafficSummary();
    const routes = llmGatewayRoutes.map((r) => ({
      ...r,
      requestsPerMin: Math.max(
        0,
        traffic.rpm > 0 ? Math.round(traffic.rpm / llmGatewayRoutes.length) : r.requestsPerMin,
      ),
      errorRatePercent: traffic.totalRequests > 0 ? traffic.errorRatePercent : r.errorRatePercent,
    }));
    res.json({ routes, gatewayStatus: 'healthy', traffic });
  });

  app.post('/api/admin/llm-gateway/:id/failover', (req: Request, res: Response) => {
    const route = llmGatewayRoutes.find((r) => r.id === req.params.id);
    if (!route) {
      res.status(404).json({ error: 'Gateway route not found' });
      return;
    }
    route.autoFailoverActive = !route.autoFailoverActive;
    ctx.recordAudit(
      ctx.resolveAuditActor(req, (req.body as Record<string, unknown>)?.actor),
      'GATEWAY_FAILOVER_TOGGLE',
      route.modelId,
      `autoFailoverActive=${route.autoFailoverActive}`,
      req,
    );
    res.json({ success: true, route, routes: llmGatewayRoutes });
  });

  app.patch('/api/admin/llm-gateway/:id/price', (req: Request, res: Response) => {
    const route = llmGatewayRoutes.find((r) => r.id === req.params.id);
    if (!route) {
      res.status(404).json({ error: 'Gateway route not found' });
      return;
    }
    const newPrice = Number((req.body as Record<string, unknown>)?.customerPricePer1M);
    if (!Number.isFinite(newPrice) || newPrice < 0) {
      res.status(400).json({ error: 'Valid non-negative customerPricePer1M required' });
      return;
    }
    route.customerPricePer1M = newPrice;
    ctx.recordAudit(
      ctx.resolveAuditActor(req, (req.body as Record<string, unknown>)?.actor),
      'GATEWAY_PRICE_UPDATE',
      route.modelId,
      `Updated customer price to $${newPrice}/1M`,
      req,
    );
    res.json({ success: true, route, routes: llmGatewayRoutes });
  });

  // Admin GitHub Actions Runs & PR Pipeline
  app.get('/api/admin/github/runs', async (req: Request, res: Response) => {
    const repo =
      typeof req.query.repo === 'string' && req.query.repo.trim()
        ? req.query.repo.trim()
        : 'Supremeai-bd/supremeai';
    const { headers, hasToken } = getGithubAuthHeaders();
    try {
      const ghRes = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=10`, {
        headers,
        signal: AbortSignal.timeout(5500),
      });
      if (!ghRes.ok) {
        res.json({
          runs: [],
          tokenConfigured: hasToken,
          warning: `GitHub API returned HTTP ${ghRes.status}`,
        });
        return;
      }
      const data: unknown = await ghRes.json();
      const runs = (Array.isArray((data as { workflow_runs?: unknown[] })?.workflow_runs)
        ? (data as { workflow_runs: unknown[] }).workflow_runs
        : []
      ).map((r: unknown) => {
        const rr = r as Record<string, unknown>;
        return {
          id: rr.id,
          name: (rr.name as string) || 'CI Pipeline',
          status: (rr.status as string) || 'completed',
          conclusion: (rr.conclusion as string | null) ?? null,
          head_branch: (rr.head_branch as string) || 'main',
          created_at: rr.created_at,
          html_url: rr.html_url,
        };
      });
      res.json({ runs, tokenConfigured: hasToken });
    } catch (err: unknown) {
      res.json({
        runs: [],
        tokenConfigured: hasToken,
        warning: err instanceof Error ? err.message : 'GitHub API unreachable',
      });
    }
  });

  app.get('/api/admin/github/pulls', async (req: Request, res: Response) => {
    const repo =
      typeof req.query.repo === 'string' && req.query.repo.trim()
        ? req.query.repo.trim()
        : 'Supremeai-bd/supremeai';
    const { headers, hasToken } = getGithubAuthHeaders();
    try {
      const ghRes = await fetch(
        `https://api.github.com/repos/${repo}/pulls?state=open&per_page=10`,
        {
          headers,
          signal: AbortSignal.timeout(5500),
        },
      );
      if (!ghRes.ok) {
        res.json({
          pulls: [],
          tokenConfigured: hasToken,
          warning: `GitHub API returned HTTP ${ghRes.status}`,
        });
        return;
      }
      const data: unknown = await ghRes.json();
      const pulls = (Array.isArray(data) ? data : []).map((pr: unknown) => {
        const p = pr as Record<string, unknown>;
        const user = p.user as Record<string, unknown> | undefined;
        return {
          number: p.number,
          title: p.title,
          state: p.state,
          user: { login: (user?.login as string) || 'contributor' },
          created_at: p.created_at,
          html_url: p.html_url,
        };
      });
      res.json({ pulls, tokenConfigured: hasToken });
    } catch (err: unknown) {
      res.json({
        pulls: [],
        tokenConfigured: hasToken,
        warning: err instanceof Error ? err.message : 'GitHub API unreachable',
      });
    }
  });

  app.post('/api/admin/github/runs/:id/:action', async (req: Request, res: Response) => {
    const { id, action } = req.params;
    const repo =
      typeof req.body === 'object' &&
      req.body !== null &&
      typeof (req.body as Record<string, unknown>).repo === 'string' &&
      ((req.body as Record<string, unknown>).repo as string).trim()
        ? ((req.body as Record<string, unknown>).repo as string).trim()
        : 'Supremeai-bd/supremeai';
    const { headers, hasToken } = getGithubAuthHeaders();
    if (!hasToken) {
      res.status(401).json({ error: 'GITHUB_TOKEN is not configured on the server.' });
      return;
    }
    const endpoint = action === 'cancel' ? 'cancel' : 'rerun';
    const ghRes = await fetch(
      `https://api.github.com/repos/${repo}/actions/runs/${encodeURIComponent(id)}/${endpoint}`,
      {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!ghRes.ok) {
      res.status(ghRes.status).json({ error: `GitHub API returned HTTP ${ghRes.status}` });
      return;
    }
    ctx.recordAudit(
      ctx.resolveAuditActor(req),
      `GITHUB_RUN_${endpoint.toUpperCase()}`,
      `${repo} #${id}`,
      `Triggered ${endpoint}`,
      req,
    );
    res.json({ success: true });
  });

  app.post('/api/admin/github/pulls/:number/:action', async (req: Request, res: Response) => {
    const { number, action } = req.params;
    const repo =
      typeof req.body === 'object' &&
      req.body !== null &&
      typeof (req.body as Record<string, unknown>).repo === 'string' &&
      ((req.body as Record<string, unknown>).repo as string).trim()
        ? ((req.body as Record<string, unknown>).repo as string).trim()
        : 'Supremeai-bd/supremeai';
    const { headers, hasToken } = getGithubAuthHeaders();
    if (!hasToken) {
      res.status(401).json({ error: 'GITHUB_TOKEN is not configured on the server.' });
      return;
    }
    if (action === 'merge') {
      const ghRes = await fetch(
        `https://api.github.com/repos/${repo}/pulls/${encodeURIComponent(number)}/merge`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ merge_method: 'squash' }),
          signal: AbortSignal.timeout(6000),
        },
      );
      if (!ghRes.ok) {
        res.status(ghRes.status).json({ error: `GitHub merge failed with HTTP ${ghRes.status}` });
        return;
      }
    } else {
      const ghRes = await fetch(
        `https://api.github.com/repos/${repo}/pulls/${encodeURIComponent(number)}/reviews`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ event: 'APPROVE' }),
          signal: AbortSignal.timeout(6000),
        },
      );
      if (!ghRes.ok) {
        res.status(ghRes.status).json({ error: `GitHub approve failed with HTTP ${ghRes.status}` });
        return;
      }
    }
    ctx.recordAudit(
      ctx.resolveAuditActor(req),
      `GITHUB_PR_${action.toUpperCase()}`,
      `${repo} PR #${number}`,
      `Executed ${action}`,
      req,
    );
    res.json({ success: true });
  });
}
