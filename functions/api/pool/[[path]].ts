/**
 * বাংলা মন্তব্য: `/api/pool/*` — "লিমিট বাড়ান" ট্যাবের API।
 *
 * ১) providers / contribute / quota আগে Render ব্যাকএন্ডে (pool.py) পাঠাই — সেটা চালু থাকলে ওটাই সত্য।
 * ২) ব্যাকএন্ডে রাউট না থাকলে (404/405/501/5xx/নেটওয়ার্ক) edge নিজেই একই Supabase টেবিলে কাজ করে।
 * ৩) `keys` (তালিকা/মুছে ফেলা) ব্যাকএন্ডে নেই, তাই সবসময় edge থেকে।
 * স্টোরেজ কনফিগার না থাকলে চুপচাপ ভুয়া "সফল" নয় — স্পষ্ট 503 + কারণ ফেরত দিই।
 */

import {
  PagesContext,
  applyCorsHeaders,
  forwardRawUpstream,
  handleCorsPreflight,
  jsonEdgeResponse,
  resolveUpstreamOrigin,
  verifyUpstreamSession,
  type UpstreamSessionVerification,
} from '../../_lib/edgeHelpers';
import { POOL_PROVIDER_MANIFESTS } from '../../../src/constants/poolProvidersManifest';
import {
  POOL_DAILY_SUBMISSION_CAP,
  PoolStore,
  encryptPoolKey,
  findPoolManifest,
  isPoolKeyFormatValid,
  poolBonusFor,
  poolKeyFingerprint,
  poolKeyHint,
  resolvePoolStorage,
  validatePoolKeyUpstream,
} from '../../_lib/poolStore';

const UPSTREAM_FIRST = new Set(['/api/pool/providers', '/api/pool/contribute', '/api/pool/quota']);
const FALLBACK_STATUSES = new Set([404, 405, 501, 502, 503, 504]);

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env = {} } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const upstreamOrigin = resolveUpstreamOrigin(env);
  const reply = (data: unknown, status = 200) =>
    jsonEdgeResponse(data, status, request, undefined, env);

  // ১) ব্যাকএন্ড-প্রথম
  if (UPSTREAM_FIRST.has(path)) {
    try {
      const upstream = await forwardRawUpstream(
        request.clone(),
        upstreamOrigin,
        `${path}${url.search}`,
        9000
      );
      if (!FALLBACK_STATUSES.has(upstream.status)) {
        const headers = new Headers({
          'Content-Type': upstream.headers.get('content-type') || 'application/json',
        });
        applyCorsHeaders(headers, request.headers.get('Origin'), url.origin, env);
        return new Response(await upstream.text(), { status: upstream.status, headers });
      }
    } catch {
      // edge fallback নিচে
    }
  }

  if (path === '/api/pool/providers' && request.method === 'GET') {
    return reply({ providers: POOL_PROVIDER_MANIFESTS, source: 'edge' });
  }

  // বাকি সবকিছুর জন্য লগইন করা ইউজার লাগবে
  const session: UpstreamSessionVerification = await verifyUpstreamSession(
    request,
    upstreamOrigin
  ).catch(() => ({ valid: false, isGuest: false }));
  // বাংলা মন্তব্য: ব্যাকএন্ড (pool.py) `sub`/user_id দিয়ে লেখে — তাই আগে user_id, না থাকলে email।
  const userId = session.user_id || session.email;
  if (!session.valid || session.isGuest || !userId) {
    return reply({ detail: 'Sign in to boost your limit.' }, 401);
  }

  const storage = resolvePoolStorage(env);
  if (!storage) {
    return reply(
      {
        detail:
          'Key pool storage is not configured on the server yet (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POOL_ENCRYPTION_KEY).',
        code: 'pool_storage_not_configured',
      },
      503
    );
  }
  const store = new PoolStore(storage);

  try {
    if (path === '/api/pool/quota' && request.method === 'GET') {
      const quota = (await store.getQuota(userId)) || {
        valid_keys_count: 0,
        daily_bonus_tokens: 0,
      };
      return reply({ user_id: userId, ...quota });
    }

    if (path === '/api/pool/keys' && request.method === 'GET') {
      return reply({ keys: await store.listUserKeys(userId) });
    }

    const keyIdMatch = path.match(/^\/api\/pool\/keys\/([0-9a-fA-F-]{36})$/);
    if (keyIdMatch && request.method === 'DELETE') {
      const removed = await store.deleteUserKey(userId, keyIdMatch[1]);
      if (!removed) return reply({ detail: 'Key not found' }, 404);
      const quota = await store.recomputeQuota(userId);
      return reply({ status: 'removed', ...quota });
    }

    if (path === '/api/pool/contribute' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as {
        provider?: string;
        api_key?: string;
      };
      const provider = String(body.provider || '')
        .trim()
        .toLowerCase();
      const rawKey = String(body.api_key || '').trim();
      if (!findPoolManifest(provider)) return reply({ detail: 'Unknown provider' }, 400);
      if (rawKey.length < 8 || !isPoolKeyFormatValid(provider, rawKey)) {
        return reply({ detail: 'Key format invalid' }, 400);
      }

      const fp = await poolKeyFingerprint(rawKey);
      if (await store.fingerprintExists(fp)) return reply({ detail: 'Key already in pool' }, 409);

      const existing = await store.listUserKeys(userId);
      const today = new Date().toISOString().slice(0, 10);
      if (
        existing.filter((r) => String(r.created_at || '').startsWith(today)).length >=
        POOL_DAILY_SUBMISSION_CAP
      ) {
        return reply(
          { detail: `Daily key submission limit reached (${POOL_DAILY_SUBMISSION_CAP} keys/day)` },
          429
        );
      }

      if (!(await validatePoolKeyUpstream(provider, rawKey))) {
        return reply({ detail: 'Key validation failed — the provider rejected this key.' }, 400);
      }

      const now = new Date().toISOString();
      const bonus = poolBonusFor(provider);
      await store.insertKey({
        id: crypto.randomUUID(),
        user_id: userId,
        provider,
        encrypted_key: await encryptPoolKey(rawKey, storage.encryptionSecret),
        key_fingerprint: fp,
        key_hint: poolKeyHint(rawKey),
        status: 'valid',
        bonus_weight: bonus,
        last_verified_at: now,
        created_at: now,
        updated_at: now,
      });
      await store.recomputeQuota(userId).catch(() => undefined);
      return reply({
        status: 'accepted',
        provider,
        bonus_earned: bonus,
        message: 'Key added to pool',
      });
    }
  } catch {
    return reply({ detail: 'Key pool storage error. Please try again shortly.' }, 502);
  }

  return reply({ detail: `Pool endpoint ${path} not found` }, 404);
}
