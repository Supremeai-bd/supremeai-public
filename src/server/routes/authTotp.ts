import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { buildOtpAuthUri, generateTotpSecret, verifyTotpToken } from '../totp';
import { parseCookieHeader } from '../../shared/serverSecurity';
import { parseBody, totpConfirmSchema, verify2faSchema } from '../validation';

/**
 * RFC 6238 TOTP — `GET/POST /api/auth/totp/*` + `POST /api/auth/verify-2fa`
 *
 * WHY THIS FILE EXISTS
 *   TOTP enrollment/verification surface (vault + 4 handlers + helpers) lived
 *   inline in `server.ts` (~310 lines). Cohesive (single vault file, single
 *   pending map, single admin-eligibility helper) and has no other consumer.
 *   Moving it keeps the monolith shrinking.
 *
 * CONTRACT WITH server.ts
 *   - `TOTP_VAULT_PATH` + `pendingTotpSecrets` + `totpVault` + `loadTotpVault` +
 *     `saveTotpVault` + `resolveAdminEligibilityForTotp` + `getActiveTotpConfig`
 *     + 4 route handlers are OWNED here (no other route reads totpVault).
 *   - `activeAuthSessions` + `activeAdminSessions` injected as mutable Maps
 *     (by reference, never reassigned).
 *   - `customerDirectory` + `usersDb` injected read-only for RBAC lookup.
 *   - `verifyLocalSessionToken`, `resolveRbacUserProfile`, `recordAudit`
 *     injected via ctx (closures over auth state).
 */

interface TotpVaultEntry {
  secret: string;
  enrolledAt: string;
  lastAcceptedStep?: number;
}

export interface AuthTotpContext {
  activeAuthSessions: Map<string, string>;
  activeAdminSessions: Map<string, number>;
  get customerDirectory(): readonly { email: string; tier?: string; id?: string }[];
  get usersDb(): readonly { id: string; email: string; isAdminEligible?: boolean; rbacRole?: string; adminUserId?: string }[];
  verifyLocalSessionToken: (token: string) => { sub?: string; email: string; iat?: number; role?: string } | null;
  resolveRbacUserProfile: (
    email: string,
    matchedUser: any,
    matchedCustomer: any,
    adminEmails?: string[],
    rawRole?: string
  ) => { isAdminEligible: boolean };
  recordAudit: (actor: string, action: string, resource: string, details: string, req: Request) => void;
}

export function registerAuthTotpRoutes(app: Express, ctx: AuthTotpContext): void {
  const TOTP_VAULT_PATH = path.join(process.cwd(), '.supremeai-totp-vault.json');
  const pendingTotpSecrets = new Map<string, { secret: string; expiresAt: number }>();

  const loadTotpVault = (): Record<string, TotpVaultEntry> => {
    try {
      if (fs.existsSync(TOTP_VAULT_PATH)) {
        const raw = fs.readFileSync(TOTP_VAULT_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {}
    return {};
  };

  const saveTotpVault = (vault: Record<string, TotpVaultEntry>) => {
    try {
      fs.writeFileSync(TOTP_VAULT_PATH, JSON.stringify(vault, null, 2), { mode: 0o600 });
    } catch {}
  };

  const totpVault: Record<string, TotpVaultEntry> = loadTotpVault();

  const resolveAdminEligibilityForTotp = async (req: Request, rawEmail?: string) => {
    const authHeader = String(req.headers.authorization || '').trim();
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const cookies = parseCookieHeader(req.headers.cookie);
    const adminCookie = (cookies['supremeai_admin_session'] || '').trim();
    const candidateToken = bearer || adminCookie;

    if (
      !candidateToken ||
      candidateToken.startsWith('tok_guest_') ||
      candidateToken.startsWith('sk-supreme-guest')
    ) {
      return { cleanEmail: '', isEligible: false };
    }

    const requestedEmail = String(rawEmail || '')
      .trim()
      .toLowerCase();

    const verifiedPayload = ctx.verifyLocalSessionToken(candidateToken);
    const sessionUserId = ctx.activeAuthSessions.get(candidateToken);
    const sessionUser = sessionUserId ? ctx.usersDb.find((u) => u.id === sessionUserId) : undefined;
    const adminCookieExp = ctx.activeAdminSessions.get(candidateToken);

    if (verifiedPayload || sessionUser) {
      if (verifiedPayload?.sub === 'admin_passkey') {
        if (!adminCookieExp || adminCookieExp <= Date.now()) {
          ctx.activeAdminSessions.delete(candidateToken);
          return { cleanEmail: '', isEligible: false };
        }
        const passkeyEmail = verifiedPayload.email.toLowerCase();
        if (requestedEmail && requestedEmail !== passkeyEmail) {
          return { cleanEmail: '', isEligible: false };
        }
        return { cleanEmail: passkeyEmail, isEligible: true };
      }

      const verifiedEmail = (sessionUser?.email || verifiedPayload?.email || '')
        .trim()
        .toLowerCase();
      if (!verifiedEmail) {
        return { cleanEmail: '', isEligible: false };
      }
      if (requestedEmail && requestedEmail !== verifiedEmail) {
        return { cleanEmail: '', isEligible: false };
      }
      const matchedUser =
        sessionUser || ctx.usersDb.find((u) => u.email.toLowerCase() === verifiedEmail);
      const matchedCustomer = ctx.customerDirectory.find(
        (c) => c.email.toLowerCase() === verifiedEmail
      );
      const rbac = ctx.resolveRbacUserProfile(verifiedEmail, matchedUser, matchedCustomer as any);
      return { cleanEmail: verifiedEmail, isEligible: rbac.isAdminEligible };
    }

    if (bearer && !bearer.startsWith('tok_') && !bearer.startsWith('mock_tok_')) {
      const remoteGatewayUrl =
        process.env.SUPREMEAI_BACKEND_URL?.trim() || 'https://supremeai-api-ulw0.onrender.com';
      try {
        const upstreamRes = await fetch(`${remoteGatewayUrl}/api/v1/auth/me`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(4000),
        });
        if (upstreamRes.ok) {
          const data: any = await upstreamRes.json().catch(() => null);
          const raw =
            data?.user && typeof data.user === 'object' ? { ...data, ...data.user } : data;
          const upEmail = String(raw?.email || '')
            .trim()
            .toLowerCase();
          if (upEmail && (!requestedEmail || requestedEmail === upEmail)) {
            const matchedCustomer = ctx.customerDirectory.find(
              (c) => c.email.toLowerCase() === upEmail
            );
            const upRbac = ctx.resolveRbacUserProfile(
              upEmail,
              {
                rbacRole: raw?.rbacRole || raw?.rbac_role || raw?.role,
                isAdminEligible: Boolean(
                  raw?.isAdminEligible ?? raw?.is_admin_eligible ?? raw?.is_admin
                ),
                adminUserId: raw?.adminUserId || raw?.admin_user_id,
              },
              matchedCustomer as any,
              Array.isArray(data?.adminEmails) ? data.adminEmails : [],
              raw?.rbacRole || raw?.rbac_role || raw?.role
            );
            return { cleanEmail: upEmail, isEligible: upRbac.isAdminEligible };
          }
        }
      } catch {}
    }

    return { cleanEmail: '', isEligible: false };
  };

  const getActiveTotpConfig = (
    cleanEmail: string
  ): { secret: string; source: 'user_vault' | 'env'; lastAcceptedStep: number | null } | null => {
    const vaultEntry = totpVault[cleanEmail];
    if (vaultEntry?.secret) {
      return {
        secret: vaultEntry.secret,
        source: 'user_vault',
        lastAcceptedStep:
          typeof vaultEntry.lastAcceptedStep === 'number' ? vaultEntry.lastAcceptedStep : null,
      };
    }
    const envSecret = process.env.ADMIN_TOTP_SECRET?.trim();
    if (envSecret) {
      return {
        secret: envSecret,
        source: 'env',
        lastAcceptedStep:
          typeof vaultEntry?.lastAcceptedStep === 'number' ? vaultEntry.lastAcceptedStep : null,
      };
    }
    return null;
  };

  // GET /api/auth/totp/status - Check whether admin has enrolled a real RFC 6238 TOTP secret
  app.get('/api/auth/totp/status', async (req: Request, res: Response) => {
    const requestedEmail = typeof req.query.userEmail === 'string' ? req.query.userEmail : '';
    const { cleanEmail, isEligible } = await resolveAdminEligibilityForTotp(req, requestedEmail);
    if (!isEligible) {
      res
        .status(403)
        .json({ error: 'Unauthorized: Email does not match an Administrator RBAC role.' });
      return;
    }

    const active = getActiveTotpConfig(cleanEmail);
    res.json({
      enrolled: Boolean(active),
      source: active?.source || 'none',
      issuer: 'SupremeAI Studio',
      accountName: cleanEmail,
    });
  });

  // POST /api/auth/totp/setup - Generate a fresh cryptographic Base32 secret & QR code for Authenticator pairing
  app.post('/api/auth/totp/setup', async (req: Request, res: Response) => {
    const { userEmail, currentToken } = req.body || {};
    const { cleanEmail, isEligible } = await resolveAdminEligibilityForTotp(req, userEmail);
    if (!isEligible) {
      res
        .status(403)
        .json({ error: 'Unauthorized: Email does not match an Administrator RBAC role.' });
      return;
    }

    const existing = getActiveTotpConfig(cleanEmail);
    if (existing) {
      const check = verifyTotpToken(existing.secret, String(currentToken || ''), {
        lastAcceptedStep: existing.lastAcceptedStep,
      });
      if (!check.valid) {
        res.status(401).json({
          error:
            'TOTP is already enrolled. Enter your current 6-digit Authenticator code to rotate your TOTP key.',
          requiresCurrentToken: true,
        });
        return;
      }
      if (check.matchedStep !== null) {
        totpVault[cleanEmail] = {
          ...(totpVault[cleanEmail] || {
            secret: existing.secret,
            enrolledAt: new Date().toISOString(),
          }),
          lastAcceptedStep: check.matchedStep,
        };
        saveTotpVault(totpVault);
      }
    }

    const secret = generateTotpSecret(20);
    pendingTotpSecrets.set(cleanEmail, {
      secret,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const otpauthUrl = buildOtpAuthUri({
      secret,
      accountName: cleanEmail,
      issuer: 'SupremeAI Studio',
    });

    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
      width: 220,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    });

    res.json({
      success: true,
      secret,
      otpauthUrl,
      qrDataUrl,
      issuer: 'SupremeAI Studio',
      accountName: cleanEmail,
    });
  });

  // POST /api/auth/totp/confirm - Confirm Authenticator pairing with a live 6-digit RFC 6238 code
  app.post('/api/auth/totp/confirm', async (req: Request, res: Response) => {
    const parsed = parseBody(totpConfirmSchema, req, res);
    if (!parsed.ok) return;
    const { userEmail, token, trustFor7Days = false } = parsed.data;
    const { cleanEmail, isEligible } = await resolveAdminEligibilityForTotp(req, userEmail);
    if (!isEligible) {
      res
        .status(403)
        .json({ error: 'Unauthorized: Email does not match an Administrator RBAC role.' });
      return;
    }

    const pending = pendingTotpSecrets.get(cleanEmail);
    if (!pending || pending.expiresAt < Date.now()) {
      pendingTotpSecrets.delete(cleanEmail);
      res.status(400).json({
        error: 'TOTP pairing session expired. Please generate a new Authenticator QR code.',
      });
      return;
    }

    const verification = verifyTotpToken(pending.secret, String(token || ''));
    if (!verification.valid) {
      res.status(401).json({
        success: false,
        error:
          'Invalid 6-digit Authenticator code. Verify your device clock is synced and try again.',
      });
      return;
    }

    totpVault[cleanEmail] = {
      secret: pending.secret,
      enrolledAt: new Date().toISOString(),
      lastAcceptedStep: verification.matchedStep ?? undefined,
    };
    saveTotpVault(totpVault);
    pendingTotpSecrets.delete(cleanEmail);

    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const trustedUntil = trustFor7Days ? Date.now() + SEVEN_DAYS_MS : null;
    const deviceId = `trusted_dev_${crypto.randomBytes(6).toString('hex')}`;

    ctx.recordAudit(
      cleanEmail,
      'ADMIN_TOTP_ENROLLED',
      'Admin Studio Ingress',
      `Real RFC 6238 TOTP enrolled${trustFor7Days ? ' (7-day trust)' : ''}`,
      req
    );

    res.json({
      success: true,
      verified: true,
      enrolled: true,
      authMethod: 'rfc6238_totp',
      trustedBrowser: Boolean(trustFor7Days),
      trustedUntil,
      deviceId: trustFor7Days ? deviceId : null,
      message: 'Authenticator app paired and 2-Step Verification passed.',
    });
  });

  // POST /api/auth/verify-2fa (Real RFC 6238 TOTP token only, with replay protection & 7-day trust)
  app.post('/api/auth/verify-2fa', async (req: Request, res: Response) => {
    const parsed = parseBody(verify2faSchema, req, res);
    if (!parsed.ok) return;
    const { token, method, trustFor7Days = false, userEmail } = parsed.data;

    const { cleanEmail, isEligible } = await resolveAdminEligibilityForTotp(req, userEmail);
    if (!isEligible) {
      res.status(403).json({
        error: 'Unauthorized: Email does not match an Administrator RBAC role in the database.',
      });
      return;
    }

    if (method && method !== 'totp') {
      res.status(400).json({
        success: false,
        error: 'Only real Authenticator TOTP verification is permitted for Admin access.',
      });
      return;
    }

    const activeTotp = getActiveTotpConfig(cleanEmail);
    if (!activeTotp) {
      res.status(428).json({
        success: false,
        requiresTotpSetup: true,
        error:
          'Authenticator TOTP is not enrolled yet for this admin account. Pair your Authenticator app first.',
      });
      return;
    }

    const verification = verifyTotpToken(activeTotp.secret, String(token || ''), {
      lastAcceptedStep: activeTotp.lastAcceptedStep,
    });

    if (!verification.valid) {
      const errorMsg =
        verification.reason === 'replayed_step'
          ? 'This 6-digit TOTP code has already been used. Wait for the next 30-second code.'
          : 'Invalid or expired 6-digit TOTP code. Enter the live code from your Authenticator app.';
      res.status(401).json({
        success: false,
        error: errorMsg,
      });
      return;
    }

    if (verification.matchedStep !== null) {
      totpVault[cleanEmail] = {
        secret: totpVault[cleanEmail]?.secret || activeTotp.secret,
        enrolledAt: totpVault[cleanEmail]?.enrolledAt || new Date().toISOString(),
        lastAcceptedStep: verification.matchedStep,
      };
      saveTotpVault(totpVault);
    }

    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const trustedUntil = trustFor7Days ? Date.now() + SEVEN_DAYS_MS : null;
    const deviceId = `trusted_dev_${crypto.randomBytes(6).toString('hex')}`;

    ctx.recordAudit(
      cleanEmail,
      'ADMIN_2FA_VERIFIED',
      'Admin Studio Ingress',
      `Method: rfc6238_totp${trustFor7Days ? ' (7-day trust)' : ''}`,
      req
    );

    res.json({
      success: true,
      verified: true,
      authMethod: 'rfc6238_totp',
      trustedBrowser: Boolean(trustFor7Days),
      trustedUntil,
      deviceId: trustFor7Days ? deviceId : null,
      message: trustFor7Days
        ? '2-Step Verification passed. This browser is trusted for the next 7 days.'
        : '2-Step Verification passed successfully.',
    });
  });
}
