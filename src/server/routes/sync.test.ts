/**
 * বাংলা মন্তব্য: চারটি প্ল্যাটফর্মের (Web, Desktop, Android Mobile, এবং VS Code Extension) মধ্যে
 * Express SSE হাব (`/api/v1/sync/stream`, `/api/v1/sync/state`, `/api/v1/user/preferences`)
 * দিয়ে রিয়েল-টাইম তাৎক্ষণিক সিঙ্কের পূর্ণাঙ্গ ইন্টিগ্রেশন টেস্ট।
 */
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { registerPreferencesRoutes } from './preferences';

describe('Express Real-Time 4-Platform Sync Hub', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    for (const s of servers) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    servers.length = 0;
    for (const f of ['.supremeai-sync-state.json', '.supremeai-user-preferences.json']) {
      try {
        const p = path.join(process.cwd(), f);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // ignore cleanup errors
      }
    }
  });

  it('fans out real-time SSE updates across Web, Desktop, Mobile, and VS Code simultaneously', async () => {
    const app = express();
    app.use(express.json());

    const activeAuthSessions = new Map<string, string>([['tok_4surface_user', 'u_1']]);
    registerPreferencesRoutes(app, {
      getRequestUserEmail: () => 'guest',
      verifyLocalSessionToken: () => null,
      usersDb: [{ id: 'u_1', email: 'engineer@supremeai.studio' }],
      activeAuthSessions,
    });

    const server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    // 1. Web opens live SSE stream
    const sseAbort = new AbortController();
    const sseRes = await fetch(
      `${base}/api/v1/sync/stream?platform=web&device_id=dev-web-1`,
      {
        headers: { Authorization: 'Bearer tok_4surface_user' },
        signal: sseAbort.signal,
      }
    );
    expect(sseRes.status).toBe(200);
    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();

    let collectedSse = '';
    const pump = (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          collectedSse += decoder.decode(value, { stream: true });
        }
      } catch {
        // Aborted on cleanup
      }
    })();

    // Give initial connected frame a moment
    await new Promise((r) => setTimeout(r, 30));
    expect(collectedSse).toContain('event: connected');

    // 2. VS Code Extension updates model -> Web SSE receives it live
    const vsixPost = await fetch(`${base}/api/v1/sync/state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok_4surface_user',
      },
      body: JSON.stringify({
        protocolVersion: '1.0.0',
        domain: 'models',
        deviceId: 'dev-vsix-1',
        platform: 'vsix',
        updatedAt: Date.now(),
        revision: 1,
        payload: {
          selectedModelId: 'supreme-reason',
          autoModelRouting: false,
          runSettings: { thinkingLevel: 'HIGH', temperature: 0.4 },
        },
      }),
    });
    expect(vsixPost.status).toBe(200);

    // 3. Mobile Android updates preferences (`language: 'bn'`) via /api/v1/user/preferences -> Web SSE receives it too!
    const androidPrefPost = await fetch(`${base}/api/v1/user/preferences`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok_4surface_user',
        'X-Device-Id': 'dev-android-1',
        'X-Sync-Platform': 'android',
      },
      body: JSON.stringify({
        studio_settings: { language: 'bn', defaultModel: 'supreme-reason' },
      }),
    });
    expect(androidPrefPost.status).toBe(200);

    await new Promise((r) => setTimeout(r, 40));
    expect(collectedSse).toContain('"domain":"models"');
    expect(collectedSse).toContain('"supreme-reason"');
    expect(collectedSse).toContain('"domain":"preferences"');
    expect(collectedSse).toContain('"language":"bn"');

    // 4. Desktop App boots up and pulls /api/v1/sync/state -> receives both models & preferences
    const desktopSnapRes = await fetch(`${base}/api/v1/sync/state`, {
      headers: {
        Authorization: 'Bearer tok_4surface_user',
        'X-SupremeAI-Platform': 'desktop',
      },
    });
    expect(desktopSnapRes.status).toBe(200);
    const desktopSnap = (await desktopSnapRes.json()) as {
      envelopes: Array<{ domain: string }>;
      preferences: { studio_settings?: { language?: string } };
    };
    expect(desktopSnap.envelopes.map((e) => e.domain)).toEqual(
      expect.arrayContaining(['models', 'preferences'])
    );
    expect(desktopSnap.preferences.studio_settings?.language).toBe('bn');

    sseAbort.abort();
    await pump;
  });
});
