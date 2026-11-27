import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_ONLY_TABS, ROUTABLE_TABS, SUBVIEW_TITLES, isRoutableTab } from './navigationTabs';

/**
 * বাংলা মন্তব্য: ট্যাব সরানোর পর (models, repos, usage, roles, live-sync…) দুটো বাগ
 * থেকে গিয়েছিল — Admin Overview-এর একটা বাটন অপসারিত `models` ট্যাবে পাঠাত, আর
 * পুরনো `?tab=` বুকমার্ক ফাঁকা পেজ দেখাত। এই টেস্ট দুটোকেই স্থায়ীভাবে আটকায়।
 */

const ROOT = join(__dirname, '..', '..');
const appSource = readFileSync(join(ROOT, 'src', 'App.tsx'), 'utf8');

function collect(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (/\.test\./.test(name)) continue;
    if (statSync(full).isDirectory()) collect(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('ROUTABLE_TABS — App.tsx-এর রেন্ডার শাখার সাথে মিল', () => {
  const renderedTabs = new Set(
    [...appSource.matchAll(/activeTab === '([a-z0-9-]+)'/g)].map((m) => m[1])
  );

  it('App.tsx যে ট্যাব রেন্ডার করে তার সবই routable', () => {
    for (const tab of renderedTabs) expect(ROUTABLE_TABS.has(tab), tab).toBe(true);
  });

  it('প্রতিটি routable ট্যাবের জন্য App.tsx-এ রেন্ডার শাখা আছে (ফাঁকা পেজ নয়)', () => {
    for (const tab of ROUTABLE_TABS) expect(renderedTabs.has(tab), tab).toBe(true);
  });

  it('সব admin-only ট্যাব routable', () => {
    for (const tab of ADMIN_ONLY_TABS) expect(isRoutableTab(tab), tab).toBe(true);
  });

  it('অপসারিত ট্যাব ও আজেবাজে মান routable নয়', () => {
    for (const tab of [
      'live-sync',
      'models',
      'repos',
      'usage',
      'roles',
      'user-plugins',
      'visual-cockpit',
      'provider-accounts',
      'user-knowledge',
      'chat-history',
      'feature-flags',
      '',
      'constructor',
      '__proto__',
    ]) {
      expect(isRoutableTab(tab), tab).toBe(false);
    }
    expect(isRoutableTab(undefined)).toBe(false);
    expect(isRoutableTab(null)).toBe(false);
    expect('live-sync' in SUBVIEW_TITLES).toBe(false);
  });
});

describe('কম্পোনেন্টের ট্যাব-নেভিগেশন শুধু routable ট্যাবে যায়', () => {
  const files = collect(join(ROOT, 'src', 'components')).concat(join(ROOT, 'src', 'App.tsx'));
  const calls = files.flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return [...text.matchAll(/\b(onNavigateTab|onSelectTab|handleSelectTab)\(\s*'([^']+)'/g)].map(
      (m) => ({ file: relative(ROOT, file), fn: m[1], tab: m[2] })
    );
  });

  it('অন্তত কিছু নেভিগেশন কল পাওয়া যায় (স্ক্যানার কাজ করছে)', () => {
    expect(calls.length).toBeGreaterThan(5);
  });

  it.each(calls.map((c) => [`${c.file} → ${c.fn}('${c.tab}')`, c.tab]))('%s', (_label, tab) => {
    expect(isRoutableTab(tab as string)).toBe(true);
  });
});
