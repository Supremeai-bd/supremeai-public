/**
 * GET /api/auth/captcha-config — public Turnstile site key for the sign-in form.
 *
 * বাংলা: site key পাবলিক (গোপন নয়), তাই রানটাইমে এজ থেকে দেওয়া হয় — ফলে বিল্ড/ওয়ার্কফ্লোতে
 * কিছু বদলাতে হয় না। দুটো কী-ই Cloudflare Pages env-এ থাকে। সিক্রেট কী না থাকলে
 * এজ টোকেন যাচাই করে না, তাই তখন widget-ও দেখানো হয় না (enabled:false)।
 */

import { jsonEdgeResponse } from '../../_lib/edgeHelpers';

interface PagesContext {
  request: Request;
  env?: Record<string, string | undefined>;
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env = {} } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonEdgeResponse({ error: 'Method not allowed' }, 405, request, undefined, env);
  }
  const siteKey = (env.TURNSTILE_SITE_KEY || '').trim();
  const secretConfigured = Boolean((env.TURNSTILE_SECRET_KEY || '').trim());
  const enabled = Boolean(siteKey) && secretConfigured;
  return jsonEdgeResponse(
    { provider: 'turnstile', enabled, siteKey: enabled ? siteKey : '' },
    200,
    request,
    { 'Cache-Control': 'public, max-age=300' },
    env
  );
}
