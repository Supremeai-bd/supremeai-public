import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';

/**
 * Frontend serving + final error handler for the Express bootstrap, moved verbatim
 * out of `server.ts` (docs/SERVER_TS_SPLIT_PLAN.md). Registration order is kept:
 * `server.ts` calls `mountFrontend` right after the federation proxy and
 * `registerErrorHandler` last.
 */
export type ViteServerPromise = Promise<Awaited<ReturnType<typeof createViteServer>>> | null;

/** Production: `dist/` static + SPA fallback. Dev: Vite middleware (initialised async). */
export function mountFrontend(
  app: Express,
  ctx: { isProduction: boolean; rootDir: string }
): ViteServerPromise {
  const { isProduction } = ctx;
  let viteServerPromise: ViteServerPromise = null;
  if (isProduction) {
    app.use(express.static(path.resolve(ctx.rootDir, 'dist')));
    // বাংলা মন্তব্য: index.html একবারই (স্টার্টআপে) মেমরিতে পড়া হয় — প্রতি রিকোয়েস্টে ডিস্ক
    // অ্যাক্সেস নেই (দ্রুত + CodeQL "missing rate limiting on file system access" ঠিক)।
    // ফাইল না থাকলে আগের মতোই 404 error handler-এ যায়।
    const indexPath = path.resolve(ctx.rootDir, 'dist', 'index.html');
    let indexHtml: string | null = null;
    let indexError: Error | null = null;
    try {
      indexHtml = fs.readFileSync(indexPath, 'utf8');
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      indexError = Object.assign(e, {
        status: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500,
      });
    }
    // Express 5-compatible SPA fallback (avoids path-to-regexp v8 wildcard TypeError)
    app.use((req: Request, res: Response, next: NextFunction) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api')) {
        next();
        return;
      }
      if (indexHtml === null) {
        next(indexError);
        return;
      }
      res.type('html').send(indexHtml);
    });
  } else {
    // Initialize Vite asynchronously so Express binds PORT 3000 and /api/health immediately.
    // Disable Vite's standalone WebSocket server (ws: false) to avoid port 24678 collisions on restart.
    viteServerPromise = createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
        watch:
          process.env.DISABLE_HMR === 'true'
            ? null
            : {
                ignored: [
                  '**/.git/**',
                  '**/dist/**',
                  '**/.aistudio/**',
                  '**/node_modules/**',
                  '**/functions/**',
                ],
              },
      },
      appType: 'spa',
    });
    viteServerPromise.catch((err) => {
      console.error('Failed to initialize Vite dev middleware:', err);
    });
    app.use(async (req: Request, res: Response, next) => {
      try {
        const vite = await viteServerPromise;
        if (!vite) {
          next();
          return;
        }
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  }
  return viteServerPromise;
}

/** Centralized 4-arg Express error handler (no stack traces in production). */
export function registerErrorHandler(app: Express, isProduction: boolean): void {
  app.use(
    (
      err: { status?: unknown; message?: unknown } | null | undefined,
      _req: Request,
      res: Response,
      _next: NextFunction
    ) => {
      const status =
        typeof err?.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
      if (res.headersSent) return;
      res.status(status).json({
        error:
          status < 500
            ? String(err?.message || 'Bad request')
            : isProduction
              ? 'Internal server error.'
              : String(err?.message || 'Internal server error.'),
      });
    }
  );
}
