import { normalizeProxyInputUrl } from '../stores/useWorkspaceStore';
import { parseCookiePairs } from './browserSessionJar';

export const BROWSER_VAULT_STORAGE_KEY = 'supremeai_browser_vault_v1';
export const BROWSER_VAULT_KEY_STORAGE = 'supremeai_browser_vault_key_v1';
export const BROWSER_VAULT_CLOUD_SYNC_KEY = 'supremeai_browser_vault_cloud_sync_v1';
export const BROWSER_SCHEDULES_STORAGE_KEY = 'supremeai_browser_schedules_v1';

export type VaultEntryMode = 'session' | 'credentials';

export interface VaultCookieItem {
  name: string;
  value: string;
  domain: string;
  path?: string;
}

export interface VaultSecretPayload {
  cookieHeader?: string;
  storageState?: {
    cookies: VaultCookieItem[];
    origins?: Array<{ origin: string }>;
  };
  username?: string;
  password?: string;
}

export interface BrowserVaultEntry {
  id: string;
  domain: string;
  mode: VaultEntryMode;
  label: string;
  cookieCount?: number;
  usernameHint?: string;
  encryptedPayload: string;
  iv: string;
  algorithm: 'AES-256-GCM';
  createdAt: string;
  updatedAt: string;
  syncedToBackend?: boolean;
}

export function extractVaultDomain(rawUrlOrDomain: string): string {
  const cleaned = rawUrlOrDomain.trim();
  if (!cleaned) return '';
  if (cleaned.startsWith('/') && !cleaned.startsWith('//')) {
    return typeof window !== 'undefined' && window.location?.hostname
      ? window.location.hostname.toLowerCase()
      : 'localhost';
  }
  try {
    const normalized = cleaned.includes('://') ? cleaned : normalizeProxyInputUrl(cleaned);
    const parsed = new URL(
      normalized.startsWith('/') ? `https://localhost${normalized}` : normalized
    );
    return parsed.hostname.toLowerCase();
  } catch {
    return (
      cleaned
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .split('/')[0] || ''
    );
  }
}

export function maskUsernameHint(username: string): string {
  const clean = username.trim();
  if (!clean) return '***';
  const atIdx = clean.indexOf('@');
  if (atIdx > 1) {
    return `${clean[0]}***${clean.slice(atIdx)}`;
  }
  if (clean.length <= 2) return `${clean[0]}*`;
  return `${clean.slice(0, 2)}***${clean.slice(-1)}`;
}

export function parseSessionInputToCookies(
  rawInput: string,
  domain: string
): { cookieHeader: string; cookies: VaultCookieItem[] } {
  const trimmed = rawInput.trim();
  if (!trimmed) return { cookieHeader: '', cookies: [] };

  // Check if Playwright storageState JSON or JSON array of cookies
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as
        | { cookies?: Array<{ name?: string; value?: string; domain?: string; path?: string }> }
        | Array<{ name?: string; value?: string; domain?: string; path?: string }>;
      const list = Array.isArray(parsed) ? parsed : parsed?.cookies;
      if (Array.isArray(list)) {
        const cookies: VaultCookieItem[] = list
          .filter((c) => c && typeof c.name === 'string' && typeof c.value === 'string')
          .map((c) => ({
            name: String(c.name).trim(),
            value: String(c.value),
            domain: (typeof c.domain === 'string' && c.domain.trim()) || domain,
            path: (typeof c.path === 'string' && c.path.trim()) || '/',
          }));
        const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
        return { cookieHeader, cookies };
      }
    } catch {
      // Fall through to HTTP Cookie header parsing
    }
  }

  // Standard `name=value; name2=value2` cookie string
  const cookies: VaultCookieItem[] = parseCookiePairs(trimmed).map(([name, value]) => ({
    name,
    value,
    domain,
    path: '/',
  }));
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return { cookieHeader, cookies };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getSubtleCrypto(): SubtleCrypto | null {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  return null;
}

async function getOrCreateVaultMasterKey(): Promise<CryptoKey | null> {
  const subtle = getSubtleCrypto();
  if (!subtle) return null;

  let rawKeyB64 = '';
  if (typeof localStorage !== 'undefined') {
    rawKeyB64 = localStorage.getItem(BROWSER_VAULT_KEY_STORAGE) || '';
  }

  if (rawKeyB64) {
    try {
      const rawBytes = base64ToBytes(rawKeyB64);
      const keyBuf = rawBytes.buffer.slice(
        rawBytes.byteOffset,
        rawBytes.byteOffset + rawBytes.byteLength
      ) as ArrayBuffer;
      return await subtle.importKey('raw', keyBuf, { name: 'AES-GCM' }, false, [
        'encrypt',
        'decrypt',
      ]);
    } catch {
      // Regenerate below if corrupted
    }
  }

  const rawKey = new Uint8Array(32);
  globalThis.crypto.getRandomValues(rawKey);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(BROWSER_VAULT_KEY_STORAGE, bytesToBase64(rawKey));
    } catch {
      // Ignore quota errors
    }
  }
  const keyBuf = rawKey.buffer.slice(
    rawKey.byteOffset,
    rawKey.byteOffset + rawKey.byteLength
  ) as ArrayBuffer;
  return await subtle.importKey('raw', keyBuf, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptVaultPayload(
  payload: VaultSecretPayload
): Promise<{ encryptedPayload: string; iv: string }> {
  const json = JSON.stringify(payload);
  const key = await getOrCreateVaultMasterKey();
  const subtle = getSubtleCrypto();
  if (!key || !subtle) {
    throw new Error('WebCrypto AES-256-GCM encryption is unavailable in this environment.');
  }
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const encoded = new TextEncoder().encode(json);
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    encryptedPayload: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptVaultPayload(
  entry: Pick<BrowserVaultEntry, 'encryptedPayload' | 'iv'>
): Promise<VaultSecretPayload> {
  const key = await getOrCreateVaultMasterKey();
  const subtle = getSubtleCrypto();
  if (!key || !subtle) {
    throw new Error('WebCrypto AES-256-GCM decryption is unavailable in this environment.');
  }
  const ivBytes = base64ToBytes(entry.iv);
  const ivBuf = ivBytes.buffer.slice(
    ivBytes.byteOffset,
    ivBytes.byteOffset + ivBytes.byteLength
  ) as ArrayBuffer;
  const cipherBytes = base64ToBytes(entry.encryptedPayload);
  const cipherBuf = cipherBytes.buffer.slice(
    cipherBytes.byteOffset,
    cipherBytes.byteOffset + cipherBytes.byteLength
  ) as ArrayBuffer;
  const decrypted = await subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(ivBuf) },
    key,
    cipherBuf
  );
  return JSON.parse(new TextDecoder().decode(decrypted)) as VaultSecretPayload;
}

export function loadVaultEntries(): BrowserVaultEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(BROWSER_VAULT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is BrowserVaultEntry =>
        Boolean(item) &&
        typeof item.id === 'string' &&
        typeof item.domain === 'string' &&
        (item.mode === 'session' || item.mode === 'credentials') &&
        typeof item.encryptedPayload === 'string' &&
        typeof item.iv === 'string'
    );
  } catch {
    return [];
  }
}

function persistVaultEntries(entries: BrowserVaultEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(BROWSER_VAULT_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore storage quota errors
  }
}

export function getVaultEntriesForUrl(
  entries: BrowserVaultEntry[],
  url: string
): BrowserVaultEntry[] {
  const domain = extractVaultDomain(url);
  if (!domain) return [];
  // Strict domain isolation: exact host equality only
  return entries.filter((entry) => entry.domain === domain);
}

async function syncEncryptedEntryToBackend(entry: BrowserVaultEntry): Promise<boolean> {
  if (typeof fetch === 'undefined') return false;
  try {
    const token =
      typeof localStorage !== 'undefined' ? localStorage.getItem('supremeai_access_token') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch('/api/workspace/browser-vault', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: entry.id,
        domain: entry.domain,
        mode: entry.mode,
        label: entry.label,
        cookieCount: entry.cookieCount,
        usernameHint: entry.usernameHint,
        encryptedPayload: entry.encryptedPayload,
        iv: entry.iv,
        algorithm: entry.algorithm,
        createdAt: entry.createdAt,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function saveSessionSnapshot(params: {
  url: string;
  rawSessionInput: string;
  label?: string;
}): Promise<{ entries: BrowserVaultEntry[]; created: BrowserVaultEntry }> {
  const domain = extractVaultDomain(params.url);
  if (!domain) {
    throw new Error('A valid webpage URL or domain is required to save a session snapshot.');
  }
  const { cookieHeader, cookies } = parseSessionInputToCookies(params.rawSessionInput, domain);
  if (!cookieHeader) {
    throw new Error('Provide captured cookies, a Cookie header, or Playwright storageState JSON.');
  }

  const { encryptedPayload, iv } = await encryptVaultPayload({
    cookieHeader,
    storageState: {
      cookies,
      origins: [{ origin: `https://${domain}` }],
    },
  });

  const now = new Date().toISOString();
  const existing = loadVaultEntries();
  const prevMatch = existing.find((e) => e.domain === domain && e.mode === 'session');
  const entry: BrowserVaultEntry = {
    id: prevMatch?.id || `vault_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    domain,
    mode: 'session',
    label: (params.label || '').trim() || `${domain} Session`,
    cookieCount: cookies.length,
    encryptedPayload,
    iv,
    algorithm: 'AES-256-GCM',
    createdAt: prevMatch?.createdAt || now,
    updatedAt: now,
  };

  entry.syncedToBackend = await syncEncryptedEntryToBackend(entry);
  const next = [entry, ...existing.filter((e) => e.id !== entry.id)];
  persistVaultEntries(next);
  return { entries: next, created: entry };
}

export async function saveDomainCredentials(params: {
  url: string;
  username: string;
  password: string;
  label?: string;
}): Promise<{ entries: BrowserVaultEntry[]; created: BrowserVaultEntry }> {
  const domain = extractVaultDomain(params.url);
  if (!domain) {
    throw new Error('A valid domain is required for isolated credential storage.');
  }
  if (!params.username.trim() || !params.password) {
    throw new Error('Both username/email and password are required.');
  }

  const { encryptedPayload, iv } = await encryptVaultPayload({
    username: params.username.trim(),
    password: params.password,
  });

  const now = new Date().toISOString();
  const existing = loadVaultEntries();
  const prevMatch = existing.find((e) => e.domain === domain && e.mode === 'credentials');
  const entry: BrowserVaultEntry = {
    id: prevMatch?.id || `vault_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    domain,
    mode: 'credentials',
    label: (params.label || '').trim() || `${domain} Login`,
    usernameHint: maskUsernameHint(params.username),
    encryptedPayload,
    iv,
    algorithm: 'AES-256-GCM',
    createdAt: prevMatch?.createdAt || now,
    updatedAt: now,
  };

  entry.syncedToBackend = await syncEncryptedEntryToBackend(entry);
  const next = [entry, ...existing.filter((e) => e.id !== entry.id)];
  persistVaultEntries(next);
  return { entries: next, created: entry };
}

export async function deleteVaultEntry(id: string): Promise<BrowserVaultEntry[]> {
  const next = loadVaultEntries().filter((e) => e.id !== id);
  persistVaultEntries(next);
  if (typeof fetch !== 'undefined') {
    try {
      const token =
        typeof localStorage !== 'undefined' ? localStorage.getItem('supremeai_access_token') : null;
      await fetch(`/api/workspace/browser-vault?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    } catch {
      // Local deletion remains source of truth
    }
  }
  return next;
}

/**
 * Resolves a decrypted Session Snapshot Cookie header ONLY when the target URL's
 * hostname strictly matches the stored vault entry's domain (prevents cross-domain leakage).
 */
export async function resolveDomainSessionCookieHeader(
  targetUrl: string,
  activeVaultId?: string | null
): Promise<string | null> {
  const targetDomain = extractVaultDomain(targetUrl);
  if (!targetDomain) return null;
  const entries = loadVaultEntries();
  const match = activeVaultId
    ? entries.find(
        (e) => e.id === activeVaultId && e.domain === targetDomain && e.mode === 'session'
      )
    : entries.find((e) => e.domain === targetDomain && e.mode === 'session');
  if (!match) return null;
  const decrypted = await decryptVaultPayload(match);
  return decrypted.cookieHeader || null;
}

/**
 * Decrypts saved domain credentials ONLY on explicit user autofill trigger and ONLY when
 * the active browser hostname strictly equals the vault entry domain.
 */
export async function resolveDomainCredentialsForAutofill(
  targetUrl: string,
  entryId?: string | null
): Promise<{ entry: BrowserVaultEntry; username: string; password: string } | null> {
  const targetDomain = extractVaultDomain(targetUrl);
  if (!targetDomain) return null;
  const entries = loadVaultEntries();
  const match = entryId
    ? entries.find((e) => e.id === entryId && e.domain === targetDomain && e.mode === 'credentials')
    : entries.find((e) => e.domain === targetDomain && e.mode === 'credentials');
  if (!match) return null;
  const decrypted = await decryptVaultPayload(match);
  if (!decrypted.username || !decrypted.password) return null;
  return {
    entry: match,
    username: decrypted.username,
    password: decrypted.password,
  };
}

export const BROWSER_NEVER_SAVE_DOMAINS_KEY = 'supremeai_browser_never_save_v1';

export function loadNeverSaveDomains(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(BROWSER_NEVER_SAVE_DOMAINS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

export function isDomainNeverSaved(urlOrDomain: string): boolean {
  const domain = extractVaultDomain(urlOrDomain);
  if (!domain) return false;
  return loadNeverSaveDomains().includes(domain);
}

export function markDomainNeverSave(urlOrDomain: string): string[] {
  const domain = extractVaultDomain(urlOrDomain);
  const current = loadNeverSaveDomains();
  if (!domain || current.includes(domain)) return current;
  const next = [...current, domain];
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(BROWSER_NEVER_SAVE_DOMAINS_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  }
  return next;
}

export function clearDomainNeverSave(urlOrDomain: string): string[] {
  const domain = extractVaultDomain(urlOrDomain);
  const next = loadNeverSaveDomains().filter((d) => d !== domain);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(BROWSER_NEVER_SAVE_DOMAINS_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  }
  return next;
}

/**
 * Checks whether a submitted login form should trigger the Chrome-style "Save password?" prompt.
 */
export async function shouldPromptSaveSubmittedPassword(params: {
  urlOrDomain: string;
  username: string;
  password: string;
}): Promise<'new' | 'update' | 'skip'> {
  const domain = extractVaultDomain(params.urlOrDomain);
  const cleanUser = params.username.trim();
  if (!domain || !cleanUser || !params.password) return 'skip';
  if (isDomainNeverSaved(domain)) return 'skip';

  const existing = loadVaultEntries().filter(
    (e) => e.domain === domain && e.mode === 'credentials'
  );
  if (existing.length === 0) return 'new';

  for (const entry of existing) {
    try {
      const decrypted = await decryptVaultPayload(entry);
      if ((decrypted.username || '').trim() === cleanUser) {
        return decrypted.password === params.password ? 'skip' : 'update';
      }
    } catch {
      // Ignore undecryptable legacy entries
    }
  }
  return 'new';
}

export function loadVaultCloudSyncEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(BROWSER_VAULT_CLOUD_SYNC_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setVaultCloudSyncEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(BROWSER_VAULT_CLOUD_SYNC_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore quota errors
  }
}

function isValidVaultEntryShape(item: unknown): item is BrowserVaultEntry {
  if (!item || typeof item !== 'object') return false;
  const candidate = item as Partial<BrowserVaultEntry>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.trim().length > 0 &&
    typeof candidate.domain === 'string' &&
    candidate.domain.trim().length > 0 &&
    (candidate.mode === 'session' || candidate.mode === 'credentials') &&
    typeof candidate.encryptedPayload === 'string' &&
    candidate.encryptedPayload.length > 0 &&
    typeof candidate.iv === 'string' &&
    candidate.iv.length > 0
  );
}

function mergeVaultEntryLists(
  localEntries: BrowserVaultEntry[],
  incomingEntries: BrowserVaultEntry[]
): { merged: BrowserVaultEntry[]; pulledCount: number } {
  const byId = new Map<string, BrowserVaultEntry>();
  for (const item of localEntries) {
    byId.set(item.id, item);
  }
  let pulledCount = 0;
  for (const remote of incomingEntries) {
    const normalized: BrowserVaultEntry = {
      id: remote.id,
      domain: remote.domain.trim().toLowerCase(),
      mode: remote.mode,
      label: (remote.label || remote.domain).trim(),
      cookieCount: remote.cookieCount,
      usernameHint: remote.usernameHint,
      encryptedPayload: remote.encryptedPayload,
      iv: remote.iv,
      algorithm: 'AES-256-GCM',
      createdAt: remote.createdAt || new Date().toISOString(),
      updatedAt: remote.updatedAt || new Date().toISOString(),
      syncedToBackend: true,
    };
    const existing = byId.get(normalized.id);
    if (!existing) {
      byId.set(normalized.id, normalized);
      pulledCount += 1;
    } else {
      const existingTs = Date.parse(existing.updatedAt || '') || 0;
      const incomingTs = Date.parse(normalized.updatedAt || '') || 0;
      if (incomingTs > existingTs) {
        byId.set(normalized.id, normalized);
        pulledCount += 1;
      } else {
        byId.set(normalized.id, { ...existing, syncedToBackend: existing.syncedToBackend ?? true });
      }
    }
  }
  const merged = Array.from(byId.values()).sort(
    (a, b) => (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0)
  );
  return { merged, pulledCount };
}

/**
 * Exports only AES-256-GCM ciphertext envelopes (never plaintext secrets).
 */
export function exportEncryptedVaultBackup(): string {
  const entries = loadVaultEntries();
  return JSON.stringify(
    {
      version: 1,
      algorithm: 'AES-256-GCM',
      exportedAt: new Date().toISOString(),
      entries,
    },
    null,
    2
  );
}

/**
 * Imports and merges an encrypted backup envelope JSON without discarding newer local entries.
 */
export function importEncryptedVaultBackup(rawJson: string): {
  entries: BrowserVaultEntry[];
  importedCount: number;
} {
  const parsed = JSON.parse(rawJson) as { entries?: unknown[] } | unknown[];
  const rawList = Array.isArray(parsed)
    ? parsed
    : parsed && Array.isArray(parsed.entries)
      ? parsed.entries
      : null;
  if (!rawList) {
    throw new Error('Invalid encrypted vault backup format.');
  }
  const validIncoming = rawList.filter(isValidVaultEntryShape);
  const { merged, pulledCount } = mergeVaultEntryLists(loadVaultEntries(), validIncoming);
  persistVaultEntries(merged);
  return { entries: merged, importedCount: pulledCount };
}

/**
 * Pushes local AES-256-GCM ciphertext envelopes to `/api/workspace/browser-vault` and pulls
 * remote encrypted envelopes (`?includeEncrypted=1`), keeping newest `updatedAt` per entry ID.
 */
export async function syncVaultWithCloud(): Promise<{
  entries: BrowserVaultEntry[];
  pushed: number;
  pulled: number;
  ok: boolean;
}> {
  const localEntries = loadVaultEntries();
  if (typeof fetch === 'undefined') {
    return { entries: localEntries, pushed: 0, pulled: 0, ok: false };
  }

  let pushed = 0;
  const updatedLocal: BrowserVaultEntry[] = [];
  for (const entry of localEntries) {
    const synced = await syncEncryptedEntryToBackend(entry);
    if (synced) pushed += 1;
    updatedLocal.push({ ...entry, syncedToBackend: synced || entry.syncedToBackend });
  }

  try {
    const token =
      typeof localStorage !== 'undefined' ? localStorage.getItem('supremeai_access_token') : null;
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch('/api/workspace/browser-vault?includeEncrypted=1', { headers });
    if (!res.ok) {
      persistVaultEntries(updatedLocal);
      return { entries: updatedLocal, pushed, pulled: 0, ok: false };
    }
    const data = (await res.json()) as { entries?: unknown[] };
    const remoteValid = Array.isArray(data?.entries)
      ? data.entries.filter(isValidVaultEntryShape)
      : [];
    const { merged, pulledCount } = mergeVaultEntryLists(updatedLocal, remoteValid);
    persistVaultEntries(merged);
    return { entries: merged, pushed, pulled: pulledCount, ok: true };
  } catch {
    persistVaultEntries(updatedLocal);
    return { entries: updatedLocal, pushed, pulled: 0, ok: false };
  }
}

export type ScheduleCadence = 'hourly' | 'daily' | 'weekly' | 'custom';

export interface BrowserScheduledTask {
  id: string;
  title: string;
  domain: string;
  targetUrl: string;
  vaultEntryId: string;
  vaultMode: VaultEntryMode;
  cadence: ScheduleCadence;
  cronExpression: string;
  instruction: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: 'idle' | 'ok' | 'error';
  lastRunSummary?: string;
  lastRunAiReport?: string;
  createdAt: string;
  updatedAt: string;
}

export function getDefaultCronForCadence(cadence: ScheduleCadence): string {
  switch (cadence) {
    case 'hourly':
      return '0 * * * *';
    case 'weekly':
      return '0 9 * * 1';
    case 'custom':
      return '0 0 * * *';
    case 'daily':
    default:
      return '0 8 * * *';
  }
}

export function loadScheduledTasks(): BrowserScheduledTask[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(BROWSER_SCHEDULES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is BrowserScheduledTask =>
        Boolean(item) &&
        typeof item.id === 'string' &&
        typeof item.domain === 'string' &&
        typeof item.vaultEntryId === 'string'
    );
  } catch {
    return [];
  }
}

function persistScheduledTasks(tasks: BrowserScheduledTask[]): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(BROWSER_SCHEDULES_STORAGE_KEY, JSON.stringify(tasks));
    } catch {
      // Ignore storage quota errors
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('supremeai-schedules-updated'));
    } catch {
      // Ignore event errors in non-DOM test envs
    }
  }
}

function scheduledTaskHeaders(): Record<string, string> {
  const token =
    typeof localStorage !== 'undefined' ? localStorage.getItem('supremeai_access_token') : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}`, 'X-SupremeAI-Key': token } : {}),
  };
}

function getAuthenticatedScheduleToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const token = localStorage.getItem('supremeai_access_token');
    if (!token || token.startsWith('tok_guest_') || token.startsWith('sk-supreme-guest')) {
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

function updateLocalScheduledTaskRun(
  id: string,
  status: 'ok' | 'error',
  summary?: string,
  aiReport?: string,
  timestampIso?: string
): BrowserScheduledTask[] {
  const now = timestampIso || new Date().toISOString();
  const next = loadScheduledTasks().map((task) =>
    task.id === id
      ? {
          ...task,
          lastRunAt: now,
          lastRunStatus: status,
          ...(summary ? { lastRunSummary: summary.slice(0, 240) } : {}),
          ...(aiReport ? { lastRunAiReport: aiReport.slice(0, 1400) } : {}),
          updatedAt: now,
        }
      : task
  );
  persistScheduledTasks(next);
  return next;
}

export async function saveScheduledTask(params: {
  title?: string;
  targetUrl: string;
  entry?: BrowserVaultEntry | null;
  cadence: ScheduleCadence;
  cronExpression?: string;
  instruction: string;
}): Promise<{ tasks: BrowserScheduledTask[]; created: BrowserScheduledTask }> {
  const cleanUrl =
    normalizeProxyInputUrl(params.targetUrl) ||
    (params.entry ? `https://${params.entry.domain}` : '');
  const cleanDomain = extractVaultDomain(cleanUrl) || params.entry?.domain || 'web';
  const matchedEntry =
    params.entry ||
    loadVaultEntries().find((e) => e.domain === cleanDomain && e.mode === 'session') ||
    loadVaultEntries().find((e) => e.domain === cleanDomain) ||
    null;

  const now = new Date().toISOString();
  const created: BrowserScheduledTask = {
    id: `sched_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: (params.title || '').trim().slice(0, 80) || `${cleanDomain} (${params.cadence})`,
    domain: cleanDomain,
    targetUrl: cleanUrl || `https://${cleanDomain}`,
    vaultEntryId: matchedEntry?.id || 'public',
    vaultMode: matchedEntry?.mode || 'session',
    cadence: params.cadence,
    cronExpression:
      (params.cronExpression || '').trim() || getDefaultCronForCadence(params.cadence),
    instruction: params.instruction.trim() || 'Extract key summary metrics and report updates.',
    enabled: true,
    lastRunAt: null,
    lastRunStatus: 'idle',
    createdAt: now,
    updatedAt: now,
  };

  const next = [created, ...loadScheduledTasks()];
  persistScheduledTasks(next);

  if (typeof fetch !== 'undefined') {
    try {
      await fetch('/api/workspace/browser-schedules', {
        method: 'POST',
        headers: scheduledTaskHeaders(),
        body: JSON.stringify(created),
      });
    } catch {
      // Local-first offline persistence remains intact
    }
  }

  return { tasks: next, created };
}

export async function toggleScheduledTask(id: string): Promise<BrowserScheduledTask[]> {
  const now = new Date().toISOString();
  let toggledEnabled = true;
  const next = loadScheduledTasks().map((task) => {
    if (task.id !== id) return task;
    toggledEnabled = !task.enabled;
    return { ...task, enabled: toggledEnabled, updatedAt: now };
  });
  persistScheduledTasks(next);

  if (typeof fetch !== 'undefined') {
    try {
      await fetch('/api/workspace/browser-schedules', {
        method: 'PATCH',
        headers: scheduledTaskHeaders(),
        body: JSON.stringify({ id, enabled: toggledEnabled }),
      });
    } catch {
      // Ignore offline backend errors
    }
  }
  return next;
}

export async function markScheduledTaskRun(
  id: string,
  status: 'ok' | 'error',
  summary?: string,
  aiReport?: string
): Promise<BrowserScheduledTask[]> {
  const now = new Date().toISOString();
  const next = updateLocalScheduledTaskRun(id, status, summary, aiReport, now);

  if (typeof fetch !== 'undefined') {
    try {
      await fetch('/api/workspace/browser-schedules', {
        method: 'PATCH',
        headers: scheduledTaskHeaders(),
        body: JSON.stringify({
          id,
          lastRunAt: now,
          lastRunStatus: status,
          ...(summary ? { lastRunSummary: summary.slice(0, 240) } : {}),
          ...(aiReport ? { lastRunAiReport: aiReport.slice(0, 1400) } : {}),
        }),
      });
    } catch {
      // Ignore offline backend errors
    }
  }
  return next;
}

export async function deleteScheduledTask(id: string): Promise<BrowserScheduledTask[]> {
  const next = loadScheduledTasks().filter((task) => task.id !== id);
  persistScheduledTasks(next);

  if (typeof fetch !== 'undefined') {
    try {
      await fetch(`/api/workspace/browser-schedules?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: scheduledTaskHeaders(),
      });
    } catch {
      // Ignore offline backend errors
    }
  }
  return next;
}

export async function executeScheduledTaskOnce(task: BrowserScheduledTask): Promise<{
  ok: boolean;
  summary: string;
  aiReport?: string;
  tasks: BrowserScheduledTask[];
}> {
  try {
    const authToken = getAuthenticatedScheduleToken();
    if (authToken && typeof fetch !== 'undefined') {
      try {
        const runRes = await fetch('/api/workspace/browser-schedules', {
          method: 'POST',
          headers: scheduledTaskHeaders(),
          body: JSON.stringify({
            action: 'run',
            id: task.id,
            targetUrl: task.targetUrl,
          }),
        });
        if (runRes.ok) {
          const runData = (await runRes.json().catch(() => ({}))) as {
            success?: boolean;
            status?: 'ok' | 'error';
            summary?: string;
            aiReport?: string;
            schedule?: {
              lastRunStatus?: 'ok' | 'error';
              lastRunSummary?: string;
              lastRunAiReport?: string;
              lastRunAt?: string | null;
            };
          };
          const ok =
            runData.status === 'ok' ||
            runData.schedule?.lastRunStatus === 'ok' ||
            Boolean(runData.success);
          const summary =
            runData.summary ||
            runData.schedule?.lastRunSummary ||
            (ok ? `Completed · ${task.domain}` : 'Execution failed');
          const aiReport = runData.aiReport || runData.schedule?.lastRunAiReport;
          const tasks = updateLocalScheduledTaskRun(
            task.id,
            ok ? 'ok' : 'error',
            summary,
            aiReport,
            runData.schedule?.lastRunAt || undefined
          );
          return { ok, summary, ...(aiReport ? { aiReport } : {}), tasks };
        }
      } catch {
        // Fall through to browser-proxy fallback cleanly
      }
    }

    const vaultCookie =
      task.vaultMode === 'session' && task.vaultEntryId !== 'public'
        ? await resolveDomainSessionCookieHeader(task.targetUrl, task.vaultEntryId)
        : null;
    const proxyHeaders = scheduledTaskHeaders();
    delete proxyHeaders['Content-Type'];
    if (vaultCookie) {
      proxyHeaders['X-Vault-Cookie'] = vaultCookie;
    }

    const res = await fetch(
      `/api/workspace/browser-proxy?url=${encodeURIComponent(task.targetUrl)}`,
      {
        headers: Object.keys(proxyHeaders).length > 0 ? proxyHeaders : undefined,
      }
    );
    const data = (await res.json().catch(() => ({}))) as {
      statusCode?: number;
      title?: string;
      textPreview?: string;
      error?: string;
    };
    if (res.ok) {
      const summary = `HTTP ${data.statusCode ?? res.status} · ${data.title || task.domain}`;
      const preview = typeof data.textPreview === 'string' ? data.textPreview.trim().slice(0, 600) : undefined;
      const tasks = await markScheduledTaskRun(task.id, 'ok', summary, preview);
      return { ok: true, summary, ...(preview ? { aiReport: preview } : {}), tasks };
    }
    const errText = data.error || `HTTP ${res.status}`;
    const tasks = await markScheduledTaskRun(task.id, 'error', errText);
    return { ok: false, summary: errText, tasks };
  } catch (err: unknown) {
    const errText = err instanceof Error ? err.message : 'Execution failed';
    const tasks = await markScheduledTaskRun(task.id, 'error', errText);
    return { ok: false, summary: errText, tasks };
  }
}

/**
 * Generates an automation/scheduled prompt that contains ZERO raw passwords or cookies
 * (Zero LLM Prompt Leakage invariant). Only opaque vault reference metadata is included.
 */
export function buildScheduledAutomationPrompt(params: {
  url: string;
  scheduleInstruction: string;
  entry?: BrowserVaultEntry | null;
}): string {
  const fallbackDomain = params.entry?.domain || extractVaultDomain(params.url) || 'web';
  const cleanUrl = normalizeProxyInputUrl(params.url) || `https://${fallbackDomain}`;
  const cleanTask =
    params.scheduleInstruction.trim() || 'Extract key summary metrics and report updates.';
  if (!params.entry) {
    return [`[SCHEDULED_BROWSER_AUTOMATION]`, `Target URL: ${cleanUrl}`, `Task: ${cleanTask}`].join(
      '\n'
    );
  }
  return [
    `[SCHEDULED_BROWSER_AUTOMATION]`,
    `Target URL: ${cleanUrl}`,
    `Vault Reference: [VAULT_SESSION_REF id="${params.entry.id}" domain="${params.entry.domain}" mode="${params.entry.mode}"]`,
    `Note: Do NOT request or echo credentials. Use the server-side Web Vault binding for "${params.entry.domain}".`,
    `Task: ${cleanTask}`,
  ].join('\n');
}

export interface ParsedScheduleIntent {
  title: string;
  targetUrl: string;
  domain: string;
  cadence: ScheduleCadence;
  cronExpression: string;
  instruction: string;
}

const SCHEDULE_INTENT_REGEX =
  /\b(schedule|cron|every\s+(day|morning|night|evening|hour|week)|daily|hourly|weekly|automate)\b|(প্রতিদিন|রোজ|প্রতি\s*ঘণ্টায়|প্রতি\s*ঘন্টায়|প্রতি\s*সপ্তাহে|সাপ্তাহিক|শিডিউল|রুটিন)/i;

export function hasSchedulingIntent(text: string): boolean {
  return SCHEDULE_INTENT_REGEX.test(text || '');
}

export function extractFirstUrlOrDomain(text: string): string {
  const fullUrlMatch = text.match(/https?:\/\/[^\s"'<>)]+/i);
  if (fullUrlMatch) return fullUrlMatch[0].replace(/[.,;!?]+$/, '');
  const domainMatch = text.match(
    /\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]{2,})+(?:\/[^\s"'<>)]*)?)/i
  );
  if (domainMatch) {
    const candidate = domainMatch[1].replace(/[.,;!?]+$/, '');
    if (!/^(e\.g|i\.e|v\d+\.\d+)$/i.test(candidate)) {
      return `https://${candidate}`;
    }
  }
  return '';
}

function inferCadenceAndCron(text: string): { cadence: ScheduleCadence; cronExpression: string } {
  if (/(\bhourly\b|\bevery\s+hour\b|প্রতি\s*ঘণ্টায়|প্রতি\s*ঘন্টায়)/i.test(text)) {
    return { cadence: 'hourly', cronExpression: '0 * * * *' };
  }
  if (/(\bweekly\b|\bevery\s+week\b|প্রতি\s*সপ্তাহে|সাপ্তাহিক)/i.test(text)) {
    return { cadence: 'weekly', cronExpression: '0 9 * * 1' };
  }
  // Check explicit hour mention like "at 9 AM" or "সকাল ৯টায়"
  const enHour = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (enHour) {
    let h = parseInt(enHour[1], 10) % 12;
    if (enHour[3].toLowerCase() === 'pm') h += 12;
    const m = enHour[2] ? parseInt(enHour[2], 10) % 60 : 0;
    return { cadence: 'daily', cronExpression: `${m} ${h} * * *` };
  }
  const bnHour = text.match(/(\d{1,2}|[০-৯]{1,2})\s*(?:টা|টায়|টায়)/);
  if (bnHour) {
    const normalizedDigits = bnHour[1].replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
    let h = parseInt(normalizedDigits, 10) || 8;
    if (/বিকাল|সন্ধ্যা|রাত/i.test(text) && h < 12) h += 12;
    if (/রাত\s*১২/.test(text)) h = 0;
    return { cadence: 'daily', cronExpression: `0 ${h % 24} * * *` };
  }
  return { cadence: 'daily', cronExpression: '0 8 * * *' };
}

export function parseNaturalLanguageSchedule(
  userText: string,
  fallbackUrl?: string
): ParsedScheduleIntent | null {
  const clean = (userText || '').trim();
  if (!clean || !hasSchedulingIntent(clean)) return null;
  const resolvedUrl = extractFirstUrlOrDomain(clean) || (fallbackUrl || '').trim();
  if (!resolvedUrl) return null;
  const domain = extractVaultDomain(resolvedUrl);
  if (!domain) return null;

  const { cadence, cronExpression } = inferCadenceAndCron(clean);
  return {
    title: `${domain} (${cadence})`,
    targetUrl: normalizeProxyInputUrl(resolvedUrl) || `https://${domain}`,
    domain,
    cadence,
    cronExpression,
    instruction: clean.slice(0, 320),
  };
}

export function parseAiScheduleBlocks(aiText: string): ParsedScheduleIntent[] {
  if (!aiText) return [];
  const results: ParsedScheduleIntent[] = [];
  const blockRegex = /```supreme-schedule\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(aiText)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim()) as {
        title?: string;
        url?: string;
        targetUrl?: string;
        cadence?: string;
        cron?: string;
        cronExpression?: string;
        instruction?: string;
      };
      const rawUrl = (parsed.url || parsed.targetUrl || '').trim();
      if (!rawUrl) continue;
      const targetUrl = normalizeProxyInputUrl(rawUrl);
      const domain = extractVaultDomain(targetUrl);
      if (!domain) continue;
      const rawCadence = (parsed.cadence || 'daily').toLowerCase();
      const cadence: ScheduleCadence =
        rawCadence === 'hourly' || rawCadence === 'weekly' || rawCadence === 'custom'
          ? rawCadence
          : 'daily';
      const cronExpression =
        (parsed.cron || parsed.cronExpression || '').trim() || getDefaultCronForCadence(cadence);
      results.push({
        title: (parsed.title || '').trim().slice(0, 80) || `${domain} (${cadence})`,
        targetUrl,
        domain,
        cadence,
        cronExpression,
        instruction:
          (parsed.instruction || '').trim() || 'Check target website and summarize key updates.',
      });
    } catch {
      // Ignore malformed schedule block
    }
  }
  return results;
}
