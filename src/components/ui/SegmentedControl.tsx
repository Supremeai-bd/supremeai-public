import React, { useId, useRef } from 'react';

/**
 * 2–4 options shown side by side (Light/Dark, speed …) as an accessible radio group.
 * বাংলা: অল্প অপশনের জন্য পাশাপাশি বাটন; ← → দিয়েও বদলানো যায়।
 */

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

export interface SegmentedControlProps<T extends string = string> {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  hideLabel?: boolean;
  testId?: string;
  size?: 'sm' | 'md';
}

export function SegmentedControl<T extends string = string>({
  label,
  value,
  options,
  onChange,
  hideLabel = false,
  testId,
  size = 'md',
}: SegmentedControlProps<T>) {
  const labelId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div data-testid={testId}>
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
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="grid gap-1 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-800/40"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((opt, index) => {
          const checked = opt.value === value;
          return (
            <button
              key={opt.value}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => onChange(opt.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  move(index, 1);
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  move(index, -1);
                }
              }}
              data-testid={testId ? `${testId}-${opt.value}` : undefined}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all cursor-pointer min-w-0 ${
                size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'
              } ${
                checked
                  ? 'theme-accent-active text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {opt.icon}
              <span className="truncate">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
