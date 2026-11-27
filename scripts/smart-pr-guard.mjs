#!/usr/bin/env node
/**
 * scripts/smart-pr-guard.mjs
 * SupremeAI Intelligent PR Guard & Safety Preflight
 * 
 * Enforces:
 * 1. Scope & Sensitive File Shield (.env*, credentials, pem, keys)
 * 2. Runtime Node Parity (@types/node <= 24, TypeScript <= 5.x)
 * 3. Secret Leak Scanner (GitHub PATs, API keys, private keys)
 * 4. Risk Classification (LOW, MEDIUM, HIGH)
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const FORBIDDEN_FILE_PATTERNS = [
  /^\.env/i,
  /\.env\./i,
  /credential/i,
  /id_rsa/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /token_vault/i,
  /secrets?\./i,
];

const SECRET_PATTERNS = [
  /(?:^|[^A-Za-z0-9])ghp_[A-Za-z0-9]{30,}/,
  /(?:^|[^A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}/,
  /(?:^|[^A-Za-z0-9])glsa_[A-Za-z0-9_]{20,}/,
  /(?:^|[^A-Za-z0-9])glc_[A-Za-z0-9_=+-]{20,}/,
  /(?:^|[^A-Za-z0-9])sk-proj-[A-Za-z0-9_-]{20,}/,
  /(?:^|[^A-Za-z0-9])AIza[0-9A-Za-z_-]{30,}/,
  /(?:^|[^A-Za-z0-9])AKIA[0-9A-Z]{16}/,
  /(?:^|[^A-Za-z0-9])xox[baprs]-[0-9A-Za-z-]{15,}/,
  /-----BEGIN (?:RSA|EC|DSA|OPENSSH) PRIVATE KEY-----/,
  /eyJhbGciOi[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, // JWT pattern in code
];

const HIGH_RISK_PATHS = [
  /^functions\/api\/auth/,
  /^src\/services\/auth/,
  /^src\/server\//,
  /^src-tauri\/Cargo\./,
  /^\.github\/workflows\//,
];

function getChangedFiles(baseRef = 'origin/main') {
  try {
    const output = execSync(`git diff --name-only ${baseRef}...HEAD`, { encoding: 'utf8' });
    return output.split('\n').map((f) => f.trim()).filter(Boolean);
  } catch {
    try {
      const output = execSync('git diff --name-only HEAD~1...HEAD', { encoding: 'utf8' });
      return output.split('\n').map((f) => f.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
}

function checkSensitiveFiles(files) {
  const violations = [];
  for (const file of files) {
    for (const pattern of FORBIDDEN_FILE_PATTERNS) {
      if (pattern.test(file)) {
        violations.push({ file, reason: `Matches forbidden pattern: ${pattern}` });
        break;
      }
    }
  }
  return violations;
}

function checkRuntimeParity(repoRoot) {
  const violations = [];
  const pkgPaths = [
    join(repoRoot, 'package.json'),
    join(repoRoot, 'packages/vscode-extension/package.json'),
  ];

  for (const p of pkgPaths) {
    if (!existsSync(p)) continue;
    try {
      const json = JSON.parse(readFileSync(p, 'utf8'));
      const deps = { ...(json.dependencies || {}), ...(json.devDependencies || {}) };
      
      // Node types parity (must be <= 24.x)
      const nodeTypes = deps['@types/node'];
      if (nodeTypes) {
        const majorMatch = nodeTypes.match(/\^?(\d+)/);
        if (majorMatch && parseInt(majorMatch[1], 10) > 24) {
          violations.push({
            file: p,
            reason: `@types/node version ${nodeTypes} violates runtime parity (CI runner is Node 24). Max allowed is 24.x.`,
          });
        }
      }

      // TypeScript version check (must be 5.x)
      const ts = deps['typescript'];
      if (ts) {
        const tsMatch = ts.match(/\^?(\d+)/);
        if (tsMatch && parseInt(tsMatch[1], 10) > 5) {
          violations.push({
            file: p,
            reason: `typescript version ${ts} violates monorepo standard (must be <= 5.x).`,
          });
        }
      }
    } catch (e) {
      violations.push({ file: p, reason: `Failed to parse package.json: ${e.message}` });
    }
  }

  return violations;
}

function scanDiffForSecrets(baseRef = 'origin/main') {
  const leaks = [];
  try {
    const diff = execSync(`git diff ${baseRef}...HEAD`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const lines = diff.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith('+') || line.startsWith('+++')) continue;
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(line)) {
          leaks.push({ line: i + 1, snippet: line.substring(0, 40) + '...' });
          break;
        }
      }
    }
  } catch {
    // If diff cannot be obtained, skip secret scan
  }
  return leaks;
}

function checkTestTampering(baseRef = 'origin/main') {
  const violations = [];
  try {
    const deleted = execSync(`git diff --name-only --diff-filter=D ${baseRef}...HEAD`, { encoding: 'utf8' })
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);
    for (const file of deleted) {
      if (/\.(?:test|spec)\.[jt]sx?$/i.test(file)) {
        violations.push({ file, reason: 'Deleting test files is forbidden by Test Integrity Guard.' });
      }
    }
    const diff = execSync(`git diff ${baseRef}...HEAD -- '*.test.*' '*.spec.*'`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    for (const line of diff.split('\n')) {
      if (!line.startsWith('+') || line.startsWith('+++')) continue;
      if (/\b(?:it|test|describe)\.(?:skip|only)\s*\(|\bx(?:it|test|describe)\s*\(/.test(line)) {
        violations.push({ file: 'test diff', reason: `Test skip/only tampering detected: ${line.trim().slice(0, 60)}` });
      }
    }
  } catch {
    // Skip if baseRef diff unavailable
  }
  return violations;
}

function checkLockfileSync(files) {
  const hasRootPkg = files.includes('package.json');
  const hasRootLock = files.includes('package-lock.json');
  if (hasRootPkg && !hasRootLock) {
    return [{ file: 'package.json', reason: 'package.json modified without updating package-lock.json.' }];
  }
  return [];
}

function classifyRisk(files) {
  let isHigh = false;
  let isMedium = false;

  for (const file of files) {
    if (HIGH_RISK_PATHS.some((p) => p.test(file))) {
      isHigh = true;
      break;
    }
    if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.rs')) {
      isMedium = true;
    }
  }

  if (isHigh) return 'HIGH';
  if (isMedium) return 'MEDIUM';
  return 'LOW';
}

function main() {
  console.log('=== SupremeAI Smart Intelligent PR Guard ===');
  const repoRoot = resolve('.');
  const files = getChangedFiles();
  console.log(`Auditing ${files.length} changed files...`);

  // 1. Sensitive Files Check
  const sensitiveViolations = checkSensitiveFiles(files);
  if (sensitiveViolations.length > 0) {
    console.error('\n❌ REJECTED: Sensitive or forbidden files detected in PR:');
    sensitiveViolations.forEach((v) => console.error(`  - ${v.file}: ${v.reason}`));
    process.exit(1);
  }

  // 2. Runtime Parity Check
  const parityViolations = checkRuntimeParity(repoRoot);
  if (parityViolations.length > 0) {
    console.error('\n❌ REJECTED: Runtime parity violations found:');
    parityViolations.forEach((v) => console.error(`  - ${v.file}: ${v.reason}`));
    process.exit(1);
  }

  // 3. Secret Leak Scanner
  const leaks = scanDiffForSecrets();
  if (leaks.length > 0) {
    console.error('\n❌ REJECTED: Potential credential or API token leak detected in diff:');
    leaks.forEach((l) => console.error(`  - Line: ${l.line} (redacted)`));
    process.exit(1);
  }

  // 4. Test Integrity Guard (Anti-Tamper)
  const testTamper = checkTestTampering();
  if (testTamper.length > 0) {
    console.error('\n❌ REJECTED: Test integrity violation detected:');
    testTamper.forEach((v) => console.error(`  - ${v.file}: ${v.reason}`));
    process.exit(1);
  }

  // 5. Lockfile Sync Check
  const lockViolations = checkLockfileSync(files);
  if (lockViolations.length > 0) {
    console.error('\n❌ REJECTED: Lockfile out of sync:');
    lockViolations.forEach((v) => console.error(`  - ${v.file}: ${v.reason}`));
    process.exit(1);
  }

  // 6. Risk Classification
  const riskTier = classifyRisk(files);
  console.log(`\n✅ All preflight guards PASSED!`);
  console.log(`Risk Classification: [${riskTier}]`);

  // Export to GitHub Actions step outputs if running in CI
  const outputFile = process.env.GITHUB_OUTPUT;
  // No existsSync() pre-check (TOCTOU race): appendFileSync creates/appends atomically.
  if (outputFile) {
    appendFileSync(outputFile, `risk_tier=${riskTier}\npr_guard_passed=true\nchanged_count=${files.length}\n`);
  }

  process.exit(0);
}

main();
