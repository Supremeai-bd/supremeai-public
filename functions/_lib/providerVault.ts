/**
 * বাংলা মন্তব্য: অ্যাডমিনের "AI প্রোভাইডার কী" — আসল উৎস থেকে।
 *
 * বাগ: Overview বলছিল "No AI provider key is configured" অথচ Infisical ভল্টে অনেক কী আছে।
 * কারণ: `/api/admin/providers` Render-এর একটা স্টাব (`{"providers": []}`) ফেরত দিত, আর edge সেটাকেই
 * সত্য ধরত। এখন edge নিজেই:
 *   ১) Infisical (universal-auth: INFISICAL_CLIENT_ID/SECRET + INFISICAL_PROJECT_ID, বা INFISICAL_TOKEN)
 *      থেকে সিক্রেটের তালিকা পড়ে,
 *   ২) Cloudflare Pages env-এ থাকা প্রোভাইডার কী-ও যোগ করে,
 *   ৩) নাম দেখে প্রোভাইডার চেনে, আর প্রতিটি কী-কে প্রোভাইডারের ফ্রি `models` এন্ডপয়েন্টে লাইভ টেস্ট করে।
 * কাঁচা মান কখনো রেসপন্সে যায় না — শুধু মাস্ক করা রূপ। ভল্ট সংযুক্ত না থাকলে সেটা স্পষ্ট বলে
 * (কোন env নেই), "কোনো কী নেই" বলে ভুল লাল দেখায় না।
 */

export type ProbeStatus = 'healthy' | 'degraded' | 'unhealthy' | 'untested';

export interface ProviderDefinition {
  id: string;
  displayName: string;
  /** সিক্রেট-নামের প্রিফিক্স (বড় হাতের) — যেমন GROQ → GROQ_API_KEY, GROQ_API_KEY_2, GROQ_KEY */
  prefixes: string[];
  probe?: (key: string) => { url: string; headers: Record<string, string> };
}

const bearer = (url: string) => (key: string) => ({
  url,
  headers: { Authorization: `Bearer ${key}` },
});

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    id: 'google_ai_studio',
    displayName: 'Google Gemini',
    prefixes: [
      'GEMINI',
      'GOOGLE_AI_STUDIO',
      'GOOGLE_GENAI',
      'GOOGLE_AI',
      'GOOGLE_GEMINI',
      'GOOGLE',
    ],
    probe: (key) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      headers: {},
    }),
  },
  {
    id: 'groq',
    displayName: 'Groq',
    prefixes: ['GROQ'],
    probe: bearer('https://api.groq.com/openai/v1/models'),
  },
  {
    id: 'openai',
    displayName: 'OpenAI',
    prefixes: ['OPENAI'],
    probe: bearer('https://api.openai.com/v1/models'),
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic Claude',
    prefixes: ['ANTHROPIC', 'CLAUDE'],
    probe: (key) => ({
      url: 'https://api.anthropic.com/v1/models',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    }),
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    prefixes: ['DEEPSEEK'],
    probe: bearer('https://api.deepseek.com/v1/models'),
  },
  {
    id: 'mistral',
    displayName: 'Mistral',
    prefixes: ['MISTRAL', 'CODESTRAL'],
    probe: bearer('https://api.mistral.ai/v1/models'),
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    prefixes: ['OPENROUTER'],
    probe: bearer('https://openrouter.ai/api/v1/auth/key'),
  },
  {
    id: 'cerebras',
    displayName: 'Cerebras',
    prefixes: ['CEREBRAS'],
    probe: bearer('https://api.cerebras.ai/v1/models'),
  },
  {
    id: 'sambanova',
    displayName: 'SambaNova',
    prefixes: ['SAMBANOVA'],
    probe: bearer('https://api.sambanova.ai/v1/models'),
  },
  {
    id: 'cohere',
    displayName: 'Cohere',
    prefixes: ['COHERE', 'CO'],
    probe: bearer('https://api.cohere.com/v1/models'),
  },
  {
    id: 'together',
    displayName: 'Together AI',
    prefixes: ['TOGETHER', 'TOGETHERAI', 'TOGETHER_AI'],
    probe: bearer('https://api.together.xyz/v1/models'),
  },
  {
    id: 'fireworks',
    displayName: 'Fireworks AI',
    prefixes: ['FIREWORKS'],
    probe: bearer('https://api.fireworks.ai/inference/v1/models'),
  },
  {
    id: 'xai',
    displayName: 'xAI Grok',
    prefixes: ['XAI', 'GROK'],
    probe: bearer('https://api.x.ai/v1/models'),
  },
  {
    id: 'nvidia',
    displayName: 'NVIDIA NIM',
    prefixes: ['NVIDIA', 'NVIDIA_NIM', 'NIM'],
    probe: bearer('https://integrate.api.nvidia.com/v1/models'),
  },
  {
    id: 'huggingface',
    displayName: 'Hugging Face',
    prefixes: ['HF', 'HUGGINGFACE', 'HUGGING_FACE'],
    probe: bearer('https://huggingface.co/api/whoami-v2'),
  },
  { id: 'kilo', displayName: 'Kilo Gateway', prefixes: ['KILO', 'KILOCODE'] },
];

const NAME_SUFFIX = /^(?:_API)?_(?:KEY|KEYS|TOKEN)(?:_[A-Z0-9]+)*$/;

/** সিক্রেটের নাম দেখে প্রোভাইডার চিনি। `CO_API_KEY`-এর মতো ছোট প্রিফিক্স শুধু পূর্ণ মিলেই। */
export function matchProviderBySecretName(name: string): ProviderDefinition | null {
  const upper = String(name || '')
    .trim()
    .replace(/#\d+$/, '')
    .toUpperCase();
  if (!upper || upper.startsWith('INFISICAL_')) return null;
  let best: { def: ProviderDefinition; len: number } | null = null;
  for (const def of PROVIDER_DEFINITIONS) {
    for (const prefix of def.prefixes) {
      if (!upper.startsWith(prefix)) continue;
      const rest = upper.slice(prefix.length);
      if (!NAME_SUFFIX.test(rest)) continue;
      if (!best || prefix.length > best.len) best = { def, len: prefix.length };
    }
  }
  return best?.def ?? null;
}

export function maskSecret(value: string): string {
  const v = String(value || '').trim();
  if (v.length <= 8) return '••••';
  return `${v.slice(0, 4)}••••${v.slice(-4)}`;
}

export interface VaultSecret {
  name: string;
  value: string;
  source: 'infisical' | 'edge-env';
  path: string;
  environment: string;
}

export interface VaultSummary {
  engine: 'Infisical';
  /** Infisical-এ লগইন করে সিক্রেট পড়া গেছে কিনা */
  connected: boolean;
  mode: 'infisical-live' | 'edge-env-only' | 'not-linked';
  environment: string;
  /** ভল্টে মোট কয়টা সিক্রেট (সব ধরনের) */
  totalSecrets: number;
  /** তার মধ্যে কয়টা AI প্রোভাইডার কী */
  providerSecrets: number;
  missingEnv: string[];
  error?: string;
  lastSyncedAt: string;
}

export interface CollectedVault {
  secrets: VaultSecret[];
  summary: VaultSummary;
}

type Env = Record<string, string | undefined> | undefined;

function infisicalApiBase(env: Env): string {
  return String(env?.INFISICAL_API_URL || env?.INFISICAL_SITE_URL || 'https://app.infisical.com')
    .trim()
    .replace(/\/+$/, '');
}

export function missingInfisicalEnv(env: Env): string[] {
  const hasToken = Boolean(String(env?.INFISICAL_TOKEN || '').trim());
  const missing: string[] = [];
  if (!String(env?.INFISICAL_PROJECT_ID || '').trim()) missing.push('INFISICAL_PROJECT_ID');
  if (!hasToken) {
    if (!String(env?.INFISICAL_CLIENT_ID || '').trim()) missing.push('INFISICAL_CLIENT_ID');
    if (!String(env?.INFISICAL_CLIENT_SECRET || '').trim()) missing.push('INFISICAL_CLIENT_SECRET');
  }
  return missing;
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; data: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function readInfisicalSecrets(
  env: Env,
  fetchImpl: typeof fetch
): Promise<{ secrets: VaultSecret[]; total: number; environment: string }> {
  const base = infisicalApiBase(env);
  const environment = String(env?.INFISICAL_ENV || env?.INFISICAL_ENVIRONMENT || 'prod').trim();
  const secretPath = String(env?.INFISICAL_SECRET_PATH || '/').trim() || '/';
  let token = String(env?.INFISICAL_TOKEN || '').trim();
  if (!token) {
    const login = await fetchJson(
      fetchImpl,
      `${base}/api/v1/auth/universal-auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: String(env?.INFISICAL_CLIENT_ID || '').trim(),
          clientSecret: String(env?.INFISICAL_CLIENT_SECRET || '').trim(),
        }),
      },
      8000
    );
    token = String(login.data?.accessToken || '');
    if (!login.ok || !token) throw new Error(`Infisical login failed (HTTP ${login.status})`);
  }
  const q = new URLSearchParams({
    workspaceId: String(env?.INFISICAL_PROJECT_ID || '').trim(),
    environment,
    secretPath,
    recursive: 'true',
  });
  const res = await fetchJson(
    fetchImpl,
    `${base}/api/v3/secrets/raw?${q.toString()}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    9000
  );
  if (!res.ok) throw new Error(`Infisical secrets read failed (HTTP ${res.status})`);
  const items: Array<{ secretKey?: string; secretValue?: string; secretPath?: string }> =
    Array.isArray(res.data?.secrets) ? res.data.secrets : [];
  const secrets: VaultSecret[] = [];
  for (const item of items) {
    if (!item?.secretKey || typeof item.secretValue !== 'string' || !item.secretValue.trim())
      continue;
    secrets.push({
      name: item.secretKey,
      value: item.secretValue,
      source: 'infisical',
      path: item.secretPath || secretPath,
      environment,
    });
  }
  return { secrets, total: items.length, environment };
}

/** `GROQ_API_KEYS="k1,k2"`-এর মতো একাধিক কী এক সিক্রেটে থাকলে আলাদা আলাদা কী হিসেবে গুনি। */
export function expandMultiKeySecrets(secrets: VaultSecret[]): VaultSecret[] {
  const out: VaultSecret[] = [];
  for (const s of secrets) {
    const parts = /KEYS(?:_|$)/i.test(s.name)
      ? s.value
          .split(/[\s,;]+/)
          .map((p) => p.trim())
          .filter(Boolean)
      : [];
    if (parts.length > 1 && matchProviderBySecretName(s.name)) {
      parts.forEach((value, i) => out.push({ ...s, name: `${s.name}#${i + 1}`, value }));
    } else {
      out.push(s);
    }
  }
  return out;
}

const VAULT_CACHE_TTL_MS = 5 * 60_000;
let vaultCache: { at: number; key: string; value: CollectedVault } | null = null;

export function resetProviderVaultCache(): void {
  vaultCache = null;
  probeCache.clear();
}

/** Infisical + edge env থেকে সিক্রেট সংগ্রহ (৫ মিনিট ক্যাশ)। কখনো throw করে না। */
export async function collectVault(
  env: Env,
  options: { force?: boolean; fetchImpl?: typeof fetch; now?: number } = {}
): Promise<CollectedVault> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now();
  const cacheKey = [env?.INFISICAL_PROJECT_ID, env?.INFISICAL_CLIENT_ID, env?.INFISICAL_ENV].join(
    '|'
  );
  if (
    !options.force &&
    vaultCache &&
    vaultCache.key === cacheKey &&
    now - vaultCache.at < VAULT_CACHE_TTL_MS
  ) {
    return vaultCache.value;
  }

  const missingEnv = missingInfisicalEnv(env);
  let infisical: VaultSecret[] = [];
  let total = 0;
  let environment = String(env?.INFISICAL_ENV || 'prod');
  let error: string | undefined;
  let connected = false;

  if (missingEnv.length === 0) {
    try {
      const read = await readInfisicalSecrets(env, fetchImpl);
      infisical = read.secrets;
      total = read.total;
      environment = read.environment;
      connected = true;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Infisical unreachable';
    }
  }

  // Pages env-এ সরাসরি রাখা প্রোভাইডার কী (Infisical-এ একই নাম থাকলে Infisical অগ্রাধিকার পায়)
  const seen = new Set(infisical.map((s) => s.name.toUpperCase()));
  const edgeEnv: VaultSecret[] = [];
  for (const [name, value] of Object.entries(env || {})) {
    if (typeof value !== 'string' || !value.trim()) continue;
    if (seen.has(name.toUpperCase()) || !matchProviderBySecretName(name)) continue;
    edgeEnv.push({
      name,
      value,
      source: 'edge-env',
      path: 'cloudflare-pages-env',
      environment: 'prod',
    });
  }

  const secrets = expandMultiKeySecrets([...infisical, ...edgeEnv]);
  const providerSecrets = secrets.filter((s) => matchProviderBySecretName(s.name)).length;
  const value: CollectedVault = {
    secrets,
    summary: {
      engine: 'Infisical',
      connected,
      mode: connected ? 'infisical-live' : edgeEnv.length > 0 ? 'edge-env-only' : 'not-linked',
      environment,
      totalSecrets: connected ? total : edgeEnv.length,
      providerSecrets,
      missingEnv,
      ...(error ? { error } : {}),
      lastSyncedAt: new Date(now).toISOString(),
    },
  };
  vaultCache = { at: now, key: cacheKey, value };
  return value;
}

export interface ProbeResult {
  status: ProbeStatus;
  latencyMs: number;
  message: string;
  checkedAt: string;
}

const PROBE_CACHE_TTL_MS = 5 * 60_000;
const probeCache = new Map<string, ProbeResult & { at: number }>();

/** প্রোভাইডারের ফ্রি `models` এন্ডপয়েন্টে লাইভ টেস্ট — টোকেন খরচ নেই। */
export async function probeProviderKey(
  def: ProviderDefinition,
  key: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 6000
): Promise<ProbeResult> {
  const checkedAt = new Date().toISOString();
  if (!def.probe) {
    return {
      status: 'untested',
      latencyMs: 0,
      message: 'No live test available for this provider.',
      checkedAt,
    };
  }
  const { url, headers } = def.probe(key.trim());
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
    const latencyMs = Math.max(1, Date.now() - started);
    if (res.ok) {
      return {
        status: latencyMs > 3000 ? 'degraded' : 'healthy',
        latencyMs,
        message: `HTTP ${res.status} in ${latencyMs} ms`,
        checkedAt,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        status: 'unhealthy',
        latencyMs,
        message: `Key rejected (HTTP ${res.status})`,
        checkedAt,
      };
    }
    if (res.status === 429) {
      return {
        status: 'degraded',
        latencyMs,
        message: 'Rate-limited / quota reached (HTTP 429)',
        checkedAt,
      };
    }
    return {
      status: 'degraded',
      latencyMs,
      message: `Provider answered HTTP ${res.status}`,
      checkedAt,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      status: 'unhealthy',
      latencyMs: Math.max(1, Date.now() - started),
      message: aborted
        ? `Timed out after ${Math.round(timeoutMs / 1000)}s`
        : 'Network error reaching provider',
      checkedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface AdminProviderKey {
  id: string;
  provider: string;
  displayName: string;
  maskedKey: string;
  status: ProbeStatus;
  latencyMs: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  priority: number;
  lastChecked: string;
  rateLimitTpm: string;
  infisicalPath: string;
  infisicalEnv: 'prod' | 'staging' | 'dev';
  vaultVersion: number;
  region: string;
  source: VaultSecret['source'];
  secretName: string;
  probeMessage?: string;
}

function normEnv(e: string): 'prod' | 'staging' | 'dev' {
  const v = e.toLowerCase();
  if (v.startsWith('stag')) return 'staging';
  if (v.startsWith('dev')) return 'dev';
  return 'prod';
}

export function secretId(s: VaultSecret): string {
  return `vault_${s.source}_${s.name}`.replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * ভল্টের প্রোভাইডার-কী গুলোকে অ্যাডমিন তালিকায় রূপান্তর + (ঐচ্ছিক) লাইভ টেস্ট।
 * `probe: 'stale'` = শুধু ৫ মিনিটের বেশি পুরনো ফলাফল আবার টেস্ট; `'all'` = সব জোর করে।
 */
export async function buildProviderKeys(
  vault: CollectedVault,
  options: {
    probe?: 'none' | 'stale' | 'all';
    onlyId?: string;
    fetchImpl?: typeof fetch;
    concurrency?: number;
  } = {}
): Promise<AdminProviderKey[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const mode = options.probe ?? 'stale';
  const entries = vault.secrets
    .map((s) => ({ s, def: matchProviderBySecretName(s.name) }))
    .filter((e): e is { s: VaultSecret; def: ProviderDefinition } => Boolean(e.def));

  const now = Date.now();
  const toProbe = entries.filter(({ s }) => {
    if (mode === 'none') return false;
    const id = secretId(s);
    if (options.onlyId) return id === options.onlyId;
    if (mode === 'all') return true;
    const cached = probeCache.get(id);
    return !cached || now - cached.at > PROBE_CACHE_TTL_MS;
  });

  const limit = Math.max(1, options.concurrency ?? 6);
  for (let i = 0; i < toProbe.length; i += limit) {
    await Promise.all(
      toProbe.slice(i, i + limit).map(async ({ s, def }) => {
        const result = await probeProviderKey(def, s.value, fetchImpl);
        probeCache.set(secretId(s), { ...result, at: Date.now() });
      })
    );
  }

  return entries.map(({ s, def }, idx) => {
    const id = secretId(s);
    const probe = probeCache.get(id);
    return {
      id,
      provider: def.id,
      displayName: `${def.displayName} · ${s.name}`,
      maskedKey: maskSecret(s.value),
      status: probe?.status ?? 'untested',
      latencyMs: probe?.latencyMs ?? 0,
      avgLatencyMs: probe?.latencyMs ?? 0,
      p95LatencyMs: probe?.latencyMs ?? 0,
      priority: idx + 1,
      lastChecked: probe?.checkedAt ?? 'Not tested yet',
      rateLimitTpm: '—',
      infisicalPath:
        s.source === 'infisical' ? `${s.path.replace(/\/+$/, '')}/${s.name}` : `env:${s.name}`,
      infisicalEnv: normEnv(s.environment),
      vaultVersion: 1,
      region: s.source === 'infisical' ? 'infisical' : 'cloudflare-pages',
      source: s.source,
      secretName: s.name,
      ...(probe?.message ? { probeMessage: probe.message } : {}),
    };
  });
}

/** Provider Keys পেজের "Vault keys" টেবিলের আকার (InfisicalVaultKeyLatency)। */
export function toVaultKeyRows(keys: AdminProviderKey[], syncedAt: string) {
  return keys.map((k) => ({
    id: k.id,
    secretName: k.secretName,
    infisicalPath: k.infisicalPath,
    environment: k.infisicalEnv,
    provider: k.provider,
    providerDisplayName: k.displayName.split(' · ')[0],
    maskedKey: k.maskedKey,
    version: k.vaultVersion,
    status: k.status,
    latencyMs: k.latencyMs,
    avgLatencyMs: k.avgLatencyMs,
    p95LatencyMs: k.p95LatencyMs,
    lastChecked: k.lastChecked,
    lastSyncedAt: syncedAt,
  }));
}
