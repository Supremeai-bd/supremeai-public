/**
 * বাংলা মন্তব্য: Team & Members + Team chat (রোডম্যাপ 4.4) — edge হ্যান্ডলার।
 *
 * - রোস্টার এখন Supabase `public.team_members`-এ (আগে upstream preferences blob-এ ছিল,
 *   যেটা ফাঁকা ছিল এবং অন্য কেউ পড়তে পারত না)।
 * - চ্যাট নতুন ইঞ্জিন নয়: একই `conversations`/`messages` টেবিল, `channel_type = 'team'`।
 * - ব্রাউজারের কাছে Supabase JWT নেই (core নিজের JWT দেয়), তাই পরিচয় যাচাই হয়
 *   `verifyUpstreamSession` দিয়ে, আর ডেটা পড়া/লেখা service-role দিয়ে — সদস্যপদের
 *   আসল চেক DB-র SECURITY DEFINER RPC-র ভেতরে (`team_access`)।
 *
 * Routes (prefix `/api/user/team`):
 *   GET    /                       → own roster (owner first)
 *   POST   /            {email, name?, role}
 *   PATCH  /:memberId   {role}
 *   DELETE /:memberId
 *   GET    /chat                   → teams I can chat in
 *   GET    /chat/:ownerId?after=&limit=
 *   POST   /chat/:ownerId {content}
 */

import { jsonEdgeResponse, type UpstreamSessionVerification } from './edgeHelpers';
import { resolveSupabaseAdmin } from './adminRealData';

type Env = Record<string, string | undefined> | undefined;

export type TeamRole = 'Owner' | 'Developer' | 'Reviewer' | 'Viewer';
export type MemberRole = Exclude<TeamRole, 'Owner'>;

export interface TeamMemberDto {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: TeamRole;
  joinedDate: string;
  twoFactorEnabled: boolean;
  status: 'active' | 'invited';
}

export interface TeamDeps {
  fetchImpl?: typeof fetch;
  verify: (request: Request) => Promise<UpstreamSessionVerification>;
}

/** Owner counts as one seat. */
export const MAX_SEATS = 10;
const MEMBER_ROLES = new Set<MemberRole>(['Developer', 'Reviewer', 'Viewer']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_MESSAGE_CHARS = 4000;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function displayNameFor(name: unknown, email: string): string {
  const clean = String(name || '').trim();
  if (clean) return clean.slice(0, 80);
  const local = email.split('@')[0] || 'Member';
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function dateOnly(value: unknown): string {
  const s = String(value || '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

/** RPC `team_roster` JSON → the `TeamMember[]` shape the UI already renders. */
export function mapRoster(raw: unknown): TeamMemberDto[] {
  const data = asRecord(raw);
  const out: TeamMemberDto[] = [];
  const owner = asRecord(data.owner);
  if (owner.id) {
    const email = String(owner.email || '');
    const name = displayNameFor(owner.name, email);
    out.push({
      id: String(owner.id),
      name,
      email,
      avatar: name.charAt(0).toUpperCase(),
      role: 'Owner',
      joinedDate: dateOnly(owner.createdAt),
      twoFactorEnabled: owner.mfa === true,
      status: 'active',
    });
  }
  for (const row of Array.isArray(data.members) ? data.members : []) {
    const m = asRecord(row);
    const email = String(m.email || '');
    const name = displayNameFor(m.name, email);
    out.push({
      id: String(m.id || ''),
      name,
      email,
      avatar: name.charAt(0).toUpperCase(),
      role: MEMBER_ROLES.has(m.role as MemberRole) ? (m.role as MemberRole) : 'Viewer',
      joinedDate: dateOnly(m.invitedAt),
      twoFactorEnabled: m.mfa === true,
      status: m.active === true ? 'active' : 'invited',
    });
  }
  return out;
}

/** Postgres errcodes raised by the team RPCs → HTTP status. */
export function statusForDbError(data: unknown, fallback: number): number {
  const code = String(asRecord(data).code || '');
  if (code === '42501') return 403;
  if (code === '22023') return 400;
  if (code === '54000') return 429;
  if (code === '23505') return 409;
  return fallback >= 500 || fallback === 0 ? 502 : fallback;
}

async function timedFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs = 6000
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type DbResult = { ok: boolean; status: number; data: unknown };

async function db(
  env: Env,
  fetchImpl: typeof fetch,
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {}
): Promise<DbResult> {
  const cfg = resolveSupabaseAdmin(env)!;
  const res = await timedFetch(fetchImpl, `${cfg.url}/rest/v1/${path}`, {
    method: init.method || 'GET',
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      Accept: 'application/json',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res) return { ok: false, status: 0, data: null };
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

const rpc = (env: Env, fetchImpl: typeof fetch, fn: string, args: Record<string, unknown>) =>
  db(env, fetchImpl, `rpc/${fn}`, { method: 'POST', body: args });

export async function handleUserTeamRequest(
  request: Request,
  env: Env,
  deps: TeamDeps
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const reply = (body: Record<string, unknown>, status = 200) =>
    jsonEdgeResponse(body, status, request);
  const fail = (status: number, error: string) => reply({ success: false, error }, status);
  const dbFail = (res: DbResult, fallback: string) => {
    const message = String(asRecord(res.data).message || '').slice(0, 200);
    const status = statusForDbError(res.data, res.status);
    return fail(status, status === 502 ? fallback : message || fallback);
  };

  const url = new URL(request.url);
  const segments = url.pathname
    .replace(/^\/api\/user\/team\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((s) => decodeURIComponent(s));
  const method = request.method.toUpperCase();

  const session = await deps.verify(request);
  if (session.unavailable) {
    return fail(503, 'Session check is temporarily unavailable. Please retry.');
  }
  const userId = String(session.user_id || '');
  if (!session.valid || session.isGuest) {
    return fail(401, 'Sign in to manage your team.');
  }
  // বাংলা মন্তব্য: সেশন বৈধ কিন্তু Supabase UUID নেই (যেমন RBAC অ্যাডমিন) — এটা 401 নয়,
  // তাহলে ক্লায়েন্ট ভুল করে সেশন কেটে দিত; 403 দিয়ে শুধু ফিচারটা বন্ধ থাকে।
  if (!UUID_RE.test(userId)) {
    return fail(403, 'Team features need a Supabase account.');
  }
  const myEmail = String(session.email || '').toLowerCase();
  if (!resolveSupabaseAdmin(env)) {
    return fail(503, 'Team store not linked (Supabase service key missing).');
  }

  const loadRoster = async (): Promise<TeamMemberDto[] | null> => {
    const res = await rpc(env, fetchImpl, 'team_roster', { p_owner: userId });
    return res.ok ? mapRoster(res.data) : null;
  };
  const rosterReply = async (extra: Record<string, unknown> = {}) => {
    const members = await loadRoster();
    if (!members) return fail(502, 'Could not read your team.');
    return reply({ ...extra, members, maxSeats: MAX_SEATS, tier: 'Pro', source: 'supabase' });
  };

  // ── Team chat ──────────────────────────────────────────────────────────────
  if (segments[0] === 'chat') {
    if (segments.length === 1) {
      if (method !== 'GET') return fail(405, 'Method not allowed.');
      const res = await rpc(env, fetchImpl, 'team_chat_rooms', { p_user: userId });
      if (!res.ok) return dbFail(res, 'Could not load team chats.');
      return reply({ success: true, rooms: Array.isArray(res.data) ? res.data : [] });
    }
    const ownerId = segments[1];
    if (segments.length !== 2 || !UUID_RE.test(ownerId)) return fail(404, 'Unknown team.');

    if (method === 'GET') {
      const afterRaw = url.searchParams.get('after');
      const after = afterRaw && !Number.isNaN(Date.parse(afterRaw)) ? afterRaw : null;
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      const res = await rpc(env, fetchImpl, 'team_chat_messages', {
        p_user: userId,
        p_owner: ownerId,
        p_after: after,
        p_limit: limit,
      });
      if (!res.ok) return dbFail(res, 'Could not load messages.');
      const data = asRecord(res.data);
      return reply({
        success: true,
        roomId: data.roomId ?? null,
        messages: Array.isArray(data.messages) ? data.messages : [],
      });
    }
    if (method === 'POST') {
      const body = asRecord(await request.json().catch(() => null));
      const content = String(body.content ?? '').trim();
      if (!content || content.length > MAX_MESSAGE_CHARS) {
        return fail(400, `Message must be 1-${MAX_MESSAGE_CHARS} characters.`);
      }
      const res = await rpc(env, fetchImpl, 'team_chat_post', {
        p_user: userId,
        p_owner: ownerId,
        p_content: content,
      });
      if (!res.ok) return dbFail(res, 'Could not send the message.');
      return reply({ success: true, message: res.data });
    }
    return fail(405, 'Method not allowed.');
  }

  // ── Roster ─────────────────────────────────────────────────────────────────
  if (segments.length === 0) {
    if (method === 'GET') return rosterReply();
    if (method !== 'POST') return fail(405, 'Method not allowed.');

    const body = asRecord(await request.json().catch(() => null));
    const email = String(body.email || '')
      .trim()
      .toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return fail(400, 'Valid email address is required.');
    }
    if (myEmail && email === myEmail) return fail(400, 'You are already the owner of this team.');
    const role = MEMBER_ROLES.has(body.role as MemberRole) ? (body.role as MemberRole) : null;
    if (!role) return fail(400, 'Role must be Developer, Reviewer or Viewer.');
    const name = String(body.name || '')
      .trim()
      .slice(0, 80);

    const current = await loadRoster();
    if (!current) return fail(502, 'Could not read your team.');
    const existing = current.find((m) => m.role !== 'Owner' && m.email === email);
    if (!existing && current.length >= MAX_SEATS) {
      return fail(409, `Seat limit reached (${MAX_SEATS} including you).`);
    }
    const res = await db(env, fetchImpl, 'team_members?on_conflict=team_owner_id,email', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: { team_owner_id: userId, email, role, display_name: name || null },
    });
    if (!res.ok) return dbFail(res, 'Could not save the invite.');
    const members = await loadRoster();
    if (!members) return fail(502, 'Could not read your team.');
    const member = members.find((m) => m.role !== 'Owner' && m.email === email);
    return reply({ success: true, member, members, maxSeats: MAX_SEATS });
  }

  const memberId = segments[0];
  if (segments.length !== 1 || !UUID_RE.test(memberId)) return fail(404, 'Unknown member.');
  const scope = `team_members?id=eq.${memberId}&team_owner_id=eq.${userId}`;

  if (method === 'PATCH') {
    const body = asRecord(await request.json().catch(() => null));
    const role = MEMBER_ROLES.has(body.role as MemberRole) ? (body.role as MemberRole) : null;
    if (!role) return fail(400, 'Role must be Developer, Reviewer or Viewer.');
    const res = await db(env, fetchImpl, scope, {
      method: 'PATCH',
      prefer: 'return=representation',
      body: { role },
    });
    if (!res.ok) return dbFail(res, 'Could not update the role.');
    if (!Array.isArray(res.data) || res.data.length === 0) return fail(404, 'Unknown member.');
    return rosterReply({ success: true });
  }
  if (method === 'DELETE') {
    const res = await db(env, fetchImpl, scope, {
      method: 'DELETE',
      prefer: 'return=representation',
    });
    if (!res.ok) return dbFail(res, 'Could not remove the member.');
    if (!Array.isArray(res.data) || res.data.length === 0) return fail(404, 'Unknown member.');
    return rosterReply({ success: true });
  }
  return fail(405, 'Method not allowed.');
}
