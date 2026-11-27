import { apiClient } from './apiClient';

/** বাংলা মন্তব্য: edge `functions/_lib/adminModelRouter.ts`-এর সাথে একই আকার। */
export interface ModelRouterProvider {
  id: string;
  status: string;
  latencyMs: number;
  models: string[];
}

export interface ModelRouterOverride {
  provider: string;
  model: string;
  remainingRequests: number;
  setBy: string | null;
  setAt: string | null;
}

export interface ModelRouterState {
  override: ModelRouterOverride | null;
  fallbackChain: string[];
  providers: ModelRouterProvider[];
  providersError?: string;
}

export const modelRouterService = {
  async getState(): Promise<ModelRouterState> {
    const res = await apiClient.get<Partial<ModelRouterState>>('/api/admin/model-router');
    return {
      override: res.override ?? null,
      fallbackChain: Array.isArray(res.fallbackChain) ? res.fallbackChain : [],
      providers: Array.isArray(res.providers) ? res.providers : [],
      providersError: res.providersError,
    };
  },

  async setOverride(provider: string, model: string | null, remainingRequests: number) {
    await apiClient.post('/api/admin/model-router/override', {
      provider,
      model,
      remainingRequests,
    });
  },

  async clearOverride() {
    await apiClient.delete('/api/admin/model-router/override');
  },
};
