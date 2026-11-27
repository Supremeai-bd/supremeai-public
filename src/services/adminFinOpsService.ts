import { apiClient } from './apiClient';

/** বাংলা মন্তব্য: edge `functions/_lib/adminFinOps.ts`-এর সাথে একই আকার। */
export interface FinOpsSettings {
  enforce: boolean;
  userDailyTokens: number;
  userRpm: number;
  globalDailyTokens: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface FinOpsUsage {
  available: boolean;
  date: string;
  globalTokens: number;
  topUsers: { userId: string; tokens: number }[];
}

export interface FinOpsState {
  settings: FinOpsSettings;
  usage: FinOpsUsage;
}

export type FinOpsLimitKey = 'userDailyTokens' | 'userRpm' | 'globalDailyTokens';
export type FinOpsPatch = Partial<Pick<FinOpsSettings, 'enforce' | FinOpsLimitKey>>;

/** Same bounds the edge and core enforce (0 = limit off). */
export const FINOPS_LIMIT_MAX: Record<FinOpsLimitKey, number> = {
  userDailyTokens: 50_000_000,
  userRpm: 10_000,
  globalDailyTokens: 5_000_000_000,
};

const EMPTY_USAGE: FinOpsUsage = { available: false, date: '', globalTokens: 0, topUsers: [] };

export const adminFinOpsService = {
  async getState(): Promise<FinOpsState> {
    const res = await apiClient.get<Partial<FinOpsState>>('/api/admin/finops');
    if (!res.settings) throw new Error('FinOps settings missing from response.');
    return { settings: res.settings, usage: res.usage ?? EMPTY_USAGE };
  },
  async update(patch: FinOpsPatch): Promise<FinOpsSettings> {
    const res = await apiClient.put<{ settings?: FinOpsSettings }>('/api/admin/finops', patch);
    if (!res.settings) throw new Error('FinOps settings missing from response.');
    return res.settings;
  },
};
