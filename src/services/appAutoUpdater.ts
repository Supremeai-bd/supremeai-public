import { invoke, isTauri } from '@tauri-apps/api/core';
import clientVersionManifest from '../../version.json';
import {
  detectPlatform,
  detectRuntimeTarget,
  openExternalDownloadUrl,
  type RuntimeTarget,
} from '../bridge/platform';
import { DEFAULT_WEB_STUDIO_URL, GITHUB_PUBLIC_REPO_SLUG } from '../config/platformEndpoints';
import {
  compareSemver,
  DEFAULT_RELEASE_MANIFEST,
  normalizeRemoteReleaseManifest,
  type ReleaseManifest,
} from '../config/releaseDownloads';

export type AutoUpdateStatus =
  'idle' | 'checking' | 'up-to-date' | 'staging' | 'ready' | 'applying' | 'error';

export interface AppRuntimeInfo {
  version: string;
  os: string;
  arch: string;
  isWindows: boolean;
  isAndroid: boolean;
}

export interface PendingUpdateRecord {
  version: string;
  tag: string;
  filePath: string;
  fileName: string;
  url: string;
  stagedAt: string;
  sha256?: string;
}

export interface StagedUpdateInfo {
  filePath: string;
  fileName: string;
  version: string;
  sizeBytes: number;
  alreadyCached: boolean;
  pendingOnNextStartup: boolean;
  sha256?: string;
}

export interface ApplyUpdateResult {
  launched: boolean;
  silent: boolean;
  mode: string;
  message: string;
}

export interface AutoUpdateState {
  status: AutoUpdateStatus;
  currentVersion: string;
  currentTag: string;
  latestVersion: string | null;
  latestTag: string | null;
  versionMismatch: boolean;
  pendingOnNextStartup: boolean;
  runtimeTarget: RuntimeTarget;
  downloadUrl: string | null;
  stagedFilePath: string | null;
  alreadyCached: boolean;
  silentSupported: boolean;
  message: string | null;
  lastCheckedAt: number | null;
}

const WEB_PENDING_UPDATE_STORAGE_KEY = 'supremeai_pending_web_update_v1';
export const DEFAULT_UPDATE_POLL_INTERVAL_MS = 15 * 60_000;

export const CLIENT_VERSION_INFO = {
  version: String(clientVersionManifest?.version || DEFAULT_RELEASE_MANIFEST.version),
  tag: String(clientVersionManifest?.tag || 'latest'),
  releaseTag: String(
    clientVersionManifest?.releaseTag ||
      `v${clientVersionManifest?.version || DEFAULT_RELEASE_MANIFEST.version}`
  ),
  repo: String(clientVersionManifest?.repo || GITHUB_PUBLIC_REPO_SLUG),
};

const initialState: AutoUpdateState = {
  status: 'idle',
  currentVersion: CLIENT_VERSION_INFO.version,
  currentTag: CLIENT_VERSION_INFO.releaseTag,
  latestVersion: null,
  latestTag: null,
  versionMismatch: false,
  pendingOnNextStartup: false,
  runtimeTarget: typeof window !== 'undefined' ? detectRuntimeTarget() : 'web',
  downloadUrl: null,
  stagedFilePath: null,
  alreadyCached: false,
  silentSupported: false,
  message: null,
  lastCheckedAt: null,
};

let currentState: AutoUpdateState = { ...initialState };
const listeners = new Set<(state: AutoUpdateState) => void>();
let monitorTimer: ReturnType<typeof setInterval> | null = null;
let initialCheckTimer: ReturnType<typeof setTimeout> | null = null;
let activeCheckPromise: Promise<AutoUpdateState> | null = null;

function setState(patch: Partial<AutoUpdateState>): AutoUpdateState {
  currentState = { ...currentState, ...patch };
  for (const listener of listeners) {
    listener(currentState);
  }
  return currentState;
}

export function getUpdateState(): AutoUpdateState {
  return currentState;
}

export function resetUpdateStateForTest(): void {
  stopBackgroundUpdateMonitor();
  activeCheckPromise = null;
  currentState = { ...initialState };
}

export function subscribeUpdateState(listener: (state: AutoUpdateState) => void): () => void {
  listeners.add(listener);
  listener(currentState);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Resolves the effective semver version from a GitHub release manifest/tag pair
 * and determines whether it is newer than the client's current version (from version.json).
 */
export function resolveReleaseVersionMismatch(
  currentVersion: string,
  manifest: Pick<ReleaseManifest, 'version' | 'tag'>
): { mismatch: boolean; resolvedVersion: string; resolvedTag: string } {
  const manifestVersion = String(manifest.version || '')
    .replace(/^v/i, '')
    .trim();
  const tagCandidate = String(manifest.tag || '').trim();
  const tagSemver = /^v?\d+\.\d+\.\d+/i.test(tagCandidate)
    ? tagCandidate.replace(/^v/i, '').trim()
    : '';

  const resolvedVersion =
    tagSemver && compareSemver(tagSemver, manifestVersion || '0.0.0') > 0
      ? tagSemver
      : manifestVersion || tagSemver || currentVersion;

  const resolvedTag = tagCandidate || `v${resolvedVersion}`;
  const mismatch = compareSemver(resolvedVersion, currentVersion) > 0;
  return { mismatch, resolvedVersion, resolvedTag };
}

export async function fetchRemoteReleaseManifest(): Promise<ReleaseManifest> {
  const platform = detectPlatform();
  const repoSlug = CLIENT_VERSION_INFO.repo || GITHUB_PUBLIC_REPO_SLUG;
  const endpoints =
    platform === 'tauri'
      ? [
          `${DEFAULT_WEB_STUDIO_URL}/api/releases/latest`,
          `https://github.com/${repoSlug}/releases/download/latest/latest-release.json`,
          `https://github.com/${repoSlug}/releases/download/latest/latest-desktop.json`,
        ]
      : [
          '/api/releases/latest',
          `https://github.com/${repoSlug}/releases/download/latest/latest-release.json`,
        ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) continue;
      const json = (await res.json().catch(() => null)) as any;
      if (
        json &&
        typeof json.windowsExeUrl === 'string' &&
        typeof json.androidApkUrl === 'string'
      ) {
        return json as ReleaseManifest;
      }
      const normalized = normalizeRemoteReleaseManifest(json, repoSlug);
      if (normalized) return normalized;
    } catch {
      // Try next endpoint quietly
    }
  }
  return DEFAULT_RELEASE_MANIFEST;
}

/**
 * Checks whether a previously downloaded update is already staged on disk
 * for this client session / startup.
 */
export async function syncPendingUpdateOnStartup(): Promise<AutoUpdateState> {
  const runtimeTarget = detectRuntimeTarget();

  if (detectPlatform() === 'tauri' && isTauri()) {
    try {
      const [info, pending] = await Promise.all([
        invoke<AppRuntimeInfo>('get_app_runtime_info'),
        invoke<PendingUpdateRecord | null>('get_pending_update'),
      ]);
      const currentVersion = info?.version || CLIENT_VERSION_INFO.version;
      if (pending && compareSemver(pending.version, currentVersion) > 0) {
        return setState({
          status: 'ready',
          currentVersion,
          latestVersion: pending.version,
          latestTag: pending.tag || `v${pending.version}`,
          versionMismatch: true,
          pendingOnNextStartup: true,
          runtimeTarget,
          downloadUrl: pending.url,
          stagedFilePath: pending.filePath,
          alreadyCached: true,
          silentSupported: Boolean(info?.isWindows),
          message: info?.isWindows
            ? `v${pending.version} downloaded · installs automatically on restart`
            : `v${pending.version} APK cached on device · tap to complete install`,
        });
      }
      return setState({
        currentVersion,
        runtimeTarget,
        silentSupported: Boolean(info?.isWindows),
      });
    } catch {
      return currentState;
    }
  }

  if (typeof window !== 'undefined' && runtimeTarget === 'web') {
    try {
      const raw = window.localStorage.getItem(WEB_PENDING_UPDATE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { version?: string; tag?: string; url?: string };
        if (parsed?.version && compareSemver(parsed.version, CLIENT_VERSION_INFO.version) > 0) {
          return setState({
            status: 'ready',
            currentVersion: CLIENT_VERSION_INFO.version,
            latestVersion: parsed.version,
            latestTag: parsed.tag || `v${parsed.version}`,
            versionMismatch: true,
            pendingOnNextStartup: true,
            runtimeTarget,
            downloadUrl: parsed.url || DEFAULT_WEB_STUDIO_URL,
            silentSupported: true,
            message: `v${parsed.version} ready · loads automatically on next startup/refresh`,
          });
        }
        window.localStorage.removeItem(WEB_PENDING_UPDATE_STORAGE_KEY);
      }
    } catch {
      // Ignore storage failures
    }
  }

  return currentState;
}

export async function checkAndStageBackgroundUpdate(force = false): Promise<AutoUpdateState> {
  if (!force && activeCheckPromise) {
    return activeCheckPromise;
  }

  activeCheckPromise = (async () => {
    const runtimeTarget = detectRuntimeTarget();
    let currentVersion = CLIENT_VERSION_INFO.version;
    const currentTag = CLIENT_VERSION_INFO.releaseTag;
    let isWindowsNative = false;
    let isAndroidNative = runtimeTarget === 'android';

    if (detectPlatform() === 'tauri' && isTauri()) {
      try {
        const info = await invoke<AppRuntimeInfo>('get_app_runtime_info');
        if (info?.version) currentVersion = info.version;
        isWindowsNative = Boolean(info?.isWindows);
        isAndroidNative = Boolean(info?.isAndroid);
      } catch {
        // Ignore if native runtime info isn't available
      }
    }

    setState({
      status: 'checking',
      currentVersion,
      currentTag,
      runtimeTarget,
      silentSupported: isWindowsNative,
      message: null,
    });

    try {
      const manifest = await fetchRemoteReleaseManifest();
      const { mismatch, resolvedVersion, resolvedTag } = resolveReleaseVersionMismatch(
        currentVersion,
        manifest
      );

      if (!mismatch) {
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.removeItem(WEB_PENDING_UPDATE_STORAGE_KEY);
          } catch {
            // Ignore
          }
        }
        return setState({
          status: 'up-to-date',
          latestVersion: resolvedVersion,
          latestTag: resolvedTag,
          versionMismatch: false,
          pendingOnNextStartup: false,
          lastCheckedAt: Date.now(),
          message: null,
        });
      }

      if (runtimeTarget === 'desktop' && isWindowsNative && manifest.windowsExeUrl) {
        setState({
          status: 'staging',
          latestVersion: resolvedVersion,
          latestTag: resolvedTag,
          versionMismatch: true,
          downloadUrl: manifest.windowsExeUrl,
          silentSupported: true,
          message: `Downloading v${resolvedVersion} quietly in background…`,
        });

        const fileName =
          manifest.windowsExeUrl.split('/').pop() ||
          `SupremeAI.Desktop_${resolvedVersion}_x64-setup.exe`;

        const staged = await invoke<StagedUpdateInfo>('stage_silent_update', {
          url: manifest.windowsExeUrl,
          fileName,
          version: resolvedVersion,
          tag: resolvedTag,
          expectedSha256: manifest.checksums?.windowsExeSha256 || null,
        });

        return setState({
          status: 'ready',
          latestVersion: resolvedVersion,
          latestTag: resolvedTag,
          versionMismatch: true,
          pendingOnNextStartup: staged.pendingOnNextStartup ?? true,
          downloadUrl: manifest.windowsExeUrl,
          stagedFilePath: staged.filePath,
          alreadyCached: staged.alreadyCached,
          silentSupported: true,
          lastCheckedAt: Date.now(),
          message: `v${resolvedVersion} downloaded · applies automatically on next startup`,
        });
      }

      if (runtimeTarget === 'android' || isAndroidNative) {
        const apkUrl = manifest.androidApkUrl;
        if (isTauri() && apkUrl) {
          setState({
            status: 'staging',
            latestVersion: resolvedVersion,
            latestTag: resolvedTag,
            versionMismatch: true,
            downloadUrl: apkUrl,
            silentSupported: false,
            message: `Downloading v${resolvedVersion} APK quietly onto device…`,
          });

          const fileName = apkUrl.split('/').pop() || 'SupremeAI-Studio-app-universal-release.apk';

          const staged = await invoke<StagedUpdateInfo>('stage_silent_update', {
            url: apkUrl,
            fileName,
            version: resolvedVersion,
            tag: resolvedTag,
            expectedSha256: manifest.checksums?.androidApkSha256 || null,
          });

          return setState({
            status: 'ready',
            latestVersion: resolvedVersion,
            latestTag: resolvedTag,
            versionMismatch: true,
            pendingOnNextStartup: staged.pendingOnNextStartup ?? true,
            downloadUrl: apkUrl,
            stagedFilePath: staged.filePath,
            alreadyCached: staged.alreadyCached,
            silentSupported: false,
            lastCheckedAt: Date.now(),
            message: `v${resolvedVersion} APK downloaded · tap install now or on next startup`,
          });
        }

        return setState({
          status: 'ready',
          latestVersion: resolvedVersion,
          latestTag: resolvedTag,
          versionMismatch: true,
          pendingOnNextStartup: true,
          downloadUrl: apkUrl,
          stagedFilePath: null,
          silentSupported: false,
          lastCheckedAt: Date.now(),
          message: `v${resolvedVersion} APK ready · tap to install`,
        });
      }

      // Web runtime: persist mismatch & clear stale service worker/browser caches so next startup loads new build
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(
            WEB_PENDING_UPDATE_STORAGE_KEY,
            JSON.stringify({
              version: resolvedVersion,
              tag: resolvedTag,
              url: manifest.webUrl || DEFAULT_WEB_STUDIO_URL,
              detectedAt: Date.now(),
            })
          );
          if ('caches' in window) {
            const keys = await window.caches.keys().catch(() => [] as string[]);
            await Promise.all(keys.map((key) => window.caches.delete(key)));
          }
          await fetch('/', { cache: 'reload' }).catch(() => null);
        } catch {
          // Ignore browser cache API failures
        }
      }

      return setState({
        status: 'ready',
        latestVersion: resolvedVersion,
        latestTag: resolvedTag,
        versionMismatch: true,
        pendingOnNextStartup: true,
        downloadUrl: manifest.webUrl || DEFAULT_WEB_STUDIO_URL,
        silentSupported: true,
        lastCheckedAt: Date.now(),
        message: `v${resolvedVersion} ready · automatically active on next startup or refresh`,
      });
    } catch (err) {
      return setState({
        status: 'error',
        lastCheckedAt: Date.now(),
        message: err instanceof Error ? err.message : 'Background update check paused',
      });
    } finally {
      activeCheckPromise = null;
    }
  })();

  return activeCheckPromise;
}

export async function applyReadyUpdate(): Promise<ApplyUpdateResult | null> {
  if (currentState.status !== 'ready') return null;

  if (currentState.runtimeTarget === 'desktop' && currentState.stagedFilePath && isTauri()) {
    setState({
      status: 'applying',
      message: `Applying v${currentState.latestVersion || ''} silently…`,
    });
    try {
      const result = await invoke<ApplyUpdateResult>('apply_staged_update', {
        filePath: currentState.stagedFilePath,
      });
      setState({ message: result.message });
      return result;
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to launch silent update',
      });
      return null;
    }
  }

  if (currentState.downloadUrl) {
    if (currentState.runtimeTarget === 'web') {
      try {
        window.localStorage.removeItem(WEB_PENDING_UPDATE_STORAGE_KEY);
      } catch {
        // Ignore
      }
      window.location.reload();
      return {
        launched: true,
        silent: true,
        mode: 'web-reload',
        message: 'Reloading Web Studio to latest release.',
      };
    }
    openExternalDownloadUrl(currentState.downloadUrl);
    return {
      launched: true,
      silent: false,
      mode: 'android-apk-download',
      message: 'Opened signed APK installer download.',
    };
  }

  return null;
}

export async function dismissPendingUpdate(): Promise<void> {
  if (detectPlatform() === 'tauri' && isTauri()) {
    await invoke('clear_pending_update').catch(() => null);
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(WEB_PENDING_UPDATE_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
  setState({
    status: 'up-to-date',
    pendingOnNextStartup: false,
    stagedFilePath: null,
    message: null,
  });
}

export function startBackgroundUpdateMonitor(
  intervalMs: number = DEFAULT_UPDATE_POLL_INTERVAL_MS
): void {
  if (typeof window === 'undefined') return;
  if (initialCheckTimer || monitorTimer) return;

  void syncPendingUpdateOnStartup();

  // Wait 6 seconds after startup so UI & initial chats load with zero contention
  initialCheckTimer = setTimeout(() => {
    void checkAndStageBackgroundUpdate();
  }, 6000);

  // Periodically check GitHub release version vs version.json
  monitorTimer = setInterval(
    () => {
      void checkAndStageBackgroundUpdate();
    },
    Math.max(60_000, intervalMs)
  );
}

export function stopBackgroundUpdateMonitor(): void {
  if (initialCheckTimer) {
    clearTimeout(initialCheckTimer);
    initialCheckTimer = null;
  }
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}
