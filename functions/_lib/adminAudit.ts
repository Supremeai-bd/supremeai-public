/**
 * Server-side audit trail for every admin write that passes through the edge.
 *
 * বাংলা মন্তব্য (Admin Step 1): ব্রাউজার থেকে আসা প্রতিটি অ্যাডমিন write (POST/PUT/PATCH/
 * DELETE) — সফল, ব্যর্থ বা প্রত্যাখ্যাত — Supabase `audit_logs`-এ এক সারি হিসেবে লেখা হয়।
 * ক্লায়েন্ট-সাইড লগিং নয়, তাই কেউ UI এড়িয়ে সরাসরি API ডাকলেও রেকর্ড থাকে। রিকোয়েস্ট
 * বডি কখনো লগ হয় না (তাতে API key/পাসকি থাকতে পারে)। অডিট লিখতে না পারলেও আসল
 * অ্যাকশন আটকায় না — তবে ব্যর্থতা console-এ জোরে লগ হয়।
 */
import { jsonEdgeResponse, type PagesContext } from './edgeHelpers';
import { resolveSupabaseAdmin } from './adminRealData';

type Env = Record<string, string | undefined> | undefined;

export const ADMIN_AUDIT_ACTION_TYPE = 'admin_action';
const AUDITABLE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUDIT_WRITE_TIMEOUT_MS = 2500;
const MAX_ERROR_LENGTH = 300;

export interface AdminAuditContext {
  /** Who performed the action — admin email, `admin-key`, or `anonymous`. */
  actor: string;
  /** Set by the handler for public (non-admin) requests that should not be audited. */
  skip?: boolean;
}

export interface AdminAuditEntry {
  method: string;
  path: string;
  actor: string;
  httpStatus: number;
  latencyMs: number;
  ip?: string;
  errorMessage?: string;
  dryRun?: boolean;
}

export type AdminAuditStatus = 'success' | 'failure' | 'denied';

export function isAuditableMethod(method: string): boolean {
  return AUDITABLE_METHODS.has(method.toUpperCase());
}

export function auditStatusFor(httpStatus: number): AdminAuditStatus {
  if (httpStatus === 401 || httpStatus === 403) return 'denied';
  return httpStatus >= 200 && httpStatus < 400 ? 'success' : 'failure';
}

/** Maps an entry onto the existing `public.audit_logs` columns. */
export function buildAuditRow(entry: AdminAuditEntry): Record<string, unknown> {
  const method = entry.method.toUpperCase();
  return {
    action: `${method} ${entry.path}`,
    action_type: ADMIN_AUDIT_ACTION_TYPE,
    tool_id: 'edge-admin',
    actor: entry.actor || 'anonymous',
    resource: entry.path,
    status: auditStatusFor(entry.httpStatus),
    error_message: entry.errorMessage ? entry.errorMessage.slice(0, MAX_ERROR_LENGTH) : null,
    latency_ms: Math.max(0, Math.round(entry.latencyMs)),
    ip_address: entry.ip || null,
    metadata: {
      method,
      httpStatus: entry.httpStatus,
      ...(entry.dryRun ? { dryRun: true } : {}),
    },
  };
}

export async function recordAdminAudit(
  env: Env,
  entry: AdminAuditEntry,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  const cfg = resolveSupabaseAdmin(env);
  if (!cfg) {
    console.error('[admin-audit] Supabase service credentials missing; audit row NOT written.');
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUDIT_WRITE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${cfg.url}/rest/v1/audit_logs`, {
      method: 'POST',
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(buildAuditRow(entry)),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[admin-audit] write failed with HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[admin-audit] write threw', err instanceof Error ? err.message : err);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function readErrorMessage(response: Response): Promise<string | undefined> {
  if (response.status < 400) return undefined;
  try {
    const data = (await response.clone().json()) as { error?: unknown; detail?: unknown };
    const msg = data?.error ?? data?.detail;
    return typeof msg === 'string' ? msg : undefined;
  } catch {
    return undefined;
  }
}

function isDryRunRequest(url: URL, request: Request): boolean {
  return (
    url.searchParams.get('dryRun') === 'true' ||
    (request.headers.get('X-Dry-Run') || '').toLowerCase() === 'true'
  );
}

/**
 * Runs an admin handler and records an audit row for write methods. The row is written via
 * `waitUntil` when the runtime offers it, otherwise awaited (bounded by a short timeout).
 */
export async function withAdminAudit(
  context: PagesContext,
  handler: (audit: AdminAuditContext) => Promise<Response>,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const { request, env } = context;
  const audit: AdminAuditContext = { actor: 'anonymous' };
  const startedAt = Date.now();
  const response = await handler(audit);

  if (audit.skip || !isAuditableMethod(request.method)) return response;

  const url = new URL(request.url);
  const entry: AdminAuditEntry = {
    method: request.method,
    path: url.pathname,
    actor: audit.actor,
    httpStatus: response.status,
    latencyMs: Date.now() - startedAt,
    ip: request.headers.get('CF-Connecting-IP') || undefined,
    errorMessage: await readErrorMessage(response),
    dryRun: isDryRunRequest(url, request),
  };
  const pending = recordAdminAudit(env, entry, fetchImpl);
  if (typeof context.waitUntil === 'function') context.waitUntil(pending);
  else await pending;
  return response;
}

export interface AdminAuditLogRow {
  id: number | string;
  created_at: string;
  actor: string | null;
  action: string;
  resource: string | null;
  status: string | null;
  error_message: string | null;
  latency_ms: number | null;
  ip_address: string | null;
  metadata: { httpStatus?: number; dryRun?: boolean } | null;
}

/** Same shape as the frontend `SystemAuditRecord` (Audit Trail tab). */
export interface EdgeSystemAuditRecord {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  details: string;
  ipAddress: string;
}

export function toSystemAuditRecord(row: AdminAuditLogRow): EdgeSystemAuditRecord {
  const parts = [row.status || 'unknown'];
  if (row.metadata?.httpStatus) parts.push(`HTTP ${row.metadata.httpStatus}`);
  if (typeof row.latency_ms === 'number') parts.push(`${row.latency_ms} ms`);
  if (row.metadata?.dryRun) parts.push('dry-run');
  const summary = parts.join(' · ');
  return {
    id: `audit_${row.id}`,
    timestamp: row.created_at,
    actor: row.actor || 'anonymous',
    action: row.action,
    resource: row.resource || '',
    details: row.error_message ? `${summary} — ${row.error_message}` : summary,
    ipAddress: row.ip_address || '',
  };
}

/** GET /api/admin/audit — newest admin actions from Supabase `audit_logs`. */
export async function handleAdminAuditLogRoute(
  path: string,
  request: Request,
  env: Env,
  fetchImpl: typeof fetch = fetch
): Promise<Response | null> {
  if (path !== '/api/admin/audit' || request.method !== 'GET') return null;
  const cfg = resolveSupabaseAdmin(env);
  if (!cfg) {
    return jsonEdgeResponse(
      {
        auditRecords: [],
        linked: false,
        error: 'Audit store not linked (Supabase service key missing).',
      },
      503,
      request
    );
  }
  const limitRaw = Number(new URL(request.url).searchParams.get('limit') || 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 100;
  const query =
    `select=id,created_at,actor,action,resource,status,error_message,latency_ms,ip_address,metadata` +
    `&action_type=eq.${ADMIN_AUDIT_ACTION_TYPE}&order=created_at.desc&limit=${limit}`;
  try {
    const res = await fetchImpl(`${cfg.url}/rest/v1/audit_logs?${query}`, {
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      return jsonEdgeResponse(
        { auditRecords: [], linked: true, error: `Audit store returned HTTP ${res.status}.` },
        502,
        request
      );
    }
    const rows = (await res.json().catch(() => [])) as AdminAuditLogRow[];
    return jsonEdgeResponse(
      { auditRecords: (Array.isArray(rows) ? rows : []).map(toSystemAuditRecord), linked: true },
      200,
      request
    );
  } catch {
    return jsonEdgeResponse(
      { auditRecords: [], linked: true, error: 'Audit store unreachable.' },
      502,
      request
    );
  }
}
