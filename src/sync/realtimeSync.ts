import { DEFAULT_GATEWAY_URL, isDesktopTauri } from '../bridge/desktopBridge';
import { env } from '../config/env';
import type {
  WorkbenchRunSettings,
  ChatSession,
  KnowledgeDoc,
  PluginItem,
  RolePersona,
} from '../types';
import type {
  LiveThemeId,
  MotionSpeed,
  ScrimIntensity,
  SurfaceTone,
  ThemeMode,
} from '../stores/useThemeStore';

/** বাংলা মন্তব্য: সব সারফেস (Web, Desktop, Mobile Android/iOS, এবং VS Code Extension) জুড়ে অভিন্ন লাইভ সিঙ্ক ইঞ্জিন */
export type SyncPlatform = 'web' | 'desktop' | 'android' | 'ios' | 'vsix';
export type SyncDomain =
  | 'chats'
  | 'theme'
  | 'roles'
  | 'models'
  | 'preferences'
  | 'projects'
  | 'knowledge'
  | 'plugins'
  | 'voice_avatar';

export interface SyncThemePayload {
  themeMode: ThemeMode;
  liveTheme: LiveThemeId;
  liveMotion: boolean;
  motionSpeed: MotionSpeed;
  surfaceTone: SurfaceTone;
  scrimIntensity: ScrimIntensity;
}

export interface SyncModelsPayload {
  selectedModelId: string;
  autoModelRouting: boolean;
  defaultModel?: string;
  runSettings?: Partial<WorkbenchRunSettings>;
}

export interface SyncRoleSelectionPayload {
  activeRoleId: string;
  customInstruction: string;
  roles?: RolePersona[];
}

export interface SyncEnvelope<T = unknown> {
  protocolVersion: '1.0.0';
  deviceId: string;
  platform: SyncPlatform;
  domain: SyncDomain;
  updatedAt: number;
  revision: number;
  payload: T;
}

export interface SyncSnapshot {
  envelopes?: SyncEnvelope[];
  preferences?: Record<string, unknown>;
  chats?: { updatedAt: number; items: ChatSession[] };
  theme?: { updatedAt: number; data: SyncThemePayload };
  roles?: { updatedAt: number; items?: RolePersona[]; data?: SyncRoleSelectionPayload };
  models?: { updatedAt: number; data: SyncModelsPayload };
  projects?: { updatedAt: number; items: unknown[] };
  knowledge?: { updatedAt: number; items: KnowledgeDoc[] };
  plugins?: { updatedAt: number; items: PluginItem[] };
}

const SYNC_CHANNEL_NAME = 'supremeai.realtime.sync.v1';
const SYNC_DEVICE_ID_KEY = 'supremeai.sync.device_id.v1';
const SYNC_ENABLED_KEY = 'supremeai.sync.enabled.v1';
const SYNC_LAST_AT_KEY = 'supremeai.sync.last_at.v1';
const RECONNECT_BACKOFF_MS = [1500, 3000, 6000, 15000, 30000];

let revisionCounter = 0;
let activeSyncClientInstance: RealtimeSyncClient | null = null;

export function getActiveRealtimeSyncClient(): RealtimeSyncClient | null {
  return activeSyncClientInstance;
}

export function setActiveRealtimeSyncClient(client: RealtimeSyncClient | null): void {
  activeSyncClientInstance = client;
}

function isVsCodeWebview(): boolean {
  try {
    if (
      typeof window !== 'undefined' &&
      typeof (window as unknown as { acquireVsCodeApi?: unknown }).acquireVsCodeApi === 'function'
    ) {
      return true;
    }
    return typeof navigator !== 'undefined' && /vscode|code-web/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

/**
 * বাংলা মন্তব্য: Android/iOS Tauri অ্যাপেও `isDesktopTauri()` সত্য হতে পারে, তাই আগে মোবাইল ও VSIX ইউজার-এজেন্ট যাচাই করা আবশ্যক।
 */
export function detectSyncPlatform(params?: {
  userAgent?: string;
  isTauriRuntime?: boolean;
  isVsCodeRuntime?: boolean;
}): SyncPlatform {
  const ua =
    params?.userAgent ??
    (typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '');
  const vsix = params?.isVsCodeRuntime ?? isVsCodeWebview();
  if (vsix) return 'vsix';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  const tauri = params?.isTauriRuntime ?? isDesktopTauri();
  if (tauri) return 'desktop';
  return 'web';
}

export function getSyncPlatform(): SyncPlatform {
  return detectSyncPlatform();
}

export function getSyncDeviceId(): string {
  try {
    const existing = localStorage.getItem(SYNC_DEVICE_ID_KEY);
    if (existing) return existing;
    const generated = `dev-${getSyncPlatform()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(SYNC_DEVICE_ID_KEY, generated);
    return generated;
  } catch {
    return `dev-${getSyncPlatform()}-ephemeral`;
  }
}

export function loadSyncEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SYNC_ENABLED_KEY);
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}

export function saveSyncEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SYNC_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage errors
  }
}

export function loadLastSyncedAt(): number {
  try {
    const raw = localStorage.getItem(SYNC_LAST_AT_KEY);
    if (!raw) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function recordLastSyncedAt(ts: number): void {
  try {
    localStorage.setItem(SYNC_LAST_AT_KEY, String(ts));
  } catch {
    // Ignore
  }
}

function getAuthToken(): string | null {
  try {
    const tok =
      localStorage.getItem('supremeai_access_token') ||
      localStorage.getItem('supremeai_api_key') ||
      '';
    const clean = tok.trim();
    if (!clean || clean.startsWith('tok_guest_') || clean.startsWith('sk-supreme-guest')) {
      return null;
    }
    return clean;
  } catch {
    return null;
  }
}

function getSyncBaseCandidates(): string[] {
  const fromMeta =
    typeof import.meta !== 'undefined'
      ? (import.meta as { env?: Record<string, string | undefined> }).env
          ?.VITE_SUPREMEAI_GATEWAY_URL
      : undefined;
  const primary = (fromMeta || env.apiBaseUrl || '').replace(/\/+$/, '');
  const fallback = DEFAULT_GATEWAY_URL.replace(/\/+$/, '');
  return primary === fallback ? [primary] : [primary, fallback];
}

export function mergeSyncedSessions(local: ChatSession[], remote: ChatSession[]): ChatSession[] {
  const map = new Map<string, ChatSession>();
  for (const chat of local) {
    if (chat && chat.id) map.set(chat.id, chat);
  }
  for (const chat of remote) {
    if (!chat || !chat.id) continue;
    const existing = map.get(chat.id);
    if (!existing || chat.updatedAt > existing.updatedAt) {
      map.set(chat.id, chat);
    } else if (
      chat.updatedAt === existing.updatedAt &&
      Array.isArray(chat.messages) &&
      Array.isArray(existing.messages) &&
      chat.messages.length > existing.messages.length
    ) {
      map.set(chat.id, chat);
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 60);
}

/**
 * বাংলা মন্তব্য: রিয়েল-টাইম ৪-প্ল্যাটফর্ম সিঙ্ক ক্লায়েন্ট (BroadcastChannel + SSE + REST snapshot fallback)
 */
export class RealtimeSyncClient {
  private channel: BroadcastChannel | null = null;
  private streamAbort: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private readonly lastAppliedDomainTs = new Map<SyncDomain, number>();
  private readonly deviceId: string;
  private readonly platform: SyncPlatform;
  private readonly onEnvelope: (envelope: SyncEnvelope) => void;
  private readonly onSyncActivity?: (ts: number) => void;
  private disposed = false;

  constructor(options: {
    onEnvelope: (envelope: SyncEnvelope) => void;
    onSyncActivity?: (ts: number) => void;
  }) {
    this.deviceId = getSyncDeviceId();
    this.platform = getSyncPlatform();
    this.onEnvelope = options.onEnvelope;
    this.onSyncActivity = options.onSyncActivity;
  }

  private deliverIncomingEnvelope(envelope: SyncEnvelope): void {
    if (!envelope || !envelope.domain) return;
    if (envelope.deviceId && envelope.deviceId === this.deviceId) return;
    const incomingTs = Number(envelope.updatedAt || 0);
    const prevTs = this.lastAppliedDomainTs.get(envelope.domain) || 0;
    if (incomingTs > 0 && incomingTs < prevTs) {
      return;
    }
    if (incomingTs > 0) {
      this.lastAppliedDomainTs.set(envelope.domain, incomingTs);
    }
    this.onEnvelope(envelope);
    const now = Date.now();
    recordLastSyncedAt(now);
    this.onSyncActivity?.(now);
  }

  start(): void {
    this.disposed = false;

    if (typeof BroadcastChannel !== 'undefined' && !this.channel) {
      this.channel = new BroadcastChannel(SYNC_CHANNEL_NAME);
      this.channel.onmessage = (event: MessageEvent<SyncEnvelope>) => {
        this.deliverIncomingEnvelope(event.data);
      };
    }

    const token = getAuthToken();
    if (token) {
      void this.pullCloudSnapshot(token);
      void this.connectCloudStream(token);
    }

    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => {
        if (this.disposed) return;
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        const activeToken = getAuthToken();
        if (activeToken) {
          void this.pullCloudSnapshot(activeToken);
        }
      }, 15_000);
    }
  }

  stop(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.streamAbort?.abort();
    this.streamAbort = null;
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }

  async syncNow(): Promise<boolean> {
    const token = getAuthToken();
    if (!token) return false;
    return this.pullCloudSnapshot(token);
  }

  publish<T>(domain: SyncDomain, payload: T): void {
    if (!loadSyncEnabled()) return;
    const now = Date.now();
    revisionCounter += 1;
    this.lastAppliedDomainTs.set(domain, now);
    const envelope: SyncEnvelope<T> = {
      protocolVersion: '1.0.0',
      deviceId: this.deviceId,
      platform: this.platform,
      domain,
      updatedAt: now,
      revision: revisionCounter,
      payload,
    };

    try {
      this.channel?.postMessage(envelope);
    } catch {
      // Ignore closed channel
    }

    recordLastSyncedAt(now);
    this.onSyncActivity?.(now);

    const token = getAuthToken();
    if (token) {
      void this.pushCloudEnvelope(token, envelope);
    }
  }

  private async pushCloudEnvelope<T>(token: string, envelope: SyncEnvelope<T>): Promise<void> {
    for (const base of getSyncBaseCandidates()) {
      try {
        const res = await fetch(`${base}/api/v1/sync/state`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'X-SupremeAI-Device': this.deviceId,
            'X-SupremeAI-Platform': this.platform,
          },
          body: JSON.stringify(envelope),
        });
        if (res.ok) return;
      } catch {
        // Try next candidate
      }
    }
  }

  private async pullCloudSnapshot(token: string): Promise<boolean> {
    for (const base of getSyncBaseCandidates()) {
      try {
        const res = await fetch(`${base}/api/v1/sync/state`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            'X-SupremeAI-Device': this.deviceId,
            'X-SupremeAI-Platform': this.platform,
          },
        });
        if (!res.ok) continue;
        const snapshot = (await res.json()) as SyncSnapshot;

        if (Array.isArray(snapshot.envelopes) && snapshot.envelopes.length > 0) {
          for (const envItem of snapshot.envelopes) {
            this.deliverIncomingEnvelope(envItem);
          }
          return true;
        }

        const emit = <T>(domain: SyncDomain, updatedAt: number, payload: T) => {
          this.deliverIncomingEnvelope({
            protocolVersion: '1.0.0',
            deviceId: 'cloud-gateway',
            platform: 'web',
            domain,
            updatedAt: updatedAt || Date.now(),
            revision: 0,
            payload,
          });
        };
        if (snapshot.chats?.items) emit('chats', snapshot.chats.updatedAt, snapshot.chats.items);
        if (snapshot.theme?.data) emit('theme', snapshot.theme.updatedAt, snapshot.theme.data);
        if (snapshot.models?.data) emit('models', snapshot.models.updatedAt, snapshot.models.data);
        if (snapshot.roles?.data || snapshot.roles?.items) {
          emit('roles', snapshot.roles.updatedAt, snapshot.roles.data || snapshot.roles.items);
        }
        if (snapshot.preferences && Object.keys(snapshot.preferences).length > 0) {
          emit('preferences', Date.now(), snapshot.preferences);
        }
        if (snapshot.knowledge?.items) {
          emit('knowledge', snapshot.knowledge.updatedAt, snapshot.knowledge.items);
        }
        if (snapshot.plugins?.items) {
          emit('plugins', snapshot.plugins.updatedAt, snapshot.plugins.items);
        }
        return true;
      } catch {
        // Try next candidate
      }
    }
    return false;
  }

  private scheduleStreamReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    const delay =
      RECONNECT_BACKOFF_MS[Math.min(this.reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed) return;
      const token = getAuthToken();
      if (token) {
        void this.connectCloudStream(token);
      }
    }, delay);
  }

  private async connectCloudStream(token: string): Promise<void> {
    this.streamAbort?.abort();
    const controller = new AbortController();
    this.streamAbort = controller;

    for (const base of getSyncBaseCandidates()) {
      try {
        const res = await fetch(
          `${base}/api/v1/sync/stream?device_id=${encodeURIComponent(this.deviceId)}&platform=${this.platform}`,
          {
            method: 'GET',
            headers: {
              Accept: 'text/event-stream',
              Authorization: `Bearer ${token}`,
              'X-SupremeAI-Device': this.deviceId,
              'X-SupremeAI-Platform': this.platform,
            },
            signal: controller.signal,
          }
        );
        if (!res.ok || !res.body) continue;

        this.reconnectAttempt = 0;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!this.disposed) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            const line = frame
              .split('\n')
              .find((l) => l.startsWith('data:'))
              ?.slice(5)
              .trim();
            if (!line || line === '[DONE]') continue;
            try {
              const parsed = JSON.parse(line) as Partial<SyncEnvelope>;
              if (parsed && parsed.domain && parsed.payload !== undefined) {
                this.deliverIncomingEnvelope(parsed as SyncEnvelope);
              }
            } catch {
              // Ignore keepalive frames
            }
          }
        }
        break;
      } catch {
        if (controller.signal.aborted) return;
      }
    }

    if (!this.disposed) {
      this.scheduleStreamReconnect();
    }
  }
}
