/**
 * Releases — `GET /api/releases/latest`
 *
 * আগে এই একই লজিক দুই জায়গায় প্রায় লাইন-বাই-লাইন কপি ছিল:
 *   - src/server/routes/releases.ts (Express)
 *   - functions/api/releases/latest.ts (Cloudflare)
 * এখন একটাই কপি, দুই রানটাইম থেকে চলে।
 *
 * ক্রম: (১) GitHub-এর rolling manifest সরাসরি (REST rate-limit এড়ায়) →
 *       (২) GitHub REST (`tags/latest` আগে, তারপর `/releases/latest`) →
 *       (৩) bundled DEFAULT_RELEASE_MANIFEST।
 * ফলাফল ৩ মিনিট মেমরিতে ক্যাশ হয় (isolate/process প্রতি) আর
 * `Cache-Control` হেডার দিয়ে CDN/ব্রাউজারেও।
 */

import { Hono } from 'hono';
import type { ApiDeps, ApiEnv } from '../app';
import { readEnv } from '../app';
import {
  buildRollingAssetUrls,
  DEFAULT_RELEASE_MANIFEST,
  normalizeRemoteReleaseManifest,
  type ReleaseAssetEntry,
  type ReleaseManifest,
} from '../../config/releaseDownloads';
import {
  DEFAULT_WEB_STUDIO_URL,
  GITHUB_MONOREPO_SLUG,
  GITHUB_PUBLIC_REPO_SLUG,
} from '../../config/platformEndpoints';

const CACHE_TTL_MS = 3 * 60_000;
const USER_AGENT = 'SupremeAI-Release-Resolver';

interface GitHubReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
}

interface GitHubRelease {
  tag_name?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

type FetchFn = typeof fetch;

function assetName(asset: GitHubReleaseAsset | undefined): string {
  return String(asset?.name || '');
}

function assetUrl(asset: GitHubReleaseAsset | undefined): string | undefined {
  const url = asset?.browser_download_url;
  return url ? String(url) : undefined;
}

async function fetchJson(
  fetchImpl: FetchFn,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<unknown | null> {
  try {
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

/** বাংলা মন্তব্য: ধাপ ১ — release asset হিসেবে প্রকাশিত rolling manifest সরাসরি পড়া। */
async function fetchDirectRollingManifest(
  fetchImpl: FetchFn,
  repoSlug: string
): Promise<ReleaseManifest | null> {
  const candidates = [
    `https://github.com/${repoSlug}/releases/download/latest/latest-release.json`,
    `https://github.com/${repoSlug}/releases/download/latest/latest-desktop.json`,
  ];
  for (const manifestUrl of candidates) {
    const raw = await fetchJson(
      fetchImpl,
      manifestUrl,
      { Accept: 'application/json', 'User-Agent': USER_AGENT },
      4000
    );
    const normalized = raw ? normalizeRemoteReleaseManifest(raw, repoSlug) : null;
    if (normalized) return normalized;
  }
  return null;
}

/** বাংলা মন্তব্য: ধাপ ২ — GitHub REST release থেকে manifest বানানো। */
async function resolveFromGitHubRelease(
  fetchImpl: FetchFn,
  repoSlug: string,
  release: GitHubRelease
): Promise<ReleaseManifest | null> {
  const assets: GitHubReleaseAsset[] = Array.isArray(release.assets)
    ? (release.assets as GitHubReleaseAsset[])
    : [];

  const exeAsset = assets.find((a) => assetName(a).endsWith('.exe'));
  const msiAsset = assets.find((a) => assetName(a).endsWith('.msi'));
  const universalOrArm64Apk =
    assets.find(
      (a) => assetName(a).endsWith('.apk') && /universal|arm64|aarch64/i.test(assetName(a))
    ) || assets.find((a) => assetName(a).endsWith('.apk'));
  const armv7Apk = assets.find(
    (a) => assetName(a).endsWith('.apk') && /armv7|armeabi/i.test(assetName(a))
  );
  const vsixAsset = assets.find((a) => assetName(a).endsWith('.vsix'));

  const manifestAsset =
    assets.find((a) => a?.name === 'latest-release.json') ||
    assets.find((a) => a?.name === 'latest-desktop.json');
  const manifestAssetUrl = assetUrl(manifestAsset);
  if (manifestAssetUrl) {
    const mf = await fetchJson(fetchImpl, manifestAssetUrl, { 'User-Agent': USER_AGENT }, 4000);
    const normalized = mf ? normalizeRemoteReleaseManifest(mf, repoSlug) : null;
    if (normalized) {
      const armv7Url = assetUrl(armv7Apk) || normalized.androidArmv7ApkUrl;
      return {
        ...normalized,
        publishedAt: normalized.publishedAt || String(release.published_at || ''),
        windowsExeUrl: assetUrl(exeAsset) || normalized.windowsExeUrl,
        windowsMsiUrl: assetUrl(msiAsset) || normalized.windowsMsiUrl,
        androidApkUrl: assetUrl(universalOrArm64Apk) || normalized.androidApkUrl,
        ...(armv7Url ? { androidArmv7ApkUrl: armv7Url } : {}),
        vscodeVsixUrl: assetUrl(vsixAsset) || normalized.vscodeVsixUrl,
      };
    }
  }

  if (!exeAsset && !universalOrArm64Apk && !vsixAsset) return null;

  const tag = String(release.tag_name || 'latest');
  const version = tag !== 'latest' ? tag.replace(/^v/i, '') : DEFAULT_RELEASE_MANIFEST.version;
  const rollingUrls = buildRollingAssetUrls(version, repoSlug, tag);
  const mappedAssets: ReleaseAssetEntry[] = assets
    .filter((a) => /\.(exe|msi|apk|vsix)$/i.test(assetName(a)))
    .map((a) => {
      const name = assetName(a);
      const platform: ReleaseAssetEntry['platform'] = name.endsWith('.exe')
        ? 'windows-exe'
        : name.endsWith('.msi')
          ? 'windows-msi'
          : name.endsWith('.vsix')
            ? 'vscode-vsix'
            : /armv7|armeabi/i.test(name)
              ? 'android-apk-armv7'
              : 'android-apk-arm64';
      return {
        platform,
        label: name,
        fileName: name,
        url: String(a.browser_download_url),
        sizeBytes: typeof a.size === 'number' ? a.size : undefined,
      };
    });

  const armv7Url = assetUrl(armv7Apk);
  return {
    version,
    tag,
    repo: repoSlug,
    publishedAt: String(release.published_at || ''),
    releasePageUrl: String(release.html_url || rollingUrls.releasePageUrl),
    webUrl: DEFAULT_WEB_STUDIO_URL,
    windowsExeUrl: assetUrl(exeAsset) || rollingUrls.windowsExeUrl,
    windowsMsiUrl: assetUrl(msiAsset) || rollingUrls.windowsMsiUrl,
    androidApkUrl: assetUrl(universalOrArm64Apk) || rollingUrls.androidApkUrl,
    ...(armv7Url ? { androidArmv7ApkUrl: armv7Url } : {}),
    vscodeVsixUrl: assetUrl(vsixAsset) || rollingUrls.vscodeVsixUrl,
    provenance: 'live-github',
    assets: mappedAssets,
  };
}

export async function resolveLatestRelease(
  fetchImpl: FetchFn,
  githubToken?: string
): Promise<{ manifest: ReleaseManifest; live: boolean }> {
  const reposToCheck = [GITHUB_PUBLIC_REPO_SLUG, GITHUB_MONOREPO_SLUG];

  for (const repoSlug of reposToCheck) {
    const direct = await fetchDirectRollingManifest(fetchImpl, repoSlug);
    if (direct) return { manifest: direct, live: true };
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
  };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

  for (const repoSlug of reposToCheck) {
    for (const apiUrl of [
      `https://api.github.com/repos/${repoSlug}/releases/tags/latest`,
      `https://api.github.com/repos/${repoSlug}/releases/latest`,
    ]) {
      const release = (await fetchJson(fetchImpl, apiUrl, headers, 4500)) as GitHubRelease | null;
      if (!release || typeof release !== 'object') continue;
      try {
        const resolved = await resolveFromGitHubRelease(fetchImpl, repoSlug, release);
        if (resolved) return { manifest: resolved, live: true };
      } catch {
        // বাংলা মন্তব্য: অপ্রত্যাশিত আকারের release — পরের endpoint/repo চেষ্টা
      }
    }
  }

  return { manifest: DEFAULT_RELEASE_MANIFEST, live: false };
}

export function createReleasesRoutes(deps: ApiDeps = {}): Hono<ApiEnv> {
  const routes = new Hono<ApiEnv>();
  const now = deps.now ?? (() => Date.now());
  let cached: { manifest: ReleaseManifest; live: boolean; fetchedAt: number } | null = null;

  routes.get('/api/releases/latest', async (c) => {
    if (!cached || now() - cached.fetchedAt >= CACHE_TTL_MS) {
      // বাংলা মন্তব্য: globalThis.fetch রিকোয়েস্টের সময় পড়া হয় (টেস্টে stub করা যায়)
      const fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init));
      const result = await resolveLatestRelease(fetchImpl, readEnv(c, 'GITHUB_READONLY_TOKEN'));
      cached = { ...result, fetchedAt: now() };
    }
    c.header('Cache-Control', `public, max-age=${cached.live ? 180 : 120}`);
    return c.json(cached.manifest);
  });

  return routes;
}
