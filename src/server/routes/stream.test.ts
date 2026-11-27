// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as gv from '../geminiVision';
import { classifyVisionHttpError } from '../../shared/visionRouting';
import { registerStreamRoutes, type StreamContext } from './stream';

const ENV_KEYS = ['GEMINI_API_KEY', 'STEALTH_WEBHOOK_URL', 'SUPREMEAI_BACKEND_URL'] as const;
const savedEnv: Record<string, string | undefined> = {};
let server: http.Server;
let base = '';

function buildCtx(overrides: Partial<StreamContext> = {}): StreamContext {
  return {
    isIpBlocked: () => false,
    platformConfig: {
      defaultModelId: 'supreme-spark',
      maintenanceMode: false,
      modelPolicies: {},
    },
    customerDirectory: [],
    runtimeFeatureFlags: { enable_multimodal_vision: true, enable_rag_grounding: true },
    SUPPORTED_MODELS: { 'supreme-spark': { name: 'Spark' }, 'supreme-core': { name: 'Core' } },
    TIER_RANK: { Free: 0, Pro: 1 },
    verifyBearerIdentity: async () => null,
    verifyAdminAuthorization: async () => ({ ok: false }),
    resolveServerAutoModel: gv.resolveServerAutoModel,
    resolveUpstreamGeminiModel: gv.resolveUpstreamGeminiModel,
    buildGeminiPartsFromMessage: gv.buildGeminiPartsFromMessage,
    buildGeminiGenerateConfig: gv.buildGeminiGenerateConfig,
    collectGroundingSourcesAndUsage: gv.collectGroundingSourcesAndUsage,
    executeFreeVisionCascade: vi.fn(async ({ res }) => {
      res.status(200).end('vision-cascade');
    }),
    extractTextFromMessageContent: gv.extractTextFromMessageContent,
    messageHasActualImage: gv.messageHasActualImage,
    messageHasVisionOrAttachment: gv.messageHasVisionOrAttachment,
    countImagesInMessages: gv.countImagesInMessages,
    resolveReasoningEffort: gv.resolveReasoningEffort,
    detectBengaliOrBanglish: () => false,
    classifyVisionHttpError,
    ...overrides,
  };
}

async function post(path: string, body: unknown) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  const app = express();
  app.use(express.json());
  registerStreamRoutes(app, buildCtx());
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('stream routes (no provider keys configured)', () => {
  it('POST /api/chat rejects an empty message list', async () => {
    const res = await post('/api/chat', { messages: [] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Messages array is required and must not be empty.',
    });
  });

  it('POST /api/chat returns the offline fallback as JSON when stream=false', async () => {
    const res = await post('/api/chat', {
      stream: false,
      messages: [{ role: 'user', content: 'hello there' }],
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { text: string; model: string };
    expect(json.model).toBe('supreme-spark');
    expect(json.text).toContain('> hello there');
  });

  it('POST /api/chat blocks attachments when multimodal is disabled', async () => {
    const app = express();
    app.use(express.json());
    registerStreamRoutes(
      app,
      buildCtx({ runtimeFeatureFlags: { enable_multimodal_vision: false } })
    );
    const s = http.createServer(app);
    await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/chat`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stream: false,
          messages: [
            { role: 'user', content: 'see', attachment: { data: 'AAAA', mimeType: 'image/png' } },
          ],
        }),
      });
      expect(res.status).toBe(403);
    } finally {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  it('POST /api/v1/stream/chat streams a clear SSE error when nothing is configured', async () => {
    const res = await post('/api/v1/stream/chat', { prompt: 'hi' });
    const text = await res.text();
    expect(text).toContain('No GEMINI_API_KEY or remote backend token configured for inference.');
  });
});
