import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(() => false),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: any[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

import clientVersionJson from '../../version.json';
import { useAutoUpdater } from '../hooks/useAutoUpdater';
import {
  applyReadyUpdate,
  checkAndStageBackgroundUpdate,
  CLIENT_VERSION_INFO,
  getUpdateState,
  resetUpdateStateForTest,
  resolveReleaseVersionMismatch,
  syncPendingUpdateOnStartup,
} from './appAutoUpdater';

describe('appAutoUpdater & useAutoUpdater hook', () => {
  afterEach(() => {
    resetUpdateStateForTest();
    invokeMock.mockReset();
    isTauriMock.mockReturnValue(false);
    window.localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reads current client version cleanly from repo version.json', () => {
    expect(CLIENT_VERSION_INFO.version).toBe(clientVersionJson.version);
    expect(CLIENT_VERSION_INFO.releaseTag).toBe(`v${clientVersionJson.version}`);
  });

  it('detects version mismatch between version.json and GitHub release tag or manifest version', () => {
    expect(resolveReleaseVersionMismatch('2.5.0', { version: '2.5.0', tag: 'latest' })).toEqual({
      mismatch: false,
      resolvedVersion: '2.5.0',
      resolvedTag: 'latest',
    });

    expect(resolveReleaseVersionMismatch('2.5.0', { version: '2.5.0', tag: 'v2.6.0' })).toEqual({
      mismatch: true,
      resolvedVersion: '2.6.0',
      resolvedTag: 'v2.6.0',
    });
  });

  it('stays up-to-date when GitHub release matches version.json', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          version: clientVersionJson.version,
          tag: 'latest',
          repo: 'Supremeai-bd/supremeai-public',
          publishedAt: '2026-11-19T00:00:00Z',
          releasePageUrl: 'https://github.com/Supremeai-bd/supremeai-public/releases/tag/latest',
          webUrl: 'https://supremeai-studio.pages.dev',
          windowsExeUrl:
            'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/SupremeAI.Desktop_2.5.0_x64-setup.exe',
          androidApkUrl:
            'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/SupremeAI-Studio-app-universal-release.apk',
          vscodeVsixUrl:
            'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/supremeai-vscode-2.5.0.vsix',
          provenance: 'manifest',
          assets: [],
        }),
        { status: 200 }
      )
    );

    const state = await checkAndStageBackgroundUpdate(true);
    expect(state.status).toBe('up-to-date');
    expect(state.versionMismatch).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('stages Windows NSIS installer on mismatch so next startup applies it silently', async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'get_app_runtime_info') {
        return {
          version: '2.5.0',
          os: 'windows',
          arch: 'x86_64',
          isWindows: true,
          isAndroid: false,
        };
      }
      if (command === 'get_pending_update') {
        return null;
      }
      if (command === 'stage_silent_update') {
        return {
          filePath:
            'C:\\Users\\Test\\AppData\\Local\\com.supremeai.desktop\\updates\\SupremeAI.Desktop_2.6.0_x64-setup.exe',
          fileName: 'SupremeAI.Desktop_2.6.0_x64-setup.exe',
          version: '2.6.0',
          sizeBytes: 42_000_000,
          alreadyCached: false,
          pendingOnNextStartup: true,
        };
      }
      if (command === 'apply_staged_update') {
        return {
          launched: true,
          silent: true,
          mode: 'nsis-silent',
          message: 'Applying cached silent update now.',
        };
      }
      return null;
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          version: '2.6.0',
          tag: 'v2.6.0',
          repo: 'Supremeai-bd/supremeai-public',
          publishedAt: '2026-11-20T00:00:00Z',
          releasePageUrl: 'https://github.com/Supremeai-bd/supremeai-public/releases/tag/v2.6.0',
          webUrl: 'https://supremeai-studio.pages.dev',
          windowsExeUrl:
            'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/SupremeAI.Desktop_2.6.0_x64-setup.exe',
          androidApkUrl:
            'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/SupremeAI-Studio-app-universal-release.apk',
          vscodeVsixUrl:
            'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/supremeai-vscode-2.6.0.vsix',
          provenance: 'manifest',
          assets: [],
        }),
        { status: 200 }
      )
    );

    const state = await checkAndStageBackgroundUpdate(true);
    expect(state.status).toBe('ready');
    expect(state.versionMismatch).toBe(true);
    expect(state.pendingOnNextStartup).toBe(true);
    expect(state.silentSupported).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('stage_silent_update', {
      url: 'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/SupremeAI.Desktop_2.6.0_x64-setup.exe',
      fileName: 'SupremeAI.Desktop_2.6.0_x64-setup.exe',
      version: '2.6.0',
      tag: 'v2.6.0',
      expectedSha256: null,
    });

    const applied = await applyReadyUpdate();
    expect(applied?.launched).toBe(true);
    expect(applied?.silent).toBe(true);
    expect(getUpdateState().status).toBe('applying');
  });

  it('forwards manifest SHA-256 checksum to native stage_silent_update when present', async () => {
    isTauriMock.mockReturnValue(true);
    const mockSha = 'a'.repeat(64);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'get_app_runtime_info') {
        return {
          version: '2.5.0',
          os: 'windows',
          arch: 'x86_64',
          isWindows: true,
          isAndroid: false,
        };
      }
      if (command === 'stage_silent_update') {
        return {
          filePath: 'C:\\updates\\SupremeAI.Desktop_2.6.0_x64-setup.exe',
          fileName: 'SupremeAI.Desktop_2.6.0_x64-setup.exe',
          version: '2.6.0',
          sizeBytes: 42_000_000,
          alreadyCached: false,
          pendingOnNextStartup: true,
          sha256: mockSha,
        };
      }
      return null;
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          version: '2.6.0',
          tag: 'v2.6.0',
          repo: 'Supremeai-bd/supremeai-public',
          publishedAt: '2026-11-20T00:00:00Z',
          releasePageUrl: 'https://github.com/Supremeai-bd/supremeai-public/releases/tag/v2.6.0',
          webUrl: 'https://supremeai-studio.pages.dev',
          windowsExeUrl:
            'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/SupremeAI.Desktop_2.6.0_x64-setup.exe',
          androidApkUrl:
            'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/SupremeAI-Studio-app-universal-release.apk',
          vscodeVsixUrl:
            'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/supremeai-vscode-2.6.0.vsix',
          checksums: {
            windowsExeSha256: mockSha,
          },
          provenance: 'manifest',
          assets: [],
        }),
        { status: 200 }
      )
    );

    const state = await checkAndStageBackgroundUpdate(true);
    expect(state.status).toBe('ready');
    expect(invokeMock).toHaveBeenCalledWith('stage_silent_update', {
      url: 'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/SupremeAI.Desktop_2.6.0_x64-setup.exe',
      fileName: 'SupremeAI.Desktop_2.6.0_x64-setup.exe',
      version: '2.6.0',
      tag: 'v2.6.0',
      expectedSha256: mockSha,
    });
  });

  it('restores pending update on next startup when staged on device', async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'get_app_runtime_info') {
        return {
          version: '2.5.0',
          os: 'android',
          arch: 'aarch64',
          isWindows: false,
          isAndroid: true,
        };
      }
      if (command === 'get_pending_update') {
        return {
          version: '2.6.0',
          tag: 'v2.6.0',
          filePath:
            '/data/user/0/com.supremeai.desktop/cache/updates/SupremeAI-Studio-app-universal-release.apk',
          fileName: 'SupremeAI-Studio-app-universal-release.apk',
          url: 'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/SupremeAI-Studio-app-universal-release.apk',
          stagedAt: '1763549000',
        };
      }
      return null;
    });

    const restored = await syncPendingUpdateOnStartup();
    expect(restored.status).toBe('ready');
    expect(restored.pendingOnNextStartup).toBe(true);
    expect(restored.latestVersion).toBe('2.6.0');
  });

  it('mounts useAutoUpdater hook, triggers periodic checks against version.json, and persists web mismatch', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            version: '2.6.0',
            tag: 'v2.6.0',
            repo: 'Supremeai-bd/supremeai-public',
            publishedAt: '2026-11-20T00:00:00Z',
            releasePageUrl: 'https://github.com/Supremeai-bd/supremeai-public/releases/tag/v2.6.0',
            webUrl: 'https://supremeai-studio.pages.dev',
            windowsExeUrl:
              'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/SupremeAI.Desktop_2.6.0_x64-setup.exe',
            androidApkUrl:
              'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/SupremeAI-Studio-app-universal-release.apk',
            vscodeVsixUrl:
              'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/supremeai-vscode-2.6.0.vsix',
            provenance: 'manifest',
            assets: [],
          }),
          { status: 200 }
        )
    );

    const { result, unmount } = renderHook(() => useAutoUpdater({ intervalMs: 120_000 }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_500);
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.versionMismatch).toBe(true);
    expect(result.current.pendingOnNextStartup).toBe(true);
    expect(result.current.latestVersion).toBe('2.6.0');
    expect(window.localStorage.getItem('supremeai_pending_web_update_v1')).toContain('"2.6.0"');

    const callCountAfterStartup = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callCountAfterStartup);

    unmount();
  });
});
