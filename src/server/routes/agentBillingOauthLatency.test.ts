import express from 'express';
import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest as edgeLatencyOnRequest } from '../../../functions/api/llm-gateway/latency';
import { registerAgentExecuteRoutes } from './agentExecute';
import { registerBillingRoutes } from './billing';
import { registerGitOauthRoutes } from './gitOauth';
import { registerLlmLatencyRoutes } from './llmLatency';

// বাংলা মন্তব্য: এজেন্ট অথেন্টিকেশন ও ভার্চুয়াল বাফার আইসোলেশন, বিলিং আপস্ট্রিম JWT রেজোলিউশন, Git OAuth বাউন্ডেড স্টেট এবং সৎ ল্যাটেন্সি টেলিমেট্রির ইউনিট টেস্ট
async function withServer(
  setup: (app: express.Express) => void,
  fn: (baseUrl: string, port: number) => Promise<void>
): Promise<void> {
  const app = express();
  app.use(express.json());
  setup(app);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`, port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('Agent execution, Billing upstream identity, Git OAuth, and LLM Latency honesty', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('rejects unauthenticated or WAF-blocked calls to /api/agent/execute', async () => {
    let callerEmail: string | null = null;
    let blocked = false;

    await withServer(
      (app) => {
        registerAgentExecuteRoutes(app, {
          isIpBlocked: () => blocked,
          resolveAuthenticatedEmail: async () => callerEmail,
        });
      },
      async (baseUrl) => {
        const unauth = await fetch(`${baseUrl}/api/agent/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'read server.ts' }),
        });
        expect(unauth.status).toBe(401);

        blocked = true;
        const wafBlocked = await fetch(`${baseUrl}/api/agent/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'read server.ts' }),
        });
        expect(wafBlocked.status).toBe(403);

        blocked = false;
        callerEmail = 'dev@supremeai.bd';
        delete process.env.GEMINI_API_KEY;
        const authedFallback = await fetch(`${baseUrl}/api/agent/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'hello' }),
        });
        expect(authedFallback.status).toBe(200);
        const payload = (await authedFallback.json()) as { status: string; reason?: string };
        expect(payload.status).toBe('fallback_chat');
        expect(payload.reason).toBe('no_gemini_key');
      }
    );
  });

  it('resolves upstream JWT user wallets asynchronously on /api/billing/wallet and /api/billing/summary', async () => {
    await withServer(
      (app) => {
        registerBillingRoutes(app, {
          customerDirectory: [
            { id: 'cust_ent_1', email: 'ent@supremeai.bd', tier: 'Enterprise' },
          ],
          usersDb: [],
          fetchGatewayJson: async () => null,
          // Sync local check only returns guest for upstream JWTs
          getRequestUserEmail: () => 'guest',
          resolveAuthenticatedEmail: async (req) =>
            req.headers.authorization === 'Bearer upstream-jwt' ? 'ent@supremeai.bd' : null,
          verifyAdminAuthorization: async () => ({ ok: false, status: 403, error: 'forbidden' }),
          verifyBearerIdentity: async () => null,
          recordAudit: () => {},
          resolveAuditActor: () => 'ent@supremeai.bd',
        });
      },
      async (baseUrl) => {
        const walletRes = await fetch(`${baseUrl}/api/billing/wallet`, {
          headers: { Authorization: 'Bearer upstream-jwt' },
        });
        expect(walletRes.status).toBe(200);
        const wallet = (await walletRes.json()) as {
          user_id: string;
          monthly_allowance_usd: number;
        };
        expect(wallet.user_id).toBe('cust_ent_1');
        expect(wallet.monthly_allowance_usd).toBe(500);

        const summaryRes = await fetch(`${baseUrl}/api/billing/summary`, {
          headers: { Authorization: 'Bearer upstream-jwt' },
        });
        expect(summaryRes.status).toBe(200);
      }
    );
  });

  it('sanitizes poisoned forwarded headers in Git OAuth and bounds oauthStateStore', async () => {
    delete process.env.APP_URL;
    process.env.GITHUB_CLIENT_ID = 'gh_client_demo';
    process.env.GITHUB_CLIENT_SECRET = 'gh_secret_demo';

    await withServer(
      (app) => {
        registerGitOauthRoutes(app, { PORT: 4321 });
      },
      async (baseUrl, port) => {
        const poisonedRes = await fetch(`${baseUrl}/api/git/oauth/status`, {
          headers: {
            'x-forwarded-proto': 'javascript',
            'x-forwarded-host': 'evil.example.com/injected-path',
          },
        });
        expect(poisonedRes.status).toBe(200);
        const poisonedJson = (await poisonedRes.json()) as { githubCallbackUrl: string };
        // Poisoned proto & path-bearing host are rejected in favor of http://127.0.0.1:<PORT>
        expect(poisonedJson.githubCallbackUrl).toBe(
          `http://127.0.0.1:4321/api/git/oauth/github/callback`
        );

        const validForwarded = await fetch(`${baseUrl}/api/git/oauth/github/url`, {
          headers: {
            'x-forwarded-proto': 'https',
            'x-forwarded-host': `studio-${port}.supremeai.bd`,
          },
        });
        expect(validForwarded.status).toBe(200);
        const validJson = (await validForwarded.json()) as { callbackUrl: string; url: string };
        expect(validJson.callbackUrl).toBe(
          `https://studio-${port}.supremeai.bd/api/git/oauth/github/callback`
        );
        expect(validJson.url).toContain('https://github.com/login/oauth/authorize?');
      }
    );
  });

  it('eliminates fabricated sample counts in /api/llm-gateway/latency and aligns Edge CORS + schema', async () => {
    await withServer(
      (app) => {
        registerLlmLatencyRoutes(app, {
          providerMesh: [
            {
              provider: 'google_ai_studio',
              displayName: 'Google AI Studio',
              status: 'healthy',
              latencyMs: 0,
            },
          ],
          PROVIDER_DISPLAY_NAMES: { google_ai_studio: 'Gemini Mesh' },
          getRealGatewayTrafficSummary: () => ({
            rpm: 12,
            avgLatencyMs: 42,
            errorRatePercent: 0,
            totalRequests: 7,
          }),
        });
      },
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/llm-gateway/latency`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          providers: Record<
            string,
            { sampleCount: number; avgLatencyMs: number; provenance: string }
          >;
        };
        expect(body.providers.supremeai.sampleCount).toBe(7);
        expect(body.providers.supremeai.avgLatencyMs).toBe(42);
        expect(body.providers.supremeai.provenance).toBe('live-measured');
        expect(body.providers.google_ai_studio.sampleCount).toBe(0);
        expect(body.providers.google_ai_studio.provenance).toBe('unmeasured');
      }
    );

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
    );
    const edgeReq = new Request('https://supremeai-studio.pages.dev/api/llm-gateway/latency', {
      method: 'GET',
      headers: { Origin: 'https://partner.example.org' },
    });
    const edgeRes = await edgeLatencyOnRequest({
      request: edgeReq,
      env: { ALLOWED_ORIGINS: 'https://partner.example.org' },
    });
    expect(edgeRes.status).toBe(200);
    expect(edgeRes.headers.get('Access-Control-Allow-Origin')).toBe('https://partner.example.org');
    const edgeJson = (await edgeRes.json()) as {
      providers: Record<string, { avgLatencyMs: number; p95LatencyMs: number; successRate: number }>;
    };
    expect(typeof edgeJson.providers.supremeai.avgLatencyMs).toBe('number');
    expect(typeof edgeJson.providers.supremeai.p95LatencyMs).toBe('number');
    expect(edgeJson.providers.supremeai.successRate).toBe(100);
  });
});
