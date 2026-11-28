/**
 * SupremeAI unified API — একমাত্র রুট-হ্যান্ডলার স্তর (Hono)।
 *
 * WHY THIS FILE EXISTS
 *   একই API দুটো ব্যাকএন্ডে আলাদা করে লেখা ছিল — Express (`server.ts` +
 *   `src/server/routes/`) আর Cloudflare Pages Functions (`functions/api/`)।
 *   এক জায়গায় ফিক্স হলে অন্য জায়গায় থেকে যেত (যেমন PR #91-এ admin auth)।
 *   Hono Web-standard `Request/Response` ব্যবহার করে, তাই এখানে একবার লেখা
 *   হ্যান্ডলার দুই রানটাইমেই চলে:
 *
 *     Cloudflare : functions/_lib/honoAdapter.ts → createApiApp().fetch(request, env)
 *     Node       : src/api/node.ts (mountApiOnExpress) → @hono/node-server
 *
 * CONTRACT
 *   - রুট-গ্রুপ `src/api/routes/*.ts`-এ থাকে; প্রত্যেকটা একটা `Hono` sub-app
 *     ফেরত দেয় যার পাথ পূর্ণ (`/api/...`) — যাতে Express-এ ঠিক ওই পাথগুলোই
 *     mount করা যায় (`listApiPaths`)।
 *   - হ্যান্ডলার কখনো `process.env` সরাসরি পড়বে না — শুধু `readEnv(c, KEY)`।
 *     Cloudflare-এ env আসে `context.env` থেকে, Node-এ `process.env` থেকে।
 *   - রানটাইম-নির্দিষ্ট কাজ (CORS, security header, rate-limit) adapter-এ
 *     থাকে, এখানে না।
 *   - মাইগ্রেশনের অবস্থা: docs/HONO_MIGRATION.md
 */

import { Hono, type Context } from 'hono';
import { createCaptchaConfigRoutes } from './routes/captchaConfig';
import { createReleasesRoutes } from './routes/releases';
import { createTelemetryRoutes } from './routes/telemetry';
import { createHealthRoutes } from './routes/health';
import { createModelsRoutes } from './routes/models';
import { createPlatformConfigRoutes } from './routes/platformConfig';
import { createShareRoutes } from './routes/share';
import { createI18nRoutes } from './routes/i18n';

/** দুই রানটাইমেই env হলো string ম্যাপ (Cloudflare `context.env` / Node `process.env`)। */
export type ApiBindings = Record<string, string | undefined>;

export interface ApiEnv {
  Bindings: ApiBindings;
}

export type ApiContext = Context<ApiEnv>;

/** টেস্টে বা রানটাইমে বাইরের নির্ভরতা বদলানোর জন্য (যেমন নেটওয়ার্ক fetch)। */
export interface ApiDeps {
  fetch?: typeof fetch;
  now?: () => number;
  /** বাংলা মন্তব্য: শুধু Node-এর বিদ্যমান catalog cache; Edge-এ কোনো upstream fetch নয়। */
  fetchGatewayJson?: (pathAndQuery: string, ttlMs?: number) => Promise<unknown>;
  /** বাংলা মন্তব্য: Node সার্ভারে লাইভ প্ল্যাটফর্ম কনফিগ ও ফিচার-ফ্ল্যাগ পড়ার ঐচ্ছিক হুক। */
  getPlatformConfig?: () => Record<string, unknown>;
}

/** বাংলা মন্তব্য: env থেকে নিরাপদে string মান পড়া — দুই রানটাইমেই একই আচরণ। */
export function readEnv(c: ApiContext, key: string): string | undefined {
  const env = c.env as Record<string, unknown> | undefined;
  const value = env?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function createApiApp(deps: ApiDeps = {}): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  app.route('/', createCaptchaConfigRoutes());
  app.route('/', createReleasesRoutes(deps));
  app.route('/', createTelemetryRoutes());
  app.route('/', createHealthRoutes());
  app.route('/', createModelsRoutes(deps));
  app.route('/', createPlatformConfigRoutes(deps));
  app.route('/', createShareRoutes(deps));
  app.route('/', createI18nRoutes(deps));

  return app;
}

/**
 * বাংলা মন্তব্য: Hono অ্যাপে রেজিস্টার করা সব কংক্রিট পাথ (wildcard middleware বাদ)।
 * Express adapter ঠিক এই পাথগুলোতেই Hono mount করে, তাই নতুন রুট যোগ করলে
 * আলাদা তালিকা আপডেট করতে হয় না।
 */
export function listApiPaths(app: Hono<ApiEnv>): string[] {
  const paths = new Set<string>();
  for (const route of app.routes) {
    if (!route.path.includes('*')) paths.add(route.path);
  }
  return [...paths].sort();
}
