/**
 * বাংলা মন্তব্য: Admin → FinOps — আসল, বলবৎ সীমা (core/finops/guard.py)।
 *
 * core প্রতিটি চ্যাট স্ট্রিমের আগে এই সীমাগুলো যাচাই করে (ইউজার/মিনিট, ইউজারের দৈনিক টোকেন,
 * প্ল্যাটফর্মের দৈনিক টোকেন) এবং স্ট্রিম শেষে আনুমানিক টোকেন গোনে। সেটিংস Supabase
 * `finops_settings`-এ — core লেখে, ৬০ সেকেন্ডের মধ্যে কার্যকর।
 *
 * - GET /api/admin/finops → { settings, usage }
 * - PUT /api/admin/finops → { enforce?, userDailyTokens?, userRpm?, globalDailyTokens? }
 */

import { jsonEdgeResponse } from './edgeHelpers';
import { callCoreAdmin, describeCoreFailure, type CoreCallResult } from './coreAdminBridge';

type Env = Record<string, string | undefined> | undefined;

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

export const FINOPS_LIMITS = {
  userDailyTokens: [0, 50_000_000],
  userRpm: [0, 10_000],
  globalDailyTokens: [0, 5_000_000_000],
} as const;

const SNAKE: Record<keyof typeof FINOPS_LIMITS, string> = {
  userDailyTokens: 'user_daily_tokens',
  userRpm: 'user_rpm',
  globalDailyTokens: 'global_daily_tokens',
};

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

export function normalizeFinOps(data: unknown): { settings: FinOpsSettings; usage: FinOpsUsage } {
  const root = asRecord(data);
  const s = asRecord(root.settings);
  const u = asRecord(root.usage);
  const top = Array.isArray(u.topUsers) ? u.topUsers : [];
  return {
    settings: {
      enforce: s.enforce !== false,
      userDailyTokens: Number(s.user_daily_tokens) || 0,
      userRpm: Number(s.user_rpm) || 0,
      globalDailyTokens: Number(s.global_daily_tokens) || 0,
      updatedBy: s.updated_by ? String(s.updated_by) : null,
      updatedAt: s.updated_at ? String(s.updated_at) : null,
    },
    usage: {
      available: u.available === true,
      date: String(u.date || ''),
      globalTokens: Number(u.globalTokens) || 0,
      topUsers: top
        .map(asRecord)
        .map((r) => ({ userId: String(r.userId || ''), tokens: Number(r.tokens) || 0 }))
        .filter((r) => r.userId),
    },
  };
}

/** Validate a camelCase patch → snake_case body for core, or an error message. */
export function buildFinOpsUpdate(
  body: Record<string, unknown>
): { ok: true; update: Record<string, unknown>; summary: string } | { ok: false; error: string } {
  const update: Record<string, unknown> = {};
  const parts: string[] = [];
  if ('enforce' in body) {
    if (typeof body.enforce !== 'boolean')
      return { ok: false, error: 'enforce must be true/false.' };
    update.enforce = body.enforce;
    parts.push(`enforce=${body.enforce}`);
  }
  for (const key of Object.keys(FINOPS_LIMITS) as (keyof typeof FINOPS_LIMITS)[]) {
    if (!(key in body)) continue;
    const value = body[key];
    const [lo, hi] = FINOPS_LIMITS[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < lo || value > hi) {
      return { ok: false, error: `${key} must be an integer ${lo}–${hi} (0 = off).` };
    }
    update[SNAKE[key]] = value;
    parts.push(`${key}=${value}`);
  }
  if (parts.length === 0) return { ok: false, error: 'Nothing to update.' };
  return { ok: true, update, summary: parts.join(', ') };
}

export async function handleAdminFinOpsRoute(
  path: string,
  request: Request,
  env: Env,
  audit: { details?: string; actor?: string },
  fetchImpl: typeof fetch = fetch
): Promise<Response | null> {
  if (path !== '/api/admin/finops') return null;
  const method = request.method.toUpperCase();
  const reply = (body: Record<string, unknown>, status = 200) =>
    jsonEdgeResponse(body, status, request);
  const failWith = (result: Extract<CoreCallResult, { ok: false }>) => {
    const f = describeCoreFailure(result);
    const detail = asRecord(result.data).detail;
    return reply(
      {
        success: false,
        linked: f.linked,
        error: typeof detail === 'string' && result.status === 400 ? detail : f.error,
        ...(f.notWired ? { notWired: true } : {}),
      },
      result.status === 400 ? 400 : f.status
    );
  };

  if (method === 'GET') {
    const res = await callCoreAdmin(env, 'GET', '/api/admin/llm/finops', undefined, { fetchImpl });
    if (!res.ok) return failWith(res);
    return reply({ success: true, ...normalizeFinOps(res.data) });
  }

  if (method !== 'PUT') return reply({ success: false, error: 'Method not allowed.' }, 405);
  const body = asRecord(await request.json().catch(() => null));
  const built = buildFinOpsUpdate(body);
  if (!built.ok) return reply({ success: false, error: built.error }, 400);
  const res = await callCoreAdmin(
    env,
    'PUT',
    '/api/admin/llm/finops',
    { ...built.update, updated_by: audit.actor || 'admin' },
    { fetchImpl }
  );
  if (!res.ok) return failWith(res);
  audit.details = `finops limits → ${built.summary}`;
  return reply({ success: true, settings: normalizeFinOps(res.data).settings });
}
