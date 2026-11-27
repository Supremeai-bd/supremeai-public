/**
 * বাংলা মন্তব্য: Team & Access — আসল Supabase Auth ইউজার ও তাদের রোল।
 *
 * রোলের একমাত্র উৎস: `auth.users.app_metadata.role` (শুধু সার্ভার লিখতে পারে) অথবা
 * `ADMIN_EMAILS` env (owner)। ব্যাকএন্ড লগইনের সময় ঠিক এগুলোই পড়ে (core/api/routes/auth.py),
 * তাই এখানে বদলালে পরের লগইন থেকে সত্যিই কার্যকর হয় — কোনো আলাদা JSON রেজিস্ট্রি নেই।
 *
 * নিরাপত্তা নিয়ম (সার্ভারে, UI-তে নয়):
 * - নিজের রোল বদলানো / নিজেকে সাসপেন্ড করা যায় না।
 * - Owner (ADMIN_EMAILS) UI থেকে বদলানো যায় না — env থেকেই আসে।
 * - শেষ সক্রিয় অ্যাডমিনকে সরানো যায় না।
 * - কোনো টোকেন/পাসওয়ার্ড রেসপন্সে যায় না।
 */

import { jsonEdgeResponse } from './edgeHelpers';
import { resolveSupabaseAdmin } from './adminRealData';

type Env = Record<string, string | undefined> | undefined;

export type TeamRole = 'admin' | 'user';
export type TeamStatus = 'active' | 'invited' | 'suspended';

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: TeamRole;
  status: TeamStatus;
  /** Admin because the email is in the ADMIN_EMAILS env — cannot be changed from the UI. */
  isOwner: boolean;
  /** The admin currently looking at the list. */
  isSelf: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  provider: string;
}

export interface TeamSummary {
  total: number;
  admins: number;
  users: number;
  invited: number;
  suspended: number;
}

const ROLES = new Set<TeamRole>(['admin', 'user']);
const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Supabase has no "forever" ban; ~100 years is the documented convention. */
const SUSPEND_DURATION = '876000h';
const TIMEOUT_MS = 6000;

export function ownerEmails(env: Env): Set<string> {
  return new Set(
    [env?.ADMIN_EMAIL || '', ...String(env?.ADMIN_EMAILS || '').split(',')]
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function mapTeamMember(
  raw: Record<string, unknown>,
  owners: Set<string>,
  actor: string
): TeamMember {
  const app = (raw.app_metadata || {}) as Record<string, unknown>;
  const meta = (raw.user_metadata || {}) as Record<string, unknown>;
  const email = String(raw.email || '')
    .trim()
    .toLowerCase();
  const isOwner = Boolean(email) && owners.has(email);
  const role: TeamRole = isOwner || app.role === 'admin' ? 'admin' : 'user';
  const bannedUntil = raw.banned_until ? Date.parse(String(raw.banned_until)) : NaN;
  const suspended = Number.isFinite(bannedUntil) && bannedUntil > Date.now();
  const confirmed = Boolean(raw.email_confirmed_at || raw.confirmed_at);
  const status: TeamStatus = suspended
    ? 'suspended'
    : !confirmed && !raw.last_sign_in_at
      ? 'invited'
      : 'active';
  return {
    id: String(raw.id || ''),
    email,
    name: String(meta.full_name || meta.name || '').trim() || email.split('@')[0] || 'Unknown',
    role,
    status,
    isOwner,
    isSelf: Boolean(email) && email === actor.trim().toLowerCase(),
    createdAt: raw.created_at ? String(raw.created_at) : null,
    lastSignInAt: raw.last_sign_in_at ? String(raw.last_sign_in_at) : null,
    provider: String(app.provider || 'email'),
  };
}

export function summarizeTeam(members: TeamMember[]): TeamSummary {
  return {
    total: members.length,
    admins: members.filter((m) => m.role === 'admin').length,
    users: members.filter((m) => m.role === 'user').length,
    invited: members.filter((m) => m.status === 'invited').length,
    suspended: members.filter((m) => m.status === 'suspended').length,
  };
}

/** Active admins left if `targetId` lost admin rights (demoted or suspended). */
export function activeAdminsWithout(members: TeamMember[], targetId: string): number {
  return members.filter((m) => m.id !== targetId && m.role === 'admin' && m.status !== 'suspended')
    .length;
}

interface TeamDeps {
  env: Env;
  actor: string;
  fetchImpl: typeof fetch;
}

async function supabaseAuth(
  deps: TeamDeps,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<Response> {
  const cfg = resolveSupabaseAdmin(deps.env)!;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await deps.fetchImpl(`${cfg.url}/auth/v1${path}`, {
      method: init.method || 'GET',
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function loadMembers(deps: TeamDeps): Promise<TeamMember[] | null> {
  const res = await supabaseAuth(deps, '/admin/users?per_page=1000');
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { users?: unknown[] } | null;
  const owners = ownerEmails(deps.env);
  return (Array.isArray(data?.users) ? data!.users : [])
    .filter((u): u is Record<string, unknown> => Boolean(u) && typeof u === 'object')
    .map((u) => mapTeamMember(u, owners, deps.actor))
    .sort(
      (a, b) =>
        Number(b.role === 'admin') - Number(a.role === 'admin') || a.email.localeCompare(b.email)
    );
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = (await request.json().catch(() => null)) as unknown;
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

/**
 * Routes (all behind the admin auth in `functions/api/admin/[[path]].ts`):
 * - GET    /api/admin/team
 * - PATCH  /api/admin/team/:id/role      { role: 'admin' | 'user' }
 * - POST   /api/admin/team/:id/suspend   { suspended: boolean }
 * - POST   /api/admin/team/invite        { email, role? }
 */
export async function handleAdminTeamRoute(
  path: string,
  request: Request,
  env: Env,
  audit: { actor: string; details?: string },
  fetchImpl: typeof fetch = fetch
): Promise<Response | null> {
  if (path !== '/api/admin/team' && !path.startsWith('/api/admin/team/')) return null;
  const reply = (body: Record<string, unknown>, status = 200) =>
    jsonEdgeResponse(body, status, request);
  const fail = (status: number, error: string) => reply({ success: false, error }, status);

  if (!resolveSupabaseAdmin(env)) {
    return fail(503, 'Team store not linked (Supabase service key missing).');
  }
  const deps: TeamDeps = { env, actor: audit.actor, fetchImpl };
  const method = request.method.toUpperCase();

  try {
    if (path === '/api/admin/team' && method === 'GET') {
      const members = await loadMembers(deps);
      if (!members) return fail(502, 'Could not read users from Supabase Auth.');
      return reply({ success: true, members, summary: summarizeTeam(members) });
    }

    if (path === '/api/admin/team/invite' && method === 'POST') {
      const body = await readBody(request);
      const email = String(body.email || '')
        .trim()
        .toLowerCase();
      const role = (body.role ?? 'user') as TeamRole;
      if (!EMAIL_RE.test(email) || email.length > 254)
        return fail(400, 'A valid email is required.');
      if (!ROLES.has(role)) return fail(400, 'Role must be "admin" or "user".');
      const invited = await supabaseAuth(deps, '/invite', { method: 'POST', body: { email } });
      if (!invited.ok) {
        const reason = (await invited.json().catch(() => null)) as { msg?: string } | null;
        return fail(
          invited.status === 422 ? 409 : 502,
          reason?.msg || `Supabase invite failed (HTTP ${invited.status}).`
        );
      }
      const user = (await invited.json().catch(() => null)) as Record<string, unknown> | null;
      const id = String(user?.id || '');
      if (role === 'admin' && USER_ID_RE.test(id)) {
        const promoted = await supabaseAuth(deps, `/admin/users/${id}`, {
          method: 'PUT',
          body: { app_metadata: { role: 'admin' } },
        });
        if (!promoted.ok) {
          audit.details = `invited ${email} (admin role NOT applied)`;
          return fail(502, 'Invite sent, but setting the admin role failed — set it again.');
        }
      }
      audit.details = `invited ${email} as ${role}`;
      return reply({ success: true, invited: { id, email, role } });
    }

    const match = /^\/api\/admin\/team\/([^/]+)\/(role|suspend)$/.exec(path);
    if (!match) return fail(404, 'Unknown team route.');
    const [, id, action] = match;
    if (!USER_ID_RE.test(id)) return fail(400, 'Invalid user id.');
    if ((action === 'role' && method !== 'PATCH') || (action === 'suspend' && method !== 'POST')) {
      return fail(405, 'Method not allowed.');
    }

    const members = await loadMembers(deps);
    if (!members) return fail(502, 'Could not read users from Supabase Auth.');
    const target = members.find((m) => m.id === id);
    if (!target) return fail(404, 'User not found.');
    if (target.isSelf) return fail(409, 'You cannot change your own access.');
    if (target.isOwner) {
      return fail(409, 'Owner access comes from ADMIN_EMAILS and cannot be changed here.');
    }

    const body = await readBody(request);
    if (action === 'role') {
      const role = body.role as TeamRole;
      if (!ROLES.has(role)) return fail(400, 'Role must be "admin" or "user".');
      if (role === target.role) return reply({ success: true, member: target, unchanged: true });
      if (role === 'user' && activeAdminsWithout(members, id) === 0) {
        return fail(409, 'This is the last active admin — promote someone else first.');
      }
      const res = await supabaseAuth(deps, `/admin/users/${id}`, {
        method: 'PUT',
        body: { app_metadata: { role } },
      });
      if (!res.ok) return fail(502, `Supabase rejected the role change (HTTP ${res.status}).`);
      audit.details = `role ${target.role} → ${role} for ${target.email}`;
      return reply({ success: true, member: { ...target, role }, effective: 'next-login' });
    }

    if (typeof body.suspended !== 'boolean') return fail(400, '"suspended" must be true or false.');
    const suspended = body.suspended;
    if (suspended && target.role === 'admin' && activeAdminsWithout(members, id) === 0) {
      return fail(409, 'This is the last active admin — it cannot be suspended.');
    }
    const res = await supabaseAuth(deps, `/admin/users/${id}`, {
      method: 'PUT',
      body: { ban_duration: suspended ? SUSPEND_DURATION : 'none' },
    });
    if (!res.ok) return fail(502, `Supabase rejected the change (HTTP ${res.status}).`);
    audit.details = `${suspended ? 'suspended' : 'reactivated'} ${target.email}`;
    const status: TeamStatus = suspended ? 'suspended' : target.lastSignInAt ? 'active' : 'invited';
    return reply({ success: true, member: { ...target, status } });
  } catch {
    return fail(502, 'Supabase Auth unreachable.');
  }
}
