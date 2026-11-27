/**
 * বাংলা মন্তব্য: মডেল-রাউটার ওভাররাইড — core-এর আসল রাউটিং (core/llm/llm_gateway/routing.py)।
 * সাধারণ অবস্থায় সিস্টেম নিজেই মডেল বাছে; জরুরি দরকারে অ্যাডমিন সাময়িকভাবে একটা প্রোভাইডার/মডেল
 * আগে বসাতে পারে, তারপর বন্ধ করলেই আবার স্বয়ংক্রিয়।
 *
 * - GET    /api/admin/model-router            → লাইভ অবস্থা + প্রোভাইডার তালিকা
 * - POST   /api/admin/model-router/override   → { provider, model?, remainingRequests? }
 * - DELETE /api/admin/model-router/override   → বন্ধ
 */

import { jsonEdgeResponse } from './edgeHelpers';
import { callCoreAdmin, describeCoreFailure, type CoreCallResult } from './coreAdminBridge';

type Env = Record<string, string | undefined> | undefined;

export interface ModelRouterProvider {
  id: string;
  status: string;
  latencyMs: number;
  models: string[];
}

export interface ModelRouterOverride {
  provider: string;
  model: string;
  remainingRequests: number;
  setBy: string | null;
  setAt: string | null;
}

export interface ModelRouterState {
  linked: true;
  override: ModelRouterOverride | null;
  fallbackChain: string[];
  providers: ModelRouterProvider[];
  providersError?: string;
}

const PROVIDER_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const MAX_REMAINING = 100_000;

export function normalizeRouterState(router: unknown, providers: unknown): ModelRouterState {
  const r = (router && typeof router === 'object' ? router : {}) as Record<string, unknown>;
  const o = r.current_override as Record<string, unknown> | null | undefined;
  const list = Array.isArray(providers) ? providers : [];
  return {
    linked: true,
    override:
      o && typeof o === 'object' && o.provider
        ? {
            provider: String(o.provider),
            model: String(o.model || ''),
            remainingRequests: Number(r.override_remaining_requests || 0),
            setBy: o.set_by ? String(o.set_by) : null,
            setAt: o.set_at ? String(o.set_at) : null,
          }
        : null,
    fallbackChain: Array.isArray(r.fallback_chain) ? r.fallback_chain.map(String) : [],
    providers: list
      .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object')
      .map((p) => ({
        id: String(p.id || p.name || ''),
        status: String(p.status || 'unknown'),
        latencyMs: Number(p.latency_ms || 0),
        models: Array.isArray(p.models) ? p.models.map(String) : [],
      }))
      .filter((p) => p.id),
  };
}

export async function handleAdminModelRouterRoute(
  path: string,
  request: Request,
  env: Env,
  audit: { details?: string },
  fetchImpl: typeof fetch = fetch
): Promise<Response | null> {
  if (path !== '/api/admin/model-router' && path !== '/api/admin/model-router/override') {
    return null;
  }
  const method = request.method.toUpperCase();
  const reply = (body: Record<string, unknown>, status = 200) =>
    jsonEdgeResponse(body, status, request);
  const failWith = (result: Extract<CoreCallResult, { ok: false }>) => {
    const f = describeCoreFailure(result);
    return reply(
      {
        success: false,
        linked: f.linked,
        error: f.error,
        ...(f.notWired ? { notWired: true } : {}),
      },
      f.status
    );
  };

  if (path === '/api/admin/model-router') {
    if (method !== 'GET') return reply({ success: false, error: 'Method not allowed.' }, 405);
    const [router, providers] = await Promise.all([
      callCoreAdmin(env, 'GET', '/api/admin/llm/router', undefined, { fetchImpl }),
      callCoreAdmin(env, 'GET', '/api/admin/llm/providers', undefined, { fetchImpl }),
    ]);
    if (!router.ok) return failWith(router);
    const state = normalizeRouterState(router.data, providers.ok ? providers.data : []);
    if (!providers.ok) state.providersError = describeCoreFailure(providers).error;
    return reply({ success: true, ...state });
  }

  if (method === 'DELETE') {
    const res = await callCoreAdmin(env, 'DELETE', '/api/admin/llm/router/override', undefined, {
      fetchImpl,
    });
    if (!res.ok) return failWith(res);
    audit.details = 'model override cleared';
    return reply({ success: true, cleared: Boolean((res.data as { cleared?: unknown })?.cleared) });
  }

  if (method !== 'POST') return reply({ success: false, error: 'Method not allowed.' }, 405);
  const body = ((await request.json().catch(() => null)) || {}) as Record<string, unknown>;
  const provider = String(body.provider || '').trim();
  const model = String(body.model || '').trim();
  const remainingRaw = body.remainingRequests ?? 0;
  const remaining = Number(remainingRaw);
  if (!PROVIDER_RE.test(provider)) {
    return reply({ success: false, error: 'A valid provider is required.' }, 400);
  }
  if (model && (!model.startsWith(`${provider}/`) || model.length > 200)) {
    return reply({ success: false, error: `Model must belong to ${provider}.` }, 400);
  }
  if (!Number.isInteger(remaining) || remaining < 0 || remaining > MAX_REMAINING) {
    return reply(
      { success: false, error: `remainingRequests must be 0–${MAX_REMAINING} (0 = until off).` },
      400
    );
  }
  const res = await callCoreAdmin(
    env,
    'POST',
    '/api/admin/llm/router/override',
    { provider, model: model || null, remaining_requests: remaining || null },
    { fetchImpl }
  );
  if (!res.ok) return failWith(res);
  audit.details = `model override → ${model || provider}${remaining ? ` for ${remaining} requests` : ' until off'}`;
  return reply({ success: true, provider, model: model || null, remainingRequests: remaining });
}
