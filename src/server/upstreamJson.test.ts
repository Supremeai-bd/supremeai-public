import { describe, expect, it } from 'vitest';
import {
  asUpstreamJson,
  mergeUpstreamUser,
  upstreamRbacRole,
  upstreamString,
  upstreamStringList,
} from './upstreamJson';

describe('upstreamJson narrowing helpers', () => {
  it('asUpstreamJson keeps objects and drops primitives', () => {
    expect(asUpstreamJson({ a: 1 })).toEqual({ a: 1 });
    expect(asUpstreamJson(null)).toBeNull();
    expect(asUpstreamJson('x')).toBeNull();
  });

  it('upstreamString only accepts non-empty strings', () => {
    expect(upstreamString('admin')).toBe('admin');
    expect(upstreamString('')).toBeUndefined();
    expect(upstreamString(1)).toBeUndefined();
    expect(upstreamString({ role: 'admin' })).toBeUndefined();
  });

  it('upstreamStringList filters non-string items', () => {
    expect(upstreamStringList(['a@x.com', 2, null, 'b@x.com'])).toEqual(['a@x.com', 'b@x.com']);
    expect(upstreamStringList('a@x.com')).toEqual([]);
  });

  it('mergeUpstreamUser lets the nested user win and ignores non-object users', () => {
    expect(
      mergeUpstreamUser({ email: 'top@x.com', user: { email: 'nested@x.com' } })
    ).toMatchObject({ email: 'nested@x.com' });
    const flat = { email: 'top@x.com', user: 'nope' };
    expect(mergeUpstreamUser(flat)).toBe(flat);
  });

  it('upstreamRbacRole prefers rbacRole, then rbac_role, then role', () => {
    expect(upstreamRbacRole({ role: 'user', rbac_role: 'developer' })).toBe('developer');
    expect(upstreamRbacRole({ rbacRole: 'admin', role: 'user' })).toBe('admin');
    expect(upstreamRbacRole({ role: 7 })).toBeUndefined();
  });
});
