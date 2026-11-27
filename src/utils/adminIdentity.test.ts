import { describe, expect, it } from 'vitest';
import {
  isAdminUserLike,
  isAuthorizedAdminEmail,
  readConfiguredAdminEmails,
  storedAuthUserIsAdmin,
} from './adminIdentity';

const NONE = {};
const CONFIGURED = {
  VITE_ADMIN_EMAIL: ' Owner@Example.com ',
  VITE_ADMIN_EMAILS: 'a@x.io, owner@example.com,,b@x.io',
};

describe('adminIdentity', () => {
  it('has no built-in admin emails when nothing is configured', () => {
    expect(readConfiguredAdminEmails(NONE)).toEqual([]);
    expect(isAuthorizedAdminEmail('niloyjoy7@gmail.com', NONE)).toBe(false);
    expect(isAuthorizedAdminEmail('paykaribazaronline@gmail.com', NONE)).toBe(false);
  });

  it('reads, normalises and de-duplicates VITE_ADMIN_EMAIL(S)', () => {
    expect(readConfiguredAdminEmails(CONFIGURED)).toEqual([
      'owner@example.com',
      'a@x.io',
      'b@x.io',
    ]);
    expect(isAuthorizedAdminEmail('  B@X.IO ', CONFIGURED)).toBe(true);
    expect(isAuthorizedAdminEmail('', CONFIGURED)).toBe(false);
    expect(isAuthorizedAdminEmail(null, CONFIGURED)).toBe(false);
  });

  it('trusts the server role flags first', () => {
    expect(isAdminUserLike({ email: 'x@y.z', isAdminEligible: true }, NONE)).toBe(true);
    expect(isAdminUserLike({ email: 'x@y.z', role: 'admin' }, NONE)).toBe(true);
    expect(isAdminUserLike({ email: 'x@y.z', rbacRole: 'super_admin' }, NONE)).toBe(true);
    expect(isAdminUserLike({ email: 'x@y.z', role: 'user' }, NONE)).toBe(false);
    expect(isAdminUserLike({ email: 'a@x.io', role: 'user' }, CONFIGURED)).toBe(true);
    expect(isAdminUserLike(null, NONE)).toBe(false);
  });

  it('parses the persisted auth user safely', () => {
    expect(storedAuthUserIsAdmin(JSON.stringify({ email: 'q@w.e', role: 'admin' }), NONE)).toBe(
      true
    );
    expect(storedAuthUserIsAdmin(JSON.stringify({ email: 'operator@supremeai.bd' }), NONE)).toBe(
      false
    );
    expect(storedAuthUserIsAdmin('{not json', NONE)).toBe(false);
    expect(storedAuthUserIsAdmin(null, NONE)).toBe(false);
  });
});
