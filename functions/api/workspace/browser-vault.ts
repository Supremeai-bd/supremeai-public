import {
  PagesContext,
  handleCorsPreflight,
  jsonEdgeResponse,
  resolveUpstreamOrigin,
  fetchWithTimeout,
} from '../../_lib/edgeHelpers';

interface StoredVaultEntry {
  id: string;
  domain: string;
  mode: string;
  label?: string;
  usernameHint?: string;
  cookieCount?: number;
  encryptedPayload?: string;
  iv?: string;
  algorithm?: string;
  updatedAt?: string;
  createdAt?: string;
  [key: string]: unknown;
}

function redactVaultEntry(
  entry: StoredVaultEntry,
  includeEncrypted: boolean
): Record<string, unknown> {
  const hasEncryptedSecret = Boolean(entry.encryptedPayload && entry.iv);
  if (includeEncrypted) {
    return { ...entry, hasEncryptedSecret };
  }
  const { encryptedPayload: _ep, iv: _iv, ...safe } = entry;
  return { ...safe, hasEncryptedSecret };
}

async function fetchUserVaultEntries(
  upstreamOrigin: string,
  authHeader: string
): Promise<{ ok: boolean; status: number; entries: StoredVaultEntry[] }> {
  const res = await fetchWithTimeout(
    `${upstreamOrigin}/api/v1/user/preferences`,
    { headers: { Authorization: authHeader, Accept: 'application/json' } },
    5500
  );
  if (!res.ok) {
    return { ok: false, status: res.status, entries: [] };
  }
  const data = (await res.json().catch(() => null)) as any;
  const remoteEntries = data?.preferences?.browser_vault_entries;
  return {
    ok: true,
    status: 200,
    entries: Array.isArray(remoteEntries) ? remoteEntries : [],
  };
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);

  const incomingUrl = new URL(request.url);
  const upstreamOrigin = resolveUpstreamOrigin(env);
  const authHeader = (request.headers.get('Authorization') || '').trim();
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!bearer || bearer.startsWith('tok_guest_') || bearer.startsWith('sk-supreme-guest')) {
    return jsonEdgeResponse(
      { error: 'Authenticated user session is required to access the credential vault.' },
      401,
      request,
      undefined,
      env
    );
  }

  const includeEncrypted = incomingUrl.searchParams.get('includeEncrypted') === '1';
  const domainFilter = (incomingUrl.searchParams.get('domain') || '').trim().toLowerCase();

  try {
    if (request.method === 'GET') {
      const loaded = await fetchUserVaultEntries(upstreamOrigin, authHeader);
      if (!loaded.ok) {
        return jsonEdgeResponse(
          { error: 'Could not verify user vault session.' },
          loaded.status === 401 || loaded.status === 403 ? loaded.status : 502,
          request,
          undefined,
          env
        );
      }

      const filtered = domainFilter
        ? loaded.entries.filter((e) =>
            String(e.domain || '')
              .toLowerCase()
              .includes(domainFilter)
          )
        : loaded.entries;

      return jsonEdgeResponse(
        {
          entries: filtered.map((e) => redactVaultEntry(e, includeEncrypted)),
        },
        200,
        request,
        undefined,
        env
      );
    }

    if (request.method === 'POST') {
      const loaded = await fetchUserVaultEntries(upstreamOrigin, authHeader);
      if (!loaded.ok) {
        return jsonEdgeResponse(
          { error: 'Could not verify user vault session.' },
          loaded.status === 401 || loaded.status === 403 ? loaded.status : 502,
          request,
          undefined,
          env
        );
      }

      const body = (await request.json().catch(() => ({}))) as Partial<StoredVaultEntry>;
      if (!body.domain || !body.encryptedPayload || !body.iv) {
        return jsonEdgeResponse(
          { error: 'domain, encryptedPayload, and iv are required.' },
          400,
          request,
          undefined,
          env
        );
      }

      const id = String(body.id || `vault_${Date.now()}`);
      const entry: StoredVaultEntry = {
        ...body,
        id,
        domain: String(body.domain).trim().toLowerCase(),
        mode: body.mode === 'credentials' ? 'credentials' : 'session',
        updatedAt: String(body.updatedAt || new Date().toISOString()),
      };

      const entries = [...loaded.entries];
      const existingIdx = entries.findIndex((e) => e.id === id);
      if (existingIdx >= 0) {
        entries[existingIdx] = entry;
      } else {
        entries.unshift(entry);
      }

      const saveRes = await fetchWithTimeout(
        `${upstreamOrigin}/api/v1/user/preferences`,
        {
          method: 'POST',
          headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({ browser_vault_entries: entries }),
        },
        5500
      );
      if (!saveRes.ok) {
        return jsonEdgeResponse(
          { error: 'Failed to persist vault entry.' },
          saveRes.status === 401 || saveRes.status === 403 ? saveRes.status : 502,
          request,
          undefined,
          env
        );
      }

      return jsonEdgeResponse(
        {
          success: true,
          entry: redactVaultEntry(entry, includeEncrypted),
          entries: entries.map((e) => redactVaultEntry(e, includeEncrypted)),
        },
        200,
        request,
        undefined,
        env
      );
    }

    if (request.method === 'DELETE') {
      const loaded = await fetchUserVaultEntries(upstreamOrigin, authHeader);
      if (!loaded.ok) {
        return jsonEdgeResponse(
          { error: 'Could not verify user vault session.' },
          loaded.status === 401 || loaded.status === 403 ? loaded.status : 502,
          request,
          undefined,
          env
        );
      }

      const body = (await request.json().catch(() => ({}))) as { id?: string };
      const targetId = String(incomingUrl.searchParams.get('id') || body.id || '').trim();
      const entries = targetId ? loaded.entries.filter((e) => e.id !== targetId) : loaded.entries;

      const saveRes = await fetchWithTimeout(
        `${upstreamOrigin}/api/v1/user/preferences`,
        {
          method: 'POST',
          headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({ browser_vault_entries: entries }),
        },
        5500
      );
      if (!saveRes.ok) {
        return jsonEdgeResponse(
          { error: 'Failed to delete vault entry.' },
          saveRes.status === 401 || saveRes.status === 403 ? saveRes.status : 502,
          request,
          undefined,
          env
        );
      }

      return jsonEdgeResponse({ success: true, deletedId: targetId }, 200, request, undefined, env);
    }

    return jsonEdgeResponse({ error: 'Method not allowed' }, 405, request, undefined, env);
  } catch (err: unknown) {
    return jsonEdgeResponse(
      { error: err instanceof Error ? err.message : 'Vault upstream error' },
      502,
      request,
      undefined,
      env
    );
  }
}
