/**
 * বাংলা মন্তব্য: অ্যালার্ট চ্যানেল (Telegram / Discord / Slack / webhook) + অ্যালার্ট ইতিহাস।
 *
 * - চ্যানেলের গোপন অংশ (বট টোকেন, webhook URL) Supabase Vault-এ এনক্রিপ্টেড থাকে
 *   (migration 20261127153731_admin_alert_channels)। ব্রাউজারে কখনো ফেরত যায় না — শুধু hint।
 * - চ্যানেল সেভ করলেই নিজে থেকে একটা যাচাই-বার্তা যায় (আলাদা "Test" বাটন নেই) এবং
 *   অবস্থা ok/failed দেখায়।
 * - dispatchAlert: severity অনুযায়ী চ্যানেল বাছে, একই dedupeKey ৬ ঘণ্টায় একবারই পাঠায়,
 *   ইতিহাসে লেখে।
 *
 * Admin routes (behind admin auth):
 *   GET    /api/admin/alerts
 *   POST   /api/admin/alerts/channels              { kind, label, minSeverity?, ...secret }
 *   PATCH  /api/admin/alerts/channels/:id          { label?, minSeverity?, enabled?, ...secret? }
 *   DELETE /api/admin/alerts/channels/:id
 *   POST   /api/admin/alerts/events/:id/ack
 *
 * Machine ingest (core, CI workflows, keep-warm worker):
 *   POST   /api/internal/alerts   Authorization: Bearer <SUPREMEAI_API_TOKEN | ALERT_INGEST_TOKEN>
 *          { severity, source, title, body?, dedupeKey? }
 */

import { jsonEdgeResponse, timingSafeEqualStrings } from './edgeHelpers';
import { resolveSupabaseAdmin } from './adminRealData';
import { resolveCoreServiceToken } from './coreAdminBridge';

type Env = Record<string, string | undefined> | undefined;

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type ChannelKind = 'telegram' | 'discord' | 'slack' | 'webhook';

export interface AlertInput {
  severity: AlertSeverity;
  source: string;
  title: string;
  body?: string;
  dedupeKey?: string;
}

export interface AlertChannel {
  id: string;
  kind: ChannelKind;
  label: string;
  minSeverity: AlertSeverity;
  enabled: boolean;
  targetHint: string | null;
  lastStatus: 'ok' | 'failed' | 'untested';
  lastError: string | null;
  lastSentAt: string | null;
}

export interface AlertEvent {
  id: string;
  createdAt: string;
  severity: AlertSeverity;
  source: string;
  title: string;
  body: string | null;
  delivered: number;
  failed: number;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

const TIMEOUT_MS = 8000;
const DEDUPE_HOURS = 6;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set<ChannelKind>(['telegram', 'discord', 'slack', 'webhook']);
const SEVERITIES = new Set<AlertSeverity>(['info', 'warning', 'critical']);
const SEVERITY_ICON: Record<AlertSeverity, string> = { info: 'ℹ️', warning: '⚠️', critical: '🚨' };

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

// ── Channel secret validation ────────────────────────────────────────────────

function httpsUrl(raw: unknown): URL | null {
  try {
    const url = new URL(String(raw || '').trim());
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      /^[\d.]+$/.test(host) ||
      host.includes(':')
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/**
 * Validate the secret part of a channel. Returns the JSON to store in Vault and a
 * non-secret hint for display, or an error message.
 */
export function buildChannelSecret(
  kind: ChannelKind,
  input: Record<string, unknown>
): { ok: true; secret: string; hint: string } | { ok: false; error: string } {
  if (kind === 'telegram') {
    const botToken = String(input.botToken || '').trim();
    const chatId = String(input.chatId || '').trim();
    if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
      return { ok: false, error: 'Telegram bot token looks wrong (expected 123456:ABC…).' };
    }
    if (!/^-?\d{3,20}$/.test(chatId) && !/^@[A-Za-z0-9_]{5,32}$/.test(chatId)) {
      return { ok: false, error: 'Telegram chat id must be a number (e.g. -100123…) or @channel.' };
    }
    return { ok: true, secret: JSON.stringify({ botToken, chatId }), hint: `chat ${chatId}` };
  }
  const url = httpsUrl(input.url);
  if (!url) return { ok: false, error: 'A valid https:// URL is required.' };
  const host = url.hostname.toLowerCase();
  if (kind === 'discord') {
    if (!/^(discord|discordapp)\.com$/.test(host) || !url.pathname.startsWith('/api/webhooks/')) {
      return {
        ok: false,
        error: 'Discord webhook URL must look like https://discord.com/api/webhooks/…',
      };
    }
  }
  if (kind === 'slack' && (host !== 'hooks.slack.com' || !url.pathname.startsWith('/services/'))) {
    return {
      ok: false,
      error: 'Slack webhook URL must look like https://hooks.slack.com/services/…',
    };
  }
  const tail = url.pathname.replace(/\/+$/, '').slice(-4);
  return { ok: true, secret: JSON.stringify({ url: url.toString() }), hint: `${host} …${tail}` };
}

// ── Sending ──────────────────────────────────────────────────────────────────

export function formatAlertText(alert: AlertInput): string {
  const head = `${SEVERITY_ICON[alert.severity]} [${alert.severity.toUpperCase()}] ${alert.title}`;
  const body = alert.body ? `\n${alert.body}` : '';
  return `${head}${body}\n— SupremeAI · ${alert.source}`.slice(0, 1900);
}

async function timedFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendToChannel(
  kind: ChannelKind,
  secretJson: string,
  alert: AlertInput,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; error?: string }> {
  let secret: Record<string, unknown>;
  try {
    secret = asRecord(JSON.parse(secretJson));
  } catch {
    return { ok: false, error: 'Stored channel secret is unreadable — save the channel again.' };
  }
  const text = formatAlertText(alert);
  const post = (url: string, body: unknown) =>
    timedFetch(fetchImpl, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  let res: Response | null;
  if (kind === 'telegram') {
    res = await post(`https://api.telegram.org/bot${String(secret.botToken || '')}/sendMessage`, {
      chat_id: secret.chatId,
      text,
      disable_web_page_preview: true,
    });
  } else if (kind === 'discord') {
    res = await post(String(secret.url || ''), { content: text });
  } else if (kind === 'slack') {
    res = await post(String(secret.url || ''), { text });
  } else {
    res = await post(String(secret.url || ''), {
      severity: alert.severity,
      source: alert.source,
      title: alert.title,
      body: alert.body || null,
      text,
      sentAt: new Date().toISOString(),
    });
  }
  if (!res) return { ok: false, error: 'No response (timeout or network error).' };
  if (res.ok) return { ok: true };
  const detail = asRecord(await res.json().catch(() => null));
  const reason = String(detail.description || detail.message || '').slice(0, 160);
  return { ok: false, error: `HTTP ${res.status}${reason ? `: ${reason}` : ''}` };
}

// ── Supabase helpers ─────────────────────────────────────────────────────────

async function db(
  env: Env,
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const cfg = resolveSupabaseAdmin(env)!;
  const res = await timedFetch(fetchImpl, `${cfg.url}/rest/v1/${path}`, {
    method: init.method || 'GET',
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      Accept: 'application/json',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res) return { ok: false, status: 504, data: null };
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

const CHANNEL_COLS =
  'id,kind,label,min_severity,enabled,target_hint,last_status,last_error,last_sent_at';

export function mapChannel(row: unknown): AlertChannel {
  const r = asRecord(row);
  return {
    id: String(r.id || ''),
    kind: (KINDS.has(r.kind as ChannelKind) ? r.kind : 'webhook') as ChannelKind,
    label: String(r.label || ''),
    minSeverity: (SEVERITIES.has(r.min_severity as AlertSeverity)
      ? r.min_severity
      : 'warning') as AlertSeverity,
    enabled: r.enabled !== false,
    targetHint: r.target_hint ? String(r.target_hint) : null,
    lastStatus: r.last_status === 'ok' || r.last_status === 'failed' ? r.last_status : 'untested',
    lastError: r.last_error ? String(r.last_error) : null,
    lastSentAt: r.last_sent_at ? String(r.last_sent_at) : null,
  };
}

export function mapEvent(row: unknown): AlertEvent {
  const r = asRecord(row);
  return {
    id: String(r.id || ''),
    createdAt: String(r.created_at || ''),
    severity: (SEVERITIES.has(r.severity as AlertSeverity) ? r.severity : 'info') as AlertSeverity,
    source: String(r.source || ''),
    title: String(r.title || ''),
    body: r.body ? String(r.body) : null,
    delivered: Number(r.delivered) || 0,
    failed: Number(r.failed) || 0,
    acknowledgedAt: r.acknowledged_at ? String(r.acknowledged_at) : null,
    acknowledgedBy: r.acknowledged_by ? String(r.acknowledged_by) : null,
  };
}

async function recordChannelResult(
  env: Env,
  id: string,
  result: { ok: boolean; error?: string },
  fetchImpl: typeof fetch
): Promise<void> {
  await db(
    env,
    `alert_channels?id=eq.${id}`,
    {
      method: 'PATCH',
      body: {
        last_status: result.ok ? 'ok' : 'failed',
        last_error: result.ok ? null : (result.error || 'failed').slice(0, 300),
        last_sent_at: new Date().toISOString(),
      },
    },
    fetchImpl
  );
}

export function validateAlertInput(raw: unknown): AlertInput | null {
  const r = asRecord(raw);
  const severity = r.severity as AlertSeverity;
  const source = String(r.source || '')
    .trim()
    .slice(0, 60);
  const title = String(r.title || '')
    .trim()
    .slice(0, 200);
  if (!SEVERITIES.has(severity) || !source || !title) return null;
  const body = r.body ? String(r.body).trim().slice(0, 2000) : undefined;
  const dedupeKey = r.dedupeKey ? String(r.dedupeKey).trim().slice(0, 200) : undefined;
  return { severity, source, title, body, dedupeKey };
}

/** Send an alert to every matching channel (deduped) and record it. */
export async function dispatchAlert(
  env: Env,
  alert: AlertInput,
  fetchImpl: typeof fetch = fetch
): Promise<{ deduped: boolean; delivered: number; failed: number; eventId: string | null }> {
  if (alert.dedupeKey) {
    const since = new Date(Date.now() - DEDUPE_HOURS * 3600_000).toISOString();
    const dup = await db(
      env,
      `alert_events?select=id&dedupe_key=eq.${encodeURIComponent(alert.dedupeKey)}&created_at=gte.${encodeURIComponent(since)}&limit=1`,
      {},
      fetchImpl
    );
    if (dup.ok && Array.isArray(dup.data) && dup.data.length > 0) {
      return { deduped: true, delivered: 0, failed: 0, eventId: null };
    }
  }
  const targets = await db(
    env,
    'rpc/alert_dispatch_targets',
    { method: 'POST', body: { p_severity: alert.severity } },
    fetchImpl
  );
  const rows = targets.ok && Array.isArray(targets.data) ? targets.data.map(asRecord) : [];
  const results = await Promise.all(
    rows.map(async (row) => {
      const result = await sendToChannel(
        row.kind as ChannelKind,
        String(row.secret || ''),
        alert,
        fetchImpl
      );
      await recordChannelResult(env, String(row.id), result, fetchImpl);
      return result.ok;
    })
  );
  const delivered = results.filter(Boolean).length;
  const failed = results.length - delivered;
  const inserted = await db(
    env,
    'alert_events',
    {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        severity: alert.severity,
        source: alert.source,
        title: alert.title,
        body: alert.body || null,
        dedupe_key: alert.dedupeKey || null,
        delivered,
        failed,
      },
    },
    fetchImpl
  );
  const eventId =
    inserted.ok && Array.isArray(inserted.data) ? String(asRecord(inserted.data[0]).id || '') : '';
  return { deduped: false, delivered, failed, eventId: eventId || null };
}

async function verifyChannel(
  env: Env,
  id: string,
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; error?: string }> {
  const res = await db(
    env,
    'rpc/alert_dispatch_targets',
    { method: 'POST', body: { p_severity: 'info', p_channel_id: id } },
    fetchImpl
  );
  const row = res.ok && Array.isArray(res.data) ? asRecord(res.data[0]) : null;
  if (!row?.secret) return { ok: false, error: 'Channel could not be loaded for verification.' };
  const result = await sendToChannel(
    row.kind as ChannelKind,
    String(row.secret),
    {
      severity: 'info',
      source: 'admin',
      title: 'Alert channel connected',
      body: `"${String(row.label || '')}" will now receive SupremeAI alerts.`,
    },
    fetchImpl
  );
  await recordChannelResult(env, id, result, fetchImpl);
  return result;
}

// ── Admin route ──────────────────────────────────────────────────────────────

export async function handleAdminAlertsRoute(
  path: string,
  request: Request,
  env: Env,
  audit: { actor: string; details?: string },
  fetchImpl: typeof fetch = fetch
): Promise<Response | null> {
  if (path !== '/api/admin/alerts' && !path.startsWith('/api/admin/alerts/')) return null;
  const reply = (body: Record<string, unknown>, status = 200) =>
    jsonEdgeResponse(body, status, request);
  const fail = (status: number, error: string) => reply({ success: false, error }, status);
  if (!resolveSupabaseAdmin(env)) {
    return fail(503, 'Alert store not linked (Supabase service key missing).');
  }
  const method = request.method.toUpperCase();
  const body = ['POST', 'PATCH'].includes(method)
    ? asRecord(await request.json().catch(() => null))
    : {};

  const loadChannel = async (id: string) => {
    const res = await db(env, `alert_channels?select=${CHANNEL_COLS}&id=eq.${id}`, {}, fetchImpl);
    return res.ok && Array.isArray(res.data) && res.data[0] ? mapChannel(res.data[0]) : null;
  };

  if (path === '/api/admin/alerts') {
    if (method !== 'GET') return fail(405, 'Method not allowed.');
    const [channels, events] = await Promise.all([
      db(env, `alert_channels?select=${CHANNEL_COLS}&order=created_at.asc`, {}, fetchImpl),
      db(
        env,
        'alert_events?select=id,created_at,severity,source,title,body,delivered,failed,acknowledged_at,acknowledged_by&order=created_at.desc&limit=50',
        {},
        fetchImpl
      ),
    ]);
    if (!channels.ok || !events.ok) return fail(502, 'Could not read alerts from Supabase.');
    return reply({
      success: true,
      channels: (Array.isArray(channels.data) ? channels.data : []).map(mapChannel),
      events: (Array.isArray(events.data) ? events.data : []).map(mapEvent),
    });
  }

  if (path === '/api/admin/alerts/channels') {
    if (method !== 'POST') return fail(405, 'Method not allowed.');
    const kind = body.kind as ChannelKind;
    if (!KINDS.has(kind)) return fail(400, 'Unknown channel type.');
    const label = String(body.label || '').trim();
    if (!label || label.length > 60) return fail(400, 'Name is required (max 60 characters).');
    const minSeverity = (body.minSeverity ?? 'warning') as AlertSeverity;
    if (!SEVERITIES.has(minSeverity)) return fail(400, 'Invalid severity.');
    const secret = buildChannelSecret(kind, body);
    if (!secret.ok) return fail(400, secret.error);
    const saved = await db(
      env,
      'rpc/alert_channel_save',
      {
        method: 'POST',
        body: {
          p_id: null,
          p_kind: kind,
          p_label: label,
          p_min_severity: minSeverity,
          p_enabled: true,
          p_secret: secret.secret,
          p_target_hint: secret.hint,
          p_actor: audit.actor || null,
        },
      },
      fetchImpl
    );
    const id = typeof saved.data === 'string' ? saved.data : '';
    if (!saved.ok || !UUID_RE.test(id)) return fail(502, 'Could not save the channel.');
    const verification = await verifyChannel(env, id, fetchImpl);
    audit.details = `alert channel added: ${kind} "${label}" (${verification.ok ? 'verified' : 'verify failed'})`;
    return reply({ success: true, channel: await loadChannel(id), verification }, 201);
  }

  const channelMatch = /^\/api\/admin\/alerts\/channels\/([^/]+)$/.exec(path);
  if (channelMatch) {
    const id = channelMatch[1];
    if (!UUID_RE.test(id)) return fail(400, 'Invalid channel id.');
    const existing = await loadChannel(id);
    if (!existing) return fail(404, 'Channel not found.');

    if (method === 'DELETE') {
      const res = await db(
        env,
        'rpc/alert_channel_delete',
        { method: 'POST', body: { p_id: id } },
        fetchImpl
      );
      if (!res.ok) return fail(502, 'Could not delete the channel.');
      audit.details = `alert channel removed: ${existing.kind} "${existing.label}"`;
      return reply({ success: true });
    }
    if (method !== 'PATCH') return fail(405, 'Method not allowed.');

    const hasSecret =
      existing.kind === 'telegram' ? Boolean(body.botToken || body.chatId) : Boolean(body.url);
    let secret: { secret: string; hint: string } | null = null;
    if (hasSecret) {
      const built = buildChannelSecret(existing.kind, body);
      if (!built.ok) return fail(400, built.error);
      secret = built;
    }
    const label = body.label === undefined ? null : String(body.label).trim();
    if (label !== null && (!label || label.length > 60)) {
      return fail(400, 'Name is required (max 60 characters).');
    }
    const minSeverity = body.minSeverity === undefined ? null : (body.minSeverity as AlertSeverity);
    if (minSeverity !== null && !SEVERITIES.has(minSeverity)) return fail(400, 'Invalid severity.');
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      return fail(400, 'enabled must be true/false.');
    }
    const saved = await db(
      env,
      'rpc/alert_channel_save',
      {
        method: 'POST',
        body: {
          p_id: id,
          p_kind: existing.kind,
          p_label: label,
          p_min_severity: minSeverity,
          p_enabled: body.enabled === undefined ? null : body.enabled,
          p_secret: secret?.secret ?? null,
          p_target_hint: secret?.hint ?? null,
          p_actor: audit.actor || null,
        },
      },
      fetchImpl
    );
    if (!saved.ok) return fail(502, 'Could not save the channel.');
    const verification = secret ? await verifyChannel(env, id, fetchImpl) : undefined;
    const changes = [
      label !== null ? 'name' : '',
      minSeverity !== null ? `severity=${minSeverity}` : '',
      body.enabled !== undefined ? `enabled=${body.enabled}` : '',
      secret ? 'target' : '',
    ].filter(Boolean);
    audit.details = `alert channel "${existing.label}" updated: ${changes.join(', ') || 'no change'}`;
    return reply({ success: true, channel: await loadChannel(id), verification });
  }

  const ackMatch = /^\/api\/admin\/alerts\/events\/([^/]+)\/ack$/.exec(path);
  if (ackMatch) {
    if (method !== 'POST') return fail(405, 'Method not allowed.');
    const id = ackMatch[1];
    if (!UUID_RE.test(id)) return fail(400, 'Invalid alert id.');
    const res = await db(
      env,
      `alert_events?id=eq.${id}&acknowledged_at=is.null`,
      {
        method: 'PATCH',
        prefer: 'return=representation',
        body: {
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: audit.actor || 'admin',
        },
      },
      fetchImpl
    );
    if (!res.ok) return fail(502, 'Could not acknowledge the alert.');
    const rows = Array.isArray(res.data) ? res.data : [];
    audit.details = `alert ${id.slice(0, 8)} acknowledged`;
    return reply({ success: true, acknowledged: rows.length > 0 });
  }

  return fail(404, 'Unknown alerts route.');
}

// ── Machine ingest ───────────────────────────────────────────────────────────

/**
 * বাংলা মন্তব্য: core / CI / keep-warm যে টোকেন আগে থেকেই জানে (SUPREMEAI_API_TOKEN, env বা
 * Infisical থেকে) সেটা দিয়েই অ্যালার্ট পাঠাতে পারে — নতুন সিক্রেট বাধ্যতামূলক নয়।
 */
export async function handleAlertIngest(
  request: Request,
  env: Env,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const fail = (status: number, error: string) =>
    jsonEdgeResponse({ success: false, error }, status, request);
  if (request.method.toUpperCase() !== 'POST') return fail(405, 'Method not allowed.');
  const presented = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!presented) return fail(401, 'Missing bearer token.');
  const accepted: string[] = [];
  const ingest = String(env?.ALERT_INGEST_TOKEN || '').trim();
  if (ingest) accepted.push(ingest);
  const core = await resolveCoreServiceToken(env, fetchImpl);
  if (core.token) accepted.push(core.token);
  if (!accepted.some((token) => timingSafeEqualStrings(presented, token))) {
    return fail(
      accepted.length ? 403 : 503,
      accepted.length ? 'Invalid token.' : 'Alert ingest token not configured.'
    );
  }
  if (!resolveSupabaseAdmin(env)) return fail(503, 'Alert store not linked.');
  const alert = validateAlertInput(await request.json().catch(() => null));
  if (!alert) return fail(400, 'severity (info|warning|critical), source and title are required.');
  const result = await dispatchAlert(env, alert, fetchImpl);
  return jsonEdgeResponse({ success: true, ...result }, 200, request);
}
