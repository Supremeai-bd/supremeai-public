import { describe, expect, it } from 'vitest';
import { normalizeAuthUser } from './authService';

describe('normalizeAuthUser RBAC & DB admin email matching', () => {
  it('marks user admin-eligible when RBAC role is admin or super_admin even if top-level role is user', () => {
    const userA = normalizeAuthUser({
      id: 'usr_1',
      email: 'ops@company.com',
      name: 'Ops Lead',
      role: 'user',
      rbacRole: 'admin',
      isAdminEligible: true,
    });
    expect(userA?.isAdminEligible).toBe(true);
    expect(userA?.rbacRole).toBe('admin');

    const userB = normalizeAuthUser({
      user: {
        id: 'usr_2',
        email: 'founder@company.com',
        role: 'user',
        rbac_role: 'super_admin',
      },
    });
    expect(userB?.isAdminEligible).toBe(true);
    expect(userB?.rbacRole).toBe('super_admin');
  });

  it('marks user admin-eligible when logged-in email matches admin email from database list', () => {
    const matched = normalizeAuthUser({
      user_id: 'usr_3',
      email: 'PaykariBazarOnline@gmail.com',
      role: 'user',
      adminEmails: ['admin@supremeai.bd', 'paykaribazaronline@gmail.com'],
    });
    expect(matched?.isAdminEligible).toBe(true);
    expect(matched?.email).toBe('paykaribazaronline@gmail.com');
  });

  it('keeps standard users ineligible when email and RBAC role do not grant admin access', () => {
    const regular = normalizeAuthUser({
      user: {
        id: 'usr_4',
        email: 'member@company.com',
        role: 'user',
        rbacRole: 'user',
        isAdminEligible: false,
      },
      adminEmails: ['admin@supremeai.bd'],
    });
    expect(regular?.isAdminEligible).toBe(false);
    expect(regular?.role).toBe('user');
  });

  it('rejects non-object HTML fallback responses cleanly', () => {
    expect(normalizeAuthUser('<!doctype html><html></html>')).toBeNull();
    expect(normalizeAuthUser(null)).toBeNull();
  });
});

describe('normalizeAuthUser narrowing of untyped gateway JSON', () => {
  it('stringifies a non-string adminUserId instead of leaking the raw value', () => {
    const user = normalizeAuthUser({ id: 'usr-1', email: 'a@example.com', admin_user_id: 42 });
    expect(user?.adminUserId).toBe('42');
    expect(user?.isAdminEligible).toBe(true);
  });

  it('ignores non-array roles / admin-email fields and unknown plans', () => {
    const user = normalizeAuthUser({
      email: 'b@example.com',
      roles: 'admin',
      adminEmails: 'b@example.com',
      plan: { tier: 'Enterprise' },
    });
    expect(user?.isAdminEligible).toBe(false);
    expect(user?.role).toBe('user');
    expect(user?.plan).toBe('Free');
    expect(user?.adminUserId).toBeUndefined();
  });

  it('merges a nested user object and lower-cases admin email lists', () => {
    const user = normalizeAuthUser({
      admin_emails: ['C@Example.com', 7],
      user: { email: 'c@example.com', name: 'Cee', plan: 'Pro' },
    });
    expect(user).toMatchObject({ email: 'c@example.com', name: 'Cee', isAdminEligible: true });
    expect(user?.plan).toBe('Enterprise');
  });
});
