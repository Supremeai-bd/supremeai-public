import {
  PagesContext,
  handleCorsPreflight,
  jsonEdgeResponse,
  fetchWithTimeout,
} from '../../_lib/edgeHelpers';
import {
  buildRollingAssetUrls,
  DEFAULT_RELEASE_MANIFEST,
  normalizeRemoteReleaseManifest,
  type ReleaseAssetEntry,
  type ReleaseManifest,
} from '../../../src/config/releaseDownloads';
import {
  DEFAULT_WEB_STUDIO_URL,
  GITHUB_MONOREPO_SLUG,
  GITHUB_PUBLIC_REPO_SLUG,
} from '../../../src/config/platformEndpoints';

async function fetchDirectRollingManifest(repoSlug: string): Promise<ReleaseManifest | null> {
  const candidates = [
    `https://github.com/${repoSlug}/releases/download/latest/latest-release.json`,
    `https://github.com/${repoSlug}/releases/download/latest/latest-desktop.json`,
  ];
  for (const manifestUrl of candidates) {
    try {
      const res = await fetchWithTimeout(
        manifestUrl,
        {
          headers: { Accept: 'application/json', 'User-Agent': 'SupremeAI-Edge-Release-Resolver' },
        },
        4000
      );
      if (!res.ok) continue;
      const raw = await res.json().catch(() => null);
      const normalized = normalizeRemoteReleaseManifest(raw, repoSlug);
      if (normalized) return normalized;
    } catch {
      // Try next candidate
    }
  }
  return null;
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);

  const reposToCheck = [GITHUB_PUBLIC_REPO_SLUG, GITHUB_MONOREPO_SLUG];

  // 1. Direct rolling manifest fetch bypasses unauthenticated GitHub REST API rate limits
  for (const repoSlug of reposToCheck) {
    const direct = await fetchDirectRollingManifest(repoSlug);
    if (direct) {
      return jsonEdgeResponse(
        direct,
        200,
        request,
        { 'Cache-Control': 'public, max-age=180' },
        env
      );
    }
  }

  // 2. Fallback to GitHub REST API (checking rolling 'tags/latest' BEFORE '/releases/latest')
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SupremeAI-Edge-Release-Resolver',
  };
  if (env?.GITHUB_READONLY_TOKEN?.trim()) {
    headers['Authorization'] = `Bearer ${env.GITHUB_READONLY_TOKEN.trim()}`;
  }

  for (const repoSlug of reposToCheck) {
    const endpoints = [
      `https://api.github.com/repos/${repoSlug}/releases/tags/latest`,
      `https://api.github.com/repos/${repoSlug}/releases/latest`,
    ];
    for (const apiUrl of endpoints) {
      try {
        const ghRes = await fetchWithTimeout(apiUrl, { headers }, 4500);
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
          const mfRes = await fetchWithTimeout(manifestAsset.browser_download_url, {}, 4000).catch(
            () => null
          );
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
                vscodeVsixUrl: String(vsixAsset?.browser_download_url || normalized.vscodeVsixUrl),
              };
              return jsonEdgeResponse(
                merged,
                200,
                request,
                { 'Cache-Control': 'public, max-age=180' },
                env
              );
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

          return jsonEdgeResponse(
            {
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
            },
            200,
            request,
            { 'Cache-Control': 'public, max-age=180' },
            env
          );
        }
      } catch {
        // Try next endpoint / repo slug
      }
    }
  }

  return jsonEdgeResponse(
    DEFAULT_RELEASE_MANIFEST,
    200,
    request,
    { 'Cache-Control': 'public, max-age=120' },
    env
  );
}
