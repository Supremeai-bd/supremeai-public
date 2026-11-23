import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('smart-pr-guard', () => {
  it('executes successfully in repository root without syntax errors', () => {
    const root = resolve('.');
    const result = execSync('node scripts/smart-pr-guard.mjs', { cwd: root, encoding: 'utf8' });
    expect(result).toContain('SupremeAI Smart Intelligent PR Guard');
    expect(result).toContain('All preflight guards PASSED');
  });
});
