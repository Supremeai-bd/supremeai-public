import express, { NextFunction, Request, Response } from 'express';
import http from 'http';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import { attachWebSocketBridges } from './src/server/wsBridge';
import { PersistentSessionMap } from './src/server/redisStore';
import { registerControlPlaneRoutes } from './src/server/controlPlaneRouter';
import { registerMcpTowerRoutes } from './src/server/routes/mcpTowerRoutes';
import { registerAdminCustomerRoutes } from './src/server/routes/admin/customers';
import { registerAdminSecurityRoutes } from './src/server/routes/admin/security';
import { registerAdminSwarmQueueRoutes } from './src/server/routes/admin/swarmQueue';
import { registerAdminPlatformRoutes } from './src/server/routes/admin/platform';
import { registerAdminProvidersRoutes } from './src/server/routes/admin/providers';
import { registerAdminSystemRoutes } from './src/server/routes/admin/system';
import { registerWorkspaceTerminalRoutes } from './src/server/routes/workspace/terminal';
import { registerWorkspaceBrowserProxyRoutes } from './src/server/routes/workspace/browserProxy';
import { registerWorkspaceBrowserVaultRoutes } from './src/server/routes/workspace/browserVault';
import { registerWorkspaceGmailSessionRoutes } from './src/server/routes/workspace/gmailSession';
import { registerWorkspaceBrowserSchedulesRoutes } from './src/server/routes/workspace/browserSchedules';
import { registerConversationsRoutes } from './src/server/routes/conversations';
import { registerProjectsRoutes } from './src/server/routes/projects';
import { registerApiKeysRoutes } from './src/server/routes/apiKeys';
import { registerTeamRoutes } from './src/server/routes/team';
import { registerWebhooksRoutes } from './src/server/routes/webhooks';
import { registerAuthTotpRoutes } from './src/server/routes/authTotp';
import { registerBillingRoutes } from './src/server/routes/billing';
import { registerGitOauthRoutes } from './src/server/routes/gitOauth';
import { registerMediaRoutes } from './src/server/routes/media';
import { registerAuthRoutes } from './src/server/routes/auth';
import { registerFeedbackRoutes } from './src/server/routes/feedback';
import { mountApiOnExpress } from './src/api/node';
import { createGatewayCatalogFetcher } from './src/server/routes/telemetry';
import { registerStreamRoutes } from './src/server/routes/stream';
import { registerGraphRoutes } from './src/server/routes/graph';
import { registerTtsRoutes } from './src/server/routes/tts';
import { registerPreferencesRoutes } from './src/server/routes/preferences';
import { CANONICAL_SERVER_MODELS } from './src/shared/platformCatalog';
import { registerKnowledgeRoutes } from './src/server/routes/knowledge';
import { registerLlmLatencyRoutes } from './src/server/routes/llmLatency';
import {
  getRealGatewayTrafficSummary,
  recordHttpRequestMetric,
} from './src/server/mcpHealthCollector';
import {
  resolveReasoningEffort,
  resolveServerAutoModel,
  resolveUpstreamGeminiModel,
  extractTextFromMessageContent,
  messageHasVisionOrAttachment,
  messageHasActualImage,
  buildGeminiPartsFromMessage,
  buildGeminiGenerateConfig,
  collectGroundingSourcesAndUsage,
  countImagesInMessages,
  executeFreeVisionCascade,
} from './src/server/geminiVision';
import { buildDurableAuditRow } from './src/server/auditPayload';
import { createRateLimiter, isHttpsRequest, safeFetchWithRedirectCheck } from './src/server/httpGuards';
import { createMcpClusterServices } from './src/server/mcpClusterServices';
import {
  buildInfisicalVaultKeys as buildProviderVaultKeys,
  createInfisicalExtraVaultKeys,
  createProviderMesh,
  maskServerSecret,
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_KEY_ENV,
  probeProviderUpstream,
} from './src/server/providerRegistry';
import { registerFederationProxy } from './src/server/federationProxy';
import {
  createAuditSeed,
  createBlockedIpsSeed,
  createPlatformConfig,
  createRuntimeFeatureFlags,
  getClientIp,
  loadDurablePlatformState,
  TIER_RANK,
  verifyGatewaySchema,
  type BlockedIpEntry,
  type PlanTier,
  type ServerAuditRecord,
} from './src/server/platformState';
import { supabaseRestRequest } from './src/server/supabaseRest';
import {
  createAdminIdentityConfig,
  createCustomerDirectorySeed,
  getSessionSigningSecret,
  type RbacRole,
  type ServerCustomerRecord,
  type ServerUser,
} from './src/server/userDirectory';
import { mountFrontend, registerErrorHandler } from './src/server/frontendServing';
import {
  ADMIN_SESSION_TTL_MS,
  parseCookieHeader,
  signSessionToken,
  verifySessionToken,
} from './src/shared/serverSecurity';
import { classifyVisionHttpError } from './src/shared/visionRouting';
import { detectBengaliOrBanglish } from './src/utils/speechUtils';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return String(pkg.version || '2.5.0').trim();
  } catch {
    return '2.5.0';
  }
})();

const portArgIndex = process.argv.indexOf('--port');
const portEqArg = process.argv.find((arg) => arg.startsWith('--port='));
const PORT =
  portArgIndex !== -1
    ? Number(process.argv[portArgIndex + 1]) || Number(process.env.PORT) || 3000
    : portEqArg
      ? Number(portEqArg.split('=')[1]) || Number(process.env.PORT) || 3000
      : Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// বাংলা মন্তব্য: সব প্ল্যাটফর্মের জন্য একক ক্যানোনিকাল মডেল ম্যাপ (`packages/contracts/models.json`)
const SUPPORTED_MODELS = CANONICAL_SERVER_MODELS;

const apiKey = process.env.GEMINI_API_KEY || '';

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // isHttpsRequest lives in src/server/httpGuards.ts.

  // Baseline production security headers (iframe-compatible for AI Studio preview)
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
    if (isProduction && isHttpsRequest(req)) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // SSRF-hardened outbound fetch (safeFetchWithRedirectCheck) lives in src/server/httpGuards.ts.

  // Real HTTP request throughput & latency instrumentation (excludes SSE streams)
  app.use('/api', (req, res, next) => {
    if (req.path.includes('/stream') || req.path === '/health') {
      next();
      return;
    }
    const start = Date.now();
    res.on('finish', () => {
      recordHttpRequestMetric(Date.now() - start, res.statusCode >= 500);
    });
    next();
  });
  // বাংলা মন্তব্য: Unified Hono API (src/api, Edge-এর সাথে একই কোড) — express.json()-এর আগে, body অক্ষত রাখতে
  // বাংলা মন্তব্য: callback request-time-এ চলে; তখন নিচের gateway cache সম্পূর্ণ initialized।
  mountApiOnExpress(app, { fetchGatewayJson: (p, t) => fetchGatewayJson(p, t) });
  app.use(express.json({ limit: '15mb' }));

  // Zero-dependency in-memory sliding-window rate limiter (per client IP) — src/server/httpGuards.ts.
  const makeRateLimit = createRateLimiter();
  app.use(['/api/chat', '/api/v1/chat', '/api/v1/stream/chat'], makeRateLimit(60_000, 60));
  app.use(
    [
      '/api/auth/login',
      '/api/v1/auth/login',
      '/api/auth/verify-2fa',
      '/api/auth/totp',
      '/api/admin/auth/verify',
    ],
    makeRateLimit(60_000, 10)
  );
  app.use('/api/mcp-tower', makeRateLimit(60_000, 30));

  // Cached fetch of live catalog data (models/plans) from the gateway, with a
  // short TTL and graceful fallback to the bundled static catalog.
  const GATEWAY_BASE = (
    process.env.SUPREMEAI_BACKEND_URL?.trim() || 'https://supremeai-api-ulw0.onrender.com'
  ).replace(/\/$/, '');
  const fetchGatewayJson = createGatewayCatalogFetcher(GATEWAY_BASE);

  // --- MCP Tower Services & Health Orchestration Endpoints ---  // --- MCP Tower Services & Health Orchestration Endpoints ---
  const mcpClusterServices = createMcpClusterServices();

  // MCP Tower proxy surface (health, services, reboot, probe, SSE stream) now
  // lives in src/server/routes/mcpTowerRoutes.ts. The four callbacks are passed
  // as lazy closures on purpose: `recordAudit`/`resolveAuditActor`/
  // `verifyAdminAuthorization` are declared further down this function, so a
  // direct reference here would hit the temporal dead zone. The handlers only
  // touch them at request time.
  registerMcpTowerRoutes(app, {
    mcpClusterServices,
    resolveAuditActor: (req, explicitActor) => resolveAuditActor(req, explicitActor),
    recordAudit: (actor, action, resource, details, req) =>
      recordAudit(actor, action, resource, details, req),
    verifyAdminAuthorization: (req) => verifyAdminAuthorization(req),
  });

  // --- Admin Platform Control Endpoints & Central Governance State ---
  // Seeds, getClientIp, the durable loader and the schema probe live in
  // src/server/platformState.ts; the mutable state + audit writer stay here.
  let runtimeFeatureFlags: Record<string, boolean> = createRuntimeFeatureFlags();
  let platformConfig = createPlatformConfig();
  const auditRecords: ServerAuditRecord[] = createAuditSeed(isProduction);

  const resolveAuditActor = (req?: Request, explicitActor?: unknown): string => {
    if (typeof explicitActor === 'string' && explicitActor.trim()) {
      return explicitActor.trim();
    }
    if (req) {
      const authHeader = String(req.headers.authorization || '').trim();
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (token) {
        const sessionUserId = activeAuthSessions.get(token);
        const matchedUser = sessionUserId ? usersDb.find((u) => u.id === sessionUserId) : undefined;
        if (matchedUser?.email) return matchedUser.email;
        const verifiedPayload = verifyLocalSessionToken(token);
        if (verifiedPayload?.email) return verifiedPayload.email;
      }
    }
    return 'system-operator';
  };

  const recordAudit = (
    actor: string,
    action: string,
    resource: string,
    details: string,
    req?: Request
  ) => {
    const entry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      actor: actor || resolveAuditActor(req),
      action,
      resource,
      details,
      ipAddress: req ? getClientIp(req) : '127.0.0.1',
    };
    auditRecords.unshift(entry);
    if (auditRecords.length > 200) {
      auditRecords.length = 200;
    }
    // Best-effort durable audit trail (survives redeploy when Supabase is configured).
    // NOTE: `audit_logs.id` is a bigint identity column, so the local `entry.id`
    // (an `audit_<ts>_<rand>` string used only for the in-memory list) must NOT be
    // sent — Postgres rejects it with 22P02 and the row is never written. The
    // durable id is assigned by the database.
    void supabaseRestRequest('audit_logs', 'POST', [buildDurableAuditRow(entry)]).catch(() => {});
  };

  let blockedIps: BlockedIpEntry[] = createBlockedIpsSeed(isProduction);

  const isIpBlocked = (req: Request): boolean => {
    const clientIp = getClientIp(req);
    return blockedIps.some((entry) => entry.ip === clientIp);
  };

  // Durable platform state (blocked IPs, feature flags, platform config) in Supabase
  // so Render redeploys/restarts do not reset them. Falls back to in-memory when unset.
  const persistPlatformState = () => {
    void supabaseRestRequest(
      'platform_settings',
      'POST',
      [
        {
          id: 'global',
          value: { blockedIps, runtimeFeatureFlags, platformConfig },
          updated_at: new Date().toISOString(),
        },
      ],
      'resolution=merge-duplicates,return=minimal'
    ).catch(() => {});
  };
  const loadPlatformState = () =>
    loadDurablePlatformState({ blockedIps, runtimeFeatureFlags, platformConfig, auditRecords });
  // বাংলা মন্তব্য: রুট রেজিস্ট্রেশনের আগেই দুর্যোগ-প্রতিরোধী প্ল্যাটফর্ম স্টেট লোড শেষ নিশ্চিত করা হচ্ছে — ফায়ার-অ্যান্ড-ফরগেট হলে প্রথম অনুরোধগুলো সিড/স্টেল স্টেট দেখে চলতে পারে।
  await loadPlatformState();

  void verifyGatewaySchema();

  // --- User Authentication & Unified Customer Directory ---
  // Admin identity config, record types, signing secret, dev users cache and the
  // demo customer seed live in src/server/userDirectory.ts.
  const { SEEDED_ADMIN_EMAILS, ADMIN_USER_IDS, ADMIN_RBAC_ROLES } = createAdminIdentityConfig();

  const TOKEN_SIGNING_SECRET = getSessionSigningSecret();
  const activeAdminSessions = new PersistentSessionMap<number>('supremeai:admin_sess:', 86_400, true);
  void activeAdminSessions.hydrateFromRedis().catch(() => {});
  const upstreamTokenAdminCache = new Map<
    string,
    { email: string; isAdmin: boolean; tier: PlanTier; expiresAt: number }
  >();

  const signLocalSessionToken = (
    payload: { sub: string; email: string; iat: number; exp?: number; role?: string },
    ttlMs?: number
  ): string => signSessionToken(payload, TOKEN_SIGNING_SECRET, ttlMs);

  const verifyLocalSessionToken = (
    token: string
  ): { sub: string; email: string; iat: number; exp: number; role?: string } | null =>
    verifySessionToken(token, TOKEN_SIGNING_SECRET);

  // Seeded local user credentials removed; real accounts register or authenticate via upstream gateway.
  // Local sign-ups live in memory only (no tmp-file cache of password hashes).
  let usersDb: ServerUser[] = [];

  let customerDirectory: ServerCustomerRecord[] = createCustomerDirectorySeed(isProduction);

  // Provider Health & Failover Registry (masking, env map, real probes, seed data)
  // lives in src/server/providerRegistry.ts. The mutable arrays stay here so the
  // admin routes' ctx getter/setter keeps working unchanged.
  let providerMesh = createProviderMesh();
  let infisicalExtraVaultKeys = createInfisicalExtraVaultKeys(isProduction);
  const buildInfisicalVaultKeys = () =>
    buildProviderVaultKeys(providerMesh, infisicalExtraVaultKeys);

  const activeAuthSessions = new PersistentSessionMap<string>('supremeai:auth_sess:', 86_400 * 7, true);
  // Local (dev/preview) refresh-token registry backed by Redis when REDIS_URL is configured.
  const activeRefreshTokens = new PersistentSessionMap<{ userId: string; expiresAt: number }>(
    'supremeai:refresh_tok:',
    86_400 * 30,
    true
  );
  void Promise.all([
    activeAuthSessions.hydrateFromRedis(),
    activeRefreshTokens.hydrateFromRedis(),
  ]).catch(() => {});
  const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
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
      const clean = String(extra || '')
        .trim()
        .toLowerCase();
      if (clean) emails.add(clean);
    }
    for (const u of usersDb) {
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
    for (const c of customerDirectory) {
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
    user?: Partial<ServerUser>,
    customerRec?: Partial<ServerCustomerRecord>,
    extraAdminEmails: string[] = [],
    extraRbacRole?: string
  ) => {
    const adminEmails = getDatabaseAdminEmails(extraAdminEmails);
    const emailMatchedAdminDb = adminEmails.has(cleanEmail);
    const rbacCandidates = [extraRbacRole, user?.rbacRole, user?.role, customerRec?.rbacRole]
      .map((r) =>
        String(r || '')
          .trim()
          .toLowerCase()
      )
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
      secure: isHttpsRequest(req),
      path: '/api',
      maxAge: REFRESH_TOKEN_TTL_MS,
    });
  };

  const setAdminSessionCookie = (req: Request, res: Response, token: string) => {
    activeAdminSessions.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
    res.cookie('supremeai_admin_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttpsRequest(req),
      path: '/api/admin',
      maxAge: ADMIN_SESSION_TTL_MS,
    });
  };

  registerAuthRoutes(app, {
    get customerDirectory() { return customerDirectory; },
    get usersDb() { return usersDb; },
    activeAuthSessions,
    activeAdminSessions,
    activeRefreshTokens,
    upstreamTokenAdminCache,
    isIpBlocked: (req) => isIpBlocked(req),
    platformConfig,
    buildSafeAuthUser: (u, c) => buildSafeAuthUser(u, c),
    signLocalSessionToken: (p) => signLocalSessionToken(p),
    verifyLocalSessionToken: (t) => verifyLocalSessionToken(t),
    issueLocalRefreshToken: (u) => issueLocalRefreshToken(u),
    setRefreshTokenCookie: (a, b, c) => setRefreshTokenCookie(a, b, c),
    setAdminSessionCookie: (a, b, c) => setAdminSessionCookie(a, b, c),
    resolveRbacUserProfile: (...a) => resolveRbacUserProfile(...a),
    recordAudit: (a, b, c, d, e) => recordAudit(a, b, c, d, e),
  });

  registerFeedbackRoutes(app, {
    verifyAdminAuthorization: (req) => verifyAdminAuthorization(req),
    resolveAuthenticatedEmail: (req) => resolveAuthenticatedEmail(req),
    recordAudit: (a, b, c, d, r) => recordAudit(a, b, c, d, r),
  });

  registerAuthTotpRoutes(app, {
    activeAuthSessions,
    activeAdminSessions,
    get customerDirectory() { return customerDirectory; },
    get usersDb() { return usersDb; },
    verifyLocalSessionToken: (t) => verifyLocalSessionToken(t),
    resolveRbacUserProfile: (...a) => resolveRbacUserProfile(...a),
    recordAudit: (a, b, c, d, r) => recordAudit(a, b, c, d, r),
  });

  const verifyBearerIdentity = async (
    rawToken: string
  ): Promise<{ email: string; isAdmin: boolean; tier: PlanTier } | null> => {
    if (!rawToken || rawToken.startsWith('tok_guest_') || rawToken.startsWith('sk-supreme-guest')) {
      return null;
    }

    const verifiedLocal = verifyLocalSessionToken(rawToken);
    if (verifiedLocal) {
      const adminExp = activeAdminSessions.get(rawToken);
      if (verifiedLocal.sub === 'admin_passkey') {
        if (adminExp && adminExp > Date.now()) {
          return { email: verifiedLocal.email, isAdmin: true, tier: 'Enterprise' };
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
      };
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const cached = upstreamTokenAdminCache.get(tokenHash);
    if (cached && cached.expiresAt > Date.now()) {
      return { email: cached.email, isAdmin: cached.isAdmin, tier: cached.tier };
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
          const data: any = await upstreamRes.json().catch(() => null);
          const raw =
            data && typeof data === 'object'
              ? data.user && typeof data.user === 'object'
                ? { ...data, ...data.user }
                : data
              : null;
          const cleanEmail = String(raw?.email || '')
            .trim()
            .toLowerCase();
          if (cleanEmail) {
            const matchedUser = usersDb.find((u) => u.email.toLowerCase() === cleanEmail);
            const customerRec = customerDirectory.find((c) => c.email.toLowerCase() === cleanEmail);
            const upstreamAdminEmails: string[] = [
              ...(Array.isArray(data?.adminEmails) ? data.adminEmails : []),
              ...(Array.isArray(data?.admin_emails) ? data.admin_emails : []),
            ];
            const upstreamRbac = raw.rbacRole || raw.rbac_role || raw.role;
            const rbac = resolveRbacUserProfile(
              cleanEmail,
              matchedUser || {
                rbacRole: upstreamRbac,
                isAdminEligible: Boolean(
                  raw.isAdminEligible ?? raw.is_admin_eligible ?? raw.is_admin
                ),
                isDeveloperEligible: Boolean(raw.isDeveloperEligible ?? raw.is_developer_eligible),
                adminUserId: raw.adminUserId || raw.admin_user_id,
              },
              customerRec,
              upstreamAdminEmails,
              upstreamRbac
            );
            const resolved = {
              email: cleanEmail,
              isAdmin: rbac.isAdminEligible,
              tier: (customerRec?.tier ||
                raw.plan ||
                (rbac.isAdminEligible ? 'Enterprise' : 'Pro')) as PlanTier,
            };
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

  // Resolve the authenticated caller's email from the bearer token, or null when
  // the request is anonymous/invalid. Used to scope per-user resources.
  const resolveAuthenticatedEmail = async (req: Request): Promise<string | null> => {
    const authHeader = String(req.headers.authorization || '').trim();
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) return null;
    const identity = await verifyBearerIdentity(token);
    const email = identity?.email?.trim().toLowerCase();
    return email && email !== 'guest' ? email : null;
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

  app.use('/api/admin', requireAdminMiddleware);
  app.use('/api/schema-parity', requireAdminMiddleware);

  registerAdminPlatformRoutes(app, {
    get platformConfig() {
      return platformConfig;
    },
    set platformConfig(_v) {
      // platformConfig reassignment never happens; property mutations
      // via reference are used. Setter is a placeholder for completeness.
    },
    get runtimeFeatureFlags() {
      return runtimeFeatureFlags;
    },
    set runtimeFeatureFlags(v) {
      runtimeFeatureFlags = v;
    },
    customerDirectory,
    blockedIps,
    auditRecords,
    SUPPORTED_MODELS,
    activeAdminSessions,
    signLocalSessionToken: (payload, ttlMs) => signLocalSessionToken(payload as Parameters<typeof signLocalSessionToken>[0], ttlMs),
    isHttpsRequest: (req) => isHttpsRequest(req),
    persistPlatformState: () => persistPlatformState(),
    resolveAuditActor: (req, actor) => resolveAuditActor(req, actor as unknown),
    recordAudit: (actor, action, resource, details, req) => recordAudit(actor, action, resource, details, req),
  });

    registerAdminCustomerRoutes(app, {
    get customerDirectory() {
      return customerDirectory;
    },
    set customerDirectory(v) {
      customerDirectory = v;
    },
    get usersDb() {
      return usersDb;
    },
    set usersDb(v) {
      usersDb = v;
    },
    resolveAuditActor: (req, actor) => resolveAuditActor(req, actor as unknown),
    recordAudit: (actor, action, resource, details, req) => recordAudit(actor, action, resource, details, req),
  });

    const devSwarmWorkers = [
    {
      id: 'worker-solver-01',
      name: 'Autonomous Solver Agent',
      type: 'solver',
      status: 'active',
      currentTask: 'Resolving Issue #42: Backpressure handling in WebSocket stream broker',
      currentIssueOrPr: 'Supremeai-bd/supremeai #42',
      processedCount: 184,
      successRate: 97.8,
      cpuPercent: 18.4,
      memoryMb: 412,
      uptime: '14h 22m',
      logs: [
        'Identified unbounded buffer allocation in event emitter.',
        'Generated patch applying bounded circular ring-buffer.',
        'Unit test suite verified: 34 tests passing with 0 regressions.',
      ],
    },
    {
      id: 'worker-verifier-02',
      name: 'AST Code Verifier & Validator',
      type: 'verifier',
      status: 'active',
      currentTask: 'Running TypeScript AST graph verification on PR #94',
      currentIssueOrPr: 'Supremeai-bd/supremeai-studio #94',
      processedCount: 312,
      successRate: 99.4,
      cpuPercent: 9.2,
      memoryMb: 280,
      uptime: '28h 10m',
      logs: [
        'AST tree generated for 84 source modules.',
        'Checked symbol cross-references: 0 circular dependencies.',
        'Strict null check verification PASSED.',
      ],
    },
    {
      id: 'worker-scout-03',
      name: 'Ecosystem Scout & Dependency Tracker',
      type: 'ecosystem-scout',
      status: 'idle',
      currentTask: 'Awaiting scheduled 15-minute package index crawl',
      currentIssueOrPr: 'Continuous background crawler',
      processedCount: 94,
      successRate: 100.0,
      cpuPercent: 1.1,
      memoryMb: 145,
      uptime: '42h 50m',
      logs: [
        'Checked @google/genai SDK v3.2.0 compatibility.',
        'Found 0 upstream security advisories in current node_modules lockfile.',
      ],
    },
    {
      id: 'worker-security-04',
      name: 'Adversarial Prompt & Rules Breaker',
      type: 'rules-breaker',
      status: 'active',
      currentTask: 'Fuzzing prompt boundaries with 500 adversarial jailbreak vectors',
      currentIssueOrPr: 'Adversarial Test Suite #19',
      processedCount: 780,
      successRate: 99.8,
      cpuPercent: 24.6,
      memoryMb: 520,
      uptime: '19h 45m',
      logs: [
        'Injected recursive delimiter extraction payload: Blocked by boundary shield.',
        'Tested system instruction override vector: Sanitized by LLM gateway filter.',
      ],
    },
  ];

  registerAdminSecurityRoutes(app, {
    blockedIps,
    auditRecords,
    persistPlatformState: () => persistPlatformState(),
    resolveAuditActor: (req, actor) => resolveAuditActor(req, actor as unknown),
    recordAudit: (actor, action, resource, details, req) => recordAudit(actor, action, resource, details, req),
  });
  registerAdminSwarmQueueRoutes(app, {
    devSwarmWorkers,
    getRealGatewayTrafficSummary: () => getRealGatewayTrafficSummary(),
    resolveAuditActor: (req, actor) => resolveAuditActor(req, actor as unknown),
    recordAudit: (actor, action, resource, details, req) => recordAudit(actor, action, resource, details, req),
  });

  registerKnowledgeRoutes(app, {
    isProduction,
    resolveAuthenticatedEmail: (req) => resolveAuthenticatedEmail(req),
  });

  registerLlmLatencyRoutes(app, {
    get providerMesh() { return providerMesh; },
    PROVIDER_DISPLAY_NAMES,
  });

  registerApiKeysRoutes(app, {
    get providerMesh() { return providerMesh; },
    PROVIDER_DISPLAY_NAMES,
    resolveAuthenticatedEmail: (req) => resolveAuthenticatedEmail(req),
  });

  // --- Provider Mesh & Infisical Vault Secrets Endpoints (Admin Dashboard) ---  // --- Provider Mesh & Infisical Vault Secrets Endpoints (Admin Dashboard) ---
  registerAdminProvidersRoutes(app, {
    get providerMesh(): any {
      return providerMesh;
    },
    set providerMesh(v: any) {
      providerMesh = v;
    },
    get infisicalExtraVaultKeys(): any {
      return infisicalExtraVaultKeys;
    },
    set infisicalExtraVaultKeys(v: any) {
      infisicalExtraVaultKeys = v;
    },
    PROVIDER_KEY_ENV,
    PROVIDER_DISPLAY_NAMES,
    maskServerSecret: (val) => maskServerSecret(val),
    probeProviderUpstream: (provider, apiKey) => probeProviderUpstream(provider, apiKey),
    buildInfisicalVaultKeys: () => buildInfisicalVaultKeys(),
    resolveAuditActor: (req, actor) => resolveAuditActor(req, actor as unknown),
    recordAudit: (actor, action, resource, details, req) => recordAudit(actor, action, resource, details, req),
  });



  // Dynamic User & Admin Workspace Stores (persistent for runtime lifecycle)
  const getRequestUserEmail = (req: Request): string => {
    const authHeader = String(req.headers.authorization || '').trim();
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) return 'guest';
    const sessionUserId = activeAuthSessions.get(token);
    const matchedUser = sessionUserId ? usersDb.find((u) => u.id === sessionUserId) : undefined;
    if (matchedUser?.email) return matchedUser.email.toLowerCase();
    const verifiedPayload = verifyLocalSessionToken(token);
    return verifiedPayload?.email?.toLowerCase() || 'guest';
  };

  registerBillingRoutes(app, {
    get customerDirectory() { return customerDirectory; },
    get usersDb() { return usersDb; },
    fetchGatewayJson: (p, t) => fetchGatewayJson(p, t),
    getRequestUserEmail: (req) => getRequestUserEmail(req),
    resolveAuthenticatedEmail: (req) => resolveAuthenticatedEmail(req),
    verifyAdminAuthorization: (req) => verifyAdminAuthorization(req),
    verifyBearerIdentity: (t) => verifyBearerIdentity(t),
    recordAudit: (a, b, c, d, r) => recordAudit(a, b, c, d, r),
    resolveAuditActor: (req, a) => resolveAuditActor(req, a as unknown),
  });

  registerWebhooksRoutes(app, {
    resolveAuthenticatedEmail: (req) => resolveAuthenticatedEmail(req),
    safeFetchWithRedirectCheck: (...args) => safeFetchWithRedirectCheck(...args),
  });

  registerProjectsRoutes(app, {
    get customerDirectory() { return customerDirectory; },
    resolveAuthenticatedEmail: (req) => resolveAuthenticatedEmail(req),
  });

  registerTeamRoutes(app, {
    get customerDirectory() { return customerDirectory; },
    get usersDb() { return usersDb; },
    resolveAuthenticatedEmail: (req) => resolveAuthenticatedEmail(req),
  });

  registerPreferencesRoutes(app, {
    getRequestUserEmail: (req) => getRequestUserEmail(req),
    verifyLocalSessionToken: (token) => verifyLocalSessionToken(token),
    get usersDb() { return usersDb; },
    activeAuthSessions,
    supabaseRestRequest: (p, m, b, pr) => supabaseRestRequest(p, m, b, pr),
  });

  // Admin Schema Parity Endpoints  // Admin Schema Parity Endpoints
  registerAdminSystemRoutes(app, {
    resolveAuditActor: (req, actor) => resolveAuditActor(req, actor as unknown),
    recordAudit: (actor, action, resource, details, req) => recordAudit(actor, action, resource, details, req),
  });

    registerStreamRoutes(app, {
    isIpBlocked: (req) => isIpBlocked(req),
    platformConfig,
    get customerDirectory() { return customerDirectory; },
    runtimeFeatureFlags,
    SUPPORTED_MODELS,
    TIER_RANK,
    verifyBearerIdentity: (t) => verifyBearerIdentity(t),
    verifyAdminAuthorization: (req) => verifyAdminAuthorization(req),
    resolveServerAutoModel: (m, msgs) => resolveServerAutoModel(m, msgs),
    resolveUpstreamGeminiModel: (m, c) => resolveUpstreamGeminiModel(m, c),
    buildGeminiPartsFromMessage: (m) => buildGeminiPartsFromMessage(m),
    buildGeminiGenerateConfig: (...a) => buildGeminiGenerateConfig(...a),
    collectGroundingSourcesAndUsage: (...a) => collectGroundingSourcesAndUsage(...a),
    executeFreeVisionCascade: (p) => executeFreeVisionCascade(p),
    extractTextFromMessageContent: (c) => extractTextFromMessageContent(c),
    messageHasActualImage: (m) => messageHasActualImage(m),
    messageHasVisionOrAttachment: (m) => messageHasVisionOrAttachment(m),
    countImagesInMessages: (m) => countImagesInMessages(m),
    resolveReasoningEffort: (...a) => resolveReasoningEffort(...a),
    detectBengaliOrBanglish: (t) => detectBengaliOrBanglish(t),
    classifyVisionHttpError: (p) => classifyVisionHttpError(p),
  });

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
    (req as any).authIdentity = identity;
    next();
  };

  app.use('/api/workspace', requireAuthMiddleware);
  registerWorkspaceTerminalRoutes(app, {
    get mcpClusterServices() { return mcpClusterServices; },
    get PORT() { return PORT; },
    get apiKey() { return apiKey; },
  });

  registerWorkspaceBrowserProxyRoutes(app, {
    get PORT() { return PORT; },
    safeFetchWithRedirectCheck: (...args) => safeFetchWithRedirectCheck(...args),
  });

  registerWorkspaceBrowserVaultRoutes(app, {
    resolveAuthenticatedEmail: (req) => resolveAuthenticatedEmail(req),
  });

  registerWorkspaceGmailSessionRoutes(app, {
    isHttpsRequest: (req) => isHttpsRequest(req),
  });

  registerWorkspaceBrowserSchedulesRoutes(app, {
    get APP_VERSION() { return APP_VERSION; },
    resolveAuthenticatedEmail: (req) => resolveAuthenticatedEmail(req),
    safeFetchWithRedirectCheck: (...args) => safeFetchWithRedirectCheck(...args),
  });

  registerGitOauthRoutes(app, { PORT });

  registerGraphRoutes(app, {
    get mcpClusterServices() { return mcpClusterServices; },
  });
  registerMediaRoutes(app, {
    isIpBlocked: (req) => isIpBlocked(req),
    get platformConfig() { return platformConfig; },
    safeFetchWithRedirectCheck: (...args) => safeFetchWithRedirectCheck(...args),
  });
  registerTtsRoutes(app, {
    isIpBlocked: (req) => isIpBlocked(req),
  });

  // ---------------------------------------------------------------------------
  // Federation Living Proxy (fail-open)
  //
  // Every `/api/*` route implemented by this Studio edge is registered above.
  // Anything else is a real `Supremeai-bd/supremeai` surface (ecosystem,
  // agents, memory, telemetry, HITL, ...). Instead of letting the SPA fallback
  // answer those requests with HTML (which silently poisoned client services),
  // forward them upstream with auth headers preserved and SSE left unbuffered.
  // The live-data fabric in `src/services/federationSyncService.ts` depends on
  // this contract: JSON or an explicit 5xx, never a 200 text/html response.
  registerConversationsRoutes(app, {
    resolveAuthenticatedEmail: (req) => resolveAuthenticatedEmail(req),
  });
  // বাংলা মন্তব্য: /api/* ক্যাচ-অল প্রক্সির আগেই Control Plane রাউট রেজিস্টার করতে হবে।
  registerControlPlaneRoutes(app, { recordAudit, isIpBlocked });

  // Federation `/api/*` catch-all proxy — src/server/federationProxy.ts (must stay last for /api).
  registerFederationProxy(app, { gatewayBase: GATEWAY_BASE });

  // Vite dev middleware / production static + SPA fallback, then the final error
  // handler — src/server/frontendServing.ts (same order as before).
  const viteServerPromise = mountFrontend(app, { isProduction, rootDir: __dirname });
  registerErrorHandler(app, isProduction);

  // Create HTTP server & mount /api/live + /ws WebSocket bridges
  const server = http.createServer(app);
  attachWebSocketBridges(server, {
    isProduction,
    blockedIps,
    platformConfig,
    verifyBearerIdentity,
  });

  server.on('error', (err) => {
    console.error('SupremeAI Studio Server listen error:', err);
    process.exit(1);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`SupremeAI Studio Server listening on http://0.0.0.0:${PORT}`);
  });

  const shutdown = async () => {
    try {
      server.close();
      if (viteServerPromise) {
        const vite = await viteServerPromise.catch(() => null);
        await vite?.close();
      }
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGTERM', () => {
    void shutdown();
  });
  process.once('SIGINT', () => {
    void shutdown();
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Process] Uncaught exception:', error);
});

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
