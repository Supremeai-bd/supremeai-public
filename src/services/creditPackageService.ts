import { apiClient } from './apiClient';

/**
 * বাংলা মন্তব্য: edge `functions/_lib/creditPackages.ts`-এর সাথে একই আকার।
 * প্ল্যান/প্যাকেজের নাম-দাম-ক্রেডিট DB থেকে আসে — কোডে কিছু হার্ডকোড নেই।
 */
export type PackageKind = 'plan' | 'topup';
export type BillingPeriod = 'one_time' | 'monthly' | 'yearly';

export interface CreditPackage {
  id: string;
  kind: PackageKind;
  name: string;
  description: string | null;
  credits: number;
  priceUsd: number;
  billingPeriod: BillingPeriod;
  badge: string | null;
  sortOrder: number;
  active: boolean;
  updatedAt: string | null;
}

export type CreditPackageInput = Pick<
  CreditPackage,
  'kind' | 'name' | 'credits' | 'priceUsd' | 'billingPeriod'
> &
  Partial<Pick<CreditPackage, 'description' | 'badge' | 'sortOrder' | 'active'>>;

const list = (res: { packages?: unknown }): CreditPackage[] =>
  Array.isArray(res?.packages) ? (res.packages as CreditPackage[]) : [];

export const creditPackageService = {
  /** Active packages for the "Boost my limit" paid section (guests included). */
  async listActive(): Promise<CreditPackage[]> {
    return list(await apiClient.get<{ packages?: unknown }>('/api/packages'));
  },
  /** Admin: every package, hidden ones included. */
  async listAll(): Promise<CreditPackage[]> {
    return list(await apiClient.get<{ packages?: unknown }>('/api/admin/packages'));
  },
  async create(input: CreditPackageInput): Promise<CreditPackage | null> {
    const res = await apiClient.post<{ package?: CreditPackage }>('/api/admin/packages', input);
    return res?.package ?? null;
  },
  async update(id: string, patch: Partial<CreditPackageInput>): Promise<CreditPackage | null> {
    const res = await apiClient.patch<{ package?: CreditPackage }>(
      `/api/admin/packages/${encodeURIComponent(id)}`,
      patch
    );
    return res?.package ?? null;
  },
  async remove(id: string): Promise<void> {
    await apiClient.delete(`/api/admin/packages/${encodeURIComponent(id)}`);
  },
};

/** "1,500,000" → "1.5M" style label used by both the user and admin views. */
export function formatCredits(n: number): string {
  if (n >= 1_000_000_000) return `${+(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatPrice(usd: number): string {
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`;
}
