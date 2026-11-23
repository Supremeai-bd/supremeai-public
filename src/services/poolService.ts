import { apiClient } from './apiClient';
import { POOL_PROVIDER_MANIFESTS, PoolProviderManifest } from '../constants/poolProvidersManifest';

export interface UserQuotaResponse {
  user_id: string;
  valid_keys_count: number;
  daily_bonus_tokens: number;
}

export interface ContributeResponse {
  status: 'accepted' | 'error';
  provider: string;
  bonus_earned: number;
  message: string;
}

export const poolService = {
  async getProviders(): Promise<PoolProviderManifest[]> {
    try {
      const res = await apiClient.get<{ providers: PoolProviderManifest[] }>('/api/pool/providers');
      if (res && Array.isArray(res.providers) && res.providers.length > 0) {
        return res.providers;
      }
    } catch {
      // Fallback to static manifest if backend offline
    }
    return POOL_PROVIDER_MANIFESTS;
  },

  async contributeKey(provider: string, apiKey: string): Promise<ContributeResponse> {
    try {
      const res = await apiClient.post<ContributeResponse>('/api/pool/contribute', {
        provider,
        api_key: apiKey,
      });
      return res;
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || 'Failed to contribute key';
      throw new Error(detail);
    }
  },

  async getQuota(): Promise<UserQuotaResponse> {
    try {
      const res = await apiClient.get<UserQuotaResponse>('/api/pool/quota');
      if (res) return res;
    } catch {
      // Return default if offline
    }
    return {
      user_id: 'current_user',
      valid_keys_count: 0,
      daily_bonus_tokens: 0,
    };
  },
};
