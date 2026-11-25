/**
 * বাংলা মন্তব্য: VS Code Extension (`platform: 'vsix'`)-এর জন্য রিয়েল-টাইম ক্রস-প্ল্যাটফর্ম সিঙ্ক ইঞ্জিন।
 * এটি SSE (`/api/v1/sync/stream`), স্টেট স্ন্যাপশট (`/api/v1/sync/state`), এবং প্রেফারেন্স ভল্ট
 * (`/api/v1/user/preferences`)-এর মাধ্যমে Web, Desktop এবং Mobile অ্যাপের সাথে তাৎক্ষণিক দ্বিমুখী সিঙ্ক নিশ্চিত করে।
 */
import * as crypto from 'node:crypto';
import {
  AppLanguage,
  DEFAULT_MODEL_ID,
  DEFAULT_ROLE_ID,
  DEFAULT_SYNCED_OPTIONS,
  SYSTEM_ROLES,
  ThemeMode,
  ThinkingLevel,
  tierToModel,
} from './models';

export interface SyncedChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  model?: string;
  roleName?: string;
}

export interface SyncedChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  roleId: string;
  isPinned?: boolean;
  messages: SyncedChatMessage[];
}

export interface UnifiedVsixState {
  selectedModelId: string;
  autoModelRouting: boolean;
  activeRoleId: string;
  customInstruction: string;
  language: AppLanguage;
  themeMode: ThemeMode;
  liveTheme: string;
  thinkingLevel: ThinkingLevel;
  temperature: number;
  maxOutputTokens: number;
  enableSearchGrounding: boolean;
  sessions: SyncedChatSession[];
  activeSessionId: string;
  lastSyncedAt: number;
  connectionStatus: 'live' | 'guest' | 'offline';
}

export interface VsCodeSyncEnvelope<T = unknown> {
  protocolVersion: '1.0.0';
  deviceId: string;
  platform: 'web' | 'desktop' | 'android' | 'ios' | 'vsix';
  domain:
    | 'chats'
    | 'theme'
    | 'roles'
    | 'models'
    | 'preferences'
    | 'projects'
    | 'knowledge'
    | 'plugins'
    | 'voice_avatar';
  updatedAt: number;
  revision: number;
  payload: T;
}

export interface VsCodeSyncConfig {
  syncUrl: string;
  gatewayUrl: string;
  apiKey: string;
  syncEnabled: boolean;
  deviceId?: string;
  pollIntervalMs?: number;
}

export function mergeVsCodeSessions(
  local: SyncedChatSession[],
  remote: SyncedChatSession[]
): SyncedChatSession[] {
  const map = new Map<string, SyncedChatSession>();
  for (const s of local) {
    if (s && s.id) map.set(s.id, s);
  }
  for (const s of remote) {
    if (!s || !s.id) continue;
    const prev = map.get(s.id);
    if (!prev || s.updatedAt > prev.updatedAt) {
      map.set(s.id, s);
    } else if (
      s.updatedAt === prev.updatedAt &&
      Array.isArray(s.messages) &&
      Array.isArray(prev.messages) &&
      s.messages.length > prev.messages.length
    ) {
      map.set(s.id, s);
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 60);
}

function createInitialSession(): SyncedChatSession {
  const now = Date.now();
  return {
    id: `session_${now}`,
    title: 'SupremeAI Chat',
    createdAt: now,
    updatedAt: now,
    model: DEFAULT_MODEL_ID,
    roleId: DEFAULT_ROLE_ID,
    messages: [],
  };
}

export class VsCodeSyncEngine {
  public readonly deviceId: string;
  private config: VsCodeSyncConfig;
  private state: UnifiedVsixState;
  private readonly listeners = new Set<(state: UnifiedVsixState, source: 'local' | 'remote') => void>();
  private readonly lastDomainTs = new Map<string, number>();
  private streamAbort: AbortController | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private revision = 0;
  private disposed = false;

  constructor(config: VsCodeSyncConfig, initialState?: Partial<UnifiedVsixState>) {
    this.deviceId =
      config.deviceId || `dev-vsix-${crypto.randomBytes(4).toString('hex')}`;
    this.config = { ...config };
    const defaultSession = createInitialSession();
    this.state = {
      ...DEFAULT_SYNCED_OPTIONS,
      sessions: [defaultSession],
      activeSessionId: defaultSession.id,
      lastSyncedAt: 0,
      connectionStatus: config.apiKey ? 'offline' : 'guest',
      ...initialState,
    };
  }

  public getState(): UnifiedVsixState {
    return {
      ...this.state,
      sessions: this.state.sessions.map((s) => ({ ...s, messages: [...s.messages] })),
    };
  }

  public onDidChangeState(
    listener: (state: UnifiedVsixState, source: 'local' | 'remote') => void
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(source: 'local' | 'remote'): void {
    const snap = this.getState();
    for (const fn of this.listeners) {
      fn(snap, source);
    }
  }

  private getBaseCandidates(): string[] {
    const a = (this.config.syncUrl || '').trim().replace(/\/+$/, '');
    const b = (this.config.gatewayUrl || '').trim().replace(/\/+$/, '');
    const list = [a, b].filter(Boolean);
    return Array.from(new Set(list));
  }

  private getCleanToken(): string | null {
    const tok = (this.config.apiKey || '').trim();
    if (!tok || tok.startsWith('tok_guest_') || tok.startsWith('sk-supreme-guest')) {
      return null;
    }
    return tok;
  }

  public updateConfig(next: Partial<VsCodeSyncConfig>): void {
    const prevKey = this.config.apiKey;
    const prevEnabled = this.config.syncEnabled;
    const prevSyncUrl = this.config.syncUrl;
    this.config = { ...this.config, ...next };
    if (
      this.config.apiKey !== prevKey ||
      this.config.syncEnabled !== prevEnabled ||
      this.config.syncUrl !== prevSyncUrl
    ) {
      this.stopNetwork();
      if (!this.disposed && this.config.syncEnabled) {
        void this.start();
      }
    }
  }

  public async start(): Promise<void> {
    this.disposed = false;
    if (!this.config.syncEnabled) return;
    const token = this.getCleanToken();
    if (!token) {
      this.state.connectionStatus = 'guest';
      this.emit('remote');
      return;
    }

    await this.pullNow();
    void this.connectStream();

    const pollMs = this.config.pollIntervalMs ?? 15_000;
    if (pollMs > 0 && !this.pollTimer) {
      this.pollTimer = setInterval(() => {
        if (!this.disposed && this.config.syncEnabled && this.getCleanToken()) {
          void this.pullNow();
        }
      }, pollMs);
    }
  }

  private stopNetwork(): void {
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
  }

  public dispose(): void {
    this.disposed = true;
    this.stopNetwork();
    this.listeners.clear();
  }

  /**
   * বাংলা মন্তব্য: লোকাল VS Code থেকে মডেল, রোল বা যেকোনো অপশন পরিবর্তন হলে স্টেট আপডেট করে এবং ক্লাউডে পুশ করে।
   */
  public async updateOptions(
    patch: Partial<
      Omit<UnifiedVsixState, 'sessions' | 'activeSessionId' | 'lastSyncedAt' | 'connectionStatus'>
    >,
    pushRemote = true
  ): Promise<void> {
    let modelDomainChanged = false;
    let roleDomainChanged = false;
    let themeDomainChanged = false;
    let prefsChanged = false;

    if (typeof patch.selectedModelId === 'string') {
      const resolved = tierToModel(patch.selectedModelId);
      if (resolved === 'auto') {
        if (!this.state.autoModelRouting) {
          this.state.autoModelRouting = true;
          modelDomainChanged = true;
        }
      } else {
        if (this.state.selectedModelId !== resolved) {
          this.state.selectedModelId = resolved;
          modelDomainChanged = true;
        }
        if (patch.autoModelRouting === undefined && this.state.autoModelRouting) {
          this.state.autoModelRouting = false;
          modelDomainChanged = true;
        }
      }
    }

    if (
      typeof patch.autoModelRouting === 'boolean' &&
      patch.autoModelRouting !== this.state.autoModelRouting
    ) {
      this.state.autoModelRouting = patch.autoModelRouting;
      modelDomainChanged = true;
    }

    if (
      typeof patch.activeRoleId === 'string' &&
      SYSTEM_ROLES.some((r) => r.id === patch.activeRoleId) &&
      patch.activeRoleId !== this.state.activeRoleId
    ) {
      this.state.activeRoleId = patch.activeRoleId;
      roleDomainChanged = true;
    }

    if (
      typeof patch.customInstruction === 'string' &&
      patch.customInstruction !== this.state.customInstruction
    ) {
      this.state.customInstruction = patch.customInstruction;
      roleDomainChanged = true;
    }

    if (
      (patch.language === 'en' || patch.language === 'bn') &&
      patch.language !== this.state.language
    ) {
      this.state.language = patch.language;
      prefsChanged = true;
    }

    if (
      patch.thinkingLevel &&
      ['LOW', 'MEDIUM', 'HIGH', 'XHIGH'].includes(patch.thinkingLevel) &&
      patch.thinkingLevel !== this.state.thinkingLevel
    ) {
      this.state.thinkingLevel = patch.thinkingLevel;
      modelDomainChanged = true;
    }

    if (
      typeof patch.temperature === 'number' &&
      Number.isFinite(patch.temperature) &&
      patch.temperature !== this.state.temperature
    ) {
      this.state.temperature = Math.max(0, Math.min(1.5, patch.temperature));
      modelDomainChanged = true;
    }

    if (
      typeof patch.maxOutputTokens === 'number' &&
      Number.isFinite(patch.maxOutputTokens) &&
      patch.maxOutputTokens !== this.state.maxOutputTokens
    ) {
      this.state.maxOutputTokens = Math.max(256, Math.min(65536, patch.maxOutputTokens));
      modelDomainChanged = true;
    }

    if (
      typeof patch.enableSearchGrounding === 'boolean' &&
      patch.enableSearchGrounding !== this.state.enableSearchGrounding
    ) {
      this.state.enableSearchGrounding = patch.enableSearchGrounding;
      modelDomainChanged = true;
    }

    if (
      patch.themeMode &&
      ['system', 'light', 'dark'].includes(patch.themeMode) &&
      patch.themeMode !== this.state.themeMode
    ) {
      this.state.themeMode = patch.themeMode;
      themeDomainChanged = true;
    }

    if (typeof patch.liveTheme === 'string' && patch.liveTheme !== this.state.liveTheme) {
      this.state.liveTheme = patch.liveTheme;
      themeDomainChanged = true;
    }

    if (!modelDomainChanged && !roleDomainChanged && !themeDomainChanged && !prefsChanged) {
      return;
    }

    this.state.lastSyncedAt = Date.now();
    this.emit('local');

    if (!pushRemote || !this.config.syncEnabled) return;

    const tasks: Promise<void>[] = [];
    if (modelDomainChanged) {
      tasks.push(
        this.publishEnvelope('models', {
          selectedModelId: this.state.selectedModelId,
          autoModelRouting: this.state.autoModelRouting,
          defaultModel: this.state.selectedModelId,
          runSettings: {
            thinkingLevel: this.state.thinkingLevel,
            temperature: this.state.temperature,
            maxOutputTokens: this.state.maxOutputTokens,
            enableSearchGrounding: this.state.enableSearchGrounding,
          },
        })
      );
    }
    if (roleDomainChanged) {
      tasks.push(
        this.publishEnvelope('roles', {
          activeRoleId: this.state.activeRoleId,
          customInstruction: this.state.customInstruction,
        })
      );
    }
    if (themeDomainChanged) {
      tasks.push(
        this.publishEnvelope('theme', {
          themeMode: this.state.themeMode,
          liveTheme: this.state.liveTheme,
        })
      );
    }
    tasks.push(this.pushPreferencesSnapshot());
    await Promise.allSettled(tasks);
  }

  public async recordChatTurn(
    userText: string,
    assistantText: string,
    usedModel: string
  ): Promise<void> {
    const now = Date.now();
    let active = this.state.sessions.find((s) => s.id === this.state.activeSessionId);
    if (!active) {
      active = createInitialSession();
      this.state.sessions.unshift(active);
      this.state.activeSessionId = active.id;
    }
    if (active.messages.length === 0 && active.title === 'SupremeAI Chat') {
      active.title = userText.slice(0, 48);
    }
    active.model = usedModel === 'auto' ? this.state.selectedModelId : usedModel;
    active.roleId = this.state.activeRoleId;
    active.updatedAt = now;
    active.messages.push(
      {
        id: `msg_${now}_u`,
        role: 'user',
        content: userText,
        timestamp: now,
      },
      {
        id: `msg_${now + 1}_a`,
        role: 'assistant',
        content: assistantText,
        timestamp: now + 1,
        model: active.model,
      }
    );
    this.state.lastSyncedAt = now;
    this.emit('local');
    await this.publishEnvelope('chats', this.state.sessions.slice(0, 30));
  }

  public createNewSession(): SyncedChatSession {
    const session = createInitialSession();
    session.model = this.state.selectedModelId;
    session.roleId = this.state.activeRoleId;
    this.state.sessions = [session, ...this.state.sessions].slice(0, 60);
    this.state.activeSessionId = session.id;
    this.emit('local');
    return session;
  }

  public selectSession(sessionId: string): SyncedChatSession | undefined {
    const found = this.state.sessions.find((s) => s.id === sessionId);
    if (found) {
      this.state.activeSessionId = found.id;
      this.emit('local');
    }
    return found;
  }

  public clearActiveSession(): void {
    const active = this.state.sessions.find((s) => s.id === this.state.activeSessionId);
    if (active) {
      active.messages = [];
      active.updatedAt = Date.now();
      this.emit('local');
      void this.publishEnvelope('chats', this.state.sessions.slice(0, 30));
    }
  }

  public applyEnvelope(envelope: Partial<VsCodeSyncEnvelope>): boolean {
    if (!envelope || !envelope.domain || envelope.payload === undefined) return false;
    if (envelope.deviceId && envelope.deviceId === this.deviceId) return false;

    const ts = Number(envelope.updatedAt || 0);
    const prevTs = this.lastDomainTs.get(envelope.domain) || 0;
    if (ts > 0 && ts < prevTs) return false;
    if (ts > 0) this.lastDomainTs.set(envelope.domain, ts);

    let changed = false;

    if (envelope.domain === 'models' && envelope.payload && typeof envelope.payload === 'object') {
      const m = envelope.payload as Record<string, unknown>;
      if (typeof m.selectedModelId === 'string') {
        const resolved = tierToModel(m.selectedModelId);
        if (resolved !== 'auto' && resolved !== this.state.selectedModelId) {
          this.state.selectedModelId = resolved;
          changed = true;
        }
      }
      if (
        typeof m.autoModelRouting === 'boolean' &&
        m.autoModelRouting !== this.state.autoModelRouting
      ) {
        this.state.autoModelRouting = m.autoModelRouting;
        changed = true;
      }
      if (m.runSettings && typeof m.runSettings === 'object') {
        changed = this.applyRunSettingsObject(m.runSettings as Record<string, unknown>) || changed;
      }
    } else if (
      envelope.domain === 'roles' &&
      envelope.payload &&
      typeof envelope.payload === 'object' &&
      !Array.isArray(envelope.payload)
    ) {
      const r = envelope.payload as Record<string, unknown>;
      if (
        typeof r.activeRoleId === 'string' &&
        SYSTEM_ROLES.some((role) => role.id === r.activeRoleId) &&
        r.activeRoleId !== this.state.activeRoleId
      ) {
        this.state.activeRoleId = r.activeRoleId;
        changed = true;
      }
      if (
        typeof r.customInstruction === 'string' &&
        r.customInstruction !== this.state.customInstruction
      ) {
        this.state.customInstruction = r.customInstruction;
        changed = true;
      }
    } else if (
      envelope.domain === 'theme' &&
      envelope.payload &&
      typeof envelope.payload === 'object'
    ) {
      const th = envelope.payload as Record<string, unknown>;
      if (
        typeof th.themeMode === 'string' &&
        ['system', 'light', 'dark'].includes(th.themeMode) &&
        th.themeMode !== this.state.themeMode
      ) {
        this.state.themeMode = th.themeMode as ThemeMode;
        changed = true;
      }
      if (typeof th.liveTheme === 'string' && th.liveTheme !== this.state.liveTheme) {
        this.state.liveTheme = th.liveTheme;
        changed = true;
      }
    } else if (
      envelope.domain === 'preferences' &&
      envelope.payload &&
      typeof envelope.payload === 'object'
    ) {
      changed =
        this.applyPreferencesPayload(envelope.payload as Record<string, unknown>) || changed;
    } else if (envelope.domain === 'chats') {
      const items = Array.isArray(envelope.payload)
        ? (envelope.payload as SyncedChatSession[])
        : Array.isArray((envelope.payload as { items?: unknown[] })?.items)
          ? ((envelope.payload as { items: SyncedChatSession[] }).items)
          : null;
      if (items && items.length > 0) {
        this.state.sessions = mergeVsCodeSessions(this.state.sessions, items);
        if (!this.state.sessions.some((s) => s.id === this.state.activeSessionId)) {
          this.state.activeSessionId = this.state.sessions[0].id;
        }
        changed = true;
      }
    }

    if (changed) {
      this.state.lastSyncedAt = Date.now();
      this.state.connectionStatus = 'live';
      this.emit('remote');
    }
    return changed;
  }

  private applyRunSettingsObject(rs: Record<string, unknown>): boolean {
    let changed = false;
    if (
      typeof rs.thinkingLevel === 'string' &&
      ['LOW', 'MEDIUM', 'HIGH', 'XHIGH'].includes(rs.thinkingLevel) &&
      rs.thinkingLevel !== this.state.thinkingLevel
    ) {
      this.state.thinkingLevel = rs.thinkingLevel as ThinkingLevel;
      changed = true;
    }
    if (
      typeof rs.temperature === 'number' &&
      Number.isFinite(rs.temperature) &&
      rs.temperature !== this.state.temperature
    ) {
      this.state.temperature = rs.temperature;
      changed = true;
    }
    if (
      typeof rs.maxOutputTokens === 'number' &&
      Number.isFinite(rs.maxOutputTokens) &&
      rs.maxOutputTokens !== this.state.maxOutputTokens
    ) {
      this.state.maxOutputTokens = rs.maxOutputTokens;
      changed = true;
    }
    if (
      typeof rs.enableSearchGrounding === 'boolean' &&
      rs.enableSearchGrounding !== this.state.enableSearchGrounding
    ) {
      this.state.enableSearchGrounding = rs.enableSearchGrounding;
      changed = true;
    }
    return changed;
  }

  private applyPreferencesPayload(prefs: Record<string, unknown>): boolean {
    let changed = false;
    const studio = prefs.studio_settings as Record<string, unknown> | undefined;
    if (studio && typeof studio === 'object') {
      if (
        (studio.language === 'en' || studio.language === 'bn') &&
        studio.language !== this.state.language
      ) {
        this.state.language = studio.language;
        changed = true;
      }
      if (
        typeof studio.autoModelRouting === 'boolean' &&
        studio.autoModelRouting !== this.state.autoModelRouting
      ) {
        this.state.autoModelRouting = studio.autoModelRouting;
        changed = true;
      }
      if (typeof studio.defaultModel === 'string') {
        const resolved = tierToModel(studio.defaultModel);
        if (resolved !== 'auto' && resolved !== this.state.selectedModelId) {
          this.state.selectedModelId = resolved;
          changed = true;
        }
      }
    }

    const themeCfg = prefs.theme_config as Record<string, unknown> | undefined;
    if (themeCfg && typeof themeCfg === 'object') {
      if (
        typeof themeCfg.themeMode === 'string' &&
        ['system', 'light', 'dark'].includes(themeCfg.themeMode) &&
        themeCfg.themeMode !== this.state.themeMode
      ) {
        this.state.themeMode = themeCfg.themeMode as ThemeMode;
        changed = true;
      }
      if (
        typeof themeCfg.liveTheme === 'string' &&
        themeCfg.liveTheme !== this.state.liveTheme
      ) {
        this.state.liveTheme = themeCfg.liveTheme;
        changed = true;
      }
    }

    const chatPrefs = prefs.chat_prefs as Record<string, unknown> | undefined;
    if (chatPrefs && typeof chatPrefs === 'object') {
      if (typeof chatPrefs.selectedModelId === 'string') {
        const resolved = tierToModel(chatPrefs.selectedModelId);
        if (resolved !== 'auto' && resolved !== this.state.selectedModelId) {
          this.state.selectedModelId = resolved;
          changed = true;
        }
      }
      if (
        typeof chatPrefs.autoModelRouting === 'boolean' &&
        chatPrefs.autoModelRouting !== this.state.autoModelRouting
      ) {
        this.state.autoModelRouting = chatPrefs.autoModelRouting;
        changed = true;
      }
      if (
        typeof chatPrefs.activeRoleId === 'string' &&
        SYSTEM_ROLES.some((r) => r.id === chatPrefs.activeRoleId) &&
        chatPrefs.activeRoleId !== this.state.activeRoleId
      ) {
        this.state.activeRoleId = chatPrefs.activeRoleId;
        changed = true;
      }
      if (
        typeof chatPrefs.customInstruction === 'string' &&
        chatPrefs.customInstruction !== this.state.customInstruction
      ) {
        this.state.customInstruction = chatPrefs.customInstruction;
        changed = true;
      }
      if (chatPrefs.runSettings && typeof chatPrefs.runSettings === 'object') {
        changed =
          this.applyRunSettingsObject(chatPrefs.runSettings as Record<string, unknown>) ||
          changed;
      }
    }

    return changed;
  }

  public async pullNow(): Promise<boolean> {
    const token = this.getCleanToken();
    if (!token) {
      this.state.connectionStatus = 'guest';
      return false;
    }

    let ok = false;
    for (const base of this.getBaseCandidates()) {
      try {
        const prefRes = await fetch(`${base}/api/v1/user/preferences`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            'X-SupremeAI-Key': token,
            'X-SupremeAI-Device': this.deviceId,
            'X-SupremeAI-Platform': 'vsix',
          },
          signal: AbortSignal.timeout(4500),
        });
        if (prefRes.ok) {
          const data = (await prefRes.json().catch(() => null)) as {
            preferences?: Record<string, unknown>;
            user_preferences?: { preferences?: Record<string, unknown> };
          } | null;
          const prefs = data?.preferences || data?.user_preferences?.preferences;
          if (prefs && typeof prefs === 'object') {
            if (this.applyPreferencesPayload(prefs)) {
              this.emit('remote');
            }
            ok = true;
          }
        }
      } catch {
        // Try sync/state next
      }

      try {
        const syncRes = await fetch(`${base}/api/v1/sync/state`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            'X-SupremeAI-Key': token,
            'X-SupremeAI-Device': this.deviceId,
            'X-SupremeAI-Platform': 'vsix',
          },
          signal: AbortSignal.timeout(4500),
        });
        if (syncRes.ok) {
          const snap = (await syncRes.json().catch(() => null)) as {
            envelopes?: VsCodeSyncEnvelope[];
            preferences?: Record<string, unknown>;
          } | null;
          if (snap?.preferences && typeof snap.preferences === 'object') {
            if (this.applyPreferencesPayload(snap.preferences)) {
              this.emit('remote');
            }
          }
          if (Array.isArray(snap?.envelopes)) {
            for (const envItem of snap.envelopes) {
              this.applyEnvelope(envItem);
            }
          }
          ok = true;
          break;
        }
      } catch {
        // Try next base candidate
      }
    }

    this.state.connectionStatus = ok ? 'live' : 'offline';
    if (ok) {
      this.state.lastSyncedAt = Date.now();
      this.emit('remote');
    }
    return ok;
  }

  private async publishEnvelope<T>(
    domain: VsCodeSyncEnvelope['domain'],
    payload: T
  ): Promise<void> {
    const token = this.getCleanToken();
    if (!token || !this.config.syncEnabled) return;

    const now = Date.now();
    this.revision += 1;
    this.lastDomainTs.set(domain, now);
    const envelope: VsCodeSyncEnvelope<T> = {
      protocolVersion: '1.0.0',
      deviceId: this.deviceId,
      platform: 'vsix',
      domain,
      updatedAt: now,
      revision: this.revision,
      payload,
    };

    for (const base of this.getBaseCandidates()) {
      try {
        const res = await fetch(`${base}/api/v1/sync/state`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'X-SupremeAI-Key': token,
            'X-SupremeAI-Device': this.deviceId,
            'X-SupremeAI-Platform': 'vsix',
          },
          body: JSON.stringify(envelope),
          signal: AbortSignal.timeout(4500),
        });
        if (res.ok) {
          this.state.connectionStatus = 'live';
          return;
        }
      } catch {
        // Try next candidate
      }
    }
  }

  private async pushPreferencesSnapshot(): Promise<void> {
    const token = this.getCleanToken();
    if (!token || !this.config.syncEnabled) return;

    const body = {
      studio_settings: {
        defaultModel: this.state.selectedModelId,
        autoModelRouting: this.state.autoModelRouting,
        language: this.state.language,
        customInstructions: this.state.customInstruction,
      },
      theme_config: {
        themeMode: this.state.themeMode,
        liveTheme: this.state.liveTheme,
      },
      chat_prefs: {
        selectedModelId: this.state.selectedModelId,
        autoModelRouting: this.state.autoModelRouting,
        activeRoleId: this.state.activeRoleId,
        customInstruction: this.state.customInstruction,
        runSettings: {
          thinkingLevel: this.state.thinkingLevel,
          temperature: this.state.temperature,
          maxOutputTokens: this.state.maxOutputTokens,
          enableSearchGrounding: this.state.enableSearchGrounding,
        },
      },
    };

    for (const base of this.getBaseCandidates()) {
      try {
        const res = await fetch(`${base}/api/v1/user/preferences`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'X-SupremeAI-Key': token,
            'X-SupremeAI-Device': this.deviceId,
            'X-SupremeAI-Platform': 'vsix',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(4500),
        });
        if (res.ok) return;
      } catch {
        // Try next candidate
      }
    }
  }

  private async connectStream(): Promise<void> {
    const token = this.getCleanToken();
    if (!token || this.disposed) return;

    this.streamAbort?.abort();
    const controller = new AbortController();
    this.streamAbort = controller;

    for (const base of this.getBaseCandidates()) {
      try {
        const res = await fetch(
          `${base}/api/v1/sync/stream?device_id=${encodeURIComponent(this.deviceId)}&platform=vsix`,
          {
            method: 'GET',
            headers: {
              Accept: 'text/event-stream',
              Authorization: `Bearer ${token}`,
              'X-SupremeAI-Key': token,
              'X-SupremeAI-Device': this.deviceId,
              'X-SupremeAI-Platform': 'vsix',
            },
            signal: controller.signal,
          }
        );
        if (!res.ok || !res.body) continue;

        this.state.connectionStatus = 'live';
        this.emit('remote');
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
            const dataLine = frame
              .split('\n')
              .find((l) => l.startsWith('data:'))
              ?.slice(5)
              .trim();
            if (!dataLine || dataLine === '[DONE]') continue;
            try {
              const parsed = JSON.parse(dataLine) as Partial<VsCodeSyncEnvelope>;
              if (parsed && parsed.domain) {
                this.applyEnvelope(parsed);
              }
            } catch {
              // Ignore keepalive comments
            }
          }
        }
        break;
      } catch {
        if (controller.signal.aborted) return;
      }
    }

    if (!this.disposed && this.config.syncEnabled && !this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (!this.disposed) {
          void this.connectStream();
        }
      }, 5000);
    }
  }
}
