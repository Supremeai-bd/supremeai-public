import { create } from 'zustand';
import type { ProviderKeyItem } from '../types';
import type { DeploymentStatus } from '../utils/adminHealthSummary';
import { apiClient } from '../services/apiClient';
import { env } from '../config/env';
import { INITIAL_PROVIDER_KEYS } from '../data/adminExpansionData';
import { useControlCenterStore } from './useControlCenterStore';
import { useAdminStore } from './useAdminStore';
import { usePlatformStore } from './usePlatformStore';
import { logger } from '../utils/logger';

/**
 * বাংলা মন্তব্য: অ্যাডমিন ওভারভিউয়ের জন্য এক ক্লিকে (বা প্রতি মিনিটে নিজে থেকে) সব ডেটা রিফ্রেশ —
 * সার্ভিস হেলথ, MCP ডায়াগনস্টিক, ইউজার/কিউ/সিকিউরিটি, প্ল্যাটফর্ম সেটিং, প্রোভাইডার কী আর ডিপ্লয়।
 * প্রোভাইডার লোড ব্যর্থ হলে `null` (অজানা) রাখা হয় — "কোনো কী নেই" বলে ভুল লাল দেখানো হয় না।
 */
interface AdminHealthState {
  providers: ProviderKeyItem[] | null;
  deployments: DeploymentStatus[] | null;
  lastRefreshedAt: number | null;
  isRefreshing: boolean;
  refreshAll: (options?: { force?: boolean }) => Promise<void>;
}

const MIN_REFRESH_GAP_MS = 15_000;

async function loadProviders(): Promise<ProviderKeyItem[] | null> {
  if (env.isMockEnabled) return INITIAL_PROVIDER_KEYS;
  try {
    const res = await apiClient.get<{ providers?: ProviderKeyItem[] }>('/api/admin/providers');
    return Array.isArray(res?.providers) ? res.providers : null;
  } catch (error) {
    logger.debug('AdminHealth: provider keys unavailable', error);
    return null;
  }
}

async function loadDeployments(): Promise<DeploymentStatus[] | null> {
  try {
    const res = await fetch('/api/mcp-tower/deployments', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { deployments?: DeploymentStatus[] };
    return Array.isArray(data?.deployments) ? data.deployments : null;
  } catch (error) {
    logger.debug('AdminHealth: deployments unavailable', error);
    return null;
  }
}

export const useAdminHealthStore = create<AdminHealthState>((set, get) => ({
  providers: null,
  deployments: null,
  lastRefreshedAt: null,
  isRefreshing: false,

  refreshAll: async (options) => {
    const { isRefreshing, lastRefreshedAt } = get();
    if (isRefreshing) return;
    if (!options?.force && lastRefreshedAt && Date.now() - lastRefreshedAt < MIN_REFRESH_GAP_MS) {
      return;
    }
    set({ isRefreshing: true });
    const cc = useControlCenterStore.getState();
    const admin = useAdminStore.getState();
    const platform = usePlatformStore.getState();
    try {
      const [providers, deployments] = await Promise.all([
        loadProviders(),
        loadDeployments(),
        cc.loadOverview().catch(() => undefined),
        cc.loadServiceHealth(Boolean(options?.force)).catch(() => undefined),
        cc.loadEcosystemDiagnostics().catch(() => undefined),
        admin.fetchAdminSync().catch(() => undefined),
        admin.fetchMcpServices({ force: Boolean(options?.force) }).catch(() => undefined),
        platform.fetchConfig().catch(() => undefined),
      ]);
      set({ providers, deployments, lastRefreshedAt: Date.now() });
    } finally {
      set({ isRefreshing: false });
    }
  },
}));
