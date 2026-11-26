/**
 * Client error sink — `POST /api/telemetry/client-error`
 *
 * ব্রাউজার রিপোর্টার (`src/services/telemetry.ts`) fire-and-forget পাঠায়,
 * কখনো retry করে না — তাই হ্যান্ডলার শুধু acknowledge করে (204)।
 * শব্দদূষণ/PII ঠেকাতে: বডি ৮ KB-তে সীমিত (বেশি হলে 413), শুধু নথিভুক্ত
 * ফিল্ডগুলো ছোট করে লগে যায়, auth টোকেন কখনো পেলোডের অংশ না।
 *
 * আগে Express আর Cloudflare-এ দুটো আলাদা কপি ছিল; Express কপিতে ৮ KB
 * সীমা আর 405 ছিল না। এখন একটাই কপি — Cloudflare-এর কড়া আচরণটা রাখা হয়েছে।
 */

import { Hono } from 'hono';
import type { ApiEnv } from '../app';

export const CLIENT_ERROR_MAX_BODY_BYTES = 8 * 1024;
const CLIENT_ERROR_PATH = '/api/telemetry/client-error';

interface ClientErrorPayload {
  message?: unknown;
  source?: unknown;
  release?: unknown;
  route?: unknown;
  at?: unknown;
  context?: unknown;
}

export function summarizeClientError(payload: ClientErrorPayload) {
  return {
    message: String(payload.message ?? 'unknown').slice(0, 300),
    source: String(payload.source ?? 'app').slice(0, 40),
    release: payload.release ? String(payload.release).slice(0, 40) : undefined,
    route: payload.route ? String(payload.route).slice(0, 120) : undefined,
    at: payload.at ? String(payload.at).slice(0, 40) : new Date().toISOString(),
    contextKeys:
      payload.context && typeof payload.context === 'object'
        ? Object.keys(payload.context as Record<string, unknown>).slice(0, 10)
        : [],
  };
}

export function createTelemetryRoutes(): Hono<ApiEnv> {
  const routes = new Hono<ApiEnv>();

  routes.post(CLIENT_ERROR_PATH, async (c) => {
    const noStore = { 'Cache-Control': 'no-store' };
    const raw = await c.req.text().catch(() => '');
    if (new TextEncoder().encode(raw).byteLength > CLIENT_ERROR_MAX_BODY_BYTES) {
      return c.body(null, 413, noStore);
    }

    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      // বাংলা মন্তব্য: ভাঙা রিপোর্ট — তবু 204, ক্লায়েন্ট যেন কখনো retry না করে
      return c.body(null, 204, noStore);
    }
    const payload: ClientErrorPayload =
      parsed && typeof parsed === 'object' ? (parsed as ClientErrorPayload) : {};

    console.warn('[client-error]', JSON.stringify(summarizeClientError(payload)));
    return c.body(null, 204, noStore);
  });

  // বাংলা মন্তব্য: অন্য মেথডে 404 না দিয়ে স্পষ্ট 405 (OPTIONS adapter-এ আগেই ধরা হয়)
  routes.all(CLIENT_ERROR_PATH, (c) => c.body(null, 405, { Allow: 'POST' }));

  return routes;
}
