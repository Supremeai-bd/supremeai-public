/**
 * Applies the same baseline security headers to every Pages Function response
 * that `public/_headers` applies to static assets.
 *
 * The response body is passed through as a stream, so SSE endpoints
 * (`/api/v1/stream/chat`, `.../stream`) keep working.
 */

import type { PagesContext } from './_lib/edgeHelpers';

/** Shapes used by Pages Functions middleware (not yet exported by the lib). */
interface MiddlewareContext extends PagesContext {
  next: () => Promise<Response>;
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'microphone=(self), camera=(self), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
};

export async function onRequest(context: MiddlewareContext): Promise<Response> {
  const response = await context.next();
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
