import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ADMIN_SESSION_TTL_MS,
  parseCookieHeader,
  signSessionToken,
  verifySessionToken,
} from '../shared/serverSecurity';
import type { PlanTier } from './platformState';
import { PersistentSessionMap } from './redisStore';

/**
 * User & customer directory primitives for the Express bootstrap: admin identity
 * config (env-driven), user/customer record types, the session signing secret
 * and the dev-only demo customer seed. Moved
 * verbatim out of `server.ts` (docs/SERVER_TS_SPLIT_PLAN.md); the mutable
 * `usersDb` / `customerDirectory` arrays stay in `server.ts`.
 *
 * বাংলা: server.ts ভাগ — শুধু টাইপ/সিড/হেল্পার; আচরণ অপরিবর্তিত।
 */

/**
 * Owner/admin emails come ONLY from the environment (`ADMIN_EMAIL`, `ADMIN_EMAILS`) —
 * the same SSOT the edge (`functions/_lib/adminTeam.ts`) and the private backend
 * (`settings.admin_emails`) read. Nothing personal is committed to this public repo.
 */
export const readEnvAdminEmails = (env: NodeJS.ProcessEnv = process.env): string[] =>
  Array.from(
    new Set(
      [env.ADMIN_EMAIL, ...String(env.ADMIN_EMAILS || '').split(',')]
        .map((e) => (e || '').trim().toLowerCase())
        .filter((e) => e.includes('@'))
    )
  );

export const createAdminIdentityConfig = () => {
  const envAdminEmails = readEnvAdminEmails();

  // Personal/organisational emails are never seeded from source control. The only
  // built-in admin identities come from ADMIN_EMAIL / ADMIN_EMAILS, and users or
  // customers declared admin in the database (see getDatabaseAdminEmails below).
  const SEEDED_ADMIN_EMAILS = new Set<string>(envAdminEmails);
  // Admin user IDs are likewise environment-driven, never hardcoded.
  const ADMIN_USER_IDS = new Set(
    (process.env.ADMIN_USER_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  );
  const ADMIN_RBAC_ROLES = new Set(['admin', 'super_admin', 'superadmin', 'root_admin', 'owner']);
  return { envAdminEmails, SEEDED_ADMIN_EMAILS, ADMIN_USER_IDS, ADMIN_RBAC_ROLES };
};

export type RbacRole = 'admin' | 'super_admin' | 'developer' | 'user';

export interface ServerUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'user';
  rbacRole?: RbacRole;
  isAdminEligible: boolean;
  isDeveloperEligible: boolean;
  adminUserId?: string;
  plan: PlanTier;
  createdAt: string;
  avatar?: string;
}

export interface ServerCustomerRecord {
  id: string;
  name: string;
  email: string;
  tier: PlanTier;
  status: 'active' | 'past_due' | 'suspended';
  mrr: number;
  tokensUsed: number;
  tokenLimit: number;
  connectedRepos: number;
  joinedDate: string;
  lastActive: string;
  githubHandle?: string;
  region: string;
  isDeveloperEligible: boolean;
  isAdminEligible?: boolean;
  rbacRole?: RbacRole;
}

export const getSessionSigningSecret = (): string => {
  // বাংলা মন্তব্য: ডুয়াল-পারপাস কী (ADMIN_PASSKEY) সাইনিং চেইন থেকে বাদ দেওয়া হয়েছে যাতে সেশন টোকেন ও পাসকি আলাদা থাকে
  const fromEnv = process.env.AUTH_TOKEN_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const keyFilePath = path.join(os.tmpdir(), 'supremeai_session_signing.key');
  // বাংলা মন্তব্য: exists→read/write (TOCTOU race) বাদ — সরাসরি পড়ি; না থাকলে exclusive
  // ('wx') তৈরি করি, এর মধ্যে অন্য প্রসেস বানিয়ে ফেললে (EEXIST) সেটাই আবার পড়ি।
  const readKey = (): string | null => {
    try {
      const existing = fs.readFileSync(keyFilePath, 'utf8').trim();
      return existing.length >= 32 ? existing : null;
    } catch {
      return null;
    }
  };
  const existing = readKey();
  if (existing) return existing;
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(keyFilePath, generated, { mode: 0o600, flag: 'wx' });
    return generated;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return generated;
    const raced = readKey();
    if (raced) return raced;
    // A too-short legacy key file exists: replace it (previous behaviour).
    try {
      fs.writeFileSync(keyFilePath, generated, { mode: 0o600 });
    } catch {
      /* read-only tmp: in-memory secret for this process */
    }
    return generated;
  }
};

/** Dev/preview demo customers (empty in production). */
export const createCustomerDirectorySeed = (isProduction: boolean): ServerCustomerRecord[] =>
  isProduction
    ? []
    : [
        {
          id: 'cust_001',
          name: 'Studio Developer',
          email: 'demo.developer@supremeai.bd',
          tier: 'Pro',
          status: 'active',
          mrr: 29,
          tokensUsed: 142500,
          tokenLimit: 1000000,
          connectedRepos: 2,
          joinedDate: '2026-01-14',
          lastActive: 'Just now',
          githubHandle: 'supremeai-dev',
          region: 'Asia/Dhaka',
          isDeveloperEligible: true,
        },
        {
          id: 'cust_sarah',
          name: 'Sarah Chen',
          email: 'sarah.chen@fintech.io',
          tier: 'Pro',
          status: 'active',
          mrr: 29,
          tokensUsed: 384200,
          tokenLimit: 1000000,
          connectedRepos: 4,
          joinedDate: '2026-03-10',
          lastActive: '5 mins ago',
          githubHandle: 'sarah-fintech',
          region: 'US/West',
          isDeveloperEligible: true,
        },
        {
          id: 'cust_alex',
          name: 'Alex Johnson',
          email: 'alex.j@partner.io',
          tier: 'Free',
          status: 'active',
          mrr: 0,
          tokensUsed: 24500,
          tokenLimit: 100000,
          connectedRepos: 1,
          joinedDate: '2026-04-01',
          lastActive: '1 hour ago',
          githubHandle: 'alexj-partner',
          region: 'Europe/London',
          isDeveloperEligible: false,
        },
        {
          id: 'cust_002',
          name: 'Rahim Chowdhury',
          email: 'rahim.chowdhury@techscale.io',
          tier: 'Enterprise',
          status: 'active',
          mrr: 199,
          tokensUsed: 1845000,
          tokenLimit: 5000000,
          connectedRepos: 14,
          joinedDate: '2025-11-03',
          lastActive: '12 mins ago',
          githubHandle: 'rahim-techscale',
          region: 'Asia/Singapore',
          isDeveloperEligible: true,
        },
        {
          id: 'cust_003',
          name: 'Sarah Jenkins',
          email: 'sarah.j@vertexlabs.ai',
          tier: 'Enterprise',
          status: 'active',
          mrr: 199,
          tokensUsed: 2910000,
          tokenLimit: 5000000,
          connectedRepos: 8,
          joinedDate: '2025-10-22',
          lastActive: '45 mins ago',
          githubHandle: 'sjenkins-ai',
          region: 'US/East',
          isDeveloperEligible: true,
        },
        {
          id: 'cust_004',
          name: 'Demo Developer',
          email: 'developer@supremeai.bd',
          tier: 'Pro',
          status: 'active',
          mrr: 29,
          tokensUsed: 620400,
          tokenLimit: 1000000,
          connectedRepos: 3,
          joinedDate: '2026-02-01',
          lastActive: '2 hours ago',
          githubHandle: 'demo-developer',
          region: 'Asia/Dhaka',
          isDeveloperEligible: true,
        },
        {
          id: 'cust_005',
          name: 'Elena Rostova',
          email: 'elena@novasoft.eu',
          tier: 'Pro',
          status: 'past_due',
          mrr: 29,
          tokensUsed: 980200,
          tokenLimit: 1000000,
          connectedRepos: 4,
          joinedDate: '2026-01-18',
          lastActive: '5 hours ago',
          githubHandle: 'elena-novasoft',
          region: 'Europe/Berlin',
          isDeveloperEligible: false,
        },
        {
          id: 'cust_006',
          name: 'Marcus Brody',
          email: 'marcus.brody@openbuild.dev',
          tier: 'Free',
          status: 'active',
          mrr: 0,
          tokensUsed: 42100,
          tokenLimit: 100000,
          connectedRepos: 1,
          joinedDate: '2026-02-10',
          lastActive: '1 day ago',
          githubHandle: 'mbrody',
          region: 'US/West',
          isDeveloperEligible: false,
        },
        {
          id: 'cust_007',
          name: 'Fatima Al-Mansoor',
          email: 'fatima@cloudcore.ae',
          tier: 'Enterprise',
          status: 'active',
          mrr: 199,
          tokensUsed: 3120000,
          tokenLimit: 5000000,
          connectedRepos: 12,
          joinedDate: '2025-12-08',
          lastActive: '3 hours ago',
          githubHandle: 'fatima-cloud',
          region: 'MiddleEast/Dubai',
          isDeveloperEligible: true,
        },
        {
          id: 'cust_010',
          name: 'David Zhao',
          email: 'zhao.david@quantmatrix.com',
          tier: 'Free',
          status: 'suspended',
          mrr: 0,
          tokensUsed: 100000,
          tokenLimit: 100000,
          connectedRepos: 0,
          joinedDate: '2026-02-04',
          lastActive: '7 days ago',
          githubHandle: 'zhaodavid',
          region: 'Asia/Tokyo',
          isDeveloperEligible: false,
        },
      ];

const MAX_SESSION_CACHE_ENTRIES = 2_000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface ServerIdentityManagerOptions {
  getUsersDb: () => ServerUser[];
  getCustomerDirectory: () => ServerCustomerRecord[];
  isHttpsRequest: (req: Request) => boolean;
}

/**
 * Encapsulates session token signing/revocation, Redis-backed session maps,
 * RBAC profile resolution, upstream token verification cache, and Express
 * admin/user auth middlewares for `server.ts`.
 */
export function createServerIdentityManager(opts: ServerIdentityManagerOptions) {
  const { SEEDED_ADMIN_EMAILS, ADMIN_USER_IDS, ADMIN_RBAC_ROLES } = createAdminIdentityConfig();
  const tokenSigningSecret = getSessionSigningSecret();

  const activeAdminSessions = new PersistentSessionMap<number>('supremeai:admin_sess:', 86_400, true);
  const activeAuthSessions = new PersistentSessionMap<string>('supremeai:auth_sess:', 86_400 * 7, true);
  const activeRefreshTokens = new PersistentSessionMap<{ userId: string; expiresAt: number }>(
    'supremeai:refresh_tok:',
    86_400 * 30,
    true
  );
  void Promise.all([
    activeAdminSessions.hydrateFromRedis(),
    activeAuthSessions.hydrateFromRedis(),
    activeRefreshTokens.hydrateFromRedis(),
  ]).catch(() => {});

  const upstreamTokenAdminCache = new Map<
    string,
    { email: string; isAdmin: boolean; tier: PlanTier; userId?: string; expiresAt: number }
  >();
  const revokedSessionTokenHashes = new Map<string, number>();

  const revokeLocalSessionToken = (rawToken: string) => {
    if (!rawToken) return;
    const now = Date.now();
    if (revokedSessionTokenHashes.size >= MAX_SESSION_CACHE_ENTRIES) {
      for (const [k, exp] of revokedSessionTokenHashes) {
        if (exp <= now) revokedSessionTokenHashes.delete(k);
      }
      if (revokedSessionTokenHashes.size >= MAX_SESSION_CACHE_ENTRIES) {
        const oldest = revokedSessionTokenHashes.keys().next().value;
        if (oldest) revokedSessionTokenHashes.delete(oldest);
      }
    }
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    revokedSessionTokenHashes.set(hash, now + 7 * 86_400_000);
  };

  const signLocalSessionToken = (
    payload: { sub: string; email: string; iat: number; exp?: number; role?: string },
    ttlMs?: number
  ): string => signSessionToken(payload, tokenSigningSecret, ttlMs);

  const verifyLocalSessionToken = (
    token: string
  ): { sub: string; email: string; iat: number; exp: number; role?: string } | null => {
    if (!token) return null;
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const revokedExp = revokedSessionTokenHashes.get(hash);
    if (revokedExp && revokedExp > Date.now()) return null;
    if (revokedExp) revokedSessionTokenHashes.delete(hash);
    return verifySessionToken(token, tokenSigningSecret);
  };

  const issueLocalRefreshToken = (userId: string): string => {
    const refreshToken = `rt_${crypto.randomBytes(32).toString('base64url')}`;
    activeRefreshTokens.set(refreshToken, {
      userId,
      expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
    });
    return refreshToken;
  };

  const getDatabaseAdminEmails = (extraEmails: string[] = []): Set<string> => {
    const emails = new Set<string>(SEEDED_ADMIN_EMAILS);
    for (const extra of extraEmails) {
      const clean = String(extra || '').trim().toLowerCase();
      if (clean) emails.add(clean);
    }
    for (const u of opts.getUsersDb()) {
      const clean = u.email.trim().toLowerCase();
      const rbac = String(u.rbacRole || u.role || '').toLowerCase();
      if (
        u.isAdminEligible ||
        ADMIN_RBAC_ROLES.has(rbac) ||
        (u.adminUserId && ADMIN_USER_IDS.has(u.adminUserId))
      ) {
        emails.add(clean);
      }
    }
    for (const c of opts.getCustomerDirectory()) {
      const clean = c.email.trim().toLowerCase();
      const rbac = String(c.rbacRole || '').toLowerCase();
      if (c.isAdminEligible || ADMIN_RBAC_ROLES.has(rbac)) {
        emails.add(clean);
      }
    }
    return emails;
  };

  const resolveRbacUserProfile = (
    cleanEmail: string,
    user?: Partial<Omit<ServerUser, 'rbacRole'>> & { rbacRole?: string },
    customerRec?: Partial<ServerCustomerRecord>,
    extraAdminEmails: string[] = [],
    extraRbacRole?: string
  ) => {
    const adminEmails = getDatabaseAdminEmails(extraAdminEmails);
    const emailMatchedAdminDb = adminEmails.has(cleanEmail);
    const rbacCandidates = [extraRbacRole, user?.rbacRole, user?.role, customerRec?.rbacRole]
      .map((r) => String(r || '').trim().toLowerCase())
      .filter(Boolean);

    const hasAdminRbacRole = rbacCandidates.some((r) => ADMIN_RBAC_ROLES.has(r));
    const hasExplicitFlag = Boolean(
      user?.isAdminEligible ||
        customerRec?.isAdminEligible ||
        (user?.adminUserId && ADMIN_USER_IDS.has(user.adminUserId))
    );

    const isAdminEligible = Boolean(emailMatchedAdminDb || hasAdminRbacRole || hasExplicitFlag);
    const rbacRole: RbacRole = isAdminEligible
      ? rbacCandidates.includes('super_admin') || rbacCandidates.includes('superadmin')
        ? 'super_admin'
        : 'admin'
      : rbacCandidates.includes('developer') ||
          Boolean(customerRec?.isDeveloperEligible ?? user?.isDeveloperEligible)
        ? 'developer'
        : 'user';
    const role: 'admin' | 'user' = isAdminEligible ? 'admin' : 'user';
    const isDeveloperEligible = Boolean(
      isAdminEligible || customerRec?.isDeveloperEligible || user?.isDeveloperEligible
    );

    return {
      isAdminEligible,
      adminEmailMatched: emailMatchedAdminDb,
      rbacRole,
      role,
      isDeveloperEligible,
      adminUserId: user?.adminUserId || (isAdminEligible ? 'admin_root_001' : undefined),
      adminEmails: Array.from(adminEmails),
    };
  };

  const buildSafeAuthUser = (
    user: ServerUser,
    customerRec?: ServerCustomerRecord,
    extraAdminEmails: string[] = [],
    extraRbacRole?: string
  ) => {
    const cleanEmail = user.email.trim().toLowerCase();
    const rbac = resolveRbacUserProfile(
      cleanEmail,
      user,
      customerRec,
      extraAdminEmails,
      extraRbacRole
    );
    return {
      id: user.id,
      user_id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar || user.name.charAt(0).toUpperCase(),
      role: rbac.role,
      rbacRole: rbac.rbacRole,
      isAdminEligible: rbac.isAdminEligible,
      adminEmailMatched: rbac.adminEmailMatched,
      isDeveloperEligible: rbac.isDeveloperEligible,
      adminUserId: rbac.adminUserId,
      plan: customerRec?.tier || user.plan,
      createdAt: user.createdAt,
      adminEmails: rbac.adminEmails,
    };
  };

  const setRefreshTokenCookie = (req: Request, res: Response, refreshToken: string) => {
    res.cookie('supremeai_refresh_token', refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.isHttpsRequest(req),
      path: '/api',
      maxAge: REFRESH_TOKEN_TTL_MS,
    });
  };

  const setAdminSessionCookie = (req: Request, res: Response, token: string) => {
    activeAdminSessions.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
    res.cookie('supremeai_admin_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.isHttpsRequest(req),
      path: '/api',
      maxAge: ADMIN_SESSION_TTL_MS,
    });
  };

  const verifyBearerIdentity = async (
    rawToken: string
  ): Promise<{ email: string; isAdmin: boolean; tier: PlanTier; userId?: string } | null> => {
    if (!rawToken || rawToken.startsWith('tok_guest_') || rawToken.startsWith('sk-supreme-guest')) {
      return null;
    }
    const usersDb = opts.getUsersDb();
    const customerDirectory = opts.getCustomerDirectory();

    const verifiedLocal = verifyLocalSessionToken(rawToken);
    if (verifiedLocal) {
      const adminExp = activeAdminSessions.get(rawToken);
      if (verifiedLocal.sub === 'admin_passkey') {
        if (adminExp && adminExp > Date.now()) {
          return {
            email: verifiedLocal.email,
            isAdmin: true,
            tier: 'Enterprise',
            userId: verifiedLocal.sub,
          };
        }
        activeAdminSessions.delete(rawToken);
        return null;
      }
      const sessionUserId = activeAuthSessions.get(rawToken);
      const matchedUser =
        (sessionUserId ? usersDb.find((u) => u.id === sessionUserId) : undefined) ||
        usersDb.find((u) => u.email.toLowerCase() === verifiedLocal.email);
      const customerRec = customerDirectory.find(
        (c) => c.email.toLowerCase() === verifiedLocal.email
      );
      const rbac = resolveRbacUserProfile(verifiedLocal.email, matchedUser, customerRec);
      return {
        email: verifiedLocal.email,
        isAdmin: rbac.isAdminEligible || verifiedLocal.role === 'admin',
        tier:
          customerRec?.tier || matchedUser?.plan || (rbac.isAdminEligible ? 'Enterprise' : 'Pro'),
        userId: matchedUser?.id || verifiedLocal.sub,
      };
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const cached = upstreamTokenAdminCache.get(tokenHash);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        email: cached.email,
        isAdmin: cached.isAdmin,
        tier: cached.tier,
        userId: cached.userId,
      };
    }

    if (!rawToken.startsWith('tok_') && !rawToken.startsWith('mock_tok_')) {
      const remoteGatewayUrl =
        process.env.SUPREMEAI_BACKEND_URL?.trim() || 'https://supremeai-api-ulw0.onrender.com';
      try {
        const upstreamRes = await fetch(`${remoteGatewayUrl}/api/v1/auth/me`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${rawToken}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(4500),
        });
        if (upstreamRes.ok) {
          const data = (await upstreamRes.json().catch(() => null)) as {
            user?: Record<string, unknown>;
            email?: string;
            adminEmails?: string[];
            admin_emails?: string[];
            [k: string]: unknown;
          } | null;
          const raw =
            data && typeof data === 'object'
              ? data.user && typeof data.user === 'object'
                ? { ...data, ...data.user }
                : data
              : null;
          const cleanEmail = String(raw?.email || '').trim().toLowerCase();
          if (cleanEmail && raw) {
            const matchedUser = usersDb.find((u) => u.email.toLowerCase() === cleanEmail);
            const customerRec = customerDirectory.find((c) => c.email.toLowerCase() === cleanEmail);
            const upstreamAdminEmails: string[] = [
              ...(Array.isArray(data?.adminEmails) ? data.adminEmails : []),
              ...(Array.isArray(data?.admin_emails) ? data.admin_emails : []),
            ];
            const upstreamRbacRaw = raw.rbacRole || raw.rbac_role || raw.role;
            const upstreamRbac = typeof upstreamRbacRaw === 'string' ? upstreamRbacRaw : undefined;
            const adminUserIdRaw = raw.adminUserId || raw.admin_user_id;
            const rbac = resolveRbacUserProfile(
              cleanEmail,
              matchedUser || {
                rbacRole: upstreamRbac,
                isAdminEligible: Boolean(
                  raw.isAdminEligible ?? raw.is_admin_eligible ?? raw.is_admin
                ),
                isDeveloperEligible: Boolean(raw.isDeveloperEligible ?? raw.is_developer_eligible),
                adminUserId: typeof adminUserIdRaw === 'string' ? adminUserIdRaw : undefined,
              },
              customerRec,
              upstreamAdminEmails,
              upstreamRbac
            );
            const upstreamUserId =
              matchedUser?.id || String(raw.user_id || raw.id || '').trim() || undefined;
            const resolved = {
              email: cleanEmail,
              isAdmin: rbac.isAdminEligible,
              tier: (customerRec?.tier ||
                raw.plan ||
                (rbac.isAdminEligible ? 'Enterprise' : 'Pro')) as PlanTier,
              userId: upstreamUserId,
            };
            if (upstreamTokenAdminCache.size >= MAX_SESSION_CACHE_ENTRIES) {
              const now = Date.now();
              for (const [k, entry] of upstreamTokenAdminCache) {
                if (entry.expiresAt <= now) upstreamTokenAdminCache.delete(k);
              }
              if (upstreamTokenAdminCache.size >= MAX_SESSION_CACHE_ENTRIES) {
                const oldestKey = upstreamTokenAdminCache.keys().next().value;
                if (oldestKey) upstreamTokenAdminCache.delete(oldestKey);
              }
            }
            upstreamTokenAdminCache.set(tokenHash, {
              ...resolved,
              expiresAt: Date.now() + 60_000,
            });
            return resolved;
          }
        }
      } catch {
        return null;
      }
    }

    return null;
  };

  const resolveAuthenticatedEmail = async (req: Request): Promise<string | null> => {
    const authHeader = String(req.headers.authorization || '').trim();
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) return null;
    const identity = await verifyBearerIdentity(token);
    const email = identity?.email?.trim().toLowerCase();
    return email && email !== 'guest' ? email : null;
  };

  const getRequestUserEmail = (req: Request): string => {
    const authHeader = String(req.headers.authorization || '').trim();
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) return 'guest';
    const sessionUserId = activeAuthSessions.get(token);
    const matchedUser = sessionUserId
      ? opts.getUsersDb().find((u) => u.id === sessionUserId)
      : undefined;
    if (matchedUser?.email) return matchedUser.email.toLowerCase();
    const verifiedPayload = verifyLocalSessionToken(token);
    return verifiedPayload?.email?.toLowerCase() || 'guest';
  };

  const verifyAdminAuthorization = async (
    req: Request
  ): Promise<{ ok: true; email: string } | { ok: false; status: number; error: string }> => {
    const authHeader = String(req.headers.authorization || '').trim();
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const adminHeader = String(req.headers['x-admin-token'] || '').trim();
    const cookies = parseCookieHeader(req.headers.cookie);
    const cookieToken = cookies.supremeai_admin_session || '';

    const candidates = [adminHeader, cookieToken, bearerToken].filter(Boolean);
    if (candidates.length === 0) {
      return { ok: false, status: 401, error: 'Administrator authentication is required.' };
    }

    for (const candidate of candidates) {
      const identity = await verifyBearerIdentity(candidate);
      if (identity?.isAdmin) {
        return { ok: true, email: identity.email };
      }
    }

    return {
      ok: false,
      status: 403,
      error: 'Administrator privileges are required for this endpoint.',
    };
  };

  const requireAdminMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/auth/verify' && req.method === 'POST') {
      next();
      return;
    }
    const authResult = await verifyAdminAuthorization(req);
    if (!authResult.ok) {
      res.status(authResult.status).json({ error: authResult.error });
      return;
    }
    next();
  };

  const requireAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = String(req.headers.authorization || '').trim();
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const keyHeader = String(req.headers['x-supremeai-key'] || '').trim();
    const candidate = bearerToken || keyHeader;
    if (!candidate) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const identity = await verifyBearerIdentity(candidate);
    if (!identity) {
      res.status(401).json({ error: 'Valid session or API key is required.' });
      return;
    }
    (req as unknown as Record<string, unknown>).authIdentity = identity;
    next();
  };

  return {
    activeAdminSessions,
    activeAuthSessions,
    activeRefreshTokens,
    upstreamTokenAdminCache,
    revokeLocalSessionToken,
    signLocalSessionToken,
    verifyLocalSessionToken,
    issueLocalRefreshToken,
    resolveRbacUserProfile,
    buildSafeAuthUser,
    setRefreshTokenCookie,
    setAdminSessionCookie,
    verifyBearerIdentity,
    resolveAuthenticatedEmail,
    getRequestUserEmail,
    verifyAdminAuthorization,
    requireAdminMiddleware,
    requireAuthMiddleware,
  };
}
