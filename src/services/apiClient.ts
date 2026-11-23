import { env } from '../config/env';
import { DEFAULT_BACKEND_ORIGIN } from '../config/platformEndpoints';
import { logger } from '../utils/logger';

export interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
  skipAuth?: boolean;
  /** Internal: prevents a second refresh/retry cycle for the same request. */
  skipRefresh?: boolean;
  /** When true, a 401 error will never emit the global session-expired event. */
  skipSessionExpiry?: boolean;
}

export type RefreshHandler = () => Promise<string | null>;

/** Dispatched on `window` when a 401 could not be recovered by refreshing. */
export const SESSION_EXPIRED_EVENT = 'supremeai:session-expired';

export class ApiError extends Error {
  public status: number;
  public data: unknown;

  constructor(message: string, status: number = 500, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * SupremeAI Centralized API Client
 * Wraps browser fetch with automatic bearer token injection, timeout handling,
 * and unified error extraction.
 */
class ApiClient {
  private refreshHandler: RefreshHandler | null = null;
  private refreshInFlight: Promise<string | null> | null = null;

  /**
   * Registers the session refresher (wired up by `authService`). Kept as an
   * injected handler so the client does not import the auth service and create
   * a circular dependency.
   */
  public registerRefreshHandler(handler: RefreshHandler | null): void {
    this.refreshHandler = handler;
  }

  private isAuthEndpoint(endpoint: string): boolean {
    return /^\/api(?:\/v1)?\/auth\/(?:login|register|signup|guest|logout|refresh|verify-2fa|totp(?:\/[^?]+)?)(?:\?|$)/.test(
      endpoint
    );
  }

  private isAdminEndpoint(endpoint: string): boolean {
    return /^\/api\/(admin|schema-parity|mcp-tower|control-plane)(\/|\?|$)/.test(endpoint);
  }

  private notifySessionExpired(): void {
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      }
    } catch {
      // Not available in non-browser environments.
    }
  }

  /** Single-flight refresh: concurrent 401s share one refresh round-trip. */
  private async refreshOnce(): Promise<string | null> {
    if (!this.refreshHandler) return null;
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refreshHandler()
        .catch(() => null)
        .finally(() => {
          this.refreshInFlight = null;
        });
    }
    return this.refreshInFlight;
  }

  private getAuthToken(): string | null {
    try {
      const directToken = localStorage.getItem('supremeai_access_token');
      if (directToken) return directToken;

      const userRaw = localStorage.getItem('supremeai_auth_user');
      if (userRaw) {
        const user = JSON.parse(userRaw);
        return user.token || null;
      }
    } catch (error) {
      logger.debug('apiClient: suppressed non-fatal error', error);
    }
    return null;
  }

  private getAdminToken(): string | null {
    try {
      return typeof sessionStorage !== 'undefined'
        ? sessionStorage.getItem('supremeai_admin_token')
        : null;
    } catch {
      return null;
    }
  }

  public async request<T = unknown>(endpoint: string, options: ApiRequestOptions = {}): Promise<T> {
    const { timeoutMs = 15000, skipAuth = false, headers = {}, ...rest } = options;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const mergedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(headers as Record<string, string>),
    };

    if (!skipAuth) {
      const token = this.getAuthToken();
      if (token) {
        mergedHeaders['Authorization'] = `Bearer ${token}`;
      }
      const adminToken = this.getAdminToken();
      if (adminToken) {
        mergedHeaders['X-Admin-Token'] = adminToken;
      }
    }

    const url = endpoint.startsWith('http') ? endpoint : `${env.apiBaseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        credentials: options.credentials || 'same-origin',
        ...rest,
        headers: mergedHeaders,
        signal: options.signal || controller.signal,
      });

      clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      let data: unknown = null;
      if (isJson) {
        try {
          data = await response.json();
        } catch {
          data = null;
        }
      } else {
        data = await response.text();
      }

      if (
        response.status === 401 &&
        !skipAuth &&
        !options.skipRefresh &&
        !this.isAuthEndpoint(endpoint)
      ) {
        // Admin endpoints require secondary passkey elevation (X-Admin-Token), NOT regular user login.
        // Failing an admin elevation check must never terminate the user's primary login session.
        if (this.isAdminEndpoint(endpoint) || options.skipSessionExpiry) {
          const body = (typeof data === 'object' && data !== null ? data : {}) as Record<
            string,
            unknown
          >;
          const errorMessage =
            (isJson && (body.detail || body.error || body.message)) ||
            (typeof data === 'string' && data.trim()) ||
            `HTTP Error ${response.status}: ${response.statusText}`;
          const message = typeof errorMessage === 'string' ? errorMessage : String(errorMessage);
          throw new ApiError(message, response.status, data);
        }

        const refreshedToken = await this.refreshOnce();
        if (refreshedToken) {
          const retryHeaders: Record<string, string> = {
            ...mergedHeaders,
            Authorization: `Bearer ${refreshedToken}`,
          };
          try {
            return await this.request<T>(endpoint, {
              ...options,
              headers: retryHeaders,
              // The refreshed token is already in `retryHeaders`; skipping auth
              // stops the stored (stale) token from overwriting it.
              skipAuth: true,
              skipRefresh: true,
            });
          } catch (retryError) {
            // A fresh token that is still rejected means the session is gone.
            if (
              retryError instanceof ApiError &&
              retryError.status === 401 &&
              !this.isAdminEndpoint(endpoint) &&
              !options.skipSessionExpiry &&
              this.getAuthToken()
            ) {
              this.notifySessionExpired();
            }
            throw retryError;
          }
        }
        if (!this.isAdminEndpoint(endpoint) && !options.skipSessionExpiry && this.getAuthToken()) {
          this.notifySessionExpired();
        }
      }

      if (!response.ok) {
        // Detect Cloudflare WAF JS challenge interception or security blockage (403/429 HTML or CF_EDGE_CHALLENGE)
        const rawText = typeof data === 'string' ? data : '';
        const bodyObj = (typeof data === 'object' && data !== null ? data : {}) as Record<
          string,
          unknown
        >;
        const cfMitigated = response.headers.get('cf-mitigated') || '';
        const edgeChallengeHeader = response.headers.get('x-supremeai-edge-challenge') || '';
        const rawLower = rawText.toLowerCase();
        const detailLower = String(bodyObj.detail || bodyObj.error || bodyObj.message || '').toLowerCase();
        const isCloudflareChallenge =
          cfMitigated === 'challenge' ||
          edgeChallengeHeader === '1' ||
          bodyObj.code === 'CF_EDGE_CHALLENGE' ||
          bodyObj.error_code === 'security_challenge' ||
          rawText.includes('challenge-platform') ||
          rawText.includes('Just a moment...') ||
          rawText.includes('cf_chl_opt') ||
          rawLower.includes('cloudflare security challenge') ||
          rawLower.includes('security challenge triggered') ||
          rawLower.includes('whitelist your network') ||
          detailLower.includes('cloudflare security challenge') ||
          detailLower.includes('security challenge triggered') ||
          detailLower.includes('whitelist your network') ||
          (!isJson &&
            (response.status === 403 || response.status === 429) &&
            rawLower.includes('cloudflare'));

        // বাংলা মন্তব্য: Cloudflare Pages -> Render প্রক্সিতে Bot Fight চ্যালেঞ্জ (403/429/401/400) বা হাইবারনেশন 502/503 হলে ব্রাউজার থেকে সরাসরি Render CORS এন্ডপয়েন্টে স্বয়ংক্রিয় ফেইলওভার করা হচ্ছে
        const canFallbackDirect =
          !endpoint.startsWith('http') &&
          !env.apiBaseUrl &&
          typeof window !== 'undefined' &&
          window.location?.origin !== DEFAULT_BACKEND_ORIGIN &&
          (isCloudflareChallenge || response.status === 502 || response.status === 503);

        if (canFallbackDirect) {
          try {
            const directUrl = `${DEFAULT_BACKEND_ORIGIN}${endpoint}`;
            const directRes = await fetch(directUrl, {
              credentials: 'omit',
              ...rest,
              headers: mergedHeaders,
              signal: options.signal || controller.signal,
            });
            const directCt = directRes.headers.get('content-type') || '';
            const directIsJson = directCt.includes('application/json');
            const directData = directIsJson
              ? await directRes.json().catch(() => null)
              : await directRes.text().catch(() => '');
            if (directRes.ok) {
              return directData as T;
            }
            // যদি সরাসরি কলেও ৪xx ভ্যালিডেশন/অথ এরর (যেমন 401 Invalid email or password) আসে তবে সেটিই রিটার্ন হবে, Cloudflare চ্যালেঞ্জ নয়!
            if (directIsJson && directData && typeof directData === 'object') {
              const dBody = directData as Record<string, unknown>;
              const dMsg =
                dBody.detail ||
                dBody.error ||
                dBody.message ||
                `HTTP Error ${directRes.status}: ${directRes.statusText}`;
              throw new ApiError(String(dMsg), directRes.status, directData);
            }
          } catch (directErr) {
            if (directErr instanceof ApiError) throw directErr;
          }
        }

        if (isCloudflareChallenge) {
          throw new ApiError(
            'Upstream gateway is waking up or temporarily rate-limited. Please retry in a few seconds.',
            response.status,
            data
          );
        }

        const body = (typeof data === 'object' && data !== null ? data : {}) as Record<
          string,
          unknown
        >;
        const errorMessage =
          (isJson && (body.detail || body.error || body.message)) ||
          (typeof data === 'string' && data.trim()) ||
          `HTTP Error ${response.status}: ${response.statusText}`;
        const message = typeof errorMessage === 'string' ? errorMessage : String(errorMessage);
        throw new ApiError(message, response.status, data);
      }

      return data as T;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof ApiError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ApiError(`Request timeout exceeded (${timeoutMs}ms) for ${endpoint}`, 408);
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      const isFetchNetworkError =
        /failed to fetch|networkerror|load failed|err_blocked_by_client|network error|http2/i.test(
          errMsg
        ) ||
        (err instanceof TypeError && /fetch|network/i.test(errMsg));

      if (isFetchNetworkError && endpoint !== '/api/health') {
        let onlineProbeOk = false;
        try {
          const probeCtrl = new AbortController();
          const probeTimer = setTimeout(() => probeCtrl.abort(), 2200);
          const probeRes = await fetch('/api/health', {
            method: 'GET',
            cache: 'no-store',
            signal: probeCtrl.signal,
          });
          clearTimeout(probeTimer);
          onlineProbeOk = probeRes.ok;
        } catch {
          onlineProbeOk = false;
        }

        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          throw new ApiError('Network offline. Check your internet connection and retry.', 0);
        }

        const isCrossOriginCall =
          url.startsWith('http') &&
          typeof window !== 'undefined' &&
          !url.startsWith(window.location.origin);

        if (!onlineProbeOk || isCrossOriginCall || /err_blocked_by_client/i.test(errMsg)) {
          throw new ApiError(
            'Network request blocked. If you are using an Ad-blocker or Privacy extension, please pause it for this site.',
            0
          );
        }

        throw new ApiError(
          `Request to ${endpoint} interrupted (${errMsg || 'connection reset'}).`,
          0
        );
      }

      throw new ApiError(err instanceof Error ? err.message : 'Network request failed', 500);
    }
  }

  public get<T = unknown>(endpoint: string, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  public post<T = unknown>(
    endpoint: string,
    body?: unknown,
    options?: ApiRequestOptions
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  public put<T = unknown>(
    endpoint: string,
    body?: unknown,
    options?: ApiRequestOptions
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  public patch<T = unknown>(
    endpoint: string,
    body?: unknown,
    options?: ApiRequestOptions
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  public delete<T = unknown>(endpoint: string, options?: ApiRequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
