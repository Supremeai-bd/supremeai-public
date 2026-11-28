#!/usr/bin/env node
/**
 * বাংলা মন্তব্য: package.json থেকে মূল ভার্সন এবং packages/contracts/* থেকে ক্যানোনিকাল কন্ট্রাক্টগুলো
 * Desktop, Android (Tauri v2), এবং VS Code Extension (.vsix)-এ স্বয়ংক্রিয়ভাবে সিঙ্ক করে।
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

if (!version || typeof version !== 'string') {
  console.error('Invalid version in package.json');
  process.exit(1);
}

const contractFiles = ['models.json', 'roles.json', 'themes.json', 'sync-protocol.json'];
const tauriConfPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const cargoPath = path.join(root, 'src-tauri', 'Cargo.toml');
const vscodePkgPath = path.join(root, 'packages', 'vscode-extension', 'package.json');
const contractsSrcDir = path.join(root, 'packages', 'contracts');
const vscodeContractsDir = path.join(root, 'packages', 'vscode-extension', 'src', 'contracts');
const versionJsonPath = path.join(root, 'version.json');

// বাংলা মন্তব্য: --check মোডে কোনো ফাইল না বদলে সব সারফেসের ভার্সন ও কন্ট্রাক্ট সিঙ্ক যাচাই করা হচ্ছে
if (checkOnly) {
  const drift = [];
  const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
  if (tauriConf.version !== version) {
    drift.push(`src-tauri/tauri.conf.json (${tauriConf.version} !== ${version})`);
  }
  const cargoRaw = readFileSync(cargoPath, 'utf8');
  const cargoMatch = cargoRaw.match(/^version\s*=\s*"([^"]+)"/m);
  if (!cargoMatch || cargoMatch[1] !== version) {
    drift.push(`src-tauri/Cargo.toml (${cargoMatch?.[1] || 'missing'} !== ${version})`);
  }
  const vscodePkg = JSON.parse(readFileSync(vscodePkgPath, 'utf8'));
  if (vscodePkg.version !== version) {
    drift.push(`packages/vscode-extension/package.json (${vscodePkg.version} !== ${version})`);
  }
  const versionJson = JSON.parse(readFileSync(versionJsonPath, 'utf8'));
  if (versionJson.version !== version || versionJson.releaseTag !== `v${version}`) {
    drift.push(`version.json (${versionJson.version} / ${versionJson.releaseTag} !== ${version})`);
  }
  for (const contractFile of contractFiles) {
    const srcRaw = readFileSync(path.join(contractsSrcDir, contractFile), 'utf8');
    let dstRaw;
    try {
      dstRaw = readFileSync(path.join(vscodeContractsDir, contractFile), 'utf8');
    } catch {
      drift.push(`packages/vscode-extension/src/contracts/${contractFile} (missing)`);
      continue;
    }
    if (srcRaw !== dstRaw) {
      drift.push(`packages/vscode-extension/src/contracts/${contractFile} (out of sync)`);
    }
  }
  if (drift.length > 0) {
    console.error(`Version/contract drift detected:\n  - ${drift.join('\n  - ')}`);
    process.exit(1);
  }
  console.log(`All 4 platform manifests and shared contracts verified at version ${version}`);
  process.exit(0);
}

// 1. Tauri config (Desktop + Android)
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
tauriConf.version = version;
writeFileSync(tauriConfPath, `${JSON.stringify(tauriConf, null, 2)}\n`);

// 2. Cargo.toml
const cargoRaw = readFileSync(cargoPath, 'utf8');
const cargoUpdated = cargoRaw.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
writeFileSync(cargoPath, cargoUpdated);

// 3. VS Code Extension (VSIX)
const vscodePkg = JSON.parse(readFileSync(vscodePkgPath, 'utf8'));
vscodePkg.version = version;
writeFileSync(vscodePkgPath, `${JSON.stringify(vscodePkg, null, 2)}\n`);

// 4. Canonical Shared Contracts -> VS Code Extension (so .vsix packaging stays 100% self-contained)
mkdirSync(vscodeContractsDir, { recursive: true });
for (const contractFile of contractFiles) {
  copyFileSync(
    path.join(contractsSrcDir, contractFile),
    path.join(vscodeContractsDir, contractFile)
  );
}

// 5. Canonical repo version.json
let versionJson = {
  version,
  tag: 'latest',
  releaseTag: `v${version}`,
  repo: 'Supremeai-bd/supremeai-public',
};
try {
  const existing = JSON.parse(readFileSync(versionJsonPath, 'utf8'));
  versionJson = {
    ...existing,
    version,
    releaseTag: `v${version}`,
  };
} catch {
  // Use defaults
}
writeFileSync(versionJsonPath, `${JSON.stringify(versionJson, null, 2)}\n`);

console.log(
  `Synchronized Web, Desktop, Android APK, VS Code VSIX, shared contracts, and version.json to version ${version}`
);
