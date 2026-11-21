import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MCP_TOWER_ORIGIN,
  DEFAULT_WEB_STUDIO_URL,
  GITHUB_MONOREPO_SLUG,
  GITHUB_PUBLIC_REPO_SLUG,
  resolveMcpRpcCandidates,
} from './platformEndpoints';
import {
  buildCounterpartShortcuts,
  compareSemver,
  DEFAULT_RELEASE_MANIFEST,
  normalizeRemoteReleaseManifest,
} from './releaseDownloads';

describe('platformEndpoints SSOT & MCP Tower candidates', () => {
  it('points to live MCP Tower and authoritative GitHub repositories', () => {
    expect(DEFAULT_MCP_TOWER_ORIGIN).toBe('https://supremeai-mcp-tower-live.onrender.com');
    expect(GITHUB_MONOREPO_SLUG).toBe('Supremeai-bd/supremeai');
    expect(GITHUB_PUBLIC_REPO_SLUG).toBe('Supremeai-bd/supremeai-public');
  });

  it('resolves both /agents/federated_bridge_agent/mcp and /mcp JSON-RPC candidates', () => {
    expect(resolveMcpRpcCandidates('https://supremeai-mcp-tower-live.onrender.com/mcp')).toEqual([
      'https://supremeai-mcp-tower-live.onrender.com/agents/federated_bridge_agent/mcp',
      'https://supremeai-mcp-tower-live.onrender.com/mcp',
    ]);

    expect(
      resolveMcpRpcCandidates(
        'https://supremeai-mcp-tower-live.onrender.com/agents/federated_bridge_agent/mcp'
      )
    ).toEqual([
      'https://supremeai-mcp-tower-live.onrender.com/agents/federated_bridge_agent/mcp',
      'https://supremeai-mcp-tower-live.onrender.com/mcp',
    ]);
  });
});

describe('cross-platform download & counterpart shortcuts', () => {
  it('points default rolling URLs to /releases/tag/latest and exact GitHub asset filenames', () => {
    expect(DEFAULT_RELEASE_MANIFEST.releasePageUrl).toBe(
      'https://github.com/Supremeai-bd/supremeai-public/releases/tag/latest'
    );
    expect(DEFAULT_RELEASE_MANIFEST.windowsExeUrl).toBe(
      'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/SupremeAI.Desktop_2.5.0_x64-setup.exe'
    );
    expect(DEFAULT_RELEASE_MANIFEST.androidApkUrl).toBe(
      'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/SupremeAI-Studio-app-universal-release.apk'
    );
    expect(DEFAULT_RELEASE_MANIFEST.vscodeVsixUrl).toBe(
      'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/supremeai-vscode-2.5.0.vsix'
    );
  });

  it('returns APK, EXE, and VSIX download shortcuts when running on Web', () => {
    const shortcuts = buildCounterpartShortcuts('web', DEFAULT_RELEASE_MANIFEST);
    expect(shortcuts.map((s) => s.id)).toEqual(['android-apk', 'windows-exe', 'vscode-vsix']);
    expect(shortcuts[0].url).toMatch(/\.apk$/);
    expect(shortcuts[1].url).toMatch(/\.exe$/);
    expect(shortcuts[2].url).toMatch(/\.vsix$/);
    expect(shortcuts.every((s) => s.isDirectDownload)).toBe(true);
  });

  it('returns Web URL, Windows EXE, and VS Code VSIX shortcuts when running inside Android APK', () => {
    const shortcuts = buildCounterpartShortcuts('android', DEFAULT_RELEASE_MANIFEST);
    expect(shortcuts.map((s) => s.id)).toEqual(['web', 'windows-exe', 'vscode-vsix']);
    expect(shortcuts[0].url).toBe(DEFAULT_WEB_STUDIO_URL);
    expect(shortcuts[0].isDirectDownload).toBe(false);
    expect(shortcuts[1].url).toMatch(/\.exe$/);
    expect(shortcuts[2].url).toMatch(/\.vsix$/);
  });

  it('returns Web URL, Android APK, and VS Code VSIX shortcuts when running inside Desktop EXE', () => {
    const shortcuts = buildCounterpartShortcuts('desktop', DEFAULT_RELEASE_MANIFEST);
    expect(shortcuts.map((s) => s.id)).toEqual(['web', 'android-apk', 'vscode-vsix']);
    expect(shortcuts[0].url).toBe(DEFAULT_WEB_STUDIO_URL);
    expect(shortcuts[0].isDirectDownload).toBe(false);
    expect(shortcuts[1].url).toMatch(/\.apk$/);
    expect(shortcuts[2].url).toMatch(/\.vsix$/);
  });

  it('returns Web URL, Android APK, and Windows EXE shortcuts inside VS Code extension', () => {
    const shortcuts = buildCounterpartShortcuts('extension', DEFAULT_RELEASE_MANIFEST);
    expect(shortcuts.map((s) => s.id)).toEqual(['web', 'android-apk', 'windows-exe']);
    expect(shortcuts[0].url).toBe(DEFAULT_WEB_STUDIO_URL);
    expect(shortcuts[1].url).toMatch(/\.apk$/);
    expect(shortcuts[2].url).toMatch(/\.exe$/);
  });

  it('normalizes legacy Windows-only manifests with universal APK & VSIX rolling URLs', () => {
    const normalized = normalizeRemoteReleaseManifest(
      {
        version: '2.5.0',
        notes: 'Desktop release',
        platforms: {
          'windows-x86_64': {
            url: 'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/SupremeAI.Desktop_2.5.0_x64-setup.exe',
          },
        },
      },
      GITHUB_PUBLIC_REPO_SLUG
    );

    expect(normalized).not.toBeNull();
    expect(normalized?.windowsExeUrl).toContain('SupremeAI.Desktop_2.5.0_x64-setup.exe');
    expect(normalized?.androidApkUrl).toBe(
      'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/SupremeAI-Studio-app-universal-release.apk'
    );
    expect(normalized?.vscodeVsixUrl).toBe(
      'https://github.com/Supremeai-bd/supremeai-public/releases/download/latest/supremeai-vscode-2.5.0.vsix'
    );
  });

  it('extracts SHA-256 checksums from downloads.checksums and platform metadata', () => {
    const winHash = 'a'.repeat(64);
    const apkHash = 'b'.repeat(64);
    const vsixHash = 'c'.repeat(64);

    const fromDownloads = normalizeRemoteReleaseManifest(
      {
        version: '2.5.1',
        tag: 'v2.5.1',
        downloads: {
          checksums: {
            windowsExeSha256: winHash,
            androidApkSha256: apkHash,
            vscodeVsixSha256: vsixHash,
          },
        },
      },
      GITHUB_PUBLIC_REPO_SLUG
    );

    expect(fromDownloads?.checksums?.windowsExeSha256).toBe(winHash);
    expect(fromDownloads?.checksums?.androidApkSha256).toBe(apkHash);
    expect(fromDownloads?.checksums?.vscodeVsixSha256).toBe(vsixHash);
    expect(fromDownloads?.assets.find((a) => a.platform === 'windows-exe')?.sha256).toBe(winHash);
    expect(fromDownloads?.assets.find((a) => a.platform === 'android-apk-arm64')?.sha256).toBe(
      apkHash
    );

    const fromPlatforms = normalizeRemoteReleaseManifest(
      {
        version: '2.5.1',
        platforms: {
          'windows-x86_64': {
            url: 'https://github.com/Supremeai-bd/supremeai-public/releases/download/v2.5.1/SupremeAI.Desktop_2.5.1_x64-setup.exe',
            sha256: winHash,
          },
          'android-arm64': {
            url: 'https://github.com/Supremeai-bd/supremeai-public/releases/download/v2.5.1/SupremeAI-Studio-app-universal-release.apk',
            sha256: apkHash,
          },
        },
      },
      GITHUB_PUBLIC_REPO_SLUG
    );

    expect(fromPlatforms?.checksums?.windowsExeSha256).toBe(winHash);
    expect(fromPlatforms?.checksums?.androidApkSha256).toBe(apkHash);
  });

  it('compares semver strings accurately across v-prefix and multi-digit patches', () => {
    expect(compareSemver('2.5.1', '2.5.0')).toBeGreaterThan(0);
    expect(compareSemver('v2.6.0', '2.5.9')).toBeGreaterThan(0);
    expect(compareSemver('v2.5.0', '2.5.0')).toBe(0);
    expect(compareSemver('2.4.9', '2.5.0')).toBeLessThan(0);
  });
});
