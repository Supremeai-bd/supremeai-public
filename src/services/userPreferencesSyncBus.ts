import { env } from '../config/env';
import { getSyncDeviceId, getSyncPlatform } from '../sync/realtimeSync';

let isHydrating = false;
let pendingPatch: Record<string, unknown> = {};
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight: Promise<boolean> | null = null;

function getAuthToken(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const token =
      localStorage.getItem('supremeai_access_token') ||
      localStorage.getItem('supremeai_api_key') ||
      '';
    const clean = token.trim();
    if (!clean || clean.startsWith('tok_guest_') || clean.startsWith('sk-supreme-guest')) {
      return null;
    }
    return clean;
  } catch {
    return null;
  }
}

export function isPreferencesHydrating(): boolean {
  return isHydrating;
}

export function setPreferencesHydrating(value: boolean): void {
  isHydrating = value;
}

export function clearPendingPreferences(): void {
  pendingPatch = {};
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

export async function pushPreferencesNow(patch: Record<string, unknown>): Promise<boolean> {
  const token = getAuthToken();
  if (!token || env.isMockEnabled) return false;
  if (!patch || Object.keys(patch).length === 0) return true;

  try {
    const endpoint = `${env.apiBaseUrl}/api/v1/user/preferences`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'X-SupremeAI-Key': token,
        'X-Device-Id': getSyncDeviceId(),
        'X-Sync-Platform': getSyncPlatform(),
      },
      credentials: 'same-origin',
      keepalive: true,
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function flushPendingPreferences(): Promise<boolean> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  const keys = Object.keys(pendingPatch);
  if (keys.length === 0) return true;

  const token = getAuthToken();
  if (!token || env.isMockEnabled) {
    pendingPatch = {};
    return false;
  }

  const batch = pendingPatch;
  pendingPatch = {};

  const exec = pushPreferencesNow(batch);
  flushInFlight = exec;
  try {
    return await exec;
  } finally {
    if (flushInFlight === exec) {
      flushInFlight = null;
    }
  }
}

export function schedulePreferencesPatch(
  patch: Record<string, unknown>,
  delayMs: number = 350
): void {
  if (isHydrating) return;
  const token = getAuthToken();
  if (!token || env.isMockEnabled) return;

  pendingPatch = {
    ...pendingPatch,
    ...patch,
  };

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void flushPendingPreferences();
  }, delayMs);
}

export async function fetchRemotePreferences(): Promise<Record<string, unknown> | null> {
  const token = getAuthToken();
  if (!token || env.isMockEnabled) return null;

  try {
    const endpoint = `${env.apiBaseUrl}/api/v1/user/preferences`;
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'X-SupremeAI-Key': token,
      },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data || typeof data !== 'object') return null;
    if (data.preferences && typeof data.preferences === 'object') {
      return data.preferences as Record<string, unknown>;
    }
    if (
      data.user_preferences?.preferences &&
      typeof data.user_preferences.preferences === 'object'
    ) {
      return data.user_preferences.preferences as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const handleFlushOnHide = () => {
    if (document.visibilityState === 'hidden' && Object.keys(pendingPatch).length > 0) {
      void flushPendingPreferences();
    }
  };
  document.addEventListener('visibilitychange', handleFlushOnHide);
  window.addEventListener('pagehide', () => {
    if (Object.keys(pendingPatch).length > 0) {
      void flushPendingPreferences();
    }
  });
}
