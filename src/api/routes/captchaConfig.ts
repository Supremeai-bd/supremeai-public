import { Hono } from 'hono';
import { readEnv, type ApiEnv } from '../app';

/**
 * GET /api/auth/captcha-config — public Turnstile site key for the sign-in form.
 *
 * বাংলা মন্তব্য: unified Hono রুট হিসেবে Edge ও Node উভয় রানটাইমে একই উত্তর দেয়।
 * সিক্রেট কী কনফিগার না থাকলে উভয় রানটাইমেই enabled:false ফেরানো হয়।
 */
export function createCaptchaConfigRoutes(): Hono<ApiEnv> {
  const routes = new Hono<ApiEnv>();

  routes.get('/api/auth/captcha-config', (c) => {
    const siteKey = readEnv(c, 'TURNSTILE_SITE_KEY') ?? '';
    const secretConfigured = Boolean(readEnv(c, 'TURNSTILE_SECRET_KEY'));
    const enabled = Boolean(siteKey) && secretConfigured;
    return c.json(
      {
        provider: 'turnstile',
        enabled,
        siteKey: enabled ? siteKey : '',
      },
      200,
      { 'Cache-Control': 'public, max-age=300' }
    );
  });

  routes.all('/api/auth/captcha-config', (c) =>
    c.json({ error: 'Method not allowed' }, 405, { Allow: 'GET, HEAD' })
  );

  return routes;
}
