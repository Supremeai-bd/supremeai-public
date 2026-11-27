import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sun, Moon, Palette } from 'lucide-react';
import { useThemeStore, LIVE_THEMES } from '../../stores/useThemeStore';
import { useI18n } from '../../utils/i18n';
import { ThemeAppearanceControls } from './ThemeAppearanceControls';

interface ThemeControlPopoverProps {
  compact?: boolean;
  onOpenSettings?: () => void;
  align?: 'left' | 'right';
  placement?: 'top' | 'bottom';
  triggerLabel?: string;
}

export const ThemeControlPopover: React.FC<ThemeControlPopoverProps> = ({
  compact = false,
  onOpenSettings,
  align = 'right',
  placement = 'bottom',
  triggerLabel,
}) => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
  }>({ left: 12, top: 60, maxHeight: 520 });

  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const resolvedScheme = useThemeStore((s) => s.resolvedScheme);
  const liveTheme = useThemeStore((s) => s.liveTheme);


  const activeThemeMeta = LIVE_THEMES.find((t) => t.id === liveTheme) || LIVE_THEMES[0];


  // Smart Auto only — the icon shows the mode the current theme resolved to.
  const TriggerIcon = resolvedScheme === 'dark' ? Moon : Sun;

  const updatePosition = () => {
    if (!triggerRef.current || typeof window === 'undefined') return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popoverWidth = Math.min(344, window.innerWidth - 24);
    const margin = 12;

    let left = align === 'left' ? rect.left : rect.right - popoverWidth;
    left = Math.max(margin, Math.min(window.innerWidth - popoverWidth - margin, left));

    if (placement === 'top') {
      const bottom = window.innerHeight - rect.top + 8;
      const availableHeight = Math.max(260, rect.top - 24);
      setCoords({ left, bottom, maxHeight: Math.min(540, availableHeight) });
    } else {
      const top = rect.bottom + 8;
      const availableHeight = Math.max(260, window.innerHeight - top - 16);
      setCoords({ left, top, maxHeight: Math.min(540, availableHeight) });
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    const onResize = () => updatePosition();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, align, placement]);

  const popoverNode =
    isOpen && typeof document !== 'undefined'
      ? createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setIsOpen(false)} />
            <div
              role="dialog"
              aria-label={t.themeControlSwitchAria}
              style={{
                position: 'fixed',
                left: coords.left,
                top: coords.top,
                bottom: coords.bottom,
                maxHeight: coords.maxHeight,
                width: 'min(344px, calc(100vw - 24px))',
              }}
              className="z-[100] flex flex-col theme-surface-strong border rounded-2xl shadow-2xl p-3.5 space-y-3 text-xs text-slate-800 dark:text-slate-200"
            >
              <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5 pb-2 border-b border-slate-200/70 dark:border-slate-800 shrink-0">
                <Palette className="w-3.5 h-3.5 theme-accent-text shrink-0" />
                <span className="truncate">{t.themeControlTitle}</span>
              </div>

              {/* বাংলা মন্তব্য: Settings → Appearance-এর একই কম্পোনেন্ট ও একই তালিকা */}
              <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 py-0.5">
                <ThemeAppearanceControls variant="compact" />
              </div>

              {onOpenSettings && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onOpenSettings();
                  }}
                  className="w-full py-1.5 text-center text-[11px] font-medium theme-accent-text hover:underline cursor-pointer border-t border-slate-200/70 dark:border-slate-800 pt-2 shrink-0"
                >
                  {t.themeControlOpenSettings}
                </button>
              )}
            </div>
          </>,
          document.body
        )
      : null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={t.themeControlBackdropAria}
        aria-expanded={isOpen}
        title={`Theme: ${activeThemeMeta.name} · Auto (${resolvedScheme}) — Click to switch`}
        className={
          compact
            ? `p-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                isOpen
                  ? 'theme-accent-active'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-200/70 dark:hover:bg-slate-800'
              }`
            : `inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-medium backdrop-blur-md border transition-colors cursor-pointer shadow-xs whitespace-nowrap shrink-0 ${
                isOpen
                  ? 'theme-accent-active'
                  : 'bg-white/75 dark:bg-slate-900/75 border-slate-200/80 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white'
              }`
        }
      >
        <TriggerIcon className="w-3.5 h-3.5 theme-accent-text shrink-0" />
        {compact && triggerLabel ? (
          <span className="text-[11px] font-medium truncate max-w-[96px]">{triggerLabel}</span>
        ) : !compact ? (
          <span className="hidden sm:inline">
            {t.themeModeAuto}
          </span>
        ) : null}
      </button>

      {popoverNode}
    </div>
  );
};
