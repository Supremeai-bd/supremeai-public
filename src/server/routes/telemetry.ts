import type { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PLAN_CATALOG } from '../../config/plans';

/**
 * Telemetry + Health + Models — `POST /api/telemetry/client-error` + `GET /api/health` + `GET /api/models`
 *
 * WHY THIS FILE EXISTS
 *   Three platform-observability endpoints (health metadata, model catalog with
 *   gateway proxy, fire-and-forget client-error sink) lived inline in
 *   `server.ts` (~60 lines). Cohesive (all are public, unauthenticated
 *   telemetry/health probes) and have no other consumer. Moving them keeps the
 *   monolith shrinking.
 *
 * CONTRACT WITH server.ts
 *   - All 3 handlers OWNED here (no other route reads their state).
 *   - `fetchGatewayJson` injected via ctx (gateway cache helper).
 *   - `SUPPORTED_MODELS` + `APP_VERSION` derived locally (read from fs/package
 *     for version, const model map inlined to avoid cross-file mutation).
 *   - `apiKey` presence checked via env (same as server.ts).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8')) as {
      version?: string;
    };
    return String(pkg.version || '2.5.0').trim();
  } catch {
    return '2.5.0';
  }
})();

const SUPPORTED_MODELS: Record<string, { name: string; description: string; tier: 'standard' | 'advanced' }> = {
  auto: {
    name: 'SupremeAI Auto',
    description: 'Intelligent adaptive routing across API Pool and Webhook relays',
    tier: 'standard',
  },
  'supreme-core': {
    name: 'SupremeAI Core',
    description: 'Flagship multimodal foundation model for general tasks, synthesis & coding',
    tier: 'standard',
  },
  'supreme-spark': {
    name: 'SupremeAI Spark',
    description: 'Ultra-low latency model for high-frequency queries and streaming',
    tier: 'standard',
  },
  'supreme-reason': {
    name: 'SupremeAI Reason',
    description: 'Deep analytical and architectural reasoning engine',
    tier: 'advanced',
  },
  'supreme-deep': {
    name: 'SupremeAI Deep',
    description: 'Complex multi-step logic, code synthesis and autonomous tasks',
    tier: 'advanced',
  },
  'supremeai-web': {
    name: 'SupremeAI Web',
    description: 'Live web search grounded answer model',
    tier: 'standard',
  },
};

export interface TelemetryContext {
  fetchGatewayJson: (pathAndQuery: string, ttlMs?: number) => Promise<any | null>;
}

export function registerTelemetryRoutes(app: Express, ctx: TelemetryContext): void {
  // Health and metadata endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    const apiKey = process.env.GEMINI_API_KEY || '';
    res.json({
      status: 'healthy',
      app: 'SupremeAI Studio',
      organization: 'Supremeai-bd',
      version: `v${APP_VERSION}`,
      modelsCount: Object.keys(SUPPORTED_MODELS).length,
      plans: PLAN_CATALOG,
      repositories: {
        primary: 'https://github.com/Supremeai-bd/supremeai',
        studio: 'https://github.com/Supremeai-bd/supremeai-studio',
      },
      hasApiKey: Boolean(apiKey),
    });
  });

  // Models endpoint
  app.get('/api/models', async (_req: Request, res: Response) => {
    const remote = await ctx.fetchGatewayJson('/api/v1/models');
    const remoteModels = remote?.models;
    const useRemote =
      remoteModels && typeof remoteModels === 'object' && !Array.isArray(remoteModels);
    res.json({
      models: useRemote ? remoteModels : SUPPORTED_MODELS,
      defaultModel:
        (useRemote && (remote?.defaultModel || remote?.default_model)) || 'supreme-spark',
      source: useRemote ? 'gateway' : 'local',
    });
  });

  // Client error sink (mirrors functions/api/telemetry/client-error.ts).
  // The browser reporter is fire-and-forget; never fail it noisily.
  app.post('/api/telemetry/client-error', (req: Request, res: Response) => {
    const body =
      req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const summary = {
      message: String(body.message ?? 'unknown').slice(0, 300),
      source: String(body.source ?? 'app').slice(0, 40),
      route: body.route ? String(body.route).slice(0, 120) : undefined,
      at: body.at ? String(body.at).slice(0, 40) : new Date().toISOString(),
      contextKeys:
        body.context && typeof body.context === 'object'
          ? Object.keys(body.context as Record<string, unknown>).slice(0, 10)
          : [],
    };
    console.warn('[client-error]', JSON.stringify(summary));
    res.status(204).end();
  });
}
