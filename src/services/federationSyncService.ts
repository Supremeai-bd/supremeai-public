/**
 * SupremeAI Federation Sync Engine
 *
 * Framework-free, dependency-free scheduler that keeps every Studio surface
 * pinned to the real `Supremeai-bd/supremeai` backend.
 *
 * Guarantees
 *  - Per-source cadence with jitter + exponential backoff on failure.
 *  - Single-flight: repeated ticks/drags never duplicate a network call.
 *  - Conditional requests (ETag / If-None-Match) so unchanged payloads are free.
 *  - Local snapshot cache (localStorage) so views paint instantly and survive
 *    offline reloads without a spinner.
 *  - Fail-open: a broken or unauthorised endpoint degrades its own row only.
 *  - Visibility aware: timers stop when the tab is hidden and resume on focus.
 *
 * The engine is deliberately injectable (fetch/storage/clock/timers/random) so
 * the behaviour above is covered by deterministic unit tests.
 */

import {
  FEDERATION_SOURCES,
  FederationSource,
  isSourceCredentialMissing,
  resolveFederationAuthHeaders,
  resolveFederationUrl,
} from '../config/federationSources';
import { PayloadSummary, summarizePayload } from '../utils/federationNormalize';

export type FederationSourceState =
  | 'idle'
  | 'syncing'
  | 'ok'
  | 'stale'
  | 'error'
  | 'offline'
  | 'restricted'
  | 'unsupported'
  | 'paused';

export type FederationTransport = 'network' | 'cache' | 'none';

export interface FederationSnapshot {
  sourceId: string;
  state: FederationSourceState;
  data: unknown;
  fetchedAt: number | null;
  attemptedAt: number | null;
  latencyMs: number | null;
  httpStatus: number | null;
  error: string | null;
  consecutiveFailures: number;
  nextSyncAt: number | null;
  summary: PayloadSummary;
  transport: FederationTransport;
  etag: string | null;
  /** Last N completed latencies, newest last (max 12) — drives the sparkline. */
  latencyHistory: number[];
}

export interface FederationSyncEvent {
  id: string;
  sourceId: string;
  at: number;
  state: FederationSourceState;
  latencyMs: number | null;
  message: string | null;
}

export interface FederationPulse {
  total: number;
  online: number;
  stale: number;
  degraded: number;
  restricted: number;
  paused: number;
  pending: number;
  averageLatencyMs: number | null;
  totalRecords: number;
  totalBytes: number;
  successRate: number | null;
  lastSyncAt: number | null;
  lastEventAt: number | null;
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    credentials?: RequestCredentials;
    cache?: RequestCache;
  }
) => Promise<{
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}>;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface FederationSyncEngineOptions {
  sources?: FederationSource[];
  apiBaseUrl?: string;
  fetcher?: FetchLike;
  storage?: StorageLike | null;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  /** Disable automatic scheduling (used by deterministic tests). */
  autoSchedule?: boolean;
  cacheKey?: string;
  maxBackoffMs?: number;
  intervalMultiplier?: number;
  authResolver?: (source: FederationSource) => Record<string, string> | null;
  credentialMissing?: (source: FederationSource) => boolean;
  /** Maximum cached payload size before entries are down-graded to metadata. */
  maxCacheBytes?: number;
}

const DEFAULT_CACHE_KEY = 'supremeai.federation.sync.cache.v1';
const MAX_EVENTS = 150;
const MAX_LATENCY_HISTORY = 12;
const STALE_FACTOR = 3;

function emptySummary(): PayloadSummary {
  return { kind: 'unknown', records: null, topKeys: [], keyCount: 0, metrics: [], bytes: 0 };
}

function emptySnapshot(sourceId: string): FederationSnapshot {
  return {
    sourceId,
    state: 'idle',
    data: null,
    fetchedAt: null,
    attemptedAt: null,
    latencyMs: null,
    httpStatus: null,
    error: null,
    consecutiveFailures: 0,
    nextSyncAt: null,
    summary: emptySummary(),
    transport: 'none',
    etag: null,
    latencyHistory: [],
  };
}

let eventCounter = 0;

export class FederationSyncEngine {
  private readonly sources: FederationSource[];
  private readonly sourceMap: Map<string, FederationSource>;
  private readonly fetcher: FetchLike;
  private readonly storage: StorageLike | null;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly schedule: (fn: () => void, ms: number) => TimerHandle;
  private readonly unschedule: (handle: TimerHandle) => void;
  private readonly autoSchedule: boolean;
  private readonly cacheKey: string;
  private readonly maxBackoffMs: number;
  private readonly apiBaseUrl: string;
  private readonly authResolver: (source: FederationSource) => Record<string, string> | null;
  private readonly credentialMissing: (source: FederationSource) => boolean;
  private readonly maxCacheBytes: number;

  private snapshots = new Map<string, FederationSnapshot>();
  private timers = new Map<string, TimerHandle>();
  private inFlight = new Map<string, Promise<void>>();
  private listeners = new Set<
    (snapshot: FederationSnapshot, event?: FederationSyncEvent) => void
  >();
  private events: FederationSyncEvent[] = [];
  private started = false;
  private paused = false;
  private persistTimer: TimerHandle | null = null;
  private intervalMultiplier: number;
  private lastFullSyncAt: number | null = null;
  private visibilityCleanup: (() => void) | null = null;

  constructor(options: FederationSyncEngineOptions = {}) {
    this.sources = options.sources ?? FEDERATION_SOURCES;
    this.sourceMap = new Map(this.sources.map((source) => [source.id, source]));
    // বাংলা মন্তব্য: ব্রাউজারে this.fetcher() সরাসরি window.fetch কল করলে Illegal invocation হয়;
    // তাই arrow function দিয়ে global fetch কল র‍্যাপ করা হয়েছে।
    this.fetcher =
      options.fetcher ??
      (((input: Parameters<FetchLike>[0], init?: Parameters<FetchLike>[1]) => {
        if (typeof fetch !== 'function') {
          return Promise.reject(new Error('fetch is not available in this environment'));
        }
        return fetch(input, init);
      }) as unknown as FetchLike);
    this.storage =
      options.storage === undefined
        ? typeof localStorage !== 'undefined'
          ? localStorage
          : null
        : options.storage;
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.schedule = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.unschedule = options.clearTimer ?? ((handle) => clearTimeout(handle));
    this.autoSchedule = options.autoSchedule ?? true;
    this.cacheKey = options.cacheKey ?? DEFAULT_CACHE_KEY;
    this.maxBackoffMs = options.maxBackoffMs ?? 300_000;
    this.intervalMultiplier = options.intervalMultiplier ?? 1;
    this.apiBaseUrl = options.apiBaseUrl ?? '';
    this.authResolver = options.authResolver ?? resolveFederationAuthHeaders;
    this.credentialMissing = options.credentialMissing ?? isSourceCredentialMissing;
    this.maxCacheBytes = options.maxCacheBytes ?? 1_500_000;

    for (const source of this.sources) {
      this.snapshots.set(source.id, emptySnapshot(source.id));
    }

    this.hydrateFromCache();
  }

  // ------------------------------------------------------------------ lifecycle

  public start(): void {
    if (this.started) return;
    this.started = true;
    this.attachVisibilityHandling();
    this.sources.forEach((source, index) => {
      // Stagger first syncs so a cold boot does not fire 25 parallel requests.
      this.armTimer(source.id, 250 + index * 140);
    });
  }

  public stop(): void {
    this.started = false;
    for (const handle of this.timers.values()) this.unschedule(handle);
    this.timers.clear();
    this.flushPersist();
    if (this.visibilityCleanup) {
      this.visibilityCleanup();
      this.visibilityCleanup = null;
    }
  }

  /** Pause/resume every timer without losing cached state. */
  public setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      for (const handle of this.timers.values()) this.unschedule(handle);
      this.timers.clear();
      for (const snapshot of this.snapshots.values()) {
        if (snapshot.nextSyncAt) snapshot.nextSyncAt = null;
      }
      this.emitAll();
      return;
    }
    if (this.started) {
      this.sources.forEach((source, index) => this.armTimer(source.id, 200 + index * 120));
    }
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public isStarted(): boolean {
    return this.started;
  }

  public setIntervalMultiplier(multiplier: number): void {
    const safe = Number.isFinite(multiplier) && multiplier > 0 ? Math.min(multiplier, 10) : 1;
    this.intervalMultiplier = safe;
    if (this.started && !this.paused) {
      // Re-arm on the new cadence instead of bursting every source at once.
      this.sources.forEach((source, index) =>
        this.armTimer(source.id, this.nextInterval(source, 0) + index * 80)
      );
    }
  }

  public getIntervalMultiplier(): number {
    return this.intervalMultiplier;
  }

  public pauseSource(sourceId: string): void {
    const snapshot = this.snapshots.get(sourceId);
    if (!snapshot) return;
    const timer = this.timers.get(sourceId);
    if (timer) {
      this.unschedule(timer);
      this.timers.delete(sourceId);
    }
    snapshot.state = 'paused';
    snapshot.nextSyncAt = null;
    this.emit(sourceId);
  }

  public resumeSource(sourceId: string): void {
    const snapshot = this.snapshots.get(sourceId);
    if (!snapshot || snapshot.state !== 'paused') return;
    snapshot.state = snapshot.data ? 'stale' : 'idle';
    this.emit(sourceId);
    void this.syncSource(sourceId);
  }

  // ------------------------------------------------------------------ reads

  public getSources(): FederationSource[] {
    return this.sources;
  }

  public getSource(sourceId: string): FederationSource | undefined {
    return this.sourceMap.get(sourceId);
  }

  /** Snapshot with time-derived staleness applied. */
  public getSnapshot(sourceId: string): FederationSnapshot | undefined {
    const snapshot = this.snapshots.get(sourceId);
    if (!snapshot) return undefined;
    return this.decorate(snapshot);
  }

  public getSnapshots(): FederationSnapshot[] {
    return this.sources
      .map((source) => this.snapshots.get(source.id))
      .filter((snapshot): snapshot is FederationSnapshot => Boolean(snapshot))
      .map((snapshot) => this.decorate(snapshot));
  }

  public getEvents(): FederationSyncEvent[] {
    return [...this.events];
  }

  public getLastFullSyncAt(): number | null {
    return this.lastFullSyncAt;
  }

  public getPulse(snapshots: FederationSnapshot[] = this.getSnapshots()): FederationPulse {
    let online = 0;
    let stale = 0;
    let degraded = 0;
    let restricted = 0;
    let paused = 0;
    let pending = 0;
    let latencySum = 0;
    let latencyCount = 0;
    let totalRecords = 0;
    let totalBytes = 0;
    let lastSyncAt: number | null = null;

    for (const snapshot of snapshots) {
      switch (snapshot.state) {
        case 'ok':
          online += 1;
          break;
        case 'stale':
          stale += 1;
          break;
        case 'error':
        case 'offline':
        case 'unsupported':
          degraded += 1;
          break;
        case 'restricted':
          restricted += 1;
          break;
        case 'paused':
          paused += 1;
          break;
        case 'syncing':
          pending += 1;
          break;
        default:
          break;
      }
      if (snapshot.latencyMs !== null && snapshot.transport === 'network') {
        latencySum += snapshot.latencyMs;
        latencyCount += 1;
      }
      if (snapshot.summary.records) totalRecords += snapshot.summary.records;
      totalBytes += snapshot.summary.bytes;
      if (snapshot.fetchedAt && (!lastSyncAt || snapshot.fetchedAt > lastSyncAt)) {
        lastSyncAt = snapshot.fetchedAt;
      }
    }

    const settled = online + stale + degraded;
    const lastEvent = this.events[this.events.length - 1];

    return {
      total: snapshots.length,
      online,
      stale,
      degraded,
      restricted,
      paused,
      pending,
      averageLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : null,
      totalRecords,
      totalBytes,
      successRate: settled > 0 ? Math.round((online / settled) * 100) : null,
      lastSyncAt,
      lastEventAt: lastEvent?.at ?? null,
    };
  }

  /** Deterministic aggregate status for the global header pill. */
  public getOverallStatus(): 'live' | 'syncing' | 'degraded' | 'offline' | 'idle' {
    const snapshots = this.getSnapshots();
    if (snapshots.length === 0) return 'idle';
    const pulse = this.getPulse(snapshots);
    if (pulse.pending > 0 && pulse.online === 0) return 'syncing';
    if (pulse.online + pulse.stale === 0) {
      if (pulse.degraded > 0) return 'offline';
      if (pulse.restricted > 0) return 'degraded';
      return 'idle';
    }
    if (pulse.degraded > 0) return 'degraded';
    if (pulse.pending > 0) return 'syncing';
    return 'live';
  }

  public getSourceData<T = unknown>(sourceId: string): T | null {
    const snapshot = this.snapshots.get(sourceId);
    return (snapshot?.data as T) ?? null;
  }

  // ------------------------------------------------------------------ sync

  /** Force-sync one source (single-flight; safe to call from UI). */
  public syncSource(sourceId: string): Promise<void> {
    const existing = this.inFlight.get(sourceId);
    if (existing) return existing;

    const source = this.sourceMap.get(sourceId);
    if (!source) return Promise.resolve();
    if (this.snapshots.get(sourceId)?.state === 'paused') return Promise.resolve();

    const task = this.runSync(source).finally(() => {
      this.inFlight.delete(sourceId);
    });
    this.inFlight.set(sourceId, task);
    return task;
  }

  public async syncAll(): Promise<void> {
    const playable = this.sources.filter(
      (source) => this.snapshots.get(source.id)?.state !== 'paused'
    );
    await Promise.allSettled(playable.map((source) => this.syncSource(source.id)));
    this.lastFullSyncAt = this.now();
  }

  public async refresh(sourceId?: string): Promise<void> {
    if (sourceId) {
      await this.syncSource(sourceId);
      this.lastFullSyncAt = this.now();
      return;
    }
    await this.syncAll();
    this.emitAll();
  }

  private async runSync(source: FederationSource): Promise<void> {
    const snapshot = this.snapshots.get(source.id) ?? emptySnapshot(source.id);
    const startedAt = this.now();

    // Missing credential: mark restricted without a doomed network round-trip.
    if (this.credentialMissing(source)) {
      snapshot.state = 'restricted';
      snapshot.error = 'Credential required';
      snapshot.attemptedAt = startedAt;
      snapshot.nextSyncAt = startedAt + this.nextInterval(source, 0);
      this.snapshots.set(source.id, snapshot);
      this.emit(source.id);
      this.armTimer(source.id, this.nextInterval(source, 0));
      return;
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? this.schedule(() => controller.abort(), source.timeoutMs) : null;

    snapshot.state = 'syncing';
    snapshot.attemptedAt = startedAt;
    this.snapshots.set(source.id, snapshot);
    this.emit(source.id);

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        ...(this.authResolver(source) ?? {}),
      };
      if (snapshot.etag) headers['If-None-Match'] = snapshot.etag;

      const response = await this.fetcher(resolveFederationUrl(source, this.apiBaseUrl), {
        method: 'GET',
        headers,
        signal: controller?.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      });

      if (timeoutId) this.unschedule(timeoutId);

      const status = response.status;

      if (status === 304) {
        this.markSuccess(source, snapshot, {
          data: snapshot.data,
          latencyMs: this.now() - startedAt,
          httpStatus: 304,
          etag: snapshot.etag,
          fetchedAt: this.now(),
          fromCache: true,
        });
        return;
      }

      if (status === 401 || status === 403) {
        this.markSettled(source, snapshot, 'restricted', `Sign-in required (${status})`);
        return;
      }

      if (status === 404 || status === 405 || status === 501) {
        this.markSettled(source, snapshot, 'unsupported', `Endpoint not mounted here (${status})`);
        return;
      }

      if (!response.ok) {
        // Surface the upstream's own diagnosis (the edge proxy returns
        // `{error, detail, retryable}`) so the activity feed is actionable.
        let detail = '';
        try {
          const body = response.json ? await response.json() : null;
          if (body && typeof body === 'object') {
            const record = body as Record<string, unknown>;
            const candidate = record.detail ?? record.error ?? record.message;
            if (typeof candidate === 'string' && candidate.trim()) detail = candidate.trim();
          }
        } catch {
          /* error bodies are best-effort */
        }
        const message = detail ? `HTTP ${status} · ${detail.slice(0, 160)}` : `HTTP ${status}`;
        const state = status === 502 || status === 503 || status === 504 ? 'offline' : 'error';
        this.markFailure(source, snapshot, message, status, state);
        return;
      }

      const contentType = response.headers?.get('content-type') ?? '';
      let payload: unknown = null;

      if (contentType.includes('application/json')) {
        payload = response.json ? await response.json() : null;
      } else {
        const text = response.text ? await response.text() : '';
        const trimmed = text.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            payload = JSON.parse(trimmed);
          } catch {
            this.markFailure(source, snapshot, 'Malformed JSON payload', status);
            return;
          }
        } else if (
          contentType.includes('text/html') ||
          trimmed.startsWith('<!DOCTYPE') ||
          trimmed.startsWith('<html')
        ) {
          // The SPA fallback answered instead of the API — never render that.
          this.markFailure(
            source,
            snapshot,
            'Received HTML instead of JSON (SPA fallback)',
            status
          );
          return;
        } else {
          payload = { raw: trimmed.slice(0, 20_000), contentType };
        }
      }

      this.markSuccess(source, snapshot, {
        data: payload,
        latencyMs: this.now() - startedAt,
        httpStatus: status,
        etag: response.headers?.get('etag') ?? null,
        fetchedAt: this.now(),
      });
    } catch (error: unknown) {
      if (timeoutId) this.unschedule(timeoutId);
      const message = error instanceof Error ? error.message : String(error);
      const isAbort = error instanceof Error && error.name === 'AbortError';
      const isOffline =
        typeof navigator !== 'undefined' && navigator.onLine === false
          ? true
          : /failed to fetch|fetch failed|networkerror|network error|load failed|econnrefused|enotfound/i.test(
              message
            );
      if (isOffline) {
        this.markFailure(source, snapshot, 'Network unreachable', null, 'offline');
      } else if (isAbort) {
        this.markFailure(source, snapshot, `Timed out after ${source.timeoutMs} ms`, null);
      } else {
        this.markFailure(source, snapshot, message || 'Unknown fetch error', null);
      }
    }
  }

  // ------------------------------------------------------------------ state updates

  private markSuccess(
    source: FederationSource,
    snapshot: FederationSnapshot,
    next: {
      data: unknown;
      latencyMs: number;
      httpStatus: number;
      etag: string | null;
      fetchedAt: number;
      fromCache?: boolean;
    }
  ): void {
    // A late response must never resurrect a source the operator paused.
    if (this.snapshots.get(source.id)?.state === 'paused') return;

    const summary = summarizePayload(next.data, {
      collectionKeys: source.collectionKeys,
      metrics: source.metrics,
    });

    const latencyHistory =
      next.fromCache || !Number.isFinite(next.latencyMs)
        ? snapshot.latencyHistory
        : [...snapshot.latencyHistory, Math.max(0, Math.round(next.latencyMs))].slice(
            -MAX_LATENCY_HISTORY
          );

    snapshot.state = 'ok';
    snapshot.data = next.data;
    snapshot.fetchedAt = next.fetchedAt;
    snapshot.latencyMs = Math.max(0, Math.round(next.latencyMs));
    snapshot.httpStatus = next.httpStatus;
    snapshot.error = null;
    snapshot.consecutiveFailures = 0;
    snapshot.summary = summary;
    snapshot.transport = 'network';
    snapshot.etag = next.etag;
    snapshot.latencyHistory = latencyHistory;
    snapshot.nextSyncAt = this.now() + this.nextInterval(source, 0);

    this.snapshots.set(source.id, snapshot);
    this.recordEvent(
      source.id,
      'ok',
      `Synced ${summary.records ?? '?'} record(s)`,
      snapshot.latencyMs
    );
    this.emit(source.id);
    this.schedulePersist();
    this.armTimer(source.id, this.nextInterval(source, 0));
  }

  private markSettled(
    source: FederationSource,
    snapshot: FederationSnapshot,
    state: FederationSourceState,
    message: string
  ): void {
    snapshot.state = state;
    snapshot.error = message;
    snapshot.transport = snapshot.data ? 'cache' : 'none';
    snapshot.nextSyncAt = this.now() + this.nextInterval(source, 0);
    this.snapshots.set(source.id, snapshot);
    this.recordEvent(source.id, state, message, null);
    this.emit(source.id);
    this.armTimer(source.id, this.nextInterval(source, 0));
  }

  private markFailure(
    source: FederationSource,
    snapshot: FederationSnapshot,
    message: string,
    httpStatus: number | null,
    state: 'error' | 'offline' = 'error'
  ): void {
    if (this.snapshots.get(source.id)?.state === 'paused') return;
    snapshot.consecutiveFailures += 1;
    snapshot.state = state;
    snapshot.error = message;
    snapshot.httpStatus = httpStatus;
    snapshot.transport = snapshot.data ? 'cache' : 'none';
    const delay = this.backoffDelay(source, snapshot.consecutiveFailures);
    snapshot.nextSyncAt = this.now() + delay;
    this.snapshots.set(source.id, snapshot);
    this.recordEvent(source.id, state, message, null);
    this.emit(source.id);
    this.schedulePersist();
    this.armTimer(source.id, delay);
  }

  private decorate(snapshot: FederationSnapshot): FederationSnapshot {
    const source = this.sourceMap.get(snapshot.sourceId);
    if (!source || snapshot.state !== 'ok' || !snapshot.fetchedAt) return { ...snapshot };
    const budget = Math.max(source.intervalMs * STALE_FACTOR, 30_000);
    if (this.now() - snapshot.fetchedAt > budget) {
      return { ...snapshot, state: 'stale' };
    }
    return { ...snapshot };
  }

  private nextInterval(source: FederationSource, failures: number): number {
    const base = source.intervalMs * this.intervalMultiplier;
    if (failures <= 0) {
      // ±10% jitter keeps a fleet of tabs from synchronising their bursts.
      const jitter = 0.9 + this.random() * 0.2;
      return Math.round(base * jitter);
    }
    return this.backoffDelay(source, failures);
  }

  private backoffDelay(source: FederationSource, failures: number): number {
    const base = source.intervalMs * this.intervalMultiplier;
    const exponential = base * Math.pow(2, Math.min(failures, 6));
    const capped = Math.min(exponential, this.maxBackoffMs);
    const jitter = 0.85 + this.random() * 0.3;
    return Math.round(Math.max(2_000, capped * jitter));
  }

  private armTimer(sourceId: string, delayMs: number): void {
    if (!this.autoSchedule || !this.started || this.paused) return;
    const existing = this.timers.get(sourceId);
    if (existing) this.unschedule(existing);
    const handle = this.schedule(
      () => {
        this.timers.delete(sourceId);
        void this.syncSource(sourceId);
      },
      Math.max(150, delayMs)
    );
    this.timers.set(sourceId, handle);
  }

  // ------------------------------------------------------------------ subscription

  public subscribe(
    listener: (snapshot: FederationSnapshot, event?: FederationSyncEvent) => void
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public subscribeEvents(listener: (event: FederationSyncEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  private eventListeners = new Set<(event: FederationSyncEvent) => void>();

  private emit(sourceId: string): void {
    const snapshot = this.getSnapshot(sourceId);
    if (!snapshot) return;
    for (const listener of this.listeners) listener(snapshot);
  }

  private emitAll(): void {
    for (const source of this.sources) this.emit(source.id);
  }

  private recordEvent(
    sourceId: string,
    state: FederationSourceState,
    message: string | null,
    latencyMs: number | null
  ): void {
    eventCounter += 1;
    const event: FederationSyncEvent = {
      id: `evt-${this.now()}-${eventCounter}`,
      sourceId,
      at: this.now(),
      state,
      latencyMs,
      message,
    };
    this.events = [...this.events, event].slice(-MAX_EVENTS);
    for (const listener of this.eventListeners) listener(event);
  }

  // ------------------------------------------------------------------ persistence

  private schedulePersist(): void {
    if (!this.storage) return;
    if (this.persistTimer) return;
    this.persistTimer = this.schedule(() => {
      this.persistTimer = null;
      this.flushPersist();
    }, 900);
  }

  private flushPersist(): void {
    if (!this.storage) return;
    const entries: Record<string, unknown> = {};
    for (const source of this.sources) {
      const snapshot = this.snapshots.get(source.id);
      if (!snapshot?.fetchedAt || snapshot.data === null || snapshot.data === undefined) continue;
      entries[source.id] = {
        data: snapshot.data,
        fetchedAt: snapshot.fetchedAt,
        latencyMs: snapshot.latencyMs,
        httpStatus: snapshot.httpStatus,
        etag: snapshot.etag,
        latencyHistory: snapshot.latencyHistory,
      };
    }

    const serialise = () => JSON.stringify({ version: 1, savedAt: this.now(), entries });
    let payload = serialise();

    // Quota guard: progressively shed the heaviest payloads, keeping metadata.
    if (payload.length > this.maxCacheBytes) {
      const ordered = Object.entries(entries).sort(
        (a, b) =>
          JSON.stringify((b[1] as { data: unknown }).data).length -
          JSON.stringify((a[1] as { data: unknown }).data).length
      );
      for (const [id, value] of ordered) {
        const entry = value as { data?: unknown };
        entry.data = { trimmed: true };
        if (serialise().length <= this.maxCacheBytes) break;
        delete entries[id];
      }
      payload = serialise();
    }

    try {
      this.storage.setItem(this.cacheKey, payload);
    } catch {
      try {
        this.storage.removeItem(this.cacheKey);
      } catch {
        /* storage unavailable — cache is best-effort only */
      }
    }
  }

  private hydrateFromCache(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.cacheKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        version?: number;
        entries?: Record<
          string,
          {
            data: unknown;
            fetchedAt: number;
            latencyMs: number | null;
            httpStatus: number | null;
            etag: string | null;
            latencyHistory?: number[];
          }
        >;
      };
      if (parsed?.version !== 1 || !parsed.entries) return;

      for (const [sourceId, entry] of Object.entries(parsed.entries)) {
        const source = this.sourceMap.get(sourceId);
        if (!source) continue;
        const snapshot = this.snapshots.get(sourceId) ?? emptySnapshot(sourceId);
        const trimmed = Boolean(
          entry.data && typeof entry.data === 'object' && 'trimmed' in (entry.data as object)
        );
        snapshot.data = trimmed ? null : entry.data;
        snapshot.fetchedAt = entry.fetchedAt;
        snapshot.latencyMs = entry.latencyMs;
        snapshot.httpStatus = entry.httpStatus;
        snapshot.etag = entry.etag;
        snapshot.latencyHistory = Array.isArray(entry.latencyHistory)
          ? entry.latencyHistory.slice(-MAX_LATENCY_HISTORY)
          : [];
        snapshot.transport = trimmed ? 'none' : 'cache';
        // `decorate()` downgrades to `stale` when the cached payload is old.
        snapshot.state = trimmed ? 'idle' : 'ok';
        if (!trimmed) {
          snapshot.summary = summarizePayload(entry.data, {
            collectionKeys: source.collectionKeys,
            metrics: source.metrics,
          });
        }
        this.snapshots.set(sourceId, snapshot);
      }
    } catch {
      /* corrupt cache is ignored, never fatal */
    }
  }

  /** Serializable snapshot bundle for export/diagnostics. */
  public exportBundle() {
    return {
      exportedAt: new Date(this.now()).toISOString(),
      repository: 'Supremeai-bd/supremeai',
      studio: 'Supremeai-bd/supremeai-public',
      intervalMultiplier: this.intervalMultiplier,
      pulse: this.getPulse(),
      sources: this.getSnapshots().map((snapshot) => {
        const source = this.sourceMap.get(snapshot.sourceId);
        return {
          id: snapshot.sourceId,
          feature: source?.feature,
          path: source?.path,
          auth: source?.auth,
          state: snapshot.state,
          httpStatus: snapshot.httpStatus,
          latencyMs: snapshot.latencyMs,
          fetchedAt: snapshot.fetchedAt ? new Date(snapshot.fetchedAt).toISOString() : null,
          records: snapshot.summary.records,
          bytes: snapshot.summary.bytes,
          error: snapshot.error,
          data: snapshot.data,
        };
      }),
      events: this.getEvents().slice(-50),
    };
  }

  private attachVisibilityHandling(): void {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;

    const handleVisibility = () => {
      if (document.hidden) {
        for (const handle of this.timers.values()) this.unschedule(handle);
        this.timers.clear();
        return;
      }
      this.sources.forEach((source, index) => {
        const snapshot = this.snapshots.get(source.id);
        const isStale =
          !snapshot?.fetchedAt || this.now() - snapshot.fetchedAt > source.intervalMs * 1.5;
        this.armTimer(source.id, isStale ? 120 + index * 90 : source.intervalMs);
      });
    };

    const handleOnline = () => {
      if (this.paused) return;
      this.sources.forEach((source) => this.armTimer(source.id, 400));
    };

    document.addEventListener('visibilitychange', handleVisibility);
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', handleOnline);
    }

    this.visibilityCleanup = () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('online', handleOnline);
      }
    };
  }
}

/** Application-wide singleton used by the store and the header pill. */
export const federationSync = new FederationSyncEngine();
