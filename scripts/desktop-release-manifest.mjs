import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const { GITHUB_REPOSITORY, RELEASE_TAG, WEB_STUDIO_URL } = process.env;
if (!GITHUB_REPOSITORY || !['latest', `v${version}`].includes(RELEASE_TAG)) {
  throw new Error(
    'Expected GITHUB_REPOSITORY and a RELEASE_TAG matching package.json (or latest).'
  );
}

const normalizeAndRename = (dir, relativePath) => {
  const full = join(dir, relativePath);
  const cleanName = basename(full).replace(/[^a-zA-Z0-9_@+.-]/g, '.');
  const target = join(dirname(full), cleanName);
  if (basename(full) !== cleanName) {
    renameSync(full, target);
  }
  const sha256 = createHash('sha256').update(readFileSync(target)).digest('hex');
  return { cleanName, sha256 };
};

const downloadUrlFor = (assetName) =>
  `https://github.com/${GITHUB_REPOSITORY}/releases/download/${RELEASE_TAG}/${encodeURIComponent(assetName)}`;

const desktopDir = 'release-artifacts/release-desktop-windows';
const desktopFiles = existsSync(desktopDir)
  ? readdirSync(desktopDir, { recursive: true }).map(String)
  : [];

const installers = desktopFiles.filter((file) => file.endsWith(`_${version}_x64-setup.exe`));
if (installers.length !== 1) {
  throw new Error(
    `Expected exactly one NSIS x64 installer for ${version}; found ${installers.length}.`
  );
}
const exeMeta = normalizeAndRename(desktopDir, installers[0]);
const windowsExeUrl = downloadUrlFor(exeMeta.cleanName);

const msiFiles = desktopFiles.filter((file) => file.endsWith('.msi'));
const msiMeta = msiFiles.length > 0 ? normalizeAndRename(desktopDir, msiFiles[0]) : null;
const windowsMsiUrl = msiMeta ? downloadUrlFor(msiMeta.cleanName) : undefined;

const androidDir = 'release-artifacts/release-android-apk';
const androidFiles = existsSync(androidDir)
  ? readdirSync(androidDir, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('.apk'))
  : [];

const normalizedApks = androidFiles.map((file) => normalizeAndRename(androidDir, file));
const arm64Meta =
  normalizedApks.find((item) => /universal|arm64|aarch64/i.test(item.cleanName)) ||
  normalizedApks[0] ||
  null;
const armv7Meta = normalizedApks.find((item) => /armv7|armeabi/i.test(item.cleanName)) || null;

const androidApkUrl = arm64Meta ? downloadUrlFor(arm64Meta.cleanName) : undefined;
const androidArmv7ApkUrl = armv7Meta ? downloadUrlFor(armv7Meta.cleanName) : undefined;

const vsixDir = 'release-artifacts/release-vscode-vsix';
const vsixFiles = existsSync(vsixDir)
  ? readdirSync(vsixDir, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('.vsix'))
  : [];
const vsixMeta = vsixFiles.length > 0 ? normalizeAndRename(vsixDir, vsixFiles[0]) : null;
const vscodeVsixUrl = vsixMeta ? downloadUrlFor(vsixMeta.cleanName) : undefined;

const webUrl = (WEB_STUDIO_URL || 'https://supremeai-studio.pages.dev').replace(/\/+$/, '');
const releasePageUrl =
  RELEASE_TAG === 'latest'
    ? `https://github.com/${GITHUB_REPOSITORY}/releases/tag/latest`
    : `https://github.com/${GITHUB_REPOSITORY}/releases/tag/${encodeURIComponent(RELEASE_TAG)}`;

const checksums = {
  windowsExeSha256: exeMeta.sha256,
  ...(msiMeta ? { windowsMsiSha256: msiMeta.sha256 } : {}),
  ...(arm64Meta ? { androidApkSha256: arm64Meta.sha256 } : {}),
  ...(armv7Meta ? { androidArmv7ApkSha256: armv7Meta.sha256 } : {}),
  ...(vsixMeta ? { vscodeVsixSha256: vsixMeta.sha256 } : {}),
};

const platforms = {
  'windows-x86_64': {
    url: windowsExeUrl,
    sha256: exeMeta.sha256,
  },
  ...(windowsMsiUrl && msiMeta
    ? { 'windows-msi': { url: windowsMsiUrl, sha256: msiMeta.sha256 } }
    : {}),
  ...(androidApkUrl && arm64Meta
    ? {
        'android-arm64': { url: androidApkUrl, sha256: arm64Meta.sha256 },
        'android-apk': { url: androidApkUrl, sha256: arm64Meta.sha256 },
      }
    : {}),
  ...(androidArmv7ApkUrl && armv7Meta
    ? { 'android-armv7': { url: androidArmv7ApkUrl, sha256: armv7Meta.sha256 } }
    : {}),
  ...(vscodeVsixUrl && vsixMeta
    ? { 'vscode-vsix': { url: vscodeVsixUrl, sha256: vsixMeta.sha256 } }
    : {}),
};

const manifest = {
  version,
  tag: RELEASE_TAG,
  repo: GITHUB_REPOSITORY,
  notes: 'SupremeAI Studio Unified Release (Web + Desktop + Android + VS Code VSIX)',
  pub_date: new Date().toISOString(),
  downloads: {
    webUrl,
    releasePageUrl,
    windowsExeUrl,
    ...(windowsMsiUrl ? { windowsMsiUrl } : {}),
    ...(androidApkUrl ? { androidApkUrl } : {}),
    ...(androidArmv7ApkUrl ? { androidArmv7ApkUrl } : {}),
    ...(vscodeVsixUrl ? { vscodeVsixUrl } : {}),
    checksums,
  },
  platforms,
};

const jsonOutput = `${JSON.stringify(manifest, null, 2)}\n`;
writeFileSync('latest-desktop.json', jsonOutput);
writeFileSync('latest-release.json', jsonOutput);
