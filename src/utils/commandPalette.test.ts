import { afterEach, describe, expect, it } from 'vitest';
import {
  flattenGroups,
  isPaletteShortcut,
  loadRecentPaletteIds,
  rankPaletteItems,
  rememberPaletteItem,
  scorePaletteItem,
  type PaletteItem,
} from './commandPalette';

const item = (id: string, title: string, over: Partial<PaletteItem> = {}): PaletteItem => ({
  id,
  title,
  group: 'pages',
  run: () => {},
  ...over,
});

const ITEMS: PaletteItem[] = [
  item('a', 'Alerts', { group: 'admin', subtitle: 'Where alerts are sent' }),
  item('b', 'Services & Health › Alert history', { group: 'admin' }),
  item('c', 'Team & Members', { keywords: ['টিম', 'user team'] }),
  item('d', 'New chat', { group: 'actions' }),
  ...Array.from({ length: 8 }, (_, i) => item(`chat${i}`, `Chat ${i}`, { group: 'chats' })),
];

afterEach(() => localStorage.clear());

describe('scorePaletteItem', () => {
  it('requires every word and prefers title prefix / exact', () => {
    expect(scorePaletteItem(ITEMS[2], 'team members')).toBeGreaterThan(0);
    expect(scorePaletteItem(ITEMS[2], 'team billing')).toBe(0);
    expect(scorePaletteItem(ITEMS[0], 'alerts')).toBeGreaterThan(
      scorePaletteItem(ITEMS[1], 'alerts')
    );
  });

  it('matches keywords, including Bangla', () => {
    expect(scorePaletteItem(ITEMS[2], 'টিম')).toBeGreaterThan(0);
  });
});

describe('rankPaletteItems', () => {
  it('empty query: recent first, groups in order, chats capped at 5', () => {
    const groups = rankPaletteItems(ITEMS, '', ['c', 'missing']);
    // 'c' was the only page and moved to Recent, so the Pages group disappears.
    expect(groups.map((g) => g.group)).toEqual(['recent', 'actions', 'admin', 'chats']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['c']);
    expect(groups.find((g) => g.group === 'chats')!.items).toHaveLength(5);
  });

  it('query: best match first across groups', () => {
    const flat = flattenGroups(rankPaletteItems(ITEMS, 'alert'));
    expect(flat.map((i) => i.id)).toEqual(['a', 'b']);
    expect(flattenGroups(rankPaletteItems(ITEMS, 'zzz'))).toEqual([]);
  });
});

describe('recents', () => {
  it('keeps the 5 most recent unique ids', () => {
    for (const id of ['1', '2', '3', '4', '5', '6', '3']) rememberPaletteItem(id);
    expect(loadRecentPaletteIds()).toEqual(['3', '6', '5', '4', '2']);
  });

  it('survives corrupt storage', () => {
    localStorage.setItem('supremeai_palette_recent', '{bad');
    expect(loadRecentPaletteIds()).toEqual([]);
  });
});

describe('isPaletteShortcut', () => {
  const ev = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
  it('accepts Ctrl+K and Cmd+K only', () => {
    expect(isPaletteShortcut(ev({ key: 'k', ctrlKey: true }))).toBe(true);
    expect(isPaletteShortcut(ev({ key: 'K', metaKey: true }))).toBe(true);
    expect(isPaletteShortcut(ev({ key: 'k' }))).toBe(false);
    expect(isPaletteShortcut(ev({ key: 'k', ctrlKey: true, altKey: true }))).toBe(false);
    expect(isPaletteShortcut(ev({ key: 'k', ctrlKey: true, shiftKey: true }))).toBe(false);
  });
});
