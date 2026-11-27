import { describe, expect, it } from 'vitest';
import { isAutoModelRoutingActive } from './modelRouting';

describe('isAutoModelRoutingActive', () => {
  it('always auto-routes for regular users, even with an old saved "off" value', () => {
    expect(isAutoModelRoutingActive(false, 'user')).toBe(true);
    expect(isAutoModelRoutingActive(undefined, undefined)).toBe(true);
    expect(isAutoModelRoutingActive(true, null)).toBe(true);
  });

  it('lets admins keep a manual override for testing', () => {
    expect(isAutoModelRoutingActive(false, 'admin')).toBe(false);
    expect(isAutoModelRoutingActive(undefined, 'admin')).toBe(true);
  });
});
