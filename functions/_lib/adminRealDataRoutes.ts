/**
 * বাংলা মন্তব্য: `/api/admin/*`-এর যে রাউটগুলো Render-এ শুধু স্টাব (ফাঁকা/ভুয়া) উত্তর দেয়,
 * সেগুলো edge-এ আসল উৎস থেকে উত্তর দেয়। অ্যাডমিন-অথ যাচাই হয়ে যাওয়ার পরেই এটা ডাকা হয়।
 * `null` ফেরত = এই রাউট এখানে হ্যান্ডেল হয় না, আগের মতো upstream-এ যাক।
 */

import { forwardRawUpstream, jsonEdgeResponse } from './edgeHelpers';
import {
  PROBE_BATCH_SIZE,
  buildProviderKeys,
  collectVault,
  resetProviderVaultCache,
  toVaultKeyRows,
  type AdminProviderKey,
  type CollectedVault,
} from './providerVault';
import { checkAdminConnections, listSupabaseUsers, mergeCustomers } from './adminRealData';

type Env = Record<string, string | undefined> | undefined;

async function upstreamJson(
  request: Request,
  upstreamOrigin: string,
  pathAndSearch: string
): Promise<Record<string, unknown> | null> {
  try {
    const res = await forwardRawUpstream(request.clone(), upstreamOrigin, pathAndSearch, 8000);
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

function summaryMessage(keys: AdminProviderKey[]): string {
  const healthy = keys.filter((k) => k.status === 'healthy').length;
  const failing = keys.filter((k) => k.status === 'unhealthy').length;
  return `${keys.length} keys tested · ${healthy} healthy · ${failing} failing`;
}

export async function handleAdminRealDataRoute(
  path: string,
  request: Request,
  env: Env,
  upstreamOrigin: string
): Promise<Response | null> {
  const method = request.method;
  const reply = (data: unknown, status = 200) =>
    jsonEdgeResponse(data, status, request, undefined, env);

  const providerPayload = async (vault: CollectedVault, keys: AdminProviderKey[]) => {
    if (keys.length > 0) {
      return { providers: keys, vaultSummary: vault.summary, source: 'edge-vault' };
    }
    // ভল্ট/edge-env-এ কিছু না পেলে ব্যাকএন্ডের তালিকা (যদি সেটা আসলে কিছু দেয়)
    const upstream = await upstreamJson(request, upstreamOrigin, '/api/admin/providers');
    const upstreamProviders = Array.isArray(upstream?.providers) ? upstream.providers : [];
    return {
      providers: upstreamProviders,
      vaultSummary: vault.summary,
      source: upstreamProviders.length ? 'backend' : 'none',
    };
  };

  if (path === '/api/admin/providers' && method === 'GET') {
    const vault = await collectVault(env);
    const keys = await buildProviderKeys(vault, { probe: 'stale' });
    return reply(await providerPayload(vault, keys));
  }

  if (path === '/api/admin/providers/probe-all' && method === 'POST') {
    // বাংলা মন্তব্য: ব্যাচে প্রোব (PROBE_BATCH_SIZE) — ক্লায়েন্ট `nextCursor` ধরে বাকি ব্যাচ চায়,
    // তাই কোনো একক রিকোয়েস্ট Cloudflare-এর ৫০ subrequest সীমা ছোঁয় না।
    const body = (await request
      .clone()
      .json()
      .catch(() => ({}))) as { cursor?: unknown };
    const vault = await collectVault(env);
    const listed = await buildProviderKeys(vault, { probe: 'none' });
    const cursor = Math.max(0, Math.min(listed.length, Math.floor(Number(body.cursor) || 0)));
    const batchIds = new Set(listed.slice(cursor, cursor + PROBE_BATCH_SIZE).map((k) => k.id));
    const end = cursor + batchIds.size;
    const nextCursor = end < listed.length ? end : null;
    const keys = await buildProviderKeys(vault, {
      probe: 'all',
      onlyIds: batchIds,
      maxProbes: PROBE_BATCH_SIZE,
    });
    if (keys.length === 0) {
      return reply({
        success: false,
        message: vault.summary.connected
          ? 'Vault is linked but has no AI provider keys.'
          : `Vault not linked — set ${vault.summary.missingEnv.join(', ') || 'Infisical credentials'} in Cloudflare Pages env.`,
        providers: [],
        vaultKeys: [],
        vaultSummary: vault.summary,
      });
    }
    return reply({
      success: keys.every((k) => k.status !== 'unhealthy'),
      message:
        nextCursor === null
          ? summaryMessage(keys)
          : `Probed ${end} of ${listed.length} keys — continuing…`,
      providers: keys,
      vaultKeys: toVaultKeyRows(keys, vault.summary.lastSyncedAt),
      vaultSummary: vault.summary,
      nextCursor,
      probedThrough: end,
      total: listed.length,
    });
  }

  if (path === '/api/admin/providers/probe' && method === 'POST') {
    const body = (await request
      .clone()
      .json()
      .catch(() => ({}))) as { providerId?: string };
    const vault = await collectVault(env);
    const target = String(body.providerId || '');
    const keys = await buildProviderKeys(vault, { probe: 'none' });
    if (!keys.some((k) => k.id === target)) return null; // ভল্টের কী নয় — পুরনো upstream পথে যাক
    const updated = await buildProviderKeys(vault, { probe: 'stale', onlyId: target });
    const hit = updated.find((k) => k.id === target)!;
    return reply({
      success: hit.status === 'healthy' || hit.status === 'degraded',
      message: `${hit.displayName}: ${hit.probeMessage || hit.status}`,
      providers: updated,
      vaultKeys: toVaultKeyRows(updated, vault.summary.lastSyncedAt),
    });
  }

  if (path === '/api/admin/infisical/vault-keys' && method === 'GET') {
    const vault = await collectVault(env);
    const keys = await buildProviderKeys(vault, { probe: 'none' });
    const tested = keys.filter((k) => k.latencyMs > 0);
    return reply({
      vaultEngine: 'Infisical Secrets Vault',
      mode: vault.summary.mode,
      totalKeys: vault.summary.totalSecrets,
      healthyCount: keys.filter((k) => k.status === 'healthy').length,
      avgVaultLatencyMs: tested.length
        ? Math.round(tested.reduce((s, k) => s + k.latencyMs, 0) / tested.length)
        : 0,
      lastSyncedAt: vault.summary.lastSyncedAt,
      keys: toVaultKeyRows(keys, vault.summary.lastSyncedAt),
      vaultSummary: vault.summary,
    });
  }

  if (path === '/api/admin/infisical/sync' && method === 'POST') {
    resetProviderVaultCache();
    const vault = await collectVault(env, { force: true });
    const keys = await buildProviderKeys(vault, { probe: 'none' });
    return reply({
      success: vault.summary.connected,
      syncedAt: vault.summary.lastSyncedAt,
      keys: toVaultKeyRows(keys, vault.summary.lastSyncedAt),
      message: vault.summary.connected
        ? `Synced ${vault.summary.totalSecrets} secrets (${vault.summary.providerSecrets} AI keys).`
        : vault.summary.error ||
          `Vault not linked — set ${vault.summary.missingEnv.join(', ')} in Cloudflare Pages env.`,
      vaultSummary: vault.summary,
    });
  }

  if (path === '/api/admin/connections' && method === 'GET') {
    const vault = await collectVault(env);
    const connections = await checkAdminConnections(env, { vault: vault.summary, upstreamOrigin });
    return reply({ connections, checkedAt: new Date().toISOString() });
  }

  if (path === '/api/admin/customers' && method === 'GET') {
    const [upstream, authUsers] = await Promise.all([
      upstreamJson(request, upstreamOrigin, '/api/admin/customers'),
      listSupabaseUsers(env),
    ]);
    const tableRows: Array<{ email: string }> = Array.isArray(upstream?.customers)
      ? upstream.customers
      : [];
    if (authUsers === null) {
      if (upstream === null) return null; // কিছুই জানা নেই — পুরনো পথ (upstream/edge fallback)
      return reply({ customers: tableRows, provenance: 'customers-table', authUsersLinked: false });
    }
    return reply({
      customers: mergeCustomers(tableRows, authUsers),
      provenance: tableRows.length ? 'customers-table+supabase-auth' : 'supabase-auth',
      authUsersLinked: true,
      authUserCount: authUsers.length,
    });
  }

  return null;
}
