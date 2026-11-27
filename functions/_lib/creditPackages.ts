/**
 * বাংলা মন্তব্য: "Boost my limit" → Part 2 (Paid) — প্ল্যান ও ক্রেডিট প্যাকেজ।
 *
 * নাম / ক্রেডিট লিমিট / দাম কোডে হার্ডকোড নয় — `public.credit_packages` টেবিলে থাকে
 * (migration 20261127184211_credit_packages) আর অ্যাডমিন ড্যাশবোর্ড থেকে যোগ/এডিট/মুছে ফেলা যায়।
 *
 * Public (no login needed — the paid section is visible to guests too):
 *   GET    /api/packages                      → only active packages, sorted
 *
 * Admin routes (behind admin auth in functions/api/admin/[[path]].ts):
 *   GET    /api/admin/packages                → all packages, including hidden ones
 *   POST   /api/admin/packages                { kind, name, credits, priceUsd, ... }
 *   PATCH  /api/admin/packages/:id            any subset of the same fields
 *   DELETE /api/admin/packages/:id
 */

import { jsonEdgeResponse } from './edgeHelpers';
import { resolveSupabaseAdmin } from './adminRealData';

type Env = Record<string, string | undefined> | undefined;

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

const TIMEOUT_MS = 8000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set<PackageKind>(['plan', 'topup']);
const PERIODS = new Set<BillingPeriod>(['one_time', 'monthly', 'yearly']);
const MAX_CREDITS = 1_000_000_000_000;
const MAX_PRICE = 100_000;
const COLS =
  'id,kind,name,description,credits,price_usd,billing_period,badge,sort_order,active,updated_at';

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

export function mapPackage(row: unknown): CreditPackage {
  const r = asRecord(row);
  return {
    id: String(r.id || ''),
    kind: (KINDS.has(r.kind as PackageKind) ? r.kind : 'topup') as PackageKind,
    name: String(r.name || ''),
    description: r.description ? String(r.description) : null,
    credits: Number(r.credits) || 0,
    priceUsd: Number(r.price_usd) || 0,
    billingPeriod: (PERIODS.has(r.billing_period as BillingPeriod)
      ? r.billing_period
      : 'one_time') as BillingPeriod,
    badge: r.badge ? String(r.badge) : null,
    sortOrder: Number.isFinite(Number(r.sort_order)) ? Number(r.sort_order) : 100,
    active: r.active !== false,
    updatedAt: r.updated_at ? String(r.updated_at) : null,
  };
}

/**
 * Validates an admin create/patch body and converts it to DB column names.
 * `partial` = PATCH (every field optional, at least one required).
 */
export function buildPackageRow(
  body: Record<string, unknown>,
  partial: boolean
): { ok: true; row: Record<string, unknown>; summary: string } | { ok: false; error: string } {
  const row: Record<string, unknown> = {};
  const has = (k: string) => body[k] !== undefined;
  const changes: string[] = [];

  if (has('kind') || !partial) {
    const kind = (body.kind ?? 'topup') as PackageKind;
    if (!KINDS.has(kind)) return { ok: false, error: 'Type must be "plan" or "topup".' };
    row.kind = kind;
    changes.push(`kind=${kind}`);
  }
  if (has('name') || !partial) {
    const name = String(body.name ?? '').trim();
    if (!name || name.length > 60)
      return { ok: false, error: 'Name is required (max 60 characters).' };
    row.name = name;
    changes.push(`name="${name}"`);
  }
  if (has('description')) {
    const description = String(body.description ?? '').trim();
    if (description.length > 240) return { ok: false, error: 'Description is too long (max 240).' };
    row.description = description || null;
    changes.push('description');
  }
  if (has('credits') || !partial) {
    const credits = Number(body.credits);
    if (!Number.isInteger(credits) || credits <= 0 || credits > MAX_CREDITS) {
      return { ok: false, error: 'Credit limit must be a whole number above 0.' };
    }
    row.credits = credits;
    changes.push(`credits=${credits}`);
  }
  if (has('priceUsd') || !partial) {
    const price = Number(body.priceUsd);
    if (!Number.isFinite(price) || price < 0 || price > MAX_PRICE) {
      return { ok: false, error: `Price must be between 0 and ${MAX_PRICE} USD.` };
    }
    row.price_usd = Math.round(price * 100) / 100;
    changes.push(`price=$${row.price_usd}`);
  }
  if (has('billingPeriod') || !partial) {
    const period = (body.billingPeriod ??
      (row.kind === 'plan' ? 'monthly' : 'one_time')) as BillingPeriod;
    if (!PERIODS.has(period)) return { ok: false, error: 'Unknown billing period.' };
    row.billing_period = period;
    changes.push(`period=${period}`);
  }
  if (has('badge')) {
    const badge = String(body.badge ?? '').trim();
    if (badge.length > 24) return { ok: false, error: 'Badge is too long (max 24).' };
    row.badge = badge || null;
    changes.push(`badge=${badge || 'none'}`);
  }
  if (has('sortOrder')) {
    const sort = Number(body.sortOrder);
    if (!Number.isInteger(sort) || Math.abs(sort) > 100_000) {
      return { ok: false, error: 'Order must be a whole number.' };
    }
    row.sort_order = sort;
    changes.push(`order=${sort}`);
  }
  if (has('active')) {
    if (typeof body.active !== 'boolean') return { ok: false, error: 'Visible must be on or off.' };
    row.active = body.active;
    changes.push(body.active ? 'visible' : 'hidden');
  }
  if (partial && Object.keys(row).length === 0) return { ok: false, error: 'Nothing to update.' };
  return { ok: true, row, summary: changes.join(', ') };
}

async function db(
  env: Env,
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const cfg = resolveSupabaseAdmin(env)!;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${cfg.url}/rest/v1/${path}`, {
      method: init.method || 'GET',
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(init.prefer ? { Prefer: init.prefer } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { ok: false, status: 504, data: null };
  } finally {
    clearTimeout(timer);
  }
}

const ORDER = 'order=kind.asc,sort_order.asc,price_usd.asc';

/** Public list for the "Boost my limit" paid section. Never cached by the browser for long. */
export async function handlePublicPackagesRoute(
  path: string,
  request: Request,
  env: Env,
  fetchImpl: typeof fetch = fetch
): Promise<Response | null> {
  if (path !== '/api/packages') return null;
  const reply = (body: Record<string, unknown>, status = 200) =>
    jsonEdgeResponse(body, status, request);
  if (request.method.toUpperCase() !== 'GET') {
    return reply({ success: false, error: 'Method not allowed.' }, 405);
  }
  if (!resolveSupabaseAdmin(env)) {
    return reply({ success: false, error: 'Package store not linked.' }, 503);
  }
  const res = await db(
    env,
    `credit_packages?select=${COLS}&active=is.true&${ORDER}`,
    {},
    fetchImpl
  );
  if (!res.ok) return reply({ success: false, error: 'Could not read packages.' }, 502);
  return reply({
    success: true,
    packages: (Array.isArray(res.data) ? res.data : []).map(mapPackage),
  });
}

export async function handleAdminPackagesRoute(
  path: string,
  request: Request,
  env: Env,
  audit: { actor: string; details?: string },
  fetchImpl: typeof fetch = fetch
): Promise<Response | null> {
  if (path !== '/api/admin/packages' && !path.startsWith('/api/admin/packages/')) return null;
  const reply = (body: Record<string, unknown>, status = 200) =>
    jsonEdgeResponse(body, status, request);
  const fail = (status: number, error: string) => reply({ success: false, error }, status);
  if (!resolveSupabaseAdmin(env)) {
    return fail(503, 'Package store not linked (Supabase service key missing).');
  }
  const method = request.method.toUpperCase();
  const body = ['POST', 'PATCH'].includes(method)
    ? asRecord(await request.json().catch(() => null))
    : {};

  if (path === '/api/admin/packages') {
    if (method === 'GET') {
      const res = await db(env, `credit_packages?select=${COLS}&${ORDER}`, {}, fetchImpl);
      if (!res.ok) return fail(502, 'Could not read packages from Supabase.');
      return reply({
        success: true,
        packages: (Array.isArray(res.data) ? res.data : []).map(mapPackage),
      });
    }
    if (method === 'POST') {
      const built = buildPackageRow(body, false);
      if (!built.ok) return fail(400, built.error);
      const res = await db(
        env,
        `credit_packages?select=${COLS}`,
        {
          method: 'POST',
          body: { ...built.row, updated_by: audit.actor || 'admin' },
          prefer: 'return=representation',
        },
        fetchImpl
      );
      if (!res.ok || !Array.isArray(res.data) || !res.data[0]) {
        return fail(502, 'Could not save the package.');
      }
      audit.details = `package added: ${built.summary}`;
      return reply({ success: true, package: mapPackage(res.data[0]) }, 201);
    }
    return fail(405, 'Method not allowed.');
  }

  const id = path.slice('/api/admin/packages/'.length);
  if (!UUID_RE.test(id)) return fail(404, 'Package not found.');

  if (method === 'PATCH') {
    const built = buildPackageRow(body, true);
    if (!built.ok) return fail(400, built.error);
    const res = await db(
      env,
      `credit_packages?id=eq.${id}&select=${COLS}`,
      {
        method: 'PATCH',
        body: { ...built.row, updated_by: audit.actor || 'admin' },
        prefer: 'return=representation',
      },
      fetchImpl
    );
    if (!res.ok) return fail(502, 'Could not update the package.');
    if (!Array.isArray(res.data) || !res.data[0]) return fail(404, 'Package not found.');
    const saved = mapPackage(res.data[0]);
    audit.details = `package "${saved.name}" updated: ${built.summary}`;
    return reply({ success: true, package: saved });
  }

  if (method === 'DELETE') {
    const res = await db(
      env,
      `credit_packages?id=eq.${id}&select=id,name`,
      { method: 'DELETE', prefer: 'return=representation' },
      fetchImpl
    );
    if (!res.ok) return fail(502, 'Could not remove the package.');
    if (!Array.isArray(res.data) || !res.data[0]) return fail(404, 'Package not found.');
    audit.details = `package removed: "${String(asRecord(res.data[0]).name || id)}"`;
    return reply({ success: true });
  }

  return fail(405, 'Method not allowed.');
}
