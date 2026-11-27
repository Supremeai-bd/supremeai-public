import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Play } from 'lucide-react';

/**
 * Accessible dropdown with optional per-option preview (▶) and thumbnails.
 *
 * বাংলা: ৫টার বেশি অপশন (ভাষা, থিম, ভয়েস) এখানে দেখানো হয়। প্রতিটা অপশনের পাশে
 * ঐচ্ছিক ▶ বাটন থাকে — বাছাই না করেই শুনে/দেখে নেওয়া যায়। কিবোর্ড: ↑ ↓ Home End
 * Enter/Space দিয়ে বাছাই, Esc দিয়ে বন্ধ।
 */

export interface OptionSelectItem<T extends string = string> {
  value: T;
  label: string;
  /** Second line under the label. */
  description?: string;
  /** Small right-aligned tag (e.g. "EN", "CTG"). */
  badge?: string;
  /** Thumbnail: an image URL and/or a CSS background (gradient). */
  thumbnail?: { image?: string; background?: string };
}

export interface OptionSelectProps<T extends string = string> {
  label: string;
  value: T;
  options: ReadonlyArray<OptionSelectItem<T>>;
  onChange: (value: T) => void;
  /** When set, a ▶ button appears on each option and next to the trigger. */
  onPreview?: (value: T) => void;
  previewLabel?: string;
  disabled?: boolean;
  testId?: string;
  /** Visually hide the label (still announced to screen readers). */
  hideLabel?: boolean;
  /**
   * `overlay` (default) floats the list above the page; `inline` pushes content
   * down — use it inside scrollable popovers where an overlay would be clipped.
   */
  menuPlacement?: 'overlay' | 'inline';
}

function Thumbnail({ thumb, size }: { thumb?: OptionSelectItem['thumbnail']; size: 'sm' | 'md' }) {
  if (!thumb) return null;
  const dims = size === 'sm' ? 'w-7 h-5' : 'w-10 h-7';
  return (
    <span
      aria-hidden="true"
      className={`${dims} shrink-0 rounded-md overflow-hidden border border-slate-200/70 dark:border-slate-700/70 bg-slate-200 dark:bg-slate-800`}
      style={thumb.background ? { background: thumb.background } : undefined}
    >
      {thumb.image && (
        <img
          src={thumb.image}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          className="w-full h-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      )}
    </span>
  );
}

export function OptionSelect<T extends string = string>({
  label,
  value,
  options,
  onChange,
  onPreview,
  previewLabel = 'Preview',
  disabled = false,
  testId,
  hideLabel = false,
  menuPlacement = 'overlay',
}: OptionSelectProps<T>) {
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const listId = `${baseId}-list`;
  const [open, setOpen] = useState(false);
  const selectedIndex = useMemo(
    () =>
      Math.max(
        0,
        options.findIndex((o) => o.value === value)
      ),
    [options, value]
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const selected = options[selectedIndex];

  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex);
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, open]);

  const choose = (index: number) => {
    const opt = options[index];
    if (!opt) return;
    if (opt.value !== value) onChange(opt.value);
    close(true);
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(options.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(activeIndex);
        break;
      case 'Escape':
        e.preventDefault();
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={rootRef} className="relative" data-testid={testId}>
      <div
        id={labelId}
        className={
          hideLabel
            ? 'sr-only'
            : 'block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5'
        }
      >
        {label}
      </div>
      <div className="flex items-stretch gap-1.5">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-labelledby={`${labelId} ${baseId}-value`}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={onTriggerKeyDown}
          data-testid={testId ? `${testId}-trigger` : undefined}
          className="flex-1 min-w-0 inline-flex items-center gap-2.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/70 text-left text-xs text-slate-900 dark:text-slate-100 hover:border-slate-300 dark:hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent-ring)] disabled:opacity-50 cursor-pointer"
        >
          <Thumbnail thumb={selected?.thumbnail} size="sm" />
          <span id={`${baseId}-value`} className="flex-1 min-w-0 truncate font-medium">
            {selected?.label ?? ''}
          </span>
          {selected?.badge && (
            <span className="text-[10px] font-mono text-slate-400 shrink-0">{selected.badge}</span>
          )}
          <ChevronDown
            aria-hidden="true"
            className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
        {onPreview && selected && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPreview(selected.value)}
            aria-label={`${previewLabel}: ${selected.label}`}
            title={previewLabel}
            data-testid={testId ? `${testId}-preview` : undefined}
            className="shrink-0 inline-flex items-center justify-center w-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/70 text-slate-600 dark:text-slate-300 hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)] disabled:opacity-50 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={labelId}
          aria-activedescendant={`${baseId}-opt-${activeIndex}`}
          onKeyDown={onListKeyDown}
          className={`${
            menuPlacement === 'inline' ? 'relative max-h-56' : 'absolute z-50 max-h-72 shadow-lg'
          } mt-1.5 w-full overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1 focus:outline-none`}
        >
          {options.map((opt, index) => {
            const isSelected = opt.value === value;
            const isActive = index === activeIndex;
            return (
              <li
                key={opt.value}
                role="presentation"
                data-index={index}
                className={`flex items-center gap-1 rounded-lg ${isActive ? 'bg-slate-100 dark:bg-slate-800' : ''}`}
              >
                <div
                  id={`${baseId}-opt-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  data-testid={testId ? `${testId}-option-${opt.value}` : undefined}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(index)}
                  className="flex-1 min-w-0 flex items-center gap-2.5 px-2.5 py-2 cursor-pointer"
                >
                  <Thumbnail thumb={opt.thumbnail} size="md" />
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2">
                      <span
                        className={`text-xs truncate ${isSelected ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-200'}`}
                      >
                        {opt.label}
                      </span>
                      {opt.badge && (
                        <span className="text-[10px] font-mono text-slate-400 shrink-0">
                          {opt.badge}
                        </span>
                      )}
                    </span>
                    {opt.description && (
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {opt.description}
                      </span>
                    )}
                  </span>
                  {isSelected && (
                    <Check aria-hidden="true" className="w-3.5 h-3.5 theme-accent-text shrink-0" />
                  )}
                </div>
                {onPreview && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPreview(opt.value);
                    }}
                    aria-label={`${previewLabel}: ${opt.label}`}
                    title={previewLabel}
                    data-testid={testId ? `${testId}-preview-${opt.value}` : undefined}
                    className="shrink-0 mr-1 inline-flex items-center justify-center w-7 h-7 rounded-lg text-slate-500 hover:text-[var(--theme-accent)] hover:bg-white dark:hover:bg-slate-900 cursor-pointer"
                  >
                    <Play className="w-3 h-3" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
