import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadGoogleIdentityScript } from './gmailOAuthService';

const SRC = 'https://accounts.google.com/gsi/client';
const scripts = () => Array.from(document.querySelectorAll(`script[src="${SRC}"]`));

afterEach(() => {
  scripts().forEach((s) => s.remove());
  delete (window as any).google;
  vi.useRealTimers();
});

describe('loadGoogleIdentityScript', () => {
  it('resolves immediately when GIS is already present', async () => {
    (window as any).google = { accounts: { oauth2: {} } };
    await expect(loadGoogleIdentityScript()).resolves.toBeUndefined();
    expect(scripts()).toHaveLength(0);
  });

  it('replaces a previously failed script tag instead of waiting forever', async () => {
    const stale = document.createElement('script');
    stale.src = SRC;
    document.head.appendChild(stale);
    const pending = loadGoogleIdentityScript();
    expect(document.head.contains(stale)).toBe(false);
    expect(scripts()).toHaveLength(1);
    (scripts()[0] as HTMLScriptElement).onload?.(new Event('load'));
    await expect(pending).resolves.toBeUndefined();
  });

  it('rejects with a clear message when blocked, and removes the tag', async () => {
    const pending = loadGoogleIdentityScript();
    (scripts()[0] as HTMLScriptElement).onerror?.(new Event('error'));
    await expect(pending).rejects.toThrow(/could not load/);
    expect(scripts()).toHaveLength(0);
  });

  it('times out instead of hanging', async () => {
    vi.useFakeTimers();
    const pending = loadGoogleIdentityScript(1000);
    vi.advanceTimersByTime(1001);
    await expect(pending).rejects.toThrow(/too long/);
    expect(scripts()).toHaveLength(0);
  });
});

describe('CSP allows Google sign-in', () => {
  it('permits GIS + Firebase popup scripts and frames', () => {
    const headers = fs.readFileSync(path.join(process.cwd(), 'public/_headers'), 'utf8');
    const csp = headers.split('\n').find((l) => l.includes('Content-Security-Policy')) || '';
    const directive = (name: string) =>
      csp.split(';').find((d) => d.trim().startsWith(name)) || '';
    expect(directive('script-src')).toContain('https://accounts.google.com');
    expect(directive('script-src')).toContain('https://apis.google.com');
    expect(directive('frame-src')).toContain('https://accounts.google.com');
    expect(directive('frame-src')).toContain('https://*.firebaseapp.com');
  });
});
