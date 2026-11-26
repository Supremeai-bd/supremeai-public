/**
 * Node adapter — Hono API-কে চলমান Express সার্ভারে mount করা।
 *
 * মাইগ্রেশন চলাকালীন Express-ই Node-এর হোস্ট থাকছে (Vite middleware, বাকি
 * পুরনো রুট)। শুধু Hono-তে সরানো পাথগুলো (`listApiPaths`) এখানে mount হয়;
 * বাকি সব আগের মতো Express-এ যায়। সব রুট সরানো শেষ হলে Express বাদ দিয়ে
 * সরাসরি `@hono/node-server`-এর `serve()` ব্যবহার করা যাবে।
 *
 * ⚠️ ক্রম গুরুত্বপূর্ণ: এটা `express.json()`-এর **আগে** mount করতে হবে,
 * নইলে body stream আগেই পড়া হয়ে যায় আর Hono খালি body পায়।
 */

import type { Express, Request, Response } from 'express';
import { getRequestListener } from '@hono/node-server';
import type { Hono } from 'hono';
import { createApiApp, listApiPaths, type ApiBindings, type ApiEnv } from './app';

export interface MountApiOptions {
  api?: Hono<ApiEnv>;
  /** ডিফল্ট `process.env` — হ্যান্ডলার `readEnv()` দিয়ে পড়ে। */
  env?: ApiBindings;
}

export function mountApiOnExpress(app: Express, options: MountApiOptions = {}): string[] {
  const api = options.api ?? createApiApp();
  const env = options.env ?? (process.env as ApiBindings);
  const paths = listApiPaths(api);
  if (paths.length === 0) return paths;

  const listener = getRequestListener((request) => api.fetch(request, env));
  app.all(paths, (req: Request, res: Response) => {
    // বাংলা মন্তব্য: listener নিজেই error ধরে 500 দেয়; promise ফেলে রাখা নিরাপদ
    void listener(req, res);
  });
  return paths;
}
