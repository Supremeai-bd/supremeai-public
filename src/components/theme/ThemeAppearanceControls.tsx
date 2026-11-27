import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, Moon, RotateCcw, Sun } from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import {
  useThemeStore,
  LIVE_THEMES,
  isThemeConfigEqual,
  resolveSmartScheme,
  type LiveThemeId,
} from '../../stores/useThemeStore';
import { toast } from '../../stores/useToastStore';
import type { LiveThemeDefinition, ThemeSpecificOptions } from '../../data/themePresets';
import {
  MOTION_SPEED_CHOICES,
  readChoice,
  readToggle,
  SCRIM_CHOICES,
  SURFACE_TONE_CHOICES,
  themeOptionGroupsFor,
} from '../../config/themeOptionGroups';
import { OptionSelect, type OptionSelectItem } from '../ui/OptionSelect';
import { SegmentedControl } from '../ui/SegmentedControl';
import { SettingSwitch } from '../ui/SettingSwitch';

/**
 * Theme controls shared by Settings → Appearance (`full`) and the Sidebar / login
 * theme popover (`compact`).
 *
 * বাংলা: থিম (ছবিসহ ড্রপডাউন) → থিমের এফেক্ট → লাইভ অ্যানিমেশন → "আরও অপশন"
 * (লুকানো)। একটাই কম্পোনেন্ট, একটাই তালিকা — দুই জায়গায় আর অমিল হবে না।
 *
 * Auto/Dark/Light আলাদা অপশন আর নেই — থিম নিজেই সেরা মোড ও টেক্সট-রং ঠিক করে (smart
 * Auto)। প্যানেল খুললে প্রিভিউ শুরু: বদল সাথে সাথে দেখা যায় কিন্তু সেভ হয় না; Save চাপলে
 * থাকে, না চাপলে প্যানেল বন্ধ হলেই আগের থিমে ফিরে যায় (Undo)।
 */

export function themePreviewImageFilter(theme: LiveThemeDefinition, isDark: boolean): string {
  if (theme.isNocturnalPhoto) {
    return isDark
      ? 'brightness(0.86) contrast(1.06)'
      : 'brightness(1.16) contrast(0.95) saturate(0.9)';
  }
  return isDark ? 'brightness(0.54) contrast(1.12) saturate(0.88)' : 'none';
}

/** Mini mock of the app on top of the selected theme; updates instantly. */
export const ThemeLivePreview: React.FC<{ theme: LiveThemeDefinition; isDark: boolean }> = ({
  theme,
  isDark,
}) => {
  const { t } = useI18n();
  return (
    <div data-testid="theme-live-preview" className="space-y-1.5">
      <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
        {t.themeLivePreviewTitle}
      </div>
      <div
        className="relative h-56 rounded-2xl overflow-hidden border border-slate-200/80 dark:border-slate-700/80"
        style={{ background: isDark ? theme.darkPreviewGradient : theme.lightPreviewGradient }}
      >
        {theme.previewImage && (
          <img
            src={theme.previewImage}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: themePreviewImageFilter(theme, isDark) }}
          />
        )}
        <div className="absolute inset-3 rounded-xl theme-surface-glass border flex flex-col overflow-hidden shadow-lg">
          <div className="h-7 px-3 flex items-center gap-1.5 border-b border-slate-200/60 dark:border-white/10">
            <span className="w-2 h-2 rounded-full bg-red-400/80" />
            <span className="w-2 h-2 rounded-full bg-amber-400/80" />
            <span className="w-2 h-2 rounded-full bg-emerald-400/80" />
            <span className="ml-2 text-[10px] font-semibold text-slate-700 dark:text-slate-200 truncate">
              SupremeAI
            </span>
          </div>
          <div className="flex-1 p-3 space-y-2 text-[11px]">
            <div className="ml-auto max-w-[75%] w-fit px-2.5 py-1.5 rounded-xl theme-btn-primary">
              {t.themePreviewSampleUser}
            </div>
            <div className="max-w-[80%] w-fit px-2.5 py-1.5 rounded-xl bg-white/80 dark:bg-slate-800/80 text-slate-800 dark:text-slate-100 border border-slate-200/60 dark:border-white/10">
              {t.themePreviewSampleAi}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ThemeAppearanceControls: React.FC<{ variant?: 'full' | 'compact' }> = ({
  variant = 'full',
}) => {
  const { t } = useI18n();
  const compact = variant === 'compact';
  const [moreOpen, setMoreOpen] = useState(false);

  const resolvedScheme = useThemeStore((s) => s.resolvedScheme);
  const liveTheme = useThemeStore((s) => s.liveTheme);
  const liveMotion = useThemeStore((s) => s.liveMotion);
  const overrideReducedMotion = useThemeStore((s) => s.overrideReducedMotion);
  const prefersReducedMotion = useThemeStore((s) => s.prefersReducedMotion);
  const motionSpeed = useThemeStore((s) => s.motionSpeed);
  const surfaceTone = useThemeStore((s) => s.surfaceTone);
  const scrimIntensity = useThemeStore((s) => s.scrimIntensity);
  const themeOptions = useThemeStore((s) => s.themeOptions);
  const osPrefersDark = useThemeStore((s) => s.osPrefersDark);
  const isDirty = useThemeStore(
    (s) => s.previewSnapshot !== null && !isThemeConfigEqual(s.previewSnapshot, s)
  );
  const saveThemePreview = useThemeStore((s) => s.saveThemePreview);
  const undoThemePreview = useThemeStore((s) => s.undoThemePreview);
  const setLiveTheme = useThemeStore((s) => s.setLiveTheme);
  const setLiveMotion = useThemeStore((s) => s.setLiveMotion);
  const setOverrideReducedMotion = useThemeStore((s) => s.setOverrideReducedMotion);
  const setMotionSpeed = useThemeStore((s) => s.setMotionSpeed);
  const setSurfaceTone = useThemeStore((s) => s.setSurfaceTone);
  const setScrimIntensity = useThemeStore((s) => s.setScrimIntensity);
  const updateThemeOptions = useThemeStore((s) => s.updateThemeOptions);

  const isDark = resolvedScheme === 'dark';
  const isAnimating = liveMotion && (!prefersReducedMotion || overrideReducedMotion);
  const activeTheme = LIVE_THEMES.find((th) => th.id === liveTheme) || LIVE_THEMES[0];
  const placement = compact ? 'inline' : 'overlay';

  // Preview session: start on open; closing without Save restores the previous theme.
  useEffect(() => {
    useThemeStore.getState().beginThemePreview();
    return () => {
      const s = useThemeStore.getState();
      if (!s.previewSnapshot) return;
      if (isThemeConfigEqual(s.previewSnapshot, s)) {
        useThemeStore.setState({ previewSnapshot: null });
        return;
      }
      s.undoThemePreview();
      toast.info(t.themeRevertedTitle, t.themeRevertedDesc);
    };
  }, []);

  const handleSave = () => {
    saveThemePreview();
    // Keep previewing further changes in this still-open panel.
    useThemeStore.getState().beginThemePreview();
    toast.success(t.themeSavedTitle);
  };

  const handleUndo = () => {
    undoThemePreview();
    useThemeStore.getState().beginThemePreview();
  };

  const themeItems: OptionSelectItem<LiveThemeId>[] = LIVE_THEMES.map((theme) => {
    const themeDark = resolveSmartScheme(theme.id, osPrefersDark) === 'dark';
    return {
      value: theme.id,
      label: theme.name,
      description: theme.animationLabel,
      badge:
        theme.recommendedScheme === 'dark'
          ? t.themeBestInDark
          : theme.recommendedScheme === 'light'
            ? t.themeBestInLight
            : undefined,
      thumbnail: {
        image: theme.previewImage,
        background: themeDark ? theme.darkPreviewGradient : theme.lightPreviewGradient,
      },
    };
  });

  const handleAnimation = (on: boolean) => {
    setLiveMotion(on);
    if (on && prefersReducedMotion && !overrideReducedMotion) setOverrideReducedMotion(true);
  };

  const controls = (
    <div className="space-y-4" data-testid={`theme-controls-${variant}`}>
      {isDirty && (
        <div
          role="status"
          data-testid="theme-preview-bar"
          className="flex items-center gap-2 rounded-xl border theme-accent-active px-3 py-2 text-[11px]"
        >
          <span className="flex-1 min-w-0">{t.themePreviewUnsaved}</span>
          <button
            type="button"
            onClick={handleUndo}
            data-testid="theme-preview-undo"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer"
          >
            <RotateCcw aria-hidden="true" className="w-3 h-3" />
            {t.themeUndoBtn}
          </button>
          <button
            type="button"
            onClick={handleSave}
            data-testid="theme-preview-save"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg theme-btn-primary font-medium cursor-pointer"
          >
            <Check aria-hidden="true" className="w-3 h-3" />
            {t.themeSaveBtn}
          </button>
        </div>
      )}

      <OptionSelect
        label={t.themeSelectLabel}
        value={activeTheme.id}
        options={themeItems}
        onChange={setLiveTheme}
        menuPlacement={placement}
        testId="theme-select"
      />

      <div
        data-testid="theme-smart-auto"
        data-scheme={resolvedScheme}
        className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400"
      >
        {isDark ? (
          <Moon aria-hidden="true" className="w-3.5 h-3.5 mt-px shrink-0" />
        ) : (
          <Sun aria-hidden="true" className="w-3.5 h-3.5 mt-px shrink-0" />
        )}
        <span>
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {t.themeModeAuto} · {isDark ? t.schemeDarkTitle : t.schemeLightTitle}
          </span>{' '}
          — {t.themeSmartAutoHint}
        </span>
      </div>

      {themeOptionGroupsFor(activeTheme.id).map((group) =>
        group.kind === 'choice' ? (
          <OptionSelect
            key={group.key}
            label={t[group.labelKey]}
            value={readChoice(themeOptions, group)}
            options={group.choices.map((c) => ({ value: c.value, label: t[c.labelKey] }))}
            onChange={(value) =>
              updateThemeOptions({ [group.key]: value } as Partial<ThemeSpecificOptions>)
            }
            menuPlacement={placement}
            testId={`theme-effect-${group.key}`}
          />
        ) : (
          <SettingSwitch
            key={group.key}
            label={t[group.labelKey]}
            checked={readToggle(themeOptions, group)}
            onChange={(checked) =>
              updateThemeOptions({ [group.key]: checked } as Partial<ThemeSpecificOptions>)
            }
            testId={`theme-effect-${group.key}`}
          />
        )
      )}

      <SettingSwitch
        label={t.liveAnimationLabel}
        description={
          prefersReducedMotion && !overrideReducedMotion
            ? t.liveAnimationReducedHint
            : t.liveAnimationDesc
        }
        checked={isAnimating}
        onChange={handleAnimation}
        testId="theme-live-animation"
      />

      <div className="border-t border-slate-200/70 dark:border-slate-800 pt-3">
        <button
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
          data-testid="theme-more-options"
          className="w-full flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
        >
          <span>{t.appearanceMoreOptions}</span>
          <ChevronDown
            aria-hidden="true"
            className={`w-3.5 h-3.5 transition-transform ${moreOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {moreOpen && (
          <div
            className={`mt-3 grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-3'}`}
          >
            <SegmentedControl
              label={t.uiSurfaceStyleLabel}
              value={surfaceTone}
              onChange={setSurfaceTone}
              size="sm"
              testId="theme-surface"
              options={SURFACE_TONE_CHOICES.map((c) => ({ value: c.value, label: t[c.labelKey] }))}
            />
            <SegmentedControl
              label={t.animationSpeedLabel}
              value={motionSpeed}
              onChange={setMotionSpeed}
              size="sm"
              testId="theme-speed"
              options={MOTION_SPEED_CHOICES.map((c) => ({ value: c.value, label: t[c.labelKey] }))}
            />
            <SegmentedControl
              label={t.backdropClarityLabel}
              value={scrimIntensity}
              onChange={setScrimIntensity}
              size="sm"
              testId="theme-scrim"
              options={SCRIM_CHOICES.map((c) => ({ value: c.value, label: t[c.labelKey] }))}
            />
          </div>
        )}
      </div>
    </div>
  );

  if (compact) return controls;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {controls}
      <div className="lg:sticky lg:top-4">
        <ThemeLivePreview theme={activeTheme} isDark={isDark} />
      </div>
    </div>
  );
};
