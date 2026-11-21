import express from 'express';
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { registerKnowledgeRoutes } from './knowledge';
import { registerLlmLatencyRoutes } from './llmLatency';

async function withServer(
  setup: (app: express.Express) => void,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const app = express();
  app.use(express.json());
  setup(app);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('Extracted server routes (knowledge & llmLatency)', () => {
  afterEach(() => {
    // No persistent timers or global overrides needed
  });

  it('enforces authentication and per-owner isolation on /api/user/knowledge', async () => {
    let activeUser: string | null = null;

    await withServer(
      (app) =>
        registerKnowledgeRoutes(app, {
          isProduction: true,
          resolveAuthenticatedEmail: async () => activeUser,
        }),
      async (baseUrl) => {
        const unauthRes = await fetch(`${baseUrl}/api/user/knowledge`);
        expect(unauthRes.status).toBe(401);

        activeUser = 'alice@supremeai.dev';
        const createRes = await fetch(`${baseUrl}/api/user/knowledge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Runbook.md', sizeBytes: 2048 }),
        });
        expect(createRes.status).toBe(200);
        const created = (await createRes.json()) as {
          document: { id: string; title: string };
          documents: Array<{ id: string }>;
        };
        expect(created.document.title).toBe('Runbook.md');
        expect(created.documents).toHaveLength(1);

        // Another user cannot view or delete Alice's document
        activeUser = 'bob@supremeai.dev';
        const bobList = (await (await fetch(`${baseUrl}/api/user/knowledge`)).json()) as {
          documents: Array<{ id: string }>;
        };
        expect(bobList.documents).toHaveLength(0);

        const bobDelete = await fetch(
          `${baseUrl}/api/user/knowledge/${created.document.id}`,
          { method: 'DELETE' }
        );
        expect(bobDelete.status).toBe(404);
      }
    );
  });

  it('serves normalized gateway + provider mesh latency telemetry', async () => {
    await withServer(
      (app) =>
        registerLlmLatencyRoutes(app, {
          providerMesh: [
            {
              provider: 'google_ai_studio',
              displayName: 'Google AI Studio',
              status: 'healthy',
              latencyMs: 42,
              avgLatencyMs: 40,
            },
            {
              provider: 'openai',
              displayName: 'OpenAI',
              status: 'degraded',
              latencyMs: 310,
            },
          ],
          PROVIDER_DISPLAY_NAMES: {
            google_ai_studio: 'Gemini Mesh',
            openai: 'OpenAI Upstream',
          },
        }),
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/llm-gateway/latency`);
        expect(res.status).toBe(200);
        const json = (await res.json()) as {
          gatewayStatus: string;
          providers: Record<string, { status: string; displayName: string; p95LatencyMs: number }>;
          list: Array<{ provider: string }>;
        };
        expect(json.gatewayStatus).toBe('healthy');
        expect(json.providers.supremeai.status).toBe('healthy');
        expect(json.providers.google_ai_studio.displayName).toBe('Gemini Mesh');
        expect(json.providers.openai.status).toBe('degraded');
        expect(json.list.length).toBeGreaterThanOrEqual(3);
      }
    );
  });
});
