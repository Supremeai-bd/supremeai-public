import {
  DEFAULT_BACKEND_ORIGIN,
  DEFAULT_MCP_TOWER_ORIGIN as SSOT_MCP_TOWER_ORIGIN,
} from '../../src/config/platformEndpoints';

export interface PagesContext {
  request: Request;
  env?: Record<string, string | undefined>;
  params?: Record<string, string | string[] | undefined>;
}

export const DEFAULT_UPSTREAM_ORIGIN = DEFAULT_BACKEND_ORIGIN;
export const FALLBACK_UPSTREAM_ORIGIN = 'https://supremeai-primary-node-5xso.onrender.com';
export const DEFAULT_MCP_TOWER_ORIGIN = SSOT_MCP_TOWER_ORIGIN;

const HOP_BY_HOP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'x-forwarded-proto',
  'x-real-ip',
  'user-agent',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'sec-fetch-user',
]);

/**
 * Build sanitized server-to-server headers for Cloudflare -> Render upstream calls.
 * Strips browser fingerprint headers (`sec-ch-ua*`, `sec-fetch-*`, Chrome User-Agent)
 * so upstream Cloudflare WAF does not trigger false Bot Management 403 challenges.
 */
export function buildUpstreamForwardHeaders(request: Request, incomingUrl: URL): Headers {
  const forwarded = new Headers();
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (!HOP_BY_HOP_REQUEST_HEADERS.has(lower) && !lower.startsWith('sec-ch-ua')) {
      forwarded.set(key, value);
    }
  });
  forwarded.set('User-Agent', 'SupremeAI-Pages-Proxy/1.0');
  forwarded.set('X-Forwarded-Host', incomingUrl.host);
  forwarded.set('X-Forwarded-Proto', incomingUrl.protocol.replace(':', ''));
  return forwarded;
}

export function resolveUpstreamOrigin(env?: Record<string, string | undefined>): string {
  return (env?.SUPREMEAI_BACKEND_URL || DEFAULT_UPSTREAM_ORIGIN).replace(/\/+$/, '');
}

export function resolveMcpTowerOrigin(env?: Record<string, string | undefined>): string {
  return (env?.SUPREMEAI_MCP_TOWER_ORIGIN || DEFAULT_MCP_TOWER_ORIGIN).replace(/\/+$/, '');
}

export function resolveMcpRpcCandidates(env?: Record<string, string | undefined>): string[] {
  const origin = resolveMcpTowerOrigin(env);
  const agentKey = env?.MCP_TOWER_AGENT_KEY?.trim() || 'federated_bridge_agent';
  if (env?.SUPREMEAI_MCP_TOWER_URL?.trim()) {
    const custom = env.SUPREMEAI_MCP_TOWER_URL.trim();
    return custom.endsWith('/mcp') && !custom.includes('/agents/')
      ? [custom, `${origin}/agents/${agentKey}/mcp`]
      : [custom, `${origin}/mcp`];
  }
  return [`${origin}/agents/${agentKey}/mcp`, `${origin}/mcp`];
}

export function resolveMcpRpcUrl(env?: Record<string, string | undefined>): string {
  return resolveMcpRpcCandidates(env)[0];
}

const DEFAULT_ALLOWED_EDGE_ORIGINS = [
  'https://supremeai-studio.pages.dev',
  'https://supremeai.studio',
  'https://www.supremeai.studio',
  'https://tauri.localhost',
  'tauri://localhost',
];

export function isAllowedEdgeOrigin(
  requestOrigin: string | null | undefined,
  incomingOrigin: string,
  env?: Record<string, string | undefined>
): boolean {
  const clean = String(requestOrigin || '').trim();
  if (!clean) return true;
  if (clean === incomingOrigin) return true;
  if (DEFAULT_ALLOWED_EDGE_ORIGINS.includes(clean)) return true;

  const extra = (env?.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (extra.includes(clean)) return true;

  try {
    const parsed = new URL(clean);
    const host = parsed.hostname.toLowerCase();
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (host === 'localhost' || host === '127.0.0.1')
    ) {
      return true;
    }
    if (
      parsed.protocol === 'https:' &&
      (host.endsWith('.supremeai-studio.pages.dev') || host.endsWith('.supremeai.studio'))
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function applyCorsHeaders(
  headers: Headers,
  requestOrigin: string | null | undefined,
  incomingOrigin?: string,
  env?: Record<string, string | undefined>
): void {
  const cleanOrigin = String(requestOrigin || '').trim();
  const baseOrigin = String(incomingOrigin || '').trim();
  const effectiveOrigin = cleanOrigin || baseOrigin;

  headers.set('Vary', 'Origin');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-SupremeAI-Key, X-Admin-Token, Accept, Cache-Control, X-Vault-Cookie'
  );
  headers.set(
    'Access-Control-Expose-Headers',
    'X-SupremeAI-Provider, X-SupremeAI-Slot, X-SupremeAI-Tier, X-SupremeAI-Cache'
  );

  if (effectiveOrigin && isAllowedEdgeOrigin(cleanOrigin, baseOrigin, env)) {
    headers.set('Access-Control-Allow-Origin', effectiveOrigin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  } else {
    headers.delete('Access-Control-Allow-Origin');
    headers.delete('Access-Control-Allow-Credentials');
  }
}

export function handleCorsPreflight(
  request: Request,
  env?: Record<string, string | undefined>
): Response {
  const incomingUrl = new URL(request.url);
  const requestOrigin = request.headers.get('Origin');
  const headers = new Headers({ 'Access-Control-Max-Age': '86400' });
  applyCorsHeaders(headers, requestOrigin, incomingUrl.origin, env);
  return new Response(null, { status: 204, headers });
}

export function jsonEdgeResponse(
  data: unknown,
  status: number,
  request: Request,
  extraHeaders?: Record<string, string>,
  env?: Record<string, string | undefined>
): Response {
  const incomingUrl = new URL(request.url);
  const requestOrigin = request.headers.get('Origin');
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.set(k, v);
    }
  }
  applyCorsHeaders(headers, requestOrigin, incomingUrl.origin, env);
  return new Response(JSON.stringify(data), { status, headers });
}

export function timingSafeEqualStrings(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length || aBytes.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

export function isSafeGitHubRepoSlug(repo: string): boolean {
  const trimmed = String(repo || '').trim();
  if (!trimmed || trimmed.includes('..')) return false;
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed);
}

export function validateEdgeGitLabHost(
  rawHost: string | null | undefined,
  configuredHost?: string
): { valid: true; origin: string } | { valid: false; reason: string } {
  const fallback = (configuredHost || 'https://gitlab.com').trim().replace(/\/+$/, '');
  const candidate = (rawHost || '').trim().replace(/\/+$/, '') || fallback;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { valid: false, reason: 'Invalid GitLab host URL.' };
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    return { valid: false, reason: 'GitLab host must be a valid https:// origin.' };
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    return { valid: false, reason: 'GitLab host must not include a path.' };
  }

  const allowedOrigins = new Set<string>(['https://gitlab.com']);
  if (configuredHost?.trim()) {
    try {
      const cfg = new URL(configuredHost.trim());
      if (cfg.protocol === 'https:') allowedOrigins.add(cfg.origin);
    } catch {
      // ignore invalid env value
    }
  }

  if (!allowedOrigins.has(parsed.origin)) {
    return {
      valid: false,
      reason:
        'Untrusted GitLab host. Only https://gitlab.com or configured GITLAB_HOST is permitted.',
    };
  }
  return { valid: true, origin: parsed.origin };
}

export function isRestrictedEdgeHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::' ||
    host === '::1' ||
    host === '169.254.169.254' ||
    host === 'metadata.google.internal' ||
    host === 'metadata' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost') ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||
    host.startsWith('0.') ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80:') ||
    host.startsWith('::ffff:') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(host)
  ) {
    return true;
  }
  return false;
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = 8500
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function safeEdgeFetch(
  initialUrl: string | URL,
  init: RequestInit = {},
  timeoutMs: number = 10000,
  maxRedirects: number = 5
): Promise<Response> {
  let currentUrl = typeof initialUrl === 'string' ? new URL(initialUrl) : initialUrl;
  let currentInit: RequestInit = { ...init, redirect: 'manual' };

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (currentUrl.protocol !== 'http:' && currentUrl.protocol !== 'https:') {
      throw new Error('Only http:// and https:// URLs are permitted.');
    }
    if (isRestrictedEdgeHost(currentUrl.hostname)) {
      throw new Error('Access to private network or metadata addresses is restricted.');
    }

    const res = await fetchWithTimeout(currentUrl.toString(), currentInit, timeoutMs);
    if (
      res.status === 301 ||
      res.status === 302 ||
      res.status === 303 ||
      res.status === 307 ||
      res.status === 308
    ) {
      const location = res.headers.get('location');
      if (!location) return res;
      if (hop === maxRedirects) {
        throw new Error('Too many redirects.');
      }
      currentUrl = new URL(location, currentUrl);
      if (
        res.status === 303 ||
        ((res.status === 301 || res.status === 302) &&
          currentInit.method &&
          currentInit.method.toUpperCase() === 'POST')
      ) {
        currentInit = { ...currentInit, method: 'GET', body: undefined };
      }
      continue;
    }
    return res;
  }

  throw new Error('Redirect limit exceeded.');
}

export async function mintOrExtractAuthHeaders(
  request: Request,
  upstreamOrigin: string
): Promise<Record<string, string>> {
  const out: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const auth = request.headers.get('Authorization');
  const key = request.headers.get('X-SupremeAI-Key');
  const cookie = request.headers.get('Cookie');

  if (auth) out['Authorization'] = auth;
  if (key) out['X-SupremeAI-Key'] = key;
  if (cookie) out['Cookie'] = cookie;

  if (!auth && !key) {
    try {
      const guestRes = await fetchWithTimeout(
        `${upstreamOrigin}/api/v1/auth/guest`,
        {
          method: 'POST',
          headers: { Accept: 'application/json' },
        },
        4500
      );
      if (guestRes.ok) {
        const guestJson = (await guestRes.json().catch(() => null)) as {
          access_token?: string;
          token?: string;
        } | null;
        const token = guestJson?.access_token || guestJson?.token;
        if (token) {
          out['Authorization'] = `Bearer ${token}`;
          out['X-SupremeAI-Key'] = token;
        }
      }
    } catch {
      // Proceed cleanly without guest token
    }
  }

  return out;
}

export async function forwardRawUpstream(
  request: Request,
  upstreamOrigin: string,
  targetPathAndSearch: string,
  timeoutMs: number = 9000
): Promise<Response> {
  const headers = new Headers();
  const forwardKeys = ['authorization', 'x-supremeai-key', 'cookie', 'content-type', 'accept'];
  for (const k of forwardKeys) {
    const val = request.headers.get(k);
    if (val) headers.set(k, val);
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody ? await request.arrayBuffer().catch(() => undefined) : undefined;

  return fetchWithTimeout(
    `${upstreamOrigin}${targetPathAndSearch}`,
    {
      method: request.method,
      headers,
      body: hasBody ? body : undefined,
    },
    timeoutMs
  );
}

// --- Lightweight MCP JSON-RPC 2.0 Client (Edge Web Standards) ---
function parseMcpSseOrJson(raw: string): any {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }
  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);
  for (let i = dataLines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(dataLines[i]);
    } catch {
      // continue checking prior frames
    }
  }
  return null;
}

export async function callMcpTowerRpc(
  env: Record<string, string | undefined> | undefined,
  method: 'tools/list' | 'tools/call' | 'resources/list' | 'resources/read',
  params: Record<string, unknown> = {},
  timeoutMs: number = 8500
): Promise<any> {
  const candidates = resolveMcpRpcCandidates(env);
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (env?.SUPREMEAI_TOWER_TOKEN?.trim()) {
    baseHeaders['Authorization'] = `Bearer ${env.SUPREMEAI_TOWER_TOKEN.trim()}`;
  }

  let lastError: Error | null = null;
  for (const rpcUrl of candidates) {
    try {
      const initRes = await fetchWithTimeout(
        rpcUrl,
        {
          method: 'POST',
          headers: baseHeaders,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'supremeai-pages-edge-bridge', version: '2.5.0' },
            },
          }),
        },
        6500
      );

      if (!initRes.ok) {
        if (initRes.status === 404 || initRes.status === 403) {
          lastError = new Error(`MCP initialize returned HTTP ${initRes.status}`);
          continue;
        }
        throw new Error(`MCP initialize returned HTTP ${initRes.status}`);
      }

      const sid = initRes.headers.get('mcp-session-id');
      const callHeaders: Record<string, string> = {
        ...baseHeaders,
        ...(sid ? { 'mcp-session-id': sid } : {}),
      };

      await fetchWithTimeout(
        rpcUrl,
        {
          method: 'POST',
          headers: callHeaders,
          body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        },
        3000
      ).catch(() => {});

      const rpcRes = await fetchWithTimeout(
        rpcUrl,
        {
          method: 'POST',
          headers: callHeaders,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method,
            params,
          }),
        },
        timeoutMs
      );

      if (!rpcRes.ok) {
        throw new Error(`MCP ${method} failed with HTTP ${rpcRes.status}`);
      }

      const rawText = await rpcRes.text();
      const parsed = parseMcpSseOrJson(rawText);
      if (!parsed) {
        throw new Error(`Unparseable MCP payload for ${method}`);
      }
      if (parsed.error) {
        throw new Error(parsed.error.message || JSON.stringify(parsed.error));
      }
      return parsed.result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError || new Error('All MCP Tower RPC endpoints unreachable');
}

// --- WebCrypto RFC 6238 TOTP Helpers ---
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateEdgeBase32Secret(byteLength: number = 20): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function decodeBase32ToBytes(input: string): Uint8Array {
  const normalized = String(input || '')
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (let i = 0; i < normalized.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(normalized[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

export async function generateEdgeHotp(
  secretBytes: Uint8Array,
  counter: number,
  digits: number = 6
): Promise<string> {
  const msg = new Uint8Array(8);
  let rem = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    msg[i] = Number(rem & 0xffn);
    rem >>= 8n;
  }

  const keyMaterial = new Uint8Array(secretBytes);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, msg));
  const offset = sig[sig.length - 1] & 0x0f;
  const binary =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export async function verifyEdgeTotpToken(
  base32Secret: string,
  code: string,
  windowSteps: number = 1
): Promise<boolean> {
  const cleanCode = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleanCode)) return false;
  const keyBytes = decodeBase32ToBytes(base32Secret);
  if (keyBytes.length === 0) return false;
  const currentStep = Math.floor(Date.now() / 1000 / 30);
  for (let offset = -windowSteps; offset <= windowSteps; offset++) {
    const candidate = await generateEdgeHotp(keyBytes, currentStep + offset, 6);
    if (candidate === cleanCode) return true;
  }
  return false;
}

export async function extractLlmCompletionText(
  upstreamOrigin: string,
  authHeaders: Record<string, string>,
  payload: Record<string, unknown>,
  timeoutMs: number = 14000
): Promise<string> {
  // 1. Try OpenAI-compatible non-streaming /v1/chat/completions
  const nonStreamRes = await fetchWithTimeout(
    `${upstreamOrigin}/v1/chat/completions`,
    {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ ...payload, stream: false }),
    },
    timeoutMs
  ).catch(() => null);

  if (nonStreamRes?.ok) {
    const json = (await nonStreamRes.json().catch(() => null)) as any;
    const text =
      json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text ?? json?.text ?? '';
    if (typeof text === 'string' && text.trim()) {
      return text.trim();
    }
  }

  // 2. Fallback to collecting SSE from /api/v1/stream/chat
  const streamRes = await fetchWithTimeout(
    `${upstreamOrigin}/api/v1/stream/chat`,
    {
      method: 'POST',
      headers: {
        ...authHeaders,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ ...payload, stream: true }),
    },
    timeoutMs
  ).catch(() => null);

  if (!streamRes?.ok || !streamRes.body) return '';
  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let collected = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') break;
      try {
        const parsed = JSON.parse(dataStr);
        const chunk = parsed?.choices?.[0]?.delta?.content ?? parsed?.text ?? '';
        if (typeof chunk === 'string') collected += chunk;
      } catch {
        // Ignore partial frames
      }
    }
  }

  return collected.trim();
}
