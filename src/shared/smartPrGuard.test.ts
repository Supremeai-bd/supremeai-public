import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

test('smart-pr-guard executes successfully in repository root without syntax errors', () => {
  const root = resolve('.');
  const result = execSync('node scripts/smart-pr-guard.mjs', { cwd: root, encoding: 'utf8' });
  assert.match(result, /SupremeAI Smart Intelligent PR Guard/);
  assert.match(result, /All preflight guards PASSED/);
});
