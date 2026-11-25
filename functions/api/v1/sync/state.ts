/**
 * বাংলা মন্তব্য: Cloudflare Pages Edge-এ `/api/v1/sync/state` এন্ডপয়েন্ট।
 * প্রথমে আপস্ট্রিম রিয়েল-টাইম সিঙ্ক হাব চেষ্টা করে; আপস্ট্রিম ঘুমন্ত বা অনুপলব্ধ থাকলে
 * `/api/v1/user/preferences` ভল্ট ও Edge মেমোরির মাধ্যমে নিরবচ্ছিন্ন চার-প্ল্যাটফর্ম সিঙ্ক বজায় রাখে।
 */
import {
  PagesContext,
  fetchWithTimeout,
  handleCorsPreflight,
  jsonEdgeResponse,
  resolveUpstreamOrigin,
} from '../../../_lib/edgeHelpers';
import { SYNC_DOMAINS, SYNC_PLATFORMS } from '../../../../src/shared/platformCatalog';

interface EdgeSyncEnvelope {
  v?: 1;
  protocolVersion: '1.0.0';
  domain: string;
  deviceId: string;
  platform: string;
  updatedAt: number;
  revision: number;
  payload: unknown;
}

const VALID_DOMAINS = new Set<string>(SYNC_DOMAINS);
const VALID_PLATFORMS = new Set<string>(SYNC_PLATFORMS);
const edgeSyncFallbackCache = new Map<string, Record<string, EdgeSyncEnvelope>>();

function extractAuthToken(request: Request, url: URL): string {
  const auth = (request.headers.get('Authorization') || '').trim();
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const key = (request.headers.get('X-SupremeAI-Key') || '').trim();
  if (key) return key;
  return (url.searchParams.get('token') || '').trim();
}

async function sha256Short(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);
  if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'PUT') {
    return jsonEdgeResponse({ error: 'Method not allowed' }, 405, request, undefined, env);
  }

  const incomingUrl = new URL(request.url);
  const token = extractAuthToken(request, incomingUrl);
  if (!token || token.startsWith('tok_guest_') || token.startsWith('sk-supreme-guest')) {
    return jsonEdgeResponse(
      request.method === 'GET'
        ? { status: 'guest', envelopes: [], preferences: {}, serverTimestamp: Date.now() }
        : { status: 'guest-local-only', synced: false },
      200,
      request,
      undefined,
      env
    );
  }

  const upstreamOrigin = resolveUpstreamOrigin(env);
  const authHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'X-SupremeAI-Key': token,
    Accept: 'application/json',
  };

  let parsedBody: Record<string, unknown> | null = null;
  if (request.method === 'POST' || request.method === 'PUT') {
    parsedBody = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!parsedBody || typeof parsedBody !== 'object') {
      return jsonEdgeResponse({ error: 'Invalid JSON body' }, 400, request, undefined, env);
    }
  }

  // ১) প্রথমে ডেডিকেটেড আপস্ট্রিম `/api/v1/sync/state` চেষ্টা করা হচ্ছে
  try {
    const upstreamRes = await fetchWithTimeout(
      `${upstreamOrigin}/api/v1/sync/state`,
      {
        method: request.method,
        headers:
          request.method === 'POST' || request.method === 'PUT'
            ? { ...authHeaders, 'Content-Type': 'application/json' }
            : authHeaders,
        body:
          request.method === 'POST' || request.method === 'PUT'
            ? JSON.stringify(parsedBody)
            : undefined,
      },
      4500
    );
    if (upstreamRes.ok) {
      const data = await upstreamRes.json().catch(() => null);
      if (data && typeof data === 'object') {
        return jsonEdgeResponse(data, 200, request, undefined, env);
      }
    }
  } catch {
    // Fallback to `/api/v1/user/preferences` envelope store below
  }

  // ২) ফলব্যাক: `/api/v1/user/preferences`-এর `__sync_domains` এবং Edge ক্যাশ
  const cacheKey = await sha256Short(token);
  const cachedDomains: Record<string, EdgeSyncEnvelope> = {
    ...(edgeSyncFallbackCache.get(cacheKey) || {}),
  };
  let remotePreferences: Record<string, unknown> = {};

  try {
    const prefRes = await fetchWithTimeout(
      `${upstreamOrigin}/api/v1/user/preferences`,
      { method: 'GET', headers: authHeaders },
      5000
    );
    if (prefRes.ok) {
      const prefJson = (await prefRes.json().catch(() => null)) as {
        preferences?: Record<string, unknown>;
      } | null;
      if (prefJson?.preferences && typeof prefJson.preferences === 'object') {
        remotePreferences = prefJson.preferences;
        const storedDomains = prefJson.preferences.__sync_domains;
        if (storedDomains && typeof storedDomains === 'object') {
          for (const [dom, rawEnv] of Object.entries(
            storedDomains as Record<string, EdgeSyncEnvelope>
          )) {
            if (
              rawEnv &&
              typeof rawEnv === 'object' &&
              (!cachedDomains[dom] || Number(rawEnv.updatedAt || 0) >= cachedDomains[dom].updatedAt)
            ) {
              cachedDomains[dom] = rawEnv;
            }
          }
        }
      }
    }
  } catch {
    // Keep Edge memory fallback
  }

  if (request.method === 'GET') {
    edgeSyncFallbackCache.set(cacheKey, cachedDomains);
    const envelopes = Object.values(cachedDomains).sort((a, b) => a.updatedAt - b.updatedAt);
    return jsonEdgeResponse(
      {
        status: 'ok',
        envelopes,
        preferences: remotePreferences,
        serverTimestamp: Date.now(),
        source: 'edge-preferences-bridge',
      },
      200,
      request,
      undefined,
      env
    );
  }

  const domain = String(parsedBody?.domain || '').trim();
  if (!VALID_DOMAINS.has(domain)) {
    return jsonEdgeResponse(
      { error: `Unsupported sync domain: ${domain}` },
      400,
      request,
      undefined,
      env
    );
  }

  const rawPlatform = String(
    parsedBody?.platform ||
      request.headers.get('X-SupremeAI-Platform') ||
      request.headers.get('X-Sync-Platform') ||
      'web'
  )
    .trim()
    .toLowerCase();
  const platform = VALID_PLATFORMS.has(rawPlatform) ? rawPlatform : 'web';
  const deviceId = String(
    parsedBody?.deviceId ||
      request.headers.get('X-SupremeAI-Device') ||
      request.headers.get('X-Device-Id') ||
      `edge-${Date.now()}`
  )
    .trim()
    .slice(0, 128);
  const ts = Number(parsedBody?.updatedAt);
  const updatedAt = Number.isFinite(ts) && ts > 0 ? ts : Date.now();
  const revision = Number.isFinite(Number(parsedBody?.revision)) ? Number(parsedBody?.revision) : 1;

  const incomingEnvelope: EdgeSyncEnvelope = {
    v: 1,
    protocolVersion: '1.0.0',
    domain,
    deviceId,
    platform,
    updatedAt,
    revision,
    payload: parsedBody?.payload ?? {},
  };

  const prev = cachedDomains[domain];
  const accepted = !prev || incomingEnvelope.updatedAt >= prev.updatedAt;
  if (accepted) {
    cachedDomains[domain] = incomingEnvelope;
    edgeSyncFallbackCache.set(cacheKey, cachedDomains);
    try {
      await fetchWithTimeout(
        `${upstreamOrigin}/api/v1/user/preferences`,
        {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            __sync_domains: cachedDomains,
            ...(domain === 'preferences' &&
            incomingEnvelope.payload &&
            typeof incomingEnvelope.payload === 'object'
              ? (incomingEnvelope.payload as Record<string, unknown>)
              : {}),
          }),
        },
        5000
      );
    } catch {
      // Edge cache still retains latest envelope
    }
  }

  return jsonEdgeResponse(
    {
      status: 'ok',
      synced: true,
      accepted,
      envelope: cachedDomains[domain],
      serverTimestamp: Date.now(),
    },
    200,
    request,
    undefined,
    env
  );
}
