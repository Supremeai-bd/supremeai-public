import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import {
  flattenGroups,
  loadRecentPaletteIds,
  rankPaletteItems,
  rememberPaletteItem,
  type PaletteGroup,
  type PaletteItem,
} from '../utils/commandPalette';
import { useI18n } from '../utils/i18n';

/**
 * বাংলা মন্তব্য: সাধারণ কমান্ড প্যালেট (Ctrl+K)। কী দেখাবে সেটা বাইরে থেকে `items` দিয়ে আসে;
 * এখানে শুধু খোঁজা, কিবোর্ড (↑ ↓ Enter Esc) আর ক্লিক।
 */

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: PaletteItem[];
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose, items }) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setActive(0);
    setRecent(loadRecentPaletteIds());
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(id);
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  const groups = useMemo(() => rankPaletteItems(items, query, recent), [items, query, recent]);
  const flat = useMemo(() => flattenGroups(groups), [groups]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const groupLabel: Record<PaletteGroup, string> = {
    attention: t.cpGroupAttention,
    recent: t.cpGroupRecent,
    actions: t.cpGroupActions,
    pages: t.cpGroupPages,
    admin: t.cpGroupAdmin,
    chats: t.cpGroupChats,
  };

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    rememberPaletteItem(item.id);
    onClose();
    item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      choose(flat[active]);
    }
  };

  let index = -1;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 backdrop-blur-xs px-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.cpTitle}
        onKeyDown={onKeyDown}
        className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-2.5 px-4 border-b border-slate-200 dark:border-slate-800">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={flat[active] ? `cp-item-${active}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.cpPlaceholder}
            className="flex-1 py-3.5 bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden"
          />
          <kbd className="hidden sm:inline text-[10px] font-mono text-slate-400 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5">
            Esc
          </kbd>
        </div>

        <div
          ref={listRef}
          id="command-palette-list"
          role="listbox"
          className="max-h-[55vh] overflow-y-auto py-2"
        >
          {flat.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-slate-400">{t.cpNoResults}</p>
          ) : (
            groups.map((g) => (
              <div key={g.group} className="pb-1">
                <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {groupLabel[g.group]}
                </div>
                {g.items.map((item) => {
                  index += 1;
                  const i = index;
                  const selected = i === active;
                  return (
                    <div
                      key={`${g.group}-${item.id}`}
                      id={`cp-item-${i}`}
                      data-index={i}
                      role="option"
                      aria-selected={selected}
                      onMouseMove={() => setActive(i)}
                      onClick={() => choose(item)}
                      className={`mx-2 flex items-center gap-3 rounded-xl px-3 py-2 cursor-pointer ${
                        selected
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">{item.title}</div>
                        {item.subtitle && (
                          <div
                            className={`truncate text-[11px] ${selected ? 'text-blue-100' : 'text-slate-400'}`}
                          >
                            {item.subtitle}
                          </div>
                        )}
                      </div>
                      {item.badge && (
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            item.badge.tone === 'critical'
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300'
                          }`}
                        >
                          {item.badge.text}
                        </span>
                      )}
                      {selected && <CornerDownLeft className="w-3.5 h-3.5 shrink-0 opacity-80" />}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-200 dark:border-slate-800 text-[10.5px] text-slate-400">
          <span>{t.cpHintNavigate}</span>
          <span>{t.cpHintOpen}</span>
          <span className="ml-auto font-mono">Ctrl K</span>
        </div>
      </div>
    </div>
  );
};
