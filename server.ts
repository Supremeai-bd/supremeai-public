import express, { NextFunction, Request, Response } from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import { attachWebSocketBridges } from './src/server/wsBridge';
import { registerControlPlaneRoutes } from './src/server/controlPlaneRouter';
import { registerMcpTowerRoutes } from './src/server/routes/mcpTowerRoutes';
import { registerEdgeParityRoutes } from './src/server/routes/edgeParityRoutes';
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
import {
  createRateLimiter,
  isHttpsRequest,
  routeRateLimit,
  safeFetchWithRedirectCheck,
} from './src/server/httpGuards';
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
  type ServerAuditRecord,
} from './src/server/platformState';
import { supabaseRestRequest } from './src/server/supabaseRest';
import {
  createCustomerDirectorySeed,
  createServerIdentityManager,
  type ServerCustomerRecord,
  type ServerUser,
} from './src/server/userDirectory';
import { mountFrontend, registerErrorHandler } from './src/server/frontendServing';
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
const SUPPORTED_MODELS = CANONICAL_SERVER_MODELS;
const apiKey = process.env.GEMINI_API_KEY || '';

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
    if (isProduction && isHttpsRequest(req)) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

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

  // Unified Hono API (src/api, shared with Edge) — mounted before express.json() so raw body stream stays intact
  mountApiOnExpress(app, {
    fetchGatewayJson: (p, t) => fetchGatewayJson(p, t),
    getPlatformConfig: () => ({ ...platformConfig, featureFlags: runtimeFeatureFlags }),
  });
  app.use(express.json({ limit: '15mb' }));

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

  const GATEWAY_BASE = (
    process.env.SUPREMEAI_BACKEND_URL?.trim() || 'https://supremeai-api-ulw0.onrender.com'
  ).replace(/\/$/, '');
  const fetchGatewayJson = createGatewayCatalogFetcher(GATEWAY_BASE);

  const mcpClusterServices = createMcpClusterServices();

  let runtimeFeatureFlags: Record<string, boolean> = createRuntimeFeatureFlags();
  const platformConfig = createPlatformConfig();
  const auditRecords: ServerAuditRecord[] = createAuditSeed(isProduction);
  const blockedIps: BlockedIpEntry[] = createBlockedIpsSeed(isProduction);
  let usersDb: ServerUser[] = [];
  let customerDirectory: ServerCustomerRecord[] = createCustomerDirectorySeed(isProduction);

  const isIpBlocked = (req: Request): boolean => {
    const clientIp = getClientIp(req);
    return blockedIps.some((entry) => entry.ip === clientIp);
  };

  const identity = createServerIdentityManager({
    getUsersDb: () => usersDb,
    getCustomerDirectory: () => customerDirectory,
    isHttpsRequest,
  });
  const {
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
  } = identity;

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
    if (auditRecords.length > 200) auditRecords.length = 200;
    void supabaseRestRequest('audit_logs', 'POST', [buildDurableAuditRow(entry)]).catch(() => {});
  };

  registerMcpTowerRoutes(app, {
    mcpClusterServices,
    resolveAuditActor,
    recordAudit,
    verifyAdminAuthorization,
  });

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
  await loadDurablePlatformState({
    blockedIps,
    runtimeFeatureFlags,
    platformConfig,
    auditRecords,
  });
  void verifyGatewaySchema();

  let providerMesh = createProviderMesh();
  let infisicalExtraVaultKeys = createInfisicalExtraVaultKeys(isProduction);
  const buildInfisicalVaultKeys = () =>
    buildProviderVaultKeys(providerMesh, infisicalExtraVaultKeys);

  registerAuthRoutes(app, {
    get customerDirectory() {
      return customerDirectory;
    },
    get usersDb() {
      return usersDb;
    },
    activeAuthSessions,
    activeAdminSessions,
    activeRefreshTokens,
    upstreamTokenAdminCache,
    revokeSessionToken: revokeLocalSessionToken,
    isIpBlocked,
    platformConfig,
    buildSafeAuthUser: (u, c) => buildSafeAuthUser(u, c),
    signLocalSessionToken: (p) => signLocalSessionToken(p),
    verifyLocalSessionToken,
    issueLocalRefreshToken,
    setRefreshTokenCookie,
    setAdminSessionCookie,
    resolveRbacUserProfile,
    recordAudit,
  });

  registerFeedbackRoutes(app, {
    verifyAdminAuthorization,
    resolveAuthenticatedEmail,
    recordAudit,
  });

  registerAuthTotpRoutes(app, {
    activeAuthSessions,
    activeAdminSessions,
    get customerDirectory() {
      return customerDirectory;
    },
    get usersDb() {
      return usersDb;
    },
    verifyLocalSessionToken,
    resolveRbacUserProfile,
    recordAudit,
  });

  // Mandatory RBAC authentication & rate limit on `/api/admin`, `/api/v1/admin`, and `/api/schema-parity`
  app.use(
    ['/api/admin', '/api/v1/admin'],
    routeRateLimit(600, { scope: 'area' }),
    requireAdminMiddleware
  );
  app.use('/api/schema-parity', routeRateLimit(60, { scope: 'area' }), requireAdminMiddleware);

  registerAdminPlatformRoutes(app, {
    get platformConfig() {
      return platformConfig;
    },
    set platformConfig(_v) {
      /* property mutations via reference */
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
    signLocalSessionToken: (payload, ttlMs) =>
      signLocalSessionToken(payload as Parameters<typeof signLocalSessionToken>[0], ttlMs),
    isHttpsRequest,
    persistPlatformState,
    resolveAuditActor,
    recordAudit,
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
    resolveAuditActor,
    recordAudit,
  });

  registerAdminSecurityRoutes(app, {
    blockedIps,
    auditRecords,
    persistPlatformState,
    resolveAuditActor,
    recordAudit,
  });

  registerAdminSwarmQueueRoutes(app, {
    getRealGatewayTrafficSummary,
    resolveAuditActor,
    recordAudit,
  });

  registerKnowledgeRoutes(app, {
    isProduction,
    resolveAuthenticatedEmail,
  });

  registerLlmLatencyRoutes(app, {
    get providerMesh() {
      return providerMesh;
    },
    PROVIDER_DISPLAY_NAMES,
    getRealGatewayTrafficSummary,
  });

  registerApiKeysRoutes(app, {
    get providerMesh() {
      return providerMesh;
    },
    PROVIDER_DISPLAY_NAMES,
    resolveAuthenticatedEmail,
  });

  registerAdminProvidersRoutes(app, {
    get providerMesh() {
      return providerMesh;
    },
    set providerMesh(v) {
      providerMesh = v;
    },
    get infisicalExtraVaultKeys() {
      return infisicalExtraVaultKeys;
    },
    set infisicalExtraVaultKeys(v) {
      infisicalExtraVaultKeys = v;
    },
    PROVIDER_KEY_ENV,
    PROVIDER_DISPLAY_NAMES,
    maskServerSecret,
    probeProviderUpstream,
    buildInfisicalVaultKeys,
    resolveAuditActor,
    recordAudit,
  });

  registerBillingRoutes(app, {
    get customerDirectory() {
      return customerDirectory;
    },
    get usersDb() {
      return usersDb;
    },
    fetchGatewayJson,
    getRequestUserEmail,
    resolveAuthenticatedEmail,
    verifyAdminAuthorization,
    verifyBearerIdentity,
    recordAudit,
    resolveAuditActor,
  });

  registerWebhooksRoutes(app, {
    resolveAuthenticatedEmail,
    safeFetchWithRedirectCheck,
  });

  registerProjectsRoutes(app, {
    get customerDirectory() {
      return customerDirectory;
    },
    resolveAuthenticatedEmail,
  });

  registerTeamRoutes(app, {
    get customerDirectory() {
      return customerDirectory;
    },
    get usersDb() {
      return usersDb;
    },
    resolveAuthenticatedEmail,
  });

  registerPreferencesRoutes(app, {
    getRequestUserEmail,
    verifyLocalSessionToken,
    get usersDb() {
      return usersDb;
    },
    activeAuthSessions,
    supabaseRestRequest,
  });

  registerAdminSystemRoutes(app, {
    resolveAuditActor,
    recordAudit,
  });

  // Edge ↔ Node Parity Routes (/api/pool/*, /api/user/memories*, /api/research/*, & Supabase /api/admin/*)
  registerEdgeParityRoutes(app, {
    verifyBearerIdentity,
    resolveAuditActor,
    recordAudit,
  });

  registerStreamRoutes(app, {
    isIpBlocked,
    platformConfig,
    get customerDirectory() {
      return customerDirectory;
    },
    get runtimeFeatureFlags() {
      return runtimeFeatureFlags;
    },
    SUPPORTED_MODELS,
    TIER_RANK,
    verifyBearerIdentity,
    verifyAdminAuthorization,
    resolveServerAutoModel,
    resolveUpstreamGeminiModel,
    buildGeminiPartsFromMessage,
    buildGeminiGenerateConfig,
    collectGroundingSourcesAndUsage,
    executeFreeVisionCascade,
    extractTextFromMessageContent,
    messageHasActualImage,
    messageHasVisionOrAttachment,
    countImagesInMessages,
    resolveReasoningEffort,
    detectBengaliOrBanglish,
    classifyVisionHttpError,
  });

  app.use('/api/workspace', routeRateLimit(600, { scope: 'area' }), requireAuthMiddleware);
  registerWorkspaceTerminalRoutes(app, {
    get mcpClusterServices() {
      return mcpClusterServices;
    },
    get PORT() {
      return PORT;
    },
    get apiKey() {
      return apiKey;
    },
  });

  registerWorkspaceBrowserProxyRoutes(app, {
    get PORT() {
      return PORT;
    },
    safeFetchWithRedirectCheck,
  });

  registerWorkspaceBrowserVaultRoutes(app, {
    resolveAuthenticatedEmail,
  });

  registerWorkspaceGmailSessionRoutes(app, {
    isHttpsRequest,
  });

  registerWorkspaceBrowserSchedulesRoutes(app, {
    get APP_VERSION() {
      return APP_VERSION;
    },
    resolveAuthenticatedEmail,
    safeFetchWithRedirectCheck,
  });

  registerGitOauthRoutes(app, { PORT });

  registerGraphRoutes(app, {
    get mcpClusterServices() {
      return mcpClusterServices;
    },
  });

  registerMediaRoutes(app, {
    isIpBlocked,
    get platformConfig() {
      return platformConfig;
    },
    resolveAuthenticatedEmail,
    safeFetchWithRedirectCheck,
  });

  registerTtsRoutes(app, {
    isIpBlocked,
  });

  registerConversationsRoutes(app, {
    resolveAuthenticatedEmail,
  });

  registerControlPlaneRoutes(app, { recordAudit, isIpBlocked });

  // Federation `/api/*` catch-all proxy — must stay last for /api
  registerFederationProxy(app, { gatewayBase: GATEWAY_BASE });

  const viteServerPromise = mountFrontend(app, { isProduction, rootDir: __dirname });
  registerErrorHandler(app, isProduction);

  const server = http.createServer(app);
  attachWebSocketBridges(server, {
    isProduction,
    blockedIps,
    platformConfig,
    getClientIp: (req) => getClientIp(req as unknown as Request),
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
