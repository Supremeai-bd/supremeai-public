/**
 * passkeyService.ts — Native WebAuthn (Passkey / Fingerprint / Face ID) client service.
 *
 * বাংলা মন্তব্য: পাসওয়ার্ডহীন বায়োমেট্রিক লগইন, রেজিস্ট্রেশন ও ডিভাইস ম্যানেজমেন্ট সার্ভিস।
 * ব্রাউজারের নেটিভ W3C WebAuthn API ব্যবহার করে সরাসরি backend `gateway/service/passkey_auth.py`-এর
 * সঠিক স্কিমার (`clientDataJSON`, `attestationObject`, `id`, `rawId`, `response`, `access_token`) সাথে যুক্ত।
 */

import { DEFAULT_GATEWAY_URL } from '../bridge/desktopBridge';

export interface PasskeyDevice {
  credential_id: string;
  user_id: string;
  role: string;
  device_name: string;
  created_at?: string;
  last_used_at?: string;
}

function getGatewayUrl(): string {
  const fromEnv =
    typeof import.meta !== 'undefined'
      ? (import.meta as { env?: Record<string, string | undefined> }).env
          ?.VITE_SUPREMEAI_GATEWAY_URL
      : undefined;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  // On browser web (Cloudflare Pages), relative path avoids cross-origin preflight issues:
  if (
    typeof window !== 'undefined' &&
    window.location?.origin &&
    !window.location.origin.includes('localhost') &&
    !window.location.origin.includes('127.0.0.1')
  ) {
    return '';
  }
  return DEFAULT_GATEWAY_URL.replace(/\/+$/, '');
}

async function fetchWithFallback(path: string, init?: RequestInit): Promise<Response> {
  const base = getGatewayUrl();
  const token = getStoredAccessToken();
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type') && (!init?.method || init.method !== 'GET')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const primaryUrl = base ? `${base}${path}` : path;
  try {
    const res = await fetch(primaryUrl, { ...init, headers });
    if (res.ok || (res.status !== 404 && res.status !== 502 && res.status !== 503)) {
      return res;
    }
  } catch (err) {
    if (!DEFAULT_GATEWAY_URL || primaryUrl.startsWith(DEFAULT_GATEWAY_URL)) {
      throw err;
    }
  }

  if (DEFAULT_GATEWAY_URL && !primaryUrl.startsWith(DEFAULT_GATEWAY_URL)) {
    const fallbackUrl = `${DEFAULT_GATEWAY_URL.replace(/\/+$/, '')}${path}`;
    return fetch(fallbackUrl, { ...init, headers });
  }
  return fetch(primaryUrl, { ...init, headers });
}

function getStoredAccessToken(): string {
  if (typeof localStorage === 'undefined') return '';
  return (
    localStorage.getItem('supremeai_access_token') ||
    localStorage.getItem('supremeai_token') ||
    ''
  );
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlToBuffer(base64url: string): ArrayBuffer {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Friendly device label, e.g. "Windows Hello (Chrome)" — `navigator.platform` is deprecated. */
export function describePasskeyDevice(userAgent?: string): string {
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent || '' : '');
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : '';
  const device = /Windows/.test(ua)
    ? 'Windows Hello'
    : /iPhone|iPad/.test(ua)
      ? 'Face ID / Touch ID (iOS)'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'Touch ID (Mac)'
        : /Android/.test(ua)
          ? 'Android biometrics'
          : /Linux/.test(ua)
            ? 'Linux passkey'
            : 'Biometric device';
  return browser ? `${device} (${browser})` : device;
}

const FOCUS_WAIT_MS = 30_000;

function documentHasFocus(): boolean {
  return typeof document === 'undefined' || typeof document.hasFocus !== 'function'
    ? true
    : document.hasFocus();
}

/**
 * Resolves once the page has focus again (or after `timeoutMs`). WebAuthn rejects with
 * "The operation is not allowed at this time because the page does not have focus"
 * when it runs while another window (e.g. the Windows Hello dialog) owns focus.
 */
export function waitForDocumentFocus(timeoutMs = FOCUS_WAIT_MS): Promise<boolean> {
  if (documentHasFocus() || typeof window === 'undefined') return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (focused: boolean) => {
      window.removeEventListener('focus', onFocus);
      clearTimeout(timer);
      resolve(focused);
    };
    const onFocus = () => done(true);
    const timer = setTimeout(() => done(documentHasFocus()), timeoutMs);
    window.addEventListener('focus', onFocus);
  });
}

function isFocusError(err: unknown): boolean {
  return err instanceof Error && err.name === 'NotAllowedError' && /focus/i.test(err.message || '');
}

/** Maps raw WebAuthn DOMExceptions to short, actionable messages. */
export function describePasskeyError(err: unknown): string {
  if (!(err instanceof Error)) return 'Passkey registration error.';
  if (isFocusError(err)) {
    return 'The browser lost focus while the passkey was being saved. Click inside this page and try again.';
  }
  if (err.name === 'NotAllowedError') {
    return 'Passkey setup was cancelled or timed out.';
  }
  if (err.name === 'InvalidStateError') {
    return 'This device already has a passkey for your account.';
  }
  if (err.name === 'SecurityError') {
    return 'Passkeys are not allowed on this site address.';
  }
  return err.message || 'Passkey registration error.';
}

async function readErrorDetail(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { detail?: unknown; error?: unknown };
  const detail = typeof body.detail === 'string' ? body.detail : body.error;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (res.status === 401) return 'Your session expired. Sign in again to manage passkeys.';
  return fallback;
}

export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials !== 'undefined'
  );
}

export type PasskeyRegistrationResult = { ok: boolean; device?: PasskeyDevice; error?: string };

let registrationInFlight: Promise<PasskeyRegistrationResult> | null = null;

/**
 * Registers a passkey for the signed-in account. Single-flight: a second click while
 * a ceremony is open returns the same promise instead of opening a second
 * `navigator.credentials.create()` (which Chrome rejects with a focus error).
 */
export function registerPasskey(
  email: string,
  displayName: string,
  deviceName = describePasskeyDevice()
): Promise<PasskeyRegistrationResult> {
  if (registrationInFlight) return registrationInFlight;
  registrationInFlight = runPasskeyRegistration(email, displayName, deviceName).finally(() => {
    registrationInFlight = null;
  });
  return registrationInFlight;
}

async function createCredential(
  publicKey: PublicKeyCredentialCreationOptions
): Promise<PublicKeyCredential | null> {
  // The options fetch is async: make sure we still own focus before opening the prompt.
  await waitForDocumentFocus();
  try {
    return (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  } catch (err) {
    if (!isFocusError(err)) throw err;
    // Windows Hello can finish while its own dialog owns focus; Chrome then saves the
    // passkey on the device but rejects the promise, so the server never hears about it.
    // Retry once when focus returns — the same user handle overwrites that orphan.
    if (!(await waitForDocumentFocus())) throw err;
    return (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  }
}

async function runPasskeyRegistration(
  email: string,
  displayName: string,
  deviceName: string
): Promise<PasskeyRegistrationResult> {
  if (!isPasskeySupported()) {
    return { ok: false, error: 'WebAuthn Passkey is not supported on this browser/device.' };
  }

  try {
    // 1. Fetch Registration Options from gateway/service/passkey_auth.py
    const optRes = await fetchWithFallback('/api/auth/passkey/register/options', {
      method: 'POST',
      body: JSON.stringify({
        email,
        display_name: displayName || email.split('@')[0],
      }),
    });

    if (!optRes.ok) {
      return {
        ok: false,
        error: await readErrorDetail(optRes, 'Failed to initiate passkey registration.'),
      };
    }

    const options = await optRes.json();
    options.challenge = base64UrlToBuffer(options.challenge);
    options.user.id = base64UrlToBuffer(options.user.id);
    if (Array.isArray(options.excludeCredentials)) {
      options.excludeCredentials = options.excludeCredentials.map((c: { id: string; type: string }) => ({
        ...c,
        id: base64UrlToBuffer(c.id),
      }));
    }

    // 2. Prompt Platform Authenticator (Face ID / Touch ID / Windows Hello)
    const credential = await createCredential(options);

    if (!credential) {
      return { ok: false, error: 'Passkey creation was cancelled.' };
    }

    const rawResponse = credential.response as AuthenticatorAttestationResponse;

    // 3. Verify Registration — matches RegisterVerifyRequest in passkey_auth.py
    const verifyPayload = {
      clientDataJSON: bufferToBase64Url(rawResponse.clientDataJSON),
      attestationObject: bufferToBase64Url(rawResponse.attestationObject),
      device_name: deviceName,
    };

    const verifyRes = await fetchWithFallback('/api/auth/passkey/register/verify', {
      method: 'POST',
      body: JSON.stringify(verifyPayload),
    });

    if (!verifyRes.ok) {
      return {
        ok: false,
        error: await readErrorDetail(verifyRes, 'Passkey verification failed on server.'),
      };
    }

    const data = (await verifyRes.json()) as { passkey?: PasskeyDevice };
    return { ok: true, device: data.passkey };
  } catch (err: unknown) {
    return { ok: false, error: describePasskeyError(err) };
  }
}

export async function loginWithPasskey(
  email?: string
): Promise<{
  ok: boolean;
  token?: string;
  userId?: string;
  role?: 'admin' | 'user';
  deviceName?: string;
  error?: string;
}> {
  if (!isPasskeySupported()) {
    return { ok: false, error: 'Passkey authentication not supported on this browser.' };
  }

  try {
    // 1. Fetch Login Options — matches LoginOptionsRequest in passkey_auth.py
    const optRes = await fetchWithFallback('/api/auth/passkey/login/options', {
      method: 'POST',
      body: JSON.stringify({ email: email || null, role: 'user' }),
    });

    if (!optRes.ok) {
      const err = (await optRes.json().catch(() => ({}))) as { detail?: string };
      return { ok: false, error: err.detail || 'Failed to fetch passkey login options.' };
    }

    const options = await optRes.json();
    options.challenge = base64UrlToBuffer(options.challenge);
    if (Array.isArray(options.allowCredentials)) {
      options.allowCredentials = options.allowCredentials.map((c: { id: string; type: string }) => ({
        ...c,
        id: base64UrlToBuffer(c.id),
      }));
    }

    // 2. Request Biometric Assertion
    const assertion = (await navigator.credentials.get({
      publicKey: options,
    })) as PublicKeyCredential | null;

    if (!assertion) {
      return { ok: false, error: 'Biometric sign-in was cancelled.' };
    }

    const rawResponse = assertion.response as AuthenticatorAssertionResponse;
    const credIdB64 = bufferToBase64Url(assertion.rawId);

    // 3. Verify Assertion — matches LoginVerifyRequest in passkey_auth.py
    const verifyPayload = {
      id: credIdB64,
      rawId: credIdB64,
      response: {
        clientDataJSON: bufferToBase64Url(rawResponse.clientDataJSON),
        authenticatorData: bufferToBase64Url(rawResponse.authenticatorData),
        signature: bufferToBase64Url(rawResponse.signature),
        userHandle: rawResponse.userHandle ? bufferToBase64Url(rawResponse.userHandle) : null,
      },
    };

    const verifyRes = await fetchWithFallback('/api/auth/passkey/login/verify', {
      method: 'POST',
      body: JSON.stringify(verifyPayload),
    });

    if (!verifyRes.ok) {
      const err = (await verifyRes.json().catch(() => ({}))) as { detail?: string };
      return { ok: false, error: err.detail || 'Passkey authentication failed.' };
    }

    const data = (await verifyRes.json()) as {
      access_token?: string;
      user_id?: string;
      role?: string;
      device_name?: string;
    };
    if (!data.access_token) {
      return { ok: false, error: 'Server did not return an access_token.' };
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('supremeai_access_token', data.access_token);
    }
    return {
      ok: true,
      token: data.access_token,
      userId: data.user_id || 'usr_passkey',
      role: data.role === 'admin' ? 'admin' : 'user',
      deviceName: data.device_name || 'Biometric Passkey',
    };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Passkey login error.',
    };
  }
}

/**
 * Lists the signed-in account's passkeys. The gateway derives the owner from the
 * session token; `userId` is only sent for older gateways that still read it.
 */
export async function fetchPasskeyDevices(
  userId: string
): Promise<{ ok: boolean; devices: PasskeyDevice[]; error?: string }> {
  try {
    const query = userId ? `?user_id=${encodeURIComponent(userId)}` : '';
    const res = await fetchWithFallback(`/api/auth/passkey/devices${query}`);
    if (!res.ok) {
      return {
        ok: false,
        devices: [],
        error: await readErrorDetail(res, 'Could not load your passkeys.'),
      };
    }
    const data = (await res.json()) as { devices?: PasskeyDevice[] };
    return { ok: true, devices: Array.isArray(data.devices) ? data.devices : [] };
  } catch {
    return { ok: false, devices: [], error: 'Could not reach the server to load passkeys.' };
  }
}

/** Adds a just-registered device if the server list does not include it yet. */
export function mergePasskeyDevices(
  devices: PasskeyDevice[],
  added?: PasskeyDevice
): PasskeyDevice[] {
  if (!added?.credential_id || devices.some((d) => d.credential_id === added.credential_id)) {
    return devices;
  }
  return [added, ...devices];
}

export async function revokePasskeyDevice(
  credentialId: string,
  userId: string
): Promise<boolean> {
  try {
    const res = await fetchWithFallback(
      `/api/auth/passkey/devices/${encodeURIComponent(credentialId)}?user_id=${encodeURIComponent(userId)}`,
      { method: 'DELETE' }
    );
    return res.ok;
  } catch {
    return false;
  }
}
