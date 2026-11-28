import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  signSessionToken,
  verifySessionToken,
  isProtectedWorkspaceFile,
  isRestrictedProxyTarget,
  parseCookieHeader,
} from './serverSecurity';

describe('serverSecurity hardening helpers', () => {
  it('hashes passwords with unique scrypt salts and rejects weak backdoors', () => {
    const hash1 = hashPassword('StrongPass!2026');
    const hash2 = hashPassword('StrongPass!2026');
    expect(hash1.startsWith('scrypt:')).toBe(true);
    expect(hash1).not.toBe(hash2);
    expect(verifyPassword('StrongPass!2026', hash1)).toBe(true);
    expect(verifyPassword('password123', hash1)).toBe(false);
    expect(verifyPassword('admin123', hash1)).toBe(false);
    expect(verifyPassword('', hash1)).toBe(false);
  });

  it('signs and verifies session tokens while enforcing expiration', () => {
    const secret = 'test-secret-key-at-least-32-chars-long';
    const now = 1_700_000_000_000;
    const token = signSessionToken(
      { sub: 'usr_1', email: 'Admin@SupremeAI.bd', iat: now, role: 'admin' },
      secret,
      60_000
    );

    const verified = verifySessionToken(token, secret, now + 10_000);
    expect(verified).not.toBeNull();
    expect(verified?.email).toBe('admin@supremeai.bd');
    expect(verified?.role).toBe('admin');

    expect(verifySessionToken(token, secret, now + 60_001)).toBeNull();
    expect(verifySessionToken(token, 'wrong-secret', now + 10_000)).toBeNull();
    expect(verifySessionToken(`${token}tamper`, secret, now + 10_000)).toBeNull();
  });

  it('blocks .env, key material, .git, and node_modules in terminal file access', () => {
    expect(isProtectedWorkspaceFile('.env')).toBe(true);
    expect(isProtectedWorkspaceFile('.env.local')).toBe(true);
    expect(isProtectedWorkspaceFile('config/.env.production')).toBe(true);
    expect(isProtectedWorkspaceFile('.git/config')).toBe(true);
    expect(isProtectedWorkspaceFile('certs/private.pem')).toBe(true);
    expect(isProtectedWorkspaceFile('keys/server.key')).toBe(true);
    expect(isProtectedWorkspaceFile('node_modules/pkg/index.js')).toBe(true);

    expect(isProtectedWorkspaceFile('package.json')).toBe(false);
    expect(isProtectedWorkspaceFile('src/App.tsx')).toBe(false);
  });

  it('blocks loopback, private LAN, metadata IPs, and privileged local APIs in browser proxy', () => {
    expect(
      isRestrictedProxyTarget(new URL('http://127.0.0.1:3000/api/admin/config'), false).restricted
    ).toBe(true);
    expect(isRestrictedProxyTarget(new URL('http://localhost:3000/'), false).restricted).toBe(true);
    expect(isRestrictedProxyTarget(new URL('http://[::1]:3000/'), false).restricted).toBe(true);
    expect(
      isRestrictedProxyTarget(new URL('http://169.254.169.254/latest/meta-data/'), false).restricted
    ).toBe(true);
    expect(isRestrictedProxyTarget(new URL('http://10.0.0.5/'), false).restricted).toBe(true);
    expect(isRestrictedProxyTarget(new URL('http://192.168.1.1/'), false).restricted).toBe(true);
    expect(isRestrictedProxyTarget(new URL('http://172.16.0.1/'), false).restricted).toBe(true);
    expect(
      isRestrictedProxyTarget(new URL('http://127.0.0.1:3000/api/admin/customers'), true).restricted
    ).toBe(true);
    expect(
      isRestrictedProxyTarget(new URL('http://127.0.0.1:3000/api/billing/wallet'), true).restricted
    ).toBe(true);

    expect(isRestrictedProxyTarget(new URL('https://example.com/docs'), false).restricted).toBe(
      false
    );
    expect(
      isRestrictedProxyTarget(new URL('http://127.0.0.1:3000/api/health'), true).restricted
    ).toBe(false);
  });

  it('parses Cookie header safely without prototype pollution', () => {
    const parsed = parseCookieHeader(
      '__proto__=polluted; constructor=bad; prototype=evil; foo=bar; supremeai_admin_session=tok_abc.123'
    );
    expect(parsed.foo).toBe('bar');
    expect(parsed.supremeai_admin_session).toBe('tok_abc.123');
    expect(Object.getPrototypeOf(parsed)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
