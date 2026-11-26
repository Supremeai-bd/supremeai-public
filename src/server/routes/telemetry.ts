// বাংলা মন্তব্য: health/models handler এখন Hono-তে। এই পুরনো Node মডিউলে শুধু
// models ও billing-এর ভাগ করা gateway cache থাকে; Edge কখনো এটি import করে না।
export function createGatewayCatalogFetcher(
  gatewayBase: string,
  deps: { fetch?: typeof fetch; now?: () => number } = {}
): (pathAndQuery: string, ttlMs?: number) => Promise<unknown> {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const catalogCache = new Map<string, { data: unknown; expiresAt: number }>();
  return async (pathAndQuery, ttlMs = 60_000) => {
    const cached = catalogCache.get(pathAndQuery);
    if (cached && cached.expiresAt > now()) return cached.data;
    try {
      const res = await fetchImpl(`${gatewayBase}${pathAndQuery}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4500),
      });
      if (!res.ok) return cached?.data ?? null;
      const data: unknown = await res.json();
      catalogCache.set(pathAndQuery, { data, expiresAt: now() + ttlMs });
      return data;
    } catch {
      return cached?.data ?? null;
    }
  };
}
