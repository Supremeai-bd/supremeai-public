import { apiClient, ApiError } from './apiClient';
import { POOL_PROVIDER_MANIFESTS, PoolProviderManifest } from '../constants/poolProvidersManifest';

/**
 * বাংলা মন্তব্য: "লিমিট বাড়ান" ট্যাবের ডেটা-লেয়ার। ইউজার নিজের Gmail দিয়ে ফ্রি AI কী বানিয়ে
 * এখানে দেয় → সার্ভার কী যাচাই করে এনক্রিপ্ট করে Supabase-এ রাখে → প্রতিটি বৈধ কী-তে দৈনিক বোনাস।
 * কাঁচা কী কখনো localStorage-এ রাখা হয় না; তালিকা সবসময় সার্ভার থেকে আসে।
 */

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

export interface ContributedKey {
  id: string;
  provider: string;
  status: 'valid' | 'invalid' | 'pending' | string;
  bonus_weight: number;
  key_hint?: string | null;
  created_at: string;
  last_verified_at?: string | null;
}

/** ব্যাকএন্ড (pool.py) ভিন্ন আকারে ম্যানিফেস্ট পাঠায় — `{id,name,bonus,pattern,console}`। */
interface BackendProviderShape {
  id: string;
  name?: string;
  bonus?: number;
  pattern?: string;
  console?: string;
}

export const MAX_ACTIVE_POOL_KEYS = 10;

/** সার্ভারের ম্যানিফেস্টকে UI-র পূর্ণ ম্যানিফেস্টের সাথে id ধরে মিলিয়ে নিই (লোগো/বিবরণ লোকাল থেকে)। */
export function normalizePoolProviders(raw: unknown): PoolProviderManifest[] {
  if (!Array.isArray(raw) || raw.length === 0) return POOL_PROVIDER_MANIFESTS;
  const byId = new Map(POOL_PROVIDER_MANIFESTS.map((m) => [m.id, m]));
  const merged: PoolProviderManifest[] = [];
  for (const item of raw as Array<Partial<PoolProviderManifest> & BackendProviderShape>) {
    if (!item || typeof item.id !== 'string') continue;
    const base = byId.get(item.id);
    const pattern = item.keyPattern || item.pattern || base?.keyPattern || '';
    const authUrl = item.gmailAuthUrl || item.console || base?.gmailAuthUrl || '';
    merged.push({
      id: item.id,
      name: base?.name || item.name || item.id,
      badge: item.badge || base?.badge || '',
      category: item.category || base?.category || 'instant_gmail',
      logo: item.logo || base?.logo || '🔑',
      gmailAuthUrl: authUrl,
      keyPattern: pattern,
      bonusTokensPerDay: item.bonusTokensPerDay ?? item.bonus ?? base?.bonusTokensPerDay ?? 100000,
      speedBadge: item.speedBadge || base?.speedBadge || '',
      description: item.description || base?.description || '',
    });
  }
  return merged.length > 0 ? merged : POOL_PROVIDER_MANIFESTS;
}

function safeRegex(pattern: string): RegExp | null {
  try {
    return pattern ? new RegExp(pattern) : null;
  } catch {
    return null;
  }
}

/** কী-এর ফরম্যাট দেখে নিজে থেকেই প্রোভাইডার চিনে নিই — ইউজারকে কিছু বাছতে হয় না। */
export function detectPoolProvider(
  rawKey: string,
  manifests: PoolProviderManifest[] = POOL_PROVIDER_MANIFESTS
): PoolProviderManifest | null {
  const key = rawKey.trim();
  if (key.length < 8) return null;
  for (const m of manifests) {
    const re = safeRegex(m.keyPattern);
    if (re && re.test(key)) return m;
  }
  return null;
}

export function isKeyFormatValid(rawKey: string, manifest: PoolProviderManifest): boolean {
  const re = safeRegex(manifest.keyPattern);
  return re ? re.test(rawKey.trim()) : rawKey.trim().length >= 8;
}

export function maskPoolKey(rawKey: string): string {
  const key = rawKey.trim();
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function errorDetail(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data = err.data as { detail?: unknown; error?: unknown } | undefined;
    const detail = data?.detail ?? data?.error;
    if (typeof detail === 'string' && detail.trim()) return detail;
    return err.message || fallback;
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

export const poolService = {
  async getProviders(): Promise<PoolProviderManifest[]> {
    try {
      const res = await apiClient.get<{ providers: unknown }>('/api/pool/providers');
      return normalizePoolProviders(res?.providers);
    } catch {
      return POOL_PROVIDER_MANIFESTS;
    }
  },

  async contributeKey(provider: string, apiKey: string): Promise<ContributeResponse> {
    try {
      return await apiClient.post<ContributeResponse>('/api/pool/contribute', {
        provider,
        api_key: apiKey.trim(),
      });
    } catch (err: unknown) {
      throw new Error(errorDetail(err, 'Failed to add key'));
    }
  },

  /** `null` = সার্ভারে কোটা পাওয়া যায়নি (অজানা) — ভুল করে "০" দেখাই না। */
  async getQuota(): Promise<UserQuotaResponse | null> {
    try {
      const res = await apiClient.get<UserQuotaResponse>('/api/pool/quota');
      return res && typeof res.daily_bonus_tokens === 'number' ? res : null;
    } catch {
      return null;
    }
  },

  /** `null` = তালিকা আনা যায়নি (সার্ভার অফলাইন/কনফিগার করা নেই)। */
  async listMyKeys(): Promise<ContributedKey[] | null> {
    try {
      const res = await apiClient.get<{ keys?: ContributedKey[] }>('/api/pool/keys');
      return Array.isArray(res?.keys) ? res.keys : null;
    } catch {
      return null;
    }
  },

  async removeKey(id: string): Promise<void> {
    try {
      await apiClient.delete(`/api/pool/keys/${encodeURIComponent(id)}`);
    } catch (err: unknown) {
      throw new Error(errorDetail(err, 'Failed to remove key'));
    }
  },
};
