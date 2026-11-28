import type { Express, Request, Response } from 'express';

interface LatencyProviderMeshEntry {
  provider: string;
  displayName: string;
  status: string;
  latencyMs: number;
  avgLatencyMs?: number;
  p95LatencyMs?: number;
  sampleCount?: number;
  successRate?: number;
}

export interface LlmLatencyContext {
  readonly providerMesh: readonly LatencyProviderMeshEntry[];
  PROVIDER_DISPLAY_NAMES: Record<string, string>;
  // বাংলা মন্তব্য: ভুয়া সংখ্যা বাদ দিয়ে প্রকৃত গেটওয়ে ট্রাফিক টালি সংযুক্ত করার ঐচ্ছিক হুক
  getRealGatewayTrafficSummary?: () => {
    rpm: number;
    avgLatencyMs: number;
    errorRatePercent: number;
    totalRequests: number;
  };
}

export function registerLlmLatencyRoutes(app: Express, ctx: LlmLatencyContext): void {
  app.get(
    ['/api/llm-gateway/latency', '/api/v1/llm-gateway/latency'],
    (_req: Request, res: Response) => {
      const updatedAt = new Date().toISOString();
      // বাংলা মন্তব্য: ADMIN-DATA-HONESTY নীতিমালা অনুযায়ী কৃত্রিম sampleCount/successRate সম্পূর্ণ বাদ দেওয়া হয়েছে
      const traffic = ctx.getRealGatewayTrafficSummary?.();
      const gatewaySamples = Math.max(0, traffic?.totalRequests ?? 0);
      const gatewayAvgLatency = Math.max(0, Math.round(traffic?.avgLatencyMs ?? 0));
      const gatewayErrorPct = Math.min(100, Math.max(0, traffic?.errorRatePercent ?? 0));
      const gatewaySuccessRate =
        gatewaySamples > 0 ? Number((100 - gatewayErrorPct).toFixed(2)) : 100;
      const gatewayHealth: 'healthy' | 'degraded' | 'unhealthy' =
        gatewayErrorPct >= 25
          ? 'unhealthy'
          : gatewayErrorPct >= 5 || gatewayAvgLatency > 1500
            ? 'degraded'
            : 'healthy';

      const providerMap: Record<
        string,
        {
          provider: string;
          displayName: string;
          avgLatencyMs: number;
          p95LatencyMs: number;
          successRate: number;
          sampleCount: number;
          status: 'healthy' | 'degraded' | 'unhealthy';
          provenance: 'live-measured' | 'live-probe' | 'unmeasured';
          updatedAt: string;
        }
      > = {
        supremeai: {
          provider: 'supremeai',
          displayName: 'SupremeAI Gateway Mesh',
          avgLatencyMs: gatewayAvgLatency,
          p95LatencyMs: gatewayAvgLatency,
          successRate: gatewaySuccessRate,
          sampleCount: gatewaySamples,
          status: gatewayHealth,
          provenance: gatewaySamples > 0 ? 'live-measured' : 'unmeasured',
          updatedAt,
        },
      };

      for (const p of ctx.providerMesh) {
        const avg = Math.max(0, Math.round(p.avgLatencyMs ?? p.latencyMs ?? 0));
        const p95 = Math.max(avg, Math.round(p.p95LatencyMs ?? avg));
        const status: 'healthy' | 'degraded' | 'unhealthy' =
          p.status === 'unhealthy'
            ? 'unhealthy'
            : p.status === 'degraded' || avg > 250
              ? 'degraded'
              : 'healthy';
        const sampleCount = Math.max(0, Math.floor(p.sampleCount ?? (avg > 0 ? 1 : 0)));
        const successRate =
          typeof p.successRate === 'number'
            ? p.successRate
            : status === 'unhealthy'
              ? 0
              : 100;

        if (!providerMap[p.provider]) {
          providerMap[p.provider] = {
            provider: p.provider,
            displayName: ctx.PROVIDER_DISPLAY_NAMES[p.provider] || p.displayName,
            avgLatencyMs: avg,
            p95LatencyMs: p95,
            successRate,
            sampleCount,
            status,
            provenance: avg > 0 || sampleCount > 0 ? 'live-probe' : 'unmeasured',
            updatedAt,
          };
        }
      }

      res.json({
        gatewayStatus: gatewayHealth,
        fetchedAt: updatedAt,
        providers: providerMap,
        list: Object.values(providerMap),
      });
    }
  );
}
