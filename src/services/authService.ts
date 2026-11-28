import { apiClient, ApiError } from './apiClient';
import { AuthUser } from '../types';
import { env } from '../config/env';
import { DEFAULT_BACKEND_ORIGIN } from '../config/platformEndpoints';
import { logger } from '../utils/logger';
import { captchaHeaders } from '../utils/turnstile';
import { isAuthorizedAdminEmail } from '../utils/adminIdentity';

export interface LoginResponse {
  success: boolean;
  user: AuthUser;
  token: string;
}

export interface Verify2FAResponse {
  success: boolean;
  verified: boolean;
  authMethod: string;
  trustedBrowser: boolean;
  trustedUntil: number | null;
  deviceId: string | null;
  message: string;
}

const ACCESS_TOKEN_STORAGE_KEY = 'supremeai_access_token';
const REFRESH_TOKEN_STORAGE_KEY = 'supremeai_refresh_token';
const AUTH_USER_STORAGE_KEY = 'supremeai_auth_user';
const GUEST_TOKEN_STORAGE_KEY = 'supremeai_guest_token';
const GUEST_TOKEN_EXP_STORAGE_KEY = 'supremeai_guest_token_exp';
let memoryGuestToken: string | null = null;
let memoryGuestTokenExp = 0;
let inFlightGuestPromise: Promise<string | null> | null = null;

// বাংলা মন্তব্য: হার্ডকোডেড অ্যাডমিন ইমেইল সরানো হয়েছে — SSOT এখন utils/adminIdentity
// (সার্ভারের role/isAdminEligible + ঐচ্ছিক VITE_ADMIN_EMAILS)।
export { isAuthorizedAdminEmail };

const ADMIN_RBAC_ROLES = new Set(['admin', 'super_admin', 'superadmin', 'root_admin', 'owner']);

/** Untyped JSON object from the gateway; every field is narrowed before use. */
type AuthJson = Record<string, unknown>;

/** Token-bearing auth response. Token fields are typed; user fields go through normalizeAuthUser. */
interface AuthTokenPayload extends AuthJson {
  access_token?: string;
  token?: string;
  refresh_token?: string;
  refreshToken?: string;
}

function toLowerList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim().toLowerCase()) : [];
}

export function normalizeAuthUser(
  input: unknown,
  fallbackEmail?: string,
  fallbackName?: string
): AuthUser | null {
  if (!input || typeof input !== 'object') return null;

  const data = input as AuthJson;
  const nestedUser: AuthJson =
    data.user && typeof data.user === 'object' ? (data.user as AuthJson) : {};
  const raw: AuthJson = { ...data, ...nestedUser };

  const email = String(raw.email || data.email || fallbackEmail || '')
    .trim()
    .toLowerCase();
  const rbacCandidate = String(
    raw.rbacRole || raw.rbac_role || raw.userRole || raw.user_role || raw.role || data.role || ''
  )
    .trim()
    .toLowerCase();
  const rolesArray = toLowerList(raw.roles);

  const adminEmailsList = [
    ...toLowerList(data.adminEmails),
    ...toLowerList(data.admin_emails),
    ...toLowerList(raw.adminEmails),
    ...toLowerList(raw.admin_emails),
  ].filter(Boolean);

  const emailMatchedAdminDb =
    Boolean(email && adminEmailsList.includes(email)) ||
    Boolean(raw.adminEmailMatched ?? raw.admin_email_matched ?? data.adminEmailMatched);

  const emailMatchedHardcodedAdmin = isAuthorizedAdminEmail(email);

  const rbacIsAdmin =
    ADMIN_RBAC_ROLES.has(rbacCandidate) || rolesArray.some((r: string) => ADMIN_RBAC_ROLES.has(r));

  const explicitAdminFlag = Boolean(
    raw.isAdminEligible ??
    raw.is_admin_eligible ??
    raw.isAdmin ??
    raw.is_admin ??
    data.isAdminEligible ??
    data.is_admin_eligible ??
    data.is_admin
  );

  const isAdminEligible = Boolean(
    explicitAdminFlag ||
    rbacIsAdmin ||
    emailMatchedAdminDb ||
    emailMatchedHardcodedAdmin ||
    raw.adminUserId ||
    raw.admin_user_id ||
    raw.role === 'admin' ||
    data.role === 'admin' ||
    raw.role === 'super_admin' ||
    data.role === 'super_admin'
  );

  const role: 'admin' | 'user' = isAdminEligible || rbacCandidate === 'admin' || raw.role === 'admin' || data.role === 'admin' ? 'admin' : 'user';
  const normalizedRbacRole: AuthUser['rbacRole'] = isAdminEligible
    ? rbacCandidate === 'super_admin' || rbacCandidate === 'superadmin'
      ? 'super_admin'
      : 'admin'
    : rbacCandidate === 'developer' || raw.isDeveloperEligible
      ? 'developer'
      : 'user';

  const resolvedPlan = raw.plan || raw.tier || (isAdminEligible ? 'Enterprise' : 'Free');
  const plan: AuthUser['plan'] =
    isAdminEligible
      ? 'Enterprise'
      : resolvedPlan === 'Enterprise' || resolvedPlan === 'Free' || resolvedPlan === 'Pro'
        ? resolvedPlan
        : 'Free';

  const resolvedEmail = email || String(raw.email || '').trim();
  const resolvedName =
    String(
      raw.name || fallbackName || (resolvedEmail ? resolvedEmail.split('@')[0] : 'User')
    ).trim() || 'User';

  return {
    id: String(raw.id || raw.user_id || data.user_id || `usr_${Date.now()}`),
    name: resolvedName,
    email: resolvedEmail,
    avatar: raw.avatar ? String(raw.avatar) : resolvedName.charAt(0).toUpperCase(),
    role,
    rbacRole: normalizedRbacRole,
    isAdminEligible,
    isDeveloperEligible:
      isAdminEligible || Boolean(raw.isDeveloperEligible ?? raw.is_developer_eligible),
    adminUserId:
      raw.adminUserId || raw.admin_user_id
        ? String(raw.adminUserId || raw.admin_user_id)
        : isAdminEligible
          ? String(raw.id || raw.user_id || 'admin_rbac')
          : undefined,
    plan,
    createdAt: String(raw.createdAt || raw.created_at || new Date().toISOString().slice(0, 10)),
  };
}

export const authService = {
  async login(
    email: string,
    password: string,
    captchaToken?: string | null
  ): Promise<LoginResponse> {
    if (env.isMockEnabled) {
      const cleanEmail = email.trim().toLowerCase();
      const isAdmin = isAuthorizedAdminEmail(cleanEmail);
      return {
        success: true,
        user: {
          id: `usr_${Date.now()}`,
          name: cleanEmail.split('@')[0] || 'User',
          email: cleanEmail,
          role: isAdmin ? 'admin' : 'user',
          rbacRole: isAdmin ? 'admin' : 'user',
          isAdminEligible: isAdmin,
          isDeveloperEligible: isAdmin || cleanEmail.includes('dev'),
          adminUserId: isAdmin ? 'admin_rbac' : undefined,
          plan: isAdmin ? 'Enterprise' : 'Pro',
          createdAt: new Date().toISOString().slice(0, 10),
        },
        token: `mock_tok_${Date.now()}`,
      };
    }

    const data = await apiClient.post<AuthTokenPayload>(
      '/api/v1/auth/login',
      {
        username: email,
        email,
        password,
      },
      { headers: captchaHeaders(captchaToken) }
    );
    const token = data.access_token || data.token || '';
    const user = normalizeAuthUser(data, email);
    if (!user) {
      throw new Error('Invalid authentication response from server.');
    }

    if (token) {
      authService.persistSession(token, data.refresh_token || data.refreshToken);
    }

    return {
      success: true,
      user,
      token,
    };
  },

  async signup(
    name: string,
    email: string,
    password: string,
    plan: string = 'Pro',
    isDeveloperEligible: boolean = false,
    captchaToken?: string | null
  ): Promise<LoginResponse> {
    if (env.isMockEnabled) {
      const cleanEmail = email.trim().toLowerCase();
      const isAdmin = isAuthorizedAdminEmail(cleanEmail);
      return {
        success: true,
        user: {
          id: `usr_${Date.now()}`,
          name,
          email: cleanEmail,
          role: isAdmin ? 'admin' : 'user',
          rbacRole: isAdmin ? 'admin' : isDeveloperEligible ? 'developer' : 'user',
          isAdminEligible: isAdmin,
          isDeveloperEligible: isAdmin || isDeveloperEligible,
          adminUserId: isAdmin ? 'admin_rbac' : undefined,
          plan: plan === 'Free' || plan === 'Enterprise' ? plan : 'Pro',
          createdAt: new Date().toISOString().slice(0, 10),
        },
        token: `mock_tok_${Date.now()}`,
      };
    }

    const data = await apiClient.post<AuthTokenPayload>(
      '/api/v1/auth/register',
      {
        username: email,
        email,
        password,
        name,
        plan,
        isDeveloperEligible,
        workspaceFocus: isDeveloperEligible ? 'developer' : 'everyday',
      },
      { headers: captchaHeaders(captchaToken) }
    );
    const token = data.access_token || data.token || '';
    const normalized = normalizeAuthUser(data, email, name);
    if (!normalized) {
      throw new Error('Invalid registration response from server.');
    }
    const user: AuthUser = {
      ...normalized,
      isDeveloperEligible: normalized.isDeveloperEligible || isDeveloperEligible,
    };

    if (token) {
      authService.persistSession(token, data.refresh_token || data.refreshToken);
    }

    return {
      success: true,
      user,
      token,
    };
  },

  async getMe(fallbackEmail?: string, fallbackName?: string): Promise<AuthUser | null> {
    try {
      const data = await apiClient.get<AuthJson>('/api/v1/auth/me');
      // বাংলা মন্তব্য: সার্ভার যদি রেসপন্সে email ফিল্ড খালি রাখে, লোকাল স্টোরেজে থাকা পূর্বের ভ্যালিড সেশন থেকে email রিকভার করা হবে
      let effectiveEmail = fallbackEmail;
      let effectiveName = fallbackName;
      if (!effectiveEmail && typeof localStorage !== 'undefined') {
        try {
          const raw = localStorage.getItem(AUTH_USER_STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.email) effectiveEmail = parsed.email;
            if (parsed?.name) effectiveName = parsed.name;
          }
        } catch {
          // ignore parse errors
        }
      }
      return normalizeAuthUser(data, effectiveEmail, effectiveName);
    } catch (err: unknown) {
      // বাংলা মন্তব্য: কেবল 401/403 হলেই সেশন ইনভ্যালিড ধরা হবে; নেটওয়ার্ক টাইমআউট, 429 বা 502/503 হলে থ্রো করা হবে যাতে restoreSession ইউজারকে অটো-লগআউট না করে!
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        return null;
      }
      throw err;
    }
  },

  async logout(): Promise<void> {
    try {
      if (!env.isMockEnabled) {
        await apiClient.post('/api/v1/auth/logout');
      }
    } catch (error) {
      logger.debug('authService: suppressed non-fatal error', error);
    }
    localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    localStorage.removeItem(AUTH_USER_STORAGE_KEY);
    authService.clearGuestToken();
  },

  /** Stores a freshly issued access token (and rotated refresh token). */
  persistSession(accessToken: string, refreshToken?: string | null): void {
    try {
      localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, accessToken);
      if (refreshToken) {
        localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, String(refreshToken));
      }
      const userRaw = localStorage.getItem(AUTH_USER_STORAGE_KEY);
      if (userRaw) {
        const user = JSON.parse(userRaw);
        if (user && typeof user === 'object') {
          user.token = accessToken;
          localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
        }
      }
      authService.clearGuestToken();
    } catch {
      // Storage can be unavailable (private mode); the in-memory token is
      // still used by the current request cycle.
    }
  },

  /**
   * Exchanges the stored refresh token (or the httpOnly session cookie) for a
   * new access token. Returns null when the session cannot be recovered.
   */
  async refreshAccessToken(): Promise<string | null> {
    if (env.isMockEnabled) return null;

    let refreshToken: string | null;
    try {
      refreshToken = localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
    } catch {
      refreshToken = null;
    }

    try {
      const data = await apiClient.post<AuthTokenPayload>(
        '/api/v1/auth/refresh',
        refreshToken ? { refresh_token: refreshToken } : {},
        { skipAuth: true, skipRefresh: true, credentials: 'include', timeoutMs: 10000 }
      );
      const token = data?.access_token || data?.token || '';
      if (!token) return null;
      authService.persistSession(token, data?.refresh_token || data?.refreshToken);
      return token;
    } catch (err: unknown) {
      // বাংলা মন্তব্য: রিফ্রেশ এন্ডপয়েন্ট অনুপস্থিত (404), রেট-লিমিটেড (429) বা সাময়িক অনুপলব্ধ (502/503/504/0) হলে বিদ্যমান অ্যাক্সেস টোকেন রেখে দেওয়া হবে যাতে ব্রাউজার রিফ্রেশে লগআউট না হয়
      const errLike = (err ?? {}) as { status?: unknown; response?: { status?: unknown } };
      const status = errLike.status ?? errLike.response?.status;
      if (status !== 401 && status !== 403) {
        try {
          const existing =
            localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) ||
            localStorage.getItem('supremeai_token');
          if (existing) return existing;
        } catch {
          // ignore storage errors
        }
      }
      return null;
    }
  },

  getCachedGuestToken(): string | null {
    const now = Date.now();
    const safetyWindowMs = 60_000;
    if (memoryGuestToken && memoryGuestTokenExp - safetyWindowMs > now) {
      return memoryGuestToken;
    }
    try {
      if (typeof sessionStorage !== 'undefined') {
        const stored = sessionStorage.getItem(GUEST_TOKEN_STORAGE_KEY);
        const storedExp = Number(sessionStorage.getItem(GUEST_TOKEN_EXP_STORAGE_KEY) || '0');
        if (stored && storedExp - safetyWindowMs > now) {
          memoryGuestToken = stored;
          memoryGuestTokenExp = storedExp;
          return stored;
        }
      }
    } catch {
      // sessionStorage unavailable
    }
    return null;
  },

  getInFlightGuestTokenPromise(): Promise<string | null> | null {
    return inFlightGuestPromise;
  },

  clearGuestToken(): void {
    memoryGuestToken = null;
    memoryGuestTokenExp = 0;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(GUEST_TOKEN_STORAGE_KEY);
        sessionStorage.removeItem(GUEST_TOKEN_EXP_STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
  },

  async ensureGuestToken(forceRefresh: boolean = false): Promise<string | null> {
    if (!forceRefresh) {
      const cached = authService.getCachedGuestToken();
      if (cached) return cached;
      if (inFlightGuestPromise) return inFlightGuestPromise;
    } else {
      authService.clearGuestToken();
    }

    let requestPromise: Promise<string | null> | null = null;
    requestPromise = (async (): Promise<string | null> => {
      try {
        const endpoint = `${env.apiBaseUrl}/api/v1/auth/guest`;
        let response = await fetch(endpoint, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
        });
        // বাংলা মন্তব্য: প্রক্সি রুটে Cloudflare 403/429 বা 502/503 হলে সরাসরি Render গেটওয়ে থেকে গেস্ট টোকেন আনা হবে
        if (
          !response.ok &&
          !env.apiBaseUrl &&
          (response.status === 403 ||
            response.status === 429 ||
            response.status === 502 ||
            response.status === 503)
        ) {
          response = await fetch(`${DEFAULT_BACKEND_ORIGIN}/api/v1/auth/guest`, {
            method: 'POST',
            headers: { Accept: 'application/json' },
            credentials: 'omit',
          });
        }
        if (!response.ok) return null;

        const data = await response.json().catch(() => null);
        const guestToken =
          typeof data?.access_token === 'string' && data.access_token.trim()
            ? data.access_token.trim()
            : typeof data?.token === 'string' && data.token.trim()
              ? data.token.trim()
              : null;

        if (!guestToken) return null;

        const ttlSeconds = Math.max(60, Number(data?.expires_in) || 3600);
        const expiresAt = Date.now() + ttlSeconds * 1000;
        memoryGuestToken = guestToken;
        memoryGuestTokenExp = expiresAt;
        try {
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(GUEST_TOKEN_STORAGE_KEY, guestToken);
            sessionStorage.setItem(GUEST_TOKEN_EXP_STORAGE_KEY, String(expiresAt));
          }
        } catch {
          // ignore storage errors
        }
        return guestToken;
      } catch {
        return null;
      } finally {
        if (inFlightGuestPromise === requestPromise) {
          inFlightGuestPromise = null;
        }
      }
    })();

    inFlightGuestPromise = requestPromise;
    return requestPromise;
  },

  async getTotpStatus(userEmail: string): Promise<{
    enrolled: boolean;
    source: 'env' | 'user_vault' | 'none';
    issuer: string;
    accountName: string;
  }> {
    return apiClient.get(`/api/auth/totp/status?userEmail=${encodeURIComponent(userEmail)}`);
  },

  async setupTotp(payload: { userEmail: string; currentToken?: string }): Promise<{
    success: boolean;
    secret: string;
    otpauthUrl: string;
    qrDataUrl: string;
    issuer: string;
    accountName: string;
  }> {
    return apiClient.post('/api/auth/totp/setup', payload);
  },

  async confirmTotp(payload: {
    userEmail: string;
    token: string;
    trustFor7Days: boolean;
  }): Promise<Verify2FAResponse> {
    return apiClient.post<Verify2FAResponse>('/api/auth/totp/confirm', payload);
  },

  async verify2FA(payload: {
    token: string;
    method: 'totp';
    trustFor7Days: boolean;
    userEmail: string;
  }): Promise<Verify2FAResponse> {
    return apiClient.post<Verify2FAResponse>('/api/auth/verify-2fa', payload);
  },

  async verifyAdminPasskey(
    passkey: string
  ): Promise<{ success: boolean; authenticated: boolean; role: string }> {
    return apiClient.post('/api/admin/auth/verify', { passkey });
  },
};

// Injected into the API client so a 401 triggers exactly one refresh attempt;
// injected rather than imported to keep apiClient → authService acyclic.
apiClient.registerRefreshHandler(() => authService.refreshAccessToken());
