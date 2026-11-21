import { DEFAULT_GATEWAY_URL, isDesktopTauri } from '../bridge/desktopBridge';
import type { ChatSession, KnowledgeDoc, PluginItem, RolePersona } from '../types';
import type {
  LiveThemeId,
  MotionSpeed,
  ScrimIntensity,
  SurfaceTone,
  ThemeMode,
} from '../stores/useThemeStore';

export type SyncPlatform = 'web' | 'desktop' | 'android' | 'ios';
export type SyncDomain =
  'chats' | 'theme' | 'roles' | 'projects' | 'knowledge' | 'plugins' | 'voice_avatar';

export interface SyncThemePayload {
  themeMode: ThemeMode;
  liveTheme: LiveThemeId;
  liveMotion: boolean;
  motionSpeed: MotionSpeed;
  surfaceTone: SurfaceTone;
  scrimIntensity: ScrimIntensity;
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
  chats?: { updatedAt: number; items: ChatSession[] };
  theme?: { updatedAt: number; data: SyncThemePayload };
  roles?: { updatedAt: number; items: RolePersona[] };
  projects?: { updatedAt: number; items: unknown[] };
  knowledge?: { updatedAt: number; items: KnowledgeDoc[] };
  plugins?: { updatedAt: number; items: PluginItem[] };
}

const SYNC_CHANNEL_NAME = 'supremeai.realtime.sync.v1';
const SYNC_DEVICE_ID_KEY = 'supremeai.sync.device_id.v1';
const SYNC_ENABLED_KEY = 'supremeai.sync.enabled.v1';
const SYNC_LAST_AT_KEY = 'supremeai.sync.last_at.v1';

let revisionCounter = 0;

export function getSyncPlatform(): SyncPlatform {
  if (isDesktopTauri()) return 'desktop';
  if (typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)) return 'android';
  if (typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent))
    return 'ios';
  return 'web';
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

export function loadLastSyncedAt(): number | null {
  try {
    const raw = localStorage.getItem(SYNC_LAST_AT_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
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
    return localStorage.getItem('supremeai_access_token');
  } catch {
    return null;
  }
}

function getGatewayBaseUrl(): string {
  const fromEnv =
    typeof import.meta !== 'undefined'
      ? (import.meta as { env?: Record<string, string | undefined> }).env
          ?.VITE_SUPREMEAI_GATEWAY_URL
      : undefined;
  return (fromEnv || DEFAULT_GATEWAY_URL).replace(/\/+$/, '');
}

export function mergeSyncedSessions(local: ChatSession[], remote: ChatSession[]): ChatSession[] {
  const map = new Map<string, ChatSession>();
  for (const chat of local) {
    map.set(chat.id, chat);
  }
  for (const chat of remote) {
    const existing = map.get(chat.id);
    if (!existing || chat.updatedAt > existing.updatedAt) {
      map.set(chat.id, chat);
    } else if (
      chat.updatedAt === existing.updatedAt &&
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
 * Cross-device Real-Time Sync client matching packages/contracts/sync-protocol.json
 * and apps/mobile-android/app/src/main/java/com/example/data/RealtimeSyncEngine.kt
 */
export class RealtimeSyncClient {
  private channel: BroadcastChannel | null = null;
  private streamAbort: AbortController | null = null;
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

  start(): void {
    this.disposed = false;
    if (typeof BroadcastChannel !== 'undefined' && !this.channel) {
      this.channel = new BroadcastChannel(SYNC_CHANNEL_NAME);
      this.channel.onmessage = (event: MessageEvent<SyncEnvelope>) => {
        const envelope = event.data;
        if (!envelope || envelope.deviceId === this.deviceId) return;
        this.onEnvelope(envelope);
        const now = Date.now();
        recordLastSyncedAt(now);
        this.onSyncActivity?.(now);
      };
    }

    const token = getAuthToken();
    if (token) {
      void this.pullCloudSnapshot(token);
      void this.connectCloudStream(token);
    }
  }

  stop(): void {
    this.disposed = true;
    this.streamAbort?.abort();
    this.streamAbort = null;
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }

  publish<T>(domain: SyncDomain, payload: T): void {
    const now = Date.now();
    revisionCounter += 1;
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
    try {
      await fetch(`${getGatewayBaseUrl()}/api/v1/sync/state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-SupremeAI-Device': this.deviceId,
          'X-SupremeAI-Platform': this.platform,
        },
        body: JSON.stringify(envelope),
      });
    } catch {
      // Local-first fallback
    }
  }

  private async pullCloudSnapshot(token: string): Promise<boolean> {
    try {
      const res = await fetch(`${getGatewayBaseUrl()}/api/v1/sync/state`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'X-SupremeAI-Device': this.deviceId,
        },
      });
      if (!res.ok) return false;
      const snapshot = (await res.json()) as SyncSnapshot;
      const emit = <T>(domain: SyncDomain, updatedAt: number, payload: T) => {
        this.onEnvelope({
          protocolVersion: '1.0.0',
          deviceId: 'cloud-gateway',
          platform: 'web',
          domain,
          updatedAt,
          revision: 0,
          payload,
        });
      };
      if (snapshot.chats?.items) emit('chats', snapshot.chats.updatedAt, snapshot.chats.items);
      if (snapshot.theme?.data) emit('theme', snapshot.theme.updatedAt, snapshot.theme.data);
      if (snapshot.roles?.items) emit('roles', snapshot.roles.updatedAt, snapshot.roles.items);
      if (snapshot.knowledge?.items)
        emit('knowledge', snapshot.knowledge.updatedAt, snapshot.knowledge.items);
      if (snapshot.plugins?.items)
        emit('plugins', snapshot.plugins.updatedAt, snapshot.plugins.items);
      return true;
    } catch {
      return false;
    }
  }

  private async connectCloudStream(token: string): Promise<void> {
    this.streamAbort?.abort();
    const controller = new AbortController();
    this.streamAbort = controller;

    try {
      const res = await fetch(`${getGatewayBaseUrl()}/api/v1/sync/stream`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
          'X-SupremeAI-Device': this.deviceId,
        },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) return;

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
            const envelope = JSON.parse(line) as SyncEnvelope;
            if (envelope.deviceId && envelope.deviceId !== this.deviceId) {
              this.onEnvelope(envelope);
              const now = Date.now();
              recordLastSyncedAt(now);
              this.onSyncActivity?.(now);
            }
          } catch {
            // Ignore keepalive frames
          }
        }
      }
    } catch {
      // Offline resilient
    }
  }
}
