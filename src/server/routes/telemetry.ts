import type { Express, Request, Response } from 'express';
import { CANONICAL_SERVER_MODELS, DEFAULT_MODEL_ID } from '../../shared/platformCatalog';

// বাংলা মন্তব্য: health ও client-error এখন Hono-তে; শুধু gateway-cache নির্ভর models এখানে আছে।
const SUPPORTED_MODELS = CANONICAL_SERVER_MODELS;

export interface TelemetryContext {
  fetchGatewayJson: (pathAndQuery: string, ttlMs?: number) => Promise<any | null>;
}

export function registerTelemetryRoutes(app: Express, ctx: TelemetryContext): void {
  // Models endpoint
  app.get('/api/models', async (_req: Request, res: Response) => {
    const remote = await ctx.fetchGatewayJson('/api/v1/models');
    const remoteModels = remote?.models;
    const hasRemoteMap =
      remoteModels && typeof remoteModels === 'object' && !Array.isArray(remoteModels);
    res.json({
      models: hasRemoteMap ? { ...SUPPORTED_MODELS, ...remoteModels } : SUPPORTED_MODELS,
      defaultModel:
        (hasRemoteMap && (remote?.defaultModel || remote?.default_model)) || DEFAULT_MODEL_ID,
      source: hasRemoteMap ? 'gateway+canonical' : 'canonical',
    });
  });
}
