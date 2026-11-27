/**
 * বাংলা মন্তব্য: "লিমিট বাড়ান" (ইউজার-কন্ট্রিবিউটেড API কী পুল)-এর edge স্টোরেজ লেয়ার।
 *
 * কেন: Render ব্যাকএন্ডের `/pool/*` রাউট (core/api/routes/pool.py) সবসময় চালু থাকে না — তখন ট্যাবটা
 * অকেজো হয়ে যেত। এই লেয়ার একই Supabase টেবিলে (user_contributed_api_keys, user_bonus_quotas)
 * একই নিয়মে লেখে: ফরম্যাট যাচাই → প্রোভাইডারে লাইভ যাচাই (শুধু HTTP 200 বৈধ) → SHA-256 fingerprint
 * দিয়ে ডুপ্লিকেট আটকানো → দিনে ৫টি সীমা → AES-GCM এনক্রিপশন → কোটা রোল-আপ (সর্বোচ্চ ১০টি কী)।
 * কাঁচা কী কখনো লগ বা রেসপন্সে যায় না।
 */

import { POOL_PROVIDER_MANIFESTS } from '../../src/constants/poolProvidersManifest';

export const POOL_MAX_ACTIVE_KEYS = 10;
export const POOL_DAILY_SUBMISSION_CAP = 5;
export const POOL_DEFAULT_BONUS = 100000;
const POOL_BONUS_WEIGHTS: Record<string, number> = { kilo: 150000 };

export const EDGE_CIPHER_PREFIX = 'edge-aesgcm:v1:';

export interface PoolStorageConfig {
  supabaseUrl: string;
  serviceKey: string;
  encryptionSecret: string;
}

export interface PoolKeyRow {
  id: string;
  provider: string;
  status: string;
  bonus_weight: number;
  key_hint?: string | null;
  created_at: string;
  last_verified_at?: string | null;
}

export function resolvePoolStorage(
  env?: Record<string, string | undefined>
): PoolStorageConfig | null {
  const supabaseUrl = String(
    env?.SUPABASE_URL || env?.SUPREMEAI_SUPABASE_URL || env?.VITE_SUPABASE_URL || ''
  )
    .trim()
    .replace(/\/+$/, '');
  const serviceKey = String(env?.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const encryptionSecret = String(
    env?.POOL_ENCRYPTION_KEY || env?.CREDENTIAL_ENCRYPTION_KEY || ''
  ).trim();
  if (!supabaseUrl || !serviceKey || encryptionSecret.length < 16) return null;
  return { supabaseUrl, serviceKey, encryptionSecret };
}

export function poolBonusFor(provider: string): number {
  return POOL_BONUS_WEIGHTS[provider] ?? POOL_DEFAULT_BONUS;
}

export function findPoolManifest(provider: string) {
  const id = String(provider || '')
    .trim()
    .toLowerCase();
  return POOL_PROVIDER_MANIFESTS.find((m) => m.id === id) || null;
}

export function isPoolKeyFormatValid(provider: string, rawKey: string): boolean {
  const manifest = findPoolManifest(provider);
  if (!manifest) return false;
  try {
    return new RegExp(manifest.keyPattern).test(rawKey.trim());
  } catch {
    return false;
  }
}

export function poolKeyHint(rawKey: string): string {
  const key = rawKey.trim();
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** ব্যাকএন্ডের `hashlib.sha256(raw).hexdigest()`-এর সাথে হুবহু মেলে — তাই দুই পথে ডুপ্লিকেট আটকায়। */
export async function poolKeyFingerprint(rawKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey.trim()));
  return toHex(digest);
}

async function deriveAesKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptPoolKey(rawKey: string, secret: string): Promise<string> {
  const key = await deriveAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(rawKey.trim())
  );
  return `${EDGE_CIPHER_PREFIX}${toBase64(iv)}:${toBase64(new Uint8Array(cipher))}`;
}

export async function decryptPoolKey(payload: string, secret: string): Promise<string> {
  if (!payload.startsWith(EDGE_CIPHER_PREFIX)) throw new Error('Unsupported cipher format');
  const [ivB64, ctB64] = payload.slice(EDGE_CIPHER_PREFIX.length).split(':');
  const key = await deriveAesKey(secret);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivB64) },
    key,
    fromBase64(ctB64)
  );
  return new TextDecoder().decode(plain);
}

const PROVIDER_PROBE_URLS: Record<
  string,
  (key: string) => { url: string; headers: Record<string, string> }
> = {
  gemini: (key) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    headers: {},
  }),
  groq: (key) => ({
    url: 'https://api.groq.com/openai/v1/models',
    headers: { Authorization: `Bearer ${key}` },
  }),
  openrouter: (key) => ({
    url: 'https://openrouter.ai/api/v1/auth/key',
    headers: { Authorization: `Bearer ${key}` },
  }),
  cerebras: (key) => ({
    url: 'https://api.cerebras.ai/v1/models',
    headers: { Authorization: `Bearer ${key}` },
  }),
  sambanova: (key) => ({
    url: 'https://api.sambanova.ai/v1/models',
    headers: { Authorization: `Bearer ${key}` },
  }),
  mistral: (key) => ({
    url: 'https://api.mistral.ai/v1/models',
    headers: { Authorization: `Bearer ${key}` },
  }),
  cohere: (key) => ({
    url: 'https://api.cohere.com/v1/models',
    headers: { Authorization: `Bearer ${key}` },
  }),
  github: (key) => ({
    url: 'https://models.github.ai/catalog/models',
    headers: { Authorization: `Bearer ${key}` },
  }),
};

/**
 * প্রোভাইডারের ফ্রি `models` এন্ডপয়েন্টে লাইভ যাচাই (টোকেন খরচ নেই)। fail-closed: শুধু HTTP 200 বৈধ।
 * যাদের প্রোব নেই (যেমন kilo) তাদের শুধু ফরম্যাট-যাচাই — ব্যাকএন্ডের আচরণের সাথে মিল।
 */
export async function validatePoolKeyUpstream(
  provider: string,
  rawKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000
): Promise<boolean> {
  const build = PROVIDER_PROBE_URLS[provider];
  if (!build) return true;
  const { url, headers } = build(rawKey.trim());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
    return res.status === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** একই নিয়ম ব্যাকএন্ডের মতো: শুধু valid কী, সর্বোচ্চ ১০টি গোনা হয়। */
export function computePoolQuota(rows: Array<Pick<PoolKeyRow, 'provider' | 'status'>>): {
  valid_keys_count: number;
  daily_bonus_tokens: number;
} {
  let valid = 0;
  let bonus = 0;
  for (const r of rows) {
    if (r.status !== 'valid') continue;
    if (valid >= POOL_MAX_ACTIVE_KEYS) break;
    valid += 1;
    bonus += poolBonusFor(r.provider);
  }
  return { valid_keys_count: valid, daily_bonus_tokens: bonus };
}

export class PoolStore {
  constructor(
    private readonly cfg: PoolStorageConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  private async rest(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('apikey', this.cfg.serviceKey);
    headers.set('Authorization', `Bearer ${this.cfg.serviceKey}`);
    if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
    return this.fetchImpl(`${this.cfg.supabaseUrl}/rest/v1/${path}`, { ...init, headers });
  }

  private async json<T>(res: Response, what: string): Promise<T> {
    if (!res.ok) throw new Error(`${what} failed (HTTP ${res.status})`);
    return (await res.json()) as T;
  }

  async listUserKeys(userId: string): Promise<PoolKeyRow[]> {
    const q = new URLSearchParams({
      select: 'id,provider,status,bonus_weight,key_hint,created_at,last_verified_at',
      user_id: `eq.${userId}`,
      order: 'created_at.desc',
    });
    return this.json<PoolKeyRow[]>(
      await this.rest(`user_contributed_api_keys?${q.toString()}`),
      'List keys'
    );
  }

  async fingerprintExists(fp: string): Promise<boolean> {
    const q = new URLSearchParams({ select: 'id', key_fingerprint: `eq.${fp}`, limit: '1' });
    const rows = await this.json<unknown[]>(
      await this.rest(`user_contributed_api_keys?${q.toString()}`),
      'Duplicate check'
    );
    return rows.length > 0;
  }

  async insertKey(row: Record<string, unknown>): Promise<void> {
    const res = await this.rest('user_contributed_api_keys', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`Store key failed (HTTP ${res.status})`);
  }

  async deleteUserKey(userId: string, id: string): Promise<boolean> {
    const q = new URLSearchParams({ id: `eq.${id}`, user_id: `eq.${userId}` });
    const res = await this.rest(`user_contributed_api_keys?${q.toString()}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    const rows = await this.json<unknown[]>(res, 'Delete key');
    return rows.length > 0;
  }

  async getQuota(
    userId: string
  ): Promise<{ valid_keys_count: number; daily_bonus_tokens: number } | null> {
    const q = new URLSearchParams({ select: '*', user_id: `eq.${userId}` });
    const rows = await this.json<Array<{ valid_keys_count: number; daily_bonus_tokens: number }>>(
      await this.rest(`user_bonus_quotas?${q.toString()}`),
      'Quota lookup'
    );
    return rows[0] || null;
  }

  async recomputeQuota(
    userId: string
  ): Promise<{ valid_keys_count: number; daily_bonus_tokens: number }> {
    const rows = await this.listUserKeys(userId);
    // পুরনো থেকে নতুন ক্রমে গুনি যাতে প্রথম ১০টি স্থির থাকে
    const quota = computePoolQuota([...rows].reverse());
    const res = await this.rest('user_bonus_quotas?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: userId, ...quota, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error(`Quota update failed (HTTP ${res.status})`);
    return quota;
  }
}
