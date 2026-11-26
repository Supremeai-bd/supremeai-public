// @vitest-environment node
// বাংলা মন্তব্য: jsdom-এর Uint8Array/TextEncoder আলাদা realm-এর, তাই Node-এর WebCrypto (SubtleCrypto) AES-GCM
// unseal-এ null দেয়। এই স্যুট DOM-নির্ভর নয় — Node environment-এ চালানো হয় (localStorage নিজস্ব polyfill)।
import { describe, expect, it } from 'vitest';
import {
  buildGmailSessionSetCookie,
  GMAIL_SESSION_COOKIE_NAME,
  parseCookieFromHeader,
  sealGmailSessionCookie,
  unsealGmailSessionCookie,
} from './gmailSessionCrypto';

describe('gmailSessionCrypto', () => {
  const secret = 'unit-test-gmail-session-sealing-secret-key';

  it('seals and unseals a valid Gmail OAuth session payload', async () => {
    const sealed = await sealGmailSessionCookie(
      {
        accessToken: 'ya29.test-access-token',
        uid: 'firebase-uid-123',
        email: 'user@gmail.com',
      },
      secret
    );
    expect(sealed).toBeTruthy();
    expect(sealed).toContain('.');

    const unsealed = await unsealGmailSessionCookie(sealed!, secret);
    expect(unsealed).not.toBeNull();
    expect(unsealed?.accessToken).toBe('ya29.test-access-token');
    expect(unsealed?.uid).toBe('firebase-uid-123');
    expect(unsealed?.email).toBe('user@gmail.com');
    expect(unsealed!.exp).toBeGreaterThan(Date.now());
  });

  it('rejects tampered or expired tokens', async () => {
    const expired = await sealGmailSessionCookie(
      {
        accessToken: 'ya29.expired',
        uid: 'uid-1',
        email: 'a@b.com',
        exp: Date.now() - 1000,
      },
      secret
    );
    expect(expired).toBeTruthy();
    expect(await unsealGmailSessionCookie(expired!, secret)).toBeNull();
    expect(await unsealGmailSessionCookie(expired!, 'wrong-secret')).toBeNull();
    expect(await unsealGmailSessionCookie('invalid.token', secret)).toBeNull();
  });

  it('parses cookies from Cookie headers and emits CHIPS Partitioned attributes on HTTPS', () => {
    const httpsCookie = buildGmailSessionSetCookie('abc.def', 3300, true);
    expect(httpsCookie).toContain(`${GMAIL_SESSION_COOKIE_NAME}=abc.def`);
    expect(httpsCookie).toContain('HttpOnly');
    expect(httpsCookie).toContain('SameSite=None');
    expect(httpsCookie).toContain('Secure');
    expect(httpsCookie).toContain('Partitioned');

    const httpCookie = buildGmailSessionSetCookie('abc.def', 3300, false);
    expect(httpCookie).toContain('SameSite=Lax');
    expect(httpCookie).not.toContain('Secure');

    const parsed = parseCookieFromHeader(
      `other=1; ${GMAIL_SESSION_COOKIE_NAME}=abc.def; theme=dark`,
      GMAIL_SESSION_COOKIE_NAME
    );
    expect(parsed).toBe('abc.def');
  });
});
