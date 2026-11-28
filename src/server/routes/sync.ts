/**
 * বাংলা মন্তব্য: চারটি প্ল্যাটফর্মের (Web, Desktop, Mobile Android/iOS, এবং VS Code Extension) জন্য
 * রিয়েল-টাইম ক্রস-প্ল্যাটফর্ম সিঙ্ক হাব (`GET/POST /api/v1/sync/state` এবং `GET /api/v1/sync/stream`)।
 * এটি Last-Write-Wins (epoch ms) কনফ্লিক্ট রেজোলিউশন, SSE ফ্যানআউট, লোকাল ভল্ট ও Supabase স্থায়িত্ব নিশ্চিত করে।
 */
import type { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { SYNC_DOMAINS, SYNC_PLATFORMS } from '../../shared/platformCatalog';
import { parseBody, syncEnvelopeBodySchema } from '../validation';

export type ServerSyncDomain = (typeof SYNC_DOMAINS)[number];
export type ServerSyncPlatform = (typeof SYNC_PLATFORMS)[number];

export interface ServerSyncEnvelope<T = unknown> {
  v?: 1;
  protocolVersion: '1.0.0';
  domain: ServerSyncDomain;
  deviceId: string;
  platform: ServerSyncPlatform;
  updatedAt: number;
  revision: number;
  payload: T;
}

interface UserSyncStateRecord {
  userId: string;
  domains: Partial<Record<ServerSyncDomain, ServerSyncEnvelope>>;
  preferences: Record<string, unknown>;
  updatedAt: number;
}

interface SseSubscriber {
  id: string;
  deviceId: string;
  platform: string;
  res: Response;
}

export interface SyncRoutesContext {
  extractToken: (req: Request) => string;
  resolveUserKey: (req: Request, token: string) => Promise<string | null>;
  supabaseRestRequest?: (
    pathAndQuery: string,
    method: string,
    body?: unknown,
    prefer?: string
  ) => Promise<unknown>;
}

export interface SyncHubHandle {
  publishPreferencesChange: (
    userKey: string,
    preferences: Record<string, unknown>,
    sourceDeviceId?: string,
    sourcePlatform?: ServerSyncPlatform
  ) => Promise<void>;
  getMergedPreferences: (userKey: string) => Promise<Record<string, unknown> | null>;
  saveMergedPreferences: (
    userKey: string,
    preferences: Record<string, unknown>
  ) => Promise<void>;
}

const VALID_DOMAINS = new Set<string>(SYNC_DOMAINS);
const VALID_PLATFORMS = new Set<string>(SYNC_PLATFORMS);

function normalizePlatform(raw: unknown): ServerSyncPlatform {
  const clean = String(raw || '')
    .trim()
    .toLowerCase();
  return VALID_PLATFORMS.has(clean) ? (clean as ServerSyncPlatform) : 'web';
}

export function registerSyncRoutes(app: Express, ctx: SyncRoutesContext): SyncHubHandle {
  const SYNC_VAULT_PATH = path.join(process.cwd(), '.supremeai-sync-state.json');
  const subscribersByUser = new Map<string, Set<SseSubscriber>>();

  const loadLocalVault = (): Record<string, UserSyncStateRecord> => {
    try {
      if (fs.existsSync(SYNC_VAULT_PATH)) {
        const parsed = JSON.parse(fs.readFileSync(SYNC_VAULT_PATH, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          return parsed as Record<string, UserSyncStateRecord>;
        }
      }
    } catch {
      // বাংলা মন্তব্য: ডিস্ক ফাইল অনুপস্থিত বা ক্ষতিগ্রস্ত হলে মেমোরি ফলব্যাক ব্যবহৃত হবে
    }
    return {};
  };

  const saveLocalVault = (vault: Record<string, UserSyncStateRecord>): void => {
    try {
      fs.writeFileSync(SYNC_VAULT_PATH, JSON.stringify(vault, null, 2), { mode: 0o600 });
    } catch {
      // Ignore read-only filesystem errors
    }
  };

  const memoryState = new Map<string, UserSyncStateRecord>(
    Object.entries(loadLocalVault())
  );

  const persistUserRecord = async (record: UserSyncStateRecord): Promise<void> => {
    memoryState.set(record.userId, record);
    const vaultObj: Record<string, UserSyncStateRecord> = {};
    for (const [k, v] of memoryState.entries()) {
      vaultObj[k] = v;
    }
    saveLocalVault(vaultObj);

    if (ctx.supabaseRestRequest) {
      try {
        await ctx.supabaseRestRequest(
          'platform_settings',
          'POST',
          [
            {
              id: `user_sync:${record.userId}`,
              value: record,
              updated_at: new Date(record.updatedAt).toISOString(),
            },
          ],
          'resolution=merge-duplicates,return=minimal'
        );
      } catch {
        // বাংলা মন্তব্য: Supabase অফলাইন থাকলে লোকাল ও মেমোরি স্টেট অক্ষত থাকবে
      }
    }
  };

  const loadUserRecord = async (userKey: string): Promise<UserSyncStateRecord> => {
    const existing = memoryState.get(userKey);
    if (ctx.supabaseRestRequest) {
      try {
        const encodedId = encodeURIComponent(`user_sync:${userKey}`);
        const rows = await ctx.supabaseRestRequest(
          `platform_settings?id=eq.${encodedId}&select=value`,
          'GET'
        );
        const remoteVal = Array.isArray(rows)
          ? (rows[0] as { value?: unknown } | undefined)?.value
          : (rows as { value?: unknown } | null)?.value;
        if (remoteVal && typeof remoteVal === 'object') {
          const remoteRec = remoteVal as UserSyncStateRecord;
          if (!existing || Number(remoteRec.updatedAt || 0) >= existing.updatedAt) {
            const normalized: UserSyncStateRecord = {
              userId: userKey,
              domains:
                remoteRec.domains && typeof remoteRec.domains === 'object'
                  ? remoteRec.domains
                  : {},
              preferences:
                remoteRec.preferences && typeof remoteRec.preferences === 'object'
                  ? remoteRec.preferences
                  : {},
              updatedAt: Number(remoteRec.updatedAt || Date.now()),
            };
            memoryState.set(userKey, normalized);
            return normalized;
          }
        }
      } catch {
        // Offline fallback to memoryState
      }
    }

    if (existing) return existing;
    const fresh: UserSyncStateRecord = {
      userId: userKey,
      domains: {},
      preferences: {},
      updatedAt: Date.now(),
    };
    memoryState.set(userKey, fresh);
    return fresh;
  };

  const broadcastToSubscribers = (
    userKey: string,
    envelope: ServerSyncEnvelope,
    excludeDeviceId?: string
  ): void => {
    const subs = subscribersByUser.get(userKey);
    if (!subs || subs.size === 0) return;
    const dataLine = `event: sync\ndata: ${JSON.stringify(envelope)}\n\n`;
    for (const sub of subs) {
      if (excludeDeviceId && sub.deviceId && sub.deviceId === excludeDeviceId) {
        continue;
      }
      try {
        sub.res.write(dataLine);
      } catch {
        subs.delete(sub);
      }
    }
  };

  const resolveRequestIdentity = async (req: Request): Promise<string | null> => {
    const headerToken = ctx.extractToken(req);
    const queryToken = typeof req.query?.token === 'string' ? req.query.token.trim() : '';
    const token = headerToken || queryToken;
    if (!token || token.startsWith('tok_guest_') || token.startsWith('sk-supreme-guest')) {
      return null;
    }
    return ctx.resolveUserKey(req, token);
  };

  // GET /api/v1/sync/state — সব ডোমেইনের সর্বশেষ স্ন্যাপশট ও প্রেফারেন্স প্রদান করে
  app.get(['/api/v1/sync/state', '/api/sync/state'], async (req: Request, res: Response) => {
    const userKey = await resolveRequestIdentity(req);
    if (!userKey) {
      res.status(200).json({
        status: 'guest',
        envelopes: [],
        preferences: {},
        serverTimestamp: Date.now(),
      });
      return;
    }

    const record = await loadUserRecord(userKey);
    const envelopes = Object.values(record.domains).filter(Boolean) as ServerSyncEnvelope[];
    envelopes.sort((a, b) => a.updatedAt - b.updatedAt);

    // বাংলা মন্তব্য: Web, Desktop, Android (Tauri + Kotlin) এবং VS Code উভয় ফরম্যাটের ক্লায়েন্টের জন্য সমন্বিত স্ন্যাপশট রেসপন্স
    const snapshotFields: Record<string, unknown> = {};
    for (const envItem of envelopes) {
      if (envItem.domain === 'theme' || envItem.domain === 'preferences' || envItem.domain === 'models') {
        snapshotFields[envItem.domain] = { updatedAt: envItem.updatedAt, data: envItem.payload };
      } else {
        snapshotFields[envItem.domain] = {
          updatedAt: envItem.updatedAt,
          items: envItem.payload,
          data: envItem.payload,
        };
      }
    }

    res.json({
      status: 'ok',
      userId: userKey,
      ...snapshotFields,
      envelopes,
      preferences: record.preferences,
      serverTimestamp: Date.now(),
    });
  });

  // POST/PUT /api/v1/sync/state — যেকোনো প্ল্যাটফর্ম থেকে আগত পরিবর্তন সংরক্ষণ ও তাৎক্ষণিক SSE ব্রডকাস্ট
  const handleUpsertSyncState = async (req: Request, res: Response) => {
    const userKey = await resolveRequestIdentity(req);
    if (!userKey) {
      res.status(200).json({ status: 'guest-local-only', synced: false });
      return;
    }

    const parsed = parseBody(syncEnvelopeBodySchema, req, res);
    if (!parsed.ok) return;
    const body = parsed.data;
    const domain = body.domain;
    if (!VALID_DOMAINS.has(domain)) {
      res.status(400).json({ error: `Unsupported sync domain: ${domain}` });
      return;
    }

    const deviceId = String(
      body.deviceId ||
        req.headers['x-supremeai-device'] ||
        req.headers['x-device-id'] ||
        `dev-${Date.now()}`
    )
      .trim()
      .slice(0, 128);
    const platform = normalizePlatform(
      body.platform || req.headers['x-supremeai-platform'] || req.headers['x-sync-platform']
    );
    const incomingTs = Number(body.updatedAt);
    const updatedAt =
      Number.isFinite(incomingTs) && incomingTs > 0 ? incomingTs : Date.now();
    const revision = Number.isFinite(Number(body.revision)) ? Number(body.revision) : 1;

    const envelope: ServerSyncEnvelope = {
      v: 1,
      protocolVersion: '1.0.0',
      domain: domain as ServerSyncDomain,
      deviceId,
      platform,
      updatedAt,
      revision,
      payload: body.payload ?? {},
    };

    const record = await loadUserRecord(userKey);
    const currentDomainEnvelope = record.domains[envelope.domain];
    const isNewerOrEqual =
      !currentDomainEnvelope || envelope.updatedAt >= currentDomainEnvelope.updatedAt;

    if (isNewerOrEqual) {
      record.domains[envelope.domain] = envelope;
      record.updatedAt = Math.max(record.updatedAt, envelope.updatedAt);
      if (
        envelope.domain === 'preferences' &&
        envelope.payload &&
        typeof envelope.payload === 'object'
      ) {
        record.preferences = {
          ...record.preferences,
          ...(envelope.payload as Record<string, unknown>),
        };
      }
      await persistUserRecord(record);
      broadcastToSubscribers(userKey, envelope, deviceId);
    }

    res.json({
      status: 'ok',
      synced: true,
      accepted: isNewerOrEqual,
      envelope: record.domains[envelope.domain],
      serverTimestamp: Date.now(),
    });
  };

  app.post(['/api/v1/sync/state', '/api/sync/state'], handleUpsertSyncState);
  app.put(['/api/v1/sync/state', '/api/sync/state'], handleUpsertSyncState);

  // GET /api/v1/sync/stream — রিয়েল-টাইম Server-Sent Events (SSE) চ্যানেল
  app.get(['/api/v1/sync/stream', '/api/sync/stream'], async (req: Request, res: Response) => {
    const userKey = await resolveRequestIdentity(req);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    if (!userKey) {
      res.write(
        `event: connected\ndata: ${JSON.stringify({ status: 'guest', serverTimestamp: Date.now() })}\n\n`
      );
      res.end();
      return;
    }

    const deviceId = String(req.query?.device_id || req.headers['x-device-id'] || '').slice(
      0,
      128
    );
    const platform = normalizePlatform(
      req.query?.platform || req.headers['x-sync-platform']
    );
    const subscriber: SseSubscriber = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      deviceId,
      platform,
      res,
    };

    let set = subscribersByUser.get(userKey);
    if (!set) {
      set = new Set<SseSubscriber>();
      subscribersByUser.set(userKey, set);
    }
    set.add(subscriber);

    res.write(
      `event: connected\ndata: ${JSON.stringify({
        status: 'connected',
        platform,
        activeDevices: set.size,
        serverTimestamp: Date.now(),
      })}\n\n`
    );

    // সংযোগের সাথে সাথে বর্তমান স্টেট পাঠিয়ে দেওয়া হয় যাতে নতুন ওপেন হওয়া অ্যাপ সঙ্গে সঙ্গে সিঙ্ক হয়
    try {
      const record = await loadUserRecord(userKey);
      for (const envItem of Object.values(record.domains)) {
        if (envItem) {
          res.write(`event: sync\ndata: ${JSON.stringify(envItem)}\n\n`);
        }
      }
    } catch {
      // Non-fatal initial snapshot error
    }

    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 25_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      const activeSet = subscribersByUser.get(userKey);
      if (activeSet) {
        activeSet.delete(subscriber);
        if (activeSet.size === 0) {
          subscribersByUser.delete(userKey);
        }
      }
    });
  });

  return {
    async publishPreferencesChange(
      userKey,
      preferences,
      sourceDeviceId = 'preferences-api',
      sourcePlatform = 'web'
    ) {
      const record = await loadUserRecord(userKey);
      const now = Date.now();
      record.preferences = { ...record.preferences, ...preferences };
      const envelope: ServerSyncEnvelope = {
        v: 1,
        protocolVersion: '1.0.0',
        domain: 'preferences',
        deviceId: sourceDeviceId,
        platform: sourcePlatform,
        updatedAt: now,
        revision: 1,
        payload: record.preferences,
      };
      record.domains.preferences = envelope;
      record.updatedAt = now;
      await persistUserRecord(record);
      broadcastToSubscribers(userKey, envelope, sourceDeviceId);
    },
    async getMergedPreferences(userKey) {
      const record = await loadUserRecord(userKey);
      return Object.keys(record.preferences).length > 0 ? record.preferences : null;
    },
    async saveMergedPreferences(userKey, preferences) {
      const record = await loadUserRecord(userKey);
      record.preferences = { ...record.preferences, ...preferences };
      record.updatedAt = Date.now();
      await persistUserRecord(record);
    },
  };
}
