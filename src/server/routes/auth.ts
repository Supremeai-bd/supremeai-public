import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import { DEFAULT_BACKEND_ORIGIN } from '../../config/platformEndpoints';
import { getPlanSpec } from '../../config/plans';
import type { PlanTier } from '../../types';
import { hashPassword, parseCookieHeader, verifyPassword } from '../../shared/serverSecurity';
import { loginSchema, refreshSchema, signupSchema, parseBody } from '../validation';
import type { RbacRole, ServerCustomerRecord, ServerUser } from '../userDirectory';
import {
  asUpstreamJson,
  upstreamString,
  upstreamStringList,
  type UpstreamJson,
} from '../upstreamJson';

/**
 * Core Auth — `POST /api/auth/*` + `POST /api/v1/auth/*` + `GET /api/auth/me` + `POST /api/v1/auth/logout`
 *
 * WHY THIS FILE EXISTS
 *   Auth surface (login/signup/me/guest/refresh/logout + 11 route
 *   registrations) lived inline in `server.ts` (~660 lines). Cohesive (single
 *   session store, single RBAC helper, single upstream fallback) and has no
 *   other consumer for its handlers. Moving it keeps the monolith shrinking.
 *
 * CONTRACT WITH server.ts
 *   - 5 handlers (`handleLoginRequest`, `handleSignupRequest`, `handleGetMeRequest`,
 *     `handleGuestTokenRequest`, `handleRefreshRequest`) + 11 registrations are
 *     OWNED here (no other route defines auth handlers).
 *   - `usersDb` + `customerDirectory` injected via getters (mutated by signup).
 *   - Session maps (`activeAuthSessions`, `activeAdminSessions`,
 *     `activeRefreshTokens`, `upstreamTokenAdminCache`) injected by reference.
 *   - `isIpBlocked`, `platformConfig`, `buildSafeAuthUser`, `signLocalSessionToken`,
 *     `verifyLocalSessionToken`, `issueLocalRefreshToken`, `setRefreshTokenCookie`,
 *     `setAdminSessionCookie`, `resolveRbacUserProfile`, `recordAudit`
 *     injected via ctx (closures over shared state).
 */

type CustomerEntry = ServerCustomerRecord;

/** RBAC verdict returned by server.ts `resolveRbacUserProfile`. */
interface RbacUserProfile {
  isAdminEligible: boolean;
  adminEmailMatched: boolean;
  rbacRole: RbacRole;
  role: 'admin' | 'user';
  isDeveloperEligible: boolean;
  adminUserId?: string;
  adminEmails: string[];
}

/** Public user shape returned by server.ts `buildSafeAuthUser` (never includes passwordHash). */
interface SafeAuthUser extends RbacUserProfile {
  id: string;
  user_id: string;
  name: string;
  email: string;
  avatar: string;
  plan: string;
  createdAt: string;
}

/** Hints used to resolve RBAC for users not in the local directory (upstream-only accounts). */
interface RbacUserHints {
  rbacRole?: string;
  isAdminEligible?: boolean;
  isDeveloperEligible?: boolean;
  adminUserId?: string;
}

export interface AuthContext {
  get customerDirectory(): CustomerEntry[];
  get usersDb(): ServerUser[];
  activeAuthSessions: Map<string, string>;
  activeAdminSessions: Map<string, number>;
  activeRefreshTokens: Map<string, { userId: string; expiresAt: number }>;
  upstreamTokenAdminCache: Map<string, { email: string; isAdmin: boolean; tier: PlanTier; expiresAt: number }>;
  // বাংলা মন্তব্য: লগআউট করা stateless লোকাল সেশন টোকেন তাৎক্ষণিকভাবে বাতিল করার ঐচ্ছিক রেজিস্ট্রি
  revokeSessionToken?: (token: string) => void;
  isIpBlocked: (req: Request) => boolean;
  platformConfig: { allowNewSignups: boolean };
  buildSafeAuthUser: (user: ServerUser, customerRec?: CustomerEntry) => SafeAuthUser;
  signLocalSessionToken: (payload: { sub: string; email: string; iat: number; role: string }) => string;
  verifyLocalSessionToken: (token: string) => { sub?: string; email: string; iat?: number; role?: string } | null;
  issueLocalRefreshToken: (userId: string) => string;
  setRefreshTokenCookie: (req: Request, res: Response, token: string) => void;
  setAdminSessionCookie: (req: Request, res: Response, token: string) => void;
  resolveRbacUserProfile: (
    email: string,
    matchedUser?: ServerUser | RbacUserHints,
    matchedCustomer?: CustomerEntry,
    adminEmails?: string[],
    rawRole?: string
  ) => RbacUserProfile;
  recordAudit: (actor: string, action: string, resource: string, details: string, req: Request) => void;
}

export function registerAuthRoutes(app: Express, ctx: AuthContext): void {
  const handleLoginRequest = async (req: Request, res: Response) => {
    if (ctx.isIpBlocked(req)) {
      res.status(403).json({ error: 'Access blocked by platform WAF firewall.' });
      return;
    }

    const parsed = parseBody(loginSchema, req, res);
    if (!parsed.ok) return;
    const { email, username, password } = parsed.data;
    const rawEmail = email || username;
    if (!rawEmail) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const cleanEmail = String(rawEmail).trim().toLowerCase();
    const user = ctx.usersDb.find((u) => u.email.toLowerCase() === cleanEmail);
    const customerRec = ctx.customerDirectory.find((c) => c.email.toLowerCase() === cleanEmail);

    if (customerRec?.status === 'suspended') {
      res.status(403).json({ error: 'This account has been suspended by a platform administrator.' });
      return;
    }

    if (user && verifyPassword(String(password), user.passwordHash)) {
      const safeUser = ctx.buildSafeAuthUser(user, customerRec);
      const token = ctx.signLocalSessionToken({
        sub: user.id,
        email: user.email,
        iat: Date.now(),
        role: safeUser.isAdminEligible ? 'admin' : 'user',
      });
      ctx.activeAuthSessions.set(token, user.id);
      if (safeUser.isAdminEligible) {
        ctx.setAdminSessionCookie(req, res, token);
      }
      const refreshToken = ctx.issueLocalRefreshToken(user.id);
      ctx.setRefreshTokenCookie(req, res, refreshToken);
      res.json({
        success: true,
        user: safeUser,
        role: safeUser.role,
        rbacRole: safeUser.rbacRole,
        isAdminEligible: safeUser.isAdminEligible,
        adminEmailMatched: safeUser.adminEmailMatched,
        adminEmails: safeUser.adminEmails,
        token,
        access_token: token,
        refresh_token: refreshToken,
        expires_in: 3600,
      });
      return;
    }

    if (!user) {
      const remoteGatewayUrl = process.env.SUPREMEAI_BACKEND_URL?.trim() || DEFAULT_BACKEND_ORIGIN;
      try {
        const upstreamRes = await fetch(`${remoteGatewayUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          signal: AbortSignal.timeout(12000),
          body: JSON.stringify({ username: cleanEmail, email: cleanEmail, password }),
        });

        const upstreamData = asUpstreamJson(await upstreamRes.json().catch(() => null));
        if (upstreamRes.ok && upstreamData && (upstreamData.access_token || upstreamData.token)) {
          const remoteUser = asUpstreamJson(upstreamData.user) ?? upstreamData;
          const upstreamAdminEmails: string[] = [
            ...upstreamStringList(upstreamData.adminEmails),
            ...upstreamStringList(upstreamData.admin_emails),
          ];
          const upstreamRbac =
            upstreamString(remoteUser.rbacRole) ||
            upstreamString(remoteUser.rbac_role) ||
            upstreamString(remoteUser.role) ||
            upstreamString(upstreamData.role);
          const upstreamIsAdmin = Boolean(
            remoteUser.isAdminEligible ??
            remoteUser.is_admin_eligible ??
            remoteUser.is_admin ??
            upstreamData.isAdminEligible ??
            upstreamData.is_admin_eligible
          );

          const rbac = ctx.resolveRbacUserProfile(
            cleanEmail,
            {
              rbacRole: upstreamRbac,
              isAdminEligible: upstreamIsAdmin,
              isDeveloperEligible: Boolean(
                remoteUser.isDeveloperEligible ?? remoteUser.is_developer_eligible
              ),
              adminUserId:
                upstreamString(remoteUser.adminUserId) || upstreamString(remoteUser.admin_user_id),
            },
            customerRec,
            upstreamAdminEmails,
            upstreamRbac
          );

          const token = String(upstreamData.access_token || upstreamData.token);
          const safeUser = {
            id: String(
              remoteUser.id || remoteUser.user_id || upstreamData.user_id || `usr_${Date.now()}`
            ),
            user_id: String(
              remoteUser.id || remoteUser.user_id || upstreamData.user_id || `usr_${Date.now()}`
            ),
            name: String(remoteUser.name || cleanEmail.split('@')[0] || 'User'),
            email: cleanEmail,
            avatar: String(remoteUser.name || cleanEmail).charAt(0).toUpperCase(),
            role: rbac.role,
            rbacRole: rbac.rbacRole,
            isAdminEligible: rbac.isAdminEligible,
            adminEmailMatched: rbac.adminEmailMatched,
            isDeveloperEligible: rbac.isDeveloperEligible,
            adminUserId: rbac.adminUserId,
            plan:
              customerRec?.tier ||
              upstreamString(remoteUser.plan) ||
              (rbac.isAdminEligible ? 'Enterprise' : 'Pro'),
            createdAt: String(remoteUser.createdAt || new Date().toISOString().slice(0, 10)),
            adminEmails: rbac.adminEmails,
          };

          const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
          ctx.upstreamTokenAdminCache.set(tokenHash, {
            email: cleanEmail,
            isAdmin: rbac.isAdminEligible,
            tier: safeUser.plan as PlanTier,
            expiresAt: Date.now() + 60_000,
          });
          if (rbac.isAdminEligible) {
            ctx.setAdminSessionCookie(req, res, token);
          }
          const upstreamSetCookie = upstreamRes.headers.get('set-cookie');
          if (upstreamSetCookie) {
            res.append('Set-Cookie', upstreamSetCookie);
          }
          const upstreamRefreshToken =
            upstreamData.refresh_token || upstreamData.refreshToken || undefined;
          if (upstreamRefreshToken) {
            ctx.setRefreshTokenCookie(req, res, String(upstreamRefreshToken));
          }

          res.json({
            success: true,
            user: safeUser,
            role: safeUser.role,
            rbacRole: safeUser.rbacRole,
            isAdminEligible: safeUser.isAdminEligible,
            adminEmailMatched: safeUser.adminEmailMatched,
            adminEmails: safeUser.adminEmails,
            token,
            access_token: token,
            ...(upstreamRefreshToken ? { refresh_token: upstreamRefreshToken } : {}),
            expires_in: upstreamData.expires_in || 3600,
          });
          return;
        }

        if (upstreamRes.status >= 500) {
          res.status(502).json({
            error:
              upstreamData?.detail ||
              upstreamData?.error ||
              upstreamData?.message ||
              `Authentication gateway returned HTTP ${upstreamRes.status}. Please retry in a few seconds.`,
          });
          return;
        }

        const upstreamErrMsg =
          upstreamData?.detail ||
          upstreamData?.error ||
          upstreamData?.message ||
          (upstreamRes.status === 403
            ? 'Access forbidden or account requires verification.'
            : upstreamRes.status === 429
              ? 'Too many sign-in attempts. Please wait a moment and try again.'
              : 'Invalid email address or credentials.');
        res.status(upstreamRes.status || 401).json({ error: String(upstreamErrMsg) });
        return;
      } catch (err: unknown) {
        const isAbort =
          err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
        res.status(isAbort ? 504 : 502).json({
          error: isAbort
            ? 'Authentication gateway timed out while waking up. Please try signing in again.'
            : 'Unable to reach authentication gateway. Check network or register a local workspace account.',
        });
        return;
      }
    }

    res.status(401).json({ error: 'Invalid email address or password.' });
  };

  const handleSignupRequest = async (req: Request, res: Response) => {
    if (ctx.isIpBlocked(req)) {
      res.status(403).json({ error: 'Access blocked by platform WAF firewall.' });
      return;
    }
    if (!ctx.platformConfig.allowNewSignups) {
      res.status(403).json({
        error: 'New account registrations are currently paused by the platform administrator.',
      });
      return;
    }

    const parsed = parseBody(signupSchema, req, res);
    if (!parsed.ok) return;
    const { name, email, password } = parsed.data;
    const rawEmail = email;
    const cleanName = String(name || (rawEmail ? String(rawEmail).split('@')[0] : '')).trim();
    if (!cleanName || !rawEmail || !password) {
      res.status(400).json({ error: 'Name, email, and password are required.' });
      return;
    }

    const cleanEmail = String(rawEmail).trim().toLowerCase();
    const existing = ctx.usersDb.find((u) => u.email.toLowerCase() === cleanEmail);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const remoteGatewayUrl = process.env.SUPREMEAI_BACKEND_URL?.trim() || DEFAULT_BACKEND_ORIGIN;
    if (remoteGatewayUrl) {
      try {
        const upstreamRes = await fetch(`${remoteGatewayUrl}/api/v1/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          signal: AbortSignal.timeout(12000),
          body: JSON.stringify({
            name: cleanName,
            email: cleanEmail,
            username: cleanEmail,
            password,
          }),
        });
        const upstreamData = asUpstreamJson(await upstreamRes.json().catch(() => null));
        if (upstreamRes.ok && upstreamData && (upstreamData.access_token || upstreamData.token)) {
          const remoteUser = asUpstreamJson(upstreamData.user) ?? upstreamData;
          const rbac = ctx.resolveRbacUserProfile(cleanEmail, {
            rbacRole: upstreamString(remoteUser.rbacRole) || upstreamString(remoteUser.role),
            isAdminEligible: Boolean(remoteUser.isAdminEligible ?? remoteUser.is_admin_eligible),
          }, undefined);
          const token = String(upstreamData.access_token || upstreamData.token);
          const safeUser = {
            id: String(remoteUser.id || remoteUser.user_id || `usr_${Date.now()}`),
            user_id: String(remoteUser.id || remoteUser.user_id || `usr_${Date.now()}`),
            name: String(remoteUser.name || cleanName),
            email: cleanEmail,
            avatar: cleanName.charAt(0).toUpperCase(),
            role: rbac.role,
            rbacRole: rbac.rbacRole,
            isAdminEligible: rbac.isAdminEligible,
            adminEmailMatched: rbac.adminEmailMatched,
            isDeveloperEligible: rbac.isDeveloperEligible,
            adminUserId: rbac.adminUserId,
            plan: upstreamString(remoteUser.plan) || 'Free',
            createdAt: String(remoteUser.createdAt || new Date().toISOString().slice(0, 10)),
            adminEmails: rbac.adminEmails,
          };
          if (rbac.isAdminEligible) ctx.setAdminSessionCookie(req, res, token);
          const upstreamRefreshToken =
            upstreamData.refresh_token || upstreamData.refreshToken || undefined;
          if (upstreamRefreshToken) ctx.setRefreshTokenCookie(req, res, String(upstreamRefreshToken));
          res.json({
            success: true,
            user: safeUser,
            role: safeUser.role,
            rbacRole: safeUser.rbacRole,
            isAdminEligible: safeUser.isAdminEligible,
            adminEmailMatched: safeUser.adminEmailMatched,
            adminEmails: safeUser.adminEmails,
            token,
            access_token: token,
            ...(upstreamRefreshToken ? { refresh_token: upstreamRefreshToken } : {}),
            expires_in: upstreamData.expires_in || 3600,
          });
          return;
        }
        if (
          upstreamRes.status === 409 ||
          upstreamRes.status === 400 ||
          upstreamRes.status === 422
        ) {
          res.status(upstreamRes.status).json({
            error:
              upstreamData?.detail ||
              upstreamData?.error ||
              upstreamData?.message ||
              (upstreamRes.status === 409
                ? 'An account with this email already exists.'
                : 'Invalid signup details provided.'),
          });
          return;
        }
      } catch {
        // Fall through to persisted local registration
      }
    }

    const existingCust = ctx.customerDirectory.find((c) => c.email.toLowerCase() === cleanEmail);
    const rbac = ctx.resolveRbacUserProfile(cleanEmail, undefined, existingCust);
    const isAdmin = rbac.isAdminEligible;
    const devEligible = isAdmin || Boolean(existingCust?.isDeveloperEligible);
    const assignedPlan: PlanTier = isAdmin ? 'Enterprise' : (existingCust?.tier as PlanTier) || 'Free';
    const newUser: ServerUser = {
      id: `usr_${Date.now()}`,
      name: cleanName,
      email: cleanEmail,
      passwordHash: hashPassword(String(password)),
      role: rbac.role,
      rbacRole: rbac.rbacRole,
      isAdminEligible: isAdmin,
      isDeveloperEligible: devEligible,
      adminUserId: rbac.adminUserId,
      plan: assignedPlan,
      createdAt: new Date().toISOString().slice(0, 10),
      avatar: cleanName.charAt(0).toUpperCase(),
    };

    ctx.usersDb.push(newUser);

    if (!existingCust) {
      const planSpec = getPlanSpec(assignedPlan);
      ctx.customerDirectory.unshift({
        id: `cust_${String(Date.now()).slice(-4)}`,
        name: cleanName,
        email: cleanEmail,
        tier: assignedPlan,
        status: 'active',
        mrr: planSpec.monthlyPriceUsd,
        tokensUsed: 0,
        tokenLimit: planSpec.monthlyTokensLimit,
        connectedRepos: 0,
        joinedDate: newUser.createdAt,
        lastActive: 'Just now',
        region: 'Global',
        isDeveloperEligible: devEligible,
        isAdminEligible: isAdmin,
        rbacRole: rbac.rbacRole,
      });
    }

    ctx.recordAudit(
      cleanEmail,
      'USER_SIGNUP',
      `Customer: ${cleanEmail}`,
      `Registered under ${assignedPlan} tier (${devEligible ? 'Developer' : 'Standard'})`,
      req
    );

    const safeUser = ctx.buildSafeAuthUser(newUser, existingCust);
    const token = ctx.signLocalSessionToken({
      sub: newUser.id,
      email: newUser.email,
      iat: Date.now(),
      role: safeUser.isAdminEligible ? 'admin' : 'user',
    });
    ctx.activeAuthSessions.set(token, newUser.id);
    if (safeUser.isAdminEligible) {
      ctx.setAdminSessionCookie(req, res, token);
    }
    const refreshToken = ctx.issueLocalRefreshToken(newUser.id);
    ctx.setRefreshTokenCookie(req, res, refreshToken);
    res.json({
      success: true,
      user: safeUser,
      role: safeUser.role,
      rbacRole: safeUser.rbacRole,
      isAdminEligible: safeUser.isAdminEligible,
      adminEmailMatched: safeUser.adminEmailMatched,
      adminEmails: safeUser.adminEmails,
      token,
      access_token: token,
      refresh_token: refreshToken,
      expires_in: 3600,
    });
  };

  const handleGetMeRequest = async (req: Request, res: Response) => {
    const authHeader = String(req.headers.authorization || '').trim();
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    if (!token || token.startsWith('tok_guest_') || token.startsWith('sk-supreme-guest')) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const sessionUserId = ctx.activeAuthSessions.get(token);
    const verifiedPayload = ctx.verifyLocalSessionToken(token);

    if (sessionUserId || verifiedPayload) {
      const lookupEmail = verifiedPayload?.email?.toLowerCase();
      const matchedUser =
        (sessionUserId ? ctx.usersDb.find((u) => u.id === sessionUserId) : undefined) ||
        (lookupEmail ? ctx.usersDb.find((u) => u.email.toLowerCase() === lookupEmail) : undefined);

      const emailToResolve = (matchedUser?.email || lookupEmail || '').toLowerCase();
      if (!emailToResolve) {
        res.status(401).json({ error: 'Invalid or expired session.' });
        return;
      }

      const customerRec = ctx.customerDirectory.find((c) => c.email.toLowerCase() === emailToResolve);
      const tokenClaimsAdmin = verifiedPayload?.role === 'admin';
      const effectiveUser: ServerUser = matchedUser || {
        id: verifiedPayload?.sub || `usr_${Date.now()}`,
        name: customerRec?.name || emailToResolve.split('@')[0],
        email: emailToResolve,
        passwordHash: '',
        role: tokenClaimsAdmin ? 'admin' : 'user',
        isAdminEligible: tokenClaimsAdmin,
        isDeveloperEligible: tokenClaimsAdmin || Boolean(customerRec?.isDeveloperEligible),
        plan: (customerRec?.tier as PlanTier) || (tokenClaimsAdmin ? 'Enterprise' : 'Pro'),
        createdAt: customerRec?.joinedDate || new Date().toISOString().slice(0, 10),
      };

      const safeUser = ctx.buildSafeAuthUser(effectiveUser, customerRec);
      res.json({
        success: true,
        ...safeUser,
        user: safeUser,
      });
      return;
    }

    if (!token.startsWith('tok_') && !token.startsWith('mock_tok_')) {
      const remoteGatewayUrl = process.env.SUPREMEAI_BACKEND_URL?.trim() || DEFAULT_BACKEND_ORIGIN;
      try {
        const upstreamRes = await fetch(`${remoteGatewayUrl}/api/v1/auth/me`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(9000),
        });
        if (upstreamRes.ok) {
          const data = asUpstreamJson(await upstreamRes.json().catch(() => null));
          if (data && typeof data === 'object') {
            const nestedUser = asUpstreamJson(data.user);
            const raw: UpstreamJson = nestedUser ? { ...data, ...nestedUser } : data;
            const cleanEmail = String(raw.email || '').trim().toLowerCase();
            if (cleanEmail) {
              const matchedUser = ctx.usersDb.find((u) => u.email.toLowerCase() === cleanEmail);
              const customerRec = ctx.customerDirectory.find(
                (c) => c.email.toLowerCase() === cleanEmail
              );
              const upstreamAdminEmails: string[] = [
                ...upstreamStringList(data.adminEmails),
                ...upstreamStringList(data.admin_emails),
              ];
              const upstreamRbac =
                upstreamString(raw.rbacRole) ||
                upstreamString(raw.rbac_role) ||
                upstreamString(raw.role);
              const rbac = ctx.resolveRbacUserProfile(
                cleanEmail,
                matchedUser || {
                  rbacRole: upstreamRbac,
                  isAdminEligible: Boolean(
                    raw.isAdminEligible ?? raw.is_admin_eligible ?? raw.is_admin
                  ),
                  isDeveloperEligible: Boolean(
                    raw.isDeveloperEligible ?? raw.is_developer_eligible
                  ),
                  adminUserId:
                    upstreamString(raw.adminUserId) || upstreamString(raw.admin_user_id),
                },
                customerRec,
                upstreamAdminEmails,
                upstreamRbac
              );
              const mergedUser = {
                id: String(raw.id || raw.user_id || matchedUser?.id || `usr_${Date.now()}`),
                user_id: String(raw.id || raw.user_id || matchedUser?.id || `usr_${Date.now()}`),
                name: String(raw.name || matchedUser?.name || cleanEmail.split('@')[0]),
                email: cleanEmail,
                avatar: String(raw.name || cleanEmail).charAt(0).toUpperCase(),
                role: rbac.role,
                rbacRole: rbac.rbacRole,
                isAdminEligible: rbac.isAdminEligible,
                adminEmailMatched: rbac.adminEmailMatched,
                isDeveloperEligible: rbac.isDeveloperEligible,
                adminUserId: rbac.adminUserId,
                plan:
                  customerRec?.tier ||
                  upstreamString(raw.plan) ||
                  matchedUser?.plan ||
                  (rbac.isAdminEligible ? 'Enterprise' : 'Pro'),
                createdAt: String(
                  raw.createdAt || matchedUser?.createdAt || new Date().toISOString().slice(0, 10)
                ),
                adminEmails: rbac.adminEmails,
              };
              res.json({
                success: true,
                ...mergedUser,
                user: mergedUser,
              });
              return;
            }
          }
        }
      } catch {
        // Upstream unavailable
      }
    }

    res.status(401).json({ error: 'Invalid or expired session token.' });
  };

  const handleGuestTokenRequest = async (_req: Request, res: Response) => {
    const remoteGatewayUrl = process.env.SUPREMEAI_BACKEND_URL?.trim() || DEFAULT_BACKEND_ORIGIN;
    try {
      const upstreamRes = await fetch(`${remoteGatewayUrl}/api/v1/auth/guest`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4500),
      });
      if (upstreamRes.ok) {
        const setCookie = upstreamRes.headers.get('set-cookie');
        if (setCookie) res.setHeader('Set-Cookie', setCookie);
        const data = await upstreamRes.json().catch(() => null);
        if (data && typeof data === 'object' && (data.access_token || data.token)) {
          res.json(data);
          return;
        }
      }
    } catch {
      // Upstream unavailable
    }

    const previewGuestToken = `tok_guest_${crypto.randomUUID()}`;
    res.json({
      status: 'ok',
      access_token: previewGuestToken,
      token_type: 'bearer',
      expires_in: 3600,
      class: 'guest',
      source: 'studio-preview',
      message: 'Preview guest trial access granted.',
    });
  };

  const handleRefreshRequest = async (req: Request, res: Response) => {
    const cookies = parseCookieHeader(req.headers.cookie);
    const parsedRefresh = parseBody(refreshSchema, req, res);
    const bodyRefreshToken = parsedRefresh.ok ? parsedRefresh.data.refresh_token : undefined;
    if (!parsedRefresh.ok && !cookies.supremeai_refresh_token) return;
    const presented = String(bodyRefreshToken || cookies.supremeai_refresh_token || '').trim();
    const entry = presented ? ctx.activeRefreshTokens.get(presented) : undefined;

    if (!entry && presented && !presented.startsWith('rt_')) {
      const remoteGatewayUrl = process.env.SUPREMEAI_BACKEND_URL?.trim() || DEFAULT_BACKEND_ORIGIN;
      try {
        const upstreamRes = await fetch(`${remoteGatewayUrl}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(req.headers.cookie ? { Cookie: String(req.headers.cookie) } : {}),
          },
          body: JSON.stringify({ refresh_token: presented }),
          signal: AbortSignal.timeout(9000),
        });
        const upstreamData = asUpstreamJson(await upstreamRes.json().catch(() => null));
        if (upstreamRes.ok && upstreamData && (upstreamData.access_token || upstreamData.token)) {
          const upstreamSetCookie = upstreamRes.headers.get('set-cookie');
          if (upstreamSetCookie) res.append('Set-Cookie', upstreamSetCookie);
          const nextRefresh = upstreamData.refresh_token || upstreamData.refreshToken;
          if (nextRefresh) ctx.setRefreshTokenCookie(req, res, String(nextRefresh));
          res.json(upstreamData);
          return;
        }
      } catch {
        // Fall through to 401
      }
    }

    if (!entry || entry.expiresAt <= Date.now()) {
      if (presented) ctx.activeRefreshTokens.delete(presented);
      res.status(401).json({ error: 'Invalid or expired refresh token.' });
      return;
    }

    const user = ctx.usersDb.find((u) => u.id === entry.userId);
    if (!user) {
      ctx.activeRefreshTokens.delete(presented);
      res.status(401).json({ error: 'Session user no longer exists.' });
      return;
    }

    const customerRec = ctx.customerDirectory.find(
      (c) => c.email.toLowerCase() === user.email.toLowerCase()
    );
    if (customerRec?.status === 'suspended') {
      ctx.activeRefreshTokens.delete(presented);
      res.status(403).json({ error: 'This account has been suspended by a platform administrator.' });
      return;
    }

    const safeUser = ctx.buildSafeAuthUser(user, customerRec);
    const token = ctx.signLocalSessionToken({
      sub: user.id,
      email: user.email,
      iat: Date.now(),
      role: safeUser.isAdminEligible ? 'admin' : 'user',
    });
    ctx.activeAuthSessions.set(token, user.id);

    ctx.activeRefreshTokens.delete(presented);
    const rotatedRefreshToken = ctx.issueLocalRefreshToken(user.id);
    ctx.setRefreshTokenCookie(req, res, rotatedRefreshToken);

    res.json({
      success: true,
      user: safeUser,
      token,
      access_token: token,
      refresh_token: rotatedRefreshToken,
      token_type: 'bearer',
      expires_in: 3600,
    });
  };

  app.post('/api/auth/refresh', handleRefreshRequest);
  app.post('/api/v1/auth/refresh', handleRefreshRequest);
  app.post('/api/auth/login', handleLoginRequest);
  app.post('/api/v1/auth/login', handleLoginRequest);
  app.post('/api/auth/signup', handleSignupRequest);
  app.post('/api/v1/auth/register', handleSignupRequest);
  app.post('/api/v1/auth/guest', handleGuestTokenRequest);
  app.post('/api/v1/guest/token', handleGuestTokenRequest);
  app.get('/api/auth/me', handleGetMeRequest);
  app.get('/api/v1/auth/me', handleGetMeRequest);
  // বাংলা মন্তব্য: /api/auth/logout ও /api/v1/auth/logout উভয় পাথেই লোকাল ও আপস্ট্রিম সেশন ক্যাশ তাৎক্ষণিক বাতিল করা হচ্ছে
  app.post(['/api/auth/logout', '/api/v1/auth/logout'], (req: Request, res: Response) => {
    const authHeader = String(req.headers.authorization || '').trim();
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const adminHeader = String(req.headers['x-admin-token'] || '').trim();
    const cookies = parseCookieHeader(req.headers.cookie);
    const adminCookie = cookies.supremeai_admin_session || '';
    for (const candidate of [token, adminHeader, adminCookie]) {
      if (!candidate) continue;
      ctx.activeAuthSessions.delete(candidate);
      ctx.activeAdminSessions.delete(candidate);
      ctx.revokeSessionToken?.(candidate);
      const tokenHash = crypto.createHash('sha256').update(candidate).digest('hex');
      ctx.upstreamTokenAdminCache.delete(tokenHash);
    }
    const presentedRefreshTokens = [
      String(req.body?.refresh_token || '').trim(),
      cookies.supremeai_refresh_token || '',
    ];
    for (const candidate of presentedRefreshTokens) {
      if (candidate) ctx.activeRefreshTokens.delete(candidate);
    }
    res.clearCookie('supremeai_refresh_token', { path: '/api' });
    res.clearCookie('supremeai_refresh_token', { path: '/api/v1/auth' });
    res.clearCookie('supremeai_admin_session', { path: '/api' });
    res.clearCookie('supremeai_admin_session', { path: '/api/admin' });
    res.json({ success: true });
  });
}
