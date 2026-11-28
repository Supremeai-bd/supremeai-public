/**
 * বাংলা মন্তব্য: অ্যাডমিন ড্যাশবোর্ডের "আসল ডেটা" সংগ্রাহক (edge)।
 *
 * - `listSupabaseUsers`: Supabase Auth-এর আসল ইউজার (auth.users) → Customer তালিকা। আগে Users পেজ
 *   শুধু Render-এর `customers` টেবিল দেখাত (যেটা ফাঁকা) — তাই "০ ইউজার" দেখাত অথচ সাইন-আপ আছে।
 * - `checkAdminConnections`: কোন ইন্টিগ্রেশন সত্যিই কাজ করছে (Infisical, Supabase, GitHub,
 *   Cloudflare, Render API, MCP Tower, Key pool) — না করলে ঠিক কোন env লাগবে সেটা বলে।
 * কোনো সিক্রেটের মান রেসপন্সে যায় না।
 */

import type { VaultSummary } from './providerVault';

type Env = Record<string, string | undefined> | undefined;

export interface EdgeCustomerRecord {
  id: string;
  name: string;
  email: string;
  tier: 'Free' | 'Pro' | 'Enterprise';
  status: 'active' | 'past_due' | 'suspended';
  mrr: number;
  tokensUsed: number;
  tokenLimit: number;
  connectedRepos: number;
  joinedDate: string;
  lastActive: string;
  region: string;
  isAdminEligible?: boolean;
  source?: 'supabase-auth' | 'customers-table';
}

export function resolveSupabaseAdmin(env: Env): { url: string; key: string } | null {
  const url = String(
    env?.SUPABASE_URL || env?.SUPREMEAI_SUPABASE_URL || env?.VITE_SUPABASE_URL || ''
  )
    .trim()
    .replace(/\/+$/, '');
  const key = String(env?.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return url && key ? { url, key } : null;
}

async function timedFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit = {},
  timeoutMs = 6000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const TIERS = new Set(['Free', 'Pro', 'Enterprise']);

export function mapAuthUser(raw: Record<string, unknown>, idx: number): EdgeCustomerRecord {
  const meta = (
    raw.user_metadata && typeof raw.user_metadata === 'object' ? raw.user_metadata : {}
  ) as Record<string, unknown>;
  const app = (
    raw.app_metadata && typeof raw.app_metadata === 'object' ? raw.app_metadata : {}
  ) as Record<string, unknown>;
  const email = String(raw.email || '').trim();
  const tierRaw = String(app.tier || app.plan || meta.plan || 'Free');
  const tier = (TIERS.has(tierRaw) ? tierRaw : 'Free') as EdgeCustomerRecord['tier'];
  const banned = raw.banned_until && Date.parse(String(raw.banned_until)) > Date.now();
  return {
    id: String(raw.id || `auth_${idx}`),
    name:
      String(meta.full_name || meta.name || '').trim() || email.split('@')[0] || `User ${idx + 1}`,
    email: email || 'unknown@user',
    tier,
    status: banned ? 'suspended' : 'active',
    mrr: tier === 'Enterprise' ? 299 : tier === 'Pro' ? 29 : 0,
    tokensUsed: Number(app.tokens_used || 0),
    tokenLimit: Number(app.token_limit || 1000000),
    connectedRepos: Number(meta.connected_repos || 0),
    joinedDate: raw.created_at ? String(raw.created_at).slice(0, 10) : '',
    lastActive: raw.last_sign_in_at ? String(raw.last_sign_in_at) : 'Never',
    region: String(meta.region || 'Global'),
    isAdminEligible: Boolean(app.is_admin || app.role === 'admin'),
    source: 'supabase-auth',
  };
}

/** `null` = Supabase কনফিগার নেই/পৌঁছানো যায়নি (অজানা)। */
export async function listSupabaseUsers(
  env: Env,
  fetchImpl: typeof fetch = fetch
): Promise<EdgeCustomerRecord[] | null> {
  const cfg = resolveSupabaseAdmin(env);
  if (!cfg) return null;
  try {
    const res = await timedFetch(fetchImpl, `${cfg.url}/auth/v1/admin/users?per_page=200`, {
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      users?: Record<string, unknown>[];
    } | null;
    const users = Array.isArray(data?.users) ? data!.users : [];
    return users.map(mapAuthUser);
  } catch {
    return null;
  }
}

/** দুই উৎস ইমেইল ধরে মিলাই — customers টেবিলের সমৃদ্ধ তথ্য অগ্রাধিকার পায়, বাকি auth ইউজার যোগ হয়। */
export function mergeCustomers<T extends { email: string }>(
  tableRows: T[],
  authUsers: EdgeCustomerRecord[]
): Array<T | EdgeCustomerRecord> {
  const seen = new Set(tableRows.map((r) => String(r.email || '').toLowerCase()));
  const extra = authUsers.filter((u) => !seen.has(u.email.toLowerCase()));
  return [...tableRows, ...extra];
}

export type ConnectionStatus = 'connected' | 'missing' | 'error';

export interface AdminConnection {
  id: 'infisical' | 'supabase' | 'github' | 'cloudflare' | 'render-api' | 'mcp-tower' | 'key-pool';
  name: string;
  status: ConnectionStatus;
  detail: string;
  missingEnv: string[];
  /** কোন অ্যাডমিন ট্যাবে গিয়ে ঠিক করা/দেখা যায় */
  targetTab: string;
}

export async function checkAdminConnections(
  env: Env,
  opts: { vault: VaultSummary; upstreamOrigin: string; fetchImpl?: typeof fetch }
): Promise<AdminConnection[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const has = (k: string) => Boolean(String(env?.[k] || '').trim());

  const infisical: AdminConnection = opts.vault.connected
    ? {
        id: 'infisical',
        name: 'Infisical vault',
        status: 'connected',
        detail: `${opts.vault.totalSecrets} secrets (${opts.vault.providerSecrets} AI keys) in "${opts.vault.environment}"`,
        missingEnv: [],
        targetTab: 'provider-keys',
      }
    : {
        id: 'infisical',
        name: 'Infisical vault',
        status: opts.vault.missingEnv.length ? 'missing' : 'error',
        detail: opts.vault.missingEnv.length
          ? 'The admin server cannot read the vault yet.'
          : opts.vault.error || 'Vault read failed.',
        missingEnv: opts.vault.missingEnv,
        targetTab: 'provider-keys',
      };

  const supabaseCheck = async (): Promise<AdminConnection> => {
    const cfg = resolveSupabaseAdmin(env);
    const base = {
      id: 'supabase' as const,
      name: 'Supabase (users & data)',
      targetTab: 'customers',
    };
    if (!cfg) {
      return {
        ...base,
        status: 'missing',
        detail: 'Users list falls back to the empty customers table.',
        missingEnv: [
          !has('SUPABASE_URL') ? 'SUPABASE_URL' : '',
          'SUPABASE_SERVICE_ROLE_KEY',
        ].filter((k) => k && !has(k)),
      };
    }
    try {
      const res = await timedFetch(fetchImpl, `${cfg.url}/auth/v1/admin/users?per_page=1`, {
        headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
      });
      return res.ok
        ? { ...base, status: 'connected', detail: 'Auth users readable', missingEnv: [] }
        : {
            ...base,
            status: 'error',
            detail: `Supabase answered HTTP ${res.status}`,
            missingEnv: [],
          };
    } catch {
      return { ...base, status: 'error', detail: 'Supabase unreachable', missingEnv: [] };
    }
  };

  const githubCheck = async (): Promise<AdminConnection> => {
    const token = String(env?.GITHUB_TOKEN || env?.GITHUB_READONLY_TOKEN || '').trim();
    const base = { id: 'github' as const, name: 'GitHub (CI & PRs)', targetTab: 'github-pipeline' };
    if (!token)
      return {
        ...base,
        status: 'missing',
        detail: 'CI runs and PRs cannot be shown.',
        missingEnv: ['GITHUB_TOKEN'],
      };
    try {
      const res = await timedFetch(fetchImpl, 'https://api.github.com/rate_limit', {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'supremeai-admin',
          Accept: 'application/vnd.github+json',
        },
      });
      return res.ok
        ? { ...base, status: 'connected', detail: 'Token valid', missingEnv: [] }
        : {
            ...base,
            status: 'error',
            detail: `Token rejected (HTTP ${res.status})`,
            missingEnv: [],
          };
    } catch {
      return { ...base, status: 'error', detail: 'GitHub unreachable', missingEnv: [] };
    }
  };

  const cloudflareCheck = async (): Promise<AdminConnection> => {
    const base = {
      id: 'cloudflare' as const,
      name: 'Cloudflare (deploy status)',
      targetTab: 'release-gate',
    };
    const missing = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].filter((k) => !has(k));
    if (missing.length)
      return {
        ...base,
        status: 'missing',
        detail: 'Pages deploy status is unknown.',
        missingEnv: missing,
      };
    try {
      const res = await timedFetch(
        fetchImpl,
        'https://api.cloudflare.com/client/v4/user/tokens/verify',
        {
          headers: { Authorization: `Bearer ${String(env?.CLOUDFLARE_API_TOKEN).trim()}` },
        }
      );
      return res.ok
        ? { ...base, status: 'connected', detail: 'Token valid', missingEnv: [] }
        : {
            ...base,
            status: 'error',
            detail: `Token rejected (HTTP ${res.status})`,
            missingEnv: [],
          };
    } catch {
      return { ...base, status: 'error', detail: 'Cloudflare API unreachable', missingEnv: [] };
    }
  };

  const renderCheck = async (): Promise<AdminConnection> => {
    const base = {
      id: 'render-api' as const,
      name: 'Backend API (Render)',
      targetTab: 'health-monitor',
    };
    const started = Date.now();
    try {
      const res = await timedFetch(
        fetchImpl,
        `${opts.upstreamOrigin}/api/health`,
        { headers: { Accept: 'application/json' } },
        8000
      );
      const ms = Date.now() - started;
      return res.ok
        ? { ...base, status: 'connected', detail: `Healthy in ${ms} ms`, missingEnv: [] }
        : { ...base, status: 'error', detail: `Health check HTTP ${res.status}`, missingEnv: [] };
    } catch {
      return {
        ...base,
        status: 'error',
        detail: 'Backend did not answer (cold start or down)',
        missingEnv: [],
      };
    }
  };

  const tower: AdminConnection =
    has('SUPREMEAI_TOWER_TOKEN') || has('MCP_TOWER_AGENT_KEY')
      ? {
          id: 'mcp-tower',
          name: 'MCP Tower',
          status: 'connected',
          detail: 'Tower token configured',
          missingEnv: [],
          targetTab: 'mcp-tower',
        }
      : {
          id: 'mcp-tower',
          name: 'MCP Tower',
          status: 'missing',
          detail: 'Tower tools list stays empty without a token.',
          missingEnv: ['SUPREMEAI_TOWER_TOKEN'],
          targetTab: 'mcp-tower',
        };

  const poolMissing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'POOL_ENCRYPTION_KEY'].filter(
    (k) => (k === 'SUPABASE_URL' ? !resolveSupabaseAdmin(env)?.url && !has(k) : !has(k))
  );
  const pool: AdminConnection = poolMissing.length
    ? {
        id: 'key-pool',
        name: 'User key pool (Boost Limit)',
        status: 'missing',
        detail: 'Edge fallback cannot store user keys; only the backend /pool route works.',
        missingEnv: poolMissing,
        targetTab: 'platform-settings',
      }
    : {
        id: 'key-pool',
        name: 'User key pool (Boost Limit)',
        status: 'connected',
        detail: 'Encrypted storage ready',
        missingEnv: [],
        targetTab: 'platform-settings',
      };

  const [supabase, github, cloudflare, render] = await Promise.all([
    supabaseCheck(),
    githubCheck(),
    cloudflareCheck(),
    renderCheck(),
  ]);
  return [infisical, render, supabase, github, cloudflare, tower, pool];
}
