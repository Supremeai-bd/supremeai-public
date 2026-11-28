import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { registerSyncRoutes, type ServerSyncPlatform } from './sync';

/**
 * Cross-Device User Preferences Vault — `GET/POST/PUT /api(v1)/user/preferences`
 *
 * WHY THIS FILE EXISTS
 *   The preferences vault (vault path + load/save helpers + in-memory cache +
 *   token extraction + email resolution + 3 route handlers) lived inline in
 *   `server.ts` (~250 lines). It is cohesive (single vault file, single
 *   upstream proxy fallback, single in-memory cache) and has no other consumer.
 *   Moving it keeps the monolith shrinking.
 *
 * CONTRACT WITH server.ts
 *   - `USER_PREFS_VAULT_PATH` / `userPreferencesVault` / `loadUserPrefsVault`
 *     / `saveUserPrefsVault` / `extractBearerOrKeyToken` /
 *     `resolveUserEmailForPreferences` / `handleSaveUserPreferences` are OWNED
 *     here (no other route reads the vault cache).
 *   - `getRequestUserEmail`, `verifyLocalSessionToken`, `usersDb`,
 *     `activeAuthSessions` are injected via ctx (closures over auth state).
 *   - `process.cwd()` is used for vault path (equivalent to server.ts
 *     `__dirname` which equals project root at runtime).
 */

interface UserPreferencesVaultEntry {
  user_id: string;
  preferences: Record<string, unknown>;
  updated_at: string;
}

interface PreferencesUser {
  id: string;
  email: string;
}

export interface PreferencesContext {
  getRequestUserEmail: (req: Request) => string;
  verifyLocalSessionToken: (token: string) => { email?: string } | null;
  get usersDb(): readonly PreferencesUser[];
  activeAuthSessions: Map<string, string>;
  supabaseRestRequest?: (
    pathAndQuery: string,
    method: string,
    body?: unknown,
    prefer?: string
  ) => Promise<unknown>;
}

export function registerPreferencesRoutes(app: Express, ctx: PreferencesContext): void {
  const USER_PREFS_VAULT_PATH = path.join(process.cwd(), '.supremeai-user-preferences.json');

  const loadUserPrefsVault = (): Record<string, UserPreferencesVaultEntry> => {
    try {
      if (fs.existsSync(USER_PREFS_VAULT_PATH)) {
        const raw = fs.readFileSync(USER_PREFS_VAULT_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return parsed as Record<string, UserPreferencesVaultEntry>;
        }
      }
    } catch {
      // Ignore corrupted vault file
    }
    return {};
  };

  const saveUserPrefsVault = (vault: Record<string, UserPreferencesVaultEntry>) => {
    try {
      fs.writeFileSync(USER_PREFS_VAULT_PATH, JSON.stringify(vault, null, 2), { mode: 0o600 });
    } catch {
      // Ignore disk persistence error
    }
  };

  let userPreferencesVault: Record<string, UserPreferencesVaultEntry> = loadUserPrefsVault();

  const extractBearerOrKeyToken = (req: Request): string => {
    const authHeader = String(req.headers.authorization || '').trim();
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    const keyHeader = String(req.headers['x-supremeai-key'] || '').trim();
    return keyHeader;
  };

  const resolveUserEmailForPreferences = async (
    req: Request,
    token: string
  ): Promise<string | null> => {
    if (!token || token.startsWith('tok_guest_') || token.startsWith('sk-supreme-guest')) {
      return null;
    }

    const sessionUserId = ctx.activeAuthSessions.get(token);
    const matchedSessionUser = sessionUserId
      ? ctx.usersDb.find((u) => u.id === sessionUserId)
      : undefined;
    if (matchedSessionUser?.email) {
      return matchedSessionUser.email.toLowerCase();
    }

    const verifiedPayload = ctx.verifyLocalSessionToken(token);
    if (verifiedPayload?.email) {
      return verifiedPayload.email.toLowerCase();
    }

    if (!token.startsWith('tok_') && !token.startsWith('mock_tok_')) {
      const remoteGatewayUrl =
        process.env.SUPREMEAI_BACKEND_URL?.trim() || 'https://supremeai-api-ulw0.onrender.com';
      try {
        const meRes = await fetch(`${remoteGatewayUrl}/api/v1/auth/me`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(4000),
        });
        if (meRes.ok) {
          const meData = (await meRes.json().catch(() => null)) as {
            user?: Record<string, unknown>;
            email?: string;
            [k: string]: unknown;
          } | null;
          const raw =
            meData?.user && typeof meData.user === 'object'
              ? { ...meData, ...meData.user }
              : meData;
          const cleanEmail = String(raw?.email || '')
            .trim()
            .toLowerCase();
          if (cleanEmail) return cleanEmail;
        }
      } catch {
        // Fallback below
      }
    }

    const fallbackEmail = ctx.getRequestUserEmail(req);
    if (fallbackEmail && fallbackEmail !== 'guest') return fallbackEmail;

    // বাংলা মন্তব্য: VS Code বা CLI থেকে সরাসরি API Key (`sk-...`) ব্যবহার করলে কী-এর নিরাপদ হ্যাশ দিয়ে সিঙ্ক আইডেন্টিটি তৈরি হয়
    if (token.startsWith('sk-') && token.length >= 16) {
      const digest = crypto.createHash('sha256').update(token).digest('hex').slice(0, 24);
      return `apikey:${digest}`;
    }

    return null;
  };

  // বাংলা মন্তব্য: রিয়েল-টাইম ক্রস-প্ল্যাটফর্ম সিঙ্ক রুটস (`/api/v1/sync/state`, `/api/v1/sync/stream`) মাউন্ট করা হলো
  const syncHub = registerSyncRoutes(app, {
    extractToken: extractBearerOrKeyToken,
    resolveUserKey: resolveUserEmailForPreferences,
    supabaseRestRequest: ctx.supabaseRestRequest,
  });

  app.get(
    ['/api/v1/user/preferences', '/api/user/preferences'],
    async (req: Request, res: Response) => {
      const token = extractBearerOrKeyToken(req);
      if (!token || token.startsWith('tok_guest_') || token.startsWith('sk-supreme-guest')) {
        res.status(401).json({ error: 'Authentication required to access account preferences.' });
        return;
      }

      if (!token.startsWith('tok_') && !token.startsWith('mock_tok_')) {
        const remoteGatewayUrl =
          process.env.SUPREMEAI_BACKEND_URL?.trim() || 'https://supremeai-api-ulw0.onrender.com';
        try {
          const upstreamRes = await fetch(`${remoteGatewayUrl}/api/v1/user/preferences`, {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${token}`,
              'X-SupremeAI-Key': token,
            },
            signal: AbortSignal.timeout(5000),
          });
          if (upstreamRes.ok) {
            const data = (await upstreamRes.json().catch(() => null)) as {
              preferences?: Record<string, unknown>;
              user_preferences?: { preferences?: Record<string, unknown> };
              user_id?: string;
              updated_at?: string;
            } | null;
            if (data && typeof data === 'object') {
              const prefs =
                data.preferences && typeof data.preferences === 'object'
                  ? data.preferences
                  : data.user_preferences?.preferences || {};
              const cacheKey = String(data.user_id || '')
                .trim()
                .toLowerCase();
              if (cacheKey) {
                userPreferencesVault[cacheKey] = {
                  user_id: cacheKey,
                  preferences: prefs,
                  updated_at: String(data.updated_at || new Date().toISOString()),
                };
                saveUserPrefsVault(userPreferencesVault);
              }
              res.json(data);
              return;
            }
          }
        } catch {
          // Upstream unavailable; serve cached local vault if authenticated
        }
      }

      const userEmail = await resolveUserEmailForPreferences(req, token);
      if (!userEmail) {
        res.status(401).json({ error: 'Invalid or expired session token.' });
        return;
      }

      userPreferencesVault = loadUserPrefsVault();
      let entry = userPreferencesVault[userEmail];
      if (!entry) {
        const durablePrefs = await syncHub.getMergedPreferences(userEmail);
        if (durablePrefs) {
          entry = {
            user_id: userEmail,
            preferences: durablePrefs,
            updated_at: new Date().toISOString(),
          };
          userPreferencesVault[userEmail] = entry;
          saveUserPrefsVault(userPreferencesVault);
        }
      }
      const resolvedEntry = entry || {
        user_id: userEmail,
        preferences: {},
        updated_at: new Date().toISOString(),
      };
      res.json({
        user_id: resolvedEntry.user_id,
        preferences: resolvedEntry.preferences,
        updated_at: resolvedEntry.updated_at,
      });
    }
  );

  const handleSaveUserPreferences = async (req: Request, res: Response) => {
    const token = extractBearerOrKeyToken(req);
    if (!token || token.startsWith('tok_guest_') || token.startsWith('sk-supreme-guest')) {
      res.status(401).json({ error: 'Authentication required to save account preferences.' });
      return;
    }

    const patchBody =
      req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const sanitizedPatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patchBody)) {
      if (k !== 'action' && k !== 'tool_id' && k !== 'user_id') {
        sanitizedPatch[k] = v;
      }
    }

    if (!token.startsWith('tok_') && !token.startsWith('mock_tok_')) {
      const remoteGatewayUrl =
        process.env.SUPREMEAI_BACKEND_URL?.trim() || 'https://supremeai-api-ulw0.onrender.com';
      try {
        const upstreamRes = await fetch(`${remoteGatewayUrl}/api/v1/user/preferences`, {
          method: req.method === 'PUT' ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            'X-SupremeAI-Key': token,
          },
          body: JSON.stringify(sanitizedPatch),
          signal: AbortSignal.timeout(5000),
        });
        if (upstreamRes.ok) {
          const data = (await upstreamRes.json().catch(() => null)) as {
            user_preferences?: {
              user_id?: string;
              preferences?: Record<string, unknown>;
              updated_at?: string;
            };
            user_id?: string;
            preferences?: Record<string, unknown>;
            updated_at?: string;
          } | null;
          if (data && typeof data === 'object') {
            const up = data.user_preferences || data;
            const cacheKey = String(up?.user_id || '')
              .trim()
              .toLowerCase();
            if (cacheKey && up?.preferences && typeof up.preferences === 'object') {
              userPreferencesVault[cacheKey] = {
                user_id: cacheKey,
                preferences: up.preferences,
                updated_at: String(up.updated_at || new Date().toISOString()),
              };
              saveUserPrefsVault(userPreferencesVault);
              const sourceDevice = String(req.headers['x-device-id'] || 'preferences-api');
              const sourcePlatform = String(
                req.headers['x-sync-platform'] || 'web'
              ) as ServerSyncPlatform;
              void syncHub
                .publishPreferencesChange(cacheKey, up.preferences, sourceDevice, sourcePlatform)
                .catch(() => {});
            }
            res.json(data);
            return;
          }
        }
      } catch {
        // Upstream unavailable; persist locally for fallback
      }
    }

    const userEmail = await resolveUserEmailForPreferences(req, token);
    if (!userEmail) {
      res.status(401).json({ error: 'Invalid or expired session token.' });
      return;
    }

    userPreferencesVault = loadUserPrefsVault();
    const existing = userPreferencesVault[userEmail] || {
      user_id: userEmail,
      preferences: {},
      updated_at: new Date().toISOString(),
    };

    const mergedPreferences: Record<string, unknown> = {
      ...existing.preferences,
      ...sanitizedPatch,
    };
    const updatedEntry: UserPreferencesVaultEntry = {
      user_id: userEmail,
      preferences: mergedPreferences,
      updated_at: new Date().toISOString(),
    };
    userPreferencesVault[userEmail] = updatedEntry;
    saveUserPrefsVault(userPreferencesVault);

    const sourceDevice = String(req.headers['x-device-id'] || 'preferences-api');
    const sourcePlatform = String(
      req.headers['x-sync-platform'] || 'web'
    ) as ServerSyncPlatform;
    await syncHub.publishPreferencesChange(
      userEmail,
      mergedPreferences,
      sourceDevice,
      sourcePlatform
    );

    res.json({
      status: 'ok',
      user_preferences: updatedEntry,
    });
  };

  app.post(['/api/v1/user/preferences', '/api/user/preferences'], handleSaveUserPreferences);
  app.put(['/api/v1/user/preferences', '/api/user/preferences'], handleSaveUserPreferences);
}
