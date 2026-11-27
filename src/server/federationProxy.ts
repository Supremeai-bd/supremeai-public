import type { Express, NextFunction, Request, Response } from 'express';
import { Readable } from 'stream';

/**
 * Federation Living Proxy (fail-open) — the `/api/*` catch-all that forwards every
 * route this Studio edge does not implement to the real `Supremeai-bd/supremeai`
 * gateway (auth headers preserved, SSE unbuffered, JSON 502/504 on failure — never
 * a 200 text/html SPA page). Moved verbatim out of `server.ts`; it must stay the
 * LAST `/api` registration, so `server.ts` calls it in the same place as before.
 *
 * বাংলা: server.ts ভাগ — রেজিস্ট্রেশনের ক্রম অপরিবর্তিত।
 */
export const FEDERATION_PROXY_HOP_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'accept-encoding',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'x-forwarded-proto',
  'x-real-ip',
]);

export function registerFederationProxy(app: Express, ctx: { gatewayBase: string }): void {
  const GATEWAY_BASE = ctx.gatewayBase;
  app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/mock')) {
      next();
      return;
    }

    const originalUrl = req.originalUrl || req.url;
    const targetUrl = `${GATEWAY_BASE}${originalUrl}`;
    const upstreamHeaders: Record<string, string> = { Accept: 'application/json' };

    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value !== 'string') continue;
      const lower = key.toLowerCase();
      if (FEDERATION_PROXY_HOP_HEADERS.has(lower)) continue;
      upstreamHeaders[key] = value;
    }
    if (!upstreamHeaders.accept || upstreamHeaders.accept === '*/*') {
      upstreamHeaders.accept = 'application/json';
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    let body: string | undefined;
    if (hasBody) {
      if (typeof req.body === 'object' && req.body !== null && Object.keys(req.body).length > 0) {
        body = JSON.stringify(req.body);
        upstreamHeaders['content-type'] = upstreamHeaders['content-type'] || 'application/json';
      }
    }

    const controller = new AbortController();
    let responseStarted = false;
    const timeout = setTimeout(() => {
      if (!responseStarted) controller.abort();
    }, 9_000);

    req.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers: upstreamHeaders,
        body,
        signal: controller.signal,
        redirect: 'manual',
      });
      responseStarted = true;
      clearTimeout(timeout);

      const responseHeaders = new Headers(upstream.headers);
      for (const header of [
        'content-encoding',
        'content-length',
        'transfer-encoding',
        'connection',
        'keep-alive',
      ]) {
        responseHeaders.delete(header);
      }
      responseHeaders.forEach((value, key) => {
        res.setHeader(key, value);
      });
      if ((responseHeaders.get('content-type') || '').includes('text/event-stream')) {
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
      }
      res.setHeader('X-SupremeAI-Proxy', 'federation');

      res.status(upstream.status);
      if (!upstream.body) {
        res.end();
        return;
      }
      const nodeStream = Readable.fromWeb(upstream.body as any);
      nodeStream.on('error', () => {
        if (!res.writableEnded) res.end();
      });
      nodeStream.pipe(res);
    } catch (error: unknown) {
      clearTimeout(timeout);
      if (res.writableEnded) return;
      const detail = error instanceof Error ? error.message : String(error);
      const timedOut = error instanceof Error && error.name === 'AbortError';
      res.status(timedOut ? 504 : 502).json({
        success: false,
        error: timedOut ? 'Federation upstream timeout' : 'Federation upstream unreachable',
        detail,
        upstreamPath: originalUrl,
        retryable: true,
      });
    }
  });
}
