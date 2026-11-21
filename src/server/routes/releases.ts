import type { Express, Request, Response } from 'express';
import {
  DEFAULT_BACKEND_ORIGIN,
  DEFAULT_WEB_STUDIO_URL,
  GITHUB_MONOREPO_SLUG,
  GITHUB_PUBLIC_REPO_SLUG,
} from '../../config/platformEndpoints';
import {
  buildRollingAssetUrls,
  DEFAULT_RELEASE_MANIFEST,
  normalizeRemoteReleaseManifest,
  type ReleaseAssetEntry,
  type ReleaseManifest,
} from '../../config/releaseDownloads';

/**
 * Releases — `GET /api/releases/latest` (rolling manifest + GitHub REST fallback)
 *
 * WHY THIS FILE EXISTS
 *   Release manifest resolution (cache + 2-stage fetch + asset mapping) lived
 *   inline in `server.ts` (~200 lines). Cohesive (single cache, single
 *   mapping helper, no other consumer) and has no other consumer. Moving it
 *   keeps the monolith shrinking.
 *
 * CONTRACT WITH server.ts
 *   - `cachedReleaseManifest` and handler are OWNED here (no other route reads
 *     the cache).
 *   - Platform endpoint constants imported directly (pure values).
 */

export function registerReleasesRoutes(app: Express): void {
  let cachedReleaseManifest: { data: ReleaseManifest; fetchedAt: number } | null = null;

  app.get('/api/releases/latest', async (_req: Request, res: Response) => {
    if (cachedReleaseManifest && Date.now() - cachedReleaseManifest.fetchedAt < 3 * 60_000) {
      res.json(cachedReleaseManifest.data);
      return;
    }

    const reposToCheck = [GITHUB_PUBLIC_REPO_SLUG, GITHUB_MONOREPO_SLUG];

    // 1. Direct rolling manifest fetch bypasses GitHub API rate limits & prerelease skip
    for (const repoSlug of reposToCheck) {
      const manifestUrls = [
        `https://github.com/${repoSlug}/releases/download/latest/latest-release.json`,
        `https://github.com/${repoSlug}/releases/download/latest/latest-desktop.json`,
      ];
      for (const manifestUrl of manifestUrls) {
        try {
          const mfRes = await fetch(manifestUrl, {
            headers: { Accept: 'application/json', 'User-Agent': 'SupremeAI-Release-Resolver' },
            signal: AbortSignal.timeout(4000),
          });
          if (!mfRes.ok) continue;
          const mf = await mfRes.json().catch(() => null);
          const normalized = normalizeRemoteReleaseManifest(mf, repoSlug);
          if (normalized) {
            cachedReleaseManifest = { data: normalized, fetchedAt: Date.now() };
            res.json(normalized);
            return;
          }
        } catch {
          // Try next manifest candidate
        }
      }
    }

    // 2. Fallback to GitHub REST API (checking rolling 'tags/latest' before '/releases/latest')
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'SupremeAI-Release-Resolver',
    };
    if (process.env.GITHUB_READONLY_TOKEN?.trim()) {
      headers['Authorization'] = `Bearer ${process.env.GITHUB_READONLY_TOKEN.trim()}`;
    }

    for (const repoSlug of reposToCheck) {
      const endpoints = [
        `https://api.github.com/repos/${repoSlug}/releases/tags/latest`,
        `https://api.github.com/repos/${repoSlug}/releases/latest`,
      ];
      for (const apiUrl of endpoints) {
        try {
          const ghRes = await fetch(apiUrl, {
            headers,
            signal: AbortSignal.timeout(4500),
          });
          if (!ghRes.ok) continue;
          const release = (await ghRes.json().catch(() => null)) as any;
          const assets: any[] = Array.isArray(release?.assets) ? release.assets : [];

          const exeAsset = assets.find((a) => String(a?.name || '').endsWith('.exe'));
          const msiAsset = assets.find((a) => String(a?.name || '').endsWith('.msi'));
          const universalOrArm64Apk =
            assets.find(
              (a) =>
                String(a?.name || '').endsWith('.apk') &&
                /universal|arm64|aarch64/i.test(String(a?.name || ''))
            ) || assets.find((a) => String(a?.name || '').endsWith('.apk'));
          const armv7Apk = assets.find(
            (a) =>
              String(a?.name || '').endsWith('.apk') && /armv7|armeabi/i.test(String(a?.name || ''))
          );
          const vsixAsset = assets.find((a) => String(a?.name || '').endsWith('.vsix'));

          const manifestAsset =
            assets.find((a) => a?.name === 'latest-release.json') ||
            assets.find((a) => a?.name === 'latest-desktop.json');
          if (manifestAsset?.browser_download_url) {
            const mfRes = await fetch(manifestAsset.browser_download_url, {
              signal: AbortSignal.timeout(4000),
            }).catch(() => null);
            if (mfRes?.ok) {
              const mf = await mfRes.json().catch(() => null);
              const normalized = normalizeRemoteReleaseManifest(mf, repoSlug);
              if (normalized) {
                const merged: ReleaseManifest = {
                  ...normalized,
                  publishedAt: normalized.publishedAt || String(release.published_at || ''),
                  windowsExeUrl: String(exeAsset?.browser_download_url || normalized.windowsExeUrl),
                  windowsMsiUrl: String(msiAsset?.browser_download_url || normalized.windowsMsiUrl),
                  androidApkUrl: String(
                    universalOrArm64Apk?.browser_download_url || normalized.androidApkUrl
                  ),
                  ...(armv7Apk?.browser_download_url
                    ? { androidArmv7ApkUrl: String(armv7Apk.browser_download_url) }
                    : normalized.androidArmv7ApkUrl
                      ? { androidArmv7ApkUrl: normalized.androidArmv7ApkUrl }
                      : {}),
                  vscodeVsixUrl: String(
                    vsixAsset?.browser_download_url || normalized.vscodeVsixUrl
                  ),
                };
                cachedReleaseManifest = { data: merged, fetchedAt: Date.now() };
                res.json(merged);
                return;
              }
            }
          }

          if (exeAsset || universalOrArm64Apk || vsixAsset) {
            const tag = String(release.tag_name || 'latest');
            const version =
              tag !== 'latest' ? tag.replace(/^v/i, '') : DEFAULT_RELEASE_MANIFEST.version;
            const rollingUrls = buildRollingAssetUrls(version, repoSlug, tag);
            const mappedAssets: ReleaseAssetEntry[] = assets
              .filter((a) => /\.(exe|msi|apk|vsix)$/i.test(String(a?.name || '')))
              .map((a) => {
                const name = String(a.name);
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

            const resolved: ReleaseManifest = {
              version,
              tag,
              repo: repoSlug,
              publishedAt: String(release.published_at || ''),
              releasePageUrl: String(release.html_url || rollingUrls.releasePageUrl),
              webUrl: DEFAULT_WEB_STUDIO_URL,
              windowsExeUrl: String(exeAsset?.browser_download_url || rollingUrls.windowsExeUrl),
              windowsMsiUrl: String(msiAsset?.browser_download_url || rollingUrls.windowsMsiUrl),
              androidApkUrl: String(
                universalOrArm64Apk?.browser_download_url || rollingUrls.androidApkUrl
              ),
              ...(armv7Apk?.browser_download_url
                ? { androidArmv7ApkUrl: String(armv7Apk.browser_download_url) }
                : {}),
              vscodeVsixUrl: String(vsixAsset?.browser_download_url || rollingUrls.vscodeVsixUrl),
              provenance: 'live-github',
              assets: mappedAssets,
            };
            cachedReleaseManifest = { data: resolved, fetchedAt: Date.now() };
            res.json(resolved);
            return;
          }
        } catch {
          // Try next endpoint / repo slug
        }
      }
    }

    cachedReleaseManifest = { data: DEFAULT_RELEASE_MANIFEST, fetchedAt: Date.now() };
    res.json(DEFAULT_RELEASE_MANIFEST);
  });
}
