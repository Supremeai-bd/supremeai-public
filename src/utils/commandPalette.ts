/**
 * বাংলা মন্তব্য: Ctrl+K কমান্ড প্যালেটের খাঁটি (pure) লজিক — খোঁজা, সাজানো, আর সাম্প্রতিক
 * ব্যবহার মনে রাখা। UI নেই বলে সহজে টেস্ট করা যায়।
 */

export type PaletteGroup = 'attention' | 'recent' | 'actions' | 'pages' | 'admin' | 'chats';

export interface PaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  group: PaletteGroup;
  /** Extra words that should match (English + Bangla synonyms, tab ids…). */
  keywords?: string[];
  /** Small trailing tag, e.g. "2 critical". */
  badge?: { text: string; tone: 'critical' | 'warning' };
  run: () => void;
}

export const PALETTE_GROUP_ORDER: readonly PaletteGroup[] = [
  'attention',
  'recent',
  'actions',
  'pages',
  'admin',
  'chats',
];

const RECENT_KEY = 'supremeai_palette_recent';
const RECENT_MAX = 5;
const RESULT_MAX = 40;

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/**
 * Score one item against the query. 0 = no match.
 * Every query word must appear somewhere; title-prefix and word-start hits rank higher.
 */
export function scorePaletteItem(item: PaletteItem, query: string): number {
  const q = normalize(query);
  if (!q) return 1;
  const title = normalize(item.title);
  const rest = normalize([item.subtitle || '', ...(item.keywords || [])].join(' '));
  const haystack = `${title} ${rest}`;
  const words = q.split(' ');
  if (!words.every((w) => haystack.includes(w))) return 0;
  let score = 10;
  if (title === q) score += 100;
  else if (title.startsWith(q)) score += 60;
  else if (title.includes(q)) score += 30;
  for (const w of words) {
    if (new RegExp(`(^|[\\s/&·-])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(title)) {
      score += 8;
    } else if (title.includes(w)) score += 4;
  }
  // Shorter titles win ties ("Alerts" before "Alert channel history").
  return score - Math.min(title.length, 40) / 10;
}

export interface RankedGroup {
  group: PaletteGroup;
  items: PaletteItem[];
}

/**
 * Empty query → attention, recent, then everything else grouped (chats capped at 5).
 * With a query → one flat best-first list, grouped only for display.
 */
export function rankPaletteItems(
  items: PaletteItem[],
  query: string,
  recentIds: string[] = []
): RankedGroup[] {
  const q = normalize(query);
  const byGroup = new Map<PaletteGroup, PaletteItem[]>();
  const push = (g: PaletteGroup, it: PaletteItem) => {
    const list = byGroup.get(g) ?? [];
    list.push(it);
    byGroup.set(g, list);
  };

  if (!q) {
    const byId = new Map(items.map((it) => [it.id, it]));
    const recent = recentIds.map((id) => byId.get(id)).filter((x): x is PaletteItem => !!x);
    const recentSet = new Set(recent.map((r) => r.id));
    for (const it of recent) push('recent', it);
    for (const it of items) {
      if (recentSet.has(it.id)) continue;
      if (it.group === 'chats' && (byGroup.get('chats')?.length ?? 0) >= 5) continue;
      push(it.group, it);
    }
  } else {
    const scored = items
      .map((it) => ({ it, s: scorePaletteItem(it, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, RESULT_MAX);
    for (const { it } of scored) push(it.group, it);
  }

  const order = q
    ? // keep best-first: order groups by their best item's position
      [...byGroup.keys()]
    : PALETTE_GROUP_ORDER.filter((g) => byGroup.has(g));
  return order.map((group) => ({ group, items: byGroup.get(group)! }));
}

export function flattenGroups(groups: RankedGroup[]): PaletteItem[] {
  return groups.flatMap((g) => g.items);
}

export function loadRecentPaletteIds(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberPaletteItem(id: string): string[] {
  const next = [id, ...loadRecentPaletteIds().filter((x) => x !== id)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage full / private mode — recents are optional */
  }
  return next;
}

/** Fire from anywhere (e.g. a "Search" button) to open the palette. */
export const OPEN_COMMAND_PALETTE_EVENT = 'supremeai:open-command-palette';

export function openCommandPalette(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
}

/** Ctrl+K / ⌘K, ignoring AltGr combos and IME composition. */
export function isPaletteShortcut(e: KeyboardEvent): boolean {
  return (
    (e.ctrlKey || e.metaKey) &&
    !e.altKey &&
    !e.shiftKey &&
    !e.isComposing &&
    (e.key === 'k' || e.key === 'K')
  );
}
