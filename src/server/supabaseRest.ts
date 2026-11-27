/* eslint-disable @typescript-eslint/no-explicit-any */
// Minimal Supabase PostgREST client (service-role). Returns null when Supabase
// is not configured; throws on non-2xx so callers can fall back to local state.
export async function supabaseRestRequest(
  pathAndQuery: string,
  method: string,
  body?: unknown,
  prefer = 'return=minimal'
): Promise<any> {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
    .trim()
    .replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok)
    throw new Error(`Supabase ${method} ${pathAndQuery.split('?')[0]} -> HTTP ${res.status}`);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
