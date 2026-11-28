import type { RuntimeTarget } from '../bridge/platform';
import {
  DEFAULT_WEB_STUDIO_URL,
  GITHUB_MONOREPO_SLUG,
  GITHUB_PUBLIC_REPO_SLUG,
} from './platformEndpoints';

export interface ReleaseAssetEntry {
  platform:
    | 'web'
    | 'windows-exe'
    | 'windows-msi'
    | 'android-apk-arm64'
    | 'android-apk-armv7'
    | 'vscode-vsix';
  label: string;
  fileName: string;
  url: string;
  sizeBytes?: number;
  sha256?: string;
}

export interface ReleaseManifest {
  version: string;
  tag: string;
  repo: string;
  publishedAt: string;
  releasePageUrl: string;
  webUrl: string;
  windowsExeUrl: string;
  windowsMsiUrl?: string;
  androidApkUrl: string;
  androidArmv7ApkUrl?: string;
  vscodeVsixUrl?: string;
  checksums?: {
    windowsExeSha256?: string;
    windowsMsiSha256?: string;
    androidApkSha256?: string;
    androidArmv7ApkSha256?: string;
    vscodeVsixSha256?: string;
  };
  provenance: 'live-github' | 'manifest' | 'fallback';
  assets: ReleaseAssetEntry[];
}

export interface DownloadShortcut {
  id: 'web' | 'android-apk' | 'windows-exe' | 'vscode-vsix' | 'release-page';
  targetPlatform: 'web' | 'android' | 'windows' | 'vscode' | 'releases';
  label: string;
  badge: string;
  description: string;
  url: string;
  isDirectDownload: boolean;
}

const MONOREPO_RELEASES_BASE = `https://github.com/${GITHUB_MONOREPO_SLUG}/releases`;

export function buildRollingAssetUrls(
  version: string,
  repoSlug: string = GITHUB_PUBLIC_REPO_SLUG,
  tag: string = 'latest'
) {
  const cleanVersion = version.replace(/^v/i, '').trim() || '2.5.0';
  const base = `https://github.com/${repoSlug}/releases`;
  const downloadBase = `${base}/download/${encodeURIComponent(tag)}`;
  return {
    releasePageUrl: `${base}/tag/${encodeURIComponent(tag)}`,
    windowsExeUrl: `${downloadBase}/SupremeAI.Desktop_${cleanVersion}_x64-setup.exe`,
    windowsMsiUrl: `${downloadBase}/SupremeAI.Desktop_${cleanVersion}_x64_en-US.msi`,
    androidApkUrl: `${downloadBase}/SupremeAI-Studio-app-universal-release.apk`,
    vscodeVsixUrl: `${downloadBase}/supremeai-vscode-${cleanVersion}.vsix`,
  };
}

const DEFAULT_URLS = buildRollingAssetUrls('2.5.0', GITHUB_PUBLIC_REPO_SLUG, 'latest');

export const DEFAULT_RELEASE_MANIFEST: ReleaseManifest = {
  version: '2.5.0',
  tag: 'latest',
  repo: GITHUB_PUBLIC_REPO_SLUG,
  publishedAt: '',
  releasePageUrl: DEFAULT_URLS.releasePageUrl,
  webUrl: DEFAULT_WEB_STUDIO_URL,
  windowsExeUrl: DEFAULT_URLS.windowsExeUrl,
  windowsMsiUrl: DEFAULT_URLS.windowsMsiUrl,
  androidApkUrl: DEFAULT_URLS.androidApkUrl,
  vscodeVsixUrl: DEFAULT_URLS.vscodeVsixUrl,
  provenance: 'fallback',
  assets: [
    {
      platform: 'android-apk-arm64',
      label: 'Android APK (Universal)',
      fileName: 'SupremeAI-Studio-app-universal-release.apk',
      url: DEFAULT_URLS.androidApkUrl,
    },
    {
      platform: 'windows-exe',
      label: 'Windows Installer (.exe)',
      fileName: 'SupremeAI.Desktop_2.5.0_x64-setup.exe',
      url: DEFAULT_URLS.windowsExeUrl,
    },
    {
      platform: 'windows-msi',
      label: 'Windows MSI (.msi)',
      fileName: 'SupremeAI.Desktop_2.5.0_x64_en-US.msi',
      url: DEFAULT_URLS.windowsMsiUrl,
    },
    {
      platform: 'vscode-vsix',
      label: 'VS Code Extension (.vsix)',
      fileName: 'supremeai-vscode-2.5.0.vsix',
      url: DEFAULT_URLS.vscodeVsixUrl,
    },
  ],
};

export const ALTERNATE_MONOREPO_RELEASES_URL = `${MONOREPO_RELEASES_BASE}/tag/latest`;

/**
 * Compares two semver strings (e.g. "2.5.1" vs "2.5.0").
 * Returns > 0 if a > b, < 0 if a < b, 0 if equal.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (value: string): [number, number, number] => {
    const cleaned = value.trim().replace(/^v/i, '').split('-')[0] || '0.0.0';
    const [major = 0, minor = 0, patch = 0] = cleaned
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
    return [major, minor, patch];
  };
  const [ma, mia, pa] = parse(a);
  const [mb, mib, pb] = parse(b);
  if (ma !== mb) return ma - mb;
  if (mia !== mib) return mia - mib;
  return pa - pb;
}

/**
 * Normalizes a fetched latest-release.json / latest-desktop.json payload,
 * ensuring APK, EXE, and VSIX URLs always resolve cleanly to valid rolling assets
 * even when an older manifest only declared Windows URLs.
 */
export function normalizeRemoteReleaseManifest(
  raw: unknown,
  repoSlug: string = GITHUB_PUBLIC_REPO_SLUG
): ReleaseManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const mf = raw as Record<string, unknown>;
  if (!mf.version) return null;

  const version = String(mf.version).replace(/^v/i, '').trim() || DEFAULT_RELEASE_MANIFEST.version;
  const tag = String(mf.tag || 'latest').trim() || 'latest';
  const resolvedRepo = String(mf.repo || repoSlug || GITHUB_PUBLIC_REPO_SLUG).trim();
  const rollingUrls = buildRollingAssetUrls(version, resolvedRepo, tag);

  const downloads = (
    mf.downloads && typeof mf.downloads === 'object' ? mf.downloads : {}
  ) as {
    windowsExeUrl?: string;
    windowsMsiUrl?: string;
    androidApkUrl?: string;
    androidArmv7ApkUrl?: string;
    vscodeVsixUrl?: string;
    releasePageUrl?: string;
    webUrl?: string;
    checksums?: Record<string, string | undefined>;
  };
  const platforms = (
    mf.platforms && typeof mf.platforms === 'object' ? mf.platforms : {}
  ) as Record<string, { url?: string; sha256?: string } | undefined>;

  const windowsExeUrl = String(
    downloads.windowsExeUrl || platforms['windows-x86_64']?.url || rollingUrls.windowsExeUrl
  );
  const windowsMsiUrl = String(
    downloads.windowsMsiUrl || platforms['windows-msi']?.url || rollingUrls.windowsMsiUrl
  );
  const androidApkUrl = String(
    downloads.androidApkUrl ||
      platforms['android-arm64']?.url ||
      platforms['android-apk']?.url ||
      rollingUrls.androidApkUrl
  );
  const androidArmv7ApkUrl = downloads.androidArmv7ApkUrl
    ? String(downloads.androidArmv7ApkUrl)
    : platforms['android-armv7']?.url
      ? String(platforms['android-armv7'].url)
      : undefined;
  const vscodeVsixUrl = String(
    downloads.vscodeVsixUrl || platforms['vscode-vsix']?.url || rollingUrls.vscodeVsixUrl
  );

  const rawReleasePageUrl = String(downloads.releasePageUrl || '');
  const releasePageUrl =
    rawReleasePageUrl && !/\/releases\/latest\/?$/i.test(rawReleasePageUrl)
      ? rawReleasePageUrl
      : rollingUrls.releasePageUrl;

  const checksums = {
    windowsExeSha256:
      (typeof downloads.checksums?.windowsExeSha256 === 'string' &&
        downloads.checksums.windowsExeSha256) ||
      (typeof platforms['windows-x86_64']?.sha256 === 'string'
        ? platforms['windows-x86_64'].sha256
        : undefined),
    windowsMsiSha256:
      (typeof downloads.checksums?.windowsMsiSha256 === 'string' &&
        downloads.checksums.windowsMsiSha256) ||
      (typeof platforms['windows-msi']?.sha256 === 'string'
        ? platforms['windows-msi'].sha256
        : undefined),
    androidApkSha256:
      (typeof downloads.checksums?.androidApkSha256 === 'string' &&
        downloads.checksums.androidApkSha256) ||
      (typeof platforms['android-arm64']?.sha256 === 'string'
        ? platforms['android-arm64'].sha256
        : typeof platforms['android-apk']?.sha256 === 'string'
          ? platforms['android-apk'].sha256
          : undefined),
    androidArmv7ApkSha256:
      (typeof downloads.checksums?.androidArmv7ApkSha256 === 'string' &&
        downloads.checksums.androidArmv7ApkSha256) ||
      (typeof platforms['android-armv7']?.sha256 === 'string'
        ? platforms['android-armv7'].sha256
        : undefined),
    vscodeVsixSha256:
      (typeof downloads.checksums?.vscodeVsixSha256 === 'string' &&
        downloads.checksums.vscodeVsixSha256) ||
      (typeof platforms['vscode-vsix']?.sha256 === 'string'
        ? platforms['vscode-vsix'].sha256
        : undefined),
  };

  return {
    version,
    tag,
    repo: resolvedRepo,
    publishedAt: String(mf.pub_date || ''),
    releasePageUrl,
    webUrl: String(downloads.webUrl || DEFAULT_WEB_STUDIO_URL),
    windowsExeUrl,
    windowsMsiUrl,
    androidApkUrl,
    ...(androidArmv7ApkUrl ? { androidArmv7ApkUrl } : {}),
    vscodeVsixUrl,
    checksums,
    provenance: 'manifest',
    assets: [
      {
        platform: 'android-apk-arm64',
        label: 'Android APK (Universal)',
        fileName: androidApkUrl.split('/').pop() || 'SupremeAI-Studio-app-universal-release.apk',
        url: androidApkUrl,
        ...(checksums.androidApkSha256 ? { sha256: checksums.androidApkSha256 } : {}),
      },
      {
        platform: 'windows-exe',
        label: 'Windows Installer (.exe)',
        fileName: windowsExeUrl.split('/').pop() || `SupremeAI.Desktop_${version}_x64-setup.exe`,
        url: windowsExeUrl,
        ...(checksums.windowsExeSha256 ? { sha256: checksums.windowsExeSha256 } : {}),
      },
      {
        platform: 'windows-msi',
        label: 'Windows MSI (.msi)',
        fileName: windowsMsiUrl.split('/').pop() || `SupremeAI.Desktop_${version}_x64_en-US.msi`,
        url: windowsMsiUrl,
        ...(checksums.windowsMsiSha256 ? { sha256: checksums.windowsMsiSha256 } : {}),
      },
      {
        platform: 'vscode-vsix',
        label: 'VS Code Extension (.vsix)',
        fileName: vscodeVsixUrl.split('/').pop() || `supremeai-vscode-${version}.vsix`,
        url: vscodeVsixUrl,
        ...(checksums.vscodeVsixSha256 ? { sha256: checksums.vscodeVsixSha256 } : {}),
      },
    ],
  };
}

/**
 * Returns cross-platform shortcut links tailored for each runtime:
 *  - Web: Android (.apk) + Windows (.exe) + VS Code (.vsix)
 *  - Android APK: Web URL + Windows (.exe) + VS Code (.vsix)
 *  - Desktop EXE: Web URL + Android (.apk) + VS Code (.vsix)
 *  - Extension: Web URL + Android (.apk) + Windows (.exe)
 */
export function buildCounterpartShortcuts(
  runtimeTarget: RuntimeTarget,
  manifest: ReleaseManifest = DEFAULT_RELEASE_MANIFEST
): DownloadShortcut[] {
  const webShortcut: DownloadShortcut = {
    id: 'web',
    targetPlatform: 'web',
    label: 'Open Web Studio',
    badge: 'WEB',
    description: manifest.webUrl.replace(/^https?:\/\//, ''),
    url: manifest.webUrl || DEFAULT_WEB_STUDIO_URL,
    isDirectDownload: false,
  };

  const apkShortcut: DownloadShortcut = {
    id: 'android-apk',
    targetPlatform: 'android',
    label: 'Android APK',
    badge: '.APK',
    description: `v${manifest.version} · Universal APK`,
    url: manifest.androidApkUrl || DEFAULT_RELEASE_MANIFEST.androidApkUrl,
    isDirectDownload: true,
  };

  const exeShortcut: DownloadShortcut = {
    id: 'windows-exe',
    targetPlatform: 'windows',
    label: 'Windows App',
    badge: '.EXE',
    description: `v${manifest.version} · x64 NSIS setup`,
    url: manifest.windowsExeUrl || DEFAULT_RELEASE_MANIFEST.windowsExeUrl,
    isDirectDownload: true,
  };

  const vsixShortcut: DownloadShortcut = {
    id: 'vscode-vsix',
    targetPlatform: 'vscode',
    label: 'VS Code Extension',
    badge: '.VSIX',
    description: `v${manifest.version} · IDE sidebar`,
    url: manifest.vscodeVsixUrl || DEFAULT_RELEASE_MANIFEST.vscodeVsixUrl || '',
    isDirectDownload: true,
  };

  if (runtimeTarget === 'android') {
    return [webShortcut, exeShortcut, vsixShortcut];
  }

  if (runtimeTarget === 'desktop') {
    return [webShortcut, apkShortcut, vsixShortcut];
  }

  if (runtimeTarget === 'extension') {
    return [webShortcut, apkShortcut, exeShortcut];
  }

  return [apkShortcut, exeShortcut, vsixShortcut];
}
