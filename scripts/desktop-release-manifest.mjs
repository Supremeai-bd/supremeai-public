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
  if (basename(full) !== cleanName) {
    renameSync(full, join(dirname(full), cleanName));
  }
  return cleanName;
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
const exeAsset = normalizeAndRename(desktopDir, installers[0]);
const windowsExeUrl = downloadUrlFor(exeAsset);

const msiFiles = desktopFiles.filter((file) => file.endsWith('.msi'));
const msiAsset = msiFiles.length > 0 ? normalizeAndRename(desktopDir, msiFiles[0]) : null;
const windowsMsiUrl = msiAsset ? downloadUrlFor(msiAsset) : undefined;

const androidDir = 'release-artifacts/release-android-apk';
const androidFiles = existsSync(androidDir)
  ? readdirSync(androidDir, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('.apk'))
  : [];

const normalizedApks = androidFiles.map((file) => normalizeAndRename(androidDir, file));
const arm64Apk =
  normalizedApks.find((name) => /universal|arm64|aarch64/i.test(name)) || normalizedApks[0] || null;
const armv7Apk = normalizedApks.find((name) => /armv7|armeabi/i.test(name)) || null;

const androidApkUrl = arm64Apk ? downloadUrlFor(arm64Apk) : undefined;
const androidArmv7ApkUrl = armv7Apk ? downloadUrlFor(armv7Apk) : undefined;

const vsixDir = 'release-artifacts/release-vscode-vsix';
const vsixFiles = existsSync(vsixDir)
  ? readdirSync(vsixDir, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('.vsix'))
  : [];
const vsixAsset = vsixFiles.length > 0 ? normalizeAndRename(vsixDir, vsixFiles[0]) : null;
const vscodeVsixUrl = vsixAsset ? downloadUrlFor(vsixAsset) : undefined;

const webUrl = (WEB_STUDIO_URL || 'https://supremeai-studio.pages.dev').replace(/\/+$/, '');
const releasePageUrl =
  RELEASE_TAG === 'latest'
    ? `https://github.com/${GITHUB_REPOSITORY}/releases/tag/latest`
    : `https://github.com/${GITHUB_REPOSITORY}/releases/tag/${encodeURIComponent(RELEASE_TAG)}`;

const platforms = {
  'windows-x86_64': {
    url: windowsExeUrl,
  },
  ...(windowsMsiUrl ? { 'windows-msi': { url: windowsMsiUrl } } : {}),
  ...(androidApkUrl
    ? {
        'android-arm64': { url: androidApkUrl },
        'android-apk': { url: androidApkUrl },
      }
    : {}),
  ...(androidArmv7ApkUrl ? { 'android-armv7': { url: androidArmv7ApkUrl } } : {}),
  ...(vscodeVsixUrl ? { 'vscode-vsix': { url: vscodeVsixUrl } } : {}),
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
  },
  platforms,
};

const jsonOutput = `${JSON.stringify(manifest, null, 2)}\n`;
writeFileSync('latest-desktop.json', jsonOutput);
writeFileSync('latest-release.json', jsonOutput);
