import { describe, expect, it, vi } from 'vitest';
import {
  buildChannelSecret,
  dispatchAlert,
  formatAlertText,
  handleAdminAlertsRoute,
  handleAlertIngest,
  sendToChannel,
  validateAlertInput,
} from './adminAlerts';

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  SUPREMEAI_API_TOKEN: 'core-token-123',
};
const CH_ID = '11111111-1111-4111-8111-111111111111';
const EV_ID = '22222222-2222-4222-8222-222222222222';
const TG_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawABCDEF';
const DISCORD = 'https://discord.com/api/webhooks/1/abcdefgh';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

type Call = { url: string; method: string; body: unknown };

/** Fake Supabase + channel endpoints. `routes` returns a Response for a matching call. */
function fakeFetch(routes: (call: Call) => Response | undefined) {
  const calls: Call[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: (init?.method || 'GET').toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return routes(call) ?? json([]);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://studio.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const CHANNEL_ROW = {
  id: CH_ID,
  kind: 'discord',
  label: 'Ops',
  min_severity: 'warning',
  enabled: true,
  target_hint: 'discord.com …efgh',
  last_status: 'ok',
  last_error: null,
  last_sent_at: null,
};

describe('buildChannelSecret', () => {
  it('validates telegram token and chat id', () => {
    expect(buildChannelSecret('telegram', { botToken: 'nope', chatId: '1' }).ok).toBe(false);
    const ok = buildChannelSecret('telegram', { botToken: TG_TOKEN, chatId: '-1001234567' });
    expect(ok).toEqual({
      ok: true,
      secret: JSON.stringify({ botToken: TG_TOKEN, chatId: '-1001234567' }),
      hint: 'chat -1001234567',
    });
  });

  it('pins discord/slack hosts and never leaks the full URL in the hint', () => {
    expect(buildChannelSecret('discord', { url: 'https://evil.com/api/webhooks/1' }).ok).toBe(
      false
    );
    expect(buildChannelSecret('slack', { url: 'https://hooks.slack.com/other' }).ok).toBe(false);
    const d = buildChannelSecret('discord', { url: DISCORD });
    expect(d.ok && d.hint).toBe('discord.com …efgh');
  });

  it('rejects non-https and private hosts for generic webhooks', () => {
    for (const url of ['http://x.com/h', 'https://localhost/h', 'https://10.0.0.1/h', 'nope']) {
      expect(buildChannelSecret('webhook', { url }).ok).toBe(false);
    }
    expect(buildChannelSecret('webhook', { url: 'https://hooks.example.com/a' }).ok).toBe(true);
  });
});

describe('sendToChannel', () => {
  const alert = { severity: 'critical' as const, source: 'core', title: 'Core down', body: 'x' };

  it('formats per provider', async () => {
    const { impl, calls } = fakeFetch(() => json({ ok: true }));
    await sendToChannel(
      'telegram',
      JSON.stringify({ botToken: TG_TOKEN, chatId: '42' }),
      alert,
      impl
    );
    await sendToChannel(
      'slack',
      JSON.stringify({ url: 'https://hooks.slack.com/services/a' }),
      alert,
      impl
    );
    await sendToChannel('discord', JSON.stringify({ url: DISCORD }), alert, impl);
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`);
    expect(calls[0].body).toMatchObject({ chat_id: '42', text: formatAlertText(alert) });
    expect(calls[1].body).toEqual({ text: formatAlertText(alert) });
    expect(calls[2].body).toEqual({ content: formatAlertText(alert) });
    expect(formatAlertText(alert)).toContain('[CRITICAL] Core down');
  });

  it('reports provider errors and network failures', async () => {
    const bad = fakeFetch(() => json({ description: 'chat not found' }, 400));
    expect(
      await sendToChannel(
        'telegram',
        JSON.stringify({ botToken: TG_TOKEN, chatId: '1' }),
        alert,
        bad.impl
      )
    ).toEqual({ ok: false, error: 'HTTP 400: chat not found' });
    const down = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    expect((await sendToChannel('discord', JSON.stringify({ url: DISCORD }), alert, down)).ok).toBe(
      false
    );
    expect((await sendToChannel('discord', 'not json', alert, down)).ok).toBe(false);
  });
});

describe('dispatchAlert', () => {
  it('skips duplicates within the dedupe window', async () => {
    const { impl, calls } = fakeFetch((c) =>
      c.url.includes('/alert_events?select=id') ? json([{ id: EV_ID }]) : undefined
    );
    const res = await dispatchAlert(
      ENV,
      { severity: 'warning', source: 'ci', title: 'Backup stale', dedupeKey: 'backup-stale' },
      impl
    );
    expect(res.deduped).toBe(true);
    expect(calls.some((c) => c.url.includes('alert_dispatch_targets'))).toBe(false);
  });

  it('sends to matching channels, records status and history', async () => {
    const { impl, calls } = fakeFetch((c) => {
      if (c.url.endsWith('/rpc/alert_dispatch_targets')) {
        return json([
          { id: CH_ID, kind: 'discord', label: 'Ops', secret: JSON.stringify({ url: DISCORD }) },
        ]);
      }
      if (c.url === DISCORD) return new Response(null, { status: 204 });
      if (c.url.endsWith('/alert_events') && c.method === 'POST') return json([{ id: EV_ID }], 201);
      return undefined;
    });
    const res = await dispatchAlert(
      ENV,
      { severity: 'critical', source: 'core', title: 'Down' },
      impl
    );
    expect(res).toEqual({ deduped: false, delivered: 1, failed: 0, eventId: EV_ID });
    expect(calls.find((c) => c.url.endsWith('/rpc/alert_dispatch_targets'))?.body).toEqual({
      p_severity: 'critical',
    });
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toContain(`alert_channels?id=eq.${CH_ID}`);
    expect(patch?.body).toMatchObject({ last_status: 'ok', last_error: null });
    expect(
      calls.find((c) => c.url.endsWith('/alert_events') && c.method === 'POST')?.body
    ).toMatchObject({
      severity: 'critical',
      delivered: 1,
      failed: 0,
    });
  });
});

describe('validateAlertInput', () => {
  it('requires severity, source and title', () => {
    expect(validateAlertInput({ severity: 'loud', source: 'a', title: 'b' })).toBeNull();
    expect(validateAlertInput({ severity: 'info', source: '', title: 'b' })).toBeNull();
    expect(validateAlertInput({ severity: 'info', source: 'a', title: 'b' })).toMatchObject({
      severity: 'info',
    });
  });
});

describe('handleAdminAlertsRoute', () => {
  const audit = () => ({ actor: 'owner@x.com' }) as { actor: string; details?: string };

  it('ignores other paths and needs Supabase', async () => {
    expect(
      await handleAdminAlertsRoute('/api/admin/team', req('GET', '/x'), ENV, audit())
    ).toBeNull();
    const res = await handleAdminAlertsRoute('/api/admin/alerts', req('GET', '/x'), {}, audit());
    expect(res?.status).toBe(503);
  });

  it('lists channels without secrets plus recent events', async () => {
    const { impl } = fakeFetch((c) => {
      if (c.url.includes('/alert_channels?')) return json([CHANNEL_ROW]);
      if (c.url.includes('/alert_events?')) {
        return json([
          {
            id: EV_ID,
            created_at: '2026-11-27T10:00:00Z',
            severity: 'critical',
            source: 'core',
            title: 'Down',
            delivered: 1,
            failed: 0,
          },
        ]);
      }
      return undefined;
    });
    const res = await handleAdminAlertsRoute(
      '/api/admin/alerts',
      req('GET', '/x'),
      ENV,
      audit(),
      impl
    );
    const body = await res!.json();
    expect(body.channels[0]).toMatchObject({
      id: CH_ID,
      kind: 'discord',
      targetHint: 'discord.com …efgh',
    });
    expect(JSON.stringify(body)).not.toContain('abcdefgh');
    expect(body.events[0]).toMatchObject({ id: EV_ID, severity: 'critical', acknowledgedAt: null });
  });

  it('creates a channel, stores the secret via RPC and auto-verifies it', async () => {
    const { impl, calls } = fakeFetch((c) => {
      if (c.url.endsWith('/rpc/alert_channel_save')) return json(CH_ID);
      if (c.url.endsWith('/rpc/alert_dispatch_targets')) {
        return json([
          { id: CH_ID, kind: 'discord', label: 'Ops', secret: JSON.stringify({ url: DISCORD }) },
        ]);
      }
      if (c.url === DISCORD) return new Response(null, { status: 204 });
      if (c.url.includes('/alert_channels?select=')) return json([CHANNEL_ROW]);
      return undefined;
    });
    const a = audit();
    const res = await handleAdminAlertsRoute(
      '/api/admin/alerts/channels',
      req('POST', '/x', { kind: 'discord', label: 'Ops', url: DISCORD }),
      ENV,
      a,
      impl
    );
    expect(res?.status).toBe(201);
    const body = await res!.json();
    expect(body.verification).toEqual({ ok: true });
    expect(calls.find((c) => c.url.endsWith('/rpc/alert_channel_save'))?.body).toMatchObject({
      p_id: null,
      p_kind: 'discord',
      p_secret: JSON.stringify({ url: DISCORD }),
      p_target_hint: 'discord.com …efgh',
      p_actor: 'owner@x.com',
    });
    expect(calls.find((c) => c.url.endsWith('/rpc/alert_dispatch_targets'))?.body).toEqual({
      p_severity: 'info',
      p_channel_id: CH_ID,
    });
    expect(a.details).toContain('verified');
    expect(a.details).not.toContain('abcdefgh');
  });

  it('rejects bad input before touching the database', async () => {
    const { impl, calls } = fakeFetch(() => undefined);
    const res = await handleAdminAlertsRoute(
      '/api/admin/alerts/channels',
      req('POST', '/x', { kind: 'discord', label: 'Ops', url: 'https://evil.com/x' }),
      ENV,
      audit(),
      impl
    );
    expect(res?.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('toggles a channel without re-sending or touching the secret', async () => {
    const { impl, calls } = fakeFetch((c) => {
      if (c.url.includes('/alert_channels?select=')) return json([CHANNEL_ROW]);
      if (c.url.endsWith('/rpc/alert_channel_save')) return json(CH_ID);
      return undefined;
    });
    const res = await handleAdminAlertsRoute(
      `/api/admin/alerts/channels/${CH_ID}`,
      req('PATCH', '/x', { enabled: false }),
      ENV,
      audit(),
      impl
    );
    expect(res?.status).toBe(200);
    expect(calls.find((c) => c.url.endsWith('/rpc/alert_channel_save'))?.body).toMatchObject({
      p_id: CH_ID,
      p_enabled: false,
      p_secret: null,
    });
    expect(calls.some((c) => c.url.includes('alert_dispatch_targets'))).toBe(false);
  });

  it('deletes a channel and acknowledges events', async () => {
    const { impl, calls } = fakeFetch((c) => {
      if (c.url.includes('/alert_channels?select=')) return json([CHANNEL_ROW]);
      if (c.url.endsWith('/rpc/alert_channel_delete')) return json(true);
      if (c.url.includes('/alert_events?id=eq.')) return json([{ id: EV_ID }]);
      return undefined;
    });
    const del = await handleAdminAlertsRoute(
      `/api/admin/alerts/channels/${CH_ID}`,
      req('DELETE', '/x'),
      ENV,
      audit(),
      impl
    );
    expect(del?.status).toBe(200);
    const ack = await handleAdminAlertsRoute(
      `/api/admin/alerts/events/${EV_ID}/ack`,
      req('POST', '/x'),
      ENV,
      audit(),
      impl
    );
    expect(await ack!.json()).toEqual({ success: true, acknowledged: true });
    expect(calls.find((c) => c.url.includes('/alert_events?id=eq.'))?.body).toMatchObject({
      acknowledged_by: 'owner@x.com',
    });
    const bad = await handleAdminAlertsRoute(
      '/api/admin/alerts/channels/nope',
      req('DELETE', '/x'),
      ENV,
      audit(),
      impl
    );
    expect(bad?.status).toBe(400);
  });
});

describe('handleAlertIngest', () => {
  const alert = { severity: 'warning', source: 'ci', title: 'Backup failed' };

  it('requires the shared service token', async () => {
    const { impl } = fakeFetch(() => undefined);
    expect(
      (await handleAlertIngest(req('POST', '/api/internal/alerts', alert), ENV, impl)).status
    ).toBe(401);
    const wrong = req('POST', '/api/internal/alerts', alert, { Authorization: 'Bearer nope' });
    expect((await handleAlertIngest(wrong, ENV, impl)).status).toBe(403);
    expect((await handleAlertIngest(req('GET', '/api/internal/alerts'), ENV, impl)).status).toBe(
      405
    );
  });

  it('accepts the core token or ALERT_INGEST_TOKEN and dispatches', async () => {
    const { impl } = fakeFetch((c) =>
      c.url.endsWith('/alert_events') && c.method === 'POST'
        ? json([{ id: EV_ID }], 201)
        : undefined
    );
    const viaCore = req('POST', '/api/internal/alerts', alert, {
      Authorization: 'Bearer core-token-123',
    });
    const res = await handleAlertIngest(viaCore, ENV, impl);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, deduped: false, eventId: EV_ID });
    const viaIngest = req('POST', '/api/internal/alerts', alert, {
      Authorization: 'Bearer ingest-1',
    });
    expect(
      (await handleAlertIngest(viaIngest, { ...ENV, ALERT_INGEST_TOKEN: 'ingest-1' }, impl)).status
    ).toBe(200);
    const bad = req(
      'POST',
      '/api/internal/alerts',
      { severity: 'x' },
      { Authorization: 'Bearer core-token-123' }
    );
    expect((await handleAlertIngest(bad, ENV, impl)).status).toBe(400);
  });
});
