export const testSessionHeaders = { Authorization: 'Bearer test-user-session' };
export const testEdgeEnv = { SUPREMEAI_BACKEND_URL: 'https://backend.example.test' };

export function mockEdgePreferences() {
  let preferences: Record<string, unknown> = {};
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== testEdgeEnv.SUPREMEAI_BACKEND_URL) throw new Error(`Unexpected URL: ${url}`);
    if (request.headers.get('Authorization') !== testSessionHeaders.Authorization) {
      return new Response(null, { status: 401 });
    }
    if (url.pathname === '/api/admin/totp-setup') return new Response(null, { status: 204 });
    if (url.pathname !== '/api/v1/user/preferences')
      throw new Error(`Unexpected path: ${url.pathname}`);
    if (request.method === 'POST') preferences = { ...preferences, ...(await request.json()) };
    return Response.json({ preferences });
  };
}
