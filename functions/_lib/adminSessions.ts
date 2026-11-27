/**
 * বাংলা মন্তব্য: Admin → Users → Sessions — আসল সাইন-ইন সেশন (Supabase auth.sessions)।
 *
 * auth স্কিমা PostgREST-এ খোলা নেই, তাই service_role-only RPC ব্যবহার হয়
 * (migration 20261127150828_admin_auth_sessions)। মরা সেশন pg_cron প্রতিরাতে নিজেই মুছে দেয় —
 * এখানে শুধু জীবিত সেশন দেখা আর দরকার হলে সাইন-আউট করা।
 *
 * - GET  /api/admin/sessions          → { users: [...], summary }
 * - POST /api/admin/sessions/revoke   → { userId, sessionId? }  (sessionId না দিলে = সব ডিভাইস)
 */

import { jsonEdgeResponse } from './edgeHelpers';
import { resolveSupabaseAdmin } from './adminRealData';
import { ownerEmails } from './adminTeam';

type Env = Record<string, string | undefined> | undefined;

const TIMEOUT_MS = 8000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SessionClient = 'studio-server' | 'cli' | 'browser' | 'unknown';

export interface AdminSession {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  client: SessionClient;
  /** Browser/OS label, only when the session was created directly by a browser. */
  device: string | null;
  /** Only for direct browser sessions — for server-made sign-ins it is the server's IP. */
  ip: string | null;
  mfa: boolean;
  current: boolean;
}

export interface AdminSessionUser {
  userId: string;
  email: string;
  isOwner: boolean;
  isSelf: boolean;
  sessions: AdminSession[];
}

export interface AdminSessionsSummary {
  liveSessions: number;
  usersOnline: number;
  /** Sessions that can never renew; pg_cron removes them nightly. */
  pendingCleanup: number;
}

interface RpcSessionRow {
  session_id?: string;
  user_id?: string;
  email?: string | null;
  created_at?: string;
  last_active_at?: string;
  user_agent?: string | null;
  ip?: string | null;
  aal?: string | null;
  live?: boolean;
}

export function classifyClient(userAgent: string | null | undefined): {
  client: SessionClient;
  device: string | null;
} {
  const ua = String(userAgent || '');
  if (!ua) return { client: 'unknown', device: null };
  if (/python-httpx|python-requests|aiohttp|node-fetch|undici|okhttp/i.test(ua)) {
    return { client: 'studio-server', device: null };
  }
  if (/^curl\/|wget|httpie|postman/i.test(ua)) return { client: 'cli', device: null };
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  if (!browser && !os) return { client: 'unknown', device: null };
  return { client: 'browser', device: [browser, os].filter(Boolean).join(' · ') };
}

/** `session_id` claim of the caller's (already upstream-verified) Supabase JWT — display only. */
export function currentSessionId(request: Request): string | null {
  const auth = (request.headers.get('Authorization') || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const sid = (JSON.parse(json) as { session_id?: unknown }).session_id;
    return typeof sid === 'string' && UUID_RE.test(sid) ? sid : null;
  } catch {
    return null;
  }
}

export function groupSessions(
  rows: RpcSessionRow[],
  opts: { owners: Set<string>; actor: string; currentSessionId: string | null }
): { users: AdminSessionUser[]; summary: AdminSessionsSummary } {
  const byUser = new Map<string, AdminSessionUser>();
  let pendingCleanup = 0;
  const actor = opts.actor.toLowerCase();
  for (const row of rows) {
    const userId = String(row.user_id || '');
    const id = String(row.session_id || '');
    if (!UUID_RE.test(userId) || !UUID_RE.test(id)) continue;
    if (!row.live) {
      pendingCleanup += 1;
      continue;
    }
    const email = String(row.email || '').toLowerCase();
    let user = byUser.get(userId);
    if (!user) {
      user = {
        userId,
        email,
        isOwner: Boolean(email) && opts.owners.has(email),
        isSelf: Boolean(email) && email === actor,
        sessions: [],
      };
      byUser.set(userId, user);
    }
    const { client, device } = classifyClient(row.user_agent);
    user.sessions.push({
      id,
      createdAt: String(row.created_at || ''),
      lastActiveAt: String(row.last_active_at || row.created_at || ''),
      client,
      device,
      ip: client === 'browser' ? row.ip || null : null,
      mfa: row.aal === 'aal2',
      current: id === opts.currentSessionId,
    });
  }
  const users = [...byUser.values()].sort(
    (a, b) =>
      Number(b.isSelf) - Number(a.isSelf) ||
      (b.sessions[0]?.lastActiveAt || '').localeCompare(a.sessions[0]?.lastActiveAt || '')
  );
  return {
    users,
    summary: {
      liveSessions: users.reduce((n, u) => n + u.sessions.length, 0),
      usersOnline: users.length,
      pendingCleanup,
    },
  };
}

async function rpc(
  env: Env,
  fn: string,
  args: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const cfg = resolveSupabaseAdmin(env)!;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${cfg.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { ok: false, status: 504, data: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleAdminSessionsRoute(
  path: string,
  request: Request,
  env: Env,
  audit: { actor: string; details?: string },
  fetchImpl: typeof fetch = fetch
): Promise<Response | null> {
  if (path !== '/api/admin/sessions' && path !== '/api/admin/sessions/revoke') return null;
  const reply = (body: Record<string, unknown>, status = 200) =>
    jsonEdgeResponse(body, status, request);
  const fail = (status: number, error: string) => reply({ success: false, error }, status);
  if (!resolveSupabaseAdmin(env)) {
    return fail(503, 'Session store not linked (Supabase service key missing).');
  }
  const method = request.method.toUpperCase();

  const load = async () => {
    const res = await rpc(env, 'admin_list_auth_sessions', { p_limit: 1000 }, fetchImpl);
    if (!res.ok || !Array.isArray(res.data)) return null;
    return groupSessions(res.data as RpcSessionRow[], {
      owners: ownerEmails(env),
      actor: audit.actor || '',
      currentSessionId: currentSessionId(request),
    });
  };

  if (path === '/api/admin/sessions') {
    if (method !== 'GET') return fail(405, 'Method not allowed.');
    const grouped = await load();
    if (!grouped) return fail(502, 'Could not read sessions from Supabase.');
    return reply({ success: true, ...grouped });
  }

  if (method !== 'POST') return fail(405, 'Method not allowed.');
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const userId = String(body.userId || '');
  const sessionId = body.sessionId == null ? null : String(body.sessionId);
  if (!UUID_RE.test(userId)) return fail(400, 'Invalid user id.');
  if (sessionId !== null && !UUID_RE.test(sessionId)) return fail(400, 'Invalid session id.');

  const grouped = await load();
  if (!grouped) return fail(502, 'Could not read sessions from Supabase.');
  const target = grouped.users.find((u) => u.userId === userId);
  if (!target) return fail(404, 'No active sessions for this user.');
  if (sessionId && !target.sessions.some((s) => s.id === sessionId)) {
    return fail(404, 'Session not found (it may already be signed out).');
  }
  const current = target.sessions.find((s) => s.current);
  if (current && (sessionId === null || sessionId === current.id)) {
    return fail(409, 'That would sign you out here — use Sign out in your account menu instead.');
  }
  const actorIsOwner = ownerEmails(env).has((audit.actor || '').toLowerCase());
  if (target.isOwner && !target.isSelf && !actorIsOwner) {
    return fail(409, 'Only an owner can sign out an owner.');
  }

  const res = await rpc(
    env,
    'admin_revoke_auth_sessions',
    { p_user_id: userId, p_session_id: sessionId },
    fetchImpl
  );
  if (!res.ok) return fail(502, `Sign-out failed (HTTP ${res.status}).`);
  const revoked = Number(res.data) || 0;
  audit.details = sessionId
    ? `signed out 1 session of ${target.email || userId}`
    : `signed out all ${revoked} sessions of ${target.email || userId}`;
  return reply({ success: true, revoked });
}
