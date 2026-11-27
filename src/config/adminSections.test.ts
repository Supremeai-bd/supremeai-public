import { describe, expect, it } from 'vitest';
import { ADMIN_NAV_TAB_IDS, ADMIN_SECTIONS, findAdminSection } from './adminSections';
import { ADMIN_ONLY_TABS, isRoutableTab } from './navigationTabs';

describe('adminSections — clean admin console structure', () => {
  it('has at most 9 top-level sections', () => {
    expect(ADMIN_SECTIONS.length).toBeLessThanOrEqual(9);
  });

  it('every nav tab is routable and admin-only', () => {
    for (const id of ADMIN_NAV_TAB_IDS) {
      expect(isRoutableTab(id), id).toBe(true);
      expect(ADMIN_ONLY_TABS.has(id), id).toBe(true);
    }
  });

  it('every admin-only tab belongs to a section (no orphan pages)', () => {
    for (const id of ADMIN_ONLY_TABS) expect(findAdminSection(id), id).not.toBeNull();
  });

  it('no tab appears in two sections', () => {
    expect(new Set(ADMIN_NAV_TAB_IDS).size).toBe(ADMIN_NAV_TAB_IDS.length);
  });

  it('maps legacy and child tabs to their section', () => {
    expect(findAdminSection('provider-keys')?.id).toBe('ai');
    expect(findAdminSection('release-gate')?.id).toBe('deploy');
    expect(findAdminSection('system-audit')?.id).toBe('security');
    expect(findAdminSection('compute-fleet')?.id).toBe('agents');
    expect(findAdminSection('chat')).toBeNull();
    expect(findAdminSection(undefined)).toBeNull();
  });
});
