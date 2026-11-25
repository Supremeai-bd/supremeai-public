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
  return (fromEnv || DEFAULT_GATEWAY_URL).replace(/\/+$/, '');
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

export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials !== 'undefined'
  );
}

export async function registerPasskey(
  email: string,
  displayName: string,
  deviceName = 'Personal Biometric Device'
): Promise<{ ok: boolean; device?: PasskeyDevice; error?: string }> {
  if (!isPasskeySupported()) {
    return { ok: false, error: 'WebAuthn Passkey is not supported on this browser/device.' };
  }

  try {
    const base = getGatewayUrl();
    const token = getStoredAccessToken();

    // 1. Fetch Registration Options from gateway/service/passkey_auth.py
    const optRes = await fetch(`${base}/api/auth/passkey/register/options`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        email,
        display_name: displayName || email.split('@')[0],
      }),
    });

    if (!optRes.ok) {
      const err = (await optRes.json().catch(() => ({}))) as { detail?: string };
      return { ok: false, error: err.detail || 'Failed to initiate passkey registration.' };
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
    const credential = (await navigator.credentials.create({
      publicKey: options,
    })) as PublicKeyCredential | null;

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

    const verifyRes = await fetch(`${base}/api/auth/passkey/register/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(verifyPayload),
    });

    if (!verifyRes.ok) {
      const err = (await verifyRes.json().catch(() => ({}))) as { detail?: string };
      return { ok: false, error: err.detail || 'Passkey verification failed on server.' };
    }

    const data = (await verifyRes.json()) as { passkey?: PasskeyDevice };
    return { ok: true, device: data.passkey };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Passkey registration error.',
    };
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
    const base = getGatewayUrl();

    // 1. Fetch Login Options — matches LoginOptionsRequest in passkey_auth.py
    const optRes = await fetch(`${base}/api/auth/passkey/login/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    const verifyRes = await fetch(`${base}/api/auth/passkey/login/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

export async function listPasskeyDevices(userId: string): Promise<PasskeyDevice[]> {
  if (!userId) return [];
  try {
    const base = getGatewayUrl();
    const token = getStoredAccessToken();
    const res = await fetch(
      `${base}/api/auth/passkey/devices?user_id=${encodeURIComponent(userId)}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { devices?: PasskeyDevice[] };
    return Array.isArray(data.devices) ? data.devices : [];
  } catch {
    return [];
  }
}

export async function revokePasskeyDevice(
  credentialId: string,
  userId: string
): Promise<boolean> {
  try {
    const base = getGatewayUrl();
    const token = getStoredAccessToken();
    const res = await fetch(
      `${base}/api/auth/passkey/devices/${encodeURIComponent(credentialId)}?user_id=${encodeURIComponent(userId)}`,
      {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}
