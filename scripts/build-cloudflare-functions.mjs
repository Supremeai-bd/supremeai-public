#!/usr/bin/env node
/**
 * Safe Staged Build for Cloudflare Pages Functions
 *
 * Copies production function files from `functions/` into a temporary staging
 * directory (excluding `*.test.ts`, `*.test.js`, `*.spec.ts` files), then runs
 * `wrangler pages functions build` without mutating the repository working tree.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const functionsDir = path.join(root, 'functions');
const outDir = path.join(root, 'dist', '_worker.js');
const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supremeai-cf-functions-'));

const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/i;

function copyProductionFiles(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyProductionFiles(srcPath, destPath);
    } else if (entry.isFile() && !TEST_FILE_PATTERN.test(entry.name)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

try {
  console.log(`Staging production Cloudflare Functions into ${stagingDir}...`);
  copyProductionFiles(functionsDir, stagingDir);
  console.log(`Building Pages Functions bundle to ${outDir}...`);
  execSync(`npx wrangler pages functions build "${stagingDir}" --outdir="${outDir}"`, {
    cwd: root,
    stdio: 'inherit',
  });
  console.log('Cloudflare Pages Functions build completed cleanly.');
} finally {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}
